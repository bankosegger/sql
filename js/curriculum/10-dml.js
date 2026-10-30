(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'dml',
  title: 'Changing data (DML)',
  blurb: 'INSERT, UPDATE, DELETE, UPSERT and RETURNING — safely.',
  lessons: [

    {
      id: 'insert',
      title: 'INSERT',
      lede: 'Adding rows one at a time, in batches, and from the result of a query.',
      body: `
        ## Always name your columns
        ~~~sql
        CREATE TABLE couriers (courier_id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT);
        INSERT INTO couriers (name, country) VALUES ('DHL Express', 'Germany');
        SELECT * FROM couriers;
        ~~~

        \`INSERT INTO couriers VALUES (1, 'DHL', 'DE')\` works too, but it depends on column order: the
        day someone adds a column, every positional insert in your codebase silently writes the wrong
        values or fails. Name the columns.

        Omitted columns receive their \`DEFAULT\`, or \`NULL\` if there is none — and the statement fails
        if such a column is \`NOT NULL\` without a default.

        ## Multi-row inserts
        ~~~sql
        CREATE TABLE couriers (courier_id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT);
        INSERT INTO couriers (name, country) VALUES
          ('DHL Express', 'Germany'),
          ('UPS',         'United States'),
          ('PostNord',    'Sweden');
        SELECT courier_id, name FROM couriers ORDER BY courier_id;
        ~~~

        One statement with many rows is dramatically faster than many statements: one parse, one pass,
        one transaction. For large loads, batch a few hundred to a few thousand rows per statement and
        wrap the batches in explicit transactions (module 11).

        ## INSERT ... SELECT
        The real workhorse — copy, archive, or transform data without a round trip through your
        application:

        ~~~sql
        CREATE TABLE top_customers (customer_id INTEGER PRIMARY KEY, company_name TEXT, orders INTEGER);
        INSERT INTO top_customers (customer_id, company_name, orders)
        SELECT c.customer_id, c.company_name, count(*)
        FROM customers c JOIN orders o ON o.customer_id = c.customer_id
        GROUP BY c.customer_id, c.company_name
        HAVING count(*) >= 20;
        SELECT * FROM top_customers ORDER BY orders DESC, customer_id;
        ~~~

        The \`SELECT\` list must line up positionally with the column list — there is no name matching.

        ## INSERT with a CTE
        ~~~sql
        CREATE TABLE product_flags (product_id INTEGER PRIMARY KEY, flag TEXT NOT NULL);
        INSERT INTO product_flags (product_id, flag)
        WITH stock_status AS (
          SELECT product_id,
                 CASE WHEN units_in_stock = 0 THEN 'out_of_stock'
                      WHEN units_in_stock < 25 THEN 'low'
                      ELSE 'ok' END AS flag
          FROM products
        )
        SELECT product_id, flag FROM stock_status WHERE flag <> 'ok';
        SELECT flag, count(*) AS products FROM product_flags GROUP BY flag ORDER BY flag;
        ~~~

        ## Conflict handling
        What to do when a row violates a constraint:

        | Spelling | Effect |
        | --- | --- |
        | \`INSERT\` | fail (default) |
        | \`INSERT OR IGNORE\` (SQLite, MySQL \`INSERT IGNORE\`) | skip the offending row |
        | \`INSERT OR REPLACE\` | delete the conflicting row, insert the new one |
        | \`INSERT ... ON CONFLICT DO UPDATE\` | merge — see the upsert lesson |

        \`OR REPLACE\` is a trap: it is a delete plus an insert, so it fires delete triggers, loses
        columns you did not supply, and can cascade to children. Prefer a real upsert.

        ## Finding out what was inserted
        \`RETURNING\` (last lesson of this module) is the modern answer. Otherwise:
        \`last_insert_rowid()\` in SQLite, \`LASTVAL()\`/\`currval\` in PostgreSQL,
        \`LAST_INSERT_ID()\` in MySQL, \`SCOPE_IDENTITY()\` in SQL Server.

        ~~~sql
        CREATE TABLE notes (note_id INTEGER PRIMARY KEY, body TEXT);
        INSERT INTO notes (body) VALUES ('hello');
        SELECT last_insert_rowid() AS new_id;
        ~~~
      `,
      exercises: [
        {
          tag: 'DML',
          prompt: 'Create a table `couriers` (`courier_id` INTEGER primary key, `name` TEXT not null, `country` TEXT) and insert these three rows **in one statement**, letting the ids auto-assign: DHL Express/Germany, UPS/United States, PostNord/Sweden.',
          starter: '',
          solution: "CREATE TABLE couriers (courier_id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT);\nINSERT INTO couriers (name, country) VALUES\n  ('DHL Express', 'Germany'),\n  ('UPS', 'United States'),\n  ('PostNord', 'Sweden');",
          check: 'SELECT courier_id, name, country FROM couriers ORDER BY courier_id;',
          hints: ['One `VALUES` clause with three parenthesised tuples separated by commas.'],
          explain: 'A single multi-row INSERT is one parse and one pass — the difference is dramatic at scale.'
        },
        {
          tag: 'DML',
          prompt: 'Create `top_customers` (`customer_id` INTEGER primary key, `company_name` TEXT, `orders` INTEGER) and populate it with `INSERT ... SELECT`: every customer with 20 or more orders, and their order count.',
          starter: 'CREATE TABLE top_customers (customer_id INTEGER PRIMARY KEY, company_name TEXT, orders INTEGER);\n\nINSERT INTO top_customers (customer_id, company_name, orders)\n',
          solution: 'CREATE TABLE top_customers (customer_id INTEGER PRIMARY KEY, company_name TEXT, orders INTEGER);\nINSERT INTO top_customers (customer_id, company_name, orders)\nSELECT c.customer_id, c.company_name, count(*)\nFROM customers c JOIN orders o ON o.customer_id = c.customer_id\nGROUP BY c.customer_id, c.company_name\nHAVING count(*) >= 20;',
          check: 'SELECT customer_id, company_name, orders FROM top_customers ORDER BY orders DESC, customer_id;',
          hints: ['No `VALUES` — the SELECT provides the rows.', 'The SELECT list must match the column list positionally.'],
          explain: 'INSERT…SELECT keeps the whole operation inside the database: no rows cross the wire.'
        }
      ],
      quiz: [
        {
          q: 'Why is INSERT OR REPLACE risky?',
          options: ['It is slower', 'It deletes the existing row — firing triggers and cascades, and losing columns you did not supply', 'It only works on SQLite'],
          answer: 1,
          explain: 'It is a delete-then-insert, not an update. Use ON CONFLICT DO UPDATE when you mean "merge".'
        }
      ]
    },

    {
      id: 'update',
      title: 'UPDATE',
      lede: 'Changing existing rows — including from the contents of another table.',
      body: `
        ## The shape
        ~~~sql
        UPDATE products
        SET unit_price = round(unit_price * 1.05, 2)
        WHERE category_id = 1;
        SELECT product_id, product_name, unit_price FROM products WHERE category_id = 1 ORDER BY product_id;
        ~~~

        Several columns at once, and expressions may reference the row's current values:

        ~~~sql
        UPDATE employees
        SET salary = round(salary * 1.03, 2),
            job_title = job_title || ' (2026 band)'
        WHERE dept_id = 4;
        SELECT emp_id, job_title, salary FROM employees WHERE dept_id = 4 ORDER BY emp_id;
        ~~~

        :::warn The missing WHERE
        \`UPDATE products SET unit_price = 0\` is valid SQL and updates **every row**. Habits that prevent
        this: write the \`WHERE\` clause first; run the predicate as a \`SELECT\` before converting it to an
        \`UPDATE\`; and work inside an explicit transaction so you can \`ROLLBACK\` (module 11).
        :::

        ## Check the predicate first
        ~~~sql
        -- step 1: look at exactly the rows you intend to change
        SELECT product_id, product_name, unit_price, units_in_stock
        FROM products
        WHERE units_in_stock < 20 AND discontinued = 0;
        ~~~

        ~~~sql
        -- step 2: the same predicate, now in the UPDATE
        UPDATE products SET discontinued = 1
        WHERE units_in_stock < 20 AND discontinued = 0;
        SELECT changes() AS rows_changed;
        ~~~

        \`changes()\` (SQLite), \`ROW_COUNT()\` (MySQL), \`@@ROWCOUNT\` (SQL Server) report how many rows a
        statement touched. If the number surprises you, roll back.

        ## UPDATE from another table
        "Set each product's price to the average price it actually sold for" needs data from a second
        table. The portable form is a correlated subquery:

        ~~~sql
        UPDATE products
        SET unit_price = (
          SELECT round(avg(i.unit_price), 2)
          FROM order_items i
          WHERE i.product_id = products.product_id
        )
        WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = products.product_id);
        SELECT product_id, unit_price FROM products ORDER BY product_id LIMIT 8;
        ~~~

        The \`WHERE EXISTS\` guard matters: without it, products that were never ordered would get
        \`NULL\` (the subquery returns no row) instead of keeping their price.

        SQLite 3.33+, PostgreSQL and SQL Server also support a \`FROM\` clause in \`UPDATE\`, which reads
        better and is usually faster:

        ~~~sql
        UPDATE products
        SET unit_price = agg.avg_price
        FROM (SELECT product_id, round(avg(unit_price), 2) AS avg_price
              FROM order_items GROUP BY product_id) AS agg
        WHERE agg.product_id = products.product_id;
        SELECT product_id, unit_price FROM products ORDER BY product_id LIMIT 8;
        ~~~

        MySQL uses multi-table update syntax instead: \`UPDATE a JOIN b ON ... SET a.col = b.col\`.

        ## Conditional updates in one pass
        ~~~sql
        UPDATE orders
        SET status = CASE
                       WHEN ship_date IS NOT NULL THEN 'delivered'
                       WHEN status = 'pending' AND order_date < '2025-01-01' THEN 'cancelled'
                       ELSE status
                     END;
        SELECT status, count(*) AS orders FROM orders GROUP BY status ORDER BY status;
        ~~~

        One statement, several rules — and \`ELSE status\` leaves untouched rows alone.
      `,
      exercises: [
        {
          tag: 'DML',
          prompt: 'Mark every product with fewer than 20 units in stock as discontinued (`discontinued = 1`), leaving everything else unchanged.',
          starter: 'UPDATE products\nSET ',
          solution: 'UPDATE products SET discontinued = 1 WHERE units_in_stock < 20;',
          check: 'SELECT product_id, units_in_stock, discontinued FROM products ORDER BY product_id;',
          hints: ['One SET, one WHERE.'],
          explain: 'The WHERE clause is the whole safety mechanism of an UPDATE.'
        },
        {
          tag: 'DML',
          prompt: 'Give every employee in department 4 a 3% raise, rounded to 2 decimals. Nobody else may change.',
          starter: '',
          solution: 'UPDATE employees SET salary = round(salary * 1.03, 2) WHERE dept_id = 4;',
          check: 'SELECT emp_id, dept_id, salary FROM employees ORDER BY emp_id;',
          hints: ['The new value may reference the old one.'],
          explain: 'Self-referencing expressions are evaluated per row against that row’s current values.'
        },
        {
          tag: 'DML',
          prompt: 'Set each product’s `unit_price` to the **average price it has actually sold for** (from `order_items`), rounded to 2 decimals. Products that were never ordered must keep their current price (not become NULL).',
          starter: 'UPDATE products\nSET unit_price = (\n  \n)\nWHERE ',
          solution: 'UPDATE products\nSET unit_price = (\n  SELECT round(avg(i.unit_price), 2) FROM order_items i WHERE i.product_id = products.product_id\n)\nWHERE EXISTS (SELECT 1 FROM order_items i WHERE i.product_id = products.product_id);',
          check: 'SELECT product_id, unit_price FROM products ORDER BY product_id;',
          hints: ['The subquery correlates on `products.product_id`.', 'Guard the statement with `WHERE EXISTS (...)` so unsold products are not touched.'],
          explain: 'Without the EXISTS guard, the one never-ordered product would have had its price set to NULL.'
        }
      ]
    },

    {
      id: 'delete',
      title: 'DELETE',
      lede: 'Removing rows, deduplicating, and the safer alternative most systems should use instead.',
      body: `
        ## The shape
        ~~~sql
        DELETE FROM reviews WHERE rating = 1;
        SELECT changes() AS rows_deleted, (SELECT count(*) FROM reviews) AS remaining;
        ~~~

        \`DELETE FROM t\` with no \`WHERE\` empties the table. There is no undo outside a transaction.

        ## Deleting based on another table
        ~~~sql
        DELETE FROM reviews
        WHERE product_id IN (SELECT product_id FROM products WHERE discontinued = 1);
        SELECT count(*) AS reviews_left FROM reviews;
        ~~~

        Or with \`EXISTS\`, which handles NULLs safely and often performs better:

        ~~~sql
        DELETE FROM payments
        WHERE EXISTS (SELECT 1 FROM orders o WHERE o.order_id = payments.order_id AND o.status = 'cancelled');
        SELECT count(*) AS payments_left FROM payments;
        ~~~

        ## Deduplication
        Keep one row per key and delete the rest. With a unique row id this is a one-liner:

        ~~~sql
        DELETE FROM staging_customers
        WHERE row_id NOT IN (
          SELECT min(row_id) FROM staging_customers GROUP BY lower(trim(company_name))
        );
        SELECT row_id, company_name FROM staging_customers ORDER BY row_id;
        ~~~

        The window-function version expresses richer rules ("keep the newest per key"):

        ~~~sql
        DELETE FROM staging_customers
        WHERE row_id IN (
          SELECT row_id FROM (
            SELECT row_id,
                   ROW_NUMBER() OVER (PARTITION BY lower(trim(company_name))
                                      ORDER BY loaded_at DESC, row_id DESC) AS rn
            FROM staging_customers
          ) WHERE rn > 1
        );
        SELECT row_id, company_name, loaded_at FROM staging_customers ORDER BY row_id;
        ~~~

        ## Foreign keys decide what is possible
        A delete that would orphan child rows is **rejected** unless the relationship says otherwise:
        \`ON DELETE CASCADE\` removes the children, \`SET NULL\` detaches them (module 09). Deleting a
        parent is therefore never a local decision — know the cascade graph first.

        ## Soft deletes
        Most production systems do not delete at all. They mark:

        ~~~sql
        ALTER TABLE customers ADD COLUMN deleted_at TEXT;
        UPDATE customers SET deleted_at = datetime('now') WHERE customer_id = 21;
        SELECT customer_id, company_name, deleted_at FROM customers WHERE deleted_at IS NOT NULL;
        ~~~

        Trade-offs: history and references survive, and an accidental "delete" is reversible — but
        **every query must now filter** \`WHERE deleted_at IS NULL\`, unique constraints need care
        (a deleted email still occupies the key), and the table keeps growing. A view
        (module 11) that hides deleted rows removes most of the repetition.

        ## Large deletes
        Deleting millions of rows in one statement bloats the transaction log, holds locks, and can take
        the table offline. Delete in batches:

        ~~~sql-static
        -- repeat until no rows are affected
        DELETE FROM events WHERE id IN (
          SELECT id FROM events WHERE created_at < '2023-01-01' LIMIT 10000
        );
        ~~~

        For wholesale cleanup, \`TRUNCATE\` (or copying the rows you keep into a new table and swapping)
        is far cheaper than a big \`DELETE\`.
      `,
      exercises: [
        {
          tag: 'DML',
          prompt: 'Delete every review with a rating of 1 or 2.',
          starter: '',
          solution: 'DELETE FROM reviews WHERE rating IN (1, 2);',
          check: 'SELECT rating, count(*) AS reviews FROM reviews GROUP BY rating ORDER BY rating;',
          hints: ['`WHERE rating IN (1, 2)` or `rating <= 2`.'],
          explain: 'Low-rating reviews are gone; the remaining distribution proves it.'
        },
        {
          tag: 'DML',
          prompt: 'Deduplicate `staging_customers`: keep only the **lowest** `row_id` per canonical (lower-cased, trimmed) company name and delete the rest.',
          starter: 'DELETE FROM staging_customers\nWHERE row_id NOT IN (\n  \n);',
          solution: 'DELETE FROM staging_customers\nWHERE row_id NOT IN (\n  SELECT min(row_id) FROM staging_customers GROUP BY lower(trim(company_name))\n);',
          check: 'SELECT row_id, company_name FROM staging_customers ORDER BY row_id;',
          hints: ['The subquery lists the rows to keep.', '`NOT IN` is safe here because `min(row_id)` can never be NULL.'],
          explain: 'Four duplicate rows removed. With a richer keep-rule, use the ROW_NUMBER variant.'
        },
        {
          tag: 'DML',
          prompt: 'Delete all payments that belong to cancelled orders, using `EXISTS`.',
          starter: '',
          solution: "DELETE FROM payments\nWHERE EXISTS (SELECT 1 FROM orders o WHERE o.order_id = payments.order_id AND o.status = 'cancelled');",
          check: 'SELECT count(*) AS payments_left, round(sum(amount), 2) AS total_left FROM payments;',
          hints: ['Correlate the subquery on `payments.order_id`.'],
          explain: 'Correlated EXISTS inside DELETE is the portable way to delete "rows whose parent looks like this".'
        }
      ],
      quiz: [
        {
          q: 'The main cost of a soft delete is:',
          options: ['Disk space only', 'Every query must remember to filter out deleted rows', 'It cannot be indexed'],
          answer: 1,
          explain: 'One forgotten filter resurrects deleted data in a report. A view that encapsulates the filter is the usual mitigation.'
        }
      ]
    },

    {
      id: 'upsert',
      title: 'UPSERT: insert or update',
      lede: 'Making a load idempotent — the single most useful DML feature for data pipelines.',
      body: `
        ## The problem
        A nightly load receives rows that may or may not already exist. Doing it in two statements
        ("check, then insert or update") is racy: another session can insert between your check and your
        write. An upsert is one atomic statement.

        ## ON CONFLICT DO UPDATE
        The standard-ish spelling, supported by SQLite 3.24+ and PostgreSQL 9.5+:

        ~~~sql
        CREATE TABLE stock_counts (
          product_id INTEGER PRIMARY KEY,
          counted_on TEXT NOT NULL,
          units      INTEGER NOT NULL
        );

        INSERT INTO stock_counts (product_id, counted_on, units) VALUES (1, '2025-10-01', 100);

        -- same key again: update instead of failing
        INSERT INTO stock_counts (product_id, counted_on, units)
        VALUES (1, '2025-10-02', 120)
        ON CONFLICT (product_id) DO UPDATE
        SET units      = excluded.units,
            counted_on = excluded.counted_on;

        SELECT * FROM stock_counts;
        ~~~

        \`excluded\` is the pseudo-table holding the row you tried to insert. You can combine it with the
        existing values — this accumulates instead of replacing:

        ~~~sql
        CREATE TABLE stock_counts (product_id INTEGER PRIMARY KEY, units INTEGER NOT NULL);
        INSERT INTO stock_counts VALUES (1, 100);
        INSERT INTO stock_counts VALUES (1, 20)
        ON CONFLICT (product_id) DO UPDATE SET units = stock_counts.units + excluded.units;
        SELECT * FROM stock_counts;
        ~~~

        Qualify the column with the table name (\`stock_counts.units\`) to mean "the value already stored".

        ## DO NOTHING, and conditional updates
        ~~~sql
        CREATE TABLE stock_counts (product_id INTEGER PRIMARY KEY, counted_on TEXT, units INTEGER);
        INSERT INTO stock_counts VALUES (1, '2025-10-05', 100);
        -- ignore an older measurement, accept a newer one
        INSERT INTO stock_counts VALUES (1, '2025-09-01', 55)
        ON CONFLICT (product_id) DO UPDATE SET units = excluded.units, counted_on = excluded.counted_on
          WHERE excluded.counted_on > stock_counts.counted_on;
        SELECT * FROM stock_counts;
        ~~~

        \`ON CONFLICT DO NOTHING\` is the explicit "skip duplicates" form — \`INSERT OR IGNORE\` with a
        named target.

        ## The conflict target
        \`ON CONFLICT (cols)\` must name a column set with a \`PRIMARY KEY\` or \`UNIQUE\` constraint —
        that constraint is what makes "the same row" meaningful. If your upsert target has no unique
        constraint, the operation is not well defined.

        ## MERGE
        Standard SQL's general form, in SQL Server, Oracle, and PostgreSQL 15+:

        ~~~sql-static
        MERGE INTO stock_counts AS t
        USING incoming AS s ON t.product_id = s.product_id
        WHEN MATCHED AND s.counted_on > t.counted_on THEN UPDATE SET units = s.units
        WHEN MATCHED AND s.units = 0 THEN DELETE
        WHEN NOT MATCHED THEN INSERT (product_id, units) VALUES (s.product_id, s.units);
        ~~~

        It handles whole source tables and can delete as well as update. MySQL's equivalent is
        \`INSERT ... ON DUPLICATE KEY UPDATE col = VALUES(col)\`.

        ## Upsert from a query
        The source can be a \`SELECT\`, which is how a whole batch is merged in one statement:

        ~~~sql
        CREATE TABLE product_stats (product_id INTEGER PRIMARY KEY, units INTEGER NOT NULL);
        INSERT INTO product_stats (product_id, units)
        SELECT product_id, sum(quantity) FROM order_items GROUP BY product_id
        ON CONFLICT (product_id) DO UPDATE SET units = excluded.units;
        SELECT count(*) AS rows_loaded, sum(units) AS total_units FROM product_stats;
        ~~~

        Running that statement twice gives the same result as running it once — the definition of an
        **idempotent** load, and the reason pipelines are built this way.
      `,
      exercises: [
        {
          tag: 'DML',
          prompt: 'Create `stock_counts` (`product_id` INTEGER primary key, `counted_on` TEXT not null, `units` INTEGER not null). Insert `(1, \'2025-10-01\', 100)`, then upsert `(1, \'2025-10-02\', 120)` so the row ends up with the **newer** date and units, and finally upsert `(2, \'2025-10-02\', 40)` which must insert a new row.',
          starter: '',
          solution: "CREATE TABLE stock_counts (product_id INTEGER PRIMARY KEY, counted_on TEXT NOT NULL, units INTEGER NOT NULL);\nINSERT INTO stock_counts VALUES (1, '2025-10-01', 100);\nINSERT INTO stock_counts VALUES (1, '2025-10-02', 120)\nON CONFLICT (product_id) DO UPDATE SET units = excluded.units, counted_on = excluded.counted_on;\nINSERT INTO stock_counts VALUES (2, '2025-10-02', 40)\nON CONFLICT (product_id) DO UPDATE SET units = excluded.units, counted_on = excluded.counted_on;",
          check: 'SELECT product_id, counted_on, units FROM stock_counts ORDER BY product_id;',
          requireSql: [{ pattern: 'on\\s+conflict', msg: 'Use `ON CONFLICT ... DO UPDATE` rather than a DELETE + INSERT.' }],
          hints: ['`ON CONFLICT (product_id) DO UPDATE SET col = excluded.col`.', '`excluded` refers to the row you tried to insert.'],
          explain: 'One statement that works whether or not the row exists — safe to re-run, safe under concurrency.'
        },
        {
          tag: 'DML',
          prompt: 'Create `product_stats` (`product_id` INTEGER primary key, `units` INTEGER not null) and load total ordered quantity per product into it with a single idempotent `INSERT ... SELECT ... ON CONFLICT` statement. Then run the identical load statement a second time — the result must not change.',
          starter: '',
          solution: 'CREATE TABLE product_stats (product_id INTEGER PRIMARY KEY, units INTEGER NOT NULL);\nINSERT INTO product_stats (product_id, units)\nSELECT product_id, sum(quantity) FROM order_items GROUP BY product_id\nON CONFLICT (product_id) DO UPDATE SET units = excluded.units;\nINSERT INTO product_stats (product_id, units)\nSELECT product_id, sum(quantity) FROM order_items GROUP BY product_id\nON CONFLICT (product_id) DO UPDATE SET units = excluded.units;',
          check: 'SELECT product_id, units FROM product_stats ORDER BY product_id;',
          hints: ['The conflict clause goes after the SELECT.', 'Run the same statement twice to prove idempotency.'],
          explain: 'Idempotency is what lets a pipeline be retried after a failure without reconciling anything by hand.'
        }
      ],
      quiz: [
        {
          q: 'What does ON CONFLICT require of the target columns?',
          options: ['Nothing', 'A PRIMARY KEY or UNIQUE constraint', 'An index of any kind'],
          answer: 1,
          explain: 'Without a uniqueness constraint there is no definition of "the same row" to merge into.'
        }
      ]
    },

    {
      id: 'returning',
      title: 'RETURNING and safe DML habits',
      lede: 'Getting the affected rows back from a write, and a checklist that prevents data-loss incidents.',
      body: `
        ## RETURNING
        \`RETURNING\` makes a write statement also produce a result set — the rows as they ended up,
        including generated keys and defaults. No second round trip, no race:

        ~~~sql
        CREATE TABLE couriers (courier_id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
        INSERT INTO couriers (name) VALUES ('DHL Express'), ('UPS')
        RETURNING courier_id, name, created_at IS NOT NULL AS stamped;
        ~~~

        It works on \`UPDATE\` and \`DELETE\` too, which is how you audit exactly what a statement did:

        ~~~sql
        UPDATE products SET discontinued = 1
        WHERE units_in_stock < 20 AND discontinued = 0
        RETURNING product_id, product_name, units_in_stock;
        ~~~

        ~~~sql
        DELETE FROM reviews WHERE rating = 1
        RETURNING review_id, product_id, rating;
        ~~~

        Available in PostgreSQL (since 8.2), SQLite 3.35+, Oracle (\`RETURNING INTO\`), MariaDB; SQL Server
        uses \`OUTPUT\` with the \`INSERTED\`/\`DELETED\` pseudo-tables. MySQL has no equivalent.

        A powerful combination is "move rows" in one statement — delete and insert what came back:

        ~~~sql-static
        WITH moved AS (
          DELETE FROM orders WHERE order_date < '2024-01-01' RETURNING *
        )
        INSERT INTO orders_archive SELECT * FROM moved;
        ~~~

        (PostgreSQL supports DML inside a CTE like this; SQLite does not.)

        ## A checklist for writing DML against real data
        1. **Write the \`SELECT\` first.** Same \`FROM\` and \`WHERE\`, eyeball the rows.
        2. **Count them.** Does the number match your expectation?
        3. **Open a transaction.** \`BEGIN;\` … verify … \`COMMIT;\` or \`ROLLBACK;\` (module 11).
        4. **Use \`RETURNING\`** (or \`changes()\`) to see what actually happened.
        5. **Prefer narrow predicates on keys** over broad conditions.
        6. **Never test on production.** A \`WHERE\` typo is indistinguishable from an attack.
        7. **Have a backup you have actually restored.** An untested backup is a hope.

        ~~~sql
        -- the whole cycle in one script
        BEGIN;
        SELECT count(*) AS will_change FROM products WHERE units_in_stock < 20 AND discontinued = 0;
        UPDATE products SET discontinued = 1 WHERE units_in_stock < 20 AND discontinued = 0;
        SELECT changes() AS actually_changed;
        ROLLBACK;        -- or COMMIT, once the numbers agree
        SELECT count(*) AS unchanged_after_rollback FROM products WHERE discontinued = 1;
        ~~~

        ## Bulk-load patterns
        - Load into a **staging table** with no constraints, clean it there, then merge into the real
          table with an upsert.
        - Wrap batches in transactions; one transaction per row is slow, one for ten million rows is a
          lock problem.
        - Drop and recreate large secondary indexes around a huge load.
        - Make every load **idempotent** so retries are free.
      `,
      exercises: [
        {
          tag: 'DML',
          prompt: 'In one statement, mark as discontinued every product with fewer than 20 units in stock that is not yet discontinued, and have the statement return `product_id`, `product_name` and `units_in_stock` for the rows it changed, using `RETURNING`.',
          starter: '',
          solution: 'UPDATE products SET discontinued = 1\nWHERE units_in_stock < 20 AND discontinued = 0\nRETURNING product_id, product_name, units_in_stock;',
          requireSql: [{ pattern: 'returning', msg: 'Use the `RETURNING` clause.' }],
          hints: ['`RETURNING` goes at the very end of the statement.'],
          explain: 'The rows come back from the write itself — no follow-up SELECT, and no window in which another session could change them.'
        },
        {
          tag: 'DML',
          prompt: 'Delete the reviews with rating 1 and return `review_id`, `product_id` and `rating` for each deleted row, ordered however the engine returns them.',
          starter: '',
          solution: 'DELETE FROM reviews WHERE rating = 1 RETURNING review_id, product_id, rating;',
          requireSql: [{ pattern: 'returning', msg: 'Use `RETURNING` on the DELETE.' }],
          hints: ['Same clause, on a DELETE.'],
          explain: 'A deleted row is otherwise unrecoverable information — RETURNING is how you log precisely what went.'
        }
      ],
      quiz: [
        {
          q: 'Before running an UPDATE on production data, the most valuable habit is:',
          options: ['Add a LIMIT', 'Run the same WHERE as a SELECT and check the row count', 'Disable constraints first'],
          answer: 1,
          explain: 'The predicate is where the mistakes are. Seeing the exact rows, and their count, catches almost all of them.'
        }
      ]
    }
  ]
});
