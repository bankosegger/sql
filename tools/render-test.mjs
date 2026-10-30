// Renders every lesson body, prompt, hint and reference page through the course's
// Markdown renderer and checks the output for unclosed markup.
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url).pathname;
const stubEl = { setAttribute() {}, textContent: '', innerHTML: '', style: {}, classList: { toggle() {}, add() {} }, focus() {}, remove() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], onclick: null };
const sandbox = {
  window: {},
  document: {
    documentElement: stubEl,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => stubEl
  },
  localStorage: { getItem: () => null, setItem() {} },
  location: { hash: '' },
  setTimeout: () => 0,
  clearTimeout() {},
  console
};
sandbox.window.addEventListener = () => {};
vm.createContext(sandbox);

for (const f of readdirSync(root + 'js/curriculum').sort()) {
  vm.runInContext(readFileSync(root + 'js/curriculum/' + f, 'utf8'), sandbox, { filename: f });
}
vm.runInContext(readFileSync(root + 'js/reference.js', 'utf8'), sandbox, { filename: 'reference.js' });
vm.runInContext(readFileSync(root + 'js/app.js', 'utf8'), sandbox, { filename: 'app.js' });

const { md } = sandbox.window.__courseInternals;
const problems = [];
let rendered = 0;

function tags(html, tag) {
  const open = (html.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
  const close = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  return open === close ? null : `${tag}: ${open} open vs ${close} closed`;
}

function check(where, src) {
  if (!src) return;
  rendered++;
  let html;
  try {
    html = md(src);
  } catch (e) {
    problems.push(`[render-threw] ${where}: ${e.message}`);
    return;
  }
  if (html.includes('~~~')) problems.push(`[unclosed-fence] ${where}`);
  if (/^:::|\n:::/.test(html)) problems.push(`[unclosed-callout] ${where}`);
  if (/\*\*[^*<]{1,60}\*\*/.test(html)) problems.push(`[unconverted-bold] ${where}`);
  if (html.includes('&amp;lt;') || html.includes('&amp;amp;')) problems.push(`[double-escaped] ${where}`);
  for (const t of ['figure', 'pre', 'code', 'table', 'ul', 'ol', 'li', 'p', 'div', 'blockquote', 'strong']) {
    const bad = tags(html, t);
    if (bad) problems.push(`[unbalanced] ${where} ${bad}`);
  }
}

const seen = new Set();
for (const mod of sandbox.window.CURRICULUM) {
  if (!mod.id || !mod.title || !mod.blurb) problems.push(`[module-meta] ${mod.id}`);
  for (const l of mod.lessons) {
    const where = `${mod.id}/${l.id}`;
    if (seen.has(where)) problems.push(`[duplicate-id] ${where}`);
    seen.add(where);
    if (!l.title || !l.lede) problems.push(`[lesson-meta] ${where}`);
    check(where, l.body);
    (l.exercises || []).forEach((ex, i) => {
      check(`${where}#${i}.prompt`, ex.prompt);
      (ex.hints || []).forEach((h, k) => check(`${where}#${i}.hint${k}`, h));
      if (ex.explain) check(`${where}#${i}.explain`, ex.explain);
    });
  }
}
for (const s of sandbox.window.REFERENCE) check('reference/' + s.id, s.body);
check('intro', sandbox.window.COURSE_INTRO);

console.log(`rendered ${rendered} markdown blocks from ${seen.size} lessons`);
for (const p of problems) console.log('PROBLEM ' + p);
console.log(`${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
