(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'filtering',
  title: 'Filtering rows',
  blurb: 'WHERE, boolean logic, ranges, lists, pattern matching, and the rules of NULL.',
  lessons: [

    {
      id: 'where',
      title: 'WHERE and the comparison operators',
      lede: 'Keeping the rows you want. The predicate is the heart of almost every query.',
      body: `
        ## A predicate per row
        \`WHERE\` takes a **predicate**: an expression evaluated for every candidate row, which keeps the
        row when the result is *true* (not false, and not unknown — see the NULL lesson).

        ~~~sql
        SELECT first_name, last_name, salary
        FROM employees
        WHERE salary > 100000;
        ~~~

        ## Operators
        | Operator | Meaning |
        | --- | --- |
        | \`=\` | equal |
        | \`<>\` or \`!=\` | not equal (\`<>\` is the standard spelling) |
        | \`<\`, \`<=\`, \`>\`, \`>=\` | ordering |
        | \`BETWEEN a AND b\` | inclusive range |
        | \`IN (...)\` | member of a list or subquery |
        | \`LIKE\`, \`GLOB\`, \`SIMILAR TO\`, \`REGEXP\` | pattern matching |
        | \`IS NULL\`, \`IS NOT NULL\` | null test |
        | \`EXISTS (subquery)\` | subquery returns at least one row |

        Comparisons work on numbers, text (by collation) and dates (lexically, if stored as ISO text).

        ~~~sql
        SELECT order_id, order_date, status
        FROM orders
        WHERE order_date >= '2025-09-01' AND status <> 'cancelled'
        ORDER BY order_date
        LIMIT 10;
        ~~~

        ## Text comparisons are not fuzzy
        \`=\` on text is exact, including case and trailing spaces (SQLite compares byte by byte by default).
        \`WHERE city = 'paris'\` finds nothing when the stored value is \`'Paris'\`. Options:

        ~~~sql
        SELECT company_name, city FROM customers
        WHERE lower(city) = 'paris'               -- normalise both sides
           OR city = 'Paris' COLLATE NOCASE;      -- or use a case-insensitive collation
        ~~~

        Note that wrapping a column in a function stops the engine using an index on it (module 13).
        For case-insensitive lookups at scale, store a normalised column or declare the column
        \`COLLATE NOCASE\` in the table definition.

        ## Booleans
        SQLite, MySQL and SQL Server have no real boolean type in older versions: they use \`0\`/\`1\`.
        PostgreSQL has \`boolean\` with \`TRUE\`/\`FALSE\`. Our \`discontinued\` column is an integer flag,
        so \`WHERE discontinued = 1\` is the portable form; \`WHERE discontinued\` also works in SQLite and MySQL.

        :::tip
        Build filters one at a time and watch the row count. A predicate that silently removes everything
        is easier to spot at 0 rows than to find inside a finished 30-line query.
        :::
      `,
      exercises: [
        {
          prompt: 'Return `product_name` and `unit_price` for every product priced above 200.',
          starter: '',
          solution: 'SELECT product_name, unit_price FROM products WHERE unit_price > 200;',
          hints: ['One comparison in `WHERE`.'],
          explain: 'Strictly greater than: a product at exactly 200 would be excluded.'
        },
        {
          prompt: 'Return `order_id`, `order_date` and `status` for orders that were **not** cancelled and were placed in 2025 or later, oldest first.',
          starter: '',
          solution: "SELECT order_id, order_date, status FROM orders WHERE status <> 'cancelled' AND order_date >= '2025-01-01' ORDER BY order_date, order_id;",
          orderMatters: false,
          hints: ['Dates are ISO text, so `>= \'2025-01-01\'` works.', 'Combine two predicates with `AND`.'],
          explain: 'ISO text dates compare correctly with plain operators — no date functions required.'
        },
        {
          prompt: 'Find the customer whose contact is `Yui Tanaka`. Return `company_name`, `city` and `country`.',
          starter: '',
          solution: "SELECT company_name, city, country FROM customers WHERE contact_name = 'Yui Tanaka';",
          hints: ['String literals use single quotes.'],
          explain: 'Exact text match, including capitalisation.'
        }
      ]
    },

    {
      id: 'boolean-logic',
      title: 'AND, OR, NOT and precedence',
      lede: 'The single most common SQL bug: mixing AND and OR without parentheses.',
      body: `
        ## Precedence
        \`NOT\` binds tightest, then \`AND\`, then \`OR\`. So this:

        ~~~sql-static
        WHERE country = 'Norway' OR country = 'Denmark' AND credit_limit > 20000
        ~~~

        means \`country = 'Norway' OR (country = 'Denmark' AND credit_limit > 20000)\` — every Norwegian
        customer is returned regardless of credit limit. Almost certainly not what was meant.

        **Parenthesise whenever \`AND\` and \`OR\` appear in the same predicate.** Compare:

        ~~~sql
        SELECT company_name, country, credit_limit
        FROM customers
        WHERE (country = 'Norway' OR country = 'Denmark')
          AND credit_limit > 20000;
        ~~~

        ~~~sql
        SELECT company_name, country, credit_limit
        FROM customers
        WHERE country = 'Norway' OR country = 'Denmark' AND credit_limit > 20000;
        ~~~

        ## NOT
        \`NOT\` negates a predicate. It is clearer to negate the operator when one exists:
        \`NOT (x = 1)\` → \`x <> 1\`, \`NOT (x IN (...))\` → \`x NOT IN (...)\`,
        \`NOT (x IS NULL)\` → \`x IS NOT NULL\`.

        Careful: negation interacts with \`NULL\`. If \`x\` is \`NULL\`, both \`x = 1\` and \`x <> 1\` are
        *unknown*, so neither the predicate nor its negation keeps the row.

        ~~~sql
        -- 22 customers, but these two counts do not add up to 22
        SELECT
          (SELECT count(*) FROM customers WHERE credit_limit > 20000)  AS big,
          (SELECT count(*) FROM customers WHERE credit_limit <= 20000) AS small,
          (SELECT count(*) FROM customers)                             AS total;
        ~~~

        ## Short-circuiting is not guaranteed
        SQL has no defined evaluation order for \`AND\`/\`OR\` operands: the planner may reorder them.
        Do not rely on \`WHERE x <> 0 AND 100 / x > 5\` to avoid a division error — use \`CASE\` instead,
        which does guarantee order.

        ## Readable multi-condition filters
        Long predicates are easier to review one per line, with the operator leading:

        ~~~sql
        SELECT order_id, status, freight
        FROM orders
        WHERE status IN ('shipped', 'delivered')
          AND freight > 50
          AND order_date BETWEEN '2025-01-01' AND '2025-03-31'
        ORDER BY freight DESC
        LIMIT 10;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Return `company_name`, `country` and `credit_limit` for customers in the Netherlands or Germany **whose credit limit is above 10000**.',
          starter: '',
          solution: "SELECT company_name, country, credit_limit FROM customers WHERE (country = 'Netherlands' OR country = 'Germany') AND credit_limit > 10000;",
          hints: ['Parentheses around the OR.', 'Or use `country IN (\'Netherlands\', \'Germany\')`.'],
          explain: 'The parentheses (or an IN list) are what make the AND apply to both countries.'
        },
        {
          prompt: 'Return `first_name`, `last_name`, `job_title` and `salary` for employees who are in department 1 and earn less than 100000, **or** who have no department at all.',
          starter: '',
          solution: 'SELECT first_name, last_name, job_title, salary FROM employees WHERE (dept_id = 1 AND salary < 100000) OR dept_id IS NULL;',
          hints: ['Group the two conditions that belong together.', 'A missing department is `dept_id IS NULL`, never `dept_id = NULL`.'],
          explain: '`dept_id = NULL` is never true — only `IS NULL` tests for absence.'
        }
      ],
      quiz: [
        {
          q: "WHERE a = 1 OR a = 2 AND b = 3 is equivalent to:",
          options: ['(a = 1 OR a = 2) AND b = 3', 'a = 1 OR (a = 2 AND b = 3)', 'It is a syntax error'],
          answer: 1,
          explain: 'AND binds tighter than OR, so the AND pair groups first.'
        }
      ]
    },

    {
      id: 'ranges-and-lists',
      title: 'BETWEEN and IN',
      lede: 'Shorthand for ranges and membership — plus the date-range trap that loses a whole day of data.',
      body: `
        ## BETWEEN is inclusive
        \`x BETWEEN a AND b\` is exactly \`x >= a AND x <= b\`. Both ends are included, and \`a\` must be the
        lower bound — \`BETWEEN 100 AND 10\` matches nothing.

        ~~~sql
        SELECT product_name, unit_price
        FROM products
        WHERE unit_price BETWEEN 50 AND 100
        ORDER BY unit_price;
        ~~~

        ## The timestamp trap
        With **date-only** values, \`BETWEEN '2025-01-01' AND '2025-01-31'\` is correct. With
        **timestamps**, \`'2025-01-31'\` compares as \`'2025-01-31 00:00:00'\`, so everything that happened
        during that last day is excluded. The robust pattern is a half-open interval:

        ~~~sql
        SELECT count(*) AS january_payments
        FROM payments
        WHERE paid_at >= '2025-01-01'
          AND paid_at <  '2025-02-01';   -- half-open: >= start, < next start
        ~~~

        Half-open intervals also compose: consecutive months never overlap and never leave a gap.

        ## IN
        \`IN\` tests membership in a list (or a subquery, module 07):

        ~~~sql
        SELECT product_name, category_id
        FROM products
        WHERE category_id IN (1, 2, 5)
        ORDER BY category_id, product_name;
        ~~~

        \`NOT IN\` is the negation — and it is dangerous when the list can contain \`NULL\`:

        ~~~sql
        -- NULL in the list makes NOT IN return no rows at all
        SELECT count(*) AS surviving_rows
        FROM products
        WHERE category_id NOT IN (1, 2, NULL);
        ~~~

        Why: \`x NOT IN (1, 2, NULL)\` expands to \`x <> 1 AND x <> 2 AND x <> NULL\`, and the last term is
        never true. This bites hard when the list comes from a subquery over a nullable column. Use
        \`NOT EXISTS\` instead (module 07).

        ## Row values
        Standard SQL compares tuples, which several engines support:

        ~~~sql
        SELECT order_id, product_id, quantity
        FROM order_items
        WHERE (order_id, product_id) IN ((1001, 6), (1002, 21))
        ORDER BY order_id;
        ~~~

        :::dialect
        - Very long \`IN\` lists are slow or capped (Oracle: 1000 items). Load the values into a temp table
          and join instead.
        - PostgreSQL has \`x = ANY(array)\` and range types; MySQL and SQL Server support \`IN\` with
          table-valued parameters.
        :::
      `,
      exercises: [
        {
          prompt: 'Return `product_name` and `units_in_stock` for products with between 50 and 150 units in stock (inclusive).',
          starter: '',
          solution: 'SELECT product_name, units_in_stock FROM products WHERE units_in_stock BETWEEN 50 AND 150;',
          requireSql: [{ pattern: 'between', msg: 'Use `BETWEEN` here — the point is the inclusive range syntax.' }],
          hints: ['`BETWEEN 50 AND 150`.'],
          explain: 'Inclusive on both ends.'
        },
        {
          prompt: 'Count the orders placed in **August 2025** as `august_orders`, using a half-open date interval.',
          starter: '',
          solution: "SELECT count(*) AS august_orders FROM orders WHERE order_date >= '2025-08-01' AND order_date < '2025-09-01';",
          forbidSql: [{ pattern: 'between', msg: 'Write it as a half-open interval (`>=` … `<`) rather than `BETWEEN`.' }],
          hints: ['`>= \'2025-08-01\' AND < \'2025-09-01\'`.'],
          explain: 'The half-open form stays correct if the column later gains a time component.'
        },
        {
          prompt: 'Return `company_name` and `country` for customers in Norway, Denmark, Sweden or Finland, ordered by `company_name`.',
          starter: '',
          solution: "SELECT company_name, country FROM customers WHERE country IN ('Norway', 'Denmark', 'Sweden', 'Finland') ORDER BY company_name;",
          orderMatters: true,
          hints: ['An `IN` list of four strings.'],
          explain: 'IN keeps long OR chains readable — and the engine can optimise it as a set lookup.'
        }
      ],
      quiz: [
        {
          q: 'created_at is a timestamp. Which filter reliably gets all of March 2025?',
          options: ["created_at BETWEEN '2025-03-01' AND '2025-03-31'", "created_at >= '2025-03-01' AND created_at < '2025-04-01'", "date(created_at) BETWEEN '2025-03-01' AND '2025-03-31'"],
          answer: 1,
          explain: 'The half-open range includes the whole last day and lets the engine use an index on created_at, unlike the date() wrapper.'
        }
      ]
    },

    {
      id: 'pattern-matching',
      title: 'LIKE, wildcards and pattern matching',
      lede: 'Searching inside text: the two wildcards everyone knows, and the performance cliff nobody mentions.',
      body: `
        ## LIKE
        Two wildcards: \`%\` matches any sequence of characters (including none), \`_\` matches exactly one.

        ~~~sql
        SELECT product_name FROM products WHERE product_name LIKE 'Pixel%';      -- starts with
        ~~~

        ~~~sql
        SELECT product_name FROM products WHERE product_name LIKE '%Dock%';      -- contains
        ~~~

        ~~~sql
        SELECT product_name FROM products WHERE product_name LIKE '%_4K';        -- ends with, any char before
        ~~~

        ## Case sensitivity
        Not portable. SQLite's \`LIKE\` is **case-insensitive for ASCII** by default; PostgreSQL's is
        case-sensitive (\`ILIKE\` is its case-insensitive variant); MySQL depends on the column collation;
        SQL Server depends on the database collation. For predictable behaviour normalise both sides with
        \`lower()\`, or state the collation.

        ## Escaping wildcards
        To search for a literal \`%\` or \`_\`, declare an escape character:

        ~~~sql
        SELECT 'discount_50' LIKE '%\\_%' ESCAPE '\\' AS has_underscore,
               'discount50'  LIKE '%\\_%' ESCAPE '\\' AS no_underscore;
        ~~~

        ## Leading wildcards cannot use an index
        \`LIKE 'Pixel%'\` can use a B-tree index on \`product_name\`: the prefix bounds the search.
        \`LIKE '%Dock%'\` cannot — every row must be examined. On a big table that is the difference
        between a millisecond and a full scan. Fixes:

        - a **full-text index** (SQLite FTS5, PostgreSQL \`tsvector\`, MySQL \`FULLTEXT\`, SQL Server FTS);
        - a **trigram index** (PostgreSQL \`pg_trgm\`);
        - storing a reversed copy of the column when you need suffix search;
        - restricting the search to a prefix in the UI.

        ## GLOB, REGEXP, SIMILAR TO
        SQLite also has \`GLOB\` (Unix shell style, case-sensitive, \`*\` and \`?\`):

        ~~~sql
        SELECT product_name FROM products WHERE product_name GLOB 'P*o*';
        ~~~

        Regular expressions are engine-specific: PostgreSQL \`~\` and \`SIMILAR TO\`, MySQL \`REGEXP\`,
        Oracle \`REGEXP_LIKE\`, SQL Server has none built in. SQLite exposes \`REGEXP\` only if the host
        application registers it — this page does not, so stick to \`LIKE\`/\`GLOB\` in exercises.
      `,
      exercises: [
        {
          prompt: 'Return `product_name` for every product whose name contains the word `Pro` (case-insensitive is fine).',
          starter: '',
          solution: "SELECT product_name FROM products WHERE product_name LIKE '%Pro%';",
          hints: ['Wildcards on both sides.'],
          explain: 'A contains-search. On a large table this is a full scan — see module 13.'
        },
        {
          prompt: 'Return `company_name` and `contact_name` for customers whose contact first name starts with `M`. (Contact names are stored as `First Last`.)',
          starter: '',
          solution: "SELECT company_name, contact_name FROM customers WHERE contact_name LIKE 'M%';",
          hints: ['A prefix pattern needs only a trailing `%`.'],
          explain: 'Prefix patterns are index-friendly, unlike `%M%`.'
        },
        {
          prompt: 'Return `email` for employees whose email contains a dot before the `@` (all of them do — write the pattern that proves it): match `%.%@%`.',
          starter: '',
          solution: "SELECT email FROM employees WHERE email LIKE '%.%@%';",
          hints: ['Three wildcards, two literal characters.'],
          explain: 'LIKE patterns are positional: literals and wildcards interleave.'
        }
      ],
      quiz: [
        {
          q: "Why is WHERE name LIKE '%son' slow on a large indexed table?",
          options: ['LIKE is always slow', 'A B-tree index is ordered by prefix, so a leading wildcard gives no starting point', 'Because it returns too many rows'],
          answer: 1,
          explain: 'Index seeks need a known prefix. Suffix or infix search needs full-text, trigram, or a reversed column.'
        }
      ]
    },

    {
      id: 'nulls',
      title: 'NULL and three-valued logic',
      lede: 'NULL is not a value — it is the absence of one. This lesson prevents a whole category of silent bugs.',
      body: `
        ## Unknown, not empty
        \`NULL\` means *no value recorded*. It is not zero, not an empty string, and not equal to another
        \`NULL\`. Any comparison with \`NULL\` yields **unknown**, a third truth value.

        ~~~sql
        SELECT NULL = NULL        AS eq,
               NULL <> NULL       AS neq,
               NULL = 0           AS eq_zero,
               NULL + 1           AS arithmetic,
               'x' || NULL        AS concatenation,
               NULL IS NULL       AS is_null;
        ~~~

        Everything but the last column is \`NULL\` (displayed as *unknown*). Only \`IS NULL\` / \`IS NOT NULL\`
        can test for absence.

        ## WHERE keeps only true
        \`WHERE\` discards both *false* and *unknown* rows. This is why a filter and its apparent negation
        do not partition the table:

        ~~~sql
        SELECT
          (SELECT count(*) FROM employees WHERE commission_pct > 0.1)  AS over,
          (SELECT count(*) FROM employees WHERE commission_pct <= 0.1) AS under,
          (SELECT count(*) FROM employees WHERE commission_pct IS NULL) AS unknown,
          (SELECT count(*) FROM employees)                              AS total;
        ~~~

        ## Truth tables
        | AND | true | false | unknown |
        | --- | --- | --- | --- |
        | **true** | true | false | unknown |
        | **false** | false | false | false |
        | **unknown** | unknown | false | unknown |

        | OR | true | false | unknown |
        | --- | --- | --- | --- |
        | **true** | true | true | true |
        | **false** | true | false | unknown |
        | **unknown** | true | unknown | unknown |

        Note \`false AND unknown = false\` and \`true OR unknown = true\`: unknown does not always propagate.

        ## Where NULLs behave differently
        | Context | Behaviour with NULL |
        | --- | --- |
        | \`WHERE\`, \`ON\`, \`HAVING\` | unknown ⇒ row dropped |
        | \`GROUP BY\` | all NULLs form **one** group |
        | \`DISTINCT\`, \`UNION\` | NULLs are treated as duplicates of each other |
        | \`ORDER BY\` | sorted together, position engine-dependent |
        | \`UNIQUE\` constraint | multiple NULLs usually allowed (several per column) |
        | \`count(col)\` | NULLs **not** counted; \`count(*)\` counts the row |
        | \`sum\`, \`avg\` | NULLs skipped — \`avg\` divides by the non-null count |
        | \`NOT IN (subquery)\` | one NULL in the subquery ⇒ no rows at all |

        ## NULL-safe equality
        When you need \`NULL = NULL\` to be true (comparing versions of a row, for example):

        - Standard / SQLite / PostgreSQL: \`a IS NOT DISTINCT FROM b\`
          (SQLite also spells it \`a IS b\`)
        - MySQL: \`a <=> b\`
        - Anywhere: \`a = b OR (a IS NULL AND b IS NULL)\`

        ~~~sql
        SELECT NULL IS NULL AS a, (NULL IS NOT DISTINCT FROM NULL) AS null_safe_eq,
               (1 IS NOT DISTINCT FROM 2) AS different;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Return `first_name`, `last_name` and `commission_pct` for employees who have **no** commission recorded.',
          starter: '',
          solution: 'SELECT first_name, last_name, commission_pct FROM employees WHERE commission_pct IS NULL;',
          requireSql: [{ pattern: 'is\\s+null', msg: 'Test for absence with `IS NULL`, not `= NULL`.' }],
          hints: ['`= NULL` is never true.'],
          explain: '16 of the 22 employees have no commission — the absence is itself the information.'
        },
        {
          prompt: 'Count the orders that have **not** shipped yet (no `ship_date`) as `unshipped`.',
          starter: '',
          solution: 'SELECT count(*) AS unshipped FROM orders WHERE ship_date IS NULL;',
          hints: ['`ship_date IS NULL`.'],
          explain: 'A NULL foreign date is the usual way to model "has not happened yet".'
        },
        {
          prompt: 'Return `company_name` and `contact_name` for all customers, but **exclude** rows where `contact_name` is missing, ordered by `company_name`.',
          starter: '',
          solution: 'SELECT company_name, contact_name FROM customers WHERE contact_name IS NOT NULL ORDER BY company_name;',
          orderMatters: true,
          hints: ['`IS NOT NULL`.'],
          explain: 'Note that `WHERE contact_name <> \'\'` would not have excluded NULLs — unknown is not true.'
        }
      ],
      quiz: [
        {
          q: 'A table has 100 rows; 10 have status = NULL. How many rows does WHERE status <> \'open\' return, if 30 rows have status = \'open\'?',
          options: ['70', '60', '90'],
          answer: 1,
          explain: '100 − 30 open − 10 unknown = 60. The NULL rows are dropped because the comparison is unknown.'
        },
        {
          q: 'avg(salary) over 10 rows where 2 salaries are NULL divides by:',
          options: ['10', '8', '10, treating NULL as 0'],
          answer: 1,
          explain: 'Aggregates ignore NULLs entirely, so avg divides by the number of non-null values.'
        }
      ]
    },

    {
      id: 'null-functions',
      title: 'COALESCE, NULLIF and friends',
      lede: 'Substituting defaults, turning values into NULL on purpose, and avoiding division by zero.',
      body: `
        ## COALESCE
        \`COALESCE(a, b, c, ...)\` returns the first argument that is not \`NULL\`. It is standard,
        variadic, and available everywhere.

        ~~~sql
        SELECT company_name,
               credit_limit,
               COALESCE(credit_limit, 0) AS credit_limit_or_zero
        FROM customers
        WHERE credit_limit IS NULL;
        ~~~

        Use it to supply display defaults and to make arithmetic safe:

        ~~~sql
        SELECT first_name,
               salary,
               commission_pct,
               round(salary * (1 + COALESCE(commission_pct, 0)), 2) AS max_pay
        FROM employees
        ORDER BY max_pay DESC
        LIMIT 6;
        ~~~

        Without the \`COALESCE\`, every employee without a commission would get \`NULL\` pay.

        ## The two-argument shorthands
        | Engine | Function |
        | --- | --- |
        | SQLite, MySQL | \`IFNULL(a, b)\` |
        | Oracle | \`NVL(a, b)\`, \`NVL2(a, if_not_null, if_null)\` |
        | SQL Server | \`ISNULL(a, b)\` |
        | Everywhere | \`COALESCE(a, b)\` ← prefer this |

        ## NULLIF
        \`NULLIF(a, b)\` returns \`NULL\` when \`a = b\`, otherwise \`a\`. Its classic use is guarding
        division:

        ~~~sql
        SELECT 10 / NULLIF(0, 0) AS safe_division;   -- NULL, not an error
        ~~~

        ~~~sql
        -- share of each category's stock that is discontinued, without dividing by zero
        SELECT category_id,
               sum(units_in_stock)                                           AS stock,
               round(100.0 * sum(CASE WHEN discontinued = 1 THEN units_in_stock ELSE 0 END)
                     / NULLIF(sum(units_in_stock), 0), 1)                     AS pct_discontinued
        FROM products
        GROUP BY category_id
        ORDER BY category_id;
        ~~~

        It is also handy for treating empty strings as missing: \`NULLIF(trim(notes), '')\`.

        :::warn Mind the type
        \`COALESCE(credit_limit, 'none')\` mixes a number and a string. Engines differ: some error,
        some coerce. Keep all branches the same type and cast explicitly if you must mix.
        :::

        :::tip Store NULL, display a default
        Resist the urge to store \`0\` or \`'unknown'\` to avoid NULLs. The sentinel silently joins
        aggregates (an unknown salary stored as 0 drags down every average), whereas \`NULL\` is excluded
        by design, and you can substitute a default at read time.
        :::
      `,
      exercises: [
        {
          prompt: 'Return `company_name`, `contact_name` and a column `contact` that shows the contact name, or the text `no contact on file` when it is missing. Order by `company_name`.',
          starter: '',
          solution: "SELECT company_name, contact_name, COALESCE(contact_name, 'no contact on file') AS contact FROM customers ORDER BY company_name;",
          orderMatters: true,
          hints: ['`COALESCE(contact_name, \'no contact on file\')`.'],
          explain: 'A read-time default: the table still records honestly that the value is unknown.'
        },
        {
          prompt: 'For each employee return `first_name`, `salary`, and `total_target` = salary plus commission (salary × commission_pct), rounded to 2 decimals. Employees without a commission should show their plain salary, never NULL.',
          starter: '',
          solution: 'SELECT first_name, salary, round(salary * (1 + COALESCE(commission_pct, 0)), 2) AS total_target FROM employees;',
          hints: ['Replace the missing commission with 0 before multiplying.'],
          explain: 'NULL propagates through arithmetic, so neutralise it at the edge of the expression.'
        },
        {
          prompt: 'For each `category_id` in `products`, return `category_id`, `products` (the number of products) and a **stock-weighted** average price as `avg_price`, rounded to 2 decimals.\n\nThat is total stock value divided by total units — and the divisor must be wrapped in `NULLIF(..., 0)` so a category with no stock yields NULL instead of an error.',
          starter: 'SELECT category_id,\n       count(*) AS products,\n       \nFROM products\nGROUP BY category_id;',
          solution: 'SELECT category_id,\n       count(*) AS products,\n       round(sum(unit_price * units_in_stock) / NULLIF(sum(units_in_stock), 0), 2) AS avg_price\nFROM products\nGROUP BY category_id;',
          requireSql: [{ pattern: 'nullif', msg: 'Use `NULLIF(sum(units_in_stock), 0)` as the divisor.' }],
          hints: ['Stock-weighted average = total value / total units.', 'Wrap the divisor in `NULLIF(..., 0)` so a zero becomes NULL instead of an error.'],
          explain: 'NULLIF turns an impossible denominator into NULL, which propagates harmlessly instead of raising an error.'
        }
      ]
    }
  ]
});
