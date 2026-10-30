window.REFERENCE = [

  {
    id: 'skeleton',
    title: 'Statement skeletons',
    body: `
      ## SELECT
      ~~~sql-static
      WITH [RECURSIVE] cte_name (cols) AS ( ... )        -- named subqueries
      SELECT [DISTINCT] expressions AS alias
      FROM     table [alias]
        [INNER | LEFT | RIGHT | FULL | CROSS] JOIN other ON condition | USING (col)
      WHERE    row predicate
      GROUP BY keys
      HAVING   group predicate
      WINDOW   w AS (PARTITION BY ... ORDER BY ... frame)
      ORDER BY keys [ASC|DESC] [NULLS FIRST|LAST]
      LIMIT n OFFSET m;
      ~~~

      Evaluation order: \`FROM\` → \`WHERE\` → \`GROUP BY\` → aggregates → \`HAVING\` → \`SELECT\`
      (and window functions) → \`DISTINCT\` → \`ORDER BY\` → \`LIMIT\`.

      ## Writes
      ~~~sql-static
      INSERT INTO t (cols) VALUES (...), (...);
      INSERT INTO t (cols) SELECT ... ;
      INSERT INTO t (cols) VALUES (...)
        ON CONFLICT (key_cols) DO UPDATE SET c = excluded.c [WHERE ...]
        RETURNING cols;

      UPDATE t SET c1 = expr, c2 = expr WHERE predicate RETURNING cols;
      DELETE FROM t WHERE predicate RETURNING cols;
      ~~~

      ## Definitions
      ~~~sql-static
      CREATE TABLE t (
        id       INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE,
        code     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        amount   NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
        total    NUMERIC GENERATED ALWAYS AS (amount * 1.19) STORED,
        created_at TEXT  NOT NULL DEFAULT (datetime('now')),
        UNIQUE (parent_id, code),
        CHECK (amount < 1000000)
      );

      ALTER TABLE t ADD COLUMN note TEXT;
      ALTER TABLE t RENAME COLUMN note TO comment;
      CREATE [UNIQUE] INDEX ix_t_parent ON t (parent_id, created_at) [WHERE predicate];
      CREATE VIEW v AS SELECT ... ;
      CREATE TRIGGER trg AFTER UPDATE OF col ON t FOR EACH ROW WHEN cond BEGIN ... END;
      DROP TABLE | VIEW | INDEX | TRIGGER [IF EXISTS] name;
      ~~~

      ## Transactions
      ~~~sql-static
      BEGIN;  SAVEPOINT sp;  ROLLBACK TO sp;  RELEASE sp;  COMMIT;  ROLLBACK;
      ~~~
    `
  },

  {
    id: 'functions',
    title: 'Functions by task',
    body: `
      ## Null handling
      | Need | Portable | Engine-specific |
      | --- | --- | --- |
      | default for NULL | \`COALESCE(a, b, ...)\` | \`IFNULL\`, \`NVL\`, \`ISNULL\` |
      | NULL when equal | \`NULLIF(a, b)\` | |
      | null test | \`IS [NOT] NULL\` | |
      | null-safe equals | \`IS NOT DISTINCT FROM\` | \`<=>\` (MySQL), \`IS\` (SQLite) |

      ## Numbers
      \`abs\`, \`round(x[, n])\`, \`ceil\`/\`ceiling\`, \`floor\`, \`sign\`, \`power(x,y)\`, \`sqrt\`,
      \`exp\`, \`ln\`, \`log\`, \`mod(a,b)\` or \`a % b\`, \`random()\`.
      Guard division: \`a / NULLIF(b, 0)\`. Force decimals: \`1.0 * a / b\` or \`CAST(a AS REAL)\`.

      ## Text
      | Need | SQLite / portable | Elsewhere |
      | --- | --- | --- |
      | concat | \`a || b\`, \`concat(a,b)\` | \`+\` (SQL Server) |
      | length | \`length(s)\` | \`LEN\` (SQL Server) |
      | slice | \`substr(s, start, len)\` | \`SUBSTRING(s FROM a FOR b)\` |
      | find | \`instr(s, sub)\` | \`position\`, \`charindex\`, \`locate\` |
      | trim | \`trim\`, \`ltrim\`, \`rtrim\`, \`trim(s, chars)\` | |
      | replace | \`replace(s, from, to)\` | |
      | case | \`upper\`, \`lower\` | \`initcap\` (PostgreSQL, Oracle) |
      | pad | \`printf('%-10s', s)\` | \`lpad\`, \`rpad\` |
      | format | \`printf\`, \`format\` | \`to_char\`, \`FORMAT\` |
      | split | — | \`split_part\`, \`SUBSTRING_INDEX\`, \`STRING_SPLIT\` |

      ## Dates
      | Need | SQLite | PostgreSQL | MySQL | SQL Server |
      | --- | --- | --- | --- | --- |
      | now | \`datetime('now')\` | \`now()\` | \`NOW()\` | \`SYSDATETIME()\` |
      | today | \`date('now')\` | \`current_date\` | \`CURDATE()\` | \`CAST(GETDATE() AS date)\` |
      | add days | \`date(d,'+7 days')\` | \`d + interval '7 days'\` | \`DATE_ADD(d, INTERVAL 7 DAY)\` | \`DATEADD(day,7,d)\` |
      | diff days | \`julianday(a)-julianday(b)\` | \`a - b\` | \`DATEDIFF(a,b)\` | \`DATEDIFF(day,b,a)\` |
      | part | \`strftime('%Y', d)\` | \`extract(year from d)\` | \`YEAR(d)\` | \`DATEPART(year,d)\` |
      | truncate | \`date(d,'start of month')\` | \`date_trunc('month',d)\` | \`DATE_FORMAT(d,'%Y-%m-01')\` | \`DATETRUNC(month,d)\` |

      \`strftime\` codes: \`%Y %m %d %H %M %S %j %W %w %s\`.

      ## Aggregates
      \`count(*)\`, \`count(col)\`, \`count(DISTINCT col)\`, \`sum\`, \`avg\`, \`min\`, \`max\`,
      \`group_concat(x, sep)\` / \`string_agg\` / \`STRING_AGG\` / \`LISTAGG\`,
      \`total(x)\` (SQLite: sum that returns 0).
      Conditional: \`sum(CASE WHEN c THEN 1 ELSE 0 END)\` or \`count(*) FILTER (WHERE c)\`.

      ## Window functions
      \`ROW_NUMBER\`, \`RANK\`, \`DENSE_RANK\`, \`NTILE(n)\`, \`PERCENT_RANK\`, \`CUME_DIST\`,
      \`LAG(x, n, default)\`, \`LEAD\`, \`FIRST_VALUE\`, \`LAST_VALUE\`, \`NTH_VALUE\`,
      plus any aggregate with \`OVER\`.

      ~~~sql-static
      func() OVER (PARTITION BY ... ORDER BY ...
                   ROWS | RANGE | GROUPS BETWEEN x PRECEDING AND y FOLLOWING)
      ~~~
      Default frame with \`ORDER BY\`: \`RANGE UNBOUNDED PRECEDING AND CURRENT ROW\`.

      ## JSON (SQLite spelling)
      \`json_extract(doc, '$.a.b[0]')\`, \`doc -> '$.a'\`, \`doc ->> '$.a'\`, \`json_each(doc, path)\`,
      \`json_array\`, \`json_object\`, \`json_group_array\`, \`json_valid\`, \`json_type\`,
      \`json_array_length\`.
    `
  },

  {
    id: 'dialects',
    title: 'Dialect differences',
    body: `
      ## Feature availability
      | Feature | SQLite | PostgreSQL | MySQL | SQL Server | Oracle |
      | --- | --- | --- | --- | --- | --- |
      | Window functions | 3.25+ | yes | 8.0+ | 2005/2012+ | yes |
      | CTE / recursive | 3.8.3+ | yes | 8.0+ | yes | yes |
      | \`FILTER (WHERE)\` | yes | yes | no | no | no |
      | \`GROUPING SETS\` / \`CUBE\` | no | yes | \`WITH ROLLUP\` | yes | yes |
      | \`FULL OUTER JOIN\` | 3.39+ | yes | no | yes | yes |
      | \`LATERAL\` / \`APPLY\` | no | yes | 8.0.14+ | yes | yes |
      | \`MERGE\` | no (upsert) | 15+ | no (upsert) | yes | yes |
      | \`RETURNING\` / \`OUTPUT\` | 3.35+ | yes | no | yes | yes |
      | Generated columns | 3.31+ | 12+ | 5.7+ | yes | yes |
      | Partial / filtered index | yes | yes | no | yes | no |
      | Materialised views | no | yes | no | indexed views | yes |
      | Stored procedures | no | yes | yes | yes | yes |
      | Row level security | no | yes | no | yes | yes |
      | Strict typing | opt-in (\`STRICT\`) | yes | yes | yes | yes |

      ## Syntax map
      | Task | SQLite | PostgreSQL | MySQL | SQL Server | Oracle |
      | --- | --- | --- | --- | --- | --- |
      | limit | \`LIMIT n OFFSET m\` | same | same | \`OFFSET m ROWS FETCH NEXT n ROWS ONLY\` | \`FETCH FIRST n ROWS ONLY\` |
      | concat | \`||\` | \`||\` | \`CONCAT()\` | \`+\` | \`||\` |
      | cast | \`CAST(x AS INTEGER)\` | \`x::int\` | \`CAST(x AS SIGNED)\` | \`CONVERT(int, x)\` | \`CAST\` |
      | auto key | \`INTEGER PRIMARY KEY\` | \`GENERATED AS IDENTITY\` | \`AUTO_INCREMENT\` | \`IDENTITY(1,1)\` | \`GENERATED AS IDENTITY\` |
      | upsert | \`ON CONFLICT DO UPDATE\` | same | \`ON DUPLICATE KEY UPDATE\` | \`MERGE\` | \`MERGE\` |
      | quote identifier | \`"col"\` | \`"col"\` | \`` + '`col`' + `\` | \`[col]\` | \`"COL"\` |
      | last id | \`last_insert_rowid()\` | \`RETURNING id\` | \`LAST_INSERT_ID()\` | \`SCOPE_IDENTITY()\` | \`RETURNING INTO\` |
      | string agg | \`group_concat\` | \`string_agg\` | \`GROUP_CONCAT\` | \`STRING_AGG\` | \`LISTAGG\` |
      | regex | — | \`~\`, \`SIMILAR TO\` | \`REGEXP\` | — | \`REGEXP_LIKE\` |
      | explain | \`EXPLAIN QUERY PLAN\` | \`EXPLAIN (ANALYZE)\` | \`EXPLAIN ANALYZE\` | graphical plan | \`DBMS_XPLAN\` |

      ## Semantics that differ silently
      - **Integer division** — \`5/2\` is 2 everywhere except MySQL (2.5).
      - **Division by zero** — error (PostgreSQL, SQL Server, Oracle) vs NULL (SQLite, MySQL).
      - **NULL sort position** — explicit \`NULLS FIRST/LAST\` where supported;
        \`ORDER BY (col IS NULL), col\` elsewhere.
      - **\`LIKE\` case sensitivity** — depends on collation; PostgreSQL is case-sensitive, MySQL usually not.
      - **\`''\` vs NULL** — Oracle treats an empty string as NULL.
      - **Bare columns in \`GROUP BY\`** — allowed by SQLite and lenient MySQL, rejected elsewhere.
      - **Identifier case folding** — lower (PostgreSQL), upper (Oracle), platform-dependent (MySQL).
      - **Default isolation** — \`READ COMMITTED\` (PostgreSQL, SQL Server, Oracle),
        \`REPEATABLE READ\` (MySQL), serial writes (SQLite).
      - **Multiple NULLs in a UNIQUE column** — allowed everywhere except SQL Server.
    `
  },

  {
    id: 'database',
    title: 'The practice database',
    body: `
      ## Tables and relationships
      ~~~text
      departments ──┐
                    ├── employees ──┐ (manager_id → employees.emp_id)
                    │               │
      categories ─┐ │               ├── orders ──┬── order_items ── products
      suppliers ──┴─┴── products ───┘            ├── payments
                                                 │
                       customers ────────────────┘
                       customers ── logins
                       customers ── reviews ── products
                       products  ── product_specs      (JSON documents)
                       staging_customers               (messy import data)
      ~~~

      | Table | Grain | Notable columns |
      | --- | --- | --- |
      | \`departments\` | one department | \`budget\` |
      | \`employees\` | one person | \`manager_id\` (self reference, 5 levels), \`commission_pct\` (often NULL), \`dept_id\` (NULL for 2) |
      | \`categories\` | one product category | \`description\` (nullable) |
      | \`suppliers\` | one supplier | \`rating\` (nullable) |
      | \`products\` | one catalogue item | \`unit_price\`, \`units_in_stock\`, \`discontinued\` |
      | \`customers\` | one company | \`contact_name\`, \`credit_limit\` (both nullable), 20 countries |
      | \`orders\` | one order | \`status\` (4 values, CHECKed), \`ship_date\` NULL when unshipped |
      | \`order_items\` | one line per order | composite PK, stores the **sold** \`unit_price\` |
      | \`payments\` | one payment | several per order possible; some orders unpaid |
      | \`reviews\` | one review | \`rating\` 1–5, \`comment\` nullable |
      | \`logins\` | one customer-day | deliberate gaps, for gaps-and-islands |
      | \`staging_customers\` | one imported row | duplicates, mixed case, stray spaces |
      | \`product_specs\` | one product | \`specs\` JSON document |

      ## Deliberate quirks to practise on
      - 3 customers have **never ordered** (anti-joins).
      - 1 product has **never been ordered**; several have never been reviewed.
      - 32 orders have no \`ship_date\`; 68 have no payment.
      - 2 employees share a salary, twice over (RANK vs DENSE_RANK).
      - The CEO has no manager; 2 employees have no department (NULL grouping).
      - \`order_items.unit_price\` differs from \`products.unit_price\` for historical rows.

      ## Useful starting queries
      ~~~sql
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;
      ~~~

      ~~~sql
      SELECT sql FROM sqlite_master WHERE name = 'orders';
      ~~~

      ~~~sql
      SELECT (SELECT count(*) FROM orders)      AS orders,
             (SELECT count(*) FROM order_items) AS order_lines,
             (SELECT count(*) FROM customers)   AS customers,
             (SELECT count(*) FROM products)    AS products,
             (SELECT min(order_date) || ' .. ' || max(order_date) FROM orders) AS date_range;
      ~~~
    `
  },

  {
    id: 'errors',
    title: 'Common errors and fixes',
    body: `
      | Message | Cause | Fix |
      | --- | --- | --- |
      | \`no such column: x\` | typo, missing alias, or an output alias used in \`WHERE\` | qualify it, or repeat the expression (aliases exist only from \`SELECT\` onwards) |
      | \`ambiguous column name\` | two joined tables expose the same name | qualify with a table alias |
      | \`misuse of aggregate function\` | aggregate in \`WHERE\` | move it to \`HAVING\`, or wrap the query |
      | \`column must appear in the GROUP BY clause\` | ungrouped, unaggregated column | group it, aggregate it, or use a window function |
      | \`misuse of window function\` | window in \`WHERE\`/\`GROUP BY\`/\`HAVING\` | compute it in a subquery and filter outside |
      | \`UNIQUE constraint failed\` | duplicate key | upsert with \`ON CONFLICT\`, or deduplicate first |
      | \`FOREIGN KEY constraint failed\` | parent missing, or children exist | insert the parent first; choose a referential action |
      | \`NOT NULL constraint failed\` | required column omitted | supply it, or give the column a default |
      | \`CHECK constraint failed\` | value outside the declared domain | fix the value, or revisit the rule |
      | \`datatype mismatch\` | wrong type for a generated/strict column | \`CAST\` explicitly |
      | \`cannot start a transaction within a transaction\` | nested \`BEGIN\` | use \`SAVEPOINT\` |
      | \`database is locked\` (SQLite) | another writer | \`PRAGMA journal_mode=WAL\`, \`busy_timeout\`, shorter transactions |
      | \`1st ORDER BY term does not match any column\` | expression in a compound \`SELECT\`'s \`ORDER BY\` | wrap the \`UNION\` in a subquery and sort outside |
      | \`too many SQL variables\` | huge \`IN\` list of parameters | batch, or join against a temp table |
      | deadlock detected | two transactions locking in opposite order | lock in a consistent order; retry |

      ## Results are wrong but no error
      | Symptom | Likely cause |
      | --- | --- |
      | totals are an exact multiple of the truth | join fan-out (module 05) |
      | rows missing that should be there | inner join where an outer join was needed, or a \`WHERE\` on the optional side |
      | \`NOT IN\` returns nothing | NULL in the subquery (module 07) |
      | counts and its "negation" do not add up | NULLs dropped by both predicates (module 02) |
      | \`avg\` looks too high | NULLs excluded from the denominator |
      | percentages are all 0 | integer division — multiply by \`100.0\` |
      | \`LAST_VALUE\` returns the current row | default frame ends at the current row (module 08) |
      | pagination repeats or skips rows | non-unique \`ORDER BY\`, or \`OFFSET\` drift |
      | running total jumps too far | \`RANGE\` peers; add a unique tie-breaker or use \`ROWS\` |
      | "it worked yesterday" ordering changed | missing \`ORDER BY\` |
    `
  },

  {
    id: 'glossary',
    title: 'Glossary',
    body: `
      **ACID** — atomicity, consistency, isolation, durability: the guarantees of a transaction.

      **Aggregate** — a function reducing many rows to one value (\`sum\`, \`count\`).

      **Anti-join** — keep rows of A that have **no** match in B (\`NOT EXISTS\`, \`LEFT JOIN … IS NULL\`).

      **Cardinality** — the number of rows (an estimate, in a query plan).

      **Cartesian product** — every combination of two inputs; a \`CROSS JOIN\`, or a join with no condition.

      **Collation** — the rules for comparing and sorting text.

      **Correlated subquery** — a subquery referring to a column of the outer query.

      **Covering index** — an index containing every column a query needs, so the table is never read.

      **CTE** — common table expression; a named subquery introduced with \`WITH\`.

      **Degree / grain** — what one row of a result represents ("one row per order line").

      **Denormalisation** — deliberately storing redundant data to speed up reads.

      **Derived table** — a subquery in the \`FROM\` clause.

      **DDL / DML / DCL / TCL** — data definition / manipulation / control / transaction control statements.

      **Fan-out** — row multiplication caused by joining a one-to-many relationship.

      **Foreign key** — a column whose values must exist in another table's key.

      **Frame** — the subset of a window partition a window function sees.

      **Grain** — see *degree*. The single most useful word in reporting.

      **Idempotent** — safe to run more than once with the same result (an upsert-based load).

      **Index** — a sorted auxiliary structure for fast lookup, range scan and ordering.

      **Isolation level** — how much of other transactions' work your transaction can see.

      **Junction table** — a table resolving a many-to-many relationship.

      **MVCC** — multi-version concurrency control; readers see a snapshot instead of blocking.

      **Normalisation** — organising data so each fact is stored once (1NF–BCNF).

      **NULL** — the absence of a value; comparisons with it are *unknown*.

      **OLTP / OLAP** — transactional versus analytical workloads.

      **Predicate** — a boolean expression used to keep or discard rows.

      **Primary key** — the column(s) identifying a row: unique and not null.

      **Query plan** — the operator tree the optimiser chose to execute a statement.

      **SARGable** — a predicate an index can satisfy ("search-argument-able").

      **Scalar subquery** — a subquery returning exactly one row and one column.

      **Semi-join** — keep rows of A that have at least one match in B, without duplication (\`EXISTS\`).

      **Selectivity** — the fraction of rows a predicate keeps; low fraction, useful index.

      **Set operator** — \`UNION\`, \`INTERSECT\`, \`EXCEPT\`: combine result sets vertically.

      **Spine** — a generated series (of dates, say) that facts are joined onto so empty periods appear.

      **Surrogate key** — a meaningless identifier (auto id, UUID) used instead of a natural key.

      **Transaction** — a group of statements applied all-or-nothing.

      **Upsert** — insert, or update if the key exists (\`ON CONFLICT DO UPDATE\`, \`MERGE\`).

      **View** — a stored query usable as a table.

      **Window function** — a function computed over related rows without collapsing them.
    `
  },

  {
    id: 'about',
    title: 'About this course',
    body: `
      ## How it works
      Everything runs locally. The page loads SQLite compiled to WebAssembly
      (\`js/vendor/sql-wasm.js\`, SQLite 3.45), builds the practice database in memory from
      \`js/seed.js\`, and keeps a snapshot of it. Every example and every exercise runs against a
      **fresh copy** of that snapshot, so nothing you do can break anything, and the order you work in
      never matters.

      ## How answers are graded
      Your SQL runs; the reference solution runs on an identical fresh database; the two result sets are
      compared. Consequences:

      - **Any correct query is accepted** — joins or subqueries, \`CASE\` or \`FILTER\`, your choice.
      - Column **names are not graded**, only the values (and the number of columns).
      - Row **order** is graded only when the exercise is about ordering.
      - For DDL and DML exercises, the grader inspects the resulting schema or data with a verification
        query instead.
      - A few exercises additionally require a specific construct (a window function, \`EXISTS\`, …)
        when that construct is the point of the lesson; the feedback says so when it applies.

      ## Shortcuts
      | Key | Action |
      | --- | --- |
      | \`Ctrl\`/\`Cmd\` + \`Enter\` | check the answer in the focused editor |
      | \`Ctrl\`/\`Cmd\` + \`K\` | focus the lesson search |
      | \`Ctrl\`/\`Cmd\` + \`B\` | show or hide the sidebar |
      | \`Tab\` | insert two spaces in an editor |

      ## Your progress
      Completed lessons, quiz answers and the contents of every editor are stored in this browser's
      \`localStorage\` under \`sqlcourse.v1\`. Nothing is uploaded. **Reset progress** at the bottom of the
      sidebar clears it.

      ## Running it elsewhere
      The whole course is static files. Serve the folder over HTTP
      (\`python3 -m http.server 8080\`) and open it; some browsers refuse WebAssembly over \`file://\`.

      ## Extending it
      - The practice data is generated by \`tools/gen_seed.py\` — edit and re-run it to reshape the
        dataset.
      - Lessons are plain data in \`js/curriculum/*.js\`: a title, a Markdown body, exercises with a
        reference solution, and optional quiz questions.
      - \`node tools/collect.mjs out.json && python3 tools/validate.py out.json\` executes **every**
        example and **every** solution against SQLite and reports syntax errors, empty results and
        queries whose row order is not deterministic.
    `
  }
];
