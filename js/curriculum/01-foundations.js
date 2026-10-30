window.COURSE_INTRO = `
  This course teaches SQL by making you write it. Every example and every exercise runs against a
  real SQLite database that lives in this browser tab — no server, no account, nothing leaves your machine.
  Answers are graded by **running them** and comparing the rows you produced with the rows the reference
  answer produces, so there is more than one way to be right.

  Work top to bottom if you are new. If you already know the basics, use the search box or jump into a module.
  Where a feature differs between SQLite, PostgreSQL, MySQL, SQL Server and Oracle, the lesson says so in a
  **Dialect notes** box.
`;

(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'foundations',
  title: 'Foundations',
  blurb: 'What SQL is, and the anatomy of a query: SELECT, FROM, ORDER BY, LIMIT, DISTINCT.',
  lessons: [

    {
      id: 'relational-model',
      title: 'Tables, rows and the relational model',
      lede: 'Before the syntax: what a relational database actually stores, and what makes SQL different from a programming language.',
      body: `
        ## Data lives in tables
        A relational database stores data in **tables**. A table has named **columns**, each with a
        declared type, and any number of **rows**. One row is one fact about one thing: an employee,
        an order, a product.

        The practice database for this course belongs to a small hardware reseller. It has 13 tables,
        including:

        | Table | One row is | Key columns |
        | --- | --- | --- |
        | \`employees\` | a member of staff | \`emp_id\`, \`manager_id\`, \`dept_id\` |
        | \`customers\` | a company that buys from us | \`customer_id\` |
        | \`orders\` | one purchase | \`order_id\`, \`customer_id\`, \`emp_id\` |
        | \`order_items\` | one product line inside an order | \`order_id\` + \`product_id\` |
        | \`products\` | something we sell | \`product_id\`, \`category_id\` |

        Rows in different tables are linked by **keys**. An order does not repeat the customer's address;
        it stores a \`customer_id\` that points at a row in \`customers\`. That pointer is a **foreign key**,
        and following it is what a *join* does (module 05).

        ## SQL is declarative
        In most languages you say *how*: loop over this, accumulate that. In SQL you describe *what you
        want* and the database's **query planner** decides how to get it — which index to use, which table
        to read first, whether to sort or hash. Two queries that look very different can produce the
        same plan, and the same query can be executed differently as data grows.

        That has a practical consequence: **a SQL query is a set expression, not a sequence of steps.**
        Thinking in terms of sets of rows ("all orders that have no payment") rather than loops
        ("for each order, look up payments") is the single biggest shift for a new SQL user.

        ## Sets, not lists
        Tables are unordered. A table has no "first row" unless you ask for an order with \`ORDER BY\`.
        Results you get without \`ORDER BY\` may look stable, then change after an index is added — this is
        the most common source of "it worked yesterday" bugs.

        ## The statement families
        - **DQL** — querying: \`SELECT\`
        - **DML** — changing rows: \`INSERT\`, \`UPDATE\`, \`DELETE\`, \`MERGE\`
        - **DDL** — defining structure: \`CREATE\`, \`ALTER\`, \`DROP\`
        - **DCL** — permissions: \`GRANT\`, \`REVOKE\`
        - **TCL** — transactions: \`BEGIN\`, \`COMMIT\`, \`ROLLBACK\`

        This course covers all five, starting with \`SELECT\` because that is where most of the thinking is.

        ## Your first query
        Press **Run this** below. It executes in this page, against a fresh copy of the database.

        ~~~sql
        SELECT 'Hello, SQL' AS greeting, 2 + 2 AS arithmetic, sqlite_version() AS engine;
        ~~~

        :::dialect Which SQL?
        Exercises run on **SQLite**, because it fits in a browser tab. SQLite's dialect is close to the
        standard for everything this course teaches, and each lesson flags the places where PostgreSQL,
        MySQL, SQL Server or Oracle differ. The skills transfer; the quirks are listed in the
        [Reference](#/reference).
        :::
      `,
      exercises: [
        {
          prompt: 'Run a query that returns a single row with one column named `answer` containing the number `42`. Any expression that evaluates to 42 counts.',
          starter: 'SELECT ',
          solution: 'SELECT 42 AS answer;',
          hints: ['A `SELECT` does not need a `FROM` clause in SQLite, MySQL, SQL Server or PostgreSQL.', 'Name a column with `AS`: `SELECT 42 AS answer;`'],
          explain: 'A `SELECT` with no table is how you test expressions. Oracle needs `SELECT 42 AS answer FROM dual;`'
        },
        {
          prompt: 'How many rows are in the `orders` table? Return the single count.',
          starter: 'SELECT count(*) FROM orders;',
          solution: 'SELECT count(*) FROM orders;',
          hints: ['`count(*)` counts rows.'],
          explain: '`count(*)` is the one aggregate that never looks at a column value — it just counts rows.'
        }
      ],
      quiz: [
        {
          q: 'A query without ORDER BY returned rows in a helpful order. Can you rely on it?',
          options: ['Yes, the physical row order is stable', 'No — without ORDER BY the order is not guaranteed', 'Only if the table has a primary key'],
          answer: 1,
          explain: 'Row order is an artefact of the chosen plan. Add ORDER BY whenever order matters, even if the current output already looks sorted.'
        },
        {
          q: 'What links a row in `orders` to a row in `customers`?',
          options: ['Their physical position in the file', 'A foreign key column holding the customer’s id', 'A hidden pointer the database maintains'],
          answer: 1,
          explain: 'Relationships are plain data: a value in one table that matches a key in another.'
        }
      ]
    },

    {
      id: 'select-expressions',
      title: 'SELECT: expressions, aliases and literals',
      lede: 'The SELECT list is a row-shaped calculator. Learn it on its own, before tables get involved.',
      body: `
        ## The SELECT list
        A \`SELECT\` list is a comma-separated list of **expressions**. Each expression becomes one column
        in the result. Expressions can be literals, arithmetic, function calls, or column references.

        ~~~sql
        SELECT
          42                AS int_literal,
          3.5 * 2           AS computed,
          'hardware'        AS text_literal,
          'a' || 'b' || 'c' AS concatenated,
          upper('sql')      AS a_function,
          NULL              AS no_value;   -- 'nothing' is reserved in SQLite
        ~~~

        ## Aliases
        \`AS name\` renames a column in the output. Without an alias, the column name is engine-defined
        (often the expression text), which makes downstream code fragile. **Alias every computed column.**

        - \`AS\` is optional in most engines (\`salary * 12 annual\`), but writing it is clearer.
        - Use double quotes for identifiers that need spaces or case: \`AS "Annual salary"\`.
          Single quotes are for **string values**, never identifiers — mixing these up is a classic beginner bug.

        ~~~sql
        SELECT 1500 * 12 AS annual_cost, 1500 * 12 AS "Annual cost (EUR)";
        ~~~

        ## Columns from a table
        Add \`FROM\` and the same expressions can reference columns:

        ~~~sql
        SELECT first_name, last_name, salary, salary / 12.0 AS monthly
        FROM employees
        LIMIT 5;
        ~~~

        ## Comments
        \`-- line comment\` to end of line, and \`/* block comment */\` across lines. Use them to park
        an alternative predicate while you debug a query.

        :::tip Formatting that survives review
        One clause per line, keywords aligned left, commas leading or trailing but consistently.
        Long \`SELECT\` lists get one expression per line. A readable query is a cheaper query to fix.
        :::

        :::dialect String concatenation
        - Standard, SQLite, PostgreSQL, Oracle: \`a || b\`
        - MySQL: \`CONCAT(a, b)\` (\`||\` means OR unless \`PIPES_AS_CONCAT\` is set)
        - SQL Server: \`a + b\`, or \`CONCAT(a, b)\`
        \`CONCAT\` works in SQLite ≥ 3.44, PostgreSQL and SQL Server too, so it is the portable choice.
        :::
      `,
      exercises: [
        {
          prompt: 'From `employees`, return each person’s full name in one column called `full_name` (first name, a space, last name) together with their `salary`. No ordering needed.',
          starter: 'SELECT \nFROM employees;',
          solution: "SELECT first_name || ' ' || last_name AS full_name, salary FROM employees;",
          hints: ['Concatenate with `||`.', "Don't forget the space literal: `first_name || ' ' || last_name`."],
          explain: 'Building display values in the SELECT list keeps the stored columns clean and atomic.'
        },
        {
          prompt: 'Return `product_name`, the stored `unit_price`, and the price after a 19% VAT rounded to 2 decimals as `price_incl_vat`, for products in stock (`units_in_stock > 0`).',
          starter: 'SELECT product_name, unit_price\nFROM products\nWHERE units_in_stock > 0;',
          solution: 'SELECT product_name, unit_price, round(unit_price * 1.19, 2) AS price_incl_vat\nFROM products\nWHERE units_in_stock > 0;',
          hints: ['Multiply by `1.19`.', '`round(x, 2)` rounds to two decimals.'],
          explain: 'Derived columns are computed per row, at read time — the stored price stays the single source of truth.'
        }
      ]
    },

    {
      id: 'from-and-columns',
      title: 'FROM, SELECT * and qualified names',
      lede: 'Choosing a table, choosing columns, and why SELECT * belongs in the console and not in your code.',
      body: `
        ## FROM names the source
        \`FROM\` takes a table, a view, a subquery, or a join of several of those. The rest of the query can
        only reference what \`FROM\` exposes.

        ## SELECT *
        \`*\` expands to every column, in declaration order.

        ~~~sql
        SELECT * FROM departments;
        ~~~

        Great for exploring. Bad in saved code:

        - the result **shape changes** when someone adds a column, breaking code that reads by position;
        - it reads columns you do not need (more I/O, no covering index);
        - in a join, duplicate column names appear twice and \`SELECT *\` hides which table they came from.

        Name your columns in anything you commit.

        ## Table aliases and qualified names
        A **table alias** shortens references and is required when the same table appears twice:

        ~~~sql
        SELECT e.first_name, e.salary, d.dept_name
        FROM employees AS e
        JOIN departments AS d ON d.dept_id = e.dept_id
        LIMIT 5;
        ~~~

        \`e.salary\` is a **qualified** reference. Qualify every column once a query has more than one table:
        it survives schema changes and prevents \`ambiguous column name\` errors.

        \`t.*\` expands only that table's columns — useful in exploratory joins:

        ~~~sql
        SELECT o.*, c.company_name
        FROM orders AS o
        JOIN customers AS c ON c.customer_id = o.customer_id
        LIMIT 3;
        ~~~

        ## Finding out what exists
        Every engine exposes its catalog as queryable tables:

        | Engine | List tables |
        | --- | --- |
        | SQLite | \`SELECT name FROM sqlite_master WHERE type='table'\` |
        | PostgreSQL | \`SELECT table_name FROM information_schema.tables\` |
        | MySQL | \`SHOW TABLES\` or \`information_schema.tables\` |
        | SQL Server | \`SELECT name FROM sys.tables\` |
        | Oracle | \`SELECT table_name FROM user_tables\` |

        ~~~sql
        SELECT name, type FROM sqlite_master WHERE type = 'table' ORDER BY name;
        ~~~

        :::tip
        The [Playground](#/playground) lists every table and column of the practice database, with row
        counts and foreign keys. Keep it open in a second tab while you work through the course.
        :::
      `,
      exercises: [
        {
          prompt: 'Return the `dept_name` and `budget` of every department, plus a column `budget_k` with the budget divided by 1000.',
          starter: '',
          solution: 'SELECT dept_name, budget, budget / 1000 AS budget_k FROM departments;',
          hints: ['Three expressions in the SELECT list, one table in FROM.'],
          explain: 'Note the integer-ish result: `budget / 1000` on whole numbers may truncate in some engines. Lesson 03 covers that.'
        },
        {
          prompt: 'Using the alias `p` for `products`, return `p.product_name` and `p.unit_price` for discontinued products (`discontinued = 1`).',
          starter: 'SELECT \nFROM products AS p\nWHERE ',
          solution: 'SELECT p.product_name, p.unit_price FROM products AS p WHERE p.discontinued = 1;',
          requireSql: [{ pattern: 'products\\s+(as\\s+)?p\\b', msg: 'Alias the table as `p` and reference the columns as `p.column`.' }],
          hints: ['`FROM products AS p` then `p.product_name`.'],
          explain: 'Short, meaningful aliases (first letters of the table) keep multi-table queries readable.'
        }
      ],
      quiz: [
        {
          q: 'Why avoid SELECT * in production code?',
          options: ['It is slower in every case', 'The result shape changes when columns are added, and it reads data you do not need', 'It is not valid standard SQL'],
          answer: 1,
          explain: 'Stability of the contract matters more than the (real, but usually small) I/O cost.'
        }
      ]
    },

    {
      id: 'distinct',
      title: 'DISTINCT: removing duplicate rows',
      lede: 'How to see the set of values in a column — and why a DISTINCT in your query is often a warning sign.',
      body: `
        ## DISTINCT applies to the whole row
        \`SELECT DISTINCT\` removes duplicate **rows** from the result — it is not a modifier on one column.

        ~~~sql
        SELECT DISTINCT country FROM customers ORDER BY country;
        ~~~

        ~~~sql
        -- distinct combinations, not distinct per column
        SELECT DISTINCT country, city FROM customers ORDER BY country, city;
        ~~~

        \`DISTINCT\` treats \`NULL\` values as equal to each other, so a column with many \`NULL\`s yields
        exactly one \`NULL\` row. (This differs from \`=\`, where \`NULL = NULL\` is not true — see module 02.)

        ## COUNT(DISTINCT x)
        Counting distinct values is a different operation from counting rows:

        ~~~sql
        SELECT count(*)                  AS rows,
               count(DISTINCT country)   AS countries,
               count(DISTINCT city)      AS cities
        FROM customers;
        ~~~

        ## DISTINCT as a smell
        A \`DISTINCT\` sprinkled on top of a join usually means the join is **fanning out** — it multiplied
        rows because one order has many items. Deduplicating the result hides the real problem and can
        silently collapse legitimately repeated rows. Prefer fixing the join or using \`EXISTS\`
        (module 07) over papering over it.

        ~~~sql
        -- fan-out: 3 rows per order with 3 items
        SELECT o.order_id FROM orders o JOIN order_items i USING (order_id) LIMIT 8;
        ~~~

        ~~~sql
        -- the intent was "orders that have items" -> EXISTS, no duplicates by construction
        SELECT o.order_id
        FROM orders o
        WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.order_id)
        LIMIT 8;
        ~~~

        :::dialect
        - \`DISTINCT ON (col)\` is a PostgreSQL extension that keeps the first row per group — elsewhere use
          \`ROW_NUMBER()\` (module 08).
        - Oracle and others also accept \`UNIQUE\` as a synonym for \`DISTINCT\`.
        - \`DISTINCT\` usually needs a sort or hash of the whole result: it is not free.
        :::
      `,
      exercises: [
        {
          prompt: 'List the distinct `status` values that appear in `orders`.',
          starter: '',
          solution: 'SELECT DISTINCT status FROM orders;',
          hints: ['`SELECT DISTINCT status ...`'],
          explain: 'A quick way to learn the domain of a column before trusting it in a WHERE clause.'
        },
        {
          prompt: 'How many different customers have placed at least one order? Return one column named `customers_with_orders` from the `orders` table (no join needed).',
          starter: '',
          solution: 'SELECT count(DISTINCT customer_id) AS customers_with_orders FROM orders;',
          hints: ['`count(DISTINCT ...)`.', 'The `orders` table already holds `customer_id`.'],
          explain: '`count(DISTINCT customer_id)` answers "how many customers", while `count(*)` would answer "how many orders".'
        },
        {
          prompt: 'Return the distinct pairs of `category_id` and `supplier_id` that appear in `products`, ordered by `category_id` then `supplier_id`.',
          starter: '',
          solution: 'SELECT DISTINCT category_id, supplier_id FROM products ORDER BY category_id, supplier_id;',
          orderMatters: true,
          hints: ['DISTINCT applies to the pair of columns together.'],
          explain: 'Distinct *combinations* are the normal case; wanting "distinct of one column but all of another" is a sign you need GROUP BY or a window function.'
        }
      ]
    },

    {
      id: 'order-by',
      title: 'ORDER BY: sorting results',
      lede: 'Multiple sort keys, descending order, sorting by expressions, and where NULLs end up.',
      body: `
        ## Basics
        \`ORDER BY\` is the last clause evaluated before \`LIMIT\`, so it can use output aliases.

        ~~~sql
        SELECT product_name, unit_price
        FROM products
        ORDER BY unit_price DESC
        LIMIT 8;
        ~~~

        \`ASC\` (default) or \`DESC\` applies **per key**:

        ~~~sql
        SELECT last_name, dept_id, salary
        FROM employees
        ORDER BY dept_id ASC, salary DESC;
        ~~~

        The second key only breaks ties in the first. Add a final unique key (an id) when you need a
        **total order** — otherwise ties are arbitrary and pagination can repeat or skip rows.

        ## Sorting by expressions and aliases
        ~~~sql
        SELECT first_name, salary * 12 AS annual
        FROM employees
        ORDER BY annual DESC
        LIMIT 5;
        ~~~

        \`ORDER BY 2 DESC\` (sort by the second output column) is legal in most engines, but it breaks when
        someone edits the \`SELECT\` list. Use names.

        A useful trick: sort by a \`CASE\` expression for a custom order.

        ~~~sql
        SELECT order_id, status
        FROM orders
        ORDER BY CASE status
                   WHEN 'pending'   THEN 1
                   WHEN 'shipped'   THEN 2
                   WHEN 'delivered' THEN 3
                   ELSE 4
                 END, order_id
        LIMIT 10;
        ~~~

        ## NULLs in sorts
        \`NULL\` sorts as either smallest or largest, depending on the engine. SQLite and PostgreSQL put
        \`NULL\` **first** ascending; SQL Server does too; Oracle and MySQL differ. Be explicit:

        ~~~sql
        SELECT company_name, credit_limit
        FROM customers
        ORDER BY credit_limit DESC NULLS LAST, company_name;
        ~~~

        \`NULLS FIRST\` / \`NULLS LAST\` works in SQLite ≥ 3.30, PostgreSQL and Oracle. In MySQL and SQL Server,
        emulate it: \`ORDER BY (credit_limit IS NULL), credit_limit DESC\`.

        ## Text ordering
        String comparison depends on **collation**: whether \`'apple' < 'Banana'\`. SQLite's default is
        case-sensitive binary ordering; \`COLLATE NOCASE\` makes it case-insensitive.

        ~~~sql
        SELECT company_name FROM customers ORDER BY company_name COLLATE NOCASE LIMIT 5;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Return `first_name`, `last_name` and `salary` of all employees, highest salary first. Break ties alphabetically by `last_name`.',
          starter: '',
          solution: 'SELECT first_name, last_name, salary FROM employees ORDER BY salary DESC, last_name;',
          orderMatters: true,
          hints: ['Two sort keys separated by a comma.', 'Only the first key is `DESC`.'],
          explain: 'Two employees share a salary here, so the tie-breaker is what makes the result deterministic.'
        },
        {
          prompt: 'List `company_name` and `credit_limit` for all customers, biggest limit first, with customers whose limit is NULL at the very end.',
          starter: '',
          solution: 'SELECT company_name, credit_limit FROM customers ORDER BY credit_limit DESC NULLS LAST, company_name;',
          orderMatters: true,
          hints: ['`NULLS LAST` after the sort direction.', 'Add `company_name` as a tie-breaker.'],
          explain: 'Explicit NULL placement is one of the few portability details worth memorising.'
        },
        {
          prompt: 'Return the 5 most recently hired employees: `first_name`, `last_name`, `hire_date`, newest first.',
          starter: '',
          solution: 'SELECT first_name, last_name, hire_date FROM employees ORDER BY hire_date DESC LIMIT 5;',
          orderMatters: true,
          hints: ['Dates stored as `YYYY-MM-DD` text sort correctly as text.'],
          explain: 'ISO-8601 is the only text date format where lexical order equals chronological order — one reason to always store dates that way.'
        }
      ],
      quiz: [
        {
          q: 'ORDER BY last_name, salary DESC — what does DESC apply to?',
          options: ['Both columns', 'Only salary', 'Only last_name'],
          answer: 1,
          explain: 'Direction is per key. Writing ORDER BY last_name DESC, salary DESC is needed to reverse both.'
        }
      ]
    },

    {
      id: 'limit-offset',
      title: 'LIMIT, OFFSET and pagination',
      lede: 'Taking the top N rows — and the trap that makes page 50 of a report show the wrong rows.',
      body: `
        ## LIMIT
        ~~~sql
        SELECT product_name, unit_price FROM products ORDER BY unit_price DESC LIMIT 3;
        ~~~

        **\`LIMIT\` without \`ORDER BY\` is meaningless**: you get three arbitrary rows, not the top three.

        ## OFFSET
        \`OFFSET n\` skips the first n rows of the ordered result. Classic pagination:

        ~~~sql
        SELECT product_id, product_name
        FROM products
        ORDER BY product_id
        LIMIT 10 OFFSET 20;   -- page 3, 10 per page
        ~~~

        Two problems appear at scale:

        1. **Drift.** If a row is inserted while a user pages through, rows shift and the user sees an
           item twice or misses one.
        2. **Cost.** \`OFFSET 100000\` makes the engine produce and discard 100 000 rows.

        ## Keyset ("seek") pagination
        Remember the last key you saw and filter on it instead:

        ~~~sql
        -- first page
        SELECT product_id, product_name FROM products ORDER BY product_id LIMIT 5;
        ~~~

        ~~~sql
        -- next page: continue after the last product_id of the previous page
        SELECT product_id, product_name
        FROM products
        WHERE product_id > 5
        ORDER BY product_id
        LIMIT 5;
        ~~~

        This is O(log n) with an index on the sort key, and stable under concurrent inserts. For a
        multi-column sort you compare tuples: \`WHERE (sort_a, id) > (:last_a, :last_id)\` (supported in
        PostgreSQL, MySQL and SQLite).

        :::dialect Syntax for "top N"
        | Engine | Syntax |
        | --- | --- |
        | SQLite, PostgreSQL, MySQL | \`LIMIT 10 OFFSET 20\` |
        | Standard SQL, PostgreSQL, Oracle 12c+, SQL Server 2012+ | \`OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY\` |
        | SQL Server (classic) | \`SELECT TOP 10 ...\` |
        | MySQL (legacy shorthand) | \`LIMIT 20, 10\` — offset first! |
        \`FETCH FIRST n ROWS WITH TIES\` includes rows tied with the last one; elsewhere use \`RANK()\`.
        :::
      `,
      exercises: [
        {
          prompt: 'Return the 3 cheapest products that are **not** discontinued: `product_name` and `unit_price`, cheapest first.',
          starter: '',
          solution: 'SELECT product_name, unit_price FROM products WHERE discontinued = 0 ORDER BY unit_price LIMIT 3;',
          orderMatters: true,
          hints: ['Filter first, then sort, then limit.'],
          explain: 'WHERE runs before ORDER BY and LIMIT, so the limit applies to the filtered set.'
        },
        {
          prompt: 'Return rows 6 to 10 (the second page of five) of `customers` ordered by `company_name`: just `company_name`.',
          starter: '',
          solution: 'SELECT company_name FROM customers ORDER BY company_name LIMIT 5 OFFSET 5;',
          orderMatters: true,
          hints: ['Page size 5, so skip 5.'],
          explain: 'Fine for a 22-row table. For a million rows, prefer keyset pagination.'
        }
      ],
      quiz: [
        {
          q: 'Why can OFFSET-based pagination show a user the same row twice?',
          options: ['Because OFFSET is approximate', 'Because rows inserted or deleted meanwhile shift the window', 'Because LIMIT does not guarantee order'],
          answer: 1,
          explain: 'The offset is positional, so any change earlier in the ordering shifts every later page.'
        }
      ]
    },

    {
      id: 'query-shape',
      title: 'The shape of a SELECT statement',
      lede: 'The clause order you must write, versus the order the database actually evaluates them.',
      body: `
        ## Written order
        Clauses must appear in this order. Everything except \`SELECT\` is optional:

        ~~~sql-static
        SELECT   DISTINCT expressions
        FROM     tables and joins
        WHERE    row filter
        GROUP BY grouping keys
        HAVING   group filter
        WINDOW   named windows
        ORDER BY sort keys
        LIMIT    n OFFSET m
        ~~~

        (\`WITH\` — common table expressions, module 07 — comes before \`SELECT\`.)

        ## Evaluation order
        The database behaves *as if* it evaluated the clauses in a different order:

        1. \`FROM\` / \`JOIN\` — build the working set of rows
        2. \`WHERE\` — discard rows
        3. \`GROUP BY\` — collapse rows into groups
        4. \`HAVING\` — discard groups
        5. \`SELECT\` — compute output expressions (window functions happen here)
        6. \`DISTINCT\`
        7. \`ORDER BY\`
        8. \`LIMIT\` / \`OFFSET\`

        This single list explains most beginner errors:

        - **Why can't I use an alias in \`WHERE\`?** \`WHERE\` runs before \`SELECT\`, so the alias does not
          exist yet. (\`ORDER BY\` runs after, which is why aliases work there.)
        - **Why can't I put \`count(*)\` in \`WHERE\`?** Aggregates are formed at step 3; \`WHERE\` is step 2.
          Use \`HAVING\`.
        - **Why can't I filter on a window function in \`WHERE\`?** Windows are computed at step 5. Wrap the
          query in a subquery, or use \`QUALIFY\` where it exists.

        ~~~sql
        -- a query using every clause
        SELECT c.country,
               count(*)                       AS order_count,
               round(sum(o.freight), 2)        AS total_freight
        FROM orders AS o
        JOIN customers AS c ON c.customer_id = o.customer_id
        WHERE o.status <> 'cancelled'
        GROUP BY c.country
        HAVING count(*) >= 5
        ORDER BY order_count DESC, c.country
        LIMIT 10;
        ~~~

        Read it in evaluation order and it tells a story: take orders joined to customers, drop cancelled
        ones, group what is left by country, keep countries with at least five orders, compute the counts,
        sort, take ten.

        :::tip Build queries incrementally
        Start with \`SELECT * FROM one_table LIMIT 10\`. Add one clause, run it, look at the rows. Most SQL
        bugs are caught by looking at intermediate output, not by staring at a 40-line query.
        :::
      `,
      exercises: [
        {
          prompt: 'Fix this query so it runs: it tries to filter on an alias in `WHERE`.\n\n~~~sql-static\nSELECT product_name, unit_price * 1.19 AS gross\nFROM products\nWHERE gross > 500;\n~~~\n\nReturn `product_name` and the gross price as `gross` for products whose gross price exceeds 500.',
          starter: 'SELECT product_name, unit_price * 1.19 AS gross\nFROM products\nWHERE ;',
          solution: 'SELECT product_name, unit_price * 1.19 AS gross\nFROM products\nWHERE unit_price * 1.19 > 500;',
          hints: ['`WHERE` cannot see `SELECT` aliases — repeat the expression.', 'Alternatively wrap it: `SELECT * FROM (SELECT ... AS gross FROM products) WHERE gross > 500;`'],
          explain: 'Repeating the expression is fine. A derived table (module 07) avoids the duplication when the expression is long.'
        }
      ],
      quiz: [
        {
          q: 'Which clause can refer to a SELECT-list alias in nearly every engine?',
          options: ['WHERE', 'ORDER BY', 'GROUP BY in SQL Server'],
          answer: 1,
          explain: 'ORDER BY is evaluated after SELECT. (SQLite, MySQL and PostgreSQL also allow aliases in GROUP BY/HAVING, but that is not portable.)'
        },
        {
          q: 'Rows are discarded by WHERE at which point relative to GROUP BY?',
          options: ['Before grouping', 'After grouping', 'At the same time'],
          answer: 0,
          explain: 'WHERE filters rows before groups exist; HAVING filters the groups afterwards.'
        }
      ]
    }
  ]
});
