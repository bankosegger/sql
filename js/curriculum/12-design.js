(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'design',
  title: 'Schema design',
  blurb: 'Modelling entities and relationships, normal forms, when to denormalise, and anti-patterns.',
  lessons: [

    {
      id: 'er-modelling',
      title: 'Entities, relationships and cardinality',
      lede: 'Turning a description of a business into tables, keys and constraints.',
      body: `
        ## Three questions
        1. **What things exist?** Each becomes a table: customer, order, product, employee.
        2. **How are they related, and how many?** One-to-one, one-to-many, many-to-many.
        3. **What identifies each thing?** The primary key.

        ## One-to-many
        The *many* side stores the key of the *one* side. An order belongs to one customer; a customer has
        many orders — so \`orders\` carries \`customer_id\`.

        ~~~sql
        SELECT c.company_name, count(o.order_id) AS orders
        FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id
        GROUP BY c.customer_id, c.company_name
        ORDER BY orders DESC LIMIT 5;
        ~~~

        Mandatory or optional is expressed with \`NOT NULL\`: \`orders.customer_id NOT NULL\` means an
        order must have a customer; \`employees.dept_id\` is nullable, so staff may be unassigned.

        ## Many-to-many
        Needs a third table — a **junction** (or link, or associative) table — whose primary key is the
        pair of foreign keys:

        ~~~sql
        SELECT name, pk FROM pragma_table_info('order_items') ORDER BY cid;
        ~~~

        \`order_items\` is a junction table between \`orders\` and \`products\`, and it carries its own
        attributes (quantity, unit price, discount). That is typical: the relationship itself has data.

        ## One-to-one
        Rare, and usually one of:

        - **Optional extension** — rarely used or large columns moved to a side table
          (\`product_specs\` in this database), keyed by the same id.
        - **Subtype split** — \`person\` plus \`employee\`/\`customer\` details.
        - A sign the two tables should simply be one.

        ~~~sql
        SELECT p.product_name, s.specs
        FROM products p JOIN product_specs s ON s.product_id = p.product_id
        LIMIT 3;
        ~~~

        ## Self-referencing relationships
        A hierarchy is a one-to-many relationship from a table to itself:
        \`employees.manager_id → employees.emp_id\` (module 05, module 07).

        ## From sentence to schema
        Underline the nouns and the verbs:

        > "A **customer** places **orders**. Each order contains one or more **products** with a
        > **quantity**. An order is handled by one **employee**. Products belong to a **category** and
        > come from a **supplier**."

        Nouns become tables, verbs become foreign keys or junction tables, and the quantifiers
        ("one or more", "exactly one") become \`NOT NULL\` and uniqueness constraints. Write that model
        down as DDL before writing application code: the schema outlives every framework you will use
        on top of it.

        ## Attributes vs entities
        If a value has its own attributes, repeats across rows, or needs a controlled list, it is an
        entity: \`category_name\` in a \`categories\` table rather than a free-text column on every
        product. If it is a plain fact about one row (a price, a date), it is an attribute.

        :::tip Grain first
        Write down, in words, what one row of each table means — "one row per order line per order".
        Ambiguity there is the root cause of most double-counting bugs (module 05) and most schema
        rewrites.
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Model a many-to-many relationship between `employees` and a new table `skills`. Create:\n\n- `skills` with `skill_id` INTEGER primary key and `skill_name` TEXT not null unique\n- `employee_skills` with `emp_id` and `skill_id` (both not null, both foreign keys), a composite primary key on the pair, and a column `level` INTEGER not null with a check that it is between 1 and 5\n\nThen insert the skill `\'SQL\'` and give employee 22 that skill at level 5.',
          starter: '',
          solution: "CREATE TABLE skills (\n  skill_id   INTEGER PRIMARY KEY,\n  skill_name TEXT NOT NULL UNIQUE\n);\n\nCREATE TABLE employee_skills (\n  emp_id   INTEGER NOT NULL REFERENCES employees(emp_id),\n  skill_id INTEGER NOT NULL REFERENCES skills(skill_id),\n  level    INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),\n  PRIMARY KEY (emp_id, skill_id)\n);\n\nINSERT INTO skills (skill_name) VALUES ('SQL');\nINSERT INTO employee_skills (emp_id, skill_id, level)\nSELECT 22, skill_id, 5 FROM skills WHERE skill_name = 'SQL';",
          check: "SELECT e.last_name, s.skill_name, es.level\nFROM employee_skills es\nJOIN employees e ON e.emp_id = es.emp_id\nJOIN skills s ON s.skill_id = es.skill_id\nORDER BY e.last_name, s.skill_name;",
          hints: ['The junction table’s key is the pair of foreign keys.', 'You can look the skill id up with a SELECT in the INSERT.'],
          explain: 'Many-to-many always needs the third table — and it is the natural place for relationship attributes like `level`.'
        }
      ],
      quiz: [
        {
          q: 'A product can be in many orders and an order can contain many products. How is this modelled?',
          options: ['A comma-separated product_ids column on orders', 'A junction table with (order_id, product_id) as its key', 'Two foreign keys on products'],
          answer: 1,
          explain: 'A junction table is the only form that keeps both sides queryable, constrainable and indexable.'
        }
      ]
    },

    {
      id: 'normalization',
      title: 'Normalisation: 1NF to BCNF',
      lede: 'The rules that eliminate redundancy — explained by the bugs they prevent.',
      body: `
        ## Why it matters
        Redundancy is not a storage problem, it is a **consistency** problem. If a customer's city is
        stored on every order, an address change must find every copy; miss one and the database now
        disagrees with itself. Normalisation removes the possibility of that happening.

        The three symptoms of poor normalisation:

        - **Update anomaly** — one fact lives in many rows, so an update can be partial.
        - **Insert anomaly** — you cannot record one fact without inventing another.
        - **Delete anomaly** — deleting one fact destroys an unrelated one.

        ## 1NF — atomic values, no repeating groups
        Every cell holds one value; no \`'red,green,blue'\` columns and no \`phone1, phone2, phone3\`.

        ~~~sql-static
        -- violates 1NF
        CREATE TABLE bad_contacts (id INT, name TEXT, phones TEXT);     -- '070-1, 070-2'
        -- 1NF
        CREATE TABLE contacts (id INT PRIMARY KEY, name TEXT);
        CREATE TABLE contact_phones (id INT, phone TEXT, PRIMARY KEY (id, phone));
        ~~~

        A list in a column cannot be indexed, constrained, joined or counted without string surgery.

        ## 2NF — no partial dependency on part of a composite key
        Every non-key column must depend on the **whole** primary key.

        ~~~sql-static
        -- key is (order_id, product_id), but order_date depends on order_id alone
        CREATE TABLE bad_order_items (
          order_id INT, product_id INT, quantity INT,
          order_date DATE,          -- 2NF violation: repeated for every line of the order
          PRIMARY KEY (order_id, product_id)
        );
        ~~~

        The fix is what this database does: \`order_date\` lives in \`orders\`, quantity in
        \`order_items\`.

        ## 3NF — no transitive dependency
        Non-key columns must not depend on other non-key columns.

        ~~~sql-static
        CREATE TABLE bad_products (
          product_id INT PRIMARY KEY,
          category_id INT,
          category_name TEXT      -- depends on category_id, not on product_id
        );
        ~~~

        Renaming a category would mean updating every product. Hence \`categories\`, joined when needed.

        > **The informal summary:** every non-key column depends on *the key, the whole key, and nothing
        > but the key*.

        ## BCNF and beyond
        BCNF tightens 3NF for tables with overlapping candidate keys; 4NF and 5NF handle independent
        multi-valued facts (an employee's skills and their languages do not belong in one table — the
        combinations multiply meaninglessly). In practice: **reach 3NF deliberately, know BCNF exists,
        and recognise the 4NF smell** of a junction table holding two unrelated dimensions.

        ## Checking the current schema
        \`order_items\` stores \`unit_price\` even though \`products.unit_price\` exists. Is that a 3NF
        violation? No — it is a different fact: *the price at which this line was sold*, which must not
        change when the catalogue price does.

        ~~~sql
        SELECT i.order_id, i.product_id, i.unit_price AS sold_at, p.unit_price AS catalogue_now
        FROM order_items i JOIN products p USING (product_id)
        WHERE i.unit_price <> p.unit_price
        ORDER BY i.order_id LIMIT 8;
        ~~~

        Recognising "same name, different fact" is a large part of modelling skill. Historical values,
        snapshots and calculated totals are legitimately stored separately.
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Normalise this 1NF violation. Given a staging table with a comma-separated tag list, create `product_tag_list(product_id INTEGER, tags TEXT)` with the two rows `(1, \'mechanical,rgb\')` and `(2, \'compact\')`, then create a **normalised** table `product_tag(product_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (product_id, tag))` and populate it by splitting the lists with a recursive CTE.',
          starter: "CREATE TABLE product_tag_list (product_id INTEGER, tags TEXT);\nINSERT INTO product_tag_list VALUES (1, 'mechanical,rgb'), (2, 'compact');\n\nCREATE TABLE product_tag (product_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (product_id, tag));\n\nINSERT INTO product_tag (product_id, tag)\nWITH RECURSIVE split(product_id, tag, rest) AS (\n  \n)\nSELECT product_id, tag FROM split WHERE tag <> '';",
          solution: "CREATE TABLE product_tag_list (product_id INTEGER, tags TEXT);\nINSERT INTO product_tag_list VALUES (1, 'mechanical,rgb'), (2, 'compact');\n\nCREATE TABLE product_tag (product_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (product_id, tag));\n\nINSERT INTO product_tag (product_id, tag)\nWITH RECURSIVE split(product_id, tag, rest) AS (\n  SELECT product_id, '', tags || ',' FROM product_tag_list\n  UNION ALL\n  SELECT product_id,\n         substr(rest, 1, instr(rest, ',') - 1),\n         substr(rest, instr(rest, ',') + 1)\n  FROM split WHERE rest <> ''\n)\nSELECT product_id, tag FROM split WHERE tag <> '';",
          check: 'SELECT product_id, tag FROM product_tag ORDER BY product_id, tag;',
          hints: ['Anchor row: an empty tag plus the full list with a trailing comma as `rest`.', 'Each recursive step peels one tag off the front of `rest`.', 'Filter out the empty anchor tag at the end.'],
          explain: 'Splitting strings in SQL is this awkward precisely because a list in a column is the wrong model — do it once, at import, then never again.'
        }
      ],
      quiz: [
        {
          q: 'Storing category_name on every product row risks:',
          options: ['Nothing, it is faster', 'An update anomaly: renaming a category must touch every product row', 'A 1NF violation'],
          answer: 1,
          explain: 'It is a transitive dependency (3NF): the name depends on the category, not on the product.'
        },
        {
          q: 'order_items stores unit_price although products has one. Is that redundancy?',
          options: ['Yes, a 3NF violation', 'No — it records a different fact: the price at the time of sale', 'Only if the prices differ'],
          answer: 1,
          explain: 'Historical values are their own facts and must not change when the current value does.'
        }
      ]
    },

    {
      id: 'denormalization',
      title: 'Denormalisation, star schemas and history',
      lede: 'When duplicating data is the right engineering decision — and how to keep it honest.',
      body: `
        ## Normalise by default, denormalise by measurement
        A normalised schema is optimal for **writing** (one fact, one place) and for integrity.
        Denormalisation trades that for **read** speed, and the price is always the same: you now own a
        consistency problem.

        Only denormalise with a measured problem, a chosen refresh mechanism, and a way to detect drift.

        ## The usual forms
        | Technique | Example | Keeping it correct |
        | --- | --- | --- |
        | Stored aggregate | \`customers.order_count\` | trigger, scheduled job, or upsert on write |
        | Copied attribute | \`orders.customer_country\` for reporting | immutable snapshot, or refresh job |
        | Pre-joined table | a wide "sales fact" table | rebuilt by a pipeline |
        | Materialised view | monthly revenue | engine refresh (module 11) |
        | Summary/rollup table | daily totals, kept forever | append-only, recomputed per period |

        ~~~sql
        -- a summary table built from the facts
        CREATE TABLE daily_sales AS
        SELECT o.order_date,
               count(DISTINCT o.order_id) AS orders,
               round(sum(i.unit_price * i.quantity * (1 - i.discount)), 2) AS revenue
        FROM orders o JOIN order_items i ON i.order_id = o.order_id
        WHERE o.status <> 'cancelled'
        GROUP BY o.order_date;

        SELECT * FROM daily_sales ORDER BY order_date DESC LIMIT 7;
        ~~~

        Reads become a single-table scan; the cost is a rebuild step and the risk of staleness.

        ## Star schema (dimensional modelling)
        Analytics systems deliberately denormalise into **fact** tables (one row per measured event,
        narrow, huge) surrounded by **dimension** tables (wide, descriptive, small):

        ~~~sql-static
        fact_sales(date_key, product_key, customer_key, employee_key, quantity, net_amount)
        dim_date(date_key, date, year, quarter, month, week, is_weekend)
        dim_product(product_key, product_id, name, category, supplier, current_price)
        dim_customer(customer_key, customer_id, company, city, country, segment)
        ~~~

        Queries become "fact joined to a few dimensions", which is predictable to optimise, easy for BI
        tools, and easy for analysts to understand. A \`dim_date\` table is standard — it makes
        "fiscal quarter" or "working day" a join instead of a function.

        **Snowflake schema** normalises the dimensions further (category in its own table); it saves space
        and costs joins.

        ## Slowly changing dimensions
        When a descriptive attribute changes, you must decide what happens to history:

        - **Type 1** — overwrite. History is lost.
        - **Type 2** — add a new row with \`valid_from\`/\`valid_to\` (and often an \`is_current\` flag).
          Facts reference the version that was current when they happened.
        - **Type 3** — keep a \`previous_value\` column. Cheap, limited.

        Type 2 is the standard for anything a report might need to reproduce ("sales by the segment the
        customer was in *at the time*"). The half-open validity interval and the point-in-time join from
        module 05 are exactly the mechanics it needs.

        ## OLTP vs OLAP
        | | Transactional (OLTP) | Analytical (OLAP) |
        | --- | --- | --- |
        | Workload | many small reads/writes | few huge scans |
        | Schema | normalised | star / wide tables |
        | Indexes | many, selective | few; columnar storage |
        | Priority | integrity, latency | throughput |

        Running heavy analytics on the production OLTP database is the most common cause of "the website
        got slow at 9am". A replica, an export, or a warehouse solves it.

        :::warn Drift
        Any denormalised copy will eventually disagree with its source. Write the reconciliation query
        **when you create the copy** (module 06's \`EXCEPT\` pattern), and run it on a schedule.
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Build a denormalised reporting table `sales_flat` with one row per order line, pre-joined for analysts: `order_date`, `country` (customer country), `category_name`, `product_name`, `quantity` and `net_amount` (rounded to 2), for non-cancelled orders only.',
          starter: 'CREATE TABLE sales_flat AS\n',
          solution: "CREATE TABLE sales_flat AS\nSELECT o.order_date,\n       c.country,\n       cat.category_name,\n       p.product_name,\n       i.quantity,\n       round(i.unit_price * i.quantity * (1 - i.discount), 2) AS net_amount\nFROM orders o\nJOIN customers c    ON c.customer_id = o.customer_id\nJOIN order_items i  ON i.order_id = o.order_id\nJOIN products p     ON p.product_id = i.product_id\nJOIN categories cat ON cat.category_id = p.category_id\nWHERE o.status <> 'cancelled';",
          check: 'SELECT country, category_name, count(*) AS lines, round(sum(net_amount), 2) AS revenue\nFROM sales_flat GROUP BY country, category_name ORDER BY revenue DESC LIMIT 10;',
          hints: ['Five tables joined, one row per order line.', 'The check query aggregates your table, so the grain must be the order line.'],
          explain: 'This is a fact table in miniature: wide, redundant, and very fast to aggregate — at the cost of needing a rebuild whenever the source changes.'
        }
      ],
      quiz: [
        {
          q: 'A star schema’s fact table is:',
          options: ['Wide and descriptive', 'Narrow, huge, one row per measured event, with keys to dimensions', 'A materialised view'],
          answer: 1,
          explain: 'Facts hold measures and foreign keys; the descriptive text lives in the dimensions.'
        },
        {
          q: 'Keeping history when a customer changes segment is:',
          options: ['Type 1 SCD', 'Type 2 SCD, with valid_from / valid_to rows', 'Normalisation'],
          answer: 1,
          explain: 'Type 2 versions the dimension row so old facts still point at the old description.'
        }
      ]
    },

    {
      id: 'anti-patterns',
      title: 'Schema anti-patterns',
      lede: 'Designs that look convenient on day one and cost you for years.',
      body: `
        ## Comma-separated lists in a column
        \`tags = 'mechanical,rgb,wireless'\`. No index, no foreign key, no counting without string
        surgery, and \`LIKE '%rgb%'\` matches \`'rgb-lite'\`. Use a child table (module 12's exercise).

        ## EAV (entity–attribute–value)
        ~~~sql-static
        attributes(entity_id, attribute_name, value TEXT)
        ~~~

        Infinitely flexible, and that is the problem: no types, no \`NOT NULL\`, no constraint between
        attributes, and every query becomes a pivot with one self join per attribute. Legitimate uses are
        narrow (genuinely user-defined fields, sparse scientific data). Otherwise prefer real columns, or
        a \`JSON\` column (module 14) which at least keeps one row per entity and supports typed
        extraction and indexing.

        ## Nullable soup
        A table where almost everything is nullable records nothing about what a valid row looks like.
        Often it is two entities in one table — the columns split neatly into "set for A" and "set for B".
        Split the table, or model the subtype explicitly.

        ## Polymorphic foreign keys
        ~~~sql-static
        comments(id, commentable_type TEXT, commentable_id INT)   -- 'order' | 'product'
        ~~~

        No foreign key can be declared, so orphans are inevitable. Alternatives: one join table per
        target type, or a shared parent table that both types reference.

        ## Magic strings and numbers
        \`status = 3\` or \`type = 'X'\` with the meaning in application code. Use a lookup table with a
        foreign key, or at minimum a \`CHECK (status IN (...))\` so the schema documents the domain
        (as \`orders.status\` does here).

        ## Storing what you can compute
        A \`total\` column that must equal \`sum(lines)\` *will* drift. Store it only if you need the
        historical snapshot (an invoice total is a real fact) or if you have measured that recomputing is
        too slow — and then maintain it in one place: a generated column, a trigger, or a rebuild job.

        ## Wrong types
        - Dates or numbers stored as \`TEXT\` — no range checks, broken sorting, no date arithmetic.
        - Money in \`FLOAT\` (module 03).
        - Booleans as \`'Y'\`/\`'N'\`/\`'yes'\`/\`NULL\` — four states for two values.
        - Everything \`VARCHAR(255)\` because the generator said so.

        ## No primary key, or a key that can change
        A natural key that is "obviously stable" (email, phone, licence plate) eventually changes, and
        every child row pointing at it must change too. Surrogate key for identity, unique constraint for
        the natural key (module 09).

        ## Over-indexing
        Every index must be maintained on every write and consumes memory. Indexes nobody uses are pure
        cost — module 13.

        ## One table per tenant / per year
        \`orders_2023\`, \`orders_2024\`, \`orders_acme\`: every query needs a \`UNION\`, every schema
        change needs a loop, and nothing can be enforced globally. Use a \`tenant_id\` column (with row
        level security) or the engine's **partitioning** feature, which keeps one logical table.

        :::tip The test
        For any design, ask: *what does the database prevent?* If the answer is "nothing — the
        application has to get it right", you have pushed a data-integrity problem into code that cannot
        enforce it across all its writers.
        :::
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Replace a magic-string column with a proper lookup. Create `order_status(status_code TEXT PRIMARY KEY, label TEXT NOT NULL, is_final INTEGER NOT NULL)` and populate it with the four statuses used in `orders` (`pending`/`Pending`/0, `shipped`/`Shipped`/0, `delivered`/`Delivered`/1, `cancelled`/`Cancelled`/1). Then return `label`, `is_final` and `orders` (count) per status, joining `orders` to the new table, ordered by `orders` descending.',
          starter: '',
          solution: "CREATE TABLE order_status (\n  status_code TEXT PRIMARY KEY,\n  label       TEXT NOT NULL,\n  is_final    INTEGER NOT NULL\n);\nINSERT INTO order_status VALUES\n  ('pending', 'Pending', 0),\n  ('shipped', 'Shipped', 0),\n  ('delivered', 'Delivered', 1),\n  ('cancelled', 'Cancelled', 1);\n\nSELECT s.label, s.is_final, count(*) AS orders\nFROM orders o JOIN order_status s ON s.status_code = o.status\nGROUP BY s.label, s.is_final\nORDER BY orders DESC;",
          orderMatters: false,
          hints: ['Four rows in the lookup table.', 'Join `orders.status` to `order_status.status_code`.'],
          explain: 'The lookup table carries extra attributes (`is_final`) that a CHECK constraint could never express, and it can grow without a migration.'
        }
      ],
      quiz: [
        {
          q: 'The main problem with a polymorphic foreign key (type + id) is:',
          options: ['It wastes space', 'No referential integrity can be declared, so orphans are inevitable', 'It cannot be indexed'],
          answer: 1,
          explain: 'A foreign key must name one target table; a type-dispatched reference cannot be enforced by the database.'
        }
      ]
    },

    {
      id: 'conventions',
      title: 'Conventions that age well',
      lede: 'Naming, audit columns, time zones, identifiers and soft deletes — the boring decisions that compound.',
      body: `
        ## Naming
        - \`snake_case\` everywhere; no quoted mixed-case identifiers.
        - Plural table names (\`orders\`), singular columns (\`order_date\`). Pick the opposite if you
          prefer — just be consistent.
        - Keys: \`order_id\` in both parent and child, so \`USING (order_id)\` works and joins are obvious.
        - Booleans read as assertions: \`is_active\`, \`has_shipped\`.
        - Times: \`_at\` for timestamps, \`_on\` for dates, \`_count\` for counts.
        - Prefix objects by kind if your team likes it (\`v_\` views, \`ux_\`/\`ix_\` indexes,
          \`trg_\` triggers) — never prefix tables with \`tbl_\`.
        - Avoid reserved words (\`order\`, \`user\`, \`group\`, \`check\`, \`from\`). You will otherwise
          quote that identifier forever.

        ## Audit columns
        Nearly every table benefits from \`created_at\`, \`updated_at\`, and often \`created_by\`:

        ~~~sql
        CREATE TABLE tickets (
          ticket_id  INTEGER PRIMARY KEY,
          subject    TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TRIGGER trg_tickets_touch AFTER UPDATE ON tickets
        FOR EACH ROW BEGIN
          UPDATE tickets SET updated_at = datetime('now') WHERE ticket_id = NEW.ticket_id;
        END;

        INSERT INTO tickets (subject) VALUES ('Keyboard arrived damaged');
        UPDATE tickets SET subject = subject || ' (RMA raised)' WHERE ticket_id = 1;
        SELECT ticket_id, subject, created_at = updated_at AS unchanged_timestamps FROM tickets;
        ~~~

        They cost almost nothing and answer "when did this change?" — a question you will eventually
        need to answer under pressure.

        ## Time zones
        - Store instants in **UTC**; convert at the edges. PostgreSQL's \`timestamptz\` does this for you;
          elsewhere adopt the convention and never deviate.
        - Keep the user's zone (\`Europe/Berlin\`, not an offset) when you need to render local time or
          compute "their yesterday".
        - A calendar date (birthday, invoice date) is not an instant — leave it a \`DATE\`.

        ## Identifiers
        | Choice | Good | Bad |
        | --- | --- | --- |
        | \`BIGINT\` identity | small, fast, ordered | leaks volume, needs central allocation |
        | UUIDv4 | generated anywhere, opaque | 16 bytes, random → poor index locality |
        | UUIDv7 / ULID | opaque **and** time-ordered | newer, less tooling |
        | Natural key | readable, no join needed | changes, widens children |

        Expose a public id (UUID or hash) if sequential ids would reveal too much; keep the integer key
        internally.

        ## Soft deletes, done properly
        If you adopt \`deleted_at\`, adopt the whole package: a view that filters it, partial unique
        indexes so a deleted row does not block a new one, and a retention job. Otherwise one forgotten
        filter puts deleted data in a report.

        ~~~sql
        ALTER TABLE customers ADD COLUMN deleted_at TEXT;
        UPDATE customers SET deleted_at = datetime('now') WHERE customer_id = 21;

        CREATE VIEW v_customers AS SELECT * FROM customers WHERE deleted_at IS NULL;
        SELECT (SELECT count(*) FROM customers) AS all_rows,
               (SELECT count(*) FROM v_customers) AS live_rows;
        ~~~

        ## Migrations
        Schema changes belong in version control as ordered, forward-only scripts, applied by a tool
        (Flyway, Liquibase, Alembic, Rails, Prisma, sqlx). Rules that prevent outages:

        1. **Additive first.** Add a nullable column, deploy code that writes it, backfill, then enforce.
        2. **Never rename in one step** — add, dual-write, migrate readers, drop later.
        3. Beware locks: adding a \`NOT NULL\` column with a default rewrote whole tables in older
           PostgreSQL and MySQL versions.
        4. Make migrations idempotent and reviewable, and test them on a copy of production-sized data.
        5. Keep \`DROP\` statements in a separate, later migration than the code that stopped using the
           column.
      `,
      exercises: [
        {
          tag: 'DDL',
          prompt: 'Add soft-delete support to `customers`: add a nullable `deleted_at` TEXT column, soft-delete customer 21 by setting it to `\'2025-10-30 12:00:00\'`, and create a view `v_customers` that exposes only live rows. Then return `customer_id` and `company_name` from the view for customers in countries starting with `N`, ordered by `company_name`.',
          starter: '',
          solution: "ALTER TABLE customers ADD COLUMN deleted_at TEXT;\nUPDATE customers SET deleted_at = '2025-10-30 12:00:00' WHERE customer_id = 21;\nCREATE VIEW v_customers AS SELECT * FROM customers WHERE deleted_at IS NULL;\n\nSELECT customer_id, company_name FROM v_customers WHERE country LIKE 'N%' ORDER BY company_name;",
          orderMatters: true,
          hints: ['Three statements, then the query against the view.', 'The view encapsulates the `deleted_at IS NULL` filter so no consumer can forget it.'],
          explain: 'The view is the part that makes soft deletes survivable: consumers query `v_customers` and cannot see deleted rows by accident.'
        }
      ],
      quiz: [
        {
          q: 'The safest way to rename a column in a live system:',
          options: ['ALTER TABLE ... RENAME COLUMN in one deploy', 'Add the new column, dual-write, migrate readers, drop the old one later', 'Create a new table and copy'],
          answer: 1,
          explain: 'A rename is a breaking change for every reader and writer at once; the expand/contract sequence keeps old and new code working together.'
        }
      ]
    }
  ]
});
