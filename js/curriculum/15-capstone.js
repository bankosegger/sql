(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'capstone',
  title: 'Capstone',
  blurb: 'Hard, realistic problems that combine everything — plus where to go next.',
  lessons: [

    {
      id: 'capstone-analytics',
      title: 'Capstone: analytics',
      lede: 'Five business questions with no hand-holding. Each needs several of the techniques from the course.',
      body: `
        ## How to approach these
        1. **Say the grain out loud.** "One row per product per category" tells you what to group by.
        2. **Work outwards.** Get the innermost fact set right, check it with \`LIMIT 20\`, then wrap it.
        3. **Name your steps** with CTEs. A six-line CTE you can inspect beats a clever nested subquery.
        4. **Check the arithmetic.** Does revenue match when you compute it a different way? Did a join
           multiply your rows?

        Hints and solutions are there if you want them — but try to get the shape right before you look.

        ~~~sql
        -- a reminder of the tables you have
        SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;
        ~~~
      `,
      exercises: [
        {
          tag: 'Capstone',
          prompt: '**Top sellers per category.** For each category, return the 3 products with the highest revenue (non-cancelled orders only): `category_name`, `product_name`, `revenue` (rounded to 2) and `rank_in_category` (1–3). Order by `category_name`, then `rank_in_category`. Break revenue ties with the lower `product_id`.',
          starter: 'WITH product_revenue AS (\n  \n)\nSELECT ',
          solution: "WITH product_revenue AS (\n  SELECT p.product_id, p.product_name, cat.category_name,\n         sum(i.unit_price * i.quantity * (1 - i.discount)) AS revenue\n  FROM order_items i\n  JOIN orders o       ON o.order_id = i.order_id\n  JOIN products p     ON p.product_id = i.product_id\n  JOIN categories cat ON cat.category_id = p.category_id\n  WHERE o.status <> 'cancelled'\n  GROUP BY p.product_id, p.product_name, cat.category_name\n),\nranked AS (\n  SELECT category_name, product_name, revenue, product_id,\n         ROW_NUMBER() OVER (PARTITION BY category_name ORDER BY revenue DESC, product_id) AS rank_in_category\n  FROM product_revenue\n)\nSELECT category_name, product_name, round(revenue, 2) AS revenue, rank_in_category\nFROM ranked\nWHERE rank_in_category <= 3\nORDER BY category_name, rank_in_category;",
          orderMatters: true,
          hints: ['Step 1: revenue per product, with its category name.', 'Step 2: `ROW_NUMBER() OVER (PARTITION BY category_name ORDER BY revenue DESC, product_id)`.', 'Step 3: keep ranks 1–3 and round for display.'],
          explain: 'Aggregate, then rank within partitions, then filter — the top-N-per-group pattern on top of a join.'
        },
        {
          tag: 'Capstone',
          prompt: '**Customers above the average order value.** Return `company_name`, `orders` (non-cancelled), `avg_order_value` (rounded to 2) for every customer whose average order value exceeds the **overall** average order value across all non-cancelled orders. Order by `avg_order_value` descending, then `company_name`.',
          starter: '',
          solution: "WITH order_totals AS (\n  SELECT o.order_id, o.customer_id,\n         sum(i.unit_price * i.quantity * (1 - i.discount)) AS order_total\n  FROM orders o\n  JOIN order_items i ON i.order_id = o.order_id\n  WHERE o.status <> 'cancelled'\n  GROUP BY o.order_id, o.customer_id\n),\nper_customer AS (\n  SELECT customer_id, count(*) AS orders, avg(order_total) AS avg_order_value\n  FROM order_totals\n  GROUP BY customer_id\n)\nSELECT c.company_name, pc.orders, round(pc.avg_order_value, 2) AS avg_order_value\nFROM per_customer pc\nJOIN customers c ON c.customer_id = pc.customer_id\nWHERE pc.avg_order_value > (SELECT avg(order_total) FROM order_totals)\nORDER BY avg_order_value DESC, c.company_name;",
          orderMatters: true,
          hints: ['Three grains: per order, per customer, and the single overall average.', 'The overall average is `avg(order_total)` over the per-order CTE — not the average of the per-customer averages.'],
          explain: 'Note the trap this avoids: averaging the per-customer averages would weight a one-order customer the same as a forty-order customer.'
        },
        {
          tag: 'Capstone',
          prompt: '**Sales rep leaderboard.** For each employee who handled at least one order, return `last_name`, `orders` (all orders), `revenue` (rounded to 2, non-cancelled only, 0 if none), `cancel_rate` (cancelled / all orders, rounded to 3) and `revenue_rank` (1 = highest revenue). Order by `revenue_rank`.',
          starter: '',
          solution: "WITH order_value AS (\n  SELECT o.order_id, o.emp_id, o.status,\n         COALESCE((SELECT sum(i.unit_price * i.quantity * (1 - i.discount))\n                   FROM order_items i WHERE i.order_id = o.order_id), 0) AS order_total\n  FROM orders o\n),\nper_emp AS (\n  SELECT emp_id,\n         count(*) AS orders,\n         sum(CASE WHEN status <> 'cancelled' THEN order_total ELSE 0 END) AS revenue,\n         sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled\n  FROM order_value\n  GROUP BY emp_id\n)\nSELECT e.last_name,\n       pe.orders,\n       round(pe.revenue, 2) AS revenue,\n       round(1.0 * pe.cancelled / pe.orders, 3) AS cancel_rate,\n       ROW_NUMBER() OVER (ORDER BY pe.revenue DESC) AS revenue_rank\nFROM per_emp pe\nJOIN employees e ON e.emp_id = pe.emp_id\nORDER BY revenue_rank;",
          orderMatters: true,
          hints: ['Get one row per order with its total first — a correlated subquery or a pre-aggregated join both work.', 'Then conditional aggregation gives revenue and the cancellation count in one pass.', 'Rank with a window function over the per-employee aggregate.'],
          explain: 'Pre-aggregating the order total avoids the fan-out that would otherwise inflate both the order count and the cancel rate.'
        },
        {
          tag: 'Capstone',
          prompt: '**Underreviewed bestsellers.** Return the products with at least 40 units sold but fewer than 2 reviews: `product_name`, `units` (total quantity), `reviews` (count, 0 allowed) and `avg_rating` (rounded to 2, NULL if none). Order by `units` descending, then `product_name`.',
          starter: '',
          solution: 'WITH sales AS (\n  SELECT product_id, sum(quantity) AS units FROM order_items GROUP BY product_id\n),\nrev AS (\n  SELECT product_id, count(*) AS reviews, avg(rating) AS avg_rating FROM reviews GROUP BY product_id\n)\nSELECT p.product_name,\n       s.units,\n       COALESCE(r.reviews, 0) AS reviews,\n       round(r.avg_rating, 2) AS avg_rating\nFROM sales s\nJOIN products p ON p.product_id = s.product_id\nLEFT JOIN rev r ON r.product_id = s.product_id\nWHERE s.units >= 40 AND COALESCE(r.reviews, 0) < 2\nORDER BY s.units DESC, p.product_name;',
          orderMatters: true,
          hints: ['Two independent child aggregates: sales and reviews. Pre-aggregate both, then join.', '`LEFT JOIN` the reviews so products with none survive, and `COALESCE` the count to 0.'],
          explain: 'Summing two child tables in one join would have double-counted both measures — pre-aggregation is what keeps it correct.'
        },
        {
          tag: 'Capstone',
          prompt: '**Monthly growth, gap-free.** For every month from `2024-01` to `2025-09`, return `month`, `revenue` (non-cancelled, rounded to 2, 0 for empty months) and `mom_pct` — month-over-month growth in percent rounded to 1, NULL for the first month and guarded against a zero denominator. Order by `month`.',
          starter: '',
          solution: "WITH RECURSIVE months(m) AS (\n  SELECT '2024-01'\n  UNION ALL\n  SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM months WHERE m < '2025-09'\n),\nlines AS (\n  SELECT strftime('%Y-%m', o.order_date) AS m,\n         i.unit_price * i.quantity * (1 - i.discount) AS line_total\n  FROM orders o\n  JOIN order_items i ON i.order_id = o.order_id\n  WHERE o.status <> 'cancelled'\n),\nmonthly AS (\n  SELECT months.m AS month,\n         COALESCE(sum(lines.line_total), 0) AS revenue\n  FROM months LEFT JOIN lines ON lines.m = months.m\n  GROUP BY months.m\n)\nSELECT month,\n       round(revenue, 2) AS revenue,\n       round(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month))\n             / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1) AS mom_pct\nFROM monthly\nORDER BY month;",
          orderMatters: true,
          hints: ['Spine of months first, so `LAG` compares adjacent calendar months rather than adjacent rows that have data.', 'Then a windowed `LAG` over the gap-free series, with `NULLIF` on the denominator.'],
          explain: 'Spine, aggregate, compare: the three steps of nearly every time-series report.'
        }
      ]
    },

    {
      id: 'capstone-modelling',
      title: 'Capstone: design and load a schema',
      lede: 'Design a returns process from a written requirement, enforce its rules, and report on it.',
      body: `
        ## The requirement
        > Customers may return items they have ordered. A **return** refers to exactly one order line
        > (an order and a product that appear together in \`order_items\`). It records the quantity
        > returned, a reason from a fixed list (\`damaged\`, \`wrong_item\`, \`not_needed\`, \`faulty\`),
        > the date it was requested, and an optional refund amount. The same order line may be returned
        > more than once (partial returns), but never twice on the same date. A return's quantity must be
        > positive. If an order is deleted, its returns go with it.

        ## What to decide
        - **Grain and key.** One row per return. A surrogate \`return_id\`, plus a \`UNIQUE\` constraint
          expressing "never twice on the same date".
        - **References.** The parent is the *order line*, whose key is the pair
          (\`order_id\`, \`product_id\`) — so the foreign key is composite.
        - **Constraints.** \`NOT NULL\` on everything required, a \`CHECK\` on the quantity, and a
          \`CHECK\` on the reason list (a lookup table would be the alternative — module 12).
        - **Cascade.** \`ON DELETE CASCADE\`, because a return has no meaning without its order line.

        The exercises below build it step by step. There is more than one defensible design; the grader
        checks the behaviour, not your formatting.
      `,
      exercises: [
        {
          tag: 'Capstone',
          prompt: 'Create the `returns` table from the requirement:\n\n- `return_id` INTEGER primary key\n- `order_id` and `product_id`, both INTEGER not null, together referencing `order_items(order_id, product_id)` with `ON DELETE CASCADE`\n- `quantity` INTEGER not null, must be positive\n- `reason` TEXT not null, restricted to `damaged`, `wrong_item`, `not_needed`, `faulty`\n- `requested_on` TEXT not null\n- `refund_amount` NUMERIC (nullable)\n- a `UNIQUE` constraint on (`order_id`, `product_id`, `requested_on`)\n\nThen insert one valid return: order 1002, product 21 — check the playground if you want a real order line — quantity 1, reason `damaged`, date `2025-10-01`, refund 19.0. Use an existing order line from `order_items`.',
          starter: 'CREATE TABLE returns (\n  \n);\n\nINSERT INTO returns (order_id, product_id, quantity, reason, requested_on, refund_amount)\nSELECT order_id, product_id, 1, \'damaged\', \'2025-10-01\', 19.0\nFROM order_items ORDER BY order_id, product_id LIMIT 1;',
          solution: "CREATE TABLE returns (\n  return_id     INTEGER PRIMARY KEY,\n  order_id      INTEGER NOT NULL,\n  product_id    INTEGER NOT NULL,\n  quantity      INTEGER NOT NULL CHECK (quantity > 0),\n  reason        TEXT    NOT NULL CHECK (reason IN ('damaged', 'wrong_item', 'not_needed', 'faulty')),\n  requested_on  TEXT    NOT NULL,\n  refund_amount NUMERIC,\n  UNIQUE (order_id, product_id, requested_on),\n  FOREIGN KEY (order_id, product_id) REFERENCES order_items (order_id, product_id) ON DELETE CASCADE\n);\n\nINSERT INTO returns (order_id, product_id, quantity, reason, requested_on, refund_amount)\nSELECT order_id, product_id, 1, 'damaged', '2025-10-01', 19.0\nFROM order_items ORDER BY order_id, product_id LIMIT 1;",
          check: "SELECT (SELECT count(*) FROM returns) AS rows_loaded,\n       (SELECT count(*) FROM pragma_table_info('returns')) AS columns,\n       (SELECT count(*) FROM pragma_foreign_key_list('returns')) AS fk_columns,\n       (SELECT on_delete FROM pragma_foreign_key_list('returns') LIMIT 1) AS fk_action,\n       (SELECT count(*) FROM pragma_index_list('returns')) AS indexes;",
          hints: ['A composite foreign key must be a table-level constraint: `FOREIGN KEY (a, b) REFERENCES t (a, b)`.', 'Two CHECK constraints: one on quantity, one on the reason list.', 'The UNIQUE constraint covers three columns.'],
          explain: 'Every sentence of the requirement became a constraint — the schema now rejects the data the business says is impossible.'
        },
        {
          tag: 'Capstone',
          prompt: 'Prove the constraints work. Recreate the same `returns` table, insert the valid return (order 1002 / product 21 style — again take the first order line), then attempt three invalid inserts with `INSERT OR IGNORE`: quantity 0, reason `\'stolen\'`, and a duplicate of the valid row’s (order, product, date). Only one row may remain.',
          starter: '',
          solution: "CREATE TABLE returns (\n  return_id     INTEGER PRIMARY KEY,\n  order_id      INTEGER NOT NULL,\n  product_id    INTEGER NOT NULL,\n  quantity      INTEGER NOT NULL CHECK (quantity > 0),\n  reason        TEXT    NOT NULL CHECK (reason IN ('damaged', 'wrong_item', 'not_needed', 'faulty')),\n  requested_on  TEXT    NOT NULL,\n  refund_amount NUMERIC,\n  UNIQUE (order_id, product_id, requested_on),\n  FOREIGN KEY (order_id, product_id) REFERENCES order_items (order_id, product_id) ON DELETE CASCADE\n);\n\nINSERT INTO returns (order_id, product_id, quantity, reason, requested_on, refund_amount)\nSELECT order_id, product_id, 1, 'damaged', '2025-10-01', 19.0\nFROM order_items ORDER BY order_id, product_id LIMIT 1;\n\nINSERT OR IGNORE INTO returns (order_id, product_id, quantity, reason, requested_on)\nSELECT order_id, product_id, 0, 'damaged', '2025-10-02' FROM order_items ORDER BY order_id, product_id LIMIT 1;\n\nINSERT OR IGNORE INTO returns (order_id, product_id, quantity, reason, requested_on)\nSELECT order_id, product_id, 1, 'stolen', '2025-10-03' FROM order_items ORDER BY order_id, product_id LIMIT 1;\n\nINSERT OR IGNORE INTO returns (order_id, product_id, quantity, reason, requested_on)\nSELECT order_id, product_id, 2, 'faulty', '2025-10-01' FROM order_items ORDER BY order_id, product_id LIMIT 1;",
          check: 'SELECT count(*) AS rows_kept, min(quantity) AS qty, min(reason) AS reason FROM returns;',
          hints: ['`INSERT OR IGNORE` converts each constraint violation into a skipped row.', 'All three bad rows must be rejected by a different constraint.'],
          explain: 'One row survives: the CHECKs caught the bad quantity and the bad reason, and the UNIQUE constraint caught the duplicate.'
        },
        {
          tag: 'Capstone',
          prompt: 'Report on returns. Create the table (as before), load a return for **every** order line of cancelled orders (quantity 1, reason `\'not_needed\'`, `requested_on` = the order date, no refund), then return a summary: `reason`, `returns` (count), `units` (sum of quantity) and `distinct_orders`, ordered by `reason`.',
          starter: '',
          solution: "CREATE TABLE returns (\n  return_id     INTEGER PRIMARY KEY,\n  order_id      INTEGER NOT NULL,\n  product_id    INTEGER NOT NULL,\n  quantity      INTEGER NOT NULL CHECK (quantity > 0),\n  reason        TEXT    NOT NULL CHECK (reason IN ('damaged', 'wrong_item', 'not_needed', 'faulty')),\n  requested_on  TEXT    NOT NULL,\n  refund_amount NUMERIC,\n  UNIQUE (order_id, product_id, requested_on),\n  FOREIGN KEY (order_id, product_id) REFERENCES order_items (order_id, product_id) ON DELETE CASCADE\n);\n\nINSERT INTO returns (order_id, product_id, quantity, reason, requested_on)\nSELECT i.order_id, i.product_id, 1, 'not_needed', o.order_date\nFROM order_items i\nJOIN orders o ON o.order_id = i.order_id\nWHERE o.status = 'cancelled';\n\nSELECT reason, count(*) AS returns, sum(quantity) AS units, count(DISTINCT order_id) AS distinct_orders\nFROM returns\nGROUP BY reason\nORDER BY reason;",
          hints: ['`INSERT ... SELECT` from the join of `order_items` and `orders`.', 'The summary is a plain GROUP BY over your new table.'],
          explain: 'Schema, load and report in one script — the whole lifecycle of a feature, in SQL.'
        }
      ]
    },

    {
      id: 'next-steps',
      title: 'What you have learned, and where to go next',
      lede: 'A map of the course, the ideas worth keeping, and how to keep improving.',
      body: `
        ## The ten things worth remembering
        1. **Think in sets, not loops.** Describe the rows you want; let the planner find them.
        2. **Know the clause evaluation order.** It explains nearly every error message
           (modules 01, 04).
        3. **NULL is unknown, not empty.** \`IS NULL\`, \`COALESCE\`, and never \`NOT IN\` over a
           nullable subquery (module 02).
        4. **Say the grain out loud.** "One row per X" prevents double counting; two child tables in one
           join is the classic fan-out bug (module 05).
        5. **Outer joins: conditions on the optional table go in \`ON\`**, not \`WHERE\` (module 05).
        6. **Window functions** are the answer to "compare a row with its group", "rank within a group",
           "previous row" and "running total" (module 08).
        7. **Constraints are cheap; bad data is not.** Every rule you can declare is a bug class you
           never debug (module 09).
        8. **Wrap related writes in a transaction**, and write the \`SELECT\` before the \`UPDATE\`
           (modules 10, 11).
        9. **Parameterise everything.** It is the end of SQL injection, and it helps the plan cache
           (module 11).
        10. **Read the plan.** Index the predicates and join columns you actually use, keep columns bare
            in predicates, and measure on realistic data (module 13).

        ## The course, in one list
        | Module | What it covered |
        | --- | --- |
        | 01 Foundations | relational model, \`SELECT\`, \`FROM\`, \`DISTINCT\`, \`ORDER BY\`, \`LIMIT\`, clause order |
        | 02 Filtering | \`WHERE\`, boolean logic, \`BETWEEN\`/\`IN\`, \`LIKE\`, NULL semantics |
        | 03 Expressions | types and \`CAST\`, numbers, strings, dates, \`CASE\`, data cleaning |
        | 04 Aggregation | aggregates, \`GROUP BY\`, \`HAVING\`, \`FILTER\`, evaluation order, patterns |
        | 05 Joins | cross, inner, left, right, full, self, multi-table fan-out, non-equi |
        | 06 Set operations | \`UNION\`, \`INTERSECT\`, \`EXCEPT\`, dataset comparison |
        | 07 Subqueries | scalar, \`IN\`, \`EXISTS\`, derived tables, CTEs, recursion |
        | 08 Windows | \`OVER\`, ranking, \`LAG\`/\`LEAD\`, frames, distributions, patterns |
        | 09 DDL | \`CREATE TABLE\`, keys, constraints, foreign keys, \`ALTER\`, generated columns |
        | 10 DML | \`INSERT\`, \`UPDATE\`, \`DELETE\`, upsert, \`RETURNING\`, safe habits |
        | 11 Objects | views, transactions, isolation, locking, triggers, routines, security |
        | 12 Design | ER modelling, normal forms, denormalisation, anti-patterns, conventions |
        | 13 Performance | execution, indexes, plans, SARGability, tuning |
        | 14 Advanced | pivots, subtotals, JSON, text search, gaps and islands, time series, cohorts, portability |
        | 15 Capstone | realistic analytics and a schema built from a requirement |

        ## Where to go next
        **Deepen the engine you actually use.** Read its documentation on indexes, the query planner and
        isolation — those three chapters pay for themselves repeatedly. The PostgreSQL manual is
        outstanding even if you use something else.

        **Practise on your own data.** The questions you genuinely want answered teach faster than any
        exercise set. Keep this course's [playground](#/playground) for experiments: it resets whenever
        you want.

        **Then look into:**

        - **\`EXPLAIN ANALYZE\` on real workloads** — the gap between estimated and actual rows.
        - **Transaction isolation in your stack** — what your framework does by default.
        - **Migrations and schema versioning** as part of deployment.
        - **Analytical engines** — DuckDB (which speaks almost exactly this SQL and reads Parquet),
          ClickHouse, BigQuery, Snowflake: columnar storage changes which patterns are fast.
        - **dbt** or a similar tool if you build data models for a living: it is SQL plus dependency
          management and testing.
        - **The standard itself** — knowing which features are standard tells you what will port.

        ## Keep practising deliberately
        Pick a question, write it, then ask: *could this be shorter? does it still work if a value is
        NULL? what does the plan look like? what happens when the table is a thousand times bigger?*
        That last question is the difference between SQL that works and SQL that keeps working.

        ~~~sql
        SELECT 'You finished the course. Go write something useful.' AS message;
        ~~~
      `,
      quiz: [
        {
          q: 'A report’s revenue total is exactly double the truth. The most likely cause:',
          options: ['Floating point error', 'A join to a second child table multiplied the rows before aggregation', 'A missing index'],
          answer: 1,
          explain: 'Fan-out. Pre-aggregate each child table to the reporting grain, then join.'
        },
        {
          q: 'WHERE amount <> 100 on a column with NULLs excludes:',
          options: ['Only rows where amount is 100', 'Rows where amount is 100 and rows where amount is NULL', 'Nothing'],
          answer: 1,
          explain: 'A comparison with NULL is unknown, and WHERE keeps only true. Add OR amount IS NULL if you want them.'
        },
        {
          q: 'You need the latest row per customer. The most efficient portable approach:',
          options: ['A correlated subquery with max(date)', 'ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY date DESC) and keep rn = 1', 'DISTINCT on customer_id'],
          answer: 1,
          explain: 'One pass over an indexed ordering, and it handles ties explicitly through the window ORDER BY.'
        },
        {
          q: 'Which of these is safe against SQL injection?',
          options: ['Escaping quotes in the input', 'Passing the value as a bound parameter', 'Validating the length of the input'],
          answer: 1,
          explain: 'Only separating code from data removes the vulnerability class entirely.'
        },
        {
          q: 'A LEFT JOIN with a condition on the right table in WHERE (other than IS NULL):',
          options: ['Keeps all left rows', 'Silently behaves like an INNER JOIN', 'Is a syntax error'],
          answer: 1,
          explain: 'Padded rows have NULL there, so the predicate is unknown and they are dropped. Put the condition in ON.'
        }
      ]
    }
  ]
});
