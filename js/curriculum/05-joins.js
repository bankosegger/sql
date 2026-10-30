(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'joins',
  title: 'Joins',
  blurb: 'Combining tables: inner, left, right, full, self and non-equi joins — and the fan-out trap.',
  lessons: [

    {
      id: 'join-intro',
      title: 'Why joins exist, and CROSS JOIN',
      lede: 'Normalised data is split across tables on purpose. A join puts it back together for one query.',
      body: `
        ## The problem joins solve
        \`orders\` stores a \`customer_id\`, not a company name. That is deliberate: the name lives in
        exactly one place, so correcting it corrects every order at once (module 12). The cost is that
        answering "which company placed order 1001?" requires combining two tables.

        ## CROSS JOIN: every combination
        The simplest join pairs every row of the left table with every row of the right one. It produces
        *n × m* rows and has no \`ON\` clause:

        ~~~sql
        SELECT c.category_name, s.supplier_name
        FROM categories c
        CROSS JOIN suppliers s
        ORDER BY c.category_name, s.supplier_name
        LIMIT 12;
        ~~~

        8 categories × 8 suppliers = 64 rows. \`FROM a, b\` (comma) means the same thing — which is why a
        forgotten join condition produces an explosion rather than an error:

        ~~~sql
        SELECT count(*) AS accidental_cartesian
        FROM orders, customers;          -- 325 x 22 rows
        ~~~

        Deliberate uses of \`CROSS JOIN\` do exist: generating a grid of all month × category combinations
        so a report can show zeros, or joining a single-row table of parameters onto a query.

        ## From cartesian product to inner join
        Conceptually, an inner join **is** a cross join followed by a filter. These two queries are
        equivalent, and a planner treats them identically:

        ~~~sql
        SELECT o.order_id, c.company_name
        FROM orders o, customers c
        WHERE o.customer_id = c.customer_id   -- old-style "implicit" join
        ORDER BY o.order_id LIMIT 5;
        ~~~

        ~~~sql
        SELECT o.order_id, c.company_name
        FROM orders o
        JOIN customers c ON c.customer_id = o.customer_id   -- explicit, preferred
        ORDER BY o.order_id LIMIT 5;
        ~~~

        Prefer the explicit form: the join condition sits next to the table it belongs to, \`WHERE\` keeps
        only real filters, and you cannot accidentally omit a condition without it being visible.

        ## The vocabulary
        | Join | Keeps |
        | --- | --- |
        | \`INNER JOIN\` | rows that match on both sides |
        | \`LEFT [OUTER] JOIN\` | all left rows, matched right columns or NULL |
        | \`RIGHT [OUTER] JOIN\` | all right rows |
        | \`FULL [OUTER] JOIN\` | all rows from both sides |
        | \`CROSS JOIN\` | every combination |
        | self join | a table joined to itself under two aliases |
        | semi-join (\`EXISTS\`) | left rows that have a match, no duplication |
        | anti-join (\`NOT EXISTS\`) | left rows that have no match |

        \`OUTER\` is optional noise: \`LEFT JOIN\` and \`LEFT OUTER JOIN\` are the same thing.
      `,
      exercises: [
        {
          prompt: 'Produce every combination of `dept_name` and `category_name` (6 × 8 = 48 rows) with a `CROSS JOIN`, ordered by `dept_name` then `category_name`.',
          starter: '',
          solution: 'SELECT d.dept_name, c.category_name\nFROM departments d\nCROSS JOIN categories c\nORDER BY d.dept_name, c.category_name;',
          orderMatters: true,
          hints: ['`CROSS JOIN` takes no `ON` clause.'],
          explain: 'A deliberate cartesian product — the building block for "show every combination, even the empty ones".'
        },
        {
          prompt: 'Rewrite this implicit join as an explicit `JOIN ... ON`, returning `order_id` and `company_name` for orders 1001 to 1005, ordered by `order_id`:\n\n~~~sql-static\nSELECT o.order_id, c.company_name\nFROM orders o, customers c\nWHERE o.customer_id = c.customer_id AND o.order_id BETWEEN 1001 AND 1005;\n~~~',
          starter: '',
          solution: 'SELECT o.order_id, c.company_name\nFROM orders o\nJOIN customers c ON c.customer_id = o.customer_id\nWHERE o.order_id BETWEEN 1001 AND 1005\nORDER BY o.order_id;',
          orderMatters: true,
          requireSql: [{ pattern: 'join', msg: 'Use an explicit `JOIN ... ON`.' }],
          hints: ['The equality moves into `ON`, the real filter stays in `WHERE`.'],
          explain: 'Join conditions in ON, row filters in WHERE: the separation is what makes long queries reviewable.'
        }
      ],
      quiz: [
        {
          q: 'A query joining a 1 000-row and a 2 000-row table returns 2 000 000 rows. What is most likely?',
          options: ['A data corruption problem', 'The join condition is missing or always true', 'The tables are too large'],
          answer: 1,
          explain: '1000 × 2000 is exactly the cartesian product — the hallmark of a missing ON condition.'
        }
      ]
    },

    {
      id: 'inner-join',
      title: 'INNER JOIN',
      lede: 'Matching rows across tables — the workhorse of every real query.',
      body: `
        ## ON expresses the relationship
        ~~~sql
        SELECT o.order_id, o.order_date, c.company_name, c.country
        FROM orders o
        JOIN customers c ON c.customer_id = o.customer_id
        ORDER BY o.order_id
        LIMIT 10;
        ~~~

        \`JOIN\` with no qualifier means \`INNER JOIN\`: a row appears only if the condition finds a partner.
        Unmatched rows on either side **disappear** — which is both the point and the hazard. If 3 of your
        22 customers never ordered, this query cannot show them.

        ## Joining more than two tables
        Joins compose left to right; each \`JOIN\` adds a table to the working set:

        ~~~sql
        SELECT o.order_id, c.company_name, p.product_name, i.quantity,
               round(i.unit_price * i.quantity * (1 - i.discount), 2) AS line_total
        FROM orders o
        JOIN customers c   ON c.customer_id = o.customer_id
        JOIN order_items i ON i.order_id = o.order_id
        JOIN products p    ON p.product_id = i.product_id
        WHERE o.order_id = 1002
        ORDER BY line_total DESC;
        ~~~

        The result's **grain** is now one row per order line, not per order. Keep track of that: it decides
        what \`count(*)\` means.

        ## USING
        When both columns have the same name, \`USING (col)\` is shorter and merges the two columns into one
        in the output:

        ~~~sql
        SELECT order_id, product_id, quantity, product_name
        FROM order_items
        JOIN products USING (product_id)
        ORDER BY order_id, product_id
        LIMIT 8;
        ~~~

        \`USING\` is supported by SQLite, PostgreSQL, MySQL and Oracle, but **not** SQL Server. It also
        forbids qualifying that column (\`i.product_id\` is invalid in some engines once merged).

        ## NATURAL JOIN: avoid
        \`NATURAL JOIN\` joins on *every* identically-named column automatically. It looks elegant and
        breaks the moment someone adds a \`created_at\` column to both tables — the join silently gains a
        condition. Never use it in code you keep.

        ## The join condition does not have to be a key
        Any boolean expression is allowed, including several conditions:

        ~~~sql
        SELECT p.product_name, s.supplier_name, s.country
        FROM products p
        JOIN suppliers s ON s.supplier_id = p.supplier_id AND s.rating >= 5
        ORDER BY p.product_name;
        ~~~

        Here the rating test is part of the match, so a product whose supplier is rated 4 produces no row.
        With an inner join, a condition in \`ON\` and the same condition in \`WHERE\` give identical results —
        for outer joins they differ enormously (next lesson).

        :::tip Write ON child = parent consistently
        Pick an order (\`ON c.customer_id = o.customer_id\`) and keep it. Consistency makes a 6-table query
        skimmable and misplaced conditions obvious.
        :::
      `,
      exercises: [
        {
          prompt: 'Return `order_id`, `order_date` and `company_name` for all orders placed by customers in `Japan`, ordered by `order_id`.',
          starter: '',
          solution: "SELECT o.order_id, o.order_date, c.company_name\nFROM orders o\nJOIN customers c ON c.customer_id = o.customer_id\nWHERE c.country = 'Japan'\nORDER BY o.order_id;",
          orderMatters: true,
          hints: ['Join orders to customers, then filter on the customer column.'],
          explain: 'The filter can reference any joined table — the engine will usually apply it before the join anyway.'
        },
        {
          prompt: 'Return `product_name`, `category_name` and `unit_price` for all products in the `Monitors` category, most expensive first.',
          starter: '',
          solution: "SELECT p.product_name, c.category_name, p.unit_price\nFROM products p\nJOIN categories c ON c.category_id = p.category_id\nWHERE c.category_name = 'Monitors'\nORDER BY p.unit_price DESC;",
          orderMatters: true,
          hints: ['Join on `category_id`, filter on `category_name`.'],
          explain: 'Filtering by the human-readable name rather than a magic id number is the normal pattern.'
        },
        {
          prompt: 'For order 1050, list every line: `product_name`, `quantity`, `unit_price` and `line_total` (price × quantity × (1 − discount), rounded to 2), biggest line first.',
          starter: '',
          solution: 'SELECT p.product_name, i.quantity, i.unit_price,\n       round(i.unit_price * i.quantity * (1 - i.discount), 2) AS line_total\nFROM order_items i\nJOIN products p ON p.product_id = i.product_id\nWHERE i.order_id = 1050\nORDER BY line_total DESC;',
          orderMatters: true,
          hints: ['Start from `order_items` — it holds the quantities.'],
          explain: 'Note that `order_items` stores its own `unit_price`: the price at the time of sale, not today’s catalogue price.'
        },
        {
          prompt: 'Return `emp_id`, `last_name` and `dept_name` for every employee **who has a department**, ordered by `dept_name` then `last_name`.',
          starter: '',
          solution: 'SELECT e.emp_id, e.last_name, d.dept_name\nFROM employees e\nJOIN departments d ON d.dept_id = e.dept_id\nORDER BY d.dept_name, e.last_name;',
          orderMatters: true,
          hints: ['An inner join already drops employees whose `dept_id` is NULL.'],
          explain: 'The inner join is the filter: NULL never matches, so the two employees without a department are excluded.'
        }
      ]
    },

    {
      id: 'left-join',
      title: 'LEFT JOIN and anti-joins',
      lede: 'Keeping rows that have no match — and the single most misunderstood detail in SQL: ON versus WHERE.',
      body: `
        ## Keep everything on the left
        \`LEFT JOIN\` returns every row of the left table. Where the right table has no match, its columns
        come back \`NULL\`:

        ~~~sql
        SELECT c.customer_id, c.company_name, o.order_id
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.customer_id
        ORDER BY c.customer_id, o.order_id
        LIMIT 15;
        ~~~

        ## Counting with a LEFT JOIN
        This is how you produce "0" rather than a missing row:

        ~~~sql
        SELECT c.customer_id, c.company_name,
               count(o.order_id) AS orders              -- count a RIGHT-side column!
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.customer_id
        GROUP BY c.customer_id, c.company_name
        ORDER BY orders, c.company_name;
        ~~~

        \`count(o.order_id)\` returns 0 for customers with no orders, because \`count(col)\` skips NULLs.
        \`count(*)\` would return **1** for them — it counts the padded row. Getting this wrong is an
        extremely common reporting bug.

        ## Anti-join: rows with no match
        Filter for the NULL that the outer join produced:

        ~~~sql
        SELECT c.customer_id, c.company_name
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.customer_id
        WHERE o.order_id IS NULL
        ORDER BY c.customer_id;
        ~~~

        The equivalent, usually clearer and often faster, is \`NOT EXISTS\` (module 07):

        ~~~sql
        SELECT c.customer_id, c.company_name
        FROM customers c
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)
        ORDER BY c.customer_id;
        ~~~

        ## ON versus WHERE — the critical distinction
        For an **outer** join these are different queries:

        ~~~sql
        -- condition in ON: all customers kept; only cancelled orders are attached
        SELECT c.company_name, count(o.order_id) AS cancelled_orders
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'cancelled'
        GROUP BY c.company_name
        ORDER BY cancelled_orders DESC, c.company_name
        LIMIT 8;
        ~~~

        ~~~sql
        -- same condition in WHERE: customers with no cancelled order are eliminated,
        -- because their padded row has status NULL, which fails the predicate
        SELECT c.company_name, count(o.order_id) AS cancelled_orders
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.customer_id
        WHERE o.status = 'cancelled'
        GROUP BY c.company_name
        ORDER BY cancelled_orders DESC, c.company_name
        LIMIT 8;
        ~~~

        The rule: **conditions on the optional (right) table belong in \`ON\`; conditions on the
        preserved (left) table belong in \`WHERE\`.** A \`WHERE\` predicate on the right table silently
        turns your outer join back into an inner join — except for \`WHERE right.col IS NULL\`, which is
        the deliberate anti-join above.

        ## Chaining outer joins
        Once a join is outer, downstream joins see NULLs. If a later \`JOIN\` is inner, it will drop those
        padded rows and undo the outer join:

        ~~~sql
        SELECT c.company_name, o.order_id, p.payment_id
        FROM customers c
        LEFT JOIN orders o   ON o.customer_id = c.customer_id
        LEFT JOIN payments p ON p.order_id = o.order_id      -- keep it LEFT
        ORDER BY c.company_name, o.order_id
        LIMIT 10;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Return every customer with their order count: `company_name` and `orders` (0 for customers who never ordered), ordered by `orders` ascending then `company_name`.',
          starter: '',
          solution: 'SELECT c.company_name, count(o.order_id) AS orders\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nGROUP BY c.customer_id, c.company_name\nORDER BY orders, c.company_name;',
          orderMatters: true,
          hints: ['`LEFT JOIN` keeps customers with no orders.', 'Count a column from the right table, not `count(*)`.'],
          explain: '`count(o.order_id)` is what turns the padded NULL row into a 0.'
        },
        {
          prompt: 'List the products that have never appeared in an order, using a `LEFT JOIN` and an `IS NULL` filter: `product_id`, `product_name`, ordered by `product_id`.',
          starter: '',
          solution: 'SELECT p.product_id, p.product_name\nFROM products p\nLEFT JOIN order_items i ON i.product_id = p.product_id\nWHERE i.product_id IS NULL\nORDER BY p.product_id;',
          orderMatters: true,
          requireSql: [{ pattern: 'left\\s+join', msg: 'Solve this one with `LEFT JOIN` + `IS NULL` (the NOT EXISTS version comes in module 07).' }],
          hints: ['Join, then keep only rows where the right side stayed NULL.'],
          explain: 'The LEFT JOIN / IS NULL anti-join. Make sure the IS NULL column can never be NULL in real matches — a key column is the right choice.'
        },
        {
          prompt: 'For every employee, return `last_name` and `orders_handled` — the number of orders in `orders` with their `emp_id` — including employees who handled none (0). Order by `orders_handled` descending, then `last_name`.',
          starter: '',
          solution: 'SELECT e.last_name, count(o.order_id) AS orders_handled\nFROM employees e\nLEFT JOIN orders o ON o.emp_id = e.emp_id\nGROUP BY e.emp_id, e.last_name\nORDER BY orders_handled DESC, e.last_name;',
          orderMatters: true,
          hints: ['Employees are the preserved side.', 'Group by the employee key as well as the name.'],
          explain: 'Most employees never touch an order — only the sales staff do, and the zeros are the interesting part of the answer.'
        },
        {
          prompt: 'Return `company_name` and `pending_orders` — the count of orders with status `pending` — for **all** customers, including those with none. Put the condition in the right place so no customer is lost. Order by `pending_orders` descending then `company_name`.',
          starter: '',
          solution: "SELECT c.company_name, count(o.order_id) AS pending_orders\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'pending'\nGROUP BY c.customer_id, c.company_name\nORDER BY pending_orders DESC, c.company_name;",
          orderMatters: true,
          hints: ['A condition on the optional table goes in `ON`, not `WHERE`.'],
          explain: 'This is the ON-versus-WHERE rule in action: in WHERE, the status test would have dropped every customer without a pending order.'
        }
      ],
      quiz: [
        {
          q: 'A LEFT JOIN with WHERE right_table.status = \'x\' behaves like:',
          options: ['A LEFT JOIN', 'An INNER JOIN', 'A FULL JOIN'],
          answer: 1,
          explain: 'Padded rows have NULL in that column, the predicate is unknown, and they are dropped — the outer join is undone.'
        },
        {
          q: 'In a LEFT JOIN aggregate, which counts 0 correctly for unmatched left rows?',
          options: ['count(*)', 'count(right_table.key)', 'Both'],
          answer: 1,
          explain: 'count(*) counts the padded row as 1; count(col) ignores the NULL and returns 0.'
        }
      ]
    },

    {
      id: 'right-full',
      title: 'RIGHT JOIN and FULL OUTER JOIN',
      lede: 'The mirror image and the union of both sides — rarer, but the right tool for reconciliation.',
      body: `
        ## RIGHT JOIN
        \`a RIGHT JOIN b\` keeps every row of **b**. It is exactly \`b LEFT JOIN a\` with the tables
        swapped, which is why most teams standardise on \`LEFT JOIN\` and never write \`RIGHT\`: a reader
        tracking "which side is preserved?" through a 5-table query should not have to flip direction.

        ~~~sql
        SELECT c.company_name, o.order_id
        FROM orders o
        RIGHT JOIN customers c ON c.customer_id = o.customer_id
        WHERE o.order_id IS NULL
        ORDER BY c.company_name;
        ~~~

        Mixing \`LEFT\` and \`RIGHT\` in one query is legal and almost always a mistake.

        ## FULL OUTER JOIN
        Keeps unmatched rows from **both** sides, padding the missing one with NULLs. Its home is
        reconciliation: comparing two sources where either may contain rows the other lacks.

        ~~~sql
        -- every order and every payment, including orders without payment
        -- and (hypothetically) payments without an order
        SELECT o.order_id, o.status, p.payment_id, p.amount
        FROM orders o
        FULL OUTER JOIN payments p ON p.order_id = o.order_id
        WHERE o.order_id IS NULL OR p.payment_id IS NULL
        ORDER BY o.order_id
        LIMIT 10;
        ~~~

        ## Emulating FULL OUTER JOIN
        MySQL has no \`FULL JOIN\` (and SQLite only gained it in 3.39). The standard workaround is a union
        of two outer joins:

        ~~~sql
        SELECT o.order_id AS order_id, p.payment_id AS payment_id
        FROM orders o LEFT JOIN payments p ON p.order_id = o.order_id
        UNION
        SELECT o.order_id AS order_id, p.payment_id AS payment_id
        FROM payments p LEFT JOIN orders o ON o.order_id = p.order_id
        ORDER BY order_id, payment_id
        LIMIT 10;
        ~~~

        \`UNION\` (not \`UNION ALL\`) deduplicates the rows that both halves produce. If the columns can
        contain NULLs, \`UNION ALL\` plus a \`WHERE o.order_id IS NULL\` filter on the second half is the
        faster version.

        ## Classifying the three outcomes
        A reconciliation report usually wants to label each row:

        ~~~sql
        SELECT CASE
                 WHEN o.order_id IS NULL   THEN 'payment without order'
                 WHEN p.payment_id IS NULL THEN 'order without payment'
                 ELSE 'matched'
               END AS reconciliation,
               count(*) AS rows_found
        FROM orders o
        FULL OUTER JOIN payments p ON p.order_id = o.order_id
        GROUP BY reconciliation
        ORDER BY rows_found DESC;
        ~~~

        :::dialect Support
        | Engine | RIGHT | FULL |
        | --- | --- | --- |
        | PostgreSQL, SQL Server, Oracle | yes | yes |
        | SQLite ≥ 3.39 | yes | yes |
        | MySQL / MariaDB | yes | **no** — emulate with UNION |
        :::
      `,
      exercises: [
        {
          prompt: 'Using a `FULL OUTER JOIN` between `orders` and `payments`, count how many orders have no payment at all. Return one column `orders_without_payment`.',
          starter: '',
          solution: 'SELECT count(*) AS orders_without_payment\nFROM orders o\nFULL OUTER JOIN payments p ON p.order_id = o.order_id\nWHERE p.payment_id IS NULL;',
          requireSql: [{ pattern: 'full\\s+(outer\\s+)?join', msg: 'Use a `FULL OUTER JOIN` here.' }],
          hints: ['Unmatched orders have a NULL `payment_id`.'],
          explain: 'With this data the FULL join adds nothing over a LEFT join — every payment has an order — which is exactly what a reconciliation query is meant to prove.'
        },
        {
          prompt: 'Produce a reconciliation summary of `orders` against `payments`: a column `reconciliation` with the values `matched`, `order without payment` and `payment without order`, and `rows_found` per group. Order by `reconciliation`.',
          starter: '',
          solution: "SELECT CASE\n         WHEN o.order_id IS NULL   THEN 'payment without order'\n         WHEN p.payment_id IS NULL THEN 'order without payment'\n         ELSE 'matched'\n       END AS reconciliation,\n       count(*) AS rows_found\nFROM orders o\nFULL OUTER JOIN payments p ON p.order_id = o.order_id\nGROUP BY reconciliation\nORDER BY reconciliation;",
          orderMatters: true,
          hints: ['One CASE with two NULL tests and an ELSE.', 'Group by the CASE expression (or its alias in SQLite).'],
          explain: 'A one-query answer to "do these two tables agree?", which is the main reason FULL OUTER JOIN exists.'
        }
      ]
    },

    {
      id: 'self-join',
      title: 'Self joins',
      lede: 'Joining a table to itself: hierarchies, previous rows, and pairs.',
      body: `
        ## Two aliases, one table
        \`employees.manager_id\` points at \`employees.emp_id\`. To show each person next to their manager,
        join the table to itself under two names:

        ~~~sql
        SELECT e.last_name AS employee, e.job_title,
               m.last_name AS manager
        FROM employees e
        LEFT JOIN employees m ON m.emp_id = e.manager_id
        ORDER BY manager, employee;
        ~~~

        \`LEFT\` matters: the CEO has no manager, and an inner join would hide her.

        ## Aggregating over the self join
        ~~~sql
        SELECT m.last_name AS manager, count(*) AS direct_reports,
               round(avg(e.salary), 2) AS avg_report_salary
        FROM employees e
        JOIN employees m ON m.emp_id = e.manager_id
        GROUP BY m.emp_id, m.last_name
        ORDER BY direct_reports DESC, manager;
        ~~~

        This is one level only. Arbitrary depth ("everyone under Bruno") needs a recursive CTE — module 07.

        ## Comparing rows within a table
        A self join with an inequality finds pairs. To avoid both \`(A,B)\` and \`(B,A)\` plus the
        self-pair \`(A,A)\`, join with \`<\` on a unique key:

        ~~~sql
        SELECT a.last_name AS employee_a, b.last_name AS employee_b, a.salary
        FROM employees a
        JOIN employees b ON b.salary = a.salary AND b.emp_id > a.emp_id
        ORDER BY a.salary DESC;
        ~~~

        ## "Earns more than their manager"
        The classic interview question is a self join plus a comparison between the two aliases:

        ~~~sql
        SELECT e.last_name AS employee, e.salary,
               m.last_name AS manager, m.salary AS manager_salary
        FROM employees e
        JOIN employees m ON m.emp_id = e.manager_id
        WHERE e.salary > m.salary
        ORDER BY e.last_name;
        ~~~

        (Nobody in this company does — an empty result is a valid answer.)

        ## Previous and next row
        Before window functions, "the previous order for this customer" was a self join on
        \`b.order_date < a.order_date\` plus a \`max()\`. It works, but it is O(n²)-ish and hard to read.
        \`LAG()\` (module 08) replaced it entirely. Reach for a self join when you are comparing
        *different* rows by a join key, and for a window function when you are comparing rows *within an
        ordered partition*.
      `,
      exercises: [
        {
          prompt: 'Return `employee` (last name) and `manager` (their manager’s last name) for every employee, with `NULL` for the person at the top. Order by `employee`.',
          starter: '',
          solution: 'SELECT e.last_name AS employee, m.last_name AS manager\nFROM employees e\nLEFT JOIN employees m ON m.emp_id = e.manager_id\nORDER BY employee;',
          orderMatters: true,
          hints: ['Alias the table twice: `e` for the person, `m` for the manager.', 'Use `LEFT JOIN` so the CEO survives.'],
          explain: 'A self join is an ordinary join; only the aliases tell the two roles apart.'
        },
        {
          prompt: 'Return `manager` (last name) and `direct_reports` for every employee who manages at least 2 people, most reports first then name.',
          starter: '',
          solution: 'SELECT m.last_name AS manager, count(*) AS direct_reports\nFROM employees e\nJOIN employees m ON m.emp_id = e.manager_id\nGROUP BY m.emp_id, m.last_name\nHAVING count(*) >= 2\nORDER BY direct_reports DESC, manager;',
          orderMatters: true,
          hints: ['Group by the manager side of the join.'],
          explain: 'Group by the manager’s key, not just the name, so two managers sharing a surname stay distinct.'
        },
        {
          prompt: 'Find pairs of employees in the **same department** with the **same salary**, reported once per pair: `dept_id`, `salary`, `employee_a`, `employee_b` (last names, a’s `emp_id` lower than b’s). Order by `dept_id`, `salary`.',
          starter: '',
          solution: 'SELECT a.dept_id, a.salary, a.last_name AS employee_a, b.last_name AS employee_b\nFROM employees a\nJOIN employees b\n  ON b.dept_id = a.dept_id AND b.salary = a.salary AND b.emp_id > a.emp_id\nORDER BY a.dept_id, a.salary;',
          orderMatters: false,
          hints: ['Three conditions in the `ON` clause.', '`b.emp_id > a.emp_id` removes the mirrored pair and the self-pair.'],
          explain: 'The inequality on the key is the standard trick for enumerating unordered pairs exactly once.'
        }
      ]
    },

    {
      id: 'multi-join',
      title: 'Multi-table joins and the fan-out trap',
      lede: 'Why your revenue total is three times too big, and how to aggregate before joining.',
      body: `
        ## Grain, again
        Each join to a child table multiplies rows. One order with 4 items and 2 payments produces
        4 × 2 = 8 rows:

        ~~~sql
        SELECT o.order_id, i.product_id, p.payment_id
        FROM orders o
        JOIN order_items i ON i.order_id = o.order_id
        JOIN payments p    ON p.order_id = o.order_id
        WHERE o.order_id IN (
          SELECT order_id FROM payments GROUP BY order_id HAVING count(*) > 1
        )
        ORDER BY o.order_id, i.product_id, p.payment_id
        LIMIT 12;
        ~~~

        ## The broken total
        Summing two different child tables in one query double-counts both:

        ~~~sql
        -- WRONG: freight is repeated once per item, item totals once per payment
        SELECT round(sum(i.unit_price * i.quantity * (1 - i.discount)), 2) AS revenue,
               round(sum(p.amount), 2)                                     AS paid
        FROM orders o
        JOIN order_items i ON i.order_id = o.order_id
        JOIN payments p    ON p.order_id = o.order_id;
        ~~~

        ~~~sql
        -- RIGHT: aggregate each child to one row per order first, then join
        SELECT round(sum(items.revenue), 2) AS revenue,
               round(sum(pays.paid), 2)     AS paid
        FROM orders o
        LEFT JOIN (SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS revenue
                   FROM order_items GROUP BY order_id) items ON items.order_id = o.order_id
        LEFT JOIN (SELECT order_id, sum(amount) AS paid
                   FROM payments GROUP BY order_id) pays ON pays.order_id = o.order_id;
        ~~~

        **Rule: never sum measures from two different child tables in the same join.** Pre-aggregate each
        to the grain you report on (one row per order here), then join those single-grain results.
        A CTE makes this far more readable — module 07.

        ## Signs of a fan-out
        - the row count jumps when you add a join;
        - a total is an exact multiple (2×, 3×) of the truth;
        - you reach for \`DISTINCT\` to "fix" the numbers;
        - \`count(*)\` and \`count(DISTINCT parent_id)\` disagree.

        ## Spot-check your joins
        Count rows at every step while building:

        ~~~sql
        SELECT (SELECT count(*) FROM orders)                                   AS orders,
               (SELECT count(*) FROM orders JOIN order_items USING (order_id))  AS with_items,
               (SELECT count(*) FROM orders JOIN payments USING (order_id))     AS with_payments;
        ~~~

        If a join to a *parent* table (many-to-one, like \`orders\` → \`customers\`) changes the row count,
        your assumption about uniqueness is wrong — look for duplicate keys.

        ## A correct multi-table report
        ~~~sql
        SELECT c.country,
               count(DISTINCT o.order_id)                                  AS orders,
               round(sum(i.unit_price * i.quantity * (1 - i.discount)), 2)   AS revenue
        FROM orders o
        JOIN customers c   ON c.customer_id = o.customer_id
        JOIN order_items i ON i.order_id = o.order_id
        WHERE o.status <> 'cancelled'
        GROUP BY c.country
        ORDER BY revenue DESC;
        ~~~

        One child table only, so \`sum\` is safe; \`count(DISTINCT o.order_id)\` compensates for the fan-out
        in the count.
      `,
      exercises: [
        {
          prompt: 'Per customer, return `company_name`, `orders` (distinct orders) and `revenue` (sum of line totals, rounded to 2) for non-cancelled orders. Top 8 by revenue, ties by `company_name`.',
          starter: '',
          solution: "SELECT c.company_name,\n       count(DISTINCT o.order_id) AS orders,\n       round(sum(i.unit_price * i.quantity * (1 - i.discount)), 2) AS revenue\nFROM customers c\nJOIN orders o      ON o.customer_id = c.customer_id\nJOIN order_items i ON i.order_id = o.order_id\nWHERE o.status <> 'cancelled'\nGROUP BY c.customer_id, c.company_name\nORDER BY revenue DESC, c.company_name\nLIMIT 8;",
          orderMatters: true,
          hints: ['Joining `order_items` multiplies rows per order — use `count(DISTINCT o.order_id)`.', 'Only one child table is summed, so `sum` is safe.'],
          explain: 'One child table per aggregate keeps the arithmetic honest.'
        },
        {
          prompt: 'For each order, return `order_id`, `revenue` (sum of its line totals) and `paid` (sum of its payments) — both rounded to 2, both correct — by pre-aggregating each child table. Include orders with no payment (`paid` NULL is fine). Order by `order_id` and limit to the first 10 orders by id.',
          starter: 'SELECT o.order_id,\n       \nFROM orders o\nLEFT JOIN (\n  \n) items ON \nLEFT JOIN (\n  \n) pays ON \nORDER BY o.order_id\nLIMIT 10;',
          solution: 'SELECT o.order_id,\n       round(items.revenue, 2) AS revenue,\n       round(pays.paid, 2)     AS paid\nFROM orders o\nLEFT JOIN (SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS revenue\n           FROM order_items GROUP BY order_id) items ON items.order_id = o.order_id\nLEFT JOIN (SELECT order_id, sum(amount) AS paid\n           FROM payments GROUP BY order_id) pays ON pays.order_id = o.order_id\nORDER BY o.order_id\nLIMIT 10;',
          orderMatters: true,
          hints: ['Each subquery must return exactly one row per `order_id`.', 'Join the pre-aggregated results, do not aggregate after joining.'],
          explain: 'Pre-aggregating to a common grain is the single most important multi-table technique in reporting.'
        }
      ],
      quiz: [
        {
          q: 'Revenue doubled after you joined a second child table. The cleanest fix is:',
          options: ['Add DISTINCT to the SELECT', 'Divide by 2', 'Pre-aggregate each child table to one row per parent, then join'],
          answer: 2,
          explain: 'DISTINCT removes identical rows, not the duplication of a measure, and the multiplier is not constant in general.'
        }
      ]
    },

    {
      id: 'non-equi',
      title: 'Non-equi joins, ranges and calendars',
      lede: 'Joins do not have to use equality: bands, date ranges and generated spines.',
      body: `
        ## Joining on a range
        Build a small table of bands with a \`VALUES\` list and join each row into the band it falls in:

        ~~~sql
        WITH bands(label, low, high) AS (
          VALUES ('budget', 0, 49.999), ('mid', 50, 199.999),
                 ('premium', 200, 499.999), ('flagship', 500, 999999)
        )
        SELECT b.label, count(*) AS products, round(avg(p.unit_price), 2) AS avg_price
        FROM products p
        JOIN bands b ON p.unit_price BETWEEN b.low AND b.high
        GROUP BY b.label
        ORDER BY min(b.low);
        ~~~

        This beats a long \`CASE\` expression when the bands are data rather than code — they can live in a
        table that analysts maintain.

        ## Point-in-time joins
        A price list or an exchange rate that changes over time is stored as rows with validity ranges, and
        joined with an inequality:

        ~~~sql-static
        SELECT s.sale_id, s.amount * r.rate AS amount_eur
        FROM sales s
        JOIN fx_rates r
          ON r.currency = s.currency
         AND s.sold_at >= r.valid_from
         AND s.sold_at <  r.valid_to;        -- half-open interval, no overlaps
        ~~~

        Half-open ranges guarantee that exactly one rate row matches. With \`BETWEEN\` on both ends, a sale
        at the boundary matches two rows and the amount is double-counted.

        ## Self non-equi join: running totals the hard way
        ~~~sql
        SELECT a.order_date,
               count(*)              AS orders_to_date
        FROM orders a
        JOIN orders b ON b.order_date <= a.order_date
        WHERE a.order_date <= '2024-01-20'
        GROUP BY a.order_date
        ORDER BY a.order_date;
        ~~~

        Correct, but it compares every row with every earlier row. \`sum(...) OVER (ORDER BY ...)\`
        (module 08) does it in one pass.

        ## Generating a date spine
        A report with "every day, even the empty ones" needs a list of dates that does not exist in your
        data. Generate one with a recursive CTE and \`LEFT JOIN\` the facts onto it:

        ~~~sql
        WITH RECURSIVE days(d) AS (
          SELECT date('2025-09-01')
          UNION ALL
          SELECT date(d, '+1 day') FROM days WHERE d < '2025-09-30'
        )
        SELECT days.d AS day, count(o.order_id) AS orders
        FROM days
        LEFT JOIN orders o ON o.order_date = days.d
        GROUP BY days.d
        ORDER BY days.d;
        ~~~

        Zeros now appear for days with no orders — impossible with \`GROUP BY order_date\` alone.

        :::warn Cost
        Non-equi joins cannot use a hash join; the engine falls back to nested loops or a merge, so they are
        much more expensive than equality joins. Keep at least one equality condition
        (\`r.currency = s.currency\` above) so the engine can narrow the search before applying the range.
        :::
      `,
      exercises: [
        {
          prompt: 'Using a `VALUES` band table (`cheap` 0–99.999, `normal` 100–399.999, `expensive` 400–999999), return `label` and `products` — how many products fall in each band — ordered by the band’s lower bound.',
          starter: "WITH bands(label, low, high) AS (\n  VALUES ('cheap', 0, 99.999), ('normal', 100, 399.999), ('expensive', 400, 999999)\n)\nSELECT ",
          solution: "WITH bands(label, low, high) AS (\n  VALUES ('cheap', 0, 99.999), ('normal', 100, 399.999), ('expensive', 400, 999999)\n)\nSELECT b.label, count(*) AS products\nFROM products p\nJOIN bands b ON p.unit_price BETWEEN b.low AND b.high\nGROUP BY b.label\nORDER BY min(b.low);",
          orderMatters: true,
          hints: ['Join on `BETWEEN b.low AND b.high`.', 'Order by `min(b.low)` so the bands come out in price order.'],
          explain: 'Bands as data, not as a CASE expression — maintainable and joinable.'
        },
        {
          prompt: 'Build a date spine for **September 2025** with a recursive CTE and return `day` and `orders` (0 where there were none), ordered by day.',
          starter: "WITH RECURSIVE days(d) AS (\n  SELECT date('2025-09-01')\n  UNION ALL\n  \n)\nSELECT ",
          solution: "WITH RECURSIVE days(d) AS (\n  SELECT date('2025-09-01')\n  UNION ALL\n  SELECT date(d, '+1 day') FROM days WHERE d < '2025-09-30'\n)\nSELECT days.d AS day, count(o.order_id) AS orders\nFROM days\nLEFT JOIN orders o ON o.order_date = days.d\nGROUP BY days.d\nORDER BY days.d;",
          orderMatters: true,
          requireSql: [{ pattern: 'recursive', msg: 'Generate the days with a `WITH RECURSIVE` CTE.' }],
          hints: ['The recursive step adds one day and stops at the 30th.', '`LEFT JOIN` the orders onto the spine, and count a column from `orders`.'],
          explain: 'Spine + LEFT JOIN is the general answer to "my chart is missing the empty days".'
        }
      ]
    }
  ]
});
