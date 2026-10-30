(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'windows',
  title: 'Window functions',
  blurb: 'Ranking, running totals, lag/lead, frames and top-N-per-group — aggregates without collapsing rows.',
  lessons: [

    {
      id: 'window-basics',
      title: 'OVER and PARTITION BY',
      lede: 'Computing an aggregate for each row while keeping every row — the feature that replaced a decade of self joins.',
      body: `
        ## The idea
        \`GROUP BY\` collapses rows. A **window function** computes a value over a set of related rows and
        attaches it to each row, leaving the row count untouched:

        ~~~sql
        SELECT last_name, dept_id, salary,
               round(avg(salary) OVER (), 2)                         AS company_avg,
               round(avg(salary) OVER (PARTITION BY dept_id), 2)      AS dept_avg,
               round(salary - avg(salary) OVER (PARTITION BY dept_id), 2) AS vs_dept
        FROM employees
        ORDER BY dept_id, salary DESC;
        ~~~

        One pass, 22 rows out of 22 rows in, each carrying both its own salary and its department's
        average. The CTE-and-join version from module 07 needed two passes and a join.

        ## Anatomy
        ~~~sql-static
        function(args) OVER (
          PARTITION BY expr, ...     -- split rows into independent groups (optional)
          ORDER BY expr, ...         -- order within the partition (optional)
          frame                      -- which rows of the partition to use (optional)
        )
        ~~~

        - **No \`PARTITION BY\`** — the whole result set is one window.
        - **\`PARTITION BY\`** is to windows what \`GROUP BY\` is to aggregates, except nothing collapses.
        - **\`ORDER BY\`** inside \`OVER\` has nothing to do with the query's final \`ORDER BY\`; it defines
          the sequence the function sees (and implies a default frame — see the frames lesson).

        ## Share of total, properly
        ~~~sql
        SELECT category_id,
               count(*) AS products,
               round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct_of_all
        FROM products
        GROUP BY category_id
        ORDER BY category_id;
        ~~~

        The window runs **after** aggregation, so \`sum(count(*)) OVER ()\` totals the grouped counts.
        That is the one-pass version of the scalar-subquery trick from module 04.

        ## Window vs GROUP BY
        | Need | Tool |
        | --- | --- |
        | one row per group | \`GROUP BY\` |
        | every row, plus its group's aggregate | window |
        | compare a row with its group | window |
        | rank rows inside a group | window |
        | filter on the aggregate | \`GROUP BY\` + \`HAVING\` |
        | filter on the window value | window inside a subquery, then \`WHERE\` |

        They combine freely: a window function may take an aggregate as its argument, as above.

        ## Where windows are allowed
        Only in \`SELECT\` and \`ORDER BY\`. Never in \`WHERE\`, \`GROUP BY\` or \`HAVING\` — those run
        earlier (module 04). To filter on a window result, wrap the query:

        ~~~sql
        SELECT * FROM (
          SELECT last_name, dept_id, salary,
                 avg(salary) OVER (PARTITION BY dept_id) AS dept_avg
          FROM employees
        ) AS t
        WHERE salary > dept_avg
        ORDER BY dept_id, salary DESC;
        ~~~

        :::dialect Availability
        Window functions are standard since SQL:2003 and present in PostgreSQL 8.4+, SQL Server 2005+
        (frames from 2012), Oracle 8i+, MySQL 8.0+, SQLite 3.25+. Only legacy MySQL 5.7 lacks them.
        :::
      `,
      exercises: [
        {
          prompt: 'Return `last_name`, `dept_id`, `salary` and `dept_avg` (the average salary of the employee’s department, rounded to 2) for every employee — all 22 rows. Order by `dept_id` then `salary` descending.',
          starter: '',
          solution: 'SELECT last_name, dept_id, salary,\n       round(avg(salary) OVER (PARTITION BY dept_id), 2) AS dept_avg\nFROM employees\nORDER BY dept_id, salary DESC;',
          orderMatters: false,
          requireSql: [{ pattern: 'over\\s*\\(', msg: 'Use a window function, not a GROUP BY with a join.' }],
          hints: ['`avg(salary) OVER (PARTITION BY dept_id)`.'],
          explain: 'No rows are lost: the aggregate rides along with each row.'
        },
        {
          prompt: 'Return `product_id`, `unit_price`, `category_id` and `pct_of_category` — the product’s price as a percentage of the total price of its category, rounded to 1. Order by `category_id` then `product_id`.',
          starter: '',
          solution: 'SELECT product_id, unit_price, category_id,\n       round(100.0 * unit_price / sum(unit_price) OVER (PARTITION BY category_id), 1) AS pct_of_category\nFROM products\nORDER BY category_id, product_id;',
          orderMatters: true,
          hints: ['The denominator is a windowed `sum` over the category partition.'],
          explain: 'Share-within-group in one pass — no self join, no subquery.'
        },
        {
          prompt: 'Return `last_name`, `dept_id` and `salary` for employees who earn more than their own department average, ordered by `dept_id` then `salary` descending. (Window functions cannot be filtered directly — wrap the query.)',
          starter: 'SELECT last_name, dept_id, salary FROM (\n  \n) AS t\nWHERE ',
          solution: 'SELECT last_name, dept_id, salary FROM (\n  SELECT last_name, dept_id, salary,\n         avg(salary) OVER (PARTITION BY dept_id) AS dept_avg\n  FROM employees\n) AS t\nWHERE salary > dept_avg\nORDER BY dept_id, salary DESC;',
          orderMatters: true,
          hints: ['Compute the window in the inner query, filter in the outer one.'],
          explain: 'The wrap-and-filter pattern is how every engine without QUALIFY handles this.'
        }
      ],
      quiz: [
        {
          q: 'How many rows does SELECT x, sum(x) OVER () FROM t return for a 100-row table?',
          options: ['1', '100', '100 groups'],
          answer: 1,
          explain: 'Windows never collapse rows; every row gets the aggregate attached.'
        }
      ]
    },

    {
      id: 'ranking',
      title: 'Ranking: ROW_NUMBER, RANK, DENSE_RANK, NTILE',
      lede: 'Numbering rows inside a partition — and the top-N-per-group pattern you will use constantly.',
      body: `
        ## The four functions
        All of them need an \`ORDER BY\` inside \`OVER\`:

        ~~~sql
        SELECT last_name, dept_id, salary,
               ROW_NUMBER() OVER (ORDER BY salary DESC) AS rn,
               RANK()       OVER (ORDER BY salary DESC) AS rnk,
               DENSE_RANK() OVER (ORDER BY salary DESC) AS dense,
               NTILE(4)     OVER (ORDER BY salary DESC) AS quartile
        FROM employees
        ORDER BY salary DESC;
        ~~~

        | Function | On ties | Gaps |
        | --- | --- | --- |
        | \`ROW_NUMBER()\` | arbitrary distinct numbers | never |
        | \`RANK()\` | same rank | yes (1,2,2,4) |
        | \`DENSE_RANK()\` | same rank | no (1,2,2,3) |
        | \`NTILE(n)\` | splits into n buckets as evenly as possible | — |

        Two employees here earn 98000 and two earn 86000, so you can see all three behaviours in one
        result. Choose deliberately: a leaderboard that must not show "2nd place" twice wants
        \`ROW_NUMBER\` plus a deterministic tie-breaker; a report of "salary bands" wants \`DENSE_RANK\`.

        ## Top N per group
        This is the single most useful window pattern. Number rows inside each partition, then filter:

        ~~~sql
        SELECT dept_id, last_name, salary, rn
        FROM (
          SELECT dept_id, last_name, salary,
                 ROW_NUMBER() OVER (PARTITION BY dept_id ORDER BY salary DESC, last_name) AS rn
          FROM employees
        ) AS ranked
        WHERE rn <= 2
        ORDER BY dept_id, rn;
        ~~~

        Use \`RANK() <= 2\` instead if you want all tied rows included. Before window functions this
        needed a correlated subquery per group; the window version reads the table once.

        ## Deduplication
        "Keep one row per key, the newest" is the same pattern:

        ~~~sql
        SELECT row_id, company_name, email
        FROM (
          SELECT row_id, company_name, email,
                 ROW_NUMBER() OVER (PARTITION BY lower(trim(company_name))
                                    ORDER BY loaded_at DESC, row_id DESC) AS rn
          FROM staging_customers
        ) AS d
        WHERE rn = 1
        ORDER BY company_name;
        ~~~

        ## Pagination keys and stable numbering
        \`ROW_NUMBER()\` without a unique tie-breaker is **not deterministic**: two rows with equal sort
        keys can swap between runs. Always add a unique column to the window's \`ORDER BY\` when the
        number matters.

        ## NTILE for buckets
        ~~~sql
        SELECT quartile, count(*) AS products,
               round(min(unit_price), 2) AS from_price,
               round(max(unit_price), 2) AS to_price
        FROM (
          SELECT unit_price, NTILE(4) OVER (ORDER BY unit_price) AS quartile
          FROM products
        )
        GROUP BY quartile
        ORDER BY quartile;
        ~~~

        \`NTILE\` splits by **row count**, not by value: equal values can land in different buckets. For
        value-based cuts use \`PERCENT_RANK\` or explicit boundaries.
      `,
      exercises: [
        {
          prompt: 'Return the top 2 earners per department: `dept_id`, `last_name`, `salary`, `rn`. Use `ROW_NUMBER()` with `salary DESC, last_name` inside each department, and order the output by `dept_id`, `rn`.',
          starter: '',
          solution: 'SELECT dept_id, last_name, salary, rn FROM (\n  SELECT dept_id, last_name, salary,\n         ROW_NUMBER() OVER (PARTITION BY dept_id ORDER BY salary DESC, last_name) AS rn\n  FROM employees\n) AS ranked\nWHERE rn <= 2\nORDER BY dept_id, rn;',
          orderMatters: true,
          requireSql: [{ pattern: 'row_number', msg: 'Use `ROW_NUMBER()` for this one.' }],
          hints: ['Partition by `dept_id`, order by `salary DESC, last_name`.', 'Filter `rn <= 2` in an outer query.'],
          explain: 'Top-N-per-group: partition, number, filter. Memorise this shape.'
        },
        {
          prompt: 'Return `last_name`, `salary`, `rnk` (`RANK()`) and `dense` (`DENSE_RANK()`) over all employees by `salary DESC`, ordered by `salary` descending then `last_name`.',
          starter: '',
          solution: 'SELECT last_name, salary,\n       RANK() OVER (ORDER BY salary DESC) AS rnk,\n       DENSE_RANK() OVER (ORDER BY salary DESC) AS dense\nFROM employees\nORDER BY salary DESC, last_name;',
          orderMatters: true,
          hints: ['Two window functions over the same ordering.'],
          explain: 'The two tied pairs show the gap RANK leaves and DENSE_RANK does not.'
        },
        {
          prompt: 'Deduplicate `staging_customers`: return `row_id`, `company_name` and `email` keeping only the **most recently loaded** row per canonical (lower-cased, trimmed) company name, ties broken by the higher `row_id`. Order by `company_name`.',
          starter: '',
          solution: 'SELECT row_id, company_name, email FROM (\n  SELECT row_id, company_name, email,\n         ROW_NUMBER() OVER (PARTITION BY lower(trim(company_name))\n                            ORDER BY loaded_at DESC, row_id DESC) AS rn\n  FROM staging_customers\n) AS d\nWHERE rn = 1\nORDER BY company_name;',
          orderMatters: false,
          hints: ['Partition by the canonical name, order by `loaded_at DESC`.', 'Keep `rn = 1`.'],
          explain: 'The general deduplication recipe: any "keep one per key" rule becomes an ORDER BY inside the window.'
        },
        {
          prompt: 'Return the 3 products with the highest total ordered quantity: `product_id`, `units`, `rnk` — using `RANK()` over `sum(quantity)` so ties would all be kept. Order by `rnk` then `product_id`.',
          starter: '',
          solution: 'SELECT product_id, units, rnk FROM (\n  SELECT product_id, sum(quantity) AS units,\n         RANK() OVER (ORDER BY sum(quantity) DESC) AS rnk\n  FROM order_items\n  GROUP BY product_id\n) AS r\nWHERE rnk <= 3\nORDER BY rnk, product_id;',
          orderMatters: true,
          hints: ['Aggregate and rank in the same inner SELECT — windows run after GROUP BY.'],
          explain: 'A window function over an aggregate: legal, because SELECT (and its windows) are evaluated after grouping.'
        }
      ],
      quiz: [
        {
          q: 'Salaries 100, 90, 90, 80. What does RANK() give the 80?',
          options: ['3', '4', '2'],
          answer: 1,
          explain: 'RANK leaves a gap after the tie: 1, 2, 2, 4. DENSE_RANK would give 3.'
        }
      ]
    },

    {
      id: 'offsets',
      title: 'LAG, LEAD and the value functions',
      lede: 'Reaching into neighbouring rows: differences, growth rates and durations between events.',
      body: `
        ## LAG and LEAD
        \`LAG(expr, offset, default)\` reads a previous row of the partition; \`LEAD\` reads a following one.
        Both need an \`ORDER BY\` in the window.

        ~~~sql
        WITH monthly AS (
          SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders
          FROM orders GROUP BY month
        )
        SELECT month, orders,
               LAG(orders)  OVER (ORDER BY month) AS prev_month,
               orders - LAG(orders) OVER (ORDER BY month) AS change,
               round(100.0 * (orders - LAG(orders) OVER (ORDER BY month))
                     / LAG(orders) OVER (ORDER BY month), 1) AS pct_change
        FROM monthly
        ORDER BY month;
        ~~~

        The first row has no predecessor, so \`LAG\` returns \`NULL\` — supply a default if you prefer:
        \`LAG(orders, 1, 0)\`.

        ## Time between events, per entity
        Partition by the entity and order by time:

        ~~~sql
        SELECT customer_id, order_date,
               LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS prev_order,
               CAST(julianday(order_date)
                    - julianday(LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date))
                    AS INTEGER) AS days_since_prev
        FROM orders
        WHERE customer_id = 2
        ORDER BY order_date;
        ~~~

        This "gap between consecutive events per user" query is the backbone of churn, sessionisation and
        retention analysis.

        ## FIRST_VALUE, LAST_VALUE, NTH_VALUE
        ~~~sql
        SELECT dept_id, last_name, salary,
               FIRST_VALUE(last_name) OVER (PARTITION BY dept_id ORDER BY salary DESC) AS top_earner,
               NTH_VALUE(last_name, 2) OVER (PARTITION BY dept_id ORDER BY salary DESC
                                             RANGE BETWEEN UNBOUNDED PRECEDING
                                                       AND UNBOUNDED FOLLOWING) AS second_earner
        FROM employees
        WHERE dept_id IS NOT NULL
        ORDER BY dept_id, salary DESC;
        ~~~

        ## The LAST_VALUE trap
        With an \`ORDER BY\` and no explicit frame, the window ends at the **current row**, so
        \`LAST_VALUE\` returns the current row's value — almost never what you wanted:

        ~~~sql
        SELECT dept_id, last_name, salary,
               LAST_VALUE(last_name) OVER (PARTITION BY dept_id ORDER BY salary DESC) AS looks_wrong,
               LAST_VALUE(last_name) OVER (PARTITION BY dept_id ORDER BY salary DESC
                                           RANGE BETWEEN UNBOUNDED PRECEDING
                                                     AND UNBOUNDED FOLLOWING) AS lowest_paid
        FROM employees
        WHERE dept_id IS NOT NULL
        ORDER BY dept_id, salary DESC;
        ~~~

        Either spell out the frame, or flip the \`ORDER BY\` and use \`FIRST_VALUE\`. The next lesson
        explains frames properly.

        :::dialect
        \`LAG\`/\`LEAD\`/\`FIRST_VALUE\`/\`LAST_VALUE\` exist in PostgreSQL, SQL Server 2012+, Oracle,
        MySQL 8+, SQLite 3.25+. \`NTH_VALUE\` is missing in SQL Server. \`IGNORE NULLS\`
        (skip NULL neighbours) is supported by Oracle, SQL Server 2022+ and PostgreSQL 16+.
        :::
      `,
      exercises: [
        {
          prompt: 'From monthly order counts, return `month`, `orders`, `prev_month` (previous month’s count) and `change` (this month minus previous), ordered by month.',
          starter: "WITH monthly AS (\n  SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders\n  FROM orders GROUP BY month\n)\nSELECT ",
          solution: "WITH monthly AS (\n  SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders\n  FROM orders GROUP BY month\n)\nSELECT month, orders,\n       LAG(orders) OVER (ORDER BY month) AS prev_month,\n       orders - LAG(orders) OVER (ORDER BY month) AS change\nFROM monthly\nORDER BY month;",
          orderMatters: true,
          requireSql: [{ pattern: 'lag\\s*\\(', msg: 'Use `LAG()` to reach the previous row.' }],
          hints: ['`LAG(orders) OVER (ORDER BY month)`.', 'The first row’s `change` is NULL — that is correct.'],
          explain: 'Month-over-month change, the most common LAG use.'
        },
        {
          prompt: 'For customer 2, return `order_date`, `prev_order` and `days_since_prev` (whole days) for each of their orders, ordered by `order_date`.',
          starter: '',
          solution: 'SELECT order_date,\n       LAG(order_date) OVER (ORDER BY order_date) AS prev_order,\n       CAST(julianday(order_date) - julianday(LAG(order_date) OVER (ORDER BY order_date)) AS INTEGER) AS days_since_prev\nFROM orders\nWHERE customer_id = 2\nORDER BY order_date;',
          orderMatters: true,
          hints: ['Filter to one customer, so no PARTITION BY is needed.', 'Subtract the julianday values.'],
          explain: 'With more than one customer in scope you would add `PARTITION BY customer_id`.'
        },
        {
          prompt: 'Return `dept_id`, `last_name`, `salary` and `top_earner` — the last name of the highest-paid person in that department — for employees with a department. Order by `dept_id`, `salary` descending.',
          starter: '',
          solution: 'SELECT dept_id, last_name, salary,\n       FIRST_VALUE(last_name) OVER (PARTITION BY dept_id ORDER BY salary DESC) AS top_earner\nFROM employees\nWHERE dept_id IS NOT NULL\nORDER BY dept_id, salary DESC;',
          orderMatters: false,
          hints: ['`FIRST_VALUE` with the partition ordered by salary descending.'],
          explain: 'FIRST_VALUE is safe with the default frame; LAST_VALUE is not.'
        }
      ],
      quiz: [
        {
          q: 'LAST_VALUE(x) OVER (ORDER BY d) returns the current row’s x. Why?',
          options: ['A bug in the engine', 'The default frame ends at the current row', 'LAST_VALUE needs PARTITION BY'],
          answer: 1,
          explain: 'With ORDER BY and no frame clause the frame is UNBOUNDED PRECEDING to CURRENT ROW, so the last row in frame is the current one.'
        }
      ]
    },

    {
      id: 'frames',
      title: 'Frames: running totals and moving averages',
      lede: 'Which rows the window actually sees — the detail that decides whether your running total is right.',
      body: `
        ## The default frame
        - \`OVER ()\` with **no \`ORDER BY\`**: the frame is the **entire partition**.
        - \`OVER (ORDER BY x)\`: the frame is \`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW\` —
          everything up to and including the current row (**and all its peers**, rows with the same
          \`ORDER BY\` value).

        That second default is what makes running totals so concise:

        ~~~sql
        WITH daily AS (
          SELECT order_date, count(*) AS orders
          FROM orders WHERE order_date < '2024-02-01'
          GROUP BY order_date
        )
        SELECT order_date, orders,
               sum(orders) OVER (ORDER BY order_date) AS running_total
        FROM daily
        ORDER BY order_date;
        ~~~

        ## Writing frames explicitly
        ~~~sql-static
        ROWS   BETWEEN 6 PRECEDING AND CURRENT ROW      -- 7 physical rows
        RANGE  BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        GROUPS BETWEEN 1 PRECEDING AND 1 FOLLOWING      -- peer groups (SQLite, PostgreSQL 11+)
        ROWS   BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ~~~

        - \`ROWS\` counts **rows**.
        - \`RANGE\` counts **values** of the \`ORDER BY\` expression: all peers are in or out together.
          With a numeric or date ordering you can also write \`RANGE BETWEEN INTERVAL '7' DAY PRECEDING ...\`
          where supported.
        - \`GROUPS\` counts peer groups.

        \`ROWS\` versus \`RANGE\` matters whenever duplicates exist in the ordering column: a running total
        \`OVER (ORDER BY order_date)\` jumps by the whole day at each distinct date, while
        \`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW\` adds row by row.

        ## Moving average
        ~~~sql
        WITH daily AS (
          SELECT order_date, count(*) AS orders
          FROM orders WHERE order_date BETWEEN '2025-06-01' AND '2025-07-31'
          GROUP BY order_date
        )
        SELECT order_date, orders,
               round(avg(orders) OVER (ORDER BY order_date
                                       ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS avg_7,
               sum(orders) OVER (ORDER BY order_date
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative
        FROM daily
        ORDER BY order_date;
        ~~~

        The first rows average over fewer than 7 values — partial windows are normal. Filter them out
        with a \`count(*) OVER (...) = 7\` test if the report needs full windows only.

        ## Centred and forward-looking frames
        ~~~sql
        WITH daily AS (
          SELECT order_date, count(*) AS orders FROM orders
          WHERE order_date BETWEEN '2025-06-01' AND '2025-06-20' GROUP BY order_date
        )
        SELECT order_date, orders,
               round(avg(orders) OVER (ORDER BY order_date
                                       ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING), 2) AS smoothed,
               sum(orders) OVER (ORDER BY order_date
                                 ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS remaining
        FROM daily
        ORDER BY order_date;
        ~~~

        ## Running total per partition
        Combine \`PARTITION BY\` with a frame — the running total restarts in each partition:

        ~~~sql
        SELECT customer_id, order_date,
               round(freight, 2) AS freight,
               round(sum(freight) OVER (PARTITION BY customer_id ORDER BY order_date, order_id
                                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS running_freight
        FROM orders
        WHERE customer_id IN (1, 2)
        ORDER BY customer_id, order_date, order_id;
        ~~~

        ## Named windows
        When several functions share a window, declare it once:

        ~~~sql
        SELECT order_date, count(*) AS orders,
               sum(count(*)) OVER w AS running,
               round(avg(count(*)) OVER w, 2) AS running_avg
        FROM orders
        WHERE order_date < '2024-02-01'
        GROUP BY order_date
        WINDOW w AS (ORDER BY order_date)
        ORDER BY order_date;
        ~~~

        \`WINDOW\` is supported by SQLite, PostgreSQL, MySQL 8 and Oracle; SQL Server has no named windows.

        :::warn The most common frame bug
        A running total that is "too big" at every step usually means \`RANGE\` semantics over a
        non-unique ordering: all peers of the current row are included. Add a unique tie-breaker to the
        \`ORDER BY\`, or switch to \`ROWS\`.
        :::
      `,
      exercises: [
        {
          prompt: 'For January 2024, return `order_date`, `orders` (orders that day) and `running_total` (cumulative orders from the start of the month), ordered by date.',
          starter: "WITH daily AS (\n  SELECT order_date, count(*) AS orders\n  FROM orders WHERE order_date < '2024-02-01'\n  GROUP BY order_date\n)\nSELECT ",
          solution: "WITH daily AS (\n  SELECT order_date, count(*) AS orders\n  FROM orders WHERE order_date < '2024-02-01'\n  GROUP BY order_date\n)\nSELECT order_date, orders,\n       sum(orders) OVER (ORDER BY order_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total\nFROM daily\nORDER BY order_date;",
          orderMatters: true,
          requireSql: [{ pattern: 'over\\s*\\(', msg: 'Use a windowed `sum`.' }],
          hints: ['`sum(orders) OVER (ORDER BY order_date)` already gives a running total.', 'Spelling out `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` makes it explicit.'],
          explain: 'Running totals are a windowed sum with a frame that starts at the beginning of the partition.'
        },
        {
          prompt: 'For June 2025, return `order_date`, `orders` and `avg_7` — the 7-day moving average of daily order counts (current day plus the 6 before), rounded to 2 — ordered by date.',
          starter: '',
          solution: "WITH daily AS (\n  SELECT order_date, count(*) AS orders\n  FROM orders WHERE order_date >= '2025-06-01' AND order_date < '2025-07-01'\n  GROUP BY order_date\n)\nSELECT order_date, orders,\n       round(avg(orders) OVER (ORDER BY order_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS avg_7\nFROM daily\nORDER BY order_date;",
          orderMatters: true,
          requireSql: [{ pattern: 'rows\\s+between', msg: 'Specify the frame with `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW`.' }],
          hints: ['`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` is 7 rows including the current one.'],
          explain: 'Note this averages over the days present in the data, not over calendar days — a date spine (module 05) fixes that.'
        },
        {
          prompt: 'For customers 1 and 2, return `customer_id`, `order_date`, `freight` (rounded to 2) and `running_freight` — the cumulative freight per customer, ordered by `order_date`, `order_id` — output ordered by `customer_id`, `order_date`, `order_id`.',
          starter: '',
          solution: 'SELECT customer_id, order_date, round(freight, 2) AS freight,\n       round(sum(freight) OVER (PARTITION BY customer_id ORDER BY order_date, order_id\n                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS running_freight\nFROM orders\nWHERE customer_id IN (1, 2)\nORDER BY customer_id, order_date, order_id;',
          orderMatters: true,
          hints: ['`PARTITION BY customer_id` restarts the total for each customer.', 'Add `order_id` to the window ORDER BY so the sequence is unique.'],
          explain: 'Partition plus frame: the two halves of every per-entity running metric.'
        }
      ],
      quiz: [
        {
          q: 'OVER (ORDER BY d) with no frame clause means:',
          options: ['The whole partition', 'RANGE UNBOUNDED PRECEDING to CURRENT ROW (including peers)', 'ROWS 1 PRECEDING to CURRENT ROW'],
          answer: 1,
          explain: 'That default is why running totals work out of the box — and why peers can surprise you.'
        }
      ]
    },

    {
      id: 'distributions',
      title: 'Percentiles and distributions',
      lede: 'PERCENT_RANK, CUME_DIST, medians and quantiles — describing a distribution in SQL.',
      body: `
        ## Relative position
        ~~~sql
        SELECT last_name, salary,
               round(PERCENT_RANK() OVER (ORDER BY salary), 3) AS pct_rank,
               round(CUME_DIST()    OVER (ORDER BY salary), 3) AS cume_dist,
               NTILE(4)             OVER (ORDER BY salary)     AS quartile
        FROM employees
        ORDER BY salary;
        ~~~

        - \`PERCENT_RANK\` = (rank − 1) / (rows − 1): 0 for the lowest, 1 for the highest.
        - \`CUME_DIST\` = fraction of rows ≤ this row: always > 0, reaches 1 at the top.
        - \`NTILE(4)\` assigns bucket numbers by row count.

        ## Median
        No engine-independent \`median()\` exists. Two portable constructions:

        ~~~sql
        -- 1. the middle row(s) by row number
        WITH ranked AS (
          SELECT salary,
                 ROW_NUMBER() OVER (ORDER BY salary) AS rn,
                 count(*) OVER () AS total
          FROM employees
        )
        SELECT round(avg(salary), 2) AS median_salary
        FROM ranked
        WHERE rn IN ((total + 1) / 2, (total + 2) / 2);
        ~~~

        ~~~sql
        -- 2. via CUME_DIST: the first value whose cumulative share reaches 50%
        SELECT min(salary) AS median_ish
        FROM (
          SELECT salary, CUME_DIST() OVER (ORDER BY salary) AS cd FROM employees
        )
        WHERE cd >= 0.5;
        ~~~

        PostgreSQL and Oracle have the standard ordered-set aggregates
        \`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY salary)\` (interpolating) and
        \`PERCENTILE_DISC\` (an actual data value). SQL Server has them as window functions only.
        MySQL and SQLite have neither.

        ## Quantile summary of a distribution
        ~~~sql
        WITH line_values AS (
          SELECT unit_price * quantity * (1 - discount) AS v FROM order_items
        ), ranked AS (
          SELECT v, NTILE(10) OVER (ORDER BY v) AS decile FROM line_values
        )
        SELECT decile, count(*) AS lines,
               round(min(v), 2) AS low, round(max(v), 2) AS high, round(avg(v), 2) AS mean
        FROM ranked
        GROUP BY decile
        ORDER BY decile;
        ~~~

        Deciles expose a skew that a single average hides — the top decile here is worth many times the
        median line.

        ## Histogram with fixed buckets
        When the bucket boundaries should be round numbers rather than equal counts, compute the bucket
        arithmetically:

        ~~~sql
        SELECT CAST(unit_price / 100 AS INTEGER) * 100 AS bucket_from,
               count(*) AS products
        FROM products
        GROUP BY bucket_from
        ORDER BY bucket_from;
        ~~~

        \`width_bucket()\` does this in PostgreSQL and Oracle; elsewhere integer division is the portable
        trick.

        ## Standard deviation
        \`stddev_samp\`, \`stddev_pop\`, \`var_samp\` exist in PostgreSQL, Oracle, MySQL and SQL Server.
        SQLite has none, so compute it from the definition when you need it:

        ~~~sql
        SELECT round(avg(salary), 2) AS mean,
               round(sqrt(avg(salary * salary) - avg(salary) * avg(salary)), 2) AS stddev_pop
        FROM employees;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Return `last_name`, `salary`, `pct_rank` (`PERCENT_RANK()` over ascending salary, rounded to 3) and `quartile` (`NTILE(4)` over ascending salary), ordered by `salary` then `last_name`.',
          starter: '',
          solution: 'SELECT last_name, salary,\n       round(PERCENT_RANK() OVER (ORDER BY salary), 3) AS pct_rank,\n       NTILE(4) OVER (ORDER BY salary) AS quartile\nFROM employees\nORDER BY salary, last_name;',
          orderMatters: false,
          hints: ['Both functions share the same `ORDER BY salary` window.'],
          explain: 'PERCENT_RANK is value-relative; NTILE is count-relative. They disagree on ties, by design.'
        },
        {
          prompt: 'Compute the median salary as `median_salary` (rounded to 2) using `ROW_NUMBER()` and `count(*) OVER ()` — it must be correct for both odd and even row counts.',
          starter: 'WITH ranked AS (\n  \n)\nSELECT ',
          solution: 'WITH ranked AS (\n  SELECT salary,\n         ROW_NUMBER() OVER (ORDER BY salary) AS rn,\n         count(*) OVER () AS total\n  FROM employees\n)\nSELECT round(avg(salary), 2) AS median_salary\nFROM ranked\nWHERE rn IN ((total + 1) / 2, (total + 2) / 2);',
          hints: ['For an even count you average the two middle rows.', '`(total + 1) / 2` and `(total + 2) / 2` with integer division select exactly those.'],
          explain: 'The averaging of the two middle rows is what makes it a true median rather than a "middle-ish" value.'
        },
        {
          prompt: 'Bucket products into 100-wide price bands: return `bucket_from` (0, 100, 200, …) and `products`, ordered by `bucket_from`.',
          starter: '',
          solution: 'SELECT CAST(unit_price / 100 AS INTEGER) * 100 AS bucket_from, count(*) AS products\nFROM products\nGROUP BY bucket_from\nORDER BY bucket_from;',
          orderMatters: true,
          hints: ['Integer-divide by 100, then multiply back.'],
          explain: 'Fixed-width buckets beat NTILE when the boundaries have to be meaningful to a human.'
        }
      ]
    },

    {
      id: 'window-patterns',
      title: 'Window patterns worth memorising',
      lede: 'Five shapes that cover most analytical questions you will be asked.',
      body: `
        ## 1. Top N per group
        ~~~sql
        SELECT category_id, product_name, unit_price FROM (
          SELECT p.category_id, p.product_name, p.unit_price,
                 ROW_NUMBER() OVER (PARTITION BY p.category_id
                                    ORDER BY p.unit_price DESC, p.product_id) AS rn
          FROM products p
        ) WHERE rn = 1
        ORDER BY category_id;
        ~~~

        ## 2. Compare a row with its group
        ~~~sql
        SELECT product_name, category_id, unit_price,
               round(unit_price - avg(unit_price) OVER (PARTITION BY category_id), 2) AS vs_category_avg,
               round(100.0 * unit_price / max(unit_price) OVER (PARTITION BY category_id), 1) AS pct_of_category_max
        FROM products
        ORDER BY category_id, unit_price DESC;
        ~~~

        ## 3. First and latest event per entity
        ~~~sql
        SELECT customer_id, order_id, order_date, seq FROM (
          SELECT customer_id, order_id, order_date,
                 ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, order_id) AS seq
          FROM orders
        ) WHERE seq = 1
        ORDER BY customer_id;
        ~~~

        Swap \`DESC\` into the window's \`ORDER BY\` for the latest, or carry both with
        \`ROW_NUMBER()\` ascending and descending in one pass.

        ## 4. Share of total and cumulative share (Pareto)
        ~~~sql
        WITH product_revenue AS (
          SELECT product_id, sum(unit_price * quantity * (1 - discount)) AS revenue
          FROM order_items GROUP BY product_id
        )
        SELECT product_id,
               round(revenue, 2) AS revenue,
               round(100.0 * revenue / sum(revenue) OVER (), 2) AS pct_of_total,
               round(100.0 * sum(revenue) OVER (ORDER BY revenue DESC, product_id
                                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                     / sum(revenue) OVER (), 2) AS cumulative_pct
        FROM product_revenue
        ORDER BY revenue DESC
        LIMIT 12;
        ~~~

        That \`cumulative_pct\` column is an ABC / Pareto analysis: find where it crosses 80%.

        ## 5. Sessionisation (new group when the gap is large)
        Flag a new session when more than 7 days pass between a customer's orders, then number the
        sessions with a cumulative sum of the flags:

        ~~~sql
        WITH flagged AS (
          SELECT customer_id, order_id, order_date,
                 CASE WHEN julianday(order_date)
                           - julianday(LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date, order_id)) > 7
                        OR LAG(order_date) OVER (PARTITION BY customer_id ORDER BY order_date, order_id) IS NULL
                      THEN 1 ELSE 0 END AS is_new_session
          FROM orders
        )
        SELECT customer_id, order_id, order_date,
               sum(is_new_session) OVER (PARTITION BY customer_id ORDER BY order_date, order_id
                                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_no
        FROM flagged
        WHERE customer_id = 3
        ORDER BY order_date, order_id;
        ~~~

        The same flag-then-cumulative-sum idea powers gaps-and-islands (module 14).

        :::tip Reading a window function
        Ask three questions in order: **which rows are in my partition?** **in what order?** **which part
        of the partition does the frame include?** If you can answer those three, the result is
        predictable.
        :::
      `,
      exercises: [
        {
          prompt: 'Return the most expensive product per category: `category_id`, `product_name`, `unit_price`, ordered by `category_id`. Break price ties with the lower `product_id`.',
          starter: '',
          solution: 'SELECT category_id, product_name, unit_price FROM (\n  SELECT category_id, product_name, unit_price,\n         ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY unit_price DESC, product_id) AS rn\n  FROM products\n) AS r\nWHERE rn = 1\nORDER BY category_id;',
          orderMatters: true,
          hints: ['Partition by category, order by price descending.'],
          explain: 'The ROW_NUMBER = 1 idiom: "the best row per group", with ties resolved explicitly.'
        },
        {
          prompt: 'Return each customer’s **first** order: `customer_id`, `order_id`, `order_date`, ordered by `customer_id`. Use `ROW_NUMBER()` partitioned by customer, ordered by `order_date`, `order_id`.',
          starter: '',
          solution: 'SELECT customer_id, order_id, order_date FROM (\n  SELECT customer_id, order_id, order_date,\n         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, order_id) AS seq\n  FROM orders\n) AS r\nWHERE seq = 1\nORDER BY customer_id;',
          orderMatters: true,
          hints: ['Same shape as top-N, with `seq = 1`.'],
          explain: 'First/latest-event-per-entity is the second most common window pattern after top-N.'
        },
        {
          prompt: 'Pareto analysis of product revenue: return `product_id`, `revenue` (rounded to 2), `pct_of_total` and `cumulative_pct` (both rounded to 2) for the top 10 products by revenue, highest first. Ties broken by `product_id`.',
          starter: 'WITH product_revenue AS (\n  \n)\nSELECT ',
          solution: 'WITH product_revenue AS (\n  SELECT product_id, sum(unit_price * quantity * (1 - discount)) AS revenue\n  FROM order_items GROUP BY product_id\n)\nSELECT product_id,\n       round(revenue, 2) AS revenue,\n       round(100.0 * revenue / sum(revenue) OVER (), 2) AS pct_of_total,\n       round(100.0 * sum(revenue) OVER (ORDER BY revenue DESC, product_id\n                                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)\n             / sum(revenue) OVER (), 2) AS cumulative_pct\nFROM product_revenue\nORDER BY revenue DESC, product_id\nLIMIT 10;',
          orderMatters: true,
          hints: ['`sum(revenue) OVER ()` is the grand total.', 'The cumulative sum needs the same ordering as the output, plus an explicit frame.'],
          explain: 'Two windows over one CTE: a grand total and a running total, divided into a cumulative share.'
        }
      ]
    }
  ]
});
