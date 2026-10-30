(window.CURRICULUM = window.CURRICULUM || []).push({
  id: 'expressions',
  title: 'Types, expressions and functions',
  blurb: 'Numbers, text, dates, CASE and type conversion — the per-row toolkit.',
  lessons: [

    {
      id: 'types-and-affinity',
      title: 'Data types, affinity and CAST',
      lede: 'What a column can hold, what the engine does when you mix types, and how to convert on purpose.',
      body: `
        ## The families
        Every engine offers the same broad families, under different names:

        | Family | Typical types | Notes |
        | --- | --- | --- |
        | Exact integers | \`SMALLINT\`, \`INT\`, \`BIGINT\` | ids, counts |
        | Exact decimals | \`NUMERIC(p,s)\`, \`DECIMAL(p,s)\` | **money** |
        | Approximate | \`REAL\`, \`FLOAT\`, \`DOUBLE PRECISION\` | measurements, never money |
        | Text | \`CHAR(n)\`, \`VARCHAR(n)\`, \`TEXT\` | \`CHAR\` pads with spaces |
        | Date/time | \`DATE\`, \`TIME\`, \`TIMESTAMP\`, \`TIMESTAMPTZ\`, \`INTERVAL\` | see the dates lesson |
        | Boolean | \`BOOLEAN\` | PostgreSQL real, others emulate with 0/1 |
        | Binary | \`BLOB\`, \`BYTEA\`, \`VARBINARY\` | files, hashes |
        | Semi-structured | \`JSON\`, \`JSONB\`, \`XML\`, arrays | module 14 |
        | Identity | \`UUID\`, \`SERIAL\`, \`IDENTITY\` | module 09 |

        ## Floating point is not money
        \`REAL\` cannot represent \`0.1\` exactly, so sums drift:

        ~~~sql
        SELECT 0.1 + 0.2 = 0.3           AS looks_wrong,
               round(0.1 + 0.2, 10)       AS the_sum,
               0.1 + 0.2 - 0.3            AS residue;
        ~~~

        For currency use \`NUMERIC(12,2)\` (PostgreSQL, SQL Server, MySQL, Oracle all have exact decimals),
        or store integer minor units (cents). SQLite has no exact decimal type at all — one reason this
        course rounds money for display rather than relying on stored precision.

        ## SQLite's type affinity
        Most engines are **strictly typed**: putting \`'abc'\` in an \`INTEGER\` column is an error.
        SQLite is different — a column has an *affinity* (a preference), and almost any value can go
        anywhere.

        ~~~sql
        SELECT typeof(1), typeof(1.0), typeof('1'), typeof(NULL), typeof(x'00ff');
        ~~~

        That flexibility is why the exercises here cannot show you a type error that PostgreSQL would
        raise. Since 3.37 SQLite offers \`CREATE TABLE ... STRICT\` to get conventional behaviour.

        ## CAST
        \`CAST(expr AS type)\` converts explicitly:

        ~~~sql
        SELECT CAST('42' AS INTEGER) + 1       AS text_to_int,
               CAST(7 AS REAL) / 2             AS real_division,
               CAST(9.99 AS INTEGER)           AS truncated,
               CAST(12345 AS TEXT) || '!'      AS int_to_text;
        ~~~

        \`CAST\` to an integer **truncates** toward zero; it does not round. Use \`round()\` first when
        you want rounding.

        ## Implicit conversion
        Mixing types makes the engine coerce one side, and the rules differ per engine. Two habits avoid
        all of it:

        1. Compare like with like — never \`WHERE id = '42'\` on an integer column. Beyond correctness,
           a type mismatch can disable an index (module 13).
        2. Cast explicitly when you really do mean to convert.

        :::dialect Casting syntax
        - Standard, everywhere: \`CAST(x AS INTEGER)\`
        - PostgreSQL shorthand: \`x::integer\`
        - SQL Server: \`CONVERT(int, x)\` plus style codes for dates
        - MySQL: \`CAST(x AS SIGNED)\` / \`UNSIGNED\` instead of \`INTEGER\`
        - Safe variants that return NULL instead of failing: \`TRY_CAST\` (SQL Server, Oracle 12c+),
          \`TRY_CONVERT\` (SQL Server). PostgreSQL has no TRY_CAST — validate first.
        :::
      `,
      exercises: [
        {
          prompt: 'Return the text `\'2025\'` converted to an integer plus one, as `next_year`.',
          starter: '',
          solution: "SELECT CAST('2025' AS INTEGER) + 1 AS next_year;",
          requireSql: [{ pattern: 'cast', msg: 'Use `CAST(... AS INTEGER)` — the point is the explicit conversion.' }],
          hints: ["`CAST('2025' AS INTEGER)`."],
          explain: 'Explicit casts document intent and behave the same across engines.'
        },
        {
          prompt: 'The expression `sum(units_in_stock) / count(*)` on `products` does integer division. Return `category_id`, that integer result as `int_avg`, and a correct decimal average rounded to 2 as `real_avg`, grouped by `category_id` and ordered by `category_id`.',
          starter: 'SELECT category_id\nFROM products\nGROUP BY category_id\nORDER BY category_id;',
          solution: 'SELECT category_id,\n       sum(units_in_stock) / count(*) AS int_avg,\n       round(CAST(sum(units_in_stock) AS REAL) / count(*), 2) AS real_avg\nFROM products\nGROUP BY category_id\nORDER BY category_id;',
          orderMatters: true,
          hints: ['Integer / integer gives an integer in SQLite, PostgreSQL, SQL Server and Oracle.', 'Cast one side to `REAL` (or multiply by `1.0`) to force decimal division.'],
          explain: 'Forcing one operand to a decimal type is the portable fix for integer division.'
        }
      ],
      quiz: [
        {
          q: 'Which type should hold an invoice total?',
          options: ['REAL / DOUBLE', 'NUMERIC(12,2) or integer cents', 'FLOAT with rounding on output'],
          answer: 1,
          explain: 'Binary floating point cannot represent decimal fractions exactly; errors accumulate over sums.'
        }
      ]
    },

    {
      id: 'numbers',
      title: 'Arithmetic and numeric functions',
      lede: 'Operators, integer division, rounding, and computing shares and percentages correctly.',
      body: `
        ## Operators
        \`+\`, \`-\`, \`*\`, \`/\`, and \`%\` (modulo; \`MOD(a,b)\` in Oracle). Precedence is the usual
        \`*\`,\`/\`,\`%\` before \`+\`,\`-\`; parenthesise anything non-obvious.

        ## Integer division truncates
        ~~~sql
        SELECT 7 / 2 AS integer_division, 7 / 2.0 AS decimal_division, 7 % 2 AS remainder;
        ~~~

        This silently destroys percentages. The standard fix is to multiply by \`100.0\` (a decimal literal)
        rather than \`100\`:

        ~~~sql
        SELECT status,
               count(*)                                              AS orders,
               round(100.0 * count(*) / (SELECT count(*) FROM orders), 1) AS pct
        FROM orders
        GROUP BY status
        ORDER BY orders DESC;
        ~~~

        ## Rounding
        | Function | Does |
        | --- | --- |
        | \`round(x)\`, \`round(x, n)\` | round half away from zero (engines differ on halves) |
        | \`abs(x)\` | absolute value |
        | \`ceil(x)\` / \`ceiling(x)\` | up to the next integer |
        | \`floor(x)\` | down |
        | \`trunc(x, n)\` | cut digits without rounding |
        | \`sign(x)\` | -1, 0 or 1 |
        | \`power(x, y)\`, \`sqrt(x)\`, \`exp\`, \`ln\`, \`log\` | maths |
        | \`random()\` | random value (name and range vary) |

        SQLite needs \`-DSQLITE_ENABLE_MATH_FUNCTIONS\` for \`ceil\`/\`floor\`; this build has them:

        ~~~sql
        SELECT round(2.5) AS r_half, round(-2.5) AS r_neg, round(2.345, 2) AS r2,
               abs(-7) AS a, ceil(1.2) AS c, floor(1.8) AS f, 17 % 5 AS m;
        ~~~

        ## Bankers' rounding differs
        \`round(0.5)\` is 1 in SQLite, PostgreSQL (for \`numeric\`) and Oracle, but PostgreSQL rounds
        \`double precision\` half-to-even, and SQL Server/MySQL have their own rules. If a financial
        total must match to the cent across systems, do the rounding in one place, with an exact decimal type.

        ## Division by zero
        - SQLite: returns \`NULL\`
        - PostgreSQL, SQL Server, Oracle: **error**
        - MySQL: \`NULL\` (or error in strict mode)

        Write \`x / NULLIF(y, 0)\` and you get \`NULL\` everywhere, deterministically.

        ## Money arithmetic in this dataset
        A line total is price × quantity × (1 − discount):

        ~~~sql
        SELECT i.order_id, i.product_id, i.unit_price, i.quantity, i.discount,
               round(i.unit_price * i.quantity * (1 - i.discount), 2) AS line_total
        FROM order_items i
        ORDER BY line_total DESC
        LIMIT 8;
        ~~~
      `,
      exercises: [
        {
          prompt: 'For each `order_id` in `order_items`, return the order id and `order_value` = sum of `unit_price * quantity * (1 - discount)` rounded to 2 decimals, for the 5 largest orders, biggest first.',
          starter: '',
          solution: 'SELECT order_id, round(sum(unit_price * quantity * (1 - discount)), 2) AS order_value\nFROM order_items\nGROUP BY order_id\nORDER BY order_value DESC\nLIMIT 5;',
          orderMatters: true,
          hints: ['Group by `order_id`, sum the line expression.', 'Round the sum, not each line, to avoid accumulating rounding error.'],
          explain: 'Rounding once at the end keeps the total consistent with the sum of unrounded lines.'
        },
        {
          prompt: 'Return each `country` from `customers`, the number of customers as `customers`, and their share of all customers as `pct` (one decimal place), biggest share first, then country alphabetically.',
          starter: '',
          solution: 'SELECT country, count(*) AS customers,\n       round(100.0 * count(*) / (SELECT count(*) FROM customers), 1) AS pct\nFROM customers\nGROUP BY country\nORDER BY customers DESC, country;',
          orderMatters: true,
          hints: ['Multiply by `100.0`, not `100`.', 'The denominator is a scalar subquery over the whole table.'],
          explain: 'A scalar subquery is the simplest way to get a whole-table total next to grouped counts; module 08 shows the window-function version.'
        },
        {
          prompt: 'Return `product_name`, `unit_price` and `price_per_10` = the price of ten units **after** a 15% bulk discount, rounded to 2 decimals, for products over 300. Order by `unit_price` descending.',
          starter: '',
          solution: 'SELECT product_name, unit_price, round(unit_price * 10 * 0.85, 2) AS price_per_10\nFROM products\nWHERE unit_price > 300\nORDER BY unit_price DESC;',
          orderMatters: true,
          hints: ['A 15% discount multiplies by `0.85`.'],
          explain: 'Expressing discounts as multipliers avoids sign mistakes and chains cleanly.'
        }
      ]
    },

    {
      id: 'strings',
      title: 'Working with text',
      lede: 'Concatenating, slicing, searching, padding and formatting strings.',
      body: `
        ## The core set
        | Need | SQLite / standard | Notes |
        | --- | --- | --- |
        | join | \`a || b\`, \`concat(a, b)\` | \`||\` is \`OR\` in MySQL |
        | length | \`length(s)\` | characters; \`octet_length\` for bytes |
        | case | \`upper(s)\`, \`lower(s)\` | ASCII-only in plain SQLite |
        | slice | \`substr(s, start, len)\` | \`substring(s FROM a FOR b)\` is the standard spelling; **1-based** |
        | trim | \`trim(s)\`, \`ltrim\`, \`rtrim\`, \`trim(s, 'xy')\` | |
        | replace | \`replace(s, from, to)\` | |
        | find | \`instr(s, needle)\` | \`position\`, \`charindex\`, \`locate\` elsewhere; 0 = not found |
        | pad | \`printf('%-10s', s)\` | \`lpad\`/\`rpad\` in most engines |
        | format | \`printf('%.2f', x)\`, \`format(...)\` | \`to_char\` in PostgreSQL/Oracle |
        | reverse | — | \`reverse()\` in PostgreSQL/MySQL/SQL Server |
        | split | — | \`split_part\`, \`string_to_array\`, \`SUBSTRING_INDEX\`, \`STRING_SPLIT\` |

        Indexes are **1-based**, and a negative start counts from the end in SQLite:

        ~~~sql
        SELECT substr('hardware', 1, 4)  AS first4,
               substr('hardware', 5)     AS rest,
               substr('hardware', -4)    AS last4,
               length('hardware')        AS len,
               instr('hardware', 'war')  AS pos;
        ~~~

        ## Splitting a name
        No portable split function exists, so combine \`instr\` and \`substr\`:

        ~~~sql
        SELECT contact_name,
               substr(contact_name, 1, instr(contact_name, ' ') - 1) AS first_name,
               substr(contact_name, instr(contact_name, ' ') + 1)    AS last_name
        FROM customers
        WHERE contact_name IS NOT NULL
        LIMIT 8;
        ~~~

        This is also an argument for storing name parts separately: parsing text on every read is both
        slow and fragile (middle names, single-word names, \`NULL\`).

        ## Formatting
        \`printf\` (SQLite, also \`format()\` since 3.38) builds fixed-width or fixed-decimal output:

        ~~~sql
        SELECT printf('%-24s %8.2f EUR', product_name, unit_price) AS price_line
        FROM products
        ORDER BY unit_price DESC
        LIMIT 6;
        ~~~

        ## Building keys and labels
        ~~~sql
        SELECT o.order_id,
               'ORD-' || printf('%06d', o.order_id) AS reference,
               upper(substr(c.country, 1, 2)) || '-' || c.customer_id AS customer_code
        FROM orders o JOIN customers c USING (customer_id)
        LIMIT 5;
        ~~~

        :::warn NULL contaminates concatenation
        \`'a' || NULL\` is \`NULL\` in standard SQL (SQLite, PostgreSQL, Oracle — Oracle treats \`NULL\`
        as empty for \`||\`). MySQL's and SQL Server's \`CONCAT\` ignore NULLs instead. Wrap nullable
        parts in \`COALESCE(x, '')\` to be safe everywhere.
        :::
      `,
      exercises: [
        {
          prompt: 'Return for each employee a column `label` of the form `Kowalski, Ada` (last name, comma, space, first name), ordered by `label`.',
          starter: '',
          solution: "SELECT last_name || ', ' || first_name AS label FROM employees ORDER BY label;",
          orderMatters: true,
          hints: ['Two `||` operators and one literal.'],
          explain: 'Formatting at read time keeps the stored columns atomic.'
        },
        {
          prompt: 'From `customers`, return `contact_name` and `first_word` — everything before the first space — for customers that have a contact name. Order by `contact_name`.',
          starter: '',
          solution: "SELECT contact_name, substr(contact_name, 1, instr(contact_name, ' ') - 1) AS first_word\nFROM customers\nWHERE contact_name IS NOT NULL\nORDER BY contact_name;",
          orderMatters: true,
          hints: ['`instr(s, \' \')` gives the 1-based position of the space.', 'Take `instr(...) - 1` characters from position 1.'],
          explain: 'instr + substr is the portable substitute for a split function.'
        },
        {
          prompt: 'Return `product_name` and `initials` — the first letter of the product name in upper case followed by a dot — plus `name_length`, for products in category 1. Order by `product_name`.',
          starter: '',
          solution: "SELECT product_name, upper(substr(product_name, 1, 1)) || '.' AS initials, length(product_name) AS name_length\nFROM products\nWHERE category_id = 1\nORDER BY product_name;",
          orderMatters: true,
          hints: ['`substr(x, 1, 1)` is the first character.'],
          explain: 'Composing two or three string functions covers most text needs without regular expressions.'
        }
      ]
    },

    {
      id: 'dates',
      title: 'Dates and times',
      lede: 'Storing instants, extracting parts, doing arithmetic, and bucketing by period.',
      body: `
        ## Store them properly
        Store a date as a date/timestamp type (or ISO-8601 text in SQLite: \`YYYY-MM-DD\` /
        \`YYYY-MM-DD HH:MM:SS\`). Never as \`'03/04/2025'\` — ambiguous — and never as a localised string.

        For instants that cross time zones, store UTC (\`TIMESTAMPTZ\` in PostgreSQL,
        \`datetime2\` + explicit UTC convention in SQL Server) and convert for display only.
        A *calendar date* like a birthday is **not** an instant and should stay a \`DATE\`.

        ## SQLite's date toolkit
        SQLite has five functions; all accept modifiers:

        ~~~sql
        SELECT date('now')                              AS today,
               datetime('now')                          AS now_utc,
               date('now', 'start of month')            AS month_start,
               date('now', '+1 month', '-1 day')        AS month_end,
               strftime('%Y-%m', 'now')                 AS year_month,
               strftime('%w', '2025-03-14')             AS weekday_0_sunday,
               julianday('2025-12-25') - julianday('now') AS days_to_christmas;
        ~~~

        \`strftime\` format codes: \`%Y\` year, \`%m\` month, \`%d\` day, \`%H:%M:%S\` time,
        \`%j\` day of year, \`%W\` week, \`%w\` weekday, \`%s\` unix epoch.

        ## Extracting parts
        ~~~sql
        SELECT order_id, order_date,
               strftime('%Y', order_date) AS yr,
               strftime('%m', order_date) AS mon,
               strftime('%Y-%m', order_date) AS month_bucket
        FROM orders
        ORDER BY order_date
        LIMIT 5;
        ~~~

        The portable concept is \`EXTRACT(YEAR FROM order_date)\` (PostgreSQL, MySQL, Oracle),
        \`DATEPART(year, d)\` in SQL Server, and \`date_trunc('month', d)\` for bucketing
        (PostgreSQL; \`DATE_FORMAT\` in MySQL, \`DATETRUNC\` in SQL Server 2022+, \`TRUNC\` in Oracle).

        ## Differences and arithmetic
        | Need | SQLite | PostgreSQL | MySQL | SQL Server |
        | --- | --- | --- | --- | --- |
        | add days | \`date(d, '+7 days')\` | \`d + INTERVAL '7 days'\` | \`DATE_ADD(d, INTERVAL 7 DAY)\` | \`DATEADD(day, 7, d)\` |
        | days between | \`julianday(a) - julianday(b)\` | \`a - b\` | \`DATEDIFF(a, b)\` | \`DATEDIFF(day, b, a)\` |
        | truncate to month | \`date(d, 'start of month')\` | \`date_trunc('month', d)\` | \`DATE_FORMAT(d, '%Y-%m-01')\` | \`DATETRUNC(month, d)\` |

        ~~~sql
        -- how long did shipping take?
        SELECT order_id, order_date, ship_date,
               CAST(julianday(ship_date) - julianday(order_date) AS INTEGER) AS days_to_ship
        FROM orders
        WHERE ship_date IS NOT NULL
        ORDER BY days_to_ship DESC
        LIMIT 8;
        ~~~

        ## Grouping by period
        ~~~sql
        SELECT strftime('%Y-%m', order_date) AS month,
               count(*)                      AS orders,
               round(sum(freight), 2)        AS freight
        FROM orders
        GROUP BY month
        ORDER BY month;
        ~~~

        :::warn Functions on columns block indexes
        \`WHERE strftime('%Y', order_date) = '2025'\` scans everything. Write
        \`WHERE order_date >= '2025-01-01' AND order_date < '2026-01-01'\` so an index on
        \`order_date\` can be used (module 13). Group-by expressions are fine; *filters* are what matter.
        :::
      `,
      exercises: [
        {
          prompt: 'Return `emp_id`, `hire_date` and `years_served` — whole years between the hire date and 2025-10-01 — for employees hired before 2018, longest service first. Use `julianday` and integer-truncate the result (365.25 days per year).',
          starter: '',
          solution: "SELECT emp_id, hire_date,\n       CAST((julianday('2025-10-01') - julianday(hire_date)) / 365.25 AS INTEGER) AS years_served\nFROM employees\nWHERE hire_date < '2018-01-01'\nORDER BY hire_date;",
          orderMatters: false,
          hints: ['`julianday(a) - julianday(b)` gives days as a float.', 'Divide by 365.25 then `CAST(... AS INTEGER)`.'],
          explain: 'Exact calendar-year differences need the engine’s own age function (`age()`, `TIMESTAMPDIFF`, `DATEDIFF(year, ...)`); the 365.25 approximation is the portable stand-in.'
        },
        {
          prompt: 'Count orders per calendar month: return `month` as `YYYY-MM` and `orders`, ordered by month.',
          starter: '',
          solution: "SELECT strftime('%Y-%m', order_date) AS month, count(*) AS orders\nFROM orders\nGROUP BY month\nORDER BY month;",
          orderMatters: true,
          hints: ["`strftime('%Y-%m', order_date)` makes the bucket."],
          explain: 'Bucketing by a derived string is the standard time-series grouping; module 14 covers filling the gaps where a month has no rows.'
        },
        {
          prompt: 'Return `order_id`, `order_date`, `ship_date` and `days_to_ship` for the 10 slowest shipments (orders that did ship), slowest first.',
          starter: '',
          solution: 'SELECT order_id, order_date, ship_date,\n       CAST(julianday(ship_date) - julianday(order_date) AS INTEGER) AS days_to_ship\nFROM orders\nWHERE ship_date IS NOT NULL\nORDER BY days_to_ship DESC, order_id\nLIMIT 10;',
          orderMatters: true,
          hints: ['Exclude unshipped orders explicitly — NULL arithmetic gives NULL.', 'Add `order_id` as a tie-breaker so the order is deterministic.'],
          explain: 'Ties are common in day counts, so a unique tie-breaker is what makes a top-N list reproducible.'
        }
      ],
      quiz: [
        {
          q: 'Why store timestamps in UTC?',
          options: ['UTC is faster to compare', 'Local times are ambiguous across DST changes and zones', 'Only UTC supports indexes'],
          answer: 1,
          explain: 'A local wall-clock time can occur twice or not at all around DST transitions; UTC is monotone and convertible.'
        }
      ]
    },

    {
      id: 'case',
      title: 'CASE: conditional logic',
      lede: 'The if/else of SQL — for labels, bucketing, conditional aggregation and controlled evaluation order.',
      body: `
        ## Two forms
        **Searched** \`CASE\` evaluates predicates in order and returns the first match:

        ~~~sql
        SELECT product_name, unit_price,
               CASE
                 WHEN unit_price < 50  THEN 'budget'
                 WHEN unit_price < 200 THEN 'mid'
                 WHEN unit_price < 500 THEN 'premium'
                 ELSE 'flagship'
               END AS price_band
        FROM products
        ORDER BY unit_price;
        ~~~

        **Simple** \`CASE\` compares one expression against values:

        ~~~sql
        SELECT status,
               CASE status
                 WHEN 'pending'   THEN 'waiting on us'
                 WHEN 'shipped'   THEN 'in transit'
                 WHEN 'delivered' THEN 'done'
                 ELSE 'closed'
               END AS plain_english,
               count(*) AS orders
        FROM orders
        GROUP BY status;
        ~~~

        Rules worth remembering:

        - Order matters — the first true branch wins, so put narrower conditions first.
        - Without \`ELSE\`, unmatched rows get \`NULL\`.
        - All branches should return the same type.
        - The simple form uses \`=\`, so it can never match \`NULL\`. Use the searched form with
          \`WHEN x IS NULL\`.

        ## Conditional aggregation
        This is the pattern that turns rows into columns (a pivot, module 14):

        ~~~sql
        SELECT c.country,
               count(*)                                                      AS orders,
               sum(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END)        AS cancelled,
               round(100.0 * sum(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END)
                     / count(*), 1)                                          AS cancel_pct
        FROM orders o
        JOIN customers c USING (customer_id)
        GROUP BY c.country
        HAVING count(*) >= 10
        ORDER BY cancel_pct DESC;
        ~~~

        \`count(CASE WHEN cond THEN 1 END)\` works too — \`NULL\` branches are not counted. Standard SQL
        has a dedicated spelling, \`count(*) FILTER (WHERE cond)\`, supported by SQLite and PostgreSQL
        (module 04).

        ## CASE guarantees evaluation order
        Unlike \`AND\`/\`OR\`, \`CASE\` branches are evaluated in sequence, so it is the safe way to guard
        an expression:

        ~~~sql
        SELECT CASE WHEN 0 = 0 THEN 'guarded' ELSE 10 / 0 END AS never_divides;
        ~~~

        ## Shorthands
        \`IIF(cond, a, b)\` exists in SQLite ≥ 3.32 and SQL Server; MySQL spells it \`IF(cond, a, b)\`;
        PostgreSQL has no shorthand. All are sugar for a two-branch \`CASE\`.

        ~~~sql
        SELECT product_name, IIF(discontinued = 1, 'retired', 'active') AS lifecycle
        FROM products
        LIMIT 5;
        ~~~
      `,
      exercises: [
        {
          prompt: 'Return `emp_id`, `salary` and `band`: `\'junior\'` under 70000, `\'mid\'` under 120000, `\'senior\'` otherwise. Order by `salary`.',
          starter: '',
          solution: "SELECT emp_id, salary,\n       CASE WHEN salary < 70000 THEN 'junior'\n            WHEN salary < 120000 THEN 'mid'\n            ELSE 'senior' END AS band\nFROM employees\nORDER BY salary;",
          orderMatters: false,
          hints: ['Searched CASE with two WHENs and an ELSE.', 'Thresholds are exclusive, and the first matching branch wins.'],
          explain: 'Ordered thresholds mean you never need compound conditions like `BETWEEN 70000 AND 119999`.'
        },
        {
          prompt: 'For each `status` in `orders`, return `status`, `orders` (row count) and `shipped_count` — how many of those orders have a `ship_date` — using conditional aggregation. Order by `status`.',
          starter: '',
          solution: 'SELECT status, count(*) AS orders,\n       sum(CASE WHEN ship_date IS NOT NULL THEN 1 ELSE 0 END) AS shipped_count\nFROM orders\nGROUP BY status\nORDER BY status;',
          orderMatters: true,
          requireSql: [{ pattern: 'case', msg: 'Use a `CASE` expression inside the aggregate.' }],
          hints: ['`sum(CASE WHEN ... THEN 1 ELSE 0 END)`.'],
          explain: 'Conditional aggregation computes several differently-filtered measures in one pass over the data.'
        },
        {
          prompt: 'Return `customer_id`, `credit_limit` and `tier`: `\'unknown\'` when the limit is NULL, `\'small\'` under 15000, `\'large\'` otherwise. Order by `customer_id`.',
          starter: '',
          solution: "SELECT customer_id, credit_limit,\n       CASE WHEN credit_limit IS NULL THEN 'unknown'\n            WHEN credit_limit < 15000 THEN 'small'\n            ELSE 'large' END AS tier\nFROM customers\nORDER BY customer_id;",
          orderMatters: true,
          hints: ['Test for NULL **first** — a comparison against NULL is never true.'],
          explain: 'Handling NULL in the first branch is the habit that keeps CASE expressions total.'
        }
      ],
      quiz: [
        {
          q: "CASE x WHEN NULL THEN 'missing' ELSE 'present' END returns, for x = NULL:",
          options: ["'missing'", "'present'", 'NULL'],
          answer: 1,
          explain: 'The simple form compares with =, and NULL = NULL is unknown, so the ELSE branch runs. Use WHEN x IS NULL in the searched form.'
        }
      ]
    },

    {
      id: 'text-cleaning',
      title: 'Cleaning messy data',
      lede: 'A practical pass over a staging table: trimming, normalising case, and spotting duplicates.',
      body: `
        ## The table
        \`staging_customers\` is what a CSV import looks like before anyone cleans it: inconsistent case,
        trailing spaces, missing values, and the same company loaded twice.

        ~~~sql
        SELECT * FROM staging_customers ORDER BY row_id;
        ~~~

        ## Normalise before comparing
        Two values that differ only in case or whitespace are the same business fact. Build a
        **canonical form** and compare that:

        ~~~sql
        SELECT row_id,
               company_name,
               lower(trim(company_name)) AS canonical_name,
               lower(trim(email))        AS canonical_email
        FROM staging_customers
        ORDER BY canonical_name, row_id;
        ~~~

        \`trim()\` removes spaces from both ends; \`trim(s, '.,')\` removes the given characters;
        \`replace(s, ' ', '')\` removes them everywhere, which is useful for phone numbers and postcodes.

        ## Finding duplicates
        Group by the canonical value and keep groups with more than one row:

        ~~~sql
        SELECT lower(trim(company_name)) AS canonical_name,
               count(*)                  AS copies,
               min(row_id)               AS keep_row,
               max(row_id)               AS drop_row
        FROM staging_customers
        GROUP BY canonical_name
        HAVING count(*) > 1
        ORDER BY canonical_name;
        ~~~

        \`min(row_id)\` is a simple "keep the first one loaded" rule. Module 08 shows
        \`ROW_NUMBER()\`, which generalises to "keep the newest per key" and other tie-breaks.

        ## Empty string is not NULL
        An import often writes \`''\` where a value was missing. Convert it at load time:

        ~~~sql
        SELECT row_id, email, NULLIF(trim(COALESCE(email, '')), '') AS email_clean
        FROM staging_customers
        ORDER BY row_id;
        ~~~

        :::tip Clean on the way in
        Normalise once, at load time, into a column you can index and constrain
        (\`UNIQUE(canonical_email)\`). Cleaning in every read query is slower, easy to forget in one place,
        and cannot stop the bad row from arriving.
        :::
      `,
      exercises: [
        {
          prompt: 'From `staging_customers`, return `canonical_name` (lower-cased, trimmed `company_name`) and `copies` for every name that was loaded more than once, ordered by `canonical_name`.',
          starter: '',
          solution: 'SELECT lower(trim(company_name)) AS canonical_name, count(*) AS copies\nFROM staging_customers\nGROUP BY canonical_name\nHAVING count(*) > 1\nORDER BY canonical_name;',
          orderMatters: true,
          hints: ['Group by the cleaned expression, not the raw column.', '`HAVING count(*) > 1` keeps only duplicated groups.'],
          explain: 'Grouping by a normalised expression is the standard duplicate hunt.'
        },
        {
          prompt: 'Return the `row_id`s you would **keep** if the rule is "keep the lowest `row_id` per canonical company name": one column `keep_row_id`, ascending.',
          starter: '',
          solution: 'SELECT min(row_id) AS keep_row_id\nFROM staging_customers\nGROUP BY lower(trim(company_name))\nORDER BY keep_row_id;',
          orderMatters: true,
          hints: ['`min(row_id)` per group.', 'You can GROUP BY an expression without selecting it.'],
          explain: 'This set is exactly what you would feed into `DELETE ... WHERE row_id NOT IN (...)` — see module 10.'
        },
        {
          prompt: 'Return `row_id`, `city` and `city_clean` — trimmed and with only the first letter capitalised (e.g. `paris` and `PARIS` both become `Paris`) — from `staging_customers`, ordered by `row_id`.',
          starter: '',
          solution: "SELECT row_id, city,\n       upper(substr(trim(city), 1, 1)) || lower(substr(trim(city), 2)) AS city_clean\nFROM staging_customers\nORDER BY row_id;",
          orderMatters: true,
          hints: ['Capitalise: upper of the first character, lower of the rest.', 'Trim before slicing, or a leading space becomes the "first letter".'],
          explain: 'There is no portable `initcap` (PostgreSQL and Oracle have one), so this composition is the general recipe.'
        }
      ]
    }
  ]
});
