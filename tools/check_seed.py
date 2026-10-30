import re, sqlite3, sys, pathlib
js = pathlib.Path("js/seed.js").read_text()
sql = js.split("String.raw`", 1)[1].rsplit("`;", 1)[0].replace("\\`", "`").replace("$\\{", "${")
db = sqlite3.connect(":memory:")
db.executescript(sql)
probes = {
  "tables": "SELECT count(*) FROM sqlite_master WHERE type='table'",
  "customers w/o orders": "SELECT count(*) FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.customer_id)",
  "products never ordered": "SELECT count(*) FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id=p.product_id)",
  "orders unshipped": "SELECT count(*) FROM orders WHERE ship_date IS NULL",
  "orders unpaid": "SELECT count(*) FROM orders o WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.order_id)",
  "null commission": "SELECT count(*) FROM employees WHERE commission_pct IS NULL",
  "null dept": "SELECT count(*) FROM employees WHERE dept_id IS NULL",
  "null credit_limit": "SELECT count(*) FROM customers WHERE credit_limit IS NULL",
  "null contact": "SELECT count(*) FROM customers WHERE contact_name IS NULL",
  "mgr depth": "WITH RECURSIVE t(id,d) AS (SELECT emp_id,1 FROM employees WHERE manager_id IS NULL UNION ALL SELECT e.emp_id,t.d+1 FROM employees e JOIN t ON e.manager_id=t.id) SELECT max(d) FROM t",
  "revenue": "SELECT round(sum(unit_price*quantity*(1-discount)),2) FROM order_items",
  "countries": "SELECT count(DISTINCT country) FROM customers",
  "date range": "SELECT min(order_date)||' .. '||max(order_date) FROM orders",
  "login islands": "SELECT count(*) FROM (SELECT customer_id, login_date, date(login_date, '-'||ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY login_date)||' days') g FROM logins GROUP BY 1,2,3) ",
  "ties in salary": "SELECT count(*) FROM (SELECT salary FROM employees GROUP BY salary HAVING count(*)>1)",
  "fk violations": "PRAGMA foreign_key_check",
}
for k, v in probes.items():
    try:
        print(f"{k:24} {db.execute(v).fetchall()[:3]}")
    except Exception as e:
        print(f"{k:24} ERROR {e}")
