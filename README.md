# SQL, end to end — an interactive course

A self-contained SQL course that runs entirely in the browser. SQLite is compiled to WebAssembly, so
every example and every exercise executes against a real database in the page — no server, no account,
no network after the first load.

**15 modules · 86 lessons · 204 graded exercises · 307 runnable examples.**

## Run it

```sh
python3 -m http.server 8080      # then open http://127.0.0.1:8080
```

Some browsers refuse WebAssembly over `file://`, so serve the folder rather than double-clicking
`index.html`.

## What it covers

| Module | Topics |
| --- | --- |
| 01 Foundations | relational model, `SELECT`, `FROM`, `DISTINCT`, `ORDER BY`, `LIMIT`, clause/evaluation order |
| 02 Filtering | `WHERE`, boolean precedence, `BETWEEN`/`IN`, `LIKE`/`GLOB`, three-valued logic, `COALESCE`/`NULLIF` |
| 03 Types & expressions | type affinity, `CAST`, numeric pitfalls, strings, dates, `CASE`, data cleaning |
| 04 Aggregation | aggregates, `GROUP BY`, `HAVING`, `FILTER`, conditional aggregation, patterns |
| 05 Joins | cross, inner, left, right, full, self, multi-table fan-out, non-equi and range joins |
| 06 Set operations | `UNION`/`ALL`, `INTERSECT`, `EXCEPT`, dataset reconciliation |
| 07 Subqueries & CTEs | scalar, `IN`, `EXISTS`, correlation, derived tables, `WITH`, recursion |
| 08 Window functions | `OVER`/`PARTITION BY`, ranking, `LAG`/`LEAD`, frames, percentiles, patterns |
| 09 DDL | `CREATE TABLE`, keys, constraints, foreign keys, `ALTER`, temp tables, generated columns |
| 10 DML | `INSERT`, `UPDATE`, `DELETE`, upsert/`ON CONFLICT`, `RETURNING`, safe habits |
| 11 Objects & safety | views, transactions/ACID, isolation levels, locking, triggers, stored routines, privileges, injection |
| 12 Schema design | ER modelling, 1NF–BCNF, denormalisation and star schemas, anti-patterns, conventions |
| 13 Performance | execution model, indexes, reading plans, SARGability, tuning patterns |
| 14 Advanced patterns | pivot/unpivot, `ROLLUP` emulation, JSON, text search, gaps and islands, time series, cohorts, portability |
| 15 Capstone | five analytics problems, a schema built from a written requirement, recap |

Plus a **Playground** (persistent scratch database with a schema browser) and a **Reference** section
(statement skeletons, functions by task, dialect differences, common errors, glossary).

Dialect differences between SQLite, PostgreSQL, MySQL, SQL Server and Oracle are called out in the
lessons where they matter.

## How grading works

Your SQL runs on a fresh copy of the practice database; the reference solution runs on another; the
result sets are compared. So **any correct query is accepted**, not just the expected phrasing.

- Column names are not graded — values and column count are.
- Row order is graded only where the exercise is about ordering.
- DDL/DML exercises are graded by a verification query against the resulting schema or data.
- A few exercises additionally require a specific construct (a window function, `EXISTS`, `FILTER`, …)
  when that construct is the point of the lesson.

Progress, quiz answers and editor contents live in `localStorage` (`sqlcourse.v1`). Nothing is uploaded.

## The practice database

A small hardware reseller: `departments`, `employees` (5-level management hierarchy), `categories`,
`suppliers`, `products`, `customers`, `orders`, `order_items`, `payments`, `reviews`, `logins`,
`staging_customers`, `product_specs`.

It is seeded with deliberate quirks so the exercises have something to find: customers without orders,
products never ordered, unshipped and unpaid orders, NULL commissions and departments, salary ties,
historical prices that differ from catalogue prices, duplicated import rows, login streaks with gaps,
and JSON documents.

## Layout

```
index.html                 app shell
css/app.css
js/app.js                  runtime: markdown renderer, SQL runner, grader, router, progress
js/seed.js                 generated practice database (do not edit by hand)
js/curriculum/*.js         the lessons, as data
js/reference.js            reference section
js/vendor/sql-wasm.{js,wasm}   SQLite 3.45 compiled to WebAssembly (sql.js 1.11)
tools/gen_seed.py          regenerates js/seed.js
tools/collect.mjs          extracts every SQL snippet in the course to JSON
tools/validate.py          runs all of it against SQLite and reports problems
tools/render-test.mjs      renders every markdown block and checks the output
tools/grading-test.mjs     unit tests for the answer comparator
```

## Tests

```sh
node tools/collect.mjs /tmp/items.json && python3 tools/validate.py /tmp/items.json
node tools/render-test.mjs
node tools/grading-test.mjs
```

`validate.py` executes **every** example and **every** reference solution against SQLite and reports
syntax errors, exercises that return no rows, solutions that contradict their own `requireSql` rules,
and queries whose row order or row set is not deterministic (it re-runs them with
`PRAGMA reverse_unordered_selects`).

## Extending it

A lesson is plain data:

```js
{
  id: 'left-join',
  title: 'LEFT JOIN and anti-joins',
  lede: 'One sentence shown under the title.',
  body: `markdown; ~~~sql fences become runnable examples, :::tip blocks become callouts`,
  exercises: [{
    prompt: 'markdown',
    starter: 'SELECT ',
    solution: 'SELECT ...',          // the grader runs this, so any equivalent answer passes
    check: 'SELECT ...',             // optional: for DDL/DML, inspect the database afterwards
    orderMatters: true,              // optional: defaults to true when the solution has ORDER BY
    requireSql: [{ pattern: 'left\\s+join', msg: 'shown when the pattern is missing' }],
    hints: ['markdown'], explain: 'shown on success'
  }],
  quiz: [{ q: '…', options: ['…'], answer: 1, explain: '…' }]
}
```

Add the file to `js/curriculum/`, add a `<script>` tag in `index.html`, and run the tests.
To reshape the dataset, edit `tools/gen_seed.py` and re-run it.
