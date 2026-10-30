(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'ddl',
  title: 'Defining data (DDL)',
  blurb: 'CREATE TABLE, keys, constraints, foreign keys, ALTER, temp tables and generated columns.',
  lessons: [

    {
      id: 'create-table',
      title: 'CREATE TABLE',
      lede: 'Declaring the shape of your data — and why every constraint you write is a bug you will never have to debug.',
      body: `
        ## The anatomy
        ~~~sql-static
        CREATE TABLE warehouses (
          warehouse_id INTEGER PRIMARY KEY,                -- column constraint
          code         TEXT    NOT NULL UNIQUE,
          city         TEXT    NOT NULL,
          capacity     INTEGER NOT NULL DEFAULT 0,
          opened_on    TEXT,
          CHECK (capacity >= 0)                            -- table constraint
        );
        ~~~

        Constraints are not decoration. The database is the **last line of defence**: application code,
        imports, migrations and hand-written fixes all write to the same tables, and only the schema is
        enforced for all of them. A \`NOT NULL\` is cheaper than every future query having to cope with
        unexpected NULLs.

        ## Column constraints
        | Constraint | Meaning |
        | --- | --- |
        | \`NOT NULL\` | a value is required |
        | \`DEFAULT expr\` | value used when the column is omitted on insert |
        | \`PRIMARY KEY\` | unique + not null, the row's identity |
        | \`UNIQUE\` | no two rows share this value |
        | \`CHECK (expr)\` | row is rejected unless the expression is true |
        | \`REFERENCES t(c)\` | foreign key |
        | \`COLLATE\` | comparison rules for text |
        | \`GENERATED ALWAYS AS\` | computed from other columns |

        Give table-level constraints names in production (\`CONSTRAINT chk_capacity CHECK (...)\`):
        error messages and migrations become far easier to work with.

        ## DEFAULT
        ~~~sql
        CREATE TABLE demo_defaults (
          id         INTEGER PRIMARY KEY,
          label      TEXT    NOT NULL DEFAULT 'unnamed',
          created_at TEXT    NOT NULL DEFAULT (datetime('now')),
          active     INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO demo_defaults (id) VALUES (1), (2);
        SELECT * FROM demo_defaults;
        ~~~

        A \`DEFAULT\` applies when the column is **omitted**, not when you explicitly pass \`NULL\`.
        Expressions as defaults need parentheses in SQLite; \`CURRENT_TIMESTAMP\` is the portable
        spelling for "now".

        ## IF NOT EXISTS, and creating from a query
        ~~~sql
        CREATE TABLE IF NOT EXISTS audit_log (
          id      INTEGER PRIMARY KEY,
          message TEXT NOT NULL
        );
        SELECT name FROM sqlite_master WHERE name = 'audit_log';
        ~~~

        ~~~sql
        -- CTAS: structure and data from a query (no constraints are copied)
        CREATE TABLE expensive_products AS
        SELECT product_id, product_name, unit_price FROM products WHERE unit_price > 300;
        SELECT count(*) AS rows_copied FROM expensive_products;
        ~~~

        ## Naming conventions
        Pick one and apply it everywhere: \`snake_case\`, plural table names, singular column names,
        \`<table>_id\` for keys, no reserved words, no spaces, no mixed case (quoting
        \`"MyTable"\` forever is a punishment you inflict on yourself). Suffix booleans with a verb
        (\`is_active\`), timestamps with \`_at\`, dates with \`_on\`.

        :::dialect Identity columns
        | Engine | Auto-numbering key |
        | --- | --- |
        | SQLite | \`INTEGER PRIMARY KEY\` (rowid alias), or \`AUTOINCREMENT\` |
        | PostgreSQL | \`GENERATED ALWAYS AS IDENTITY\` (or legacy \`serial\`) |
        | MySQL | \`AUTO_INCREMENT\` |
        | SQL Server | \`IDENTITY(1,1)\` or a sequence |
        | Oracle | \`GENERATED AS IDENTITY\` or a sequence + trigger |
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Create a table `warehouses` with exactly these columns, in this order:\n\n- `warehouse_id` INTEGER, primary key\n- `code` TEXT, not null\n- `city` TEXT, not null\n- `capacity` INTEGER, not null, default `0`\n\nThen insert one row: `(1, \'BER-1\', \'Berlin\', 500)`.',
          starter: 'CREATE TABLE warehouses (\n  \n);\n\nINSERT INTO warehouses ',
          solution: "CREATE TABLE warehouses (\n  warehouse_id INTEGER PRIMARY KEY,\n  code         TEXT    NOT NULL,\n  city         TEXT    NOT NULL,\n  capacity     INTEGER NOT NULL DEFAULT 0\n);\n\nINSERT INTO warehouses (warehouse_id, code, city, capacity) VALUES (1, 'BER-1', 'Berlin', 500);",
          check: "SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_info('warehouses') ORDER BY cid;",
          hints: ['Column name, then type, then constraints.', '`capacity INTEGER NOT NULL DEFAULT 0`.'],
          explain: 'The grader inspected your table definition with `pragma_table_info` — types, NOT NULL flags, default and primary key all match.'
        },
        {
          tag: 'DDL',
          prompt: 'Create a table `audit_log` with `id` INTEGER primary key, `message` TEXT not null, and `created_at` TEXT not null defaulting to the expression `datetime(\'now\')`. Insert one row supplying only `id` and `message` (`1`, `\'started\'`), then confirm the default filled in: the grader checks that `created_at` is not null.',
          starter: '',
          solution: "CREATE TABLE audit_log (\n  id         INTEGER PRIMARY KEY,\n  message    TEXT NOT NULL,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\nINSERT INTO audit_log (id, message) VALUES (1, 'started');",
          check: "SELECT id, message, created_at IS NOT NULL AS has_timestamp, length(created_at) AS stamp_length FROM audit_log ORDER BY id;",
          hints: ['An expression default needs parentheses: `DEFAULT (datetime(\'now\'))`.', 'Omit `created_at` from the INSERT so the default applies.'],
          explain: 'Expression defaults put the timestamp logic in the schema, where every writer gets it for free.'
        }
      ],
      quiz: [
        {
          q: 'Why declare constraints in the database rather than only in application code?',
          options: ['They make queries faster', 'Every writer — app, import, migration, manual fix — is subject to them', 'The standard requires it'],
          answer: 1,
          explain: 'Application checks protect one path; schema constraints protect the data itself.'
        }
      ]
    },

    {
      id: 'keys',
      title: 'Primary keys and identity',
      lede: 'Choosing what identifies a row: natural keys, surrogate keys, composite keys.',
      body: `
        ## PRIMARY KEY
        A primary key is \`UNIQUE\` + \`NOT NULL\`, and every table should have one. It gives each row a
        stable identity so other tables can reference it, and it is the key an index is automatically
        built on.

        ~~~sql
        CREATE TABLE regions (
          region_code TEXT PRIMARY KEY,          -- natural key
          region_name TEXT NOT NULL
        );
        INSERT INTO regions VALUES ('EU-W', 'Western Europe'), ('EU-N', 'Northern Europe');
        SELECT * FROM regions ORDER BY region_code;
        ~~~

        ## Natural vs surrogate
        | | Natural key (email, ISBN, country code) | Surrogate key (auto id, UUID) |
        | --- | --- | --- |
        | Meaning | carries information | meaningless by design |
        | Stability | can change (people change email) | never changes |
        | Width | often wide text | narrow integer |
        | Joins | readable without a join | needs a join to be readable |
        | Exposure | leaks data in URLs | safe (unless sequential ids leak volume) |

        Common practice: a surrogate \`INTEGER PRIMARY KEY\` for identity, **plus** a \`UNIQUE\`
        constraint on the natural key so the real-world rule is still enforced. You get stable references
        and honest data.

        ## Composite keys
        A junction table's identity is the pair of its parents — that *is* the business rule
        ("one line per product per order"):

        ~~~sql
        SELECT name, pk FROM pragma_table_info('order_items') ORDER BY cid;
        ~~~

        \`order_items\` has \`PRIMARY KEY (order_id, product_id)\`: the \`pk\` column shows 1 and 2,
        the positions within the key. A composite key also prevents the duplicate-line bug for free.

        ## Auto-numbering in SQLite
        \`INTEGER PRIMARY KEY\` is an alias for the internal \`rowid\`, so it auto-assigns:

        ~~~sql
        CREATE TABLE notes (note_id INTEGER PRIMARY KEY, body TEXT NOT NULL);
        INSERT INTO notes (body) VALUES ('first'), ('second');
        SELECT note_id, body FROM notes;
        ~~~

        Adding \`AUTOINCREMENT\` additionally guarantees ids are never reused after a delete — at the cost
        of an extra bookkeeping table. Default to leaving it off.

        ## UUIDs
        UUID keys avoid coordination between systems and do not leak counts, but they are 16 bytes
        (or 36 as text), random, and therefore bad for index locality on insert-heavy tables.
        Prefer time-ordered variants (UUIDv7, ULID) if you go this route.

        :::warn A table without a primary key
        …cannot be referenced, is hard to deduplicate, breaks most replication and ORM tooling, and makes
        \`UPDATE\`/\`DELETE\` of a single row impossible to write safely. Add one, even to log tables.
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Create a junction table `product_tags` recording which tags a product has, with a **composite primary key** of `product_id` and `tag` (in that order), a foreign-key reference from `product_id` to `products(product_id)`, and `tag` TEXT. Then insert `(1, \'mechanical\')` and `(1, \'rgb\')`.',
          starter: 'CREATE TABLE product_tags (\n  \n);\n\n',
          solution: "CREATE TABLE product_tags (\n  product_id INTEGER NOT NULL REFERENCES products(product_id),\n  tag        TEXT    NOT NULL,\n  PRIMARY KEY (product_id, tag)\n);\nINSERT INTO product_tags (product_id, tag) VALUES (1, 'mechanical'), (1, 'rgb');",
          check: "SELECT (SELECT group_concat(name || ':' || pk) FROM pragma_table_info('product_tags')) AS layout,\n       (SELECT count(*) FROM pragma_foreign_key_list('product_tags')) AS fks,\n       (SELECT count(*) FROM product_tags) AS rows_inserted;",
          hints: ['A multi-column key must be a table-level constraint: `PRIMARY KEY (product_id, tag)`.', 'The reference can be inline: `product_id INTEGER NOT NULL REFERENCES products(product_id)`.'],
          explain: 'The composite key encodes the rule "a product carries a tag at most once" in the schema itself.'
        },
        {
          tag: 'DDL',
          prompt: 'Create a table `couriers` with a surrogate key **and** a natural key: `courier_id` INTEGER primary key, `scac_code` TEXT not null and unique, `name` TEXT not null. Insert `(\'DHLX\', \'DHL Express\')` and `(\'UPSN\', \'UPS\')` without supplying ids.',
          starter: '',
          solution: "CREATE TABLE couriers (\n  courier_id INTEGER PRIMARY KEY,\n  scac_code  TEXT NOT NULL UNIQUE,\n  name       TEXT NOT NULL\n);\nINSERT INTO couriers (scac_code, name) VALUES ('DHLX', 'DHL Express'), ('UPSN', 'UPS');",
          check: "SELECT courier_id, scac_code, name FROM couriers ORDER BY courier_id;",
          hints: ['`INTEGER PRIMARY KEY` auto-assigns 1, 2, … when you omit it.', 'The natural key gets `UNIQUE`, not `PRIMARY KEY`.'],
          explain: 'Surrogate for identity, unique constraint for the business rule — the combination most schemas settle on.'
        }
      ]
    },

    {
      id: 'constraints',
      title: 'UNIQUE, CHECK and NOT NULL',
      lede: 'Making impossible data impossible.',
      body: `
        ## NOT NULL
        The cheapest constraint, and the one most often forgotten. Ask of every column: *can this
        legitimately be unknown?* If not, say so.

        ## UNIQUE
        One or more columns whose combination may not repeat. It creates an index, so it also speeds up
        lookups on that key.

        ~~~sql
        CREATE TABLE memberships (
          membership_id INTEGER PRIMARY KEY,
          customer_id   INTEGER NOT NULL,
          program       TEXT    NOT NULL,
          UNIQUE (customer_id, program)          -- one membership per program per customer
        );
        INSERT INTO memberships (customer_id, program) VALUES (1, 'gold');
        INSERT OR IGNORE INTO memberships (customer_id, program) VALUES (1, 'gold');  -- silently rejected
        SELECT count(*) AS rows_kept FROM memberships;
        ~~~

        **NULL and UNIQUE**: in standard SQL (and SQLite, PostgreSQL, Oracle, MySQL) multiple NULLs are
        allowed in a unique column, because NULLs are not equal to each other. SQL Server is the outlier —
        it permits only one. PostgreSQL 15+ can opt in with \`UNIQUE NULLS NOT DISTINCT\`.

        ## CHECK
        An arbitrary predicate per row. The row is rejected unless it evaluates to true (not false, and
        not unknown):

        ~~~sql
        CREATE TABLE shipments (
          shipment_id INTEGER PRIMARY KEY,
          weight_kg   NUMERIC NOT NULL CHECK (weight_kg > 0),
          mode        TEXT    NOT NULL CHECK (mode IN ('air', 'sea', 'road')),
          shipped_on  TEXT,
          arrived_on  TEXT,
          CHECK (arrived_on IS NULL OR arrived_on >= shipped_on)
        );
        INSERT INTO shipments (shipment_id, weight_kg, mode) VALUES (1, 12.5, 'air');
        INSERT OR IGNORE INTO shipments (shipment_id, weight_kg, mode) VALUES (2, -3, 'air');
        INSERT OR IGNORE INTO shipments (shipment_id, weight_kg, mode) VALUES (3, 1, 'rocket');
        SELECT shipment_id, weight_kg, mode FROM shipments;
        ~~~

        Only the first row survives. Note the multi-column \`CHECK\` comparing two dates: table-level
        checks can reference any column of the same row (but not other rows or other tables).

        An enumerated \`CHECK (col IN (...))\` is simple but needs a migration to extend. A lookup table
        with a foreign key is the alternative — extensible, joinable, and able to carry a label per value.

        ## Where constraints live in other engines
        - PostgreSQL has \`EXCLUDE\` constraints (e.g. no overlapping date ranges per room) and
          domains (reusable constrained types).
        - MySQL ignored \`CHECK\` entirely before 8.0.16 — old schemas often have decorative checks.
        - Deferred constraints (checked at \`COMMIT\` rather than per statement) exist in PostgreSQL and
          Oracle; useful for circular references.

        :::tip Constraints as documentation
        \`CHECK (status IN ('pending','shipped','delivered','cancelled'))\` tells the next developer the
        complete set of states — far more reliably than a comment or a wiki page.
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Create a table `promo_codes` with:\n\n- `code` TEXT primary key\n- `discount_pct` NUMERIC not null, constrained to be greater than 0 and at most 50\n- `valid_from` TEXT not null, `valid_to` TEXT not null, with a table-level check that `valid_to` is not before `valid_from`\n\nThen insert the valid row `(\'SPRING\', 10, \'2025-03-01\', \'2025-05-31\')`, and try to insert `(\'BAD\', 90, \'2025-01-01\', \'2025-01-31\')` and `(\'REVERSED\', 5, \'2025-06-01\', \'2025-05-01\')` with `INSERT OR IGNORE` — only the first should survive.',
          starter: 'CREATE TABLE promo_codes (\n  \n);\n\nINSERT INTO promo_codes VALUES (\'SPRING\', 10, \'2025-03-01\', \'2025-05-31\');\nINSERT OR IGNORE INTO promo_codes VALUES (\'BAD\', 90, \'2025-01-01\', \'2025-01-31\');\nINSERT OR IGNORE INTO promo_codes VALUES (\'REVERSED\', 5, \'2025-06-01\', \'2025-05-01\');',
          solution: "CREATE TABLE promo_codes (\n  code         TEXT    PRIMARY KEY,\n  discount_pct NUMERIC NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 50),\n  valid_from   TEXT    NOT NULL,\n  valid_to     TEXT    NOT NULL,\n  CHECK (valid_to >= valid_from)\n);\n\nINSERT INTO promo_codes VALUES ('SPRING', 10, '2025-03-01', '2025-05-31');\nINSERT OR IGNORE INTO promo_codes VALUES ('BAD', 90, '2025-01-01', '2025-01-31');\nINSERT OR IGNORE INTO promo_codes VALUES ('REVERSED', 5, '2025-06-01', '2025-05-01');",
          check: 'SELECT code, discount_pct FROM promo_codes ORDER BY code;',
          hints: ['Two checks: one on the column, one at table level across two columns.', '`INSERT OR IGNORE` turns a constraint violation into a skipped row, which is how the grader tests your checks.'],
          explain: 'Your constraints rejected both bad rows: the table contains only SPRING.'
        },
        {
          tag: 'DDL',
          prompt: 'Create `memberships` with `membership_id` INTEGER primary key, `customer_id` INTEGER not null, `program` TEXT not null, and a `UNIQUE` constraint on the pair (`customer_id`, `program`). Insert `(1, \'gold\')`, then attempt `(1, \'gold\')` again with `INSERT OR IGNORE`, then insert `(1, \'silver\')`.',
          starter: '',
          solution: "CREATE TABLE memberships (\n  membership_id INTEGER PRIMARY KEY,\n  customer_id   INTEGER NOT NULL,\n  program       TEXT    NOT NULL,\n  UNIQUE (customer_id, program)\n);\nINSERT INTO memberships (customer_id, program) VALUES (1, 'gold');\nINSERT OR IGNORE INTO memberships (customer_id, program) VALUES (1, 'gold');\nINSERT INTO memberships (customer_id, program) VALUES (1, 'silver');",
          check: 'SELECT customer_id, program FROM memberships ORDER BY program;',
          hints: ['A two-column UNIQUE must be a table-level constraint.'],
          explain: 'Two rows survive: the duplicate pair was rejected, the different program was not.'
        }
      ],
      quiz: [
        {
          q: 'A UNIQUE column in PostgreSQL/SQLite/MySQL allows how many NULLs?',
          options: ['One', 'Many, because NULLs are not equal to each other', 'None'],
          answer: 1,
          explain: 'SQL Server is the exception, allowing only a single NULL.'
        }
      ]
    },

    {
      id: 'foreign-keys',
      title: 'Foreign keys and referential actions',
      lede: 'Making relationships enforceable, and deciding what happens when a parent row disappears.',
      body: `
        ## Declaring a relationship
        ~~~sql-static
        CREATE TABLE order_items (
          order_id   INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(product_id),
          ...
        );
        ~~~

        A foreign key guarantees that every child value matches an existing parent key — no orphan rows,
        ever. It also documents the data model: the schema becomes a graph you can read.

        ~~~sql
        SELECT "table", "from", "to", on_delete, on_update
        FROM pragma_foreign_key_list('order_items');
        ~~~

        ## NULL in a foreign key
        A nullable FK column means "optionally related": \`employees.dept_id\` is NULL for staff without a
        department, and that is allowed. Make the column \`NOT NULL\` when the relationship is mandatory.

        ## Referential actions
        What happens to children when the parent is deleted or its key updated:

        | Action | Effect |
        | --- | --- |
        | \`NO ACTION\` / \`RESTRICT\` | reject the change (the default) |
        | \`CASCADE\` | delete/update the children too |
        | \`SET NULL\` | clear the child's reference |
        | \`SET DEFAULT\` | set the child's reference to its default |

        \`CASCADE\` is right for **owned** children (an order's lines have no independent existence) and
        dangerous for **shared** references — a cascading delete on \`products\` would quietly erase
        sales history. Default to the strict behaviour and opt into cascade deliberately.

        ~~~sql
        -- order_items declares ON DELETE CASCADE, so deleting an order removes its lines
        CREATE TEMP TABLE before_after AS
        SELECT (SELECT count(*) FROM order_items WHERE order_id = 1016) AS lines_before;
        DELETE FROM orders WHERE order_id = 1016;
        SELECT lines_before,
               (SELECT count(*) FROM order_items WHERE order_id = 1016) AS lines_after
        FROM before_after;
        ~~~

        Order 1016 was chosen because it has no payments. Try the same with order 1001 and the delete is
        **rejected**: \`payments.order_id\` references \`orders\` without a cascade, so the database refuses
        to orphan the payment rows. That refusal is the constraint doing its job.

        ## Enforcement must be switched on in SQLite
        SQLite only enforces foreign keys when the connection has \`PRAGMA foreign_keys = ON\` (this
        course sets it for you). Other engines always enforce them. Many SQLite databases in the wild
        therefore contain orphans — check with:

        ~~~sql
        PRAGMA foreign_key_check;
        ~~~

        ## Indexes on foreign keys
        The parent side is indexed automatically (it is a key); the **child** side is not, in most
        engines. Without an index on \`order_items(order_id)\`, every parent delete has to scan the child
        table, and joins from parent to child are slow. **Index your foreign key columns** — module 13.

        :::warn Circular references
        Two tables that each require the other cannot be populated with per-statement checking. Make one
        side nullable, or use deferred constraints (PostgreSQL, Oracle).
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Create a table `order_notes` for notes attached to an order:\n\n- `note_id` INTEGER primary key\n- `order_id` INTEGER not null, referencing `orders(order_id)` with `ON DELETE CASCADE`\n- `note` TEXT not null\n\nInsert `(1, 1016, \'Customer asked for split delivery\')`, then delete order 1016 from `orders` and let the cascade do its work. (Order 1016 has no payments, so nothing blocks the delete.)',
          starter: 'CREATE TABLE order_notes (\n  \n);\n\nINSERT INTO order_notes VALUES (1, 1016, \'Customer asked for split delivery\');\nDELETE FROM orders WHERE order_id = 1016;',
          solution: "CREATE TABLE order_notes (\n  note_id  INTEGER PRIMARY KEY,\n  order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,\n  note     TEXT    NOT NULL\n);\n\nINSERT INTO order_notes VALUES (1, 1016, 'Customer asked for split delivery');\nDELETE FROM orders WHERE order_id = 1016;",
          check: "SELECT (SELECT count(*) FROM order_notes) AS notes_left,\n       (SELECT count(*) FROM order_items WHERE order_id = 1016) AS items_left,\n       (SELECT on_delete FROM pragma_foreign_key_list('order_notes')) AS fk_action;",
          hints: ['`REFERENCES orders(order_id) ON DELETE CASCADE` goes on the child column.', 'After the delete, the note should be gone too.'],
          explain: 'The cascade removed the note along with the order — and `order_items` lost its lines for the same reason, because the seed schema declares the same action.'
        },
        {
          tag: 'DDL',
          prompt: 'Create `employee_badges` where deleting an employee should **not** delete the badge but clear its reference: `badge_id` INTEGER primary key, `emp_id` INTEGER referencing `employees(emp_id)` `ON DELETE SET NULL`, `serial` TEXT not null unique. Insert `(1, 22, \'SN-0001\')`, then delete employee 22.',
          starter: '',
          solution: "CREATE TABLE employee_badges (\n  badge_id INTEGER PRIMARY KEY,\n  emp_id   INTEGER REFERENCES employees(emp_id) ON DELETE SET NULL,\n  serial   TEXT NOT NULL UNIQUE\n);\nINSERT INTO employee_badges VALUES (1, 22, 'SN-0001');\nDELETE FROM employees WHERE emp_id = 22;",
          check: "SELECT badge_id, emp_id, serial FROM employee_badges ORDER BY badge_id;",
          hints: ['`ON DELETE SET NULL` requires the column to be nullable — so no `NOT NULL` on `emp_id`.', 'Employee 22 has no reports and no orders, so the delete succeeds.'],
          explain: 'The badge survived with a NULL `emp_id`: the physical object outlives the relationship.'
        }
      ],
      quiz: [
        {
          q: 'Which side of a foreign key is usually NOT indexed automatically?',
          options: ['The parent (referenced) side', 'The child (referencing) side', 'Both are always indexed'],
          answer: 1,
          explain: 'The parent is a key and therefore indexed. Add an index on the child column yourself, or parent deletes and reverse joins will scan.'
        }
      ]
    },

    {
      id: 'alter-and-temp',
      title: 'ALTER TABLE, DROP, CTAS and temp tables',
      lede: 'Changing a schema that already holds data, without losing any of it.',
      body: `
        ## ALTER TABLE
        ~~~sql
        ALTER TABLE products ADD COLUMN weight_g INTEGER;
        ALTER TABLE products RENAME COLUMN weight_g TO shipping_weight_g;
        SELECT name, type FROM pragma_table_info('products') ORDER BY cid;
        ~~~

        SQLite supports \`ADD COLUMN\`, \`RENAME COLUMN\`, \`RENAME TO\` and \`DROP COLUMN\` (3.35+) — and
        nothing else. Other engines can also change types, add constraints, and alter defaults.

        **Adding a \`NOT NULL\` column to a populated table** needs a default (or three steps: add
        nullable, backfill, then enforce) — there is no value for the existing rows otherwise.

        ## The portable migration dance
        When an engine cannot alter what you need, do it by hand — this is exactly what SQLite's own
        documentation recommends, and it works everywhere:

        ~~~sql
        PRAGMA foreign_keys = OFF;   -- children point at the old table while we swap it
        CREATE TABLE suppliers_new (
          supplier_id   INTEGER PRIMARY KEY,
          supplier_name TEXT    NOT NULL,
          country       TEXT    NOT NULL,
          rating        INTEGER NOT NULL DEFAULT 3 CHECK (rating BETWEEN 1 AND 5)
        );
        INSERT INTO suppliers_new (supplier_id, supplier_name, country, rating)
        SELECT supplier_id, supplier_name, country, COALESCE(rating, 3) FROM suppliers;
        DROP TABLE suppliers;
        ALTER TABLE suppliers_new RENAME TO suppliers;
        PRAGMA foreign_keys = ON;
        SELECT supplier_id, supplier_name, rating FROM suppliers ORDER BY supplier_id;
        ~~~

        Run \`PRAGMA foreign_key_check\` afterwards to prove no row was orphaned by the swap. Engines with
        full \`ALTER TABLE\` support (PostgreSQL, SQL Server, Oracle, MySQL) do this in one statement —
        \`ALTER TABLE suppliers ALTER COLUMN rating SET NOT NULL\` — but the rebuild pattern is the
        fallback that always works.

        Do it inside a transaction (module 11), and remember to recreate indexes, triggers and views that
        referenced the old table.

        ## CREATE TABLE AS SELECT
        ~~~sql
        CREATE TABLE product_revenue AS
        SELECT i.product_id,
               sum(i.quantity) AS units,
               round(sum(i.unit_price * i.quantity * (1 - i.discount)), 2) AS revenue
        FROM order_items i
        GROUP BY i.product_id;
        SELECT * FROM product_revenue ORDER BY revenue DESC LIMIT 5;
        ~~~

        CTAS copies **data and column names only** — no primary key, no constraints, no indexes. It is
        perfect for a snapshot or a staging step, and wrong as a way to define a real table.

        ## Temporary tables
        ~~~sql
        CREATE TEMP TABLE busy_customers AS
        SELECT customer_id, count(*) AS orders FROM orders GROUP BY customer_id HAVING count(*) > 20;
        SELECT count(*) AS rows_in_temp FROM busy_customers;
        ~~~

        A temp table is private to your connection and disappears when it closes. Use one when an
        expensive intermediate result is needed several times in a script — the one case where a CTE is
        the wrong tool.

        ## DROP and TRUNCATE
        ~~~sql-static
        DROP TABLE IF EXISTS staging_import;   -- removes table and data
        DROP VIEW IF EXISTS v_report;
        DROP INDEX IF EXISTS idx_orders_date;
        TRUNCATE TABLE staging_import;          -- empties it, keeps the structure (not in SQLite)
        ~~~

        \`TRUNCATE\` is DDL in most engines: much faster than \`DELETE\`, usually not transactional, and it
        resets identity counters. SQLite has no \`TRUNCATE\`; \`DELETE FROM t\` without a \`WHERE\` is
        optimised into the same thing.

        :::warn DDL and transactions
        PostgreSQL and SQLite can roll back DDL. MySQL (before 8.0 atomic DDL) and Oracle commit
        implicitly — a failed migration can leave you half-way. Know which you are on before you write a
        multi-step migration.
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Add a nullable `INTEGER` column `reorder_level` to `products`, then set it to 20 for every product whose `units_in_stock` is below 50 and 0 for the rest.',
          starter: 'ALTER TABLE products ADD COLUMN reorder_level INTEGER;\n\nUPDATE products SET ',
          solution: 'ALTER TABLE products ADD COLUMN reorder_level INTEGER;\nUPDATE products SET reorder_level = CASE WHEN units_in_stock < 50 THEN 20 ELSE 0 END;',
          check: 'SELECT product_id, units_in_stock, reorder_level FROM products ORDER BY product_id;',
          hints: ['One `ALTER TABLE ... ADD COLUMN`, then one `UPDATE` with a `CASE`.'],
          explain: 'Add-then-backfill is the standard two-step for introducing a column with meaningful values.'
        },
        {
          tag: 'DDL',
          prompt: 'Create a snapshot table `category_revenue` with CTAS holding `category_id`, `units` (total quantity) and `revenue` (rounded to 2) per product category, for non-cancelled orders.',
          starter: 'CREATE TABLE category_revenue AS\n',
          solution: "CREATE TABLE category_revenue AS\nSELECT p.category_id,\n       sum(i.quantity) AS units,\n       round(sum(i.unit_price * i.quantity * (1 - i.discount)), 2) AS revenue\nFROM order_items i\nJOIN products p ON p.product_id = i.product_id\nJOIN orders o   ON o.order_id = i.order_id\nWHERE o.status <> 'cancelled'\nGROUP BY p.category_id;",
          check: 'SELECT category_id, units, revenue FROM category_revenue ORDER BY category_id;',
          hints: ['`CREATE TABLE name AS SELECT ...` — the column names come from the SELECT list.', 'Join order lines to products (for the category) and to orders (for the status).'],
          explain: 'A materialised snapshot: fast to read, stale the moment the source changes. Module 11 compares it with a view.'
        }
      ]
    },

    {
      id: 'generated-columns',
      title: 'Generated columns and collations',
      lede: 'Letting the schema compute derived values, and controlling how text compares.',
      body: `
        ## Generated (computed) columns
        A generated column is defined by an expression over other columns of the same row. It cannot be
        written to directly, so it can never drift out of sync:

        ~~~sql
        CREATE TABLE invoice_lines (
          line_id    INTEGER PRIMARY KEY,
          qty        INTEGER NOT NULL CHECK (qty > 0),
          unit_price NUMERIC NOT NULL,
          discount   NUMERIC NOT NULL DEFAULT 0,
          net_total  NUMERIC GENERATED ALWAYS AS (qty * unit_price * (1 - discount)) STORED
        );
        INSERT INTO invoice_lines (line_id, qty, unit_price, discount) VALUES (1, 3, 100, 0.1);
        SELECT * FROM invoice_lines;
        ~~~

        - \`VIRTUAL\` (SQLite's default): computed on read, costs no storage.
        - \`STORED\`: computed on write, costs storage, cheaper to read and **indexable** in more engines.

        Supported by SQLite 3.31+, PostgreSQL 12+ (\`STORED\` only), MySQL 5.7+, SQL Server
        (\`AS expr PERSISTED\`), Oracle (\`AS (expr) VIRTUAL\`). Only \`VIRTUAL\` columns can be added
        to an existing table with \`ALTER TABLE\` in SQLite.

        A frequent use is indexing a normalised form of a column:

        ~~~sql
        CREATE TABLE contacts (
          contact_id   INTEGER PRIMARY KEY,
          email        TEXT NOT NULL,
          email_lower  TEXT GENERATED ALWAYS AS (lower(trim(email))) VIRTUAL
        );
        CREATE UNIQUE INDEX ux_contacts_email ON contacts (email_lower);
        INSERT INTO contacts (contact_id, email) VALUES (1, 'Ada@Example.com ');
        INSERT OR IGNORE INTO contacts (contact_id, email) VALUES (2, 'ada@example.com');
        SELECT contact_id, email, email_lower FROM contacts;
        ~~~

        One row survives: the unique index on the generated column enforces case-insensitive uniqueness.

        ## Collations
        A collation defines how text is compared and sorted. SQLite ships three — \`BINARY\` (default),
        \`NOCASE\` (ASCII case-insensitive), \`RTRIM\` — and they can be attached to a column, an index, a
        comparison or an \`ORDER BY\`:

        ~~~sql
        CREATE TABLE tags (name TEXT PRIMARY KEY COLLATE NOCASE);
        INSERT INTO tags VALUES ('Mechanical');
        INSERT OR IGNORE INTO tags VALUES ('mechanical');   -- duplicate under NOCASE
        SELECT name, (SELECT count(*) FROM tags) AS rows_kept FROM tags;
        ~~~

        Real engines offer locale-aware collations (\`de_DE.utf8\`, \`Latin1_General_CI_AS\`,
        \`utf8mb4_0900_ai_ci\`) that know that \`ä\` sorts next to \`a\` and that Turkish \`i\` is special.
        Two rules save a lot of pain:

        1. Set the collation **once**, at the column or database level, rather than per query.
        2. A comparison with a different collation than the index cannot use that index.

        :::dialect Case-insensitive search
        - SQLite: \`COLLATE NOCASE\` (ASCII only)
        - PostgreSQL: \`ILIKE\`, \`citext\`, or an index on \`lower(col)\`
        - MySQL: default collations are already case-insensitive
        - SQL Server: database collation, often \`..._CI_AS\`
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Create `invoice_lines` with `line_id` INTEGER primary key, `qty` INTEGER not null, `unit_price` NUMERIC not null, and a **stored generated column** `net_total` equal to `qty * unit_price`. Insert `(1, 3, 100)` and `(2, 2, 49.5)`.',
          starter: '',
          solution: 'CREATE TABLE invoice_lines (\n  line_id    INTEGER PRIMARY KEY,\n  qty        INTEGER NOT NULL,\n  unit_price NUMERIC NOT NULL,\n  net_total  NUMERIC GENERATED ALWAYS AS (qty * unit_price) STORED\n);\nINSERT INTO invoice_lines (line_id, qty, unit_price) VALUES (1, 3, 100), (2, 2, 49.5);',
          check: 'SELECT line_id, qty, unit_price, net_total FROM invoice_lines ORDER BY line_id;',
          hints: ['`net_total NUMERIC GENERATED ALWAYS AS (qty * unit_price) STORED`.', 'Do not list `net_total` in the INSERT — it cannot be written.'],
          explain: 'The derived value cannot disagree with its inputs, because there is only one place it is defined.'
        },
        {
          tag: 'DDL',
          prompt: 'Create `tags` with a single column `name` TEXT as primary key with `COLLATE NOCASE`, insert `\'Mechanical\'`, then attempt `\'mechanical\'` with `INSERT OR IGNORE`. The grader checks that only one row remains.',
          starter: '',
          solution: "CREATE TABLE tags (name TEXT PRIMARY KEY COLLATE NOCASE);\nINSERT INTO tags VALUES ('Mechanical');\nINSERT OR IGNORE INTO tags VALUES ('mechanical');",
          check: 'SELECT count(*) AS rows_kept, min(name) AS kept_value FROM tags;',
          hints: ['`name TEXT PRIMARY KEY COLLATE NOCASE`.'],
          explain: 'Collation on the column makes the uniqueness rule case-insensitive for every writer, with no per-query effort.'
        }
      ]
    }
  ]
});
