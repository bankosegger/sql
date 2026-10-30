// Extracts every piece of SQL in the course to JSON so tools/validate.py can run it.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const dir = new URL('../js/curriculum/', import.meta.url).pathname;
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of readdirSync(dir).sort()) {
  if (f.endsWith('.js')) vm.runInContext(readFileSync(dir + f, 'utf8'), sandbox, { filename: f });
}
const ref = new URL('../js/reference.js', import.meta.url).pathname;
try { vm.runInContext(readFileSync(ref, 'utf8'), sandbox, { filename: 'reference.js' }); } catch (e) {}

const items = [];
const seenIds = new Map();
function blocks(body, where) {
  const re = /~~~sql[ \t]*\n([\s\S]*?)\n[ \t]*~~~/g;
  let m;
  while ((m = re.exec(body || ''))) items.push({ kind: 'example', where, sql: m[1] });
}
for (const mod of sandbox.window.CURRICULUM || []) {
  for (const l of mod.lessons) {
    const key = `${mod.id}/${l.id}`;
    if (seenIds.has(key)) items.push({ kind: 'dup', where: key, sql: 'SELECT 1' });
    seenIds.set(key, true);
    blocks(l.body, key);
    (l.exercises || []).forEach((ex, i) => {
      items.push({
        kind: 'exercise', where: `${key}#${i}`, sql: ex.solution,
        check: ex.check || null, starter: ex.starter || '',
        orderMatters: typeof ex.orderMatters === 'boolean' ? ex.orderMatters : /order\s+by/i.test(ex.check || ex.solution || ''),
        requireSql: (ex.requireSql || []).map(r => r.pattern),
        hasHints: (ex.hints || []).length > 0, hasPrompt: !!ex.prompt, allowEmpty: !!ex.allowEmpty
      });
    });
    (l.quiz || []).forEach((q, i) => {
      if (typeof q.answer !== 'number' || !q.options || q.answer >= q.options.length) {
        items.push({ kind: 'badquiz', where: `${key}?${i}`, sql: 'SELECT 1' });
      }
    });
  }
}
for (const s of sandbox.window.REFERENCE || []) blocks(s.body, 'reference/' + s.id);

const stats = {
  modules: (sandbox.window.CURRICULUM || []).length,
  lessons: (sandbox.window.CURRICULUM || []).reduce((a, m) => a + m.lessons.length, 0),
  exercises: items.filter(i => i.kind === 'exercise').length,
  examples: items.filter(i => i.kind === 'example').length
};
writeFileSync(process.argv[2] || '/tmp/sqlcourse-items.json', JSON.stringify({ stats, items }, null, 1));
console.log(JSON.stringify(stats));
