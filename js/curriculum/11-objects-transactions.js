(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'objects',
  title: 'Views, transactions and security',
  blurb: 'Views, ACID transactions, isolation levels, locking, triggers, stored routines, privileges and injection.',
  lessons: [

    {
      id: 'views',
      title: 'Views',
      lede: 'Naming a query so everyone uses the same definition of "active customer".',
      body: `
        ## A view is a stored query
        ~~~sql
        CREATE VIEW v_order_totals AS
        SELECT o.order_id,
               o.customer_id,
               o.order_date,
               o.status,
               COALESCE(sum(i.unit_price * i.quantity * (1 - i.discount)), 0) AS order_total
        FROM orders o
        LEFT JOIN order_items i ON i.order_id = o.order_id
        GROUP BY o.order_id, o.customer_id, o.order_date, o.status;

        SELECT order_id, order_date, round(order_total, 2) AS order_total
        FROM v_order_totals
        WHERE status <> 'cancelled'
        ORDER BY order_total DESC
        LIMIT 8;
        ~~~

        It stores **no data**: every query against the view re-runs the underlying SQL. A view is for
        encapsulation, not caching.

        ## What views are good for
        - **One definition of a business rule.** \`v_active_customers\` means the same thing in every
          report, and fixing the rule fixes every consumer.
        - **Hiding complexity.** Six-table joins become \`SELECT * FROM v_sales_fact\`.
        - **A stable interface.** You can reshape the tables underneath while the view keeps its shape —
          very useful during migrations.
        - **Column-level security.** Grant access to a view that omits salaries rather than to the table.

        ~~~sql
        CREATE VIEW v_employee_public AS
        SELECT emp_id, first_name, last_name, job_title, dept_id FROM employees;   -- no salary
        SELECT * FROM v_employee_public ORDER BY emp_id LIMIT 5;
        ~~~

        ## Updatable views
        A **simple** view (one table, no aggregates, no \`DISTINCT\`, no joins) is often writable
        directly: PostgreSQL, SQL Server, MySQL and Oracle all allow it under those conditions. SQLite
        views are **read-only**, but an \`INSTEAD OF\` trigger can make them writable.

        PostgreSQL also offers \`WITH CHECK OPTION\`, which rejects writes that would produce rows the
        view cannot see.

        ## Materialised views
        A materialised view **does** store its result — a cache with a refresh policy:

        | Engine | Support |
        | --- | --- |
        | PostgreSQL | \`CREATE MATERIALIZED VIEW\`, manual \`REFRESH\` (\`CONCURRENTLY\` optional) |
        | Oracle | materialised views with query rewrite and incremental refresh |
        | SQL Server | indexed views, maintained automatically |
        | MySQL, SQLite | none — emulate with a table plus a scheduled \`INSERT ... SELECT\` |

        Read performance improves; freshness becomes your problem. The hand-rolled version is the CTAS
        snapshot from module 09, re-created on a schedule.

        ## Costs and traps
        - A view inside a view inside a view is a debugging nightmare and can defeat the optimiser.
        - Predicates usually push down into a simple view, but **not** through aggregates or
          \`DISTINCT\`: \`SELECT * FROM v_order_totals WHERE order_id = 1001\` may still aggregate
          everything first.
        - \`SELECT *\` in a view definition freezes the column list at creation time in some engines —
          name columns explicitly.

        ~~~sql
        SELECT name, sql FROM sqlite_master WHERE type = 'view';
        ~~~
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Create a view `v_customer_orders` returning `customer_id`, `company_name`, `orders` (count, 0 when none) and `last_order_date` for every customer. Then select from it the customers with no orders (`customer_id`, `company_name`), ordered by `company_name`.',
          starter: 'CREATE VIEW v_customer_orders AS\n\n;\n\nSELECT ',
          solution: 'CREATE VIEW v_customer_orders AS\nSELECT c.customer_id, c.company_name,\n       count(o.order_id) AS orders,\n       max(o.order_date) AS last_order_date\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.customer_id\nGROUP BY c.customer_id, c.company_name;\n\nSELECT customer_id, company_name FROM v_customer_orders WHERE orders = 0 ORDER BY company_name;',
          orderMatters: true,
          hints: ['The view is just a named `SELECT` — build it with a LEFT JOIN and GROUP BY.', 'Then query the view like a table.'],
          explain: 'The rule "a customer with zero orders" is now written once and reusable everywhere.'
        },
        {
          tag: 'DDL',
          prompt: 'Create a view `v_product_sales` with `product_id`, `product_name`, `units` (total quantity ordered, 0 if never ordered) and `revenue` (rounded to 2, 0 if never ordered). Then select the top 5 by revenue (`product_name`, `revenue`), highest first.',
          starter: '',
          solution: 'CREATE VIEW v_product_sales AS\nSELECT p.product_id, p.product_name,\n       COALESCE(sum(i.quantity), 0) AS units,\n       round(COALESCE(sum(i.unit_price * i.quantity * (1 - i.discount)), 0), 2) AS revenue\nFROM products p\nLEFT JOIN order_items i ON i.product_id = p.product_id\nGROUP BY p.product_id, p.product_name;\n\nSELECT product_name, revenue FROM v_product_sales ORDER BY revenue DESC LIMIT 5;',
          orderMatters: true,
          hints: ['`COALESCE(sum(...), 0)` turns the NULL of an unmatched LEFT JOIN into 0.'],
          explain: 'A reporting view: the join and the COALESCE logic are written once, and consumers just filter and sort.'
        }
      ],
      quiz: [
        {
          q: 'Does a (non-materialised) view make repeated queries faster?',
          options: ['Yes, it caches the result', 'No — it re-executes its query every time', 'Only with an index on the view'],
          answer: 1,
          explain: 'Views encapsulate; materialised views cache. Confusing the two is a common performance surprise.'
        }
      ]
    },

    {
      id: 'transactions',
      title: 'Transactions and ACID',
      lede: 'Making several statements one indivisible unit of work.',
      body: `
        ## The guarantee
        A transaction is a group of statements that either **all** take effect or **none** do.

        - **A**tomicity — all or nothing.
        - **C**onsistency — constraints hold before and after.
        - **I**solation — concurrent transactions do not see each other's half-finished work.
        - **D**urability — once committed, it survives a crash.

        ~~~sql
        CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance NUMERIC NOT NULL CHECK (balance >= 0));
        INSERT INTO accounts VALUES (1, 100), (2, 50);

        BEGIN;
        UPDATE accounts SET balance = balance - 30 WHERE id = 1;
        UPDATE accounts SET balance = balance + 30 WHERE id = 2;
        COMMIT;

        SELECT id, balance FROM accounts ORDER BY id;
        ~~~

        Without the transaction, a crash between the two updates destroys 30 units of money. This is the
        canonical example for a reason: any invariant that spans two statements needs a transaction.

        ## ROLLBACK
        ~~~sql
        CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance NUMERIC NOT NULL);
        INSERT INTO accounts VALUES (1, 100);

        BEGIN;
        UPDATE accounts SET balance = 0 WHERE id = 1;
        SELECT balance AS inside_transaction FROM accounts WHERE id = 1;
        ROLLBACK;

        SELECT balance AS after_rollback FROM accounts WHERE id = 1;
        ~~~

        Rollback is also your safety net for interactive work: \`BEGIN\`, run the dangerous \`UPDATE\`,
        inspect, then decide.

        ## Autocommit
        Outside an explicit transaction every statement is its own transaction and commits immediately.
        That is why a mistyped \`UPDATE\` is instantly permanent — and why bulk loads are slow if each row
        is its own commit (every commit has to reach durable storage).

        ~~~sql-static
        BEGIN;
        -- 10 000 INSERTs here: one commit instead of 10 000
        COMMIT;
        ~~~

        ## SAVEPOINT: nested checkpoints
        ~~~sql
        CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT);

        BEGIN;
        INSERT INTO audit (note) VALUES ('step 1');
        SAVEPOINT after_step1;
        INSERT INTO audit (note) VALUES ('step 2 - will be undone');
        ROLLBACK TO after_step1;
        INSERT INTO audit (note) VALUES ('step 3');
        COMMIT;

        SELECT id, note FROM audit ORDER BY id;
        ~~~

        \`ROLLBACK TO savepoint\` undoes part of a transaction without abandoning all of it;
        \`RELEASE savepoint\` discards the marker. This is how frameworks implement nested transactions.

        ## What to put in one transaction
        - Everything that must be consistent together (the transfer above).
        - Not the whole batch job: a transaction holds locks and log space for its entire life. Long
          transactions are the most common cause of production database stalls.
        - Never user "think time". Do not \`BEGIN\`, show a form, and wait for a human.

        :::dialect Syntax
        \`BEGIN\` / \`START TRANSACTION\` (MySQL, PostgreSQL), \`BEGIN TRANSACTION\` (SQL Server),
        implicit in Oracle (the first DML starts one). Error handling differs sharply: PostgreSQL aborts
        the whole transaction on any error, MySQL and SQLite leave it usable, SQL Server depends on
        \`XACT_ABORT\`. Know your engine's behaviour before relying on "continue after error".
        :::
      `,
      exercises: [
        {
          tag: 'DML',
          prompt: 'Create `accounts` (`id` INTEGER primary key, `balance` NUMERIC not null) with rows `(1, 100)` and `(2, 50)`. Then, **inside a single transaction**, move 30 from account 1 to account 2 and commit.',
          starter: 'CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance NUMERIC NOT NULL);\nINSERT INTO accounts VALUES (1, 100), (2, 50);\n\nBEGIN;\n\nCOMMIT;',
          solution: 'CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance NUMERIC NOT NULL);\nINSERT INTO accounts VALUES (1, 100), (2, 50);\n\nBEGIN;\nUPDATE accounts SET balance = balance - 30 WHERE id = 1;\nUPDATE accounts SET balance = balance + 30 WHERE id = 2;\nCOMMIT;',
          check: 'SELECT id, balance FROM accounts ORDER BY id;',
          requireSql: [{ pattern: 'begin', msg: 'Wrap the two updates in `BEGIN; ... COMMIT;`.' }],
          hints: ['Two UPDATEs between BEGIN and COMMIT.'],
          explain: 'Both updates or neither — the invariant "money is conserved" never has a window in which it is false.'
        },
        {
          tag: 'DML',
          prompt: 'Using `SAVEPOINT`, build this exact history in a table `audit` (`id` INTEGER primary key, `note` TEXT): insert `\'step 1\'`, set a savepoint, insert `\'step 2\'`, roll back to the savepoint, insert `\'step 3\'`, then commit. Only steps 1 and 3 may survive.',
          starter: 'CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT);\n\nBEGIN;\n',
          solution: "CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT);\n\nBEGIN;\nINSERT INTO audit (note) VALUES ('step 1');\nSAVEPOINT sp1;\nINSERT INTO audit (note) VALUES ('step 2');\nROLLBACK TO sp1;\nINSERT INTO audit (note) VALUES ('step 3');\nCOMMIT;",
          check: 'SELECT note FROM audit ORDER BY id;',
          requireSql: [{ pattern: 'savepoint', msg: 'Use `SAVEPOINT` and `ROLLBACK TO`.' }],
          hints: ['`SAVEPOINT name;` then `ROLLBACK TO name;`.', 'The id sequence will have a gap — the rolled-back insert consumed a rowid.'],
          explain: 'A savepoint rolls back part of a transaction while the rest of it continues.'
        }
      ],
      quiz: [
        {
          q: 'Which ACID property means a committed transaction survives a power cut?',
          options: ['Atomicity', 'Isolation', 'Durability'],
          answer: 2,
          explain: 'Durability is why COMMIT has to wait for storage — and why one commit per row is slow.'
        }
      ]
    },

    {
      id: 'isolation',
      title: 'Isolation levels and concurrency anomalies',
      lede: 'What other sessions can see while you are mid-transaction, and the four classic ways it goes wrong.',
      body: `
        ## The anomalies
        | Anomaly | What happens |
        | --- | --- |
        | **Dirty read** | you read another transaction's uncommitted change |
        | **Non-repeatable read** | you read a row twice and get different values |
        | **Phantom read** | you re-run a query and new rows have appeared |
        | **Lost update** | two sessions read-modify-write, one change vanishes |
        | **Write skew** | each transaction's write is fine alone, together they break an invariant |

        ## The standard levels
        | Level | Prevents |
        | --- | --- |
        | \`READ UNCOMMITTED\` | nothing |
        | \`READ COMMITTED\` | dirty reads |
        | \`REPEATABLE READ\` | + non-repeatable reads |
        | \`SERIALIZABLE\` | + phantoms; the result is as if transactions ran one after another |

        Defaults vary and matter: **PostgreSQL** and **SQL Server** default to \`READ COMMITTED\`,
        **MySQL/InnoDB** to \`REPEATABLE READ\`, **Oracle** to \`READ COMMITTED\` (with snapshot reads),
        **SQLite** behaves like \`SERIALIZABLE\` because it allows one writer at a time.

        ~~~sql-static
        SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;      -- standard / PostgreSQL / SQL Server
        SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;   -- MySQL
        ~~~

        ## MVCC
        Most engines implement isolation with **multi-version concurrency control**: writers create new
        row versions instead of overwriting, so readers see a consistent snapshot and never block on
        writers. Consequences worth knowing:

        - "Readers don't block writers, writers don't block readers" — but two writers touching the same
          row still conflict.
        - Old versions must be cleaned up (PostgreSQL \`VACUUM\`, MySQL purge, Oracle undo). A long-running
          transaction prevents cleanup and bloats storage.
        - Under \`SERIALIZABLE\`, PostgreSQL may abort your transaction with a serialisation failure —
          your application **must** be able to retry.

        ## The lost update, and how to prevent it
        Two sessions both run "read balance 100, write 100 − 30". Without protection, one subtraction is
        lost. Three fixes:

        1. **Do the arithmetic in SQL**, not in the application:
           \`UPDATE accounts SET balance = balance - 30 WHERE id = 1;\` — atomic by itself.
        2. **Pessimistic locking**: \`SELECT ... FOR UPDATE\` locks the row for the rest of the
           transaction (next lesson).
        3. **Optimistic locking**: carry a version column and make the update conditional —

        ~~~sql
        CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT, version INTEGER NOT NULL);
        INSERT INTO docs VALUES (1, 'draft', 1);

        -- session A read version 1 and writes:
        UPDATE docs SET body = 'edited by A', version = 2 WHERE id = 1 AND version = 1;
        SELECT changes() AS a_updated_rows;

        -- session B also read version 1 and tries the same: it changes nothing
        UPDATE docs SET body = 'edited by B', version = 2 WHERE id = 1 AND version = 1;
        SELECT changes() AS b_updated_rows, body, version FROM docs WHERE id = 1;
        ~~~

        \`changes() = 0\` tells session B it lost the race, so it can re-read and retry instead of
        silently discarding A's edit. This pattern needs no database-specific locking and works over
        stateless HTTP.

        ## Practical advice
        - Keep transactions short; never span a user interaction.
        - Touch rows in a consistent order across your code base (it prevents deadlocks).
        - Decide explicitly between "last writer wins" and "detect the conflict" — the default is usually
          the former, which is rarely what the business wants for anything important.
      `,
      exercises: [
        {
          tag: 'DML',
          prompt: 'Demonstrate optimistic locking. Create `docs` (`id` INTEGER primary key, `body` TEXT, `version` INTEGER not null) with row `(1, \'draft\', 1)`. Apply writer A’s conditional update (`version = 1` → body `\'edited by A\'`, version 2), then writer B’s identical conditional update with body `\'edited by B\'`. Return `body`, `version` and `changes()` as `b_updated_rows` at the end.',
          starter: "CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT, version INTEGER NOT NULL);\nINSERT INTO docs VALUES (1, 'draft', 1);\n\n",
          solution: "CREATE TABLE docs (id INTEGER PRIMARY KEY, body TEXT, version INTEGER NOT NULL);\nINSERT INTO docs VALUES (1, 'draft', 1);\n\nUPDATE docs SET body = 'edited by A', version = 2 WHERE id = 1 AND version = 1;\nUPDATE docs SET body = 'edited by B', version = 2 WHERE id = 1 AND version = 1;\nSELECT body, version, changes() AS b_updated_rows FROM docs WHERE id = 1;",
          hints: ['Both updates carry `AND version = 1`.', 'B’s update matches no row, so `changes()` is 0.'],
          explain: 'A’s edit survives and B is told it lost — no lock, no lost update.'
        },
        {
          tag: 'DML',
          prompt: 'Show the atomic-arithmetic fix for lost updates: create `counters` (`name` TEXT primary key, `n` INTEGER not null) with `(\'hits\', 0)`, then increment it three times with statements that compute the new value **in SQL** (`n = n + 1`). Return `name`, `n`.',
          starter: '',
          solution: "CREATE TABLE counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL);\nINSERT INTO counters VALUES ('hits', 0);\nUPDATE counters SET n = n + 1 WHERE name = 'hits';\nUPDATE counters SET n = n + 1 WHERE name = 'hits';\nUPDATE counters SET n = n + 1 WHERE name = 'hits';\nSELECT name, n FROM counters;",
          requireSql: [{ pattern: 'n\\s*=\\s*n\\s*\\+', msg: 'Compute the new value from the stored one (`n = n + 1`), not from a value you read earlier.' }],
          hints: ['`SET n = n + 1` reads and writes in one atomic statement.'],
          explain: 'Read-modify-write in the application is racy; the same arithmetic inside an UPDATE is not.'
        }
      ],
      quiz: [
        {
          q: 'Two sessions read a counter as 5 and both write 6. This is:',
          options: ['A dirty read', 'A lost update', 'A phantom read'],
          answer: 1,
          explain: 'One increment disappears. Fix it with atomic SQL arithmetic, row locking, or a version check.'
        },
        {
          q: 'MySQL/InnoDB’s default isolation level is:',
          options: ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'],
          answer: 1,
          explain: 'PostgreSQL, SQL Server and Oracle default to READ COMMITTED; portable code should not assume either.'
        }
      ]
    },

    {
      id: 'locking',
      title: 'Locking and deadlocks',
      lede: 'What blocks what, why two sessions can freeze each other, and how to avoid it.',
      body: `
        ## Lock basics
        - **Shared** (read) locks coexist; **exclusive** (write) locks do not.
        - Granularity ranges from row to page to table. Row-level locking is the norm in PostgreSQL,
          MySQL/InnoDB, Oracle and SQL Server; **SQLite locks the whole database file for writing**.
        - In MVCC engines, plain \`SELECT\` takes no row locks at all.

        ## Explicit row locks
        ~~~sql-static
        BEGIN;
        SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;   -- lock this row
        UPDATE accounts SET balance = balance - 30 WHERE id = 1;
        COMMIT;
        ~~~

        \`FOR UPDATE\` (PostgreSQL, MySQL, Oracle; \`WITH (UPDLOCK)\` in SQL Server) is pessimistic
        locking: anyone else wanting the row waits. Variants:
        \`FOR SHARE\` (read lock), \`SKIP LOCKED\` (ignore locked rows — the standard way to build a
        work queue), \`NOWAIT\` (fail instead of waiting).

        ~~~sql-static
        -- a job queue that several workers can drain safely
        BEGIN;
        SELECT job_id FROM jobs WHERE status = 'queued'
        ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
        -- ... mark it running, COMMIT
        ~~~

        ## Deadlocks
        Session A locks row 1 then wants row 2; session B locks row 2 then wants row 1. Neither can
        proceed. Engines detect the cycle and **abort one transaction** with a deadlock error.

        Prevention:

        1. **Access rows in a consistent order** everywhere (e.g. always ascending by primary key).
        2. Keep transactions short, and do slow work (HTTP calls, file I/O) outside them.
        3. Take the strongest lock you will need **up front** rather than upgrading a shared lock later.
        4. Touch fewer rows: a statement that updates 100 000 rows may escalate to a table lock.
        5. **Expect deadlocks and retry.** A deadlock is a normal, recoverable outcome, not a bug —
           the retry loop belongs in your application.

        ## Diagnosing blocking
        | Engine | Where to look |
        | --- | --- |
        | PostgreSQL | \`pg_locks\`, \`pg_stat_activity\` (\`wait_event_type = 'Lock'\`) |
        | MySQL | \`performance_schema.data_locks\`, \`SHOW ENGINE INNODB STATUS\` |
        | SQL Server | \`sys.dm_tran_locks\`, \`sys.dm_exec_requests.blocking_session_id\` |
        | Oracle | \`v$lock\`, \`v$session.blocking_session\` |

        ## SQLite specifics
        One writer at a time, and by default a second writer gets \`SQLITE_BUSY\` immediately.
        Two settings make it behave well for small applications:

        ~~~sql
        PRAGMA journal_mode = WAL;    -- readers no longer block the writer
        PRAGMA busy_timeout = 5000;   -- wait up to 5s for the write lock instead of failing
        SELECT * FROM pragma_journal_mode;
        ~~~

        :::warn Long-running transactions
        One forgotten open transaction can block writers, prevent vacuum, and grow the log until the disk
        fills. Monitor for transactions older than a few minutes — it is one of the highest-value
        database alerts you can set up.
        :::
      `,
      quiz: [
        {
          q: 'The most effective way to prevent deadlocks in application code:',
          options: ['Use SERIALIZABLE isolation', 'Always lock rows in the same order', 'Avoid transactions'],
          answer: 1,
          explain: 'Deadlocks need a cycle in the wait graph; a consistent global ordering makes a cycle impossible.'
        },
        {
          q: 'A deadlock error in production means:',
          options: ['A bug that must be fixed before the app can work', 'A normal, recoverable event your code should retry', 'Database corruption'],
          answer: 1,
          explain: 'The engine resolved it by aborting one transaction. Retrying is the expected response.'
        },
        {
          q: 'FOR UPDATE SKIP LOCKED is typically used to:',
          options: ['Speed up reporting queries', 'Let multiple workers pull distinct rows from a queue', 'Avoid writing a WHERE clause'],
          answer: 1,
          explain: 'Each worker takes the first unlocked row, so they never collide and never queue behind each other.'
        }
      ]
    },

    {
      id: 'triggers',
      title: 'Triggers',
      lede: 'Code the database runs for you on every write — powerful, and easy to regret.',
      body: `
        ## Shape
        ~~~sql-static
        CREATE TRIGGER name
        {BEFORE | AFTER | INSTEAD OF} {INSERT | UPDATE [OF cols] | DELETE} ON table
        [FOR EACH ROW] [WHEN condition]
        BEGIN
          ...statements...
        END;
        ~~~

        Inside the body, \`NEW.col\` is the incoming row and \`OLD.col\` the previous one
        (\`NEW\` only for insert, \`OLD\` only for delete, both for update).

        ## Audit trail
        The most defensible use of a trigger: recording history that no application can bypass.

        ~~~sql
        CREATE TABLE salary_audit (
          audit_id   INTEGER PRIMARY KEY,
          emp_id     INTEGER NOT NULL,
          old_salary NUMERIC,
          new_salary NUMERIC,
          changed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TRIGGER trg_salary_audit
        AFTER UPDATE OF salary ON employees
        FOR EACH ROW
        WHEN NEW.salary <> OLD.salary
        BEGIN
          INSERT INTO salary_audit (emp_id, old_salary, new_salary)
          VALUES (OLD.emp_id, OLD.salary, NEW.salary);
        END;

        UPDATE employees SET salary = salary * 1.10 WHERE dept_id = 4;
        SELECT emp_id, old_salary, round(new_salary, 2) AS new_salary FROM salary_audit ORDER BY emp_id;
        ~~~

        ## Maintaining a derived value
        ~~~sql
        CREATE TABLE order_counts (customer_id INTEGER PRIMARY KEY, orders INTEGER NOT NULL DEFAULT 0);
        INSERT INTO order_counts (customer_id, orders)
        SELECT customer_id, count(*) FROM orders GROUP BY customer_id;

        CREATE TRIGGER trg_order_insert AFTER INSERT ON orders
        BEGIN
          INSERT INTO order_counts (customer_id, orders) VALUES (NEW.customer_id, 1)
          ON CONFLICT (customer_id) DO UPDATE SET orders = orders + 1;
        END;

        INSERT INTO orders (order_id, customer_id, emp_id, order_date, status, freight)
        VALUES (99999, 1, 10, '2025-10-30', 'pending', 10.0);

        SELECT customer_id, orders FROM order_counts WHERE customer_id = 1;
        ~~~

        A generated column or a view is almost always a better answer than a trigger-maintained
        counter — fewer moving parts, no drift. Reach for the trigger only when the value must be
        indexed and cannot be computed from the same row.

        ## Validation a CHECK cannot express
        \`CHECK\` sees only one row. A \`BEFORE\` trigger can look at other tables or other rows, and
        \`RAISE(ABORT, ...)\` rejects the write:

        ~~~sql
        CREATE TRIGGER trg_no_items_for_cancelled
        BEFORE INSERT ON order_items
        FOR EACH ROW
        WHEN (SELECT status FROM orders WHERE order_id = NEW.order_id) = 'cancelled'
        BEGIN
          SELECT RAISE(ABORT, 'cannot add items to a cancelled order');
        END;

        -- an insert on a live order is unaffected
        INSERT INTO order_items (order_id, product_id, unit_price, quantity, discount)
        SELECT order_id, 21, 19.0, 1, 0 FROM orders WHERE status = 'pending' LIMIT 1;
        SELECT changes() AS inserted_on_live_order;
        ~~~

        Trying the same against a cancelled order raises the error instead:

        ~~~sql-static
        INSERT INTO order_items (order_id, product_id, unit_price, quantity, discount)
        SELECT order_id, 21, 19.0, 1, 0 FROM orders WHERE status = 'cancelled' LIMIT 1;
        -- Error: cannot add items to a cancelled order
        ~~~

        Note that \`RAISE(ABORT)\` is **not** suppressed by \`INSERT OR IGNORE\` — that only swallows
        constraint violations. Use \`RAISE(IGNORE)\` if you want the row silently skipped instead.

        ## INSTEAD OF: writable views
        SQLite views are read-only, but an \`INSTEAD OF\` trigger can translate a write on the view into
        writes on the base tables. PostgreSQL and SQL Server have the same mechanism.

        ## Why triggers get a bad reputation
        - **Invisible.** A statement does more than it says; debugging means reading the schema.
        - **Order-dependent.** Multiple triggers on one table fire in an engine-defined order.
        - **Cascading.** Triggers firing triggers are hard to reason about and easy to make recursive.
        - **Performance.** Per-row work on a bulk load can dominate the cost.
        - **Not portable.** Trigger syntax differs more than almost anything else in SQL.

        Good uses: audit logging, enforcing an invariant that constraints cannot express, legacy
        integration. Everything else belongs in the application or in a view.
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Create `salary_audit` (`audit_id` INTEGER primary key, `emp_id` INTEGER not null, `old_salary` NUMERIC, `new_salary` NUMERIC) and an `AFTER UPDATE OF salary ON employees` trigger named `trg_salary_audit` that records a row whenever the salary actually changes. Then give department 4 a 10% raise.',
          starter: '',
          solution: 'CREATE TABLE salary_audit (\n  audit_id   INTEGER PRIMARY KEY,\n  emp_id     INTEGER NOT NULL,\n  old_salary NUMERIC,\n  new_salary NUMERIC\n);\n\nCREATE TRIGGER trg_salary_audit\nAFTER UPDATE OF salary ON employees\nFOR EACH ROW\nWHEN NEW.salary <> OLD.salary\nBEGIN\n  INSERT INTO salary_audit (emp_id, old_salary, new_salary)\n  VALUES (OLD.emp_id, OLD.salary, NEW.salary);\nEND;\n\nUPDATE employees SET salary = salary * 1.10 WHERE dept_id = 4;',
          check: 'SELECT emp_id, old_salary, round(new_salary, 2) AS new_salary FROM salary_audit ORDER BY emp_id;',
          requireSql: [{ pattern: 'create\\s+trigger', msg: 'The history must be written by a trigger, not by a second INSERT statement.' }],
          hints: ['`AFTER UPDATE OF salary ON employees FOR EACH ROW`.', 'Use `OLD.salary` and `NEW.salary` inside the body.', 'End the trigger body with `END;`.'],
          explain: 'Three audit rows appeared without the UPDATE mentioning them — history that no writer can skip.'
        }
      ],
      quiz: [
        {
          q: 'Inside an UPDATE trigger, OLD and NEW refer to:',
          options: ['The old and new table', 'The row before and after the change', 'The transaction before and after commit'],
          answer: 1,
          explain: 'Row triggers fire per row, with both versions available.'
        }
      ]
    },

    {
      id: 'routines',
      title: 'Stored procedures and functions',
      lede: 'Code that lives in the database: what it is good for, what it costs, and the dialect map.',
      body: `
        ## The two kinds
        - A **function** returns a value and is called inside a query (\`SELECT my_fn(x) FROM t\`).
          It should be deterministic and side-effect free.
        - A **procedure** is invoked as a statement (\`CALL do_thing(...)\`), may run many statements,
          may manage transactions, and may return result sets.

        SQLite has **neither** — it is an embedded library, so "the application" is right there. That is
        why this lesson has no runnable exercise.

        ## What they look like
        PostgreSQL (PL/pgSQL):

        ~~~sql-static
        CREATE OR REPLACE FUNCTION order_total(p_order_id int) RETURNS numeric
        LANGUAGE sql STABLE AS $$
          SELECT COALESCE(sum(unit_price * quantity * (1 - discount)), 0)
          FROM order_items WHERE order_id = p_order_id;
        $$;

        SELECT order_id, order_total(order_id) FROM orders LIMIT 5;
        ~~~

        MySQL:

        ~~~sql-static
        CREATE PROCEDURE archive_old_orders(IN cutoff DATE)
        BEGIN
          START TRANSACTION;
          INSERT INTO orders_archive SELECT * FROM orders WHERE order_date < cutoff;
          DELETE FROM orders WHERE order_date < cutoff;
          COMMIT;
        END;
        ~~~

        SQL Server (T-SQL):

        ~~~sql-static
        CREATE PROCEDURE dbo.ArchiveOldOrders @Cutoff date AS
        BEGIN
          SET NOCOUNT ON;
          BEGIN TRY
            BEGIN TRAN;
            INSERT INTO dbo.OrdersArchive SELECT * FROM dbo.Orders WHERE OrderDate < @Cutoff;
            DELETE FROM dbo.Orders WHERE OrderDate < @Cutoff;
            COMMIT;
          END TRY
          BEGIN CATCH
            ROLLBACK; THROW;
          END CATCH
        END;
        ~~~

        Oracle uses PL/SQL packages; all of them have variables, \`IF\`/\`LOOP\`, cursors, exception
        handling and output parameters.

        ## When a routine is the right answer
        - **Chatty logic over large data.** One \`CALL\` instead of thousands of round trips.
        - **A rule that must hold for every client**, including ad-hoc SQL and other teams' services.
        - **Privilege isolation.** Grant \`EXECUTE\` on a procedure instead of write access to tables.
        - **Set-based batch work** that is already expressed in SQL.

        ## When it is the wrong answer
        - Business logic that belongs in an application you can test, review and deploy normally.
        - Anything needing HTTP calls, file access or libraries.
        - Row-by-row cursor loops that re-implement what a single statement would do — the most common
          performance anti-pattern in legacy databases.
        - Teams without database migrations: routines then live only in production.

        ## User-defined functions and performance
        A scalar UDF called per row can be very expensive, and may make the planner blind: PostgreSQL
        uses \`IMMUTABLE\`/\`STABLE\`/\`VOLATILE\` markers to decide what it can cache or inline; SQL Server
        inlines some T-SQL scalar UDFs only from 2019 onwards. A set-returning or inline table-valued
        function usually optimises far better than a scalar one.

        :::tip The portable middle ground
        Views for read logic, constraints and triggers for invariants, and application code for
        workflows. Reach for stored routines when round-trip cost or privilege isolation genuinely
        demands it — then keep them in version control like any other code.
        :::
      `,
      quiz: [
        {
          q: 'Why does SQLite have no stored procedures?',
          options: ['It is too old', 'It is an embedded library — the application process is already "inside" the database', 'They were removed for security'],
          answer: 1,
          explain: 'There is no client/server round trip to save, so host-language code plays the role procedures play elsewhere.'
        },
        {
          q: 'A cursor loop that updates one row at a time is usually:',
          options: ['The fastest option', 'Much slower than a single set-based statement', 'Required for correctness'],
          answer: 1,
          explain: 'SQL engines are optimised for set operations; per-row loops give up that advantage.'
        }
      ]
    },

    {
      id: 'security',
      title: 'Privileges, roles and SQL injection',
      lede: 'Who may do what — and the one habit that eliminates the most exploited vulnerability in web history.',
      body: `
        ## GRANT and REVOKE
        ~~~sql-static
        CREATE ROLE reporting;
        GRANT SELECT ON orders, order_items, customers TO reporting;
        GRANT SELECT, INSERT, UPDATE ON orders TO app_writer;
        REVOKE DELETE ON orders FROM app_writer;

        CREATE USER analyst WITH PASSWORD '...';
        GRANT reporting TO analyst;          -- roles group privileges
        ~~~

        Principles that survive every engine:

        - **Least privilege.** The application user needs \`SELECT\`/\`INSERT\`/\`UPDATE\` on its own
          tables — not \`DROP\`, not \`GRANT\`, not superuser.
        - **Separate accounts** for migrations (DDL) and for serving traffic (DML).
        - **Grant to roles, not people**; put people in roles.
        - **Read-only accounts** for analytics and BI tools.
        - Views and column grants for partial access: expose \`v_employee_public\`, not \`employees\`.

        Row-level security (PostgreSQL \`CREATE POLICY\`, SQL Server RLS, Oracle VPD) filters rows per
        user inside the database — valuable for multi-tenant schemas, where a forgotten
        \`WHERE tenant_id = ?\` is otherwise a data breach.

        SQLite has no users or privileges at all: access control is file permissions, and whoever opens
        the file can do anything.

        ## SQL injection
        The vulnerability: building SQL by concatenating untrusted text.

        ~~~sql-static
        -- application code, do NOT do this
        query = "SELECT * FROM users WHERE email = '" + input + "'";
        ~~~

        With \`input = "x' OR '1'='1"\` the predicate is always true. With
        \`input = "x'; DROP TABLE users; --"\` it is worse. Variants include injecting into
        \`ORDER BY\`, \`LIMIT\`, or a \`LIKE\` pattern, and blind injection that reads data one boolean at
        a time.

        ## The fix: parameters
        Send SQL and data separately. The driver never interpolates the value into the statement text, so
        there is nothing to escape and nothing to inject:

        ~~~sql-static
        -- SQL stays constant; values are bound
        SELECT * FROM users WHERE email = ?;        -- SQLite, MySQL, JDBC
        SELECT * FROM users WHERE email = $1;       -- PostgreSQL
        SELECT * FROM users WHERE email = :email;   -- Oracle, named parameters
        ~~~

        This is also faster: the engine can reuse the parsed plan across calls.

        Supporting habits:

        - Use the driver's parameter API, or an ORM/query builder that parameterises by default.
          Never \`str.format\`, f-strings or \`+\` with user data.
        - **Identifiers cannot be parameterised.** For dynamic column or table names, validate against
          an allow-list you control, never pass user text through.
        - Escaping functions are a last resort, not a strategy.
        - Keep error messages generic in production; verbose SQL errors are a reconnaissance tool.
        - Least privilege limits the blast radius: an injected \`DROP TABLE\` fails if the account cannot
          drop tables.

        ## Other data-protection concerns
        - **Encryption**: TLS in transit, at-rest encryption (TDE), and application-level encryption for
          the few columns that need it. Store password *hashes* (bcrypt/argon2), never passwords.
        - **Auditing**: who read what, retained outside the database.
        - **Minimisation and masking**: do not copy production personal data into test environments;
          use dynamic data masking or anonymised extracts.
        - **Backups are sensitive too** — encrypt them, and test the restore.

        :::warn The one rule
        If untrusted input ever becomes part of your SQL **text**, you have an injection bug. If it only
        ever arrives as a bound **parameter**, you cannot have one.
        :::
      `,
      quiz: [
        {
          q: 'What makes parameterised queries safe?',
          options: ['They escape dangerous characters', 'The value never becomes part of the SQL statement text', 'They run with fewer privileges'],
          answer: 1,
          explain: 'Separating code from data removes the parsing step an attacker needs to influence.'
        },
        {
          q: 'A user-supplied sort column must be handled by:',
          options: ['A bound parameter', 'Validating against an allow-list of permitted column names', 'Escaping quotes'],
          answer: 1,
          explain: 'Identifiers cannot be bound as parameters, so the only safe approach is a fixed set of allowed values.'
        },
        {
          q: 'The application’s database account should typically be able to:',
          options: ['Do anything, for convenience', 'Read and write its own tables only', 'Only read'],
          answer: 1,
          explain: 'Least privilege: no DDL, no GRANT, no access to other schemas. Migrations use a separate account.'
        }
      ]
    }
  ]
});
