(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'aggregation',
  title: 'Aggregation',
  blurb: 'Collapsing many rows into one: COUNT, SUM, GROUP BY, HAVING, FILTER and the rules that govern them.',
  lessons: [

    {
      id: 'aggregate-functions',
      title: 'Aggregate functions',
      lede: 'COUNT, SUM, AVG, MIN, MAX — and the NULL behaviour that decides whether your average is right.',
      body: `
        ## One row out of many
        An aggregate reads a set of rows and returns a single value. With no \`GROUP BY\`, the whole
        result set is one group, so you always get exactly one row back:

        ~~~sql
        SELECT count(*)              AS products,
               min(unit_price)       AS cheapest,
               max(unit_price)       AS dearest,
               round(avg(unit_price), 2) AS average,
               round(sum(unit_price * units_in_stock), 2) AS stock_value
        FROM products;
        ~~~

        ## COUNT has three forms
        | Form | Counts |
        | --- | --- |
        | \`count(*)\` | rows, including rows that are all NULL |
        | \`count(col)\` | rows where \`col\` **is not null** |
        | \`count(DISTINCT col)\` | distinct non-null values of \`col\` |

        ~~~sql
        SELECT count(*)                       AS employees,
               count(commission_pct)          AS with_commission,
               count(DISTINCT dept_id)        AS departments_used,
               count(dept_id)                 AS rows_with_dept
        FROM employees;
        ~~~

        That difference between \`count(*)\` and \`count(col)\` is the easiest way to count missing values:
        \`count(*) - count(col)\`.

        ## Every aggregate ignores NULL
        \`sum\`, \`avg\`, \`min\`, \`max\` skip \`NULL\` inputs entirely. Two consequences:

        - \`avg(x)\` divides by the count of **non-null** values, not by the row count. If missing means
          zero in your domain, write \`avg(COALESCE(x, 0))\`.
        - \`sum\` of an all-NULL (or empty) set is \`NULL\`, not \`0\`. Use \`COALESCE(sum(x), 0)\` when a
          report needs a number.

        ~~~sql
        SELECT avg(commission_pct)                     AS avg_of_present,
               avg(COALESCE(commission_pct, 0))        AS avg_treating_null_as_zero,
               sum(commission_pct)                     AS total,
               COALESCE(sum(NULL), 0)                  AS empty_sum_guarded
        FROM employees;
        ~~~

        ## The rest of the set
        - \`group_concat(x, ', ')\` — string aggregation (standard: \`string_agg\`; MySQL:
          \`GROUP_CONCAT\`; SQL Server: \`STRING_AGG\`; Oracle: \`LISTAGG\`)
        - \`total(x)\` — SQLite's sum that returns \`0.0\` instead of \`NULL\`
        - statistics: \`stddev\`, \`variance\`, \`corr\`, \`percentile_cont\` — available in PostgreSQL and
          Oracle, partially in MySQL/SQL Server, absent from SQLite
        - \`bool_and\`/\`bool_or\` (PostgreSQL) — emulate with \`min\`/\`max\` on 0/1

        ~~~sql
        SELECT d.dept_name,
               count(*) AS headcount,
               group_concat(e.last_name, ', ') AS members
        FROM employees e JOIN departments d USING (dept_id)
        GROUP BY d.dept_name
        ORDER BY d.dept_name;
        ~~~

        :::warn Aggregates cannot nest directly
        \`max(count(*))\` is an error. Aggregate once in a subquery, then aggregate the result
        (module 07), or use a window function (module 08).
        :::
      `,
      exercises: [
        {
          prompt: 'Return one row with: `employees` (how many rows), `paid_total` (sum of salaries), `avg_salary` rounded to 2, `min_salary` and `max_salary`.',
          starter: '',
          solution: 'SELECT count(*) AS employees, sum(salary) AS paid_total, round(avg(salary), 2) AS avg_salary,\n       min(salary) AS min_salary, max(salary) AS max_salary\nFROM employees;',
          hints: ['Five aggregates, no GROUP BY.'],
          explain: 'With no GROUP BY the entire table is one group, so exactly one row comes back.'
        },
        {
          prompt: 'How many customers have no `credit_limit` recorded? Return one column `missing_limit`, computed from `count(*)` and `count(credit_limit)`.',
          starter: '',
          solution: 'SELECT count(*) - count(credit_limit) AS missing_limit FROM customers;',
          requireSql: [{ pattern: 'count\\s*\\(\\s*credit_limit', msg: 'Use `count(credit_limit)` — the lesson is that it skips NULLs.' }],
          hints: ['`count(col)` ignores NULLs; `count(*)` does not.'],
          explain: 'This idiom gives you a null-count for any column without a WHERE clause.'
        },
        {
          prompt: 'Return `order_lines` (rows in `order_items`), `distinct_orders` and `distinct_products` as three columns.',
          starter: '',
          solution: 'SELECT count(*) AS order_lines, count(DISTINCT order_id) AS distinct_orders, count(DISTINCT product_id) AS distinct_products\nFROM order_items;',
          hints: ['`count(DISTINCT ...)` twice.'],
          explain: 'Comparing row count to distinct-key counts is how you discover the grain of a table.'
        }
      ],
      quiz: [
        {
          q: 'A column has values 10, NULL, 20. What do sum(x), avg(x) and count(x) return?',
          options: ['30, 10, 3', '30, 15, 2', 'NULL, NULL, 3'],
          answer: 1,
          explain: 'NULL is skipped: the sum is 30, the average divides by 2 non-null values, and count(x) is 2.'
        }
      ]
    },

    {
      id: 'group-by',
      title: 'GROUP BY',
      lede: 'Splitting rows into groups and reducing each one — plus the rule about what may appear in SELECT.',
      body: `
        ## Grouping
        \`GROUP BY\` partitions rows by the values of its expressions; the aggregate then runs once per group.

        ~~~sql
        SELECT category_id, count(*) AS products, round(avg(unit_price), 2) AS avg_price
        FROM products
        GROUP BY category_id
        ORDER BY category_id;
        ~~~

        ## The one rule
        Every expression in \`SELECT\` must either

        1. appear in \`GROUP BY\`, or
        2. be inside an aggregate function.

        Anything else is **ambiguous**: if a group has 6 products, which \`product_name\` should the engine
        show? PostgreSQL, SQL Server and Oracle reject it. SQLite and MySQL (without
        \`ONLY_FULL_GROUP_BY\`) silently return an **arbitrary** value from the group — a classic source of
        wrong reports that look plausible:

        ~~~sql
        -- SQLite allows this, but the product_name is an arbitrary row from each group
        SELECT category_id, product_name, max(unit_price) AS top_price
        FROM products
        GROUP BY category_id
        ORDER BY category_id;
        ~~~

        Here it happens to pick the row with the max price (an SQLite-specific guarantee for bare
        columns alongside \`min\`/\`max\`), but with \`avg\` or two aggregates it is undefined. Do not rely
        on it; see "greatest per group" in the patterns lesson and module 08.

        ## Grouping by expressions
        Any expression works, and most engines let you reuse the output alias:

        ~~~sql
        SELECT strftime('%Y', order_date) AS year,
               status,
               count(*) AS orders
        FROM orders
        GROUP BY year, status
        ORDER BY year, status;
        ~~~

        Grouping by several keys produces one row per **existing combination** — combinations with no rows
        simply do not appear (module 14 covers filling them in).

        ## NULL forms one group
        Unlike in \`WHERE\`, \`NULL\`s are grouped together:

        ~~~sql
        SELECT dept_id, count(*) AS headcount
        FROM employees
        GROUP BY dept_id
        ORDER BY dept_id;
        ~~~

        The row with \`dept_id = NULL\` is the employees who have no department.

        ## Grouping over a join
        Join first, then group. Decide carefully which table supplies the grain:

        ~~~sql
        SELECT c.country,
               count(DISTINCT o.order_id) AS orders,
               count(*)                   AS order_lines
        FROM customers c
        JOIN orders o      ON o.customer_id = c.customer_id
        JOIN order_items i ON i.order_id = o.order_id
        GROUP BY c.country
        ORDER BY orders DESC, c.country;
        ~~~

        \`count(*)\` counts item rows, not orders — the join multiplied them. \`count(DISTINCT o.order_id)\`
        recovers the order count. This is the **fan-out** problem; module 05 treats it properly.
      `,
      exercises: [
        {
          prompt: 'Return `status` and `orders` (number of orders with that status), most common first.',
          starter: '',
          solution: 'SELECT status, count(*) AS orders FROM orders GROUP BY status ORDER BY orders DESC, status;',
          orderMatters: false,
          hints: ['Group by the column you want one row per.'],
          explain: 'The canonical "count by category" query.'
        },
        {
          prompt: 'Return `dept_id`, `headcount` and `avg_salary` (rounded to 2) per department, highest average first.',
          starter: '',
          solution: 'SELECT dept_id, count(*) AS headcount, round(avg(salary), 2) AS avg_salary\nFROM employees\nGROUP BY dept_id\nORDER BY avg_salary DESC;',
          orderMatters: false,
          hints: ['`GROUP BY dept_id` and two aggregates.'],
          explain: 'The NULL department appears as its own group — employees with no department assigned.'
        },
        {
          prompt: 'Per customer, return `customer_id`, `orders` (count) and `total_freight` (rounded to 2), for the 5 customers with the most orders, ties broken by `customer_id`.',
          starter: '',
          solution: 'SELECT customer_id, count(*) AS orders, round(sum(freight), 2) AS total_freight\nFROM orders\nGROUP BY customer_id\nORDER BY orders DESC, customer_id\nLIMIT 5;',
          orderMatters: true,
          hints: ['No join needed — `orders` holds `customer_id`.', 'Tie-break on `customer_id` to make the top-5 deterministic.'],
          explain: 'When a limit cuts into a tie, the tie-breaker decides which rows survive — always specify one.'
        },
        {
          prompt: 'Per `product_id` in `order_items`, return `product_id`, `units` (total quantity) and `revenue` = sum of `unit_price * quantity * (1 - discount)` rounded to 2, for the top 10 by revenue, ties by `product_id`.',
          starter: '',
          solution: 'SELECT product_id, sum(quantity) AS units,\n       round(sum(unit_price * quantity * (1 - discount)), 2) AS revenue\nFROM order_items\nGROUP BY product_id\nORDER BY revenue DESC, product_id\nLIMIT 10;',
          orderMatters: true,
          hints: ['Both measures are sums over the group.'],
          explain: 'Revenue per product from the line table alone — no join required, because the line stores its own price.'
        }
      ],
      quiz: [
        {
          q: 'SELECT dept_id, last_name, count(*) FROM employees GROUP BY dept_id — what happens?',
          options: ['Works everywhere', 'Rejected by PostgreSQL/SQL Server/Oracle; returns an arbitrary last_name in SQLite and lenient MySQL', 'Returns one row per employee'],
          answer: 1,
          explain: 'A non-aggregated, non-grouped column is not functionally determined by the group, so strict engines reject it.'
        }
      ]
    },

    {
      id: 'having',
      title: 'HAVING: filtering groups',
      lede: 'WHERE filters rows before grouping; HAVING filters groups after. Using the wrong one changes the answer.',
      body: `
        ## The difference
        - \`WHERE\` is evaluated **before** \`GROUP BY\`, on individual rows. It cannot see aggregates.
        - \`HAVING\` is evaluated **after** \`GROUP BY\`, on groups. It can (and normally does) use aggregates.

        ~~~sql
        SELECT customer_id, count(*) AS orders
        FROM orders
        WHERE status <> 'cancelled'      -- drop rows first
        GROUP BY customer_id
        HAVING count(*) >= 20            -- then drop small groups
        ORDER BY orders DESC;
        ~~~

        Reading it as two steps makes the semantics obvious: *of the non-cancelled orders*, which
        customers have at least 20?

        ## They are not interchangeable
        These two queries answer different questions:

        ~~~sql
        -- A: among non-cancelled orders, customers with 20+ orders
        SELECT customer_id, count(*) AS n
        FROM orders WHERE status <> 'cancelled'
        GROUP BY customer_id HAVING count(*) >= 20
        ORDER BY customer_id;
        ~~~

        ~~~sql
        -- B: customers with 20+ orders in total, showing their non-cancelled count
        SELECT customer_id,
               sum(CASE WHEN status <> 'cancelled' THEN 1 ELSE 0 END) AS n
        FROM orders
        GROUP BY customer_id HAVING count(*) >= 20
        ORDER BY customer_id;
        ~~~

        ## HAVING without aggregates
        \`HAVING dept_id = 1\` is legal if \`dept_id\` is a grouping key, but it is better written as
        \`WHERE dept_id = 1\`: filtering earlier means fewer rows to group, and the intent is clearer.
        A non-aggregate condition in \`HAVING\` is usually a sign the author was unsure which to use.

        ## Common aggregate predicates
        ~~~sql
        SELECT product_id,
               count(*)      AS lines,
               sum(quantity) AS units,
               avg(discount) AS avg_discount
        FROM order_items
        GROUP BY product_id
        HAVING sum(quantity) > 120 AND avg(discount) > 0.02
        ORDER BY units DESC;
        ~~~

        You may reference an aggregate in \`HAVING\` that is not in the \`SELECT\` list at all — the group
        knows more than it shows.

        :::dialect Aliases in HAVING
        SQLite, MySQL and PostgreSQL accept \`HAVING orders >= 20\` using the SELECT alias. SQL Server and
        Oracle require the full expression, \`HAVING count(*) >= 20\`. The explicit form is portable.
        :::
      `,
      exercises: [
        {
          prompt: 'Return `country` and `customers` for countries with **more than one** customer, most customers first then country name.',
          starter: '',
          solution: 'SELECT country, count(*) AS customers\nFROM customers\nGROUP BY country\nHAVING count(*) > 1\nORDER BY customers DESC, country;',
          orderMatters: true,
          hints: ['`HAVING count(*) > 1`.'],
          explain: 'A group-level predicate — impossible to express in WHERE.'
        },
        {
          prompt: 'Among **non-cancelled** orders, return `customer_id` and `orders` for customers with at least 15 such orders, ordered by `orders` descending then `customer_id`.',
          starter: '',
          solution: "SELECT customer_id, count(*) AS orders\nFROM orders\nWHERE status <> 'cancelled'\nGROUP BY customer_id\nHAVING count(*) >= 15\nORDER BY orders DESC, customer_id;",
          orderMatters: true,
          hints: ['Row filter in `WHERE`, group filter in `HAVING`.'],
          explain: 'Both clauses in one query, each doing the job it is meant for.'
        },
        {
          prompt: 'Return `product_id` and `avg_discount` (rounded to 3) for products whose average discount across all order lines exceeds 0.03, highest first then `product_id`.',
          starter: '',
          solution: 'SELECT product_id, round(avg(discount), 3) AS avg_discount\nFROM order_items\nGROUP BY product_id\nHAVING avg(discount) > 0.03\nORDER BY avg_discount DESC, product_id;',
          orderMatters: true,
          hints: ['Filter on the unrounded aggregate, display the rounded one.'],
          explain: 'Filtering on the raw value and rounding only for display keeps the boundary exact.'
        }
      ],
      quiz: [
        {
          q: 'Where does WHERE count(*) > 5 belong?',
          options: ['It is fine in WHERE', 'In HAVING — aggregates do not exist yet when WHERE runs', 'In ORDER BY'],
          answer: 1,
          explain: 'Groups are formed after WHERE, so an aggregate predicate must go in HAVING (or a wrapping query).'
        }
      ]
    },

    {
      id: 'conditional-aggregation',
      title: 'FILTER, DISTINCT and conditional aggregates',
      lede: 'Several differently-filtered measures in a single pass — the backbone of every dashboard query.',
      body: `
        ## One scan, many measures
        You rarely want *one* number per group. The \`CASE\`-inside-aggregate pattern computes as many
        filtered measures as you like without scanning the table repeatedly:

        ~~~sql
        SELECT c.country,
               count(*)                                                   AS orders,
               sum(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END)     AS delivered,
               sum(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END)     AS cancelled,
               sum(CASE WHEN o.ship_date IS NULL THEN 1 ELSE 0 END)        AS unshipped,
               round(sum(CASE WHEN o.status <> 'cancelled' THEN o.freight ELSE 0 END), 2) AS billable_freight
        FROM orders o
        JOIN customers c USING (customer_id)
        GROUP BY c.country
        ORDER BY orders DESC, c.country;
        ~~~

        ## The FILTER clause
        Standard SQL has dedicated syntax, supported by SQLite ≥ 3.30 and PostgreSQL:

        ~~~sql
        SELECT status,
               count(*)                                   AS orders,
               count(*) FILTER (WHERE freight > 50)       AS heavy,
               round(avg(freight) FILTER (WHERE freight > 50), 2) AS avg_heavy_freight
        FROM orders
        GROUP BY status
        ORDER BY status;
        ~~~

        \`FILTER\` reads better and works with any aggregate. For MySQL, SQL Server and Oracle, fall back
        to \`CASE\` (\`count(CASE WHEN cond THEN 1 END)\` — NULLs are not counted).

        ## DISTINCT inside an aggregate
        \`count(DISTINCT x)\`, \`sum(DISTINCT x)\`, \`avg(DISTINCT x)\` and
        \`group_concat(DISTINCT x)\` are all legal:

        ~~~sql
        SELECT o.emp_id,
               count(*)                          AS orders_handled,
               count(DISTINCT o.customer_id)     AS distinct_customers
        FROM orders o
        GROUP BY o.emp_id
        ORDER BY orders_handled DESC;
        ~~~

        \`count(DISTINCT a, b)\` (several columns) works in MySQL but not in SQLite or PostgreSQL —
        there, concatenate or use \`count(DISTINCT (a, b))\` in PostgreSQL's row-value form.

        ## String aggregation
        ~~~sql
        SELECT d.dept_name,
               group_concat(e.last_name || ' (' || e.job_title || ')', '; ') AS staff
        FROM departments d JOIN employees e USING (dept_id)
        GROUP BY d.dept_name
        ORDER BY d.dept_name;
        ~~~

        Ordering inside the aggregate is engine-specific: \`string_agg(x, ',' ORDER BY x)\` in PostgreSQL,
        \`GROUP_CONCAT(x ORDER BY x)\` in MySQL, \`STRING_AGG(x, ',') WITHIN GROUP (ORDER BY x)\` in SQL
        Server. SQLite ≥ 3.44 supports \`ORDER BY\` inside aggregates too.

        ## Min/max of a computed value
        Aggregates take whole expressions, which makes "the largest line total" trivial:

        ~~~sql
        SELECT order_id,
               max(unit_price * quantity * (1 - discount)) AS biggest_line,
               sum(unit_price * quantity * (1 - discount)) AS order_total
        FROM order_items
        GROUP BY order_id
        ORDER BY biggest_line DESC
        LIMIT 5;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Per `emp_id` in `orders`, return `emp_id`, `orders`, `cancelled` (count of cancelled orders) and `cancel_rate` = cancelled / orders rounded to 3. Order by `emp_id`. Employees with no orders are out of scope.',
          starter: '',
          solution: "SELECT emp_id,\n       count(*) AS orders,\n       sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,\n       round(1.0 * sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) / count(*), 3) AS cancel_rate\nFROM orders\nGROUP BY emp_id\nORDER BY emp_id;",
          orderMatters: true,
          hints: ['Conditional sum for the numerator.', 'Multiply by `1.0` to avoid integer division.'],
          explain: 'Rate = conditional count / total count, computed in one pass.'
        },
        {
          prompt: 'Using the `FILTER` clause, return per `method` in `payments`: `method`, `payments` (count), `big_payments` (count where `amount > 1000`) and `total` (sum of amount, rounded to 2). Order by `method`.',
          starter: '',
          solution: 'SELECT method,\n       count(*) AS payments,\n       count(*) FILTER (WHERE amount > 1000) AS big_payments,\n       round(sum(amount), 2) AS total\nFROM payments\nGROUP BY method\nORDER BY method;',
          orderMatters: true,
          requireSql: [{ pattern: 'filter\\s*\\(', msg: 'Use the `FILTER (WHERE ...)` clause here — it is the point of the exercise.' }],
          hints: ['`count(*) FILTER (WHERE amount > 1000)`.'],
          explain: 'FILTER is the standard spelling of conditional aggregation, and reads far better than nested CASE.'
        },
        {
          prompt: 'Per `dept_id`, return `dept_id`, `headcount` and `titles` — a semicolon-separated list of distinct `job_title` values (use `group_concat(DISTINCT job_title)`). Order by `dept_id`.',
          starter: '',
          solution: 'SELECT dept_id, count(*) AS headcount, group_concat(DISTINCT job_title) AS titles\nFROM employees\nGROUP BY dept_id\nORDER BY dept_id;',
          orderMatters: true,
          hints: ['`group_concat(DISTINCT job_title)` uses a comma separator by default — that is fine.'],
          explain: 'String aggregation is excellent for debugging and for compact reports; it is not a substitute for a proper child table.'
        }
      ]
    },

    {
      id: 'processing-order',
      title: 'How a SELECT is really evaluated',
      lede: 'One mental model that explains most SQL error messages.',
      body: `
        ## The pipeline
        Every \`SELECT\` behaves as if each stage fed the next:

        | Stage | Clause | Produces | Can see |
        | --- | --- | --- | --- |
        | 1 | \`FROM\` / \`JOIN\` | rows, with all source columns | table columns |
        | 2 | \`WHERE\` | fewer rows | table columns |
        | 3 | \`GROUP BY\` | groups | table columns |
        | 4 | aggregates | one value per group | grouped columns, aggregates |
        | 5 | \`HAVING\` | fewer groups | grouped columns, aggregates |
        | 6 | \`SELECT\` | output columns, window functions | grouped columns, aggregates |
        | 7 | \`DISTINCT\` | fewer rows | output columns |
        | 8 | \`ORDER BY\` | ordered rows | output columns **and** aliases |
        | 9 | \`LIMIT\` / \`OFFSET\` | a slice | — |

        This is a *semantic* model, not the physical plan: the optimiser reorders freely as long as the
        answer is unchanged (it will push a \`WHERE\` below a join, or stop early for a \`LIMIT\`).

        ## Reading error messages through the model
        | Message | Cause | Fix |
        | --- | --- | --- |
        | \`no such column: gross\` in \`WHERE\` | aliases are born at stage 6 | repeat the expression, or wrap the query |
        | \`misuse of aggregate function count()\` | aggregate in \`WHERE\` (stage 2) | move to \`HAVING\` |
        | \`column must appear in the GROUP BY clause\` | ungrouped column at stage 6 | group it, or aggregate it |
        | \`window functions are not allowed in WHERE\` | windows run at stage 6 | wrap in a subquery and filter outside |
        | \`ambiguous column name\` | two sources expose it at stage 1 | qualify with an alias |

        ## Why window functions cannot be filtered in place
        ~~~sql
        -- rank is computed at stage 6, so WHERE (stage 2) cannot see it: wrap the query
        SELECT * FROM (
          SELECT product_id, sum(quantity) AS units,
                 RANK() OVER (ORDER BY sum(quantity) DESC) AS rnk
          FROM order_items
          GROUP BY product_id
        ) ranked
        WHERE rnk <= 5
        ORDER BY rnk;
        ~~~

        Note the window function sitting *on top of* aggregates: stage 6 happens after stage 4, so
        \`RANK() OVER (ORDER BY sum(quantity) DESC)\` is legal in the same \`SELECT\` that computes the sum.
        Some engines (Teradata, Snowflake, BigQuery, DuckDB) add \`QUALIFY\` so you can filter windows
        without a subquery.

        ## Order of execution vs. order of writing
        ~~~sql
        SELECT   c.country, count(*) AS orders          -- 6
        FROM     orders o                                -- 1
        JOIN     customers c USING (customer_id)         -- 1
        WHERE    o.order_date >= '2025-01-01'            -- 2
        GROUP BY c.country                               -- 3
        HAVING   count(*) > 5                            -- 5
        ORDER BY orders DESC                             -- 8
        LIMIT    5;                                      -- 9
        ~~~
      `,
      exercises: [
        {
          prompt: 'This fails: `SELECT product_id, sum(quantity) AS units FROM order_items WHERE units > 150 GROUP BY product_id;`\n\nRewrite it so it returns `product_id` and `units` for products with more than 150 total units, ordered by `units` descending then `product_id`.',
          starter: '',
          solution: 'SELECT product_id, sum(quantity) AS units\nFROM order_items\nGROUP BY product_id\nHAVING sum(quantity) > 150\nORDER BY units DESC, product_id;',
          orderMatters: true,
          hints: ['The predicate is about a group, not a row.', 'HAVING can repeat the aggregate expression.'],
          explain: 'Two errors in one: an aggregate in WHERE, and an alias used before it exists.'
        },
        {
          prompt: 'Return the top 3 `product_id` values by total `units` using a **subquery with a window function** (`RANK()`), with columns `product_id`, `units`, `rnk`, ordered by `rnk`.',
          starter: 'SELECT * FROM (\n  \n) ranked\nWHERE ',
          solution: 'SELECT product_id, units, rnk FROM (\n  SELECT product_id, sum(quantity) AS units,\n         RANK() OVER (ORDER BY sum(quantity) DESC) AS rnk\n  FROM order_items\n  GROUP BY product_id\n) ranked\nWHERE rnk <= 3\nORDER BY rnk;',
          orderMatters: true,
          requireSql: [{ pattern: 'over\\s*\\(', msg: 'Use a window function (`RANK() OVER (...)`) inside the subquery.' }],
          hints: ['Compute the rank in the inner query, filter it in the outer one.', 'Module 08 covers window functions in full — this is a preview.'],
          explain: 'Wrapping a query is the portable way to filter on something computed at stage 6.'
        }
      ],
      quiz: [
        {
          q: 'Which clause may use a SELECT-list alias in nearly every engine?',
          options: ['WHERE', 'HAVING', 'ORDER BY'],
          answer: 2,
          explain: 'ORDER BY is the only stage that runs after SELECT in every dialect.'
        }
      ]
    },

    {
      id: 'aggregate-patterns',
      title: 'Aggregation patterns that come up constantly',
      lede: 'Share of total, the row that holds the maximum, averages of averages, and counting what is absent.',
      body: `
        ## Share of total
        Compare a group's measure with the whole. The portable form uses a scalar subquery:

        ~~~sql
        SELECT status,
               count(*) AS orders,
               round(100.0 * count(*) / (SELECT count(*) FROM orders), 1) AS pct_of_all
        FROM orders
        GROUP BY status
        ORDER BY orders DESC;
        ~~~

        Module 08 shows the window version, \`100.0 * count(*) / sum(count(*)) OVER ()\`, which avoids
        reading the table twice.

        ## The row that holds the maximum ("argmax")
        \`max(unit_price)\` gives the value; it does **not** tell you which product. Three portable ways:

        ~~~sql
        -- 1. filter against the aggregate
        SELECT product_id, product_name, unit_price
        FROM products
        WHERE unit_price = (SELECT max(unit_price) FROM products);
        ~~~

        ~~~sql
        -- 2. order and limit (one winner only, ties arbitrary)
        SELECT product_id, product_name, unit_price
        FROM products ORDER BY unit_price DESC LIMIT 1;
        ~~~

        ~~~sql
        -- 3. per group: correlated comparison
        SELECT p.category_id, p.product_name, p.unit_price
        FROM products p
        WHERE p.unit_price = (SELECT max(p2.unit_price) FROM products p2 WHERE p2.category_id = p.category_id)
        ORDER BY p.category_id;
        ~~~

        Variant 1 and 3 return **all** tied rows, which is usually what a report should do.
        The window-function version (\`ROW_NUMBER\`) is in module 08 and is normally the fastest.

        ## Averages of averages are wrong
        \`avg(avg(x))\` is not the overall average unless every group is the same size:

        ~~~sql
        SELECT round(avg(unit_price), 4) AS true_avg,
               (SELECT round(avg(group_avg), 4)
                  FROM (SELECT avg(unit_price) AS group_avg FROM products GROUP BY category_id)) AS avg_of_avgs
        FROM products;
        ~~~

        Aggregate from the raw rows, or weight the group averages by their counts.

        ## Counting what is absent
        A \`GROUP BY\` only reports groups that have rows. "Products never ordered" or "customers with
        zero orders" need an outer join or \`NOT EXISTS\` (modules 05 and 07):

        ~~~sql
        SELECT p.product_id, p.product_name
        FROM products p
        WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = p.product_id);
        ~~~

        ## Multi-level aggregation
        To average a per-order total you must aggregate twice — the inner query sets the grain:

        ~~~sql
        SELECT round(avg(order_total), 2) AS avg_order_value,
               round(max(order_total), 2) AS biggest_order
        FROM (
          SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS order_total
          FROM order_items
          GROUP BY order_id
        );
        ~~~

        :::tip Say the grain out loud
        "One row per order", "one row per order line", "one row per customer per month". Most aggregation
        bugs are grain confusion, and naming the grain of each subquery prevents them.
        :::
      `,
      exercises: [
        {
          prompt: 'Return the single most expensive product (`product_name`, `unit_price`) using a scalar subquery against `max(unit_price)` — so that any tie would return all tied rows.',
          starter: '',
          solution: 'SELECT product_name, unit_price FROM products WHERE unit_price = (SELECT max(unit_price) FROM products);',
          forbidSql: [{ pattern: 'limit', msg: 'Solve it without `LIMIT`, so that ties are all returned.' }],
          hints: ['`WHERE unit_price = (SELECT max(unit_price) FROM products)`.'],
          explain: 'A scalar subquery as a predicate keeps ties, unlike ORDER BY + LIMIT 1.'
        },
        {
          prompt: 'Return the **average order value** as `avg_order_value` (rounded to 2): first total each order from `order_items`, then average those totals.',
          starter: 'SELECT round(avg(order_total), 2) AS avg_order_value\nFROM (\n  \n);',
          solution: 'SELECT round(avg(order_total), 2) AS avg_order_value\nFROM (\n  SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS order_total\n  FROM order_items\n  GROUP BY order_id\n);',
          hints: ['Two levels: per-order sum inside, average outside.', 'Averaging the raw line totals would answer a different question (average line value).'],
          explain: 'Changing the grain requires a second aggregation step — this is the shape of most analytics queries.'
        },
        {
          prompt: 'For each `category_id`, return `category_id`, `products`, and `pct_of_all_products` (share of the 30 products, 1 decimal). Order by `category_id`.',
          starter: '',
          solution: 'SELECT category_id, count(*) AS products,\n       round(100.0 * count(*) / (SELECT count(*) FROM products), 1) AS pct_of_all_products\nFROM products\nGROUP BY category_id\nORDER BY category_id;',
          orderMatters: true,
          hints: ['The total is a scalar subquery with no GROUP BY.'],
          explain: 'A scalar subquery is evaluated once and reused for every group.'
        },
        {
          prompt: 'List the products that have **never** been ordered: `product_id` and `product_name`, ordered by `product_id`.',
          starter: '',
          solution: 'SELECT p.product_id, p.product_name\nFROM products p\nWHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = p.product_id)\nORDER BY p.product_id;',
          orderMatters: true,
          hints: ['Absence cannot come from GROUP BY — use `NOT EXISTS` (or a LEFT JOIN, module 05).'],
          explain: 'Counting absence always needs an outer join or an anti-join, never a plain GROUP BY.'
        }
      ]
    }
  ]
});
