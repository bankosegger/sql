/* SQL, end to end - course runtime.
   Everything runs locally: SQLite compiled to WebAssembly, lessons as data. */
(function () {
  'use strict';

  var MODULES = window.CURRICULUM || [];
  var STORE_KEY = 'sqlcourse.v1';
  var SQL = null;          // sql.js namespace
  var SNAPSHOT = null;     // seeded database bytes, cloned for every run
  var playDb = null;       // persistent playground connection
  var state = load();
  var lessonIndex = [];    // flat list for prev/next + search

  MODULES.forEach(function (m, mi) {
    m.lessons.forEach(function (l, li) {
      lessonIndex.push({ mod: m, lesson: l, mi: mi, li: li, key: m.id + '/' + l.id });
    });
  });

  /* ------------------------------------------------------------------ store */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var s = raw ? JSON.parse(raw) : {};
      s.lessons = s.lessons || {};
      s.code = s.code || {};
      s.theme = s.theme || 'dark';
      return s;
    } catch (e) {
      return { lessons: {}, code: {}, theme: 'dark' };
    }
  }
  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
    }, 200);
  }
  function lp(key) {
    if (!state.lessons[key]) state.lessons[key] = { done: false, ex: {}, quiz: {} };
    return state.lessons[key];
  }
  function lessonComplete(entry) {
    var p = state.lessons[entry.key];
    if (!p) return false;
    if (p.done) return true;
    var exs = entry.lesson.exercises || [];
    if (!exs.length) return false;
    return exs.every(function (_, i) { return p.ex[i]; });
  }

  /* ------------------------------------------------- tiny markdown renderer */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var KEYWORDS = ('select from where group by having order limit offset join inner left right full outer cross natural on using union all intersect except ' +
    'insert into values update set delete create table view index trigger alter drop add column constraint primary key foreign references unique check default ' +
    'not null and or in between like glob is as distinct case when then else end exists cast with recursive over partition rows range groups unbounded preceding following current row ' +
    'begin commit rollback savepoint release transaction explain query plan pragma if asc desc cascade restrict temporary temp returning conflict do nothing excluded ' +
    'grant revoke truncate merge matched source target window filter collate autoincrement generated always stored virtual without rowid attach detach analyze vacuum' )
    .split(' ');
  var FUNCS = ('count sum avg min max round abs coalesce ifnull nullif length substr substring upper lower trim ltrim rtrim replace instr printf format ' +
    'date time datetime julianday strftime unixepoch cast typeof random group_concat string_agg row_number rank dense_rank ntile lag lead first_value last_value nth_value ' +
    'percent_rank cume_dist total changes last_insert_rowid json json_extract json_array json_object json_each json_tree json_group_array json_valid json_type iif ' +
    'char hex quote replace like_regex now current_date current_timestamp extract concat left right position lpad rpad to_char nvl decode').split(' ');
  var KWSET = {}, FNSET = {};
  KEYWORDS.forEach(function (k) { KWSET[k] = 1; });
  FUNCS.forEach(function (k) { FNSET[k] = 1; });

  function highlight(code) {
    var out = '';
    var re = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*')|("(?:""|[^"])*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_0-9$]*)|([\s\S])/g;
    var m;
    while ((m = re.exec(code))) {
      if (m[1]) out += '<span class="t-com">' + esc(m[1]) + '</span>';
      else if (m[2] || m[3]) out += '<span class="t-str">' + esc(m[2] || m[3]) + '</span>';
      else if (m[4]) out += '<span class="t-num">' + m[4] + '</span>';
      else if (m[5]) {
        var w = m[5], lw = w.toLowerCase();
        if (KWSET[lw]) out += '<span class="t-kw">' + esc(w) + '</span>';
        else if (FNSET[lw]) out += '<span class="t-fn">' + esc(w) + '</span>';
        else out += esc(w);
      } else out += esc(m[6]);
    }
    return out;
  }

  function inline(s) {
    // input is already HTML-escaped
    var parts = s.split(/(`[^`]+`)/);
    return parts.map(function (p) {
      if (p.charAt(0) === '`' && p.length > 1 && p.slice(-1) === '`') {
        return '<code>' + highlight(unesc(p.slice(1, -1))) + '</code>';
      }
      return p
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }).join('');
  }
  function unesc(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  }

  function md(src) {
    var lines = String(src).replace(/\r/g, '').replace(/\t/g, '  ').split('\n');
    // strip the common indentation of template literals
    var indent = Infinity;
    lines.forEach(function (l) {
      if (l.trim()) indent = Math.min(indent, l.match(/^ */)[0].length);
    });
    if (indent === Infinity) indent = 0;
    lines = lines.map(function (l) { return l.slice(indent); });

    var html = '', i = 0;
    function flushList(tag, items) {
      html += '<' + tag + '>' + items.map(function (t) { return '<li>' + inline(esc(t)) + '</li>'; }).join('') + '</' + tag + '>';
    }
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }

      // fenced code: ~~~sql / ~~~sql-static / ~~~text
      var fence = line.match(/^~~~\s*([\w-]*)\s*$/);
      if (fence) {
        var lang = fence[1] || 'text', buf = [];
        i++;
        while (i < lines.length && !/^~~~\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        var code = buf.join('\n');
        var body = (lang.indexOf('sql') === 0) ? highlight(code) : esc(code);
        var runnable = lang === 'sql';
        html += '<figure class="code-block' + (runnable ? ' runnable' : '') + '">' +
          '<pre><code class="' + esc(lang) + '">' + body + '</code></pre>' +
          (runnable ? '<div class="code-bar"><button class="btn subtle tiny" data-runsql>&#9654; Run this</button>' +
            '<span class="code-note"></span></div><div class="code-out"></div>' : '') +
          '</figure>';
        continue;
      }

      // callouts ::: kind
      var call = line.match(/^:::\s*(tip|warn|dialect|note)\s*(.*)$/);
      if (call) {
        var kind = call[1], title = call[2] || ({ tip: 'Tip', warn: 'Careful', dialect: 'Dialect notes', note: 'Note' })[kind];
        var cbuf = [];
        i++;
        while (i < lines.length && !/^:::\s*$/.test(lines[i])) { cbuf.push(lines[i]); i++; }
        i++;
        html += '<div class="callout ' + kind + '"><strong>' + inline(esc(title)) + '</strong>' + md(cbuf.join('\n')) + '</div>';
        continue;
      }

      var h = line.match(/^(#{2,4})\s+(.*)$/);
      if (h) { var lvl = h[1].length; html += '<h' + lvl + '>' + inline(esc(h[2])) + '</h' + lvl + '>'; i++; continue; }

      if (/^>\s?/.test(line)) {
        var qbuf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { qbuf.push(lines[i].replace(/^>\s?/, '')); i++; }
        html += '<blockquote>' + md(qbuf.join('\n')) + '</blockquote>';
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        var ul = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          var item = lines[i].replace(/^[-*]\s+/, '');
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i])) { item += ' ' + lines[i].trim(); i++; }
          ul.push(item);
        }
        flushList('ul', ul);
        continue;
      }
      if (/^\d+[.)]\s+/.test(line)) {
        var ol = [];
        while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) {
          var it = lines[i].replace(/^\d+[.)]\s+/, '');
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i])) { it += ' ' + lines[i].trim(); i++; }
          ol.push(it);
        }
        flushList('ol', ol);
        continue;
      }

      if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
        var cells = function (l) {
          return l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
        };
        var head = cells(line);
        i += 2;
        var trs = '';
        while (i < lines.length && /^\|.*\|$/.test(lines[i])) {
          trs += '<tr>' + cells(lines[i]).map(function (c) { return '<td>' + inline(esc(c)) + '</td>'; }).join('') + '</tr>';
          i++;
        }
        html += '<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(esc(c)) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + trs + '</tbody></table>';
        continue;
      }

      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(~~~|:::|>|#{2,4}\s|[-*]\s|\d+[.)]\s)/.test(lines[i]) &&
             !/^\|.*\|$/.test(lines[i])) { para.push(lines[i]); i++; }
      if (para.length) html += '<p>' + inline(esc(para.join('\n'))) + '</p>';
    }
    return html;
  }

  /* ------------------------------------------------------------- SQL engine */
  function freshDb() {
    var db = new SQL.Database(SNAPSHOT);
    db.run('PRAGMA foreign_keys = ON;');
    return db;
  }

  // Runs a script; returns { sets:[{columns,values}], last, changes }
  function runScript(db, sql) {
    var sets = [], changes = 0;
    var stmts = db.iterateStatements(sql);
    var s;
    while (!(s = stmts.next()).done) {
      var st = s.value;
      var cols = st.getColumnNames();
      if (cols.length) {
        var values = [];
        while (st.step()) values.push(st.get());
        if (values.length || true) sets.push({ columns: cols, values: values, sql: st.getSQL() });
      } else {
        st.step();
        changes += db.getRowsModified();
      }
      st.free();
    }
    return { sets: sets, last: sets.length ? sets[sets.length - 1] : null, changes: changes };
  }

  function norm(v) {
    if (v === null || typeof v === 'undefined') return '\u0000NULL';
    if (typeof v === 'number') {
      if (!isFinite(v)) return String(v);
      return String(Math.round(v * 1e6) / 1e6);
    }
    if (v instanceof Uint8Array) return 'blob:' + v.length;
    return String(v);
  }
  function rowKey(r) { return r.map(norm).join('\u001f'); }

  function compare(actual, expected, orderMatters) {
    if (!expected) return { ok: true, notes: [] };
    if (!actual) {
      return { ok: false, notes: ['Your SQL did not return a result set. The grader needs a query that produces rows.'] };
    }
    var notes = [];
    if (actual.columns.length !== expected.columns.length) {
      notes.push('Expected **' + expected.columns.length + ' column(s)**, your query returned **' +
        actual.columns.length + '** (`' + actual.columns.join(', ') + '`).');
      return { ok: false, notes: notes };
    }
    if (actual.values.length !== expected.values.length) {
      notes.push('Expected **' + expected.values.length + ' row(s)**, your query returned **' + actual.values.length + '**.');
    }
    if (orderMatters) {
      var n = Math.min(actual.values.length, expected.values.length);
      for (var i = 0; i < n; i++) {
        if (rowKey(actual.values[i]) !== rowKey(expected.values[i])) {
          notes.push('Row ' + (i + 1) + ' differs — expected `' + expected.values[i].map(fmtCell).join(' | ') +
            '`, got `' + actual.values[i].map(fmtCell).join(' | ') + '`. (This exercise checks row order.)');
          break;
        }
      }
      return { ok: notes.length === 0, notes: notes };
    }
    var bag = {};
    expected.values.forEach(function (r) { var k = rowKey(r); bag[k] = (bag[k] || 0) + 1; });
    var extra = [];
    actual.values.forEach(function (r) {
      var k = rowKey(r);
      if (bag[k]) bag[k]--; else extra.push(r);
    });
    var missing = [];
    Object.keys(bag).forEach(function (k) {
      for (var c = 0; c < bag[k]; c++) missing.push(k.split('\u001f'));
    });
    if (missing.length) {
      notes.push('Missing ' + missing.length + ' expected row(s), e.g. `' +
        missing.slice(0, 2).map(function (r) { return r.map(showNull).join(' | '); }).join('` and `') + '`.');
    }
    if (extra.length) {
      notes.push(extra.length + ' row(s) in your result should not be there, e.g. `' +
        extra.slice(0, 2).map(function (r) { return r.map(fmtCell).join(' | '); }).join('` and `') + '`.');
    }
    return { ok: notes.length === 0, notes: notes };
  }
  function showNull(s) { return s === '\u0000NULL' ? 'NULL' : s; }
  function fmtCell(v) { return v === null ? 'NULL' : String(v); }

  function resultTable(set, limit) {
    limit = limit || 200;
    if (!set) return '';
    var rows = set.values.slice(0, limit);
    var html = '<div class="result-meta">' + set.values.length + ' row' + (set.values.length === 1 ? '' : 's') +
      (set.values.length > limit ? ' (showing first ' + limit + ')' : '') + ' &middot; ' +
      set.columns.length + ' column' + (set.columns.length === 1 ? '' : 's') + '</div>';
    html += '<div class="table-scroll"><table class="result"><thead><tr>' +
      set.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>' + r.map(function (v) {
        if (v === null) return '<td class="null">NULL</td>';
        if (typeof v === 'number') return '<td class="num">' + esc(v) + '</td>';
        if (v instanceof Uint8Array) return '<td class="null">&lt;blob ' + v.length + 'B&gt;</td>';
        return '<td>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    });
    if (!rows.length) {
      html += '<tr><td class="null" colspan="' + set.columns.length + '">no rows</td></tr>';
    }
    return html + '</tbody></table></div>';
  }

  /* ----------------------------------------------------------------- router */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    if (!h) return { page: 'home' };
    var parts = h.split('/');
    if (parts[0] === 'playground') return { page: 'playground' };
    if (parts[0] === 'reference') return { page: 'reference', section: parts[1] };
    if (parts[0] === 'lesson' && parts[1] && parts[2]) return { page: 'lesson', key: parts[1] + '/' + parts[2] };
    return { page: 'home' };
  }

  var content, sidebar;

  function render() {
    var route = parseHash();
    document.getElementById('search-results').hidden = true;
    if (route.page === 'lesson') {
      var entry = lessonIndex.filter(function (e) { return e.key === route.key; })[0];
      if (entry) renderLesson(entry); else renderHome();
    } else if (route.page === 'playground') renderPlayground();
    else if (route.page === 'reference') renderReference(route.section);
    else renderHome();
    renderSidebar();
    updateProgressPill();
    window.scrollTo(0, 0);
    content.focus({ preventScroll: true });
  }

  function updateProgressPill() {
    var done = lessonIndex.filter(lessonComplete).length;
    document.getElementById('progress-pill').textContent = done + ' / ' + lessonIndex.length;
  }

  function renderSidebar() {
    var cur = parseHash();
    var html = '';
    MODULES.forEach(function (m, mi) {
      var ls = m.lessons;
      var doneCount = ls.filter(function (l) {
        return lessonComplete({ key: m.id + '/' + l.id, lesson: l });
      }).length;
      var open = cur.page === 'lesson' && cur.key && cur.key.indexOf(m.id + '/') === 0;
      html += '<details class="nav-module"' + (open ? ' open' : '') + '><summary>' +
        '<span class="chev">&#9654;</span><span class="mod-num">' + String(mi + 1).padStart(2, '0') + '</span>' +
        '<span>' + esc(m.title) + '</span><span class="mod-count">' + doneCount + '/' + ls.length + '</span></summary><ul class="nav-lessons">';
      ls.forEach(function (l) {
        var key = m.id + '/' + l.id;
        var done = lessonComplete({ key: key, lesson: l });
        html += '<li><a href="#/lesson/' + key + '" class="' + (cur.key === key ? 'current' : '') + '">' +
          '<span class="tick">' + (done ? '&#10003;' : '') + '</span><span>' + esc(l.title) + '</span></a></li>';
      });
      html += '</ul></details>';
    });
    html += '<div class="sidebar-foot">Progress is saved in this browser. ' +
      '<button id="reset-progress">Reset progress</button></div>';
    sidebar.innerHTML = html;
    var rp = document.getElementById('reset-progress');
    if (rp) rp.onclick = function () {
      if (confirm('Clear all progress and saved editor contents?')) {
        state = { lessons: {}, code: {}, theme: state.theme };
        save();
        render();
      }
    };
  }

  /* ------------------------------------------------------------------- home */
  function renderHome() {
    var doneTotal = lessonIndex.filter(lessonComplete).length;
    var next = lessonIndex.filter(function (e) { return !lessonComplete(e); })[0] || lessonIndex[0];
    var exCount = lessonIndex.reduce(function (a, e) { return a + (e.lesson.exercises || []).length; }, 0);
    var html = '<h1 class="lesson-title">SQL, end to end</h1>' +
      '<p class="lede">' + MODULES.length + ' modules &middot; ' + lessonIndex.length + ' lessons &middot; ' +
      exCount + ' graded exercises, all run against a real SQLite database inside this page.</p>' +
      md(window.COURSE_INTRO || '') +
      '<p><a class="btn primary" style="text-decoration:none;display:inline-block" href="#/lesson/' + next.key + '">' +
      (doneTotal ? 'Continue: ' + esc(next.lesson.title) : 'Start with ' + esc(next.lesson.title)) + '</a></p>' +
      '<div class="bar" style="max-width:420px"><i style="width:' +
      Math.round(100 * doneTotal / lessonIndex.length) + '%"></i></div>' +
      '<h2>The course</h2>';
    MODULES.forEach(function (m, mi) {
      var ls = m.lessons;
      var dc = ls.filter(function (l) { return lessonComplete({ key: m.id + '/' + l.id, lesson: l }); }).length;
      html += '<a class="module-card" href="#/lesson/' + m.id + '/' + ls[0].id + '">' +
        '<span class="mc-meta">' + dc + ' / ' + ls.length + '</span>' +
        '<h3>' + String(mi + 1).padStart(2, '0') + ' &middot; ' + esc(m.title) + '</h3>' +
        '<p>' + esc(m.blurb || '') + '</p>' +
        '<div class="bar"><i style="width:' + Math.round(100 * dc / ls.length) + '%"></i></div></a>';
    });
    html += '<h2>The practice database</h2>' +
      '<p>Every lesson queries the same dataset: a hardware reseller with staff, customers, orders and support data. ' +
      'Explore it in the <a href="#/playground">playground</a>.</p><div id="schema-home"></div>';
    content.innerHTML = html;
    renderSchemaInto(document.getElementById('schema-home'));
  }

  function renderSchemaInto(el, useDb) {
    if (!el) return;
    var db = useDb || freshDb();
    var tables = runScript(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;").last;
    var html = '<div class="grid2">';
    tables.values.forEach(function (row) {
      var t = row[0];
      var info = runScript(db, 'PRAGMA table_info(' + t + ');').last;
      var fks = runScript(db, 'PRAGMA foreign_key_list(' + t + ');').last;
      var cnt = runScript(db, 'SELECT count(*) FROM "' + t + '";').last.values[0][0];
      var fkMap = {};
      (fks.values || []).forEach(function (f) { fkMap[f[3]] = f[2] + '.' + f[4]; });
      html += '<div class="schema-table"><h4>' + esc(t) + ' <span class="mod-count">' + cnt + ' rows</span></h4><ul>';
      info.values.forEach(function (c) {
        var name = c[1], type = c[2], notnull = c[3], pk = c[5];
        html += '<li>' + (pk ? '<span class="ck">&#9733;</span> ' : '') + esc(name) +
          ' <span class="fk">' + esc(type || '') + (notnull && !pk ? ' not null' : '') +
          (fkMap[name] ? ' &rarr; ' + esc(fkMap[name]) : '') + '</span></li>';
      });
      html += '</ul></div>';
    });
    if (!useDb) db.close();
    el.innerHTML = html + '</div>';
  }

  /* ----------------------------------------------------------------- lesson */
  function renderLesson(entry) {
    var l = entry.lesson, m = entry.mod;
    var prev = lessonIndex[lessonIndex.indexOf(entry) - 1];
    var nextL = lessonIndex[lessonIndex.indexOf(entry) + 1];
    var p = lp(entry.key);
    var html = '<div class="crumbs">' + String(entry.mi + 1).padStart(2, '0') + ' &middot; ' + esc(m.title) +
      ' &middot; lesson ' + (entry.li + 1) + ' of ' + m.lessons.length + '</div>' +
      '<h1 class="lesson-title">' + esc(l.title) + '</h1>' +
      (l.lede ? '<p class="lede">' + inline(esc(l.lede)) + '</p>' : '') +
      '<div class="prose" id="prose">' + md(l.body || '') + '</div>' +
      '<div id="exercises"></div><div id="quiz"></div>' +
      '<div class="lesson-foot">' +
      (prev ? '<a class="btn" href="#/lesson/' + prev.key + '">&larr; ' + esc(prev.lesson.title) + '</a>' : '') +
      '<span class="spacer"></span>' +
      '<label class="done-toggle"><input type="checkbox" id="done-box"' + (p.done ? ' checked' : '') + '> mark lesson complete</label>' +
      (nextL ? '<a class="btn primary" style="text-decoration:none" href="#/lesson/' + nextL.key + '">' + esc(nextL.lesson.title) + ' &rarr;</a>' : '') +
      '</div>';
    content.innerHTML = html;

    document.getElementById('done-box').onchange = function () {
      lp(entry.key).done = this.checked;
      save();
      renderSidebar();
      updateProgressPill();
    };
    wireRunnableBlocks(content);
    (l.exercises || []).forEach(function (ex, i) {
      document.getElementById('exercises').appendChild(buildExercise(entry, ex, i));
    });
    if (l.quiz && l.quiz.length) buildQuiz(entry, l.quiz);
  }

  function wireRunnableBlocks(root) {
    Array.prototype.forEach.call(root.querySelectorAll('figure.runnable'), function (fig) {
      var btn = fig.querySelector('[data-runsql]');
      var out = fig.querySelector('.code-out');
      var note = fig.querySelector('.code-note');
      btn.onclick = function () {
        var sql = fig.querySelector('code').textContent;
        var db = freshDb();
        try {
          var r = runScript(db, sql);
          out.innerHTML = r.last ? resultTable(r.last, 50) :
            '<div class="result-meta">no result set &middot; ' + r.changes + ' row(s) changed</div>';
          note.textContent = 'ran on a fresh copy of the database';
        } catch (e) {
          out.innerHTML = '<div class="err-box">' + esc(e.message) + '</div>';
          note.textContent = '';
        }
        db.close();
      };
    });
  }

  /* -------------------------------------------------------------- exercises */
  function buildExercise(entry, ex, idx) {
    var node = document.getElementById('tpl-exercise').content.firstElementChild.cloneNode(true);
    var p = lp(entry.key);
    var codeKey = entry.key + ':' + idx;
    node.querySelector('.ex-prompt').innerHTML = md(ex.prompt);
    if (ex.tag) node.querySelector('.ex-badge').textContent = ex.tag;
    var ta = node.querySelector('.editor');
    var gutter = node.querySelector('.gutter');
    ta.value = typeof state.code[codeKey] === 'string' ? state.code[codeKey] : (ex.starter || '');
    ta.rows = Math.max(4, ta.value.split('\n').length + 1);

    function syncGutter() {
      var n = ta.value.split('\n').length;
      var s = '';
      for (var i = 1; i <= Math.max(n, 4); i++) s += i + '\n';
      gutter.textContent = s;
      gutter.scrollTop = ta.scrollTop;
    }
    syncGutter();
    ta.addEventListener('input', function () {
      state.code[codeKey] = ta.value;
      save();
      syncGutter();
    });
    ta.addEventListener('scroll', function () { gutter.scrollTop = ta.scrollTop; });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
        syncGutter();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        act('check');
      }
    });

    var stateEl = node.querySelector('[data-state]');
    var fb = node.querySelector('[data-feedback]');
    var out = node.querySelector('[data-output]');
    var hintsShown = 0;

    if (p.ex[idx]) {
      node.classList.add('solved');
      stateEl.className = 'ex-state ok';
      stateEl.textContent = 'solved';
    }

    function feedback(kind, htmlStr) {
      fb.hidden = false;
      fb.className = 'ex-feedback ' + kind;
      fb.innerHTML = htmlStr;
    }

    function act(what) {
      if (what === 'reset') {
        ta.value = ex.starter || '';
        state.code[codeKey] = ta.value;
        save();
        syncGutter();
        fb.hidden = true;
        out.innerHTML = '';
        return;
      }
      if (what === 'hint') {
        var hints = ex.hints || [];
        if (!hints.length) { feedback('info', 'No hint for this one — try the solution button.'); return; }
        hintsShown = Math.min(hintsShown + 1, hints.length);
        feedback('info', '<strong>Hint ' + hintsShown + ' of ' + hints.length + '</strong>' +
          md(hints.slice(0, hintsShown).join('\n\n')));
        return;
      }
      if (what === 'solution') {
        feedback('info', '<strong>One correct solution</strong>' + md('~~~sql-static\n' + ex.solution.trim() + '\n~~~') +
          '<p style="margin:6px 0 0"><button class="btn subtle tiny" data-use-solution>Put it in the editor</button></p>');
        var useBtn = fb.querySelector('[data-use-solution]');
        if (useBtn) useBtn.onclick = function () {
          ta.value = ex.solution.trim();
          state.code[codeKey] = ta.value;
          save();
          syncGutter();
          ta.focus();
        };
        return;
      }

      var userSql = ta.value.trim();
      if (!userSql) { feedback('info', 'Write some SQL first.'); return; }
      var db = freshDb(), userRun, err = null;
      try {
        userRun = runScript(db, userSql);
      } catch (e) {
        err = e;
      }
      if (err) {
        db.close();
        stateEl.className = 'ex-state bad';
        stateEl.textContent = 'error';
        out.innerHTML = '<div class="err-box">' + esc(err.message) + '</div>';
        feedback('bad', 'SQLite rejected the statement. ' + explainError(err.message));
        return;
      }
      var actual = userRun.last;
      if (ex.check) {
        try { actual = runScript(db, ex.check).last; } catch (e2) {
          db.close();
          stateEl.className = 'ex-state bad';
          stateEl.textContent = 'error';
          feedback('bad', 'The grader could not inspect the database afterwards: <code>' + esc(e2.message) + '</code>');
          return;
        }
      }
      db.close();

      out.innerHTML = actual ? resultTable(actual) :
        '<div class="result-meta">no result set &middot; ' + userRun.changes + ' row(s) changed</div>';

      if (what === 'run') {
        feedback('info', 'Statement ran. Press <strong>Check answer</strong> when you want it graded.');
        return;
      }

      // required / forbidden patterns
      var reqFail = (ex.requireSql || []).filter(function (r) {
        return !new RegExp(r.pattern, 'i').test(userSql);
      });
      if (reqFail.length) {
        stateEl.className = 'ex-state bad';
        stateEl.textContent = 'not yet';
        feedback('bad', '<strong>Close, but the exercise asks for a specific tool.</strong><ul>' +
          reqFail.map(function (r) { return '<li>' + inline(esc(r.msg)) + '</li>'; }).join('') + '</ul>');
        return;
      }
      var forbidHit = (ex.forbidSql || []).filter(function (r) {
        return new RegExp(r.pattern, 'i').test(userSql);
      });
      if (forbidHit.length) {
        stateEl.className = 'ex-state bad';
        stateEl.textContent = 'not yet';
        feedback('bad', '<ul>' + forbidHit.map(function (r) { return '<li>' + inline(esc(r.msg)) + '</li>'; }).join('') + '</ul>');
        return;
      }

      var expected = null;
      if (ex.solution) {
        var sdb = freshDb();
        try {
          var sr = runScript(sdb, ex.solution);
          expected = ex.check ? runScript(sdb, ex.check).last : sr.last;
        } catch (e3) {
          feedback('bad', 'Internal: the reference solution failed (<code>' + esc(e3.message) + '</code>). Please report this lesson.');
          sdb.close();
          return;
        }
        sdb.close();
      }
      var orderMatters = typeof ex.orderMatters === 'boolean' ? ex.orderMatters
        : /order\s+by/i.test(ex.check || ex.solution || '');
      var cmp = compare(actual, expected, orderMatters);
      if (cmp.ok) {
        node.classList.add('solved');
        stateEl.className = 'ex-state ok';
        stateEl.textContent = 'solved';
        p.ex[idx] = true;
        save();
        renderSidebar();
        updateProgressPill();
        feedback('ok', '<strong>Correct.</strong> ' + md(ex.explain || 'Result matches the expected output.'));
      } else {
        stateEl.className = 'ex-state bad';
        stateEl.textContent = 'not yet';
        feedback('bad', '<strong>Not matching yet.</strong><ul>' +
          cmp.notes.map(function (n) { return '<li>' + inline(esc(n)) + '</li>'; }).join('') + '</ul>');
      }
    }

    Array.prototype.forEach.call(node.querySelectorAll('[data-act]'), function (b) {
      b.onclick = function () { act(b.getAttribute('data-act')); };
    });
    return node;
  }

  function explainError(msg) {
    var m = msg.toLowerCase();
    if (m.indexOf('no such column') >= 0) return 'Check the column name and the table alias — the playground lists every column.';
    if (m.indexOf('no such table') >= 0) return 'Check the table name (plural, lower case, e.g. <code>order_items</code>).';
    if (m.indexOf('syntax error') >= 0) return 'Usually a missing comma, an unbalanced parenthesis, or a keyword in the wrong clause order.';
    if (m.indexOf('misuse of aggregate') >= 0) return 'Aggregates cannot go in <code>WHERE</code>. Use <code>HAVING</code>, or wrap the query.';
    if (m.indexOf('ambiguous') >= 0) return 'Two joined tables share that column name — qualify it with a table alias.';
    return '';
  }

  /* --------------------------------------------------------------- quizzes */
  function buildQuiz(entry, quiz) {
    var p = lp(entry.key);
    var host = document.getElementById('quiz');
    var html = '<div class="quiz"><h3>Check your understanding</h3>';
    quiz.forEach(function (q, qi) {
      html += '<div class="quiz-q" data-q="' + qi + '"><p>' + inline(esc(q.q)) + '</p>';
      q.options.forEach(function (o, oi) {
        html += '<label class="quiz-opt" data-opt="' + oi + '"><input type="radio" name="q' + entry.li + '_' + qi +
          '" value="' + oi + '">' + inline(esc(o)) + '</label>';
      });
      html += '<p class="quiz-why" hidden></p></div>';
    });
    host.innerHTML = html + '</div>';

    quiz.forEach(function (q, qi) {
      var qEl = host.querySelector('[data-q="' + qi + '"]');
      function reveal(choice) {
        Array.prototype.forEach.call(qEl.querySelectorAll('.quiz-opt'), function (opt, oi) {
          opt.classList.toggle('right', oi === q.answer);
          opt.classList.toggle('wrong', oi === choice && choice !== q.answer);
          var input = opt.querySelector('input');
          input.checked = oi === choice;
        });
        var why = qEl.querySelector('.quiz-why');
        why.hidden = false;
        why.innerHTML = (choice === q.answer ? '&#10003; ' : '&#10007; ') + inline(esc(q.explain || ''));
      }
      Array.prototype.forEach.call(qEl.querySelectorAll('.quiz-opt'), function (opt, oi) {
        opt.onclick = function () {
          p.quiz[qi] = oi;
          save();
          reveal(oi);
        };
      });
      if (typeof p.quiz[qi] === 'number') reveal(p.quiz[qi]);
    });
  }

  /* ------------------------------------------------------------ playground */
  function renderPlayground() {
    content.innerHTML = '<h1 class="lesson-title">Playground</h1>' +
      '<p class="lede">A persistent scratch database. Anything you create here survives until you reset it or reload the page.</p>' +
      '<div class="exercise"><div class="editor-wrap"><div class="gutter"></div>' +
      '<textarea class="editor" id="pg-editor" spellcheck="false" style="min-height:190px"></textarea></div>' +
      '<div class="ex-actions"><button class="btn primary" id="pg-run">Run <kbd>Ctrl</kbd>+<kbd>&#8629;</kbd></button>' +
      '<button class="btn subtle" id="pg-reset">Reset database</button>' +
      '<span class="ex-state" id="pg-state"></span></div>' +
      '<div class="ex-output" id="pg-out"></div></div>' +
      '<h2>Starters</h2><div class="pill-row" id="pg-pills"></div>' +
      '<h2>Schema</h2><div id="pg-schema"></div>';

    var ta = document.getElementById('pg-editor');
    var gutter = content.querySelector('.gutter');
    ta.value = state.code['__playground'] || 'SELECT c.company_name, count(*) AS orders, round(sum(o.freight), 2) AS freight\nFROM customers c\nJOIN orders o ON o.customer_id = c.customer_id\nGROUP BY c.company_name\nORDER BY orders DESC\nLIMIT 10;';
    function syncGutter() {
      var n = ta.value.split('\n').length, s = '';
      for (var i = 1; i <= Math.max(n, 8); i++) s += i + '\n';
      gutter.textContent = s;
    }
    syncGutter();
    ta.addEventListener('input', function () { state.code['__playground'] = ta.value; save(); syncGutter(); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = ta.selectionStart;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });

    if (!playDb) playDb = freshDb();
    function run() {
      var out = document.getElementById('pg-out'), st = document.getElementById('pg-state');
      try {
        var r = runScript(playDb, ta.value);
        if (r.sets.length) {
          out.innerHTML = r.sets.map(function (s) { return resultTable(s, 500); }).join('<hr style="border:none;border-top:1px solid var(--line);margin:14px 0">');
        } else {
          out.innerHTML = '<div class="result-meta">no result set &middot; ' + r.changes + ' row(s) changed</div>';
        }
        st.className = 'ex-state ok';
        st.textContent = 'ok';
        renderSchemaInto(document.getElementById('pg-schema'), playDb);
      } catch (e) {
        out.innerHTML = '<div class="err-box">' + esc(e.message) + '</div>';
        st.className = 'ex-state bad';
        st.textContent = 'error';
      }
    }
    document.getElementById('pg-run').onclick = run;
    document.getElementById('pg-reset').onclick = function () {
      if (playDb) playDb.close();
      playDb = freshDb();
      document.getElementById('pg-out').innerHTML = '<div class="result-meta">database reset to its original state</div>';
    };

    var starters = [
      ['Everything about one order', 'SELECT o.*, c.company_name\nFROM orders o JOIN customers c USING (customer_id)\nWHERE o.order_id = 1001;'],
      ['Revenue by month', "SELECT strftime('%Y-%m', o.order_date) AS month,\n       round(sum(i.unit_price * i.quantity * (1 - i.discount)), 2) AS revenue\nFROM orders o JOIN order_items i USING (order_id)\nWHERE o.status <> 'cancelled'\nGROUP BY month ORDER BY month;"],
      ['Top products', 'SELECT p.product_name, sum(i.quantity) AS units\nFROM order_items i JOIN products p USING (product_id)\nGROUP BY p.product_name ORDER BY units DESC LIMIT 10;'],
      ['Org chart', "WITH RECURSIVE chart(emp_id, name, depth) AS (\n  SELECT emp_id, first_name || ' ' || last_name, 0\n  FROM employees WHERE manager_id IS NULL\n  UNION ALL\n  SELECT e.emp_id, substr('                ', 1, chart.depth * 2) || e.first_name || ' ' || e.last_name, chart.depth + 1\n  FROM employees e JOIN chart ON e.manager_id = chart.emp_id\n)\nSELECT name, depth FROM chart;"],
      ['List tables', "SELECT name, type FROM sqlite_master ORDER BY type, name;"],
      ['Table DDL', "SELECT sql FROM sqlite_master WHERE name = 'orders';"]
    ];
    document.getElementById('pg-pills').innerHTML = starters.map(function (s, i) {
      return '<button class="pill" data-starter="' + i + '">' + esc(s[0]) + '</button>';
    }).join('');
    Array.prototype.forEach.call(content.querySelectorAll('[data-starter]'), function (b) {
      b.onclick = function () {
        ta.value = starters[+b.getAttribute('data-starter')][1];
        state.code['__playground'] = ta.value;
        save();
        syncGutter();
        run();
      };
    });
    renderSchemaInto(document.getElementById('pg-schema'), playDb);
    run();
  }

  /* ------------------------------------------------------------- reference */
  function renderReference(section) {
    var secs = window.REFERENCE || [];
    var html = '<h1 class="lesson-title">Reference</h1><p class="lede">Cheat sheets, dialect differences and a glossary.</p>';
    html += '<div class="pill-row">' + secs.map(function (s) {
      return '<a class="pill" href="#/reference/' + s.id + '">' + esc(s.title) + '</a>';
    }).join('') + '</div>';
    var pick = secs.filter(function (s) { return s.id === section; })[0];
    (pick ? [pick] : secs).forEach(function (s) {
      html += '<h2 id="' + s.id + '">' + esc(s.title) + '</h2><div class="prose">' + md(s.body) + '</div>';
    });
    content.innerHTML = html;
    wireRunnableBlocks(content);
  }

  /* ---------------------------------------------------------------- search */
  function setupSearch() {
    var input = document.getElementById('search');
    var box = document.getElementById('search-results');
    var docs = lessonIndex.map(function (e) {
      return { e: e, text: (e.lesson.title + ' ' + (e.lesson.lede || '') + ' ' + (e.lesson.body || '')).toLowerCase() };
    });
    function run() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { box.hidden = true; return; }
      var terms = q.split(/\s+/);
      var hits = docs.map(function (d) {
        var score = 0;
        terms.forEach(function (t) {
          if (d.e.lesson.title.toLowerCase().indexOf(t) >= 0) score += 10;
          var n = d.text.split(t).length - 1;
          score += Math.min(n, 6);
        });
        return { d: d, score: score };
      }).filter(function (h) { return h.score > 0; })
        .sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
      box.innerHTML = hits.length ? hits.map(function (h) {
        return '<a href="#/lesson/' + h.d.e.key + '"><span class="sr-mod">' + esc(h.d.e.mod.title) + '</span>' +
          esc(h.d.e.lesson.title) + '</a>';
      }).join('') : '<div class="sr-empty">Nothing found.</div>';
      box.hidden = false;
    }
    input.addEventListener('input', run);
    input.addEventListener('focus', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { box.hidden = true; input.blur(); }
      if (e.key === 'Enter') {
        var first = box.querySelector('a');
        if (first) { location.hash = first.getAttribute('href').slice(1); box.hidden = true; input.blur(); }
      }
    });
    document.addEventListener('click', function (e) {
      if (!box.contains(e.target) && e.target !== input) box.hidden = true;
    });
  }

  /* ------------------------------------------------------------------ boot */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
  }

  function start() {
    content = document.getElementById('content');
    sidebar = document.getElementById('sidebar');
    document.querySelector('.topbar').hidden = false;
    document.querySelector('.layout').hidden = false;
    document.getElementById('boot').remove();

    document.getElementById('theme-btn').onclick = function () {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      save();
      applyTheme();
    };
    document.getElementById('menu-btn').onclick = function () {
      document.body.classList.toggle('nav-closed');
    };
    window.addEventListener('hashchange', render);
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('search').focus();
        document.getElementById('search').select();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        document.body.classList.toggle('nav-closed');
      }
    });
    setupSearch();
    render();
  }

  function fail(msg) {
    var el = document.getElementById('boot-msg');
    if (el) {
      el.innerHTML = '<strong>Could not start.</strong><br>' + esc(msg);
      document.querySelector('.spinner').style.display = 'none';
    }
  }

  // Exposed so tools/render-test.mjs can exercise the renderer outside a browser.
  window.__courseInternals = { md: md, inline: inline, highlight: highlight, esc: esc, compare: compare };

  applyTheme();
  if (typeof initSqlJs !== 'function') {
    fail('js/vendor/sql-wasm.js did not load.');
    return;
  }
  initSqlJs({ locateFile: function (f) { return 'js/vendor/' + f; } })
    .then(function (sqlNs) {
      SQL = sqlNs;
      document.getElementById('boot-msg').textContent = 'Building the practice database…';
      var db = new SQL.Database();
      db.run(window.SEED_SQL);
      SNAPSHOT = db.export();
      db.close();
      start();
    })
    .catch(function (e) {
      fail(e && e.message ? e.message :
        'The WebAssembly engine failed to load. If you opened this file directly, some browsers block WASM over file:// — serve the folder with "python3 -m http.server" instead.');
    });
})();
