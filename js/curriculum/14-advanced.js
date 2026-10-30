(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'advanced',
  title: 'Advanced patterns',
  blurb: 'Pivots, ROLLUP, JSON, text search, gaps and islands, time series, cohorts and portability.',
  lessons: [

    {
      id: 'pivot',
      title: 'Pivot and unpivot',
      lede: 'Turning rows into columns and back — the shape reports actually want.',
      body: `
        ## Pivot with conditional aggregation
        SQL's portable pivot is \`CASE\` inside an aggregate (module 04). One column per output value:

        ~~~sql
        SELECT c.country,
               count(*) AS orders,
               sum(CASE WHEN o.status = 'pending'   THEN 1 ELSE 0 END) AS pending,
               sum(CASE WHEN o.status = 'shipped'   THEN 1 ELSE 0 END) AS shipped,
               sum(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
               sum(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
        FROM orders o
        JOIN customers c USING (customer_id)
        GROUP BY c.country
        ORDER BY orders DESC, c.country;
        ~~~

        With \`FILTER\` (SQLite, PostgreSQL) the same thing reads better:

        ~~~sql
        SELECT strftime('%Y', order_date) AS year,
               count(*) FILTER (WHERE status = 'delivered') AS delivered,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               round(sum(freight) FILTER (WHERE status <> 'cancelled'), 2) AS billable_freight
        FROM orders
        GROUP BY year
        ORDER BY year;
        ~~~

        ## A months-across-the-top matrix
        ~~~sql
        SELECT cat.category_name,
               round(sum(CASE WHEN strftime('%m', o.order_date) = '07' THEN i.quantity * i.unit_price END), 0) AS jul,
               round(sum(CASE WHEN strftime('%m', o.order_date) = '08' THEN i.quantity * i.unit_price END), 0) AS aug,
               round(sum(CASE WHEN strftime('%m', o.order_date) = '09' THEN i.quantity * i.unit_price END), 0) AS sep
        FROM orders o
        JOIN order_items i ON i.order_id = o.order_id
        JOIN products p    ON p.product_id = i.product_id
        JOIN categories cat ON cat.category_id = p.category_id
        WHERE o.order_date >= '2025-07-01' AND o.order_date < '2025-10-01'
        GROUP BY cat.category_name
        ORDER BY cat.category_name;
        ~~~

        Note \`CASE\` without \`ELSE\` yields \`NULL\`, which \`sum\` ignores — so empty cells come back
        \`NULL\` rather than 0. Add \`ELSE 0\` or \`COALESCE\` if you prefer zeros.

        ## The limitation
        **A SQL query's column list is fixed at parse time.** You cannot write "one column per status
        that happens to exist" without either knowing the values in advance or generating the SQL
        dynamically (in your application, or with a stored procedure building a string). Any tool that
        appears to do dynamic pivots is generating SQL under the hood.

        ## Dedicated syntax
        | Engine | Pivot |
        | --- | --- |
        | SQL Server, Oracle | \`PIVOT (sum(x) FOR col IN (...))\` / \`UNPIVOT\` |
        | PostgreSQL | \`crosstab()\` in the \`tablefunc\` extension |
        | Others | \`CASE\` / \`FILTER\` |

        All of them still need the value list up front.

        ## Unpivot: columns into rows
        The portable form is a \`UNION ALL\` per column, which turns a wide table into a long one:

        ~~~sql
        SELECT product_id, 'unit_price' AS metric, unit_price AS value FROM products WHERE product_id <= 3
        UNION ALL
        SELECT product_id, 'units_in_stock', units_in_stock FROM products WHERE product_id <= 3
        UNION ALL
        SELECT product_id, 'discontinued', discontinued FROM products WHERE product_id <= 3
        ORDER BY product_id, metric;
        ~~~

        A long (key, metric, value) shape is what charting libraries and statistical tools usually
        prefer, and it survives new metrics without a schema change.

        A cross join against a small \`VALUES\` list does the same with less repetition:

        ~~~sql
        WITH metrics(metric) AS (VALUES ('unit_price'), ('units_in_stock'))
        SELECT p.product_id, m.metric,
               CASE m.metric WHEN 'unit_price' THEN p.unit_price ELSE p.units_in_stock END AS value
        FROM products p CROSS JOIN metrics m
        WHERE p.product_id <= 3
        ORDER BY p.product_id, m.metric;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Pivot order counts by status, one row per `emp_id`: columns `emp_id`, `pending`, `shipped`, `delivered`, `cancelled`. Order by `emp_id`.',
          starter: '',
          solution: "SELECT emp_id,\n       sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,\n       sum(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) AS shipped,\n       sum(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,\n       sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled\nFROM orders\nGROUP BY emp_id\nORDER BY emp_id;",
          orderMatters: true,
          hints: ['One conditional sum per status value.', '`FILTER (WHERE status = \'pending\')` works too.'],
          explain: 'Four measures, one pass over the table.'
        },
        {
          prompt: 'Unpivot the two numeric columns of `departments` into a long shape: `dept_name`, `metric` (`\'budget\'` or `\'dept_id\'`) and `value`, using `UNION ALL`. Order by `dept_name`, `metric`.',
          starter: '',
          solution: "SELECT dept_name, 'budget' AS metric, budget AS value FROM departments\nUNION ALL\nSELECT dept_name, 'dept_id', dept_id FROM departments\nORDER BY dept_name, metric;",
          orderMatters: true,
          hints: ['Two SELECTs with a literal metric name each.'],
          explain: 'Long format: one row per entity per metric, extensible without changing the shape.'
        }
      ],
      quiz: [
        {
          q: 'Why can’t a plain SQL query pivot an unknown set of values into columns?',
          options: ['It can, with PIVOT', 'The result’s column list must be known when the statement is parsed', 'Only with window functions'],
          answer: 1,
          explain: 'Even engines with PIVOT syntax require the value list; truly dynamic pivots mean generating SQL.'
        }
      ]
    },

    {
      id: 'grouping-sets',
      title: 'Subtotals: GROUPING SETS, ROLLUP and CUBE',
      lede: 'Several levels of aggregation in one pass, with totals rows.',
      body: `
        ## The problem
        A report wants revenue per country **and** per country+status **and** a grand total. Three
        \`GROUP BY\` queries stitched with \`UNION ALL\` work, but read the data three times.

        ## GROUPING SETS
        Standard SQL lets one query produce several grouping levels:

        ~~~sql-static
        SELECT country, status, count(*) AS orders
        FROM orders JOIN customers USING (customer_id)
        GROUP BY GROUPING SETS ((country, status), (country), ());
        ~~~

        - \`ROLLUP (a, b, c)\` is shorthand for the hierarchy: \`(a,b,c), (a,b), (a), ()\` — right for
          drill-downs like year → quarter → month.
        - \`CUBE (a, b)\` gives **every** combination: \`(a,b), (a), (b), ()\`.
        - \`GROUPING(col)\` returns 1 when the column was aggregated away in that row, so you can label
          subtotal rows.

        ~~~sql-static
        SELECT COALESCE(country, 'ALL') AS country,
               COALESCE(status, 'ALL')  AS status,
               count(*) AS orders,
               GROUPING(country) + GROUPING(status) AS level
        FROM orders JOIN customers USING (customer_id)
        GROUP BY ROLLUP (country, status)
        ORDER BY level, country, status;
        ~~~

        Supported by PostgreSQL 9.5+, SQL Server, Oracle, MySQL 8 (\`WITH ROLLUP\`, no \`CUBE\`).
        **SQLite has none of them.**

        ## The portable emulation
        \`UNION ALL\` of each level, with a literal label so you can tell them apart:

        ~~~sql
        WITH base AS (
          SELECT c.country, o.status, 1 AS order_row
          FROM orders o JOIN customers c USING (customer_id)
        )
        SELECT country, status, count(*) AS orders, 0 AS level FROM base GROUP BY country, status
        UNION ALL
        SELECT country, 'ALL', count(*), 1 FROM base GROUP BY country
        UNION ALL
        SELECT 'ALL', 'ALL', count(*), 2 FROM base
        ORDER BY level, country, status;
        ~~~

        One CTE, three aggregations over it. The engine may still read \`base\` three times, but the
        query is written once and the shape matches what \`ROLLUP\` would give you.

        ## A cleaner emulation with a cross join
        Generate the levels, then group by an expression that nulls out the dimension when the level
        says so:

        ~~~sql
        WITH base AS (
          SELECT c.country, o.status
          FROM orders o JOIN customers c USING (customer_id)
        ), levels(lvl) AS (VALUES (0), (1), (2))
        SELECT CASE WHEN lvl < 2 THEN country ELSE 'ALL' END AS country,
               CASE WHEN lvl < 1 THEN status  ELSE 'ALL' END AS status,
               count(*) AS orders,
               lvl AS level
        FROM base CROSS JOIN levels
        GROUP BY level, 1, 2
        ORDER BY level, country, status;
        ~~~

        One scan of \`base\`, every level — the trick is that the cross join duplicates each row once per
        level before grouping.

        ## Reading subtotal output
        Always label the subtotal rows explicitly (a \`level\` column, or \`'ALL'\` text). A \`NULL\` in
        the country column of a \`ROLLUP\` result is ambiguous: it could be a subtotal row *or* a genuine
        NULL country — which is exactly what \`GROUPING()\` exists to disambiguate.
      `,
      exercises: [
        {
          prompt: 'Emulate `ROLLUP (status)` over `orders` with `UNION ALL`: return `status` (the literal `\'ALL\'` for the total row), `orders` and `level` (0 for the detail rows, 1 for the total), ordered by `level` then `status`.',
          starter: '',
          solution: "SELECT status, count(*) AS orders, 0 AS level FROM orders GROUP BY status\nUNION ALL\nSELECT 'ALL', count(*), 1 FROM orders\nORDER BY level, status;",
          orderMatters: true,
          hints: ['Two SELECTs: grouped detail, then the ungrouped total.'],
          explain: 'This is exactly the row set `GROUP BY ROLLUP (status)` produces on engines that support it.'
        },
        {
          prompt: 'Using the cross-join-levels technique, produce a two-level summary of non-cancelled orders by `country` and `status`: columns `country`, `status`, `orders`, `level` — level 0 is country+status, level 1 is country only (status shown as `\'ALL\'`). Order by `level`, `country`, `status`.',
          starter: 'WITH base AS (\n  \n), levels(lvl) AS (VALUES (0), (1))\nSELECT ',
          solution: "WITH base AS (\n  SELECT c.country, o.status\n  FROM orders o JOIN customers c USING (customer_id)\n  WHERE o.status <> 'cancelled'\n), levels(lvl) AS (VALUES (0), (1))\nSELECT country,\n       CASE WHEN lvl < 1 THEN status ELSE 'ALL' END AS status,\n       count(*) AS orders,\n       lvl AS level\nFROM base CROSS JOIN levels\nGROUP BY level, 1, 2\nORDER BY level, country, status;",
          orderMatters: true,
          hints: ['The cross join duplicates every base row once per level.', 'Group by the CASE expression so level 1 collapses the statuses.'],
          explain: 'One scan, two aggregation levels — the portable stand-in for GROUPING SETS.'
        }
      ],
      quiz: [
        {
          q: 'ROLLUP (year, quarter, month) produces which grouping levels?',
          options: ['Every combination of the three', '(year,quarter,month), (year,quarter), (year), ()', 'Only the finest level'],
          answer: 1,
          explain: 'ROLLUP walks a hierarchy from most detailed to the grand total. CUBE is the one that gives every combination.'
        }
      ]
    },

    {
      id: 'json',
      title: 'JSON and semi-structured data',
      lede: 'Storing documents inside a relational database, and querying them without giving up SQL.',
      body: `
        ## When JSON earns its place
        - Genuinely sparse or caller-defined attributes (product specs differ per category).
        - Payloads you store verbatim for audit (webhooks, API responses).
        - Fast-moving fields that do not yet deserve a migration.

        When a field is queried, filtered or joined on regularly, promote it to a real column: types,
        constraints and plain indexes beat document access every time.

        ## Extracting values
        \`product_specs.specs\` holds one JSON document per product:

        ~~~sql
        SELECT product_id, specs FROM product_specs ORDER BY product_id LIMIT 3;
        ~~~

        ~~~sql
        SELECT p.product_name,
               json_extract(s.specs, '$.switch')    AS switch_type,
               json_extract(s.specs, '$.weight_g')  AS weight_g,
               json_extract(s.specs, '$.ports[0]')  AS first_port
        FROM product_specs s
        JOIN products p USING (product_id)
        WHERE json_extract(s.specs, '$.switch') IS NOT NULL
        ORDER BY p.product_name;
        ~~~

        \`$\` is the document root; \`$.key\` a field; \`$.arr[0]\` an element; \`$.a.b\` a nested field.
        SQLite also has the operators \`->\` (returns JSON) and \`->>\` (returns a SQL value), which
        PostgreSQL and MySQL share.

        ## Filtering and aggregating
        ~~~sql
        SELECT json_extract(specs, '$.panel') AS panel,
               count(*) AS monitors,
               round(avg(CAST(json_extract(specs, '$.size_in') AS REAL)), 1) AS avg_inches
        FROM product_specs
        WHERE json_extract(specs, '$.panel') IS NOT NULL
        GROUP BY panel
        ORDER BY panel;
        ~~~

        Values come out untyped (text), so \`CAST\` before doing arithmetic or comparisons — a recurring
        source of silent bugs.

        ## Expanding arrays into rows
        \`json_each\` turns a document or array into a row set, which you join against:

        ~~~sql
        SELECT p.product_name, j.value AS port
        FROM product_specs s
        JOIN products p USING (product_id)
        JOIN json_each(s.specs, '$.ports') j
        ORDER BY p.product_name, j.key
        LIMIT 12;
        ~~~

        ~~~sql
        -- which ports are most common across the catalogue?
        SELECT j.value AS port, count(*) AS products
        FROM product_specs s JOIN json_each(s.specs, '$.ports') j
        GROUP BY port
        ORDER BY products DESC, port;
        ~~~

        PostgreSQL spells these \`jsonb_array_elements\` / \`jsonb_each\`; MySQL has
        \`JSON_TABLE\`; SQL Server \`OPENJSON\`. The concept — a table-valued function that unnests a
        document — is the same everywhere.

        ## Building JSON
        ~~~sql
        SELECT json_object(
                 'product', p.product_name,
                 'price',   p.unit_price,
                 'tags',    json_array('hardware', cat.category_name)
               ) AS document
        FROM products p JOIN categories cat USING (category_id)
        ORDER BY p.product_id LIMIT 3;
        ~~~

        ~~~sql
        -- a nested document per category
        SELECT cat.category_name,
               json_group_array(p.product_name) AS products
        FROM categories cat JOIN products p USING (category_id)
        GROUP BY cat.category_name
        ORDER BY cat.category_name;
        ~~~

        This is how an API endpoint can return nested data in one round trip instead of N+1 queries.

        ## Validation and indexing
        ~~~sql
        SELECT json_valid('{"a":1}') AS ok, json_valid('{oops') AS broken,
               json_type('{"a":[1,2]}', '$.a') AS a_type;
        ~~~

        - Constrain the column: \`CHECK (json_valid(specs))\`.
        - Index a path by indexing the expression, or a generated column:
          \`CREATE INDEX ix ON product_specs (json_extract(specs, '$.panel'))\`.
        - PostgreSQL's \`jsonb\` supports GIN indexes over the whole document and containment operators
          (\`@>\`); SQLite 3.45+ has a binary \`jsonb\` format for faster access.

        :::warn The cost of document columns
        No column-level constraints, no referential integrity, no reliable types, and a planner that
        cannot estimate selectivity inside the document. JSON is a pragmatic escape hatch, not a schema.
        :::
      `,
      exercises: [
        {
          prompt: 'From `product_specs` joined to `products`, return `product_name` and `weight_g` (extracted from `$.weight_g` as an INTEGER) for the documents that have a weight, ordered by `weight_g` descending.',
          starter: '',
          solution: "SELECT p.product_name, CAST(json_extract(s.specs, '$.weight_g') AS INTEGER) AS weight_g\nFROM product_specs s\nJOIN products p USING (product_id)\nWHERE json_extract(s.specs, '$.weight_g') IS NOT NULL\nORDER BY weight_g DESC;",
          orderMatters: true,
          hints: ["`json_extract(specs, '$.weight_g')`.", 'Filter out documents without the key, and CAST before sorting numerically.'],
          explain: 'Without the CAST the sort would be lexicographic — "88" would come after "1100".'
        },
        {
          prompt: 'Count how often each port type appears across all product specs: `port` and `products`, most common first, ties alphabetically. Use `json_each` over `$.ports`.',
          starter: '',
          solution: "SELECT j.value AS port, count(*) AS products\nFROM product_specs s\nJOIN json_each(s.specs, '$.ports') j\nGROUP BY port\nORDER BY products DESC, port;",
          orderMatters: true,
          requireSql: [{ pattern: 'json_each', msg: 'Expand the array with `json_each`.' }],
          hints: ['`JOIN json_each(s.specs, \'$.ports\') j` gives one row per array element.'],
          explain: 'json_each is the bridge from document to relation — once unnested, everything is ordinary SQL.'
        },
        {
          prompt: 'Build one JSON document per category: `category_name` and `products` — a JSON array of the product names in that category (use `json_group_array`). Order by `category_name`.',
          starter: '',
          solution: 'SELECT cat.category_name, json_group_array(p.product_name) AS products\nFROM categories cat\nJOIN products p USING (category_id)\nGROUP BY cat.category_name\nORDER BY cat.category_name;',
          orderMatters: true,
          hints: ['`json_group_array` is an aggregate, like `group_concat` but producing valid JSON.'],
          explain: 'Aggregating into JSON lets one query return nested results — the standard cure for N+1 API queries.'
        }
      ]
    },

    {
      id: 'text-search',
      title: 'Text search',
      lede: 'From LIKE to real full-text indexes, and the normalisation that matters more than either.',
      body: `
        ## Level 1: LIKE
        Fine for small tables and prefix searches, and index-friendly only for prefixes (module 13):

        ~~~sql
        SELECT product_name FROM products WHERE product_name LIKE 'Pixel%';
        ~~~

        ## Level 2: normalise, then compare
        Most "search doesn't work" complaints are case, accents or whitespace. Store a canonical form
        (module 03) and search that:

        ~~~sql
        SELECT company_name, contact_name
        FROM customers
        WHERE lower(trim(company_name)) LIKE '%works%'
        ORDER BY company_name;
        ~~~

        For accent-insensitive matching you need either a locale-aware collation
        (\`de_DE.utf8\`, \`utf8mb4_0900_ai_ci\`), PostgreSQL's \`unaccent\`, or a normalised column you
        maintain yourself.

        ## Level 3: scoring several fields
        A respectable search can be built from \`CASE\` weights, without any extra machinery:

        ~~~sql
        WITH q(term) AS (VALUES ('dock'))
        SELECT p.product_name,
               CASE WHEN lower(p.product_name) = (SELECT term FROM q)              THEN 100
                    WHEN lower(p.product_name) LIKE (SELECT term FROM q) || '%'    THEN 50
                    WHEN lower(p.product_name) LIKE '%' || (SELECT term FROM q) || '%' THEN 20
                    ELSE 0 END AS score
        FROM products p
        WHERE lower(p.product_name) LIKE '%' || (SELECT term FROM q) || '%'
        ORDER BY score DESC, p.product_name;
        ~~~

        Exact match beats prefix beats substring — the same ranking idea a search engine applies, in
        plain SQL.

        ## Level 4: a real full-text index
        A full-text index stores **tokens**, so it can match words in any position, stem them
        (\`running\` → \`run\`), ignore stop words and rank by relevance.

        | Engine | Mechanism |
        | --- | --- |
        | SQLite | FTS5 / FTS4 virtual tables, \`MATCH\`, \`bm25()\` |
        | PostgreSQL | \`tsvector\`/\`tsquery\` + GIN, \`ts_rank\`; \`pg_trgm\` for fuzzy/infix |
        | MySQL | \`FULLTEXT\` index, \`MATCH ... AGAINST\` |
        | SQL Server | full-text catalogues, \`CONTAINS\`, \`FREETEXT\` |
        | Oracle | Oracle Text |

        ~~~sql-static
        -- SQLite FTS5 (not compiled into this page's build)
        CREATE VIRTUAL TABLE product_fts USING fts5(product_name, description);
        INSERT INTO product_fts SELECT product_name, description FROM products JOIN categories USING (category_id);
        SELECT product_name, bm25(product_fts) AS rank
        FROM product_fts WHERE product_fts MATCH 'wireless OR dock' ORDER BY rank;
        ~~~

        ~~~sql-static
        -- PostgreSQL
        ALTER TABLE products ADD COLUMN search tsvector
          GENERATED ALWAYS AS (to_tsvector('english', product_name)) STORED;
        CREATE INDEX ix_products_search ON products USING GIN (search);
        SELECT product_name, ts_rank(search, query) AS rank
        FROM products, to_tsquery('english', 'wireless | dock') AS query
        WHERE search @@ query ORDER BY rank DESC;
        ~~~

        ## Fuzzy matching
        Typo tolerance needs a distance measure: \`pg_trgm\`'s similarity, \`levenshtein\`,
        \`soundex\`/\`metaphone\` for names, or an external search engine. SQLite's \`editdist3\` ships with
        the spellfix extension.

        ## When to leave the database
        If search is a core product feature — faceting, multi-language analysis, typo tolerance,
        relevance tuning, large corpora — a dedicated engine (Elasticsearch, OpenSearch, Typesense,
        Meilisearch) is the right tool, with the database remaining the system of record.

        :::tip Order of attack
        Normalise first, index the prefix case, add full-text when users actually search mid-word, and
        only then consider an external engine. Most teams skip straight to step four and regret the
        synchronisation work.
        :::
      `,
      exercises: [
        {
          prompt: 'Build a simple scored search for the term `dock` over `products`: return `product_name` and `score` (100 for an exact case-insensitive match, 50 for a prefix match, 20 for a substring match), only for products that match at all, ordered by `score` descending then `product_name`.',
          starter: '',
          solution: "SELECT product_name,\n       CASE WHEN lower(product_name) = 'dock' THEN 100\n            WHEN lower(product_name) LIKE 'dock%' THEN 50\n            ELSE 20 END AS score\nFROM products\nWHERE lower(product_name) LIKE '%dock%'\nORDER BY score DESC, product_name;",
          orderMatters: true,
          hints: ['The WHERE clause restricts to substring matches; the CASE assigns the better scores.', 'Branch order matters — exact first.'],
          explain: 'Relevance ranking does not require a search engine; it requires deciding what "better match" means.'
        },
        {
          prompt: 'Find customers whose company name contains `works` in any case, returning `company_name` and `country`, ordered by `company_name`.',
          starter: '',
          solution: "SELECT company_name, country FROM customers WHERE lower(company_name) LIKE '%works%' ORDER BY company_name;",
          orderMatters: true,
          hints: ['Normalise the column with `lower()` and use a substring pattern.'],
          explain: 'Note that this cannot use an index — on a large table it is the moment to reach for a full-text or trigram index.'
        }
      ],
      quiz: [
        {
          q: 'A full-text index differs from a B-tree index because it:',
          options: ['Is faster for every query', 'Indexes individual tokens (words), so mid-text matches and ranking are possible', 'Stores the table twice'],
          answer: 1,
          explain: 'Tokenisation is what makes word-level matching, stemming and relevance scoring possible.'
        }
      ]
    },

    {
      id: 'gaps-and-islands',
      title: 'Gaps and islands',
      lede: 'Finding consecutive runs and the holes between them — streaks, sessions, uptime, missing invoice numbers.',
      body: `
        ## The problem
        Given dated or numbered rows per entity, find the **islands** (consecutive runs) and the
        **gaps** between them. It shows up as login streaks, subscription periods, machine uptime,
        missing sequence numbers, and "how many consecutive days did sales grow?".

        The \`logins\` table holds one row per customer per day they logged in, with deliberate gaps:

        ~~~sql
        SELECT customer_id, login_date FROM logins WHERE customer_id = 1 ORDER BY login_date LIMIT 12;
        ~~~

        ## The classic trick: date minus row number
        Within a consecutive run, \`date − row_number()\` is **constant**. That constant becomes the
        group key:

        ~~~sql
        SELECT customer_id, login_date,
               ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) AS rn,
               date(login_date, '-' || ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) || ' days') AS grp
        FROM logins
        WHERE customer_id = 1
        ORDER BY login_date
        LIMIT 12;
        ~~~

        Group by that key to collapse each run into one row:

        ~~~sql
        WITH marked AS (
          SELECT customer_id, login_date,
                 date(login_date, '-' || ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) || ' days') AS grp
          FROM logins
        )
        SELECT customer_id,
               min(login_date) AS streak_start,
               max(login_date) AS streak_end,
               count(*)        AS days
        FROM marked
        WHERE customer_id = 1
        GROUP BY customer_id, grp
        ORDER BY streak_start;
        ~~~

        For integer sequences it is even simpler: \`value - ROW_NUMBER()\`.

        ## The general trick: flag, then cumulative sum
        When "consecutive" means something other than +1 day — a session gap of 30 minutes, or a tolerance
        of one missing day — compare with \`LAG\` and number the groups with a running sum of the flags:

        ~~~sql
        WITH flagged AS (
          SELECT customer_id, login_date,
                 CASE WHEN julianday(login_date)
                           - julianday(LAG(login_date) OVER (PARTITION BY customer_id ORDER BY login_date)) > 2
                       OR LAG(login_date) OVER (PARTITION BY customer_id ORDER BY login_date) IS NULL
                      THEN 1 ELSE 0 END AS is_new_run
          FROM logins
        ), grouped AS (
          SELECT customer_id, login_date,
                 sum(is_new_run) OVER (PARTITION BY customer_id ORDER BY login_date
                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS run_no
          FROM flagged
        )
        SELECT customer_id, run_no, min(login_date) AS run_start, max(login_date) AS run_end, count(*) AS days
        FROM grouped
        WHERE customer_id = 2
        GROUP BY customer_id, run_no
        ORDER BY run_start;
        ~~~

        This version generalises to any "same run if …" rule, which is why it is worth learning even
        though the row-number trick is shorter.

        ## Gaps
        The space between islands: take each row's date and the next row's date with \`LEAD\`, and keep
        the pairs that are more than one day apart.

        ~~~sql
        WITH steps AS (
          SELECT customer_id, login_date,
                 LEAD(login_date) OVER (PARTITION BY customer_id ORDER BY login_date) AS next_login
          FROM logins
        )
        SELECT customer_id,
               date(login_date, '+1 day') AS gap_start,
               date(next_login, '-1 day') AS gap_end,
               CAST(julianday(next_login) - julianday(login_date) - 1 AS INTEGER) AS missing_days
        FROM steps
        WHERE next_login IS NOT NULL
          AND julianday(next_login) - julianday(login_date) > 1
          AND customer_id = 1
        ORDER BY gap_start;
        ~~~

        ## Longest streak
        ~~~sql
        WITH marked AS (
          SELECT customer_id, login_date,
                 date(login_date, '-' || ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) || ' days') AS grp
          FROM logins
        ), runs AS (
          SELECT customer_id, count(*) AS days FROM marked GROUP BY customer_id, grp
        )
        SELECT customer_id, max(days) AS longest_streak
        FROM runs GROUP BY customer_id ORDER BY longest_streak DESC, customer_id LIMIT 8;
        ~~~
      `,
      exercises: [
        {
          prompt: 'For customer 3, list their login streaks: `streak_start`, `streak_end` and `days`, ordered by `streak_start`. Use the date-minus-row-number technique.',
          starter: 'WITH marked AS (\n  \n)\nSELECT ',
          solution: "WITH marked AS (\n  SELECT customer_id, login_date,\n         date(login_date, '-' || ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) || ' days') AS grp\n  FROM logins\n)\nSELECT min(login_date) AS streak_start, max(login_date) AS streak_end, count(*) AS days\nFROM marked\nWHERE customer_id = 3\nGROUP BY grp\nORDER BY streak_start;",
          orderMatters: true,
          requireSql: [{ pattern: 'row_number', msg: 'Use `ROW_NUMBER()` to build the group key.' }],
          hints: ['Subtract the row number (in days) from the date to get a constant per run.', 'Then GROUP BY that constant.'],
          explain: 'The constant-difference trick is the shortest correct solution to a problem that looks like it needs procedural code.'
        },
        {
          prompt: 'Find the longest login streak per customer: `customer_id` and `longest_streak` (days), longest first, ties by `customer_id`. Limit to the top 5.',
          starter: '',
          solution: "WITH marked AS (\n  SELECT customer_id, login_date,\n         date(login_date, '-' || ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date) || ' days') AS grp\n  FROM logins\n), runs AS (\n  SELECT customer_id, count(*) AS days FROM marked GROUP BY customer_id, grp\n)\nSELECT customer_id, max(days) AS longest_streak\nFROM runs\nGROUP BY customer_id\nORDER BY longest_streak DESC, customer_id\nLIMIT 5;",
          orderMatters: true,
          hints: ['Three steps: mark the runs, count each run, then take the max per customer.'],
          explain: 'Each CTE changes the grain: per login, per run, per customer.'
        },
        {
          prompt: 'For customer 5, list the gaps between logins: `gap_start`, `gap_end` and `missing_days`, for every gap of at least one missing day, ordered by `gap_start`. Use `LEAD`.',
          starter: '',
          solution: "WITH steps AS (\n  SELECT customer_id, login_date,\n         LEAD(login_date) OVER (PARTITION BY customer_id ORDER BY login_date) AS next_login\n  FROM logins\n)\nSELECT date(login_date, '+1 day') AS gap_start,\n       date(next_login, '-1 day') AS gap_end,\n       CAST(julianday(next_login) - julianday(login_date) - 1 AS INTEGER) AS missing_days\nFROM steps\nWHERE customer_id = 5\n  AND next_login IS NOT NULL\n  AND julianday(next_login) - julianday(login_date) > 1\nORDER BY gap_start;",
          orderMatters: true,
          requireSql: [{ pattern: 'lead\\s*\\(', msg: 'Use `LEAD()` to look at the next login.' }],
          hints: ['The gap runs from the day after a login to the day before the next one.'],
          explain: 'Islands and gaps are two readings of the same LAG/LEAD comparison.'
        }
      ]
    },

    {
      id: 'time-series',
      title: 'Time series: spines, buckets and comparisons',
      lede: 'Reports over time: no missing periods, correct period-over-period maths, and cumulative measures.',
      body: `
        ## Always start from a spine
        \`GROUP BY month\` can only produce months that have data. A date spine (module 05) guarantees
        every period appears:

        ~~~sql
        WITH RECURSIVE months(m) AS (
          SELECT '2025-01'
          UNION ALL
          SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM months WHERE m < '2025-10'
        )
        SELECT months.m AS month,
               count(o.order_id) AS orders,
               round(COALESCE(sum(o.freight), 0), 2) AS freight
        FROM months
        LEFT JOIN orders o ON strftime('%Y-%m', o.order_date) = months.m
        GROUP BY months.m
        ORDER BY months.m;
        ~~~

        ## Bucketing
        | Bucket | SQLite expression |
        | --- | --- |
        | day | \`date(ts)\` |
        | week (Monday) | \`date(ts, 'weekday 0', '-6 days')\` |
        | month | \`strftime('%Y-%m', ts)\` or \`date(ts, 'start of month')\` |
        | quarter | \`strftime('%Y', ts) || '-Q' || ((CAST(strftime('%m', ts) AS INTEGER) + 2) / 3)\` |
        | arbitrary minutes | \`datetime((julianday(ts) * 1440 / 15) / (1440.0 / 15) ...)\` — easier with epoch maths |

        ~~~sql
        SELECT strftime('%Y', order_date) || '-Q' ||
               ((CAST(strftime('%m', order_date) AS INTEGER) + 2) / 3) AS quarter,
               count(*) AS orders,
               round(sum(freight), 2) AS freight
        FROM orders
        GROUP BY quarter
        ORDER BY quarter;
        ~~~

        Elsewhere: \`date_trunc('quarter', ts)\` (PostgreSQL), \`DATETRUNC\` (SQL Server 2022+),
        \`TRUNC(ts, 'Q')\` (Oracle), \`DATE_FORMAT\` (MySQL).

        ## Period over period
        \`LAG\` for the previous period, and an offset \`LAG(x, 12)\` for year-over-year:

        ~~~sql
        WITH monthly AS (
          SELECT strftime('%Y-%m', order_date) AS month,
                 count(*) AS orders,
                 round(sum(freight), 2) AS freight
          FROM orders GROUP BY month
        )
        SELECT month, orders,
               LAG(orders) OVER (ORDER BY month) AS prev_month,
               round(100.0 * (orders - LAG(orders) OVER (ORDER BY month))
                     / NULLIF(LAG(orders) OVER (ORDER BY month), 0), 1) AS mom_pct,
               LAG(orders, 12) OVER (ORDER BY month) AS same_month_last_year
        FROM monthly
        ORDER BY month;
        ~~~

        The \`NULLIF\` guard matters: a zero previous period would otherwise divide by zero (or return
        NULL silently, depending on the engine).

        **Only correct on a gap-free series.** \`LAG\` reaches the previous *row*, not the previous
        *month* — which is the second reason to build the spine first.

        ## Cumulative and rolling measures
        ~~~sql
        WITH monthly AS (
          SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders
          FROM orders GROUP BY month
        )
        SELECT month, orders,
               sum(orders) OVER (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative,
               round(avg(orders) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 1) AS rolling_3m
        FROM monthly
        ORDER BY month;
        ~~~

        ## Year-to-date and partial-period traps
        - **YTD** is a running total partitioned by year:
          \`sum(x) OVER (PARTITION BY year ORDER BY month ...)\`.
        - The **current period is incomplete**. Comparing a half-finished month with a full one always
          shows a fictional collapse — compare like with like
          (first 15 days vs first 15 days), or exclude the current period.
        - **Time zones** shift bucket boundaries; aggregate in the zone the report is read in.

        ~~~sql
        WITH monthly AS (
          SELECT strftime('%Y', order_date) AS yr,
                 strftime('%Y-%m', order_date) AS month,
                 count(*) AS orders
          FROM orders GROUP BY month
        )
        SELECT month, orders,
               sum(orders) OVER (PARTITION BY yr ORDER BY month
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ytd_orders
        FROM monthly
        ORDER BY month;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Build a gap-free monthly report for 2025 up to and including `2025-10`: `month`, `orders` (0 where none) and `revenue` (rounded to 2, 0 where none) from non-cancelled orders. Use a recursive month spine and a LEFT JOIN. Order by month.',
          starter: '',
          solution: "WITH RECURSIVE months(m) AS (\n  SELECT '2025-01'\n  UNION ALL\n  SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM months WHERE m < '2025-10'\n),\nlines AS (\n  SELECT strftime('%Y-%m', o.order_date) AS m,\n         i.unit_price * i.quantity * (1 - i.discount) AS line_total,\n         o.order_id\n  FROM orders o JOIN order_items i ON i.order_id = o.order_id\n  WHERE o.status <> 'cancelled'\n)\nSELECT months.m AS month,\n       count(DISTINCT lines.order_id) AS orders,\n       round(COALESCE(sum(lines.line_total), 0), 2) AS revenue\nFROM months LEFT JOIN lines ON lines.m = months.m\nGROUP BY months.m\nORDER BY months.m;",
          orderMatters: true,
          requireSql: [{ pattern: 'recursive', msg: 'Generate the months with a recursive CTE so empty months still appear.' }],
          hints: ['Spine of months, then LEFT JOIN the order lines bucketed by month.', '`count(DISTINCT order_id)` because joining lines multiplies rows.'],
          explain: 'The spine is what makes the series safe for LAG-based comparisons later.'
        },
        {
          prompt: 'From monthly order counts (plain `GROUP BY`, no spine needed), return `month`, `orders`, `prev_month` and `mom_pct` — month-over-month change in percent, rounded to 1, guarded against division by zero. Order by month.',
          starter: '',
          solution: "WITH monthly AS (\n  SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders\n  FROM orders GROUP BY month\n)\nSELECT month, orders,\n       LAG(orders) OVER (ORDER BY month) AS prev_month,\n       round(100.0 * (orders - LAG(orders) OVER (ORDER BY month))\n             / NULLIF(LAG(orders) OVER (ORDER BY month), 0), 1) AS mom_pct\nFROM monthly\nORDER BY month;",
          orderMatters: true,
          hints: ['`LAG(orders) OVER (ORDER BY month)` three times, or a second CTE to name it once.', 'Wrap the denominator in `NULLIF(..., 0)`.'],
          explain: 'The first month has no previous value, so both derived columns are NULL — correct, and worth showing rather than hiding as 0.'
        },
        {
          prompt: 'Return `month`, `orders` and `ytd_orders` — the running total of orders within each calendar year — ordered by month.',
          starter: '',
          solution: "WITH monthly AS (\n  SELECT strftime('%Y', order_date) AS yr,\n         strftime('%Y-%m', order_date) AS month,\n         count(*) AS orders\n  FROM orders GROUP BY month\n)\nSELECT month, orders,\n       sum(orders) OVER (PARTITION BY yr ORDER BY month\n                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS ytd_orders\nFROM monthly\nORDER BY month;",
          orderMatters: true,
          hints: ['Partition the running sum by year so it restarts each January.'],
          explain: 'YTD is just a partitioned running total — the partition key is what makes it reset.'
        }
      ]
    },

    {
      id: 'cohorts',
      title: 'Cohort and retention analysis',
      lede: 'Grouping customers by when they arrived, then measuring what they did afterwards.',
      body: `
        ## The shape of the question
        "Of the customers who first ordered in month X, how many ordered again in month X+1, X+2, …?"
        Three steps, one CTE each:

        1. **Cohort assignment** — each customer's first-order month.
        2. **Activity** — the months in which each customer was active.
        3. **Offset** — the distance in months between activity and cohort, counted and pivoted.

        ~~~sql
        WITH first_order AS (
          SELECT customer_id, min(order_date) AS first_date
          FROM orders GROUP BY customer_id
        ),
        cohorts AS (
          SELECT customer_id, strftime('%Y-%m', first_date) AS cohort_month FROM first_order
        ),
        activity AS (
          SELECT DISTINCT o.customer_id, strftime('%Y-%m', o.order_date) AS active_month
          FROM orders o
        )
        SELECT c.cohort_month,
               count(DISTINCT c.customer_id) AS cohort_size
        FROM cohorts c
        GROUP BY c.cohort_month
        ORDER BY c.cohort_month;
        ~~~

        ## Months since the cohort started
        Computing a month difference portably means turning \`YYYY-MM\` into a month number:

        ~~~sql
        WITH first_order AS (
          SELECT customer_id, min(order_date) AS first_date FROM orders GROUP BY customer_id
        ),
        base AS (
          SELECT o.customer_id,
                 strftime('%Y-%m', f.first_date) AS cohort_month,
                 (CAST(strftime('%Y', o.order_date) AS INTEGER) * 12 + CAST(strftime('%m', o.order_date) AS INTEGER))
                 - (CAST(strftime('%Y', f.first_date) AS INTEGER) * 12 + CAST(strftime('%m', f.first_date) AS INTEGER)) AS month_offset
          FROM orders o JOIN first_order f ON f.customer_id = o.customer_id
        )
        SELECT cohort_month, month_offset, count(DISTINCT customer_id) AS active_customers
        FROM base
        WHERE month_offset <= 3
        GROUP BY cohort_month, month_offset
        ORDER BY cohort_month, month_offset;
        ~~~

        ## The retention triangle
        Pivot the offsets into columns and divide by the cohort size:

        ~~~sql
        WITH first_order AS (
          SELECT customer_id, min(order_date) AS first_date FROM orders GROUP BY customer_id
        ),
        base AS (
          SELECT o.customer_id,
                 strftime('%Y-%m', f.first_date) AS cohort_month,
                 (CAST(strftime('%Y', o.order_date) AS INTEGER) * 12 + CAST(strftime('%m', o.order_date) AS INTEGER))
                 - (CAST(strftime('%Y', f.first_date) AS INTEGER) * 12 + CAST(strftime('%m', f.first_date) AS INTEGER)) AS month_offset
          FROM orders o JOIN first_order f ON f.customer_id = o.customer_id
        ),
        sized AS (
          SELECT cohort_month, count(DISTINCT customer_id) AS cohort_size
          FROM base WHERE month_offset = 0 GROUP BY cohort_month
        )
        SELECT s.cohort_month, s.cohort_size,
               round(100.0 * count(DISTINCT CASE WHEN b.month_offset = 1 THEN b.customer_id END) / s.cohort_size, 0) AS m1_pct,
               round(100.0 * count(DISTINCT CASE WHEN b.month_offset = 2 THEN b.customer_id END) / s.cohort_size, 0) AS m2_pct,
               round(100.0 * count(DISTINCT CASE WHEN b.month_offset = 3 THEN b.customer_id END) / s.cohort_size, 0) AS m3_pct
        FROM sized s JOIN base b ON b.cohort_month = s.cohort_month
        GROUP BY s.cohort_month, s.cohort_size
        ORDER BY s.cohort_month;
        ~~~

        That is a retention curve per cohort — the standard way to see whether a product is getting
        better or worse over time, because each cohort is measured from its own starting point.

        ## Related measures from the same shape
        - **Revenue cohorts** — replace \`count(DISTINCT customer_id)\` with \`sum(net_amount)\`.
        - **Churn** — customers active in month *n* but not in *n+1* (an anti-join, module 05).
        - **Reactivation** — active again after a gap (gaps and islands, earlier in this module).
        - **Time to second order** — \`LEAD\` over each customer's ordered orders (module 08).

        ~~~sql
        WITH seq AS (
          SELECT customer_id, order_date,
                 ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, order_id) AS n
          FROM orders
        )
        SELECT round(avg(julianday(second.order_date) - julianday(first.order_date)), 1) AS avg_days_to_second_order
        FROM seq first
        JOIN seq second ON second.customer_id = first.customer_id AND second.n = 2
        WHERE first.n = 1;
        ~~~

        :::warn Incomplete cohorts
        The newest cohort has not had time to come back, so its retention looks terrible. Either exclude
        cohorts younger than your longest offset, or draw the triangle so the missing cells are visibly
        empty rather than zero.
        :::
      `,
      exercises: [
        {
          prompt: 'Assign each customer to a cohort by the month of their first order, and return `cohort_month` and `cohort_size` (customers in that cohort), ordered by `cohort_month`.',
          starter: '',
          solution: "WITH first_order AS (\n  SELECT customer_id, min(order_date) AS first_date FROM orders GROUP BY customer_id\n)\nSELECT strftime('%Y-%m', first_date) AS cohort_month, count(*) AS cohort_size\nFROM first_order\nGROUP BY cohort_month\nORDER BY cohort_month;",
          orderMatters: true,
          hints: ['`min(order_date)` per customer gives the first order.', 'Then group those customers by the month of that date.'],
          explain: 'Cohort assignment is always this: one row per entity, holding the period it entered.'
        },
        {
          prompt: 'Return `cohort_month`, `month_offset` (0, 1, 2 or 3 months after the cohort start) and `active_customers` (distinct customers ordering in that offset month), ordered by `cohort_month`, `month_offset`.',
          starter: '',
          solution: "WITH first_order AS (\n  SELECT customer_id, min(order_date) AS first_date FROM orders GROUP BY customer_id\n),\nbase AS (\n  SELECT o.customer_id,\n         strftime('%Y-%m', f.first_date) AS cohort_month,\n         (CAST(strftime('%Y', o.order_date) AS INTEGER) * 12 + CAST(strftime('%m', o.order_date) AS INTEGER))\n         - (CAST(strftime('%Y', f.first_date) AS INTEGER) * 12 + CAST(strftime('%m', f.first_date) AS INTEGER)) AS month_offset\n  FROM orders o JOIN first_order f ON f.customer_id = o.customer_id\n)\nSELECT cohort_month, month_offset, count(DISTINCT customer_id) AS active_customers\nFROM base\nWHERE month_offset <= 3\nGROUP BY cohort_month, month_offset\nORDER BY cohort_month, month_offset;",
          orderMatters: true,
          hints: ['Convert each date to a month number: `year * 12 + month`, then subtract.', '`count(DISTINCT customer_id)` because a customer may order many times in a month.'],
          explain: 'Month arithmetic via `year * 12 + month` is the portable way to count months between two dates.'
        },
        {
          prompt: 'Compute the average number of days between a customer’s first and second order as `avg_days_to_second_order`, rounded to 1. Use `ROW_NUMBER()` to identify the first and second orders.',
          starter: '',
          solution: 'WITH seq AS (\n  SELECT customer_id, order_date,\n         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date, order_id) AS n\n  FROM orders\n)\nSELECT round(avg(julianday(b.order_date) - julianday(a.order_date)), 1) AS avg_days_to_second_order\nFROM seq a\nJOIN seq b ON b.customer_id = a.customer_id AND b.n = 2\nWHERE a.n = 1;',
          hints: ['Number each customer’s orders, then self-join rows 1 and 2.'],
          explain: 'Time-to-next-event: number the events, then join or LAG. Both are one pass over an indexed ordering.'
        }
      ]
    },

    {
      id: 'portability',
      title: 'Writing portable SQL',
      lede: 'What is safe to assume, what to avoid, and how to isolate the dialect-specific parts.',
      body: `
        ## The portable core
        You can rely on these almost everywhere in current versions:

        \`SELECT\`/\`FROM\`/\`WHERE\`/\`GROUP BY\`/\`HAVING\`/\`ORDER BY\`, all join types,
        \`UNION\`/\`INTERSECT\`/\`EXCEPT\`, subqueries, \`EXISTS\`, \`CASE\`, \`COALESCE\`/\`NULLIF\`,
        \`CAST\`, aggregate functions, \`WITH\` and \`WITH RECURSIVE\`, window functions, \`UPSERT\`
        in some form, transactions and savepoints.

        ## The usual divergences
        | Need | Portable choice |
        | --- | --- |
        | concatenation | \`CONCAT(a, b)\` (or \`||\` outside MySQL) |
        | limit | \`LIMIT n\` (MySQL/PostgreSQL/SQLite) vs \`FETCH FIRST n ROWS ONLY\` (standard) |
        | current time | \`CURRENT_TIMESTAMP\` |
        | date arithmetic | **nothing is portable** — isolate it |
        | string length | \`length()\` (\`LEN\` in SQL Server) |
        | substring | \`substring(s FROM a FOR b)\` is the standard form |
        | null default | \`COALESCE\` (never \`ISNULL\`/\`NVL\`/\`IFNULL\`) |
        | boolean | an integer 0/1 column with a CHECK |
        | identity column | declare per engine; keep the column name the same |
        | quoting identifiers | double quotes (\`"col"\`); SQL Server \`[col]\`, MySQL backticks |
        | \`NULLS FIRST/LAST\` | emulate with \`ORDER BY (col IS NULL), col\` |
        | string aggregation | \`string_agg\` / \`GROUP_CONCAT\` / \`STRING_AGG\` / \`LISTAGG\` — all differ |

        ## Semantics that differ silently
        These are worse than syntax errors, because the query runs and gives a different answer:

        - **Division by zero** — error in PostgreSQL/Oracle/SQL Server, \`NULL\` in SQLite/MySQL.
        - **Integer division** — \`5/2\` is 2 in PostgreSQL/SQL Server/Oracle/SQLite, 2.5 in MySQL.
        - **\`NULL\` ordering** — differs; always be explicit.
        - **\`LIKE\` case sensitivity** — collation-dependent.
        - **Empty string vs NULL** — Oracle treats \`''\` as \`NULL\`; nobody else does.
        - **\`GROUP BY\` strictness** — SQLite and lenient MySQL allow bare columns; others reject.
        - **Identifier case folding** — unquoted names fold to lower case in PostgreSQL, upper case in
          Oracle, and are case-preserving in MySQL on Linux (but not macOS).
        - **Default isolation level** (module 11).
        - **String comparison padding** — \`CHAR\` columns pad, \`VARCHAR\` does not.

        ## Practical strategy
        1. **Target one engine properly.** True cross-engine SQL is a real cost; pay it only if you ship
           software that must run on several.
        2. **Isolate the dialect.** Keep date maths, pagination and upserts behind views, functions or a
           thin data-access layer, so a port touches a handful of places.
        3. **Let a query builder handle the trivia** (quoting, limits, parameter placeholders), but keep
           complex analytical SQL hand-written and reviewed.
        4. **Test on the real engine.** An ORM that "abstracts the database" still generates dialect SQL,
           and the differences above will find you.
        5. **Prefer standard spellings** when they cost nothing: \`CAST\`, \`COALESCE\`, \`CURRENT_TIMESTAMP\`,
           \`substring(... FROM ... FOR ...)\`, \`FETCH FIRST\`.

        ## Feature availability, roughly
        | Feature | SQLite | PostgreSQL | MySQL | SQL Server | Oracle |
        | --- | --- | --- | --- | --- | --- |
        | Window functions | 3.25+ | yes | 8.0+ | 2005/2012+ | yes |
        | CTEs / recursive | 3.8.3+ | yes | 8.0+ | yes | yes |
        | \`FILTER (WHERE)\` | yes | yes | no | no | no |
        | \`GROUPING SETS\`/\`CUBE\` | no | yes | ROLLUP only | yes | yes |
        | \`FULL OUTER JOIN\` | 3.39+ | yes | no | yes | yes |
        | \`LATERAL\`/\`APPLY\` | no | yes | 8.0.14+ | yes | yes |
        | \`MERGE\` | no (upsert) | 15+ | no (upsert) | yes | yes |
        | \`RETURNING\`/\`OUTPUT\` | 3.35+ | yes | no | yes | yes |
        | JSON functions | yes | yes | yes | yes | yes |
        | Generated columns | 3.31+ | 12+ | 5.7+ | yes | yes |
        | Partial indexes | yes | yes | no | yes | no |
        | Stored procedures | no | yes | yes | yes | yes |
        | Row level security | no | yes | no | yes | yes |

        :::tip
        The [Reference](#/reference) section of this course collects the per-engine spellings of the
        things you will look up most often.
        :::
      `,
      quiz: [
        {
          q: 'Which expression is the most portable way to supply a default for NULL?',
          options: ['IFNULL(x, 0)', 'COALESCE(x, 0)', 'NVL(x, 0)'],
          answer: 1,
          explain: 'COALESCE is standard and present everywhere; the others are engine-specific.'
        },
        {
          q: 'SELECT 5/2 returns 2.5 on which engine?',
          options: ['PostgreSQL', 'MySQL', 'SQL Server'],
          answer: 1,
          explain: 'MySQL promotes integer division to decimal; the others truncate. A silent semantic difference.'
        },
        {
          q: 'The best way to keep date arithmetic portable is:',
          options: ['Use CAST everywhere', 'Isolate it behind a view or data-access layer', 'Store dates as text'],
          answer: 1,
          explain: 'Nothing about date arithmetic is portable, so the only real strategy is to confine it to few places.'
        }
      ]
    }
  ]
});
