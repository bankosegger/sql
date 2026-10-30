(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'performance',
  title: 'Performance',
  blurb: 'How queries execute, indexes, reading plans, SARGability and tuning patterns.',
  lessons: [

    {
      id: 'how-queries-execute',
      title: 'How a query actually executes',
      lede: 'Parse, plan, execute — and why the plan is where performance lives.',
      body: `
        ## The pipeline
        1. **Parse** — syntax to a tree.
        2. **Bind / resolve** — names to real tables, columns, types.
        3. **Rewrite** — expand views, flatten subqueries, simplify predicates.
        4. **Plan** — choose access paths, join order, join algorithms, sort strategies. The optimiser
           estimates the **cost** of alternatives using **statistics** about your data.
        5. **Execute** — run the chosen plan, usually as a tree of operators pulling rows from each other.
        6. **Cache** — reuse the plan for the same statement shape (which is another reason to use
           parameters rather than interpolated literals).

        Steps 1–3 are cheap and deterministic. Step 4 is where a query goes from 2 ms to 2 minutes.

        ## Access paths
        | Path | When |
        | --- | --- |
        | **Full table scan** | no useful index, or a large fraction of the table is needed |
        | **Index seek / range scan** | a selective predicate matches an index prefix |
        | **Index-only (covering) scan** | the index contains every column the query needs |
        | **Rowid / primary key lookup** | fetching one row by key |

        A scan is not automatically bad: reading 80% of a table sequentially is faster than 800 000
        random index lookups. The optimiser's job is to judge which — and it needs statistics to do it.

        ## Join algorithms
        | Algorithm | Shape | Good when |
        | --- | --- | --- |
        | **Nested loop** | for each outer row, look up matches | small outer input, indexed inner side |
        | **Hash join** | build a hash table from one side, probe with the other | large unsorted inputs, equality joins |
        | **Merge join** | walk two sorted inputs in step | both inputs already sorted (often by index) |

        Only nested loops can handle non-equality conditions, which is why range joins are expensive
        (module 05). SQLite implements nested loops plus automatic transient indexes; the bigger engines
        choose among all three.

        ## Statistics and cardinality
        The optimiser guesses how many rows each step produces. Wrong guesses produce bad plans — the
        usual culprits being stale statistics, correlated predicates
        (\`city = 'Berlin' AND country = 'Germany'\` is not two independent filters), and expressions it
        cannot reason about.

        | Engine | Refresh statistics |
        | --- | --- |
        | SQLite | \`ANALYZE\` (stores them in \`sqlite_stat1\`) |
        | PostgreSQL | \`ANALYZE\`, autovacuum does it automatically |
        | MySQL | \`ANALYZE TABLE\` |
        | SQL Server | \`UPDATE STATISTICS\`, auto-stats on by default |
        | Oracle | \`DBMS_STATS\` |

        ~~~sql
        ANALYZE;
        SELECT * FROM sqlite_stat1 ORDER BY tbl LIMIT 10;
        ~~~

        ## What actually makes queries slow
        In rough order of how often it is the real cause:

        1. A missing index on a selective predicate or a join column.
        2. Reading far more rows than needed (no filter, \`SELECT *\`, no limit).
        3. A function or type mismatch on a column that disables an index.
        4. Row-by-row work (loops, N+1 queries from an ORM) instead of one set-based statement.
        5. A bad join order or a fan-out that multiplies rows before aggregation.
        6. Sorting or hashing huge intermediate results (big \`DISTINCT\`, \`ORDER BY\`, \`UNION\`).
        7. Lock contention and long transactions (module 11) — not the query at all.

        :::tip Measure, do not guess
        Always compare plans and timings on **production-like data volumes**. On 30 rows every plan is
        fast; index choices only become visible at scale, and intuition about which query is "cleverer"
        is unreliable.
        :::
      `,
      quiz: [
        {
          q: 'Why can a full table scan beat an index lookup?',
          options: ['Indexes are always slower', 'Sequential reads of many rows beat many random lookups when a large fraction of the table is needed', 'Scans use more memory'],
          answer: 1,
          explain: 'Each index lookup costs a random read plus a row fetch. Past a threshold (often a few percent of the table) scanning wins.'
        },
        {
          q: 'Stale statistics typically cause:',
          options: ['Wrong results', 'Bad cardinality estimates and therefore bad plans', 'Index corruption'],
          answer: 1,
          explain: 'Results stay correct; the optimiser just chooses badly because it mis-estimates row counts.'
        }
      ]
    },

    {
      id: 'indexes',
      title: 'Indexes',
      lede: 'What an index is, which ones to create, and why more is not better.',
      body: `
        ## What a B-tree index is
        A sorted structure mapping key values to row locations. It makes three things cheap:

        - **equality and range lookups** on the key,
        - **ordered retrieval** (\`ORDER BY\` on the key needs no sort),
        - **uniqueness enforcement**.

        And it costs: storage, plus maintenance on every \`INSERT\`, \`UPDATE\` of indexed columns, and
        \`DELETE\`.

        ~~~sql
        CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date);
        EXPLAIN QUERY PLAN
        SELECT order_id FROM orders WHERE customer_id = 2 AND order_date >= '2025-01-01';
        ~~~

        ## What to index
        1. **Primary keys** — automatic.
        2. **Foreign key columns** — not automatic in most engines; without them, parent deletes and
           child lookups scan (module 09).
        3. **Columns in selective \`WHERE\` predicates.**
        4. **Columns used for \`ORDER BY\` + \`LIMIT\`** — the index supplies order, so the engine can
           stop early.
        5. **Unique business keys** — correctness *and* speed.

        ## Composite indexes and the leading-column rule
        An index on \`(a, b, c)\` can serve predicates on \`a\`, on \`a, b\`, and on \`a, b, c\` — but
        **not** on \`b\` alone. It is a phone book: sorted by surname then first name, useless for
        finding everyone called "Ada".

        ~~~sql
        CREATE INDEX idx_oi_product ON order_items (product_id, quantity);
        EXPLAIN QUERY PLAN SELECT sum(quantity) FROM order_items WHERE product_id = 6;
        ~~~

        Order the columns: equality predicates first, then the range or sort column. One well-ordered
        composite index usually replaces several single-column ones.

        ## Covering indexes
        If the index contains every column the query touches, the engine never reads the table — an
        **index-only scan**:

        ~~~sql
        CREATE INDEX idx_oi_cover ON order_items (product_id, quantity, unit_price);
        EXPLAIN QUERY PLAN
        SELECT product_id, sum(quantity * unit_price) FROM order_items GROUP BY product_id;
        ~~~

        SQL Server spells this \`INCLUDE (cols)\`, which keeps extra columns in the leaf pages without
        making them part of the key.

        ## Selectivity
        An index is useful when the predicate eliminates most rows. Indexing a boolean flag where 95% of
        rows are \`true\` is nearly pointless — unless you want the rare value, in which case a
        **partial index** is ideal:

        ~~~sql
        CREATE INDEX idx_orders_pending ON orders (order_date) WHERE status = 'pending';
        EXPLAIN QUERY PLAN SELECT order_id FROM orders WHERE status = 'pending' AND order_date > '2025-09-01';
        ~~~

        Partial (filtered) indexes exist in SQLite, PostgreSQL and SQL Server; MySQL has no direct
        equivalent.

        ## Expression indexes
        If you must filter on a function, index the function:

        ~~~sql
        CREATE INDEX idx_customers_lower_name ON customers (lower(company_name));
        EXPLAIN QUERY PLAN SELECT customer_id FROM customers WHERE lower(company_name) = 'kappa labs';
        ~~~

        Supported by SQLite, PostgreSQL, Oracle, and MySQL 8+ (or a generated column plus an index).

        ## Other index types
        | Type | Use |
        | --- | --- |
        | B-tree | default; equality, ranges, ordering |
        | Hash | equality only (PostgreSQL) |
        | GIN / inverted | arrays, JSON keys, full-text (PostgreSQL) |
        | GiST / R-tree / spatial | geometry, ranges, nearest-neighbour |
        | BRIN | huge, naturally ordered tables (PostgreSQL) |
        | Columnstore | analytical scans (SQL Server, others) |
        | FTS / trigram | text search (module 14) |

        ## When not to index
        - Small tables — a scan is already optimal.
        - Write-heavy tables with low-value indexes.
        - Low-selectivity columns, unless partial.
        - Duplicate or redundant indexes: an index on \`(a)\` is redundant when \`(a, b)\` exists.
        - Unused indexes. Find them in \`pg_stat_user_indexes\`,
          \`sys.dm_db_index_usage_stats\`, \`performance_schema.table_io_waits_summary_by_index_usage\`.

        :::warn Bulk loads
        Each index multiplies the cost of a large insert. Dropping secondary indexes, loading, and
        rebuilding them is often several times faster overall.
        :::
      `,
      exercises: [
        {
          tag: 'Index',
          prompt: 'Create an index named `idx_orders_customer_date` on `orders` over (`customer_id`, `order_date`) — equality column first — and then run `EXPLAIN QUERY PLAN` for `SELECT order_id FROM orders WHERE customer_id = 2 AND order_date >= \'2025-01-01\'` so you can see it being used.',
          starter: '',
          solution: "CREATE INDEX idx_orders_customer_date ON orders (customer_id, order_date);\nEXPLAIN QUERY PLAN SELECT order_id FROM orders WHERE customer_id = 2 AND order_date >= '2025-01-01';",
          check: "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_orders_customer_date';",
          hints: ['`CREATE INDEX name ON table (cols);`'],
          explain: 'The plan line should mention `USING INDEX idx_orders_customer_date` — the equality column leads, so both predicates are satisfied by the index.'
        },
        {
          tag: 'Index',
          prompt: 'Create a **partial** index `idx_orders_pending` on `orders (order_date)` restricted to rows where `status = \'pending\'`.',
          starter: '',
          solution: "CREATE INDEX idx_orders_pending ON orders (order_date) WHERE status = 'pending';",
          check: "SELECT name, sql FROM sqlite_master WHERE name = 'idx_orders_pending';",
          requireSql: [{ pattern: 'where', msg: 'A partial index needs a `WHERE` clause in its definition.' }],
          hints: ['`CREATE INDEX ... ON orders (order_date) WHERE status = \'pending\';`'],
          explain: 'The index holds only the pending rows: smaller, cheaper to maintain, and perfectly selective for the query that needs it.'
        }
      ],
      quiz: [
        {
          q: 'An index on (country, city) helps WHERE city = \'Berlin\':',
          options: ['Yes, fully', 'No — city is not the leading column', 'Only with ORDER BY'],
          answer: 1,
          explain: 'Composite indexes are usable left-to-right. A separate index on (city) would be needed.'
        },
        {
          q: 'What does a covering index avoid?',
          options: ['Sorting', 'Reading the table itself, because the index has every needed column', 'Locking'],
          answer: 1,
          explain: 'An index-only scan is often several times faster simply because it touches far fewer pages.'
        }
      ]
    },

    {
      id: 'explain',
      title: 'Reading query plans',
      lede: 'EXPLAIN is how you stop guessing. What to look for, in any engine.',
      body: `
        ## The commands
        | Engine | Estimated plan | Actual execution |
        | --- | --- | --- |
        | SQLite | \`EXPLAIN QUERY PLAN <sql>\` | — (use timings) |
        | PostgreSQL | \`EXPLAIN <sql>\` | \`EXPLAIN (ANALYZE, BUFFERS) <sql>\` |
        | MySQL | \`EXPLAIN <sql>\` | \`EXPLAIN ANALYZE <sql>\` (8.0.18+) |
        | SQL Server | \`SET SHOWPLAN_ALL ON\`, graphical plan | \`SET STATISTICS IO, TIME ON\` |
        | Oracle | \`EXPLAIN PLAN FOR\` + \`DBMS_XPLAN\` | \`DBMS_XPLAN.DISPLAY_CURSOR\` |

        \`EXPLAIN\` alone shows what the optimiser *intends*. \`EXPLAIN ANALYZE\` runs the query and shows
        what happened — which is what you actually need, because the gap between estimated and actual row
        counts is the single most informative number in tuning.

        ## A plan in SQLite
        ~~~sql
        EXPLAIN QUERY PLAN
        SELECT c.company_name, count(*) AS orders
        FROM customers c JOIN orders o ON o.customer_id = c.customer_id
        WHERE c.country = 'Germany'
        GROUP BY c.company_name;
        ~~~

        Read the output bottom-up/inside-out. Words to look for:

        - \`SCAN table\` — a full scan. Fine for small tables, suspicious for large ones.
        - \`SEARCH table USING INDEX ix (col=?)\` — an index seek. Good.
        - \`USING COVERING INDEX\` — index-only, better still.
        - \`USE TEMP B-TREE FOR ORDER BY / GROUP BY\` — an explicit sort; an index could remove it.
        - \`AUTOMATIC COVERING INDEX\` — SQLite built a throwaway index at runtime: a strong hint that you
          should create a real one.

        ## Before and after
        ~~~sql
        EXPLAIN QUERY PLAN SELECT * FROM order_items WHERE product_id = 6;
        ~~~

        ~~~sql
        CREATE INDEX idx_oi_product ON order_items (product_id);
        EXPLAIN QUERY PLAN SELECT * FROM order_items WHERE product_id = 6;
        ~~~

        The first plan scans; the second searches using the index. That before/after comparison is the
        whole tuning loop.

        ## What to look for in any engine
        1. **Estimated vs actual rows.** An estimate of 10 where reality is 1 000 000 means the plan was
           chosen for the wrong shape of data — usually stale statistics or a predicate the optimiser
           cannot estimate.
        2. **The biggest actual cost**, not the scariest-looking operator. Optimise the dominant node.
        3. **Unexpected scans** on large tables.
        4. **Sorts and hashes** that spill to disk (PostgreSQL: \`external merge Disk: …\`).
        5. **Nested loops over a large outer input** — often a missing index on the inner side.
        6. **Rows removed by filter** — the engine read a lot and threw it away; move the filter into an
           index.

        ## Timing in this page
        The playground reports no timings, but every engine has them: \`.timer on\` in the SQLite CLI,
        \`\\timing\` in psql, \`SET STATISTICS TIME ON\` in SQL Server. Measure twice — the first run pays
        for a cold cache.

        :::tip Keep a plan diary
        When you tune a slow query, save the before plan, the change, and the after plan in the commit
        message. Six months later, that note is the only thing that explains why an odd-looking index
        exists.
        :::
      `,
      exercises: [
        {
          tag: 'Plan',
          prompt: 'Run `EXPLAIN QUERY PLAN` for a query that counts order lines for product 6 (`SELECT count(*) FROM order_items WHERE product_id = 6`), and return the plan rows.',
          starter: '',
          solution: 'EXPLAIN QUERY PLAN SELECT count(*) FROM order_items WHERE product_id = 6;',
          hints: ['Prefix the query with `EXPLAIN QUERY PLAN`.'],
          explain: 'Without an index on `product_id`, the plan scans `order_items` (the primary key leads with `order_id`, so it cannot help).'
        },
        {
          tag: 'Plan',
          prompt: 'Create the index `idx_oi_product` on `order_items (product_id)` and then show the plan for the same count query — it should now use the index.',
          starter: '',
          solution: 'CREATE INDEX idx_oi_product ON order_items (product_id);\nEXPLAIN QUERY PLAN SELECT count(*) FROM order_items WHERE product_id = 6;',
          hints: ['Two statements: the index, then the EXPLAIN.'],
          explain: 'The plan changes from `SCAN` to `SEARCH ... USING COVERING INDEX` — the index alone answers the query.'
        }
      ]
    },

    {
      id: 'sargability',
      title: 'Writing index-friendly predicates',
      lede: 'Small rewrites that let the engine seek instead of scan.',
      body: `
        ## SARGable means "searchable"
        A predicate can use an index only if the engine can turn it into a range of index keys. The rule
        of thumb: **keep the indexed column bare on one side of the operator.**

        | Instead of | Write |
        | --- | --- |
        | \`WHERE strftime('%Y', order_date) = '2025'\` | \`WHERE order_date >= '2025-01-01' AND order_date < '2026-01-01'\` |
        | \`WHERE lower(email) = 'x@y.z'\` | index \`lower(email)\`, or store a normalised column |
        | \`WHERE salary * 12 > 120000\` | \`WHERE salary > 10000\` |
        | \`WHERE freight + 10 > 60\` | \`WHERE freight > 50\` |
        | \`WHERE CAST(customer_id AS TEXT) = '2'\` | \`WHERE customer_id = 2\` |
        | \`WHERE name LIKE '%son'\` | full-text / trigram index, or a reversed column |
        | \`WHERE col <> 'x'\` (low selectivity) | positive predicates, or a partial index |

        ~~~sql
        CREATE INDEX idx_orders_date ON orders (order_date);
        EXPLAIN QUERY PLAN SELECT count(*) FROM orders WHERE strftime('%Y', order_date) = '2025';
        ~~~

        ~~~sql
        CREATE INDEX idx_orders_date ON orders (order_date);
        EXPLAIN QUERY PLAN
        SELECT count(*) FROM orders WHERE order_date >= '2025-01-01' AND order_date < '2026-01-01';
        ~~~

        Same answer, different plan: the first scans, the second searches a range of the index.

        ## Type mismatches
        Comparing a text column to a number (or vice versa) forces a conversion on the column side and
        can silently disable the index — and in MySQL it can even change which rows match. Keep types
        aligned, and pass parameters with the right type from your application.

        ## OR, and how to avoid it
        \`WHERE a = 1 OR b = 2\` often cannot use either index well. Two rewrites:

        ~~~sql
        -- a UNION of two index-friendly halves
        SELECT order_id FROM orders WHERE customer_id = 2
        UNION
        SELECT order_id FROM orders WHERE emp_id = 10
        ORDER BY order_id LIMIT 10;
        ~~~

        \`IN (...)\` on one column, by contrast, is index-friendly — the engine can seek once per value.

        ## NULL checks
        \`IS NULL\` *is* usable by an index in PostgreSQL, SQLite and SQL Server (NULLs are stored in the
        index) but not in Oracle's B-trees, where NULLs are absent — a classic surprise when porting.

        ## Leading wildcards and text search
        \`LIKE 'abc%'\` is a range scan. \`LIKE '%abc'\` and \`LIKE '%abc%'\` are not. If infix search is a
        product requirement, it needs a different index type (module 14), not a cleverer \`LIKE\`.

        ## Pagination
        \`LIMIT 20 OFFSET 100000\` makes the engine produce and discard 100 000 rows. Keyset pagination
        (module 01) turns it into an index seek:

        ~~~sql
        CREATE INDEX idx_orders_id ON orders (order_id);
        EXPLAIN QUERY PLAN SELECT order_id FROM orders WHERE order_id > 1200 ORDER BY order_id LIMIT 20;
        ~~~

        ## Only the first row of a sorted result
        With an index on the sort key, \`ORDER BY ... LIMIT 1\` is a single index probe. Without one it is
        a full sort of the table. This is why "the latest row per entity" queries deserve an index on
        \`(entity_id, created_at DESC)\`.

        :::tip The rewrite that matters most
        Date filters. Replacing a function-wrapped date filter with a half-open range is, across
        real-world systems, the single most common high-impact query fix.
        :::
      `,
      exercises: [
        {
          tag: 'Tuning',
          prompt: 'Rewrite this unSARGable filter as an index-friendly half-open range, returning `order_id` and `order_date` for orders in September 2025, ordered by `order_id`:\n\n~~~sql-static\nSELECT order_id, order_date FROM orders WHERE strftime(\'%Y-%m\', order_date) = \'2025-09\';\n~~~',
          starter: '',
          solution: "SELECT order_id, order_date FROM orders\nWHERE order_date >= '2025-09-01' AND order_date < '2025-10-01'\nORDER BY order_id;",
          orderMatters: true,
          forbidSql: [{ pattern: 'strftime', msg: 'Avoid wrapping the column in a function — compare the bare column against a range.' }],
          hints: ['`>= \'2025-09-01\' AND < \'2025-10-01\'`.'],
          explain: 'Identical rows, but now an index on `order_date` can be used — and the predicate stays correct if the column gains a time component.'
        },
        {
          tag: 'Tuning',
          prompt: 'Rewrite `WHERE freight * 2 > 100` so the column stands alone, returning `order_id` and `freight` for those orders, ordered by `order_id`, limited to 10.',
          starter: '',
          solution: 'SELECT order_id, freight FROM orders WHERE freight > 50 ORDER BY order_id LIMIT 10;',
          orderMatters: true,
          forbidSql: [{ pattern: 'freight\\s*\\*', msg: 'Move the arithmetic to the literal side: compare `freight` directly.' }],
          hints: ['Divide the constant instead of multiplying the column.'],
          explain: 'Algebra on the literal side is free; algebra on the column side costs you the index.'
        }
      ],
      quiz: [
        {
          q: 'Why is WHERE YEAR(order_date) = 2025 slower than a date range?',
          options: ['YEAR() is a slow function', 'The column is wrapped in a function, so the index on it cannot be used for a range seek', 'It returns more rows'],
          answer: 1,
          explain: 'The engine would have to evaluate the function for every row. An expression index on YEAR(order_date) is the alternative.'
        }
      ]
    },

    {
      id: 'tuning-patterns',
      title: 'Tuning patterns and query rewrites',
      lede: 'Specific rewrites with reliable payoffs, and how to work on a slow query methodically.',
      body: `
        ## A method
        1. **Measure** — find the slow statement (slow query log, \`pg_stat_statements\`, Query Store).
           Optimise what is actually slow and frequent, not what looks ugly.
        2. **Reproduce** on representative data volumes.
        3. **Read the plan.** Find the dominant operator.
        4. **Form one hypothesis** — a missing index, a bad predicate, a fan-out.
        5. **Change one thing.** Re-measure. Keep or revert.
        6. **Record** the before/after in the commit.

        ## Reduce the rows you touch
        - Filter as early as possible, on the most selective predicate.
        - Name the columns you need: \`SELECT *\` prevents index-only scans and ships bytes you discard.
        - \`LIMIT\` what the user will actually see.
        - Aggregate before joining (module 05) so the join carries fewer rows.

        ~~~sql
        -- pre-aggregate, then join: the join sees one row per order instead of many lines
        SELECT c.company_name, round(sum(t.order_total), 2) AS revenue
        FROM customers c
        JOIN orders o ON o.customer_id = c.customer_id
        JOIN (SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS order_total
              FROM order_items GROUP BY order_id) t ON t.order_id = o.order_id
        GROUP BY c.customer_id, c.company_name
        ORDER BY revenue DESC LIMIT 5;
        ~~~

        ## EXISTS vs IN vs JOIN
        - **\`EXISTS\`** can stop at the first match: best for "does a related row exist?".
        - **\`IN (subquery)\`** is usually optimised into a semi-join — comparable, but
          \`NOT IN\` has the NULL trap (module 07).
        - **\`JOIN\`** is right when you need columns from the other table; add \`DISTINCT\` only if you
          have accepted the duplication.

        ~~~sql
        EXPLAIN QUERY PLAN
        SELECT c.customer_id FROM customers c
        WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id);
        ~~~

        ## Avoid N+1 queries
        The most common application-level performance bug: one query for a list, then one query per row.
        Replace with a single join or an \`IN\` over the collected keys. ORMs usually offer eager loading
        for exactly this.

        ## Batch writes
        ~~~sql-static
        -- 10 000 statements, 10 000 commits
        INSERT INTO t VALUES (1); INSERT INTO t VALUES (2); ...
        -- one statement, one commit
        INSERT INTO t VALUES (1), (2), (3), ...;
        ~~~

        Wrap large loads in an explicit transaction, and batch deletes/updates to keep locks short
        (module 10).

        ## Keyset pagination, again
        For deep pages, remember the last key instead of counting rows:

        ~~~sql
        SELECT order_id, order_date FROM orders
        WHERE order_id > 1200
        ORDER BY order_id
        LIMIT 20;
        ~~~

        ## Count only what you need
        \`count(*)\` over a huge table is expensive in MVCC engines. Options: an approximate count from
        statistics, a maintained counter, or counting a narrower filtered set. For "are there any?",
        \`EXISTS\` beats \`count(*) > 0\` because it stops at the first row.

        ## Cache and precompute
        If the same expensive aggregate is read constantly and may be seconds stale, a summary table or
        materialised view (modules 11–12) beats any query rewrite. Decide the refresh cadence explicitly.

        ## Things people try that rarely help
        - Rewriting a join as a subquery, or vice versa, without looking at the plan: the optimiser
          usually normalises both.
        - Adding \`DISTINCT\` to fix duplicates: it hides a modelling bug and adds a sort.
        - Index hints: they freeze a decision that was correct for yesterday's data. Use them as a last
          resort.
        - Adding indexes until something gets faster: each one taxes every write.

        :::tip The cheapest optimisation
        Delete the work. A surprising share of slow queries are reports nobody reads, pages nobody
        scrolls to, and columns nobody looks at.
        :::
      `,
      exercises: [
        {
          tag: 'Tuning',
          prompt: 'Rewrite this query to avoid the fan-out, by pre-aggregating `order_items` before joining: return `company_name` and `revenue` (rounded to 2) for the top 5 customers by revenue, highest first, ties by `company_name`.\n\n~~~sql-static\nSELECT c.company_name, round(sum(i.unit_price * i.quantity * (1 - i.discount)), 2) AS revenue\nFROM customers c\nJOIN orders o ON o.customer_id = c.customer_id\nJOIN order_items i ON i.order_id = o.order_id\nGROUP BY c.customer_id, c.company_name;\n~~~',
          starter: '',
          solution: 'SELECT c.company_name, round(sum(t.order_total), 2) AS revenue\nFROM customers c\nJOIN orders o ON o.customer_id = c.customer_id\nJOIN (SELECT order_id, sum(unit_price * quantity * (1 - discount)) AS order_total\n      FROM order_items GROUP BY order_id) t ON t.order_id = o.order_id\nGROUP BY c.customer_id, c.company_name\nORDER BY revenue DESC, c.company_name\nLIMIT 5;',
          orderMatters: true,
          hints: ['Aggregate `order_items` to one row per order in a subquery.', 'Then the outer join and sum work at order grain.'],
          explain: 'Same numbers, fewer rows flowing through the join — and it stays correct if a second child table is added later.'
        },
        {
          tag: 'Tuning',
          prompt: 'Replace `count(*) > 0` with an existence check: return `customer_id` and `company_name` for customers who have at least one order, ordered by `customer_id`, using `EXISTS`.',
          starter: '',
          solution: 'SELECT customer_id, company_name\nFROM customers c\nWHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)\nORDER BY customer_id;',
          orderMatters: true,
          requireSql: [{ pattern: 'exists', msg: 'Use `EXISTS` rather than counting.' }],
          forbidSql: [{ pattern: 'count\\s*\\(', msg: 'No counting — the point is that EXISTS can stop at the first matching row.' }],
          hints: ['`WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)`.'],
          explain: 'EXISTS short-circuits; counting reads every matching row before comparing.'
        }
      ],
      quiz: [
        {
          q: 'The first step when a query is slow is:',
          options: ['Add an index on every column in the WHERE clause', 'Read the execution plan on representative data', 'Rewrite the joins as subqueries'],
          answer: 1,
          explain: 'The plan tells you which operator dominates; everything else is guessing.'
        },
        {
          q: 'An N+1 query problem is fixed by:',
          options: ['Adding an index', 'Fetching the related rows in one query (join or IN over the keys)', 'Caching each query'],
          answer: 1,
          explain: 'The cost is per-round-trip, so the fix is to make fewer, larger queries.'
        }
      ]
    }
  ]
});
