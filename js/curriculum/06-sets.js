(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'sets',
  title: 'Combining result sets',
  blurb: 'UNION, UNION ALL, INTERSECT, EXCEPT — stacking queries instead of joining them.',
  lessons: [

    {
      id: 'union',
      title: 'UNION and UNION ALL',
      lede: 'Stacking two result sets vertically, and why the choice between them is a performance decision.',
      body: `
        ## Stacking rows
        A join adds **columns**; a set operator adds **rows**. Both inputs must have the same number of
        columns, with compatible types, in the same order:

        ~~~sql
        SELECT 'customer' AS party_type, company_name AS name, country FROM customers
        UNION ALL
        SELECT 'supplier' AS party_type, supplier_name AS name, country FROM suppliers
        ORDER BY party_type, name
        LIMIT 12;
        ~~~

        Column **names** come from the first \`SELECT\`; the others are positional, which makes a wrong
        column order a silent bug — line the queries up vertically so the mapping is visible.

        ## UNION removes duplicates, UNION ALL does not
        \`UNION\` deduplicates the combined result (treating \`NULL\`s as equal), which requires a sort or
        hash of everything. \`UNION ALL\` just concatenates and is much cheaper.

        ~~~sql
        SELECT count(*) AS with_all FROM (
          SELECT country FROM customers UNION ALL SELECT country FROM suppliers
        );
        ~~~

        ~~~sql
        SELECT count(*) AS deduplicated FROM (
          SELECT country FROM customers UNION SELECT country FROM suppliers
        );
        ~~~

        **Default to \`UNION ALL\`.** Use \`UNION\` only when duplicates are possible *and* wrong. Writing
        \`UNION\` out of habit on a large query is a common, invisible performance tax.

        ## ORDER BY applies to the whole result
        A single trailing \`ORDER BY\` sorts the combined set and may only reference output column names:

        ~~~sql
        SELECT company_name AS name, 'customer' AS kind FROM customers WHERE country = 'Netherlands'
        UNION ALL
        SELECT supplier_name AS name, 'supplier' AS kind FROM suppliers WHERE country = 'Netherlands'
        ORDER BY name;
        ~~~

        To limit *each* branch, wrap each in a subquery with its own \`ORDER BY ... LIMIT\`.

        ## Typical uses
        - combining current and archive tables (\`orders\` + \`orders_2019\`);
        - a report with a totals row appended;
        - emulating \`FULL OUTER JOIN\` (module 05);
        - turning columns into rows (unpivot, module 14).

        ~~~sql
        SELECT status, orders FROM (
          SELECT status, count(*) AS orders FROM orders GROUP BY status
          UNION ALL
          SELECT 'TOTAL', count(*) FROM orders
        )
        ORDER BY (status = 'TOTAL'), status;
        ~~~

        A compound \`SELECT\` only accepts plain output columns in its \`ORDER BY\`, which is why the
        sorting expression lives in a wrapping query here.

        :::warn Types must line up
        \`SELECT 1 UNION ALL SELECT 'x'\` is accepted by SQLite (dynamic typing) but rejected by
        PostgreSQL and SQL Server. Cast explicitly so the intent is unambiguous on every engine.
        :::
      `,
      exercises: [
        {
          prompt: 'Produce a single list of all countries we deal with: `country` and `source` (`\'customer\'` or `\'supplier\'`), keeping duplicates, ordered by `country` then `source`.',
          starter: '',
          solution: "SELECT country, 'customer' AS source FROM customers\nUNION ALL\nSELECT country, 'supplier' AS source FROM suppliers\nORDER BY country, source;",
          orderMatters: true,
          requireSql: [{ pattern: 'union\\s+all', msg: 'Use `UNION ALL` — duplicates are wanted here.' }],
          hints: ['Both branches need the same two columns in the same order.'],
          explain: 'A literal column that labels the source is the standard way to keep track of which branch a row came from.'
        },
        {
          prompt: 'Return the distinct list of countries that appear in **either** `customers` or `suppliers`: one column `country`, ordered alphabetically.',
          starter: '',
          solution: 'SELECT country FROM customers\nUNION\nSELECT country FROM suppliers\nORDER BY country;',
          orderMatters: true,
          hints: ['`UNION` deduplicates across both branches.'],
          explain: 'This is the one case where UNION beats UNION ALL + DISTINCT: it says what you mean in one word.'
        },
        {
          prompt: 'Return the order count per status with a `TOTAL` row appended: columns `status` and `orders`, with the four statuses sorted alphabetically first and `TOTAL` last.',
          starter: '',
          solution: "SELECT status, orders FROM (\n  SELECT status, count(*) AS orders FROM orders GROUP BY status\n  UNION ALL\n  SELECT 'TOTAL', count(*) FROM orders\n)\nORDER BY (status = 'TOTAL'), status;",
          orderMatters: true,
          hints: ['The second branch has no GROUP BY — it is one row.', 'Wrap the whole `UNION ALL` in a subquery, then sort it with `ORDER BY (status = \'TOTAL\'), status`.'],
          explain: 'Module 14 shows GROUPING SETS / ROLLUP, which produce subtotal rows without the manual UNION.'
        }
      ],
      quiz: [
        {
          q: 'Which should you default to?',
          options: ['UNION, to be safe', 'UNION ALL, because deduplication costs a sort or hash', 'They perform identically'],
          answer: 1,
          explain: 'UNION must compare every row against every other; UNION ALL streams. Only pay for dedup when duplicates are actually wrong.'
        }
      ]
    },

    {
      id: 'intersect-except',
      title: 'INTERSECT and EXCEPT',
      lede: 'Set arithmetic: rows in both, and rows in one but not the other.',
      body: `
        ## INTERSECT
        Rows present in **both** results, deduplicated:

        ~~~sql
        SELECT country FROM customers
        INTERSECT
        SELECT country FROM suppliers
        ORDER BY country;
        ~~~

        Countries where we both buy and sell.

        ## EXCEPT (a.k.a. MINUS)
        Rows in the first result that are **not** in the second:

        ~~~sql
        SELECT country FROM customers
        EXCEPT
        SELECT country FROM suppliers
        ORDER BY country;
        ~~~

        \`EXCEPT\` is not symmetric: swapping the branches answers a different question.
        Oracle spells it \`MINUS\`; MySQL supports both from 8.0.31, earlier versions have neither and need
        \`NOT EXISTS\`.

        ## All columns participate
        Set operators compare the **whole row**. This is powerful for comparing datasets:

        ~~~sql
        -- which (product, customer) pairs were reviewed but never ordered?
        SELECT r.product_id, r.customer_id FROM reviews r
        EXCEPT
        SELECT i.product_id, o.customer_id
        FROM order_items i JOIN orders o ON o.order_id = i.order_id
        ORDER BY product_id, customer_id;
        ~~~

        An empty result is a meaningful answer: the two sets agree.

        ## NULL handling differs from WHERE
        Set operators use "not distinct" semantics, so two \`NULL\`s match each other. That makes
        \`EXCEPT\` a reliable way to diff tables with nullable columns, where \`NOT IN\` would mislead.

        ## The equivalences
        Everything here can be written with joins, and the alternatives often perform better on large
        inputs because they can stop early:

        | Set form | Join / subquery form |
        | --- | --- |
        | \`a INTERSECT b\` | \`SELECT DISTINCT ... FROM a WHERE EXISTS (SELECT 1 FROM b WHERE ...)\` |
        | \`a EXCEPT b\` | \`SELECT DISTINCT ... FROM a WHERE NOT EXISTS (...)\` |
        | \`a UNION b\` | \`SELECT DISTINCT\` over \`UNION ALL\` |

        Set operators win on clarity when the comparison is "whole rows, several columns"; \`EXISTS\` wins
        when you need columns from \`a\` that are not part of the comparison.

        ## Precedence
        \`INTERSECT\` binds tighter than \`UNION\` and \`EXCEPT\` in standard SQL, and engines disagree in
        practice. Make the grouping explicit when you mix them. Standard SQL, PostgreSQL and SQL Server
        allow parentheses around a branch; SQLite does not, so wrap the inner operation in a subquery —
        a form that works everywhere:

        ~~~sql
        SELECT country FROM customers
        EXCEPT
        SELECT country FROM (
          SELECT country FROM suppliers INTERSECT SELECT country FROM customers
        )
        ORDER BY country;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Which countries have **both** customers and suppliers? One column `country`, alphabetical.',
          starter: '',
          solution: 'SELECT country FROM customers\nINTERSECT\nSELECT country FROM suppliers\nORDER BY country;',
          orderMatters: true,
          requireSql: [{ pattern: 'intersect', msg: 'Use `INTERSECT` here.' }],
          hints: ['Two SELECTs, one operator.'],
          explain: 'INTERSECT also deduplicates, so each country appears once however many customers it has.'
        },
        {
          prompt: 'Which `product_id` values exist in `products` but never in `order_items`? Use `EXCEPT`. One column `product_id`.',
          starter: '',
          solution: 'SELECT product_id FROM products\nEXCEPT\nSELECT product_id FROM order_items;',
          requireSql: [{ pattern: 'except', msg: 'Use `EXCEPT` for this one.' }],
          hints: ['The order of the branches decides the answer.'],
          explain: 'The same anti-join you wrote with LEFT JOIN and NOT EXISTS — three spellings of one idea.'
        },
        {
          prompt: 'Find the products that have never been reviewed: `product_id` values present in `products` but absent from `reviews`, using `EXCEPT`. Order by `product_id`.',
          starter: '',
          solution: 'SELECT product_id FROM products\nEXCEPT\nSELECT product_id FROM reviews\nORDER BY product_id;',
          orderMatters: true,
          hints: ['Both branches return a single column.'],
          explain: 'Set difference on a key column is the quickest way to audit "present here, missing there".'
        }
      ],
      quiz: [
        {
          q: 'a EXCEPT b and b EXCEPT a:',
          options: ['Always return the same rows', 'Answer different questions', 'Are both invalid without ORDER BY'],
          answer: 1,
          explain: 'Set difference is directional. Running both halves is how you build a full reconciliation.'
        }
      ]
    },

    {
      id: 'set-patterns',
      title: 'Comparing datasets in practice',
      lede: 'A reusable recipe for "do these two queries agree?", used in migrations and refactors.',
      body: `
        ## Why this matters
        When you rewrite a query for performance, change a join, or migrate data, the only
        convincing proof is that the old and new results are identical. Set operators make that a
        two-line test.

        ## The symmetric difference
        Run \`EXCEPT\` in both directions and label the sides:

        ~~~sql
        WITH old_way AS (
          SELECT c.customer_id, count(*) AS orders
          FROM orders o JOIN customers c ON c.customer_id = o.customer_id
          GROUP BY c.customer_id
        ),
        new_way AS (
          SELECT customer_id, count(*) AS orders
          FROM orders
          GROUP BY customer_id
        )
        SELECT 'only in old' AS side, * FROM (SELECT * FROM old_way EXCEPT SELECT * FROM new_way)
        UNION ALL
        SELECT 'only in new' AS side, * FROM (SELECT * FROM new_way EXCEPT SELECT * FROM old_way);
        ~~~

        No rows means the rewrites are equivalent on this data. (It cannot prove equivalence for *all*
        data — but it catches the overwhelming majority of refactoring mistakes.)

        ## Counting agreement
        ~~~sql
        WITH a AS (SELECT DISTINCT country FROM customers),
             b AS (SELECT DISTINCT country FROM suppliers)
        SELECT (SELECT count(*) FROM a)                                   AS in_customers,
               (SELECT count(*) FROM b)                                   AS in_suppliers,
               (SELECT count(*) FROM (SELECT * FROM a INTERSECT SELECT * FROM b)) AS in_both,
               (SELECT count(*) FROM (SELECT * FROM a EXCEPT SELECT * FROM b))    AS customers_only,
               (SELECT count(*) FROM (SELECT * FROM b EXCEPT SELECT * FROM a))    AS suppliers_only;
        ~~~

        ## Watch out for
        - **Row counts.** \`UNION\`/\`EXCEPT\`/\`INTERSECT\` deduplicate, so they will not detect a change
          in the *number* of duplicate rows. Add a count column, or compare \`count(*)\` separately.
        - **Floating point.** Tiny representation differences make rows differ. Round both sides to the
          precision you actually care about before comparing.
        - **Order.** Set operators ignore row order, which is usually what you want; if the ordering is
          part of the contract, compare with a \`ROW_NUMBER()\` column included.
        - **Column order.** Positional matching means a swapped pair of same-typed columns passes
          unnoticed in SQLite. Spell out column lists instead of \`SELECT *\`.
      `,
      exercises: [
        {
          prompt: 'Prove that these two ways of counting orders per customer agree. Return the rows that differ (expect none), with columns `side`, `customer_id`, `orders`:\n\n- A: `orders` joined to `customers`, grouped by `c.customer_id`\n- B: `orders` alone, grouped by `customer_id`',
          starter: 'WITH a AS (\n  \n), b AS (\n  \n)\nSELECT ',
          solution: "WITH a AS (\n  SELECT c.customer_id, count(*) AS orders\n  FROM orders o JOIN customers c ON c.customer_id = o.customer_id\n  GROUP BY c.customer_id\n), b AS (\n  SELECT customer_id, count(*) AS orders\n  FROM orders\n  GROUP BY customer_id\n)\nSELECT 'only in a' AS side, customer_id, orders FROM (SELECT * FROM a EXCEPT SELECT * FROM b)\nUNION ALL\nSELECT 'only in b' AS side, customer_id, orders FROM (SELECT * FROM b EXCEPT SELECT * FROM a);",
          allowEmpty: true,
          hints: ['Two CTEs, then EXCEPT in both directions, combined with UNION ALL.', 'An empty result is the expected (and correct) answer.'],
          explain: 'Zero rows is the pass condition. This exact pattern belongs in a migration checklist.'
        },
        {
          prompt: 'Return a one-row summary of how `customers.country` and `suppliers.country` overlap: `in_both`, `customers_only`, `suppliers_only` (counts of distinct countries).',
          starter: '',
          solution: 'WITH a AS (SELECT DISTINCT country FROM customers),\n     b AS (SELECT DISTINCT country FROM suppliers)\nSELECT (SELECT count(*) FROM (SELECT * FROM a INTERSECT SELECT * FROM b)) AS in_both,\n       (SELECT count(*) FROM (SELECT * FROM a EXCEPT SELECT * FROM b))    AS customers_only,\n       (SELECT count(*) FROM (SELECT * FROM b EXCEPT SELECT * FROM a))    AS suppliers_only;',
          hints: ['Each count is a scalar subquery wrapping a set operation.'],
          explain: 'A compact overlap report — the same shape works for comparing any two key sets.'
        }
      ]
    }
  ]
});
