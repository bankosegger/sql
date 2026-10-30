// Unit-tests the answer comparator used to grade exercises.
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url).pathname;
const stub = { setAttribute() {}, classList: { toggle() {} }, style: {}, remove() {}, focus() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
const sandbox = {
  window: { addEventListener() {} },
  document: { documentElement: stub, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  location: { hash: '' }, setTimeout: () => 0, clearTimeout() {}, console
};
vm.createContext(sandbox);
for (const f of readdirSync(root + 'js/curriculum').sort()) vm.runInContext(readFileSync(root + 'js/curriculum/' + f, 'utf8'), sandbox, { filename: f });
vm.runInContext(readFileSync(root + 'js/app.js', 'utf8'), sandbox, { filename: 'app.js' });
const { compare } = sandbox.window.__courseInternals;

const set = (cols, values) => ({ columns: cols, values });
let failed = 0;
function t(name, got, want) {
  const ok = got === want;
  if (!ok) { failed++; console.log(`FAIL ${name}: expected ${want}, got ${got}`); }
  else console.log(`ok   ${name}`);
}

t('identical sets match',
  compare(set(['a'], [[1], [2]]), set(['a'], [[1], [2]]), false).ok, true);

t('column names are not graded',
  compare(set(['whatever'], [[1]]), set(['a'], [[1]]), false).ok, true);

t('column count mismatch fails',
  compare(set(['a', 'b'], [[1, 2]]), set(['a'], [[1]]), false).ok, false);

t('row order ignored when order does not matter',
  compare(set(['a'], [[2], [1]]), set(['a'], [[1], [2]]), false).ok, true);

t('row order enforced when it matters',
  compare(set(['a'], [[2], [1]]), set(['a'], [[1], [2]]), true).ok, false);

t('missing row fails',
  compare(set(['a'], [[1]]), set(['a'], [[1], [2]]), false).ok, false);

t('extra row fails',
  compare(set(['a'], [[1], [2], [3]]), set(['a'], [[1], [2]]), false).ok, false);

t('duplicate counts are compared',
  compare(set(['a'], [[1], [1]]), set(['a'], [[1]]), false).ok, false);

t('NULL equals NULL',
  compare(set(['a'], [[null]]), set(['a'], [[null]]), false).ok, true);

t('NULL does not equal 0',
  compare(set(['a'], [[null]]), set(['a'], [[0]]), false).ok, false);

t('float noise within 1e-6 is tolerated',
  compare(set(['a'], [[0.1 + 0.2]]), set(['a'], [[0.3]]), false).ok, true);

t('real differences beyond 1e-6 fail',
  compare(set(['a'], [[0.3001]]), set(['a'], [[0.3]]), false).ok, false);

t('integer and its float form match',
  compare(set(['a'], [[3]]), set(['a'], [[3.0]]), false).ok, true);

t('number 3 does not match text "x"',
  compare(set(['a'], [[3]]), set(['a'], [['x']]), false).ok, false);

t('empty result matches empty expectation',
  compare(set(['a'], []), set(['a'], []), false).ok, true);

t('no result set at all fails',
  compare(null, set(['a'], [[1]]), false).ok, false);

t('multi-column rows compared as tuples',
  compare(set(['a', 'b'], [[1, 'x'], [2, 'y']]), set(['a', 'b'], [[2, 'y'], [1, 'x']]), false).ok, true);

t('swapped values inside a row fail',
  compare(set(['a', 'b'], [[1, 2]]), set(['a', 'b'], [[2, 1]]), false).ok, false);

console.log(`\n${failed} failures`);
process.exit(failed ? 1 : 0);
