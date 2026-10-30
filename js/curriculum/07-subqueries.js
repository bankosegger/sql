(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'subqueries',
  title: 'Subqueries and CTEs',
  blurb: 'Queries inside queries: scalar, IN, EXISTS, derived tables, WITH, and recursion.',
  lessons: [

    {
      id: 'scalar-subqueries',
      title: 'Scalar subqueries',
      lede: 'A query that returns exactly one value can be used anywhere a value is allowed.',
      body: `
        ## One row, one column
        A **scalar subquery** returns a single value, so it fits in a \`SELECT\` list, a \`WHERE\`
        comparison, or even \`ORDER BY\`:

        ~~~sql
        SELECT product_name, unit_price,
               (SELECT round(avg(unit_price), 2) FROM products) AS avg_price,
               round(unit_price - (SELECT avg(unit_price) FROM products), 2) AS diff_from_avg
        FROM products
        ORDER BY diff_from_avg DESC
        LIMIT 8;
        ~~~

        If the subquery returns no row, its value is \`NULL\`. If it returns more than one row, you get an
        error in strict engines (SQLite quietly takes the first — another reason not to rely on it).

        ## In a WHERE comparison
        ~~~sql
        SELECT first_name, last_name, salary
        FROM employees
        WHERE salary > (SELECT avg(salary) FROM employees)
        ORDER BY salary DESC;
        ~~~

        This is the canonical "above average" query, and it cannot be written with a plain aggregate:
        \`WHERE salary > avg(salary)\` is invalid because \`WHERE\` runs before aggregation.

        ## Correlated scalar subqueries
        A subquery that references the outer row is **correlated**: it is conceptually evaluated once per
        outer row.

        ~~~sql
        SELECT c.company_name,
               (SELECT count(*) FROM orders o WHERE o.customer_id = c.customer_id)          AS orders,
               (SELECT max(o.order_date) FROM orders o WHERE o.customer_id = c.customer_id)  AS last_order
        FROM customers c
        ORDER BY orders DESC, c.company_name;
        ~~~

        This is readable and gives 0 / NULL for customers without orders — no outer join needed. The
        trade-off is cost: one lookup per outer row unless the planner rewrites it (modern planners often
        do). For many measures over the same child table, a \`LEFT JOIN\` onto a pre-aggregated subquery
        reads the child once.

        ## In ORDER BY
        ~~~sql
        SELECT p.product_name
        FROM products p
        ORDER BY (SELECT count(*) FROM order_items i WHERE i.product_id = p.product_id) DESC,
                 p.product_name
        LIMIT 5;
        ~~~

        :::warn Keep scalar subqueries scalar
        Add a \`LIMIT 1\` or an aggregate when uniqueness is not guaranteed by a key. A subquery that
        returns one row today and two after a data change is a bug waiting for production.
        :::
      `,
      exercises: [
        {
          prompt: 'Return `first_name`, `last_name` and `salary` for employees earning more than the company average, highest first.',
          starter: '',
          solution: 'SELECT first_name, last_name, salary\nFROM employees\nWHERE salary > (SELECT avg(salary) FROM employees)\nORDER BY salary DESC;',
          orderMatters: true,
          hints: ['The average is a scalar subquery in `WHERE`.'],
          explain: 'The subquery is uncorrelated, so it is evaluated once.'
        },
        {
          prompt: 'For every customer return `company_name`, `orders` (count of their orders) and `last_order` (their latest `order_date`), using **correlated scalar subqueries** — no JOIN. Order by `orders` descending then `company_name`.',
          starter: '',
          solution: 'SELECT c.company_name,\n       (SELECT count(*) FROM orders o WHERE o.customer_id = c.customer_id) AS orders,\n       (SELECT max(o.order_date) FROM orders o WHERE o.customer_id = c.customer_id) AS last_order\nFROM customers c\nORDER BY orders DESC, c.company_name;',
          orderMatters: true,
          forbidSql: [{ pattern: '\\bjoin\\b', msg: 'Do it with correlated subqueries this time, not a JOIN.' }],
          hints: ['Each subquery references `c.customer_id` from the outer query.'],
          explain: 'Customers with no orders get 0 and NULL — the same result a LEFT JOIN would give.'
        },
        {
          prompt: 'Return `product_name`, `unit_price` and `pct_of_max` — the price as a percentage of the most expensive product, rounded to 1 — for the 5 most expensive products, dearest first.',
          starter: '',
          solution: 'SELECT product_name, unit_price,\n       round(100.0 * unit_price / (SELECT max(unit_price) FROM products), 1) AS pct_of_max\nFROM products\nORDER BY unit_price DESC\nLIMIT 5;',
          orderMatters: true,
          hints: ['The denominator is `(SELECT max(unit_price) FROM products)`.'],
          explain: 'Normalising against a whole-table extreme is a typical use of an uncorrelated scalar subquery.'
        }
      ]
    },

    {
      id: 'in-subqueries',
      title: 'IN with a subquery (and the NOT IN trap)',
      lede: 'Membership tests against another query — and the NULL that silently empties your result.',
      body: `
        ## IN (SELECT ...)
        ~~~sql
        SELECT company_name, country
        FROM customers
        WHERE customer_id IN (SELECT customer_id FROM orders WHERE status = 'cancelled')
        ORDER BY company_name;
        ~~~

        The subquery returns a column of values; the outer row survives if its value is among them.
        Duplicates in the subquery do not matter, and the outer rows are never multiplied — unlike a
        join, \`IN\` is a **semi-join**.

        ## NOT IN is only safe without NULLs
        ~~~sql
        -- employees who are nobody's manager
        SELECT last_name
        FROM employees
        WHERE emp_id NOT IN (SELECT manager_id FROM employees WHERE manager_id IS NOT NULL)
        ORDER BY last_name;
        ~~~

        Remove that \`IS NOT NULL\` guard and the result is **empty**: \`manager_id\` is NULL for the CEO,
        so the list contains a NULL, and \`x NOT IN (..., NULL)\` can never be true.

        ~~~sql
        -- the trap, live: zero rows
        SELECT count(*) AS rows_returned
        FROM employees
        WHERE emp_id NOT IN (SELECT manager_id FROM employees);
        ~~~

        Three ways out, in order of preference:

        1. \`NOT EXISTS\` — immune to NULLs (next lesson);
        2. add \`WHERE col IS NOT NULL\` inside the subquery;
        3. \`LEFT JOIN ... WHERE right.key IS NULL\`.

        ## IN versus JOIN
        \`IN\` with a subquery and an inner join answer the same question *only* when the subquery's key is
        unique. If one customer has 20 cancelled orders, the join returns 20 rows for that customer and
        \`IN\` returns one. Use \`IN\`/\`EXISTS\` when you need "does a match exist?", and a join when you
        need columns from the other table.

        ~~~sql
        -- join version: one row per matching order, not per customer
        SELECT c.company_name, count(*) AS cancelled_orders
        FROM customers c
        JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'cancelled'
        GROUP BY c.company_name
        ORDER BY cancelled_orders DESC, c.company_name;
        ~~~

        ## ANY and ALL
        Standard SQL generalises comparisons over a subquery. \`= ANY\` is exactly \`IN\`:

        ~~~sql-static
        WHERE price > ALL (SELECT price FROM competitor)   -- greater than every row
        WHERE price > ANY (SELECT price FROM competitor)   -- greater than at least one
        ~~~

        PostgreSQL, MySQL, SQL Server and Oracle support them; SQLite does not. The portable equivalents
        are \`> (SELECT max(price) ...)\` and \`> (SELECT min(price) ...)\`.
      `,
      exercises: [
        {
          prompt: 'Return `company_name` for customers who have at least one `cancelled` order, using `IN` with a subquery. Order by `company_name`.',
          starter: '',
          solution: "SELECT company_name\nFROM customers\nWHERE customer_id IN (SELECT customer_id FROM orders WHERE status = 'cancelled')\nORDER BY company_name;",
          orderMatters: true,
          requireSql: [{ pattern: '\\bin\\s*\\(\\s*select', msg: 'Use `IN (SELECT ...)` for this one.' }],
          hints: ['The subquery returns `customer_id`s.'],
          explain: 'A semi-join: each customer appears once no matter how many cancelled orders they have.'
        },
        {
          prompt: 'Return `last_name` for every employee who manages nobody, using `NOT IN` **safely** (guard against the NULL `manager_id`). Order by `last_name`.',
          starter: '',
          solution: 'SELECT last_name\nFROM employees\nWHERE emp_id NOT IN (SELECT manager_id FROM employees WHERE manager_id IS NOT NULL)\nORDER BY last_name;',
          orderMatters: true,
          requireSql: [
            { pattern: 'not\\s+in', msg: 'Use `NOT IN` here — the exercise is about making it safe.' },
            { pattern: 'is\\s+not\\s+null', msg: 'Filter the NULLs out inside the subquery, or the result is empty.' }
          ],
          hints: ['Add `WHERE manager_id IS NOT NULL` to the subquery.'],
          explain: 'Without the guard this returns zero rows — the classic NOT IN failure.'
        },
        {
          prompt: 'Return `product_name` for products that appear in at least one order line with a discount above 0.1, using `IN`. Order by `product_name`.',
          starter: '',
          solution: 'SELECT product_name\nFROM products\nWHERE product_id IN (SELECT product_id FROM order_items WHERE discount > 0.1)\nORDER BY product_name;',
          orderMatters: true,
          hints: ['Filter inside the subquery, not outside.'],
          explain: 'Pushing the condition into the subquery keeps the outer query a simple membership test.'
        }
      ],
      quiz: [
        {
          q: 'WHERE id NOT IN (SELECT parent_id FROM t) returns nothing. The most likely cause:',
          options: ['The subquery is empty', 'parent_id contains at least one NULL', 'id is indexed'],
          answer: 1,
          explain: 'x <> NULL is unknown, so the conjunction behind NOT IN can never be true. NOT EXISTS avoids this entirely.'
        }
      ]
    },

    {
      id: 'exists-correlated',
      title: 'EXISTS, NOT EXISTS and correlation',
      lede: 'The most robust way to ask "is there a matching row?" — and the right tool for anti-joins.',
      body: `
        ## EXISTS
        \`EXISTS (subquery)\` is true if the subquery returns **at least one row**. What the subquery
        selects is irrelevant, which is why the convention is \`SELECT 1\`:

        ~~~sql
        SELECT c.company_name
        FROM customers c
        WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)
        ORDER BY c.company_name;
        ~~~

        The correlation (\`o.customer_id = c.customer_id\`) is what makes it a per-row question. The engine
        can stop at the first match, which is why \`EXISTS\` is often faster than \`IN\` on large child
        tables, and never slower in practice.

        ## NOT EXISTS: the safe anti-join
        ~~~sql
        SELECT c.company_name
        FROM customers c
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)
        ORDER BY c.company_name;
        ~~~

        Unlike \`NOT IN\`, this is **immune to NULLs**: a NULL \`customer_id\` in \`orders\` simply fails
        the correlation and does not match, which is exactly the intent.

        ## Several conditions in the correlation
        \`EXISTS\` can express conditions a join would need extra care for:

        ~~~sql
        -- customers who ordered a product from the Monitors category
        SELECT DISTINCT c.company_name
        FROM customers c
        WHERE EXISTS (
          SELECT 1
          FROM orders o
          JOIN order_items i ON i.order_id = o.order_id
          JOIN products p    ON p.product_id = i.product_id
          JOIN categories cat ON cat.category_id = p.category_id
          WHERE o.customer_id = c.customer_id
            AND cat.category_name = 'Monitors'
        )
        ORDER BY c.company_name;
        ~~~

        The \`DISTINCT\` here is actually unnecessary — \`EXISTS\` cannot duplicate outer rows. Compare with
        the pure-join version, where \`DISTINCT\` would be required and the planner has more rows to carry.

        ## "For all" with double negation
        SQL has no \`FOR ALL\` quantifier. "Customers whose every order is delivered" becomes
        "customers for whom **no** order is not delivered":

        ~~~sql
        SELECT c.company_name, count(o.order_id) AS orders
        FROM customers c
        JOIN orders o ON o.customer_id = c.customer_id
        WHERE NOT EXISTS (
          SELECT 1 FROM orders o2
          WHERE o2.customer_id = c.customer_id AND o2.status <> 'delivered'
        )
        GROUP BY c.customer_id, c.company_name
        ORDER BY c.company_name;
        ~~~

        This double-negation pattern is worth memorising: it is how relational division is expressed.

        ## EXISTS, IN or JOIN?
        | Question | Best tool |
        | --- | --- |
        | Does a related row exist? | \`EXISTS\` |
        | Does the value appear in this list of literals? | \`IN\` |
        | Is a related row missing? | \`NOT EXISTS\` |
        | I need columns from the other table | \`JOIN\` |
        | Every related row satisfies X | \`NOT EXISTS\` with the negated condition |
      `,
      exercises: [
        {
          prompt: 'Return `product_name` for products that have at least one review, using `EXISTS`. Order by `product_name`.',
          starter: '',
          solution: 'SELECT p.product_name\nFROM products p\nWHERE EXISTS (SELECT 1 FROM reviews r WHERE r.product_id = p.product_id)\nORDER BY p.product_name;',
          orderMatters: true,
          requireSql: [{ pattern: 'exists', msg: 'Use `EXISTS` for this one.' }],
          hints: ['Correlate the subquery on `product_id`.'],
          explain: 'A semi-join: no duplicates, no DISTINCT needed.'
        },
        {
          prompt: 'Return `company_name` and `city` for customers who have **never** placed an order, using `NOT EXISTS`. Order by `company_name`.',
          starter: '',
          solution: 'SELECT c.company_name, c.city\nFROM customers c\nWHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)\nORDER BY c.company_name;',
          orderMatters: true,
          requireSql: [{ pattern: 'not\\s+exists', msg: 'Use `NOT EXISTS` — it is the NULL-safe anti-join.' }],
          hints: ['Same shape as EXISTS, negated.'],
          explain: 'The same three customers you found with LEFT JOIN / IS NULL, expressed more directly.'
        },
        {
          prompt: 'Return `order_id` and `status` for orders that have **no payment** recorded, ordered by `order_id`, limited to the first 10.',
          starter: '',
          solution: 'SELECT o.order_id, o.status\nFROM orders o\nWHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.order_id)\nORDER BY o.order_id\nLIMIT 10;',
          orderMatters: true,
          hints: ['Correlate on `order_id`.'],
          explain: 'Unpaid orders: mostly cancelled ones and recent pending ones.'
        },
        {
          prompt: 'Return `company_name` for customers **all** of whose orders are `delivered` (they must have at least one order). Order by `company_name`.',
          starter: '',
          solution: "SELECT c.company_name\nFROM customers c\nWHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)\n  AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = c.customer_id AND o2.status <> 'delivered')\nORDER BY c.company_name;",
          orderMatters: true,
          allowEmpty: true,
          hints: ['"All are delivered" = "none is not delivered".', 'Add an EXISTS so customers with zero orders do not qualify.'],
          explain: 'With this data nobody qualifies — every active customer has at least one non-delivered order. An empty result is the correct answer, and the double negation is the pattern to remember.'
        }
      ],
      quiz: [
        {
          q: 'Why is NOT EXISTS preferred over NOT IN?',
          options: ['It is shorter', 'It behaves correctly when the subquery can produce NULLs', 'NOT IN is non-standard'],
          answer: 1,
          explain: 'NOT IN against a nullable column returns no rows at all; NOT EXISTS is unaffected.'
        }
      ]
    },

    {
      id: 'derived-tables',
      title: 'Derived tables: subqueries in FROM',
      lede: 'Treating a query result as a table — the way to change grain or filter on a computed value.',
      body: `
        ## A query as a table
        A subquery in \`FROM\` is a **derived table**. It needs an alias in most engines (SQLite is
        lenient, but write one anyway):

        ~~~sql
        SELECT round(avg(order_total), 2) AS avg_order_value,
               round(min(order_total), 2) AS smallest,
               round(max(order_total), 2) AS largest
        FROM (
          SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS order_total
          FROM order_items
          GROUP BY order_id
        ) AS totals;
        ~~~

        The inner query sets the **grain** (one row per order); the outer one aggregates across it.
        Any query that needs "an aggregate of an aggregate" has this shape.

        ## Filtering on a computed value
        \`WHERE\` cannot see \`SELECT\` aliases, and \`HAVING\` only understands groups. Wrapping solves both:

        ~~~sql
        SELECT * FROM (
          SELECT product_name, unit_price, round(unit_price * 1.19, 2) AS gross
          FROM products
        ) AS priced
        WHERE gross BETWEEN 100 AND 200
        ORDER BY gross;
        ~~~

        ## Pre-aggregating before a join
        The fix for the fan-out problem from module 05, now with names:

        ~~~sql
        SELECT c.company_name,
               COALESCE(o.orders, 0)            AS orders,
               COALESCE(round(o.revenue, 2), 0)  AS revenue
        FROM customers c
        LEFT JOIN (
          SELECT o.customer_id,
                 count(DISTINCT o.order_id) AS orders,
                 sum(i.unit_price * i.quantity * (1 - i.discount)) AS revenue
          FROM orders o
          JOIN order_items i ON i.order_id = o.order_id
          WHERE o.status <> 'cancelled'
          GROUP BY o.customer_id
        ) AS o ON o.customer_id = c.customer_id
        ORDER BY revenue DESC, c.company_name;
        ~~~

        ## Lateral joins
        A plain derived table cannot reference the outer row. When you need that — "the 2 most recent
        orders *for each* customer" — standard SQL has \`LATERAL\`:

        ~~~sql-static
        SELECT c.company_name, recent.order_id, recent.order_date
        FROM customers c
        CROSS JOIN LATERAL (
          SELECT order_id, order_date FROM orders o
          WHERE o.customer_id = c.customer_id
          ORDER BY order_date DESC LIMIT 2
        ) AS recent;
        ~~~

        \`LATERAL\` works in PostgreSQL and MySQL 8+; SQL Server spells it \`CROSS APPLY\` / \`OUTER APPLY\`;
        Oracle supports both. SQLite has none of them — use \`ROW_NUMBER()\` (module 08), which is the
        portable answer anyway.

        ## Readability
        Derived tables nest, and three levels deep they become hard to follow: the reader has to work
        bottom-up through parentheses. \`WITH\` (next lesson) is the same thing with names at the top.
      `,
      exercises: [
        {
          prompt: 'Return the average number of order lines per order as `avg_lines`, rounded to 2: count lines per order in a derived table, then average.',
          starter: 'SELECT round(avg(lines), 2) AS avg_lines\nFROM (\n  \n) AS per_order;',
          solution: 'SELECT round(avg(lines), 2) AS avg_lines\nFROM (\n  SELECT order_id, count(*) AS lines\n  FROM order_items\n  GROUP BY order_id\n) AS per_order;',
          hints: ['Inner: one row per order with its line count.', 'Outer: average that count.'],
          explain: 'Two-step aggregation: the inner query decides what "one thing" is.'
        },
        {
          prompt: 'Return `product_name` and `gross` (price × 1.19, rounded to 2) for products whose gross price is between 100 and 200, by filtering on the computed column in an outer query. Order by `gross` then `product_name`.',
          starter: '',
          solution: 'SELECT product_name, gross FROM (\n  SELECT product_name, round(unit_price * 1.19, 2) AS gross\n  FROM products\n) AS priced\nWHERE gross BETWEEN 100 AND 200\nORDER BY gross, product_name;',
          orderMatters: true,
          hints: ['Compute inside, filter outside.'],
          explain: 'Exactly what a CTE does more legibly — same plan, better reading.'
        },
        {
          prompt: 'Per country, return `country`, `customers` and `avg_orders_per_customer` (rounded to 2): first count orders per customer (including zero), then aggregate by country. Order by `avg_orders_per_customer` descending, then `country`.',
          starter: '',
          solution: 'SELECT country, count(*) AS customers, round(avg(orders), 2) AS avg_orders_per_customer\nFROM (\n  SELECT c.customer_id, c.country,\n         (SELECT count(*) FROM orders o WHERE o.customer_id = c.customer_id) AS orders\n  FROM customers c\n) AS per_customer\nGROUP BY country\nORDER BY avg_orders_per_customer DESC, country;',
          orderMatters: true,
          hints: ['The inner query must produce one row per customer, with a 0 for those without orders.', 'A correlated subquery or a LEFT JOIN + GROUP BY both work inside.'],
          explain: 'Two grains in one query: per customer inside, per country outside. Averaging a per-customer value is only correct at that grain.'
        }
      ]
    },

    {
      id: 'cte',
      title: 'Common table expressions (WITH)',
      lede: 'Naming the steps of a query. The single biggest readability win in SQL.',
      body: `
        ## WITH
        A CTE is a named subquery declared before the main query:

        ~~~sql
        WITH order_totals AS (
          SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS order_total
          FROM order_items
          GROUP BY order_id
        )
        SELECT round(avg(order_total), 2) AS avg_order_value,
               round(max(order_total), 2) AS biggest
        FROM order_totals;
        ~~~

        Identical in meaning to the derived table of the previous lesson, but it reads top-down and the
        name documents the grain.

        ## Several CTEs, each building on the last
        ~~~sql
        WITH line_revenue AS (
          SELECT o.order_id, o.customer_id, o.order_date,
                 i.unit_price * i.quantity * (1 - i.discount) AS line_total
          FROM orders o
          JOIN order_items i ON i.order_id = o.order_id
          WHERE o.status <> 'cancelled'
        ),
        monthly AS (
          SELECT strftime('%Y-%m', order_date) AS month,
                 sum(line_total) AS revenue,
                 count(DISTINCT order_id) AS orders
          FROM line_revenue
          GROUP BY month
        )
        SELECT month, round(revenue, 2) AS revenue, orders,
               round(revenue / orders, 2) AS avg_order_value
        FROM monthly
        ORDER BY month;
        ~~~

        Each CTE is one idea with a name. When a query grows past ~30 lines, this structure is what keeps
        it maintainable — and it makes debugging trivial: swap the final \`SELECT\` for
        \`SELECT * FROM line_revenue LIMIT 20\` to inspect a step.

        ## A CTE can be referenced more than once
        ~~~sql
        WITH dept_avg AS (
          SELECT dept_id, avg(salary) AS avg_salary FROM employees GROUP BY dept_id
        )
        SELECT e.last_name, e.dept_id, e.salary, round(d.avg_salary, 2) AS dept_avg,
               round(e.salary - d.avg_salary, 2) AS diff
        FROM employees e
        JOIN dept_avg d ON d.dept_id = e.dept_id
        WHERE e.salary > d.avg_salary
        ORDER BY diff DESC;
        ~~~

        ## Materialisation and performance
        A CTE is not automatically a temporary table. Engines may **inline** it (substituting the
        definition where it is used) or **materialise** it once. PostgreSQL materialised all CTEs before
        version 12 — an optimisation fence people relied on; now it inlines CTEs used once, and accepts
        \`AS MATERIALIZED\` / \`AS NOT MATERIALIZED\` hints. SQLite also accepts \`MATERIALIZED\`.
        MySQL 8 and SQL Server inline.

        Practical guidance: treat CTEs as a readability device, not as a performance tool. If a CTE is
        referenced many times and is expensive, consider a real temporary table (module 09).

        ## CTEs in DML
        \`WITH\` is not limited to \`SELECT\` — it can feed an \`INSERT\`, \`UPDATE\` or \`DELETE\`
        (module 10), which is how you express "delete the rows this analysis identified".

        :::tip Naming
        Name a CTE after the grain and meaning of its rows: \`order_totals\`, \`monthly_revenue\`,
        \`first_login_per_customer\`. Avoid \`a\`, \`tmp\`, \`step2\`.
        :::
      `,
      exercises: [
        {
          prompt: 'Using a CTE named `order_totals` (one row per order with its revenue), return `orders` (how many orders have items), `avg_order_value` and `max_order_value`, both rounded to 2.',
          starter: 'WITH order_totals AS (\n  \n)\nSELECT ',
          solution: 'WITH order_totals AS (\n  SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS order_total\n  FROM order_items\n  GROUP BY order_id\n)\nSELECT count(*) AS orders,\n       round(avg(order_total), 2) AS avg_order_value,\n       round(max(order_total), 2) AS max_order_value\nFROM order_totals;',
          requireSql: [{ pattern: '\\bwith\\b', msg: 'Write it with a `WITH` clause.' }],
          hints: ['The CTE groups `order_items` by `order_id`.'],
          explain: 'Same result as the derived-table version, read top to bottom.'
        },
        {
          prompt: 'Return monthly revenue for non-cancelled orders: `month` (`YYYY-MM`), `orders` (distinct orders), `revenue` (rounded to 2) and `avg_order_value` (revenue / orders, rounded to 2), ordered by month. Use at least one CTE.',
          starter: '',
          solution: "WITH line_revenue AS (\n  SELECT o.order_id, o.order_date,\n         i.unit_price * i.quantity * (1 - i.discount) AS line_total\n  FROM orders o\n  JOIN order_items i ON i.order_id = o.order_id\n  WHERE o.status <> 'cancelled'\n),\nmonthly AS (\n  SELECT strftime('%Y-%m', order_date) AS month,\n         count(DISTINCT order_id) AS orders,\n         sum(line_total) AS revenue\n  FROM line_revenue\n  GROUP BY month\n)\nSELECT month, orders, round(revenue, 2) AS revenue, round(revenue / orders, 2) AS avg_order_value\nFROM monthly\nORDER BY month;",
          orderMatters: true,
          requireSql: [{ pattern: '\\bwith\\b', msg: 'Use a `WITH` clause (one or two CTEs).' }],
          hints: ['First CTE: one row per order line with its total.', 'Second CTE: aggregate to one row per month.', 'Final SELECT: derive the average from the two measures.'],
          explain: 'The classic reporting pipeline: facts, then grouping, then derived ratios — one named step each.'
        },
        {
          prompt: 'Using a CTE of department averages, return `last_name`, `dept_id`, `salary` and `diff` (salary minus the department average, rounded to 2) for employees paid above their own department average, biggest difference first.',
          starter: '',
          solution: 'WITH dept_avg AS (\n  SELECT dept_id, avg(salary) AS avg_salary FROM employees GROUP BY dept_id\n)\nSELECT e.last_name, e.dept_id, e.salary, round(e.salary - d.avg_salary, 2) AS diff\nFROM employees e\nJOIN dept_avg d ON d.dept_id = e.dept_id\nWHERE e.salary > d.avg_salary\nORDER BY diff DESC;',
          orderMatters: true,
          hints: ['Join the employee back to the aggregate of their own department.', 'Module 08 does this in one pass with a window function.'],
          explain: 'Comparing a row against its group aggregate: the CTE+join form, which every engine supports.'
        }
      ],
      quiz: [
        {
          q: 'Is a CTE always materialised into a temporary result?',
          options: ['Yes, always', 'No — engines may inline it, and that behaviour has changed between versions', 'Only in SQLite'],
          answer: 1,
          explain: 'Treat CTEs as naming, not as an optimisation barrier, unless your engine gives you an explicit MATERIALIZED hint.'
        }
      ]
    },

    {
      id: 'recursive-cte',
      title: 'Recursive CTEs',
      lede: 'Hierarchies, graph walks and generated series — the one piece of SQL that loops.',
      body: `
        ## The shape
        ~~~sql-static
        WITH RECURSIVE name(columns) AS (
            <anchor query>        -- the starting rows
          UNION ALL
            <recursive query>     -- references "name", produces the next rows
        )
        SELECT * FROM name;
        ~~~

        The engine evaluates the anchor, then repeatedly runs the recursive part against the rows added in
        the previous round, until a round produces nothing.

        ## A number series
        ~~~sql
        WITH RECURSIVE n(i) AS (
          SELECT 1
          UNION ALL
          SELECT i + 1 FROM n WHERE i < 10
        )
        SELECT i, i * i AS squared FROM n;
        ~~~

        The \`WHERE i < 10\` is the **termination condition**. Forget it and the query runs until the
        engine's recursion limit (or forever). PostgreSQL and MySQL need \`RECURSIVE\`; SQL Server and
        Oracle do not use the keyword at all but the structure is the same.

        ## Walking a hierarchy down
        \`employees.manager_id\` is a tree. Everyone reporting (directly or not) to employee 2:

        ~~~sql
        WITH RECURSIVE reports(emp_id, last_name, manager_id, depth) AS (
          SELECT emp_id, last_name, manager_id, 0
          FROM employees WHERE emp_id = 2
          UNION ALL
          SELECT e.emp_id, e.last_name, e.manager_id, r.depth + 1
          FROM employees e
          JOIN reports r ON e.manager_id = r.emp_id
        )
        SELECT depth, emp_id, last_name FROM reports ORDER BY depth, last_name;
        ~~~

        ## Walking up, and building a path
        ~~~sql
        WITH RECURSIVE chain(emp_id, last_name, manager_id, path, depth) AS (
          SELECT emp_id, last_name, manager_id, last_name, 0
          FROM employees WHERE emp_id = 8
          UNION ALL
          SELECT m.emp_id, m.last_name, m.manager_id,
                 c.path || ' < ' || m.last_name, c.depth + 1
          FROM employees m
          JOIN chain c ON m.emp_id = c.manager_id
        )
        SELECT depth, last_name, path FROM chain ORDER BY depth;
        ~~~

        ## A full org chart with indentation
        ~~~sql
        WITH RECURSIVE tree(emp_id, label, depth, sort_path) AS (
          SELECT emp_id, last_name, 0, last_name
          FROM employees WHERE manager_id IS NULL
          UNION ALL
          SELECT e.emp_id,
                 substr('                    ', 1, t.depth * 2 + 2) || e.last_name,
                 t.depth + 1,
                 t.sort_path || '/' || e.last_name
          FROM employees e
          JOIN tree t ON e.manager_id = t.emp_id
        )
        SELECT depth, label FROM tree ORDER BY sort_path;
        ~~~

        The \`sort_path\` column is the trick that makes the output come out in tree order rather than
        level order.

        ## Dates, and other generated sets
        ~~~sql
        WITH RECURSIVE months(m) AS (
          SELECT '2025-01'
          UNION ALL
          SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM months WHERE m < '2025-12'
        )
        SELECT m FROM months;
        ~~~

        PostgreSQL has \`generate_series\`, SQL Server \`GENERATE_SERIES\` (2022+), and SQLite has table
        functions in some builds — but the recursive CTE works everywhere.

        ## Cycles
        In a graph (not a tree) a recursive CTE can loop forever. Guard it by carrying the visited path
        and refusing to revisit:

        ~~~sql-static
        WHERE instr(c.path, '/' || next_node || '/') = 0
        ~~~

        PostgreSQL 14+ has \`CYCLE node SET is_cycle USING path\`; Oracle has \`CONNECT BY NOCYCLE\`.

        :::warn UNION vs UNION ALL
        \`UNION ALL\` is normal in a recursive CTE. \`UNION\` deduplicates each round, which can hide a
        cycle but costs a comparison every iteration — and changes the result when duplicate paths are
        meaningful.
        :::
      `,
      exercises: [
        {
          prompt: 'Generate the numbers 1 to 12 with a recursive CTE: one column `i`, ordered ascending.',
          starter: 'WITH RECURSIVE n(i) AS (\n  \n)\nSELECT i FROM n ORDER BY i;',
          solution: 'WITH RECURSIVE n(i) AS (\n  SELECT 1\n  UNION ALL\n  SELECT i + 1 FROM n WHERE i < 12\n)\nSELECT i FROM n ORDER BY i;',
          orderMatters: true,
          requireSql: [{ pattern: 'recursive', msg: 'Use `WITH RECURSIVE`.' }],
          hints: ['Anchor: `SELECT 1`. Recursive: `SELECT i + 1 FROM n WHERE i < 12`.'],
          explain: 'The termination condition belongs in the recursive branch.'
        },
        {
          prompt: 'List everybody who reports to employee 4, directly or indirectly: `emp_id`, `last_name` and `depth` (1 for direct reports), ordered by `depth` then `last_name`.',
          starter: '',
          solution: 'WITH RECURSIVE reports(emp_id, last_name, depth) AS (\n  SELECT emp_id, last_name, 1\n  FROM employees WHERE manager_id = 4\n  UNION ALL\n  SELECT e.emp_id, e.last_name, r.depth + 1\n  FROM employees e\n  JOIN reports r ON e.manager_id = r.emp_id\n)\nSELECT emp_id, last_name, depth FROM reports ORDER BY depth, last_name;',
          orderMatters: true,
          requireSql: [{ pattern: 'recursive', msg: 'Use a recursive CTE — a single join only finds direct reports.' }],
          hints: ['Anchor: the direct reports of 4, at depth 1.', 'Recursive step: employees whose manager is already in the set.'],
          explain: 'Arbitrary-depth traversal is exactly what a plain join cannot do.'
        },
        {
          prompt: 'Return the management chain **above** employee 18: `depth` (0 for employee 18 itself) and `last_name`, ordered by `depth`.',
          starter: '',
          solution: 'WITH RECURSIVE chain(emp_id, last_name, manager_id, depth) AS (\n  SELECT emp_id, last_name, manager_id, 0\n  FROM employees WHERE emp_id = 18\n  UNION ALL\n  SELECT m.emp_id, m.last_name, m.manager_id, c.depth + 1\n  FROM employees m\n  JOIN chain c ON m.emp_id = c.manager_id\n)\nSELECT depth, last_name FROM chain ORDER BY depth;',
          orderMatters: true,
          hints: ['Walk up: join the manager row onto the current row.', 'The anchor is the employee itself at depth 0.'],
          explain: 'Walking up and walking down differ only in which side of the join condition the recursive reference sits on.'
        },
        {
          prompt: 'Build a month spine for 2025: one column `month` with the 12 values `2025-01` … `2025-12`, ordered.',
          starter: '',
          solution: "WITH RECURSIVE months(m) AS (\n  SELECT '2025-01'\n  UNION ALL\n  SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM months WHERE m < '2025-12'\n)\nSELECT m AS month FROM months ORDER BY month;",
          orderMatters: true,
          hints: ['Add a month with `date(m || \'-01\', \'+1 month\')`, then re-format with `strftime`.'],
          explain: 'A spine you can LEFT JOIN facts onto, so empty months still appear in the report.'
        }
      ],
      quiz: [
        {
          q: 'What stops a recursive CTE?',
          options: ['A LIMIT in the outer query', 'The recursive branch returning no rows', 'The RECURSIVE keyword'],
          answer: 1,
          explain: 'Iteration ends when a round adds nothing, which is why the recursive branch needs a predicate that eventually fails.'
        }
      ]
    }
  ]
});
