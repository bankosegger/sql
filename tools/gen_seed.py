"""Generates js/seed.js (the course practice database) deterministically.

Dimension rows are hand-curated for readability; fact rows are generated so the
dataset is big enough for aggregation, window and time-series lessons.
Run: python3 tools/gen_seed.py
"""
import random
from datetime import date, timedelta
from pathlib import Path

random.seed(42)
OUT = Path(__file__).resolve().parent.parent / "js" / "seed.js"

def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"

def rows(table, cols, data):
    head = f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n"
    body = ",\n".join("  (" + ", ".join(q(v) for v in r) + ")" for r in data)
    return head + body + ";\n\n"

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE departments (
  dept_id    INTEGER PRIMARY KEY,
  dept_name  TEXT    NOT NULL UNIQUE,
  location   TEXT    NOT NULL,
  budget     NUMERIC NOT NULL CHECK (budget > 0)
);

CREATE TABLE employees (
  emp_id         INTEGER PRIMARY KEY,
  first_name     TEXT    NOT NULL,
  last_name      TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE,
  job_title      TEXT    NOT NULL,
  hire_date      TEXT    NOT NULL,
  salary         NUMERIC NOT NULL CHECK (salary > 0),
  commission_pct NUMERIC,
  manager_id     INTEGER REFERENCES employees(emp_id),
  dept_id        INTEGER REFERENCES departments(dept_id)
);

CREATE TABLE categories (
  category_id   INTEGER PRIMARY KEY,
  category_name TEXT NOT NULL UNIQUE,
  description   TEXT
);

CREATE TABLE suppliers (
  supplier_id   INTEGER PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  country       TEXT NOT NULL,
  rating        INTEGER
);

CREATE TABLE products (
  product_id     INTEGER PRIMARY KEY,
  product_name   TEXT    NOT NULL,
  category_id    INTEGER REFERENCES categories(category_id),
  supplier_id    INTEGER REFERENCES suppliers(supplier_id),
  unit_price     NUMERIC NOT NULL CHECK (unit_price >= 0),
  units_in_stock INTEGER NOT NULL DEFAULT 0,
  discontinued   INTEGER NOT NULL DEFAULT 0 CHECK (discontinued IN (0, 1))
);

CREATE TABLE customers (
  customer_id  INTEGER PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  city         TEXT NOT NULL,
  country      TEXT NOT NULL,
  signup_date  TEXT NOT NULL,
  credit_limit NUMERIC
);

CREATE TABLE orders (
  order_id    INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  emp_id      INTEGER REFERENCES employees(emp_id),
  order_date  TEXT    NOT NULL,
  ship_date   TEXT,
  status      TEXT    NOT NULL CHECK (status IN ('pending', 'shipped', 'delivered', 'cancelled')),
  freight     NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE order_items (
  order_id   INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  unit_price NUMERIC NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  discount   NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE payments (
  payment_id INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(order_id),
  paid_at    TEXT    NOT NULL,
  amount     NUMERIC NOT NULL,
  method     TEXT    NOT NULL
);

CREATE TABLE reviews (
  review_id   INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(product_id),
  customer_id INTEGER REFERENCES customers(customer_id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TEXT    NOT NULL
);

-- Daily activity, used by the gaps-and-islands and cohort lessons.
CREATE TABLE logins (
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  login_date  TEXT    NOT NULL,
  PRIMARY KEY (customer_id, login_date)
);

-- Deliberately messy: duplicates and inconsistent casing, for the cleanup lessons.
CREATE TABLE staging_customers (
  row_id       INTEGER PRIMARY KEY,
  company_name TEXT,
  email        TEXT,
  city         TEXT,
  loaded_at    TEXT
);

-- JSON documents, for the semi-structured data lesson.
CREATE TABLE product_specs (
  product_id INTEGER PRIMARY KEY REFERENCES products(product_id),
  specs      TEXT NOT NULL
);

"""

DEPARTMENTS = [
    (1, "Engineering", "Berlin", 2400000),
    (2, "Sales", "London", 1800000),
    (3, "Marketing", "London", 900000),
    (4, "Support", "Lisbon", 650000),
    (5, "Finance", "Berlin", 700000),
    (6, "Logistics", "Rotterdam", 1200000),
]

# (id, first, last, title, hire_date, salary, commission, manager, dept)
EMPLOYEES = [
    (1, "Ada", "Kowalski", "CEO", "2014-03-01", 240000, None, None, None),
    (2, "Bruno", "Marchetti", "VP Engineering", "2015-06-15", 185000, None, 1, 1),
    (3, "Chiara", "Oduya", "VP Sales", "2015-09-01", 175000, 0.10, 1, 2),
    (4, "Dmitri", "Haugen", "Engineering Manager", "2017-01-09", 142000, None, 2, 1),
    (5, "Elif", "Ramos", "Senior Engineer", "2018-04-23", 128000, None, 4, 1),
    (6, "Farid", "Nakamura", "Engineer", "2020-07-06", 98000, None, 4, 1),
    (7, "Greta", "Lindqvist", "Engineer", "2021-02-15", 98000, None, 4, 1),  # tie with Farid: RANK vs DENSE_RANK
    (8, "Hugo", "Beaumont", "Junior Engineer", "2023-09-04", 68000, None, 5, 1),
    (9, "Ines", "Varga", "Sales Manager", "2016-11-14", 118000, 0.08, 3, 2),
    (10, "Jonas", "Okafor", "Account Executive", "2019-03-18", 86000, 0.12, 9, 2),
    (11, "Kaia", "Ferreira", "Account Executive", "2021-08-02", 86000, 0.12, 9, 2),  # tie with Jonas
    (12, "Liam", "Novak", "Sales Rep", "2022-05-30", 64000, 0.15, 9, 2),
    (13, "Marta", "Ibrahim", "Sales Rep", "2024-01-15", 61000, 0.15, 9, 2),
    (14, "Niels", "Tanaka", "Marketing Lead", "2018-02-05", 112000, None, 1, 3),
    (15, "Olga", "Petrova", "Content Strategist", "2022-10-10", 74000, None, 14, 3),
    (16, "Pedro", "Almeida", "Support Lead", "2017-07-24", 96000, None, 1, 4),
    (17, "Qing", "Zhao", "Support Agent", "2023-03-13", 56000, None, 16, 4),
    (18, "Rania", "Khalil", "Support Agent", "2024-06-03", 54000, None, 16, 4),
    (19, "Sven", "Berg", "Controller", "2016-04-11", 124000, None, 1, 5),
    (20, "Tomas", "Lindo", "Warehouse Manager", "2019-10-21", 88000, None, 1, 6),
    (21, "Ulla", "Mertens", "Logistics Planner", "2023-11-27", 67000, None, 20, 6),
    (22, "Viktor", "Sauer", "Data Analyst", "2025-02-17", 79000, None, 19, None),
]

CATEGORIES = [
    (1, "Keyboards", "Mechanical and low-profile keyboards"),
    (2, "Mice", "Wired and wireless pointing devices"),
    (3, "Monitors", "Desktop displays"),
    (4, "Audio", "Headsets, speakers and microphones"),
    (5, "Docking", "Hubs, docks and adapters"),
    (6, "Chairs", "Seating and ergonomics"),
    (7, "Lighting", "Desk and studio lighting"),
    (8, "Accessories", None),
]

SUPPLIERS = [
    (1, "Nordkey Components", "Sweden", 5),
    (2, "Vilnius Peripherals", "Lithuania", 4),
    (3, "Shenzhen BrightPanel", "China", 4),
    (4, "Acustica Milano", "Italy", 5),
    (5, "PortHub GmbH", "Germany", 3),
    (6, "Lisboa Seating", "Portugal", 4),
    (7, "Lumen Works", "Netherlands", None),
    (8, "Osaka Precision", "Japan", 5),
]

# (id, name, category, supplier, price, stock, discontinued)
PRODUCTS = [
    (1, "Tenkey Pro 87", 1, 1, 149.00, 120, 0),
    (2, "Tenkey Mini 60", 1, 1, 119.00, 64, 0),
    (3, "Silent Slim Keyboard", 1, 2, 79.50, 210, 0),
    (4, "Ergo Split K2", 1, 8, 229.00, 18, 0),
    (5, "Legacy Clicker 104", 1, 2, 49.00, 0, 1),
    (6, "Glide Wireless Mouse", 2, 2, 59.00, 340, 0),
    (7, "Glide Pro 8K", 2, 8, 109.00, 95, 0),
    (8, "Vertical Comfort Mouse", 2, 2, 69.00, 47, 0),
    (9, "Trackball Orbit", 2, 8, 89.00, 12, 0),
    (10, "Pixel 27 QHD", 3, 3, 349.00, 55, 0),
    (11, "Pixel 32 4K", 3, 3, 649.00, 31, 0),
    (12, "Pixel UltraWide 34", 3, 3, 899.00, 14, 0),
    (13, "Portable 15 Travel Display", 3, 3, 279.00, 23, 0),
    (14, "Studio Headset H5", 4, 4, 189.00, 78, 0),
    (15, "Podcast Mic M1", 4, 4, 219.00, 41, 0),
    (16, "Desk Speakers S2", 4, 4, 159.00, 60, 0),
    (17, "Noise-Cancel Headset NC7", 4, 4, 299.00, 27, 0),
    (18, "USB-C Dock 11-in-1", 5, 5, 199.00, 88, 0),
    (19, "Travel Hub 4-port", 5, 5, 49.00, 260, 0),
    (20, "Thunder Dock Pro", 5, 5, 329.00, 19, 0),
    (21, "DisplayPort Cable 2m", 5, 5, 19.00, 500, 0),
    (22, "Task Chair T1", 6, 6, 459.00, 22, 0),
    (23, "Executive Chair E9", 6, 6, 899.00, 7, 0),
    (24, "Standing Mat", 6, 6, 89.00, 64, 0),
    (25, "Desk Lamp L2", 7, 7, 79.00, 130, 0),
    (26, "Key Light Studio", 7, 7, 219.00, 35, 0),
    (27, "Monitor Light Bar", 7, 7, 99.00, 72, 0),
    (28, "Laptop Stand Alu", 8, 5, 69.00, 150, 0),
    (29, "Cable Tray", 8, 7, 39.00, 180, 0),
    (30, "Wrist Rest Gel", 8, 2, 25.00, 0, 1),
]

CUSTOMER_SEED = [
    (1, "Brightline Studio", "Marie Dupont", "Paris", "France", "2022-01-14", 20000),
    (2, "Nordwind AG", "Jan Keller", "Hamburg", "Germany", "2022-02-03", 50000),
    (3, "Olive & Pine", "Sofia Rossi", "Milan", "Italy", "2022-03-22", 15000),
    (4, "Kappa Labs", "Tom Nilsen", "Oslo", "Norway", "2022-05-09", None),
    (5, "Cedar Consulting", "Ana Lopes", "Lisbon", "Portugal", "2022-06-18", 8000),
    (6, "Harborview Media", "Liam Doyle", "Dublin", "Ireland", "2022-08-01", 12000),
    (7, "Granite Works", "Eva Novak", "Prague", "Czechia", "2022-09-12", 30000),
    (8, "Lumos Retail", "Pieter Smit", "Amsterdam", "Netherlands", "2022-11-05", 45000),
    (9, "Atlas Freight", "Omar Haddad", "Casablanca", "Morocco", "2023-01-20", 25000),
    (10, "Verde Energia", "Carla Mendes", "Madrid", "Spain", "2023-02-14", None),
    (11, "Sakura Design", "Yui Tanaka", "Tokyo", "Japan", "2023-03-30", 60000),
    (12, "Pine Street Books", "Grace Hall", "Manchester", "United Kingdom", "2023-05-11", 5000),
    (13, "Delta Analytics", "Ravi Menon", "Bengaluru", "India", "2023-07-07", 35000),
    (14, "Fjord Fitness", "Ingrid Haug", "Bergen", "Norway", "2023-08-29", 10000),
    (15, "Meridian Law", "Claire Benoit", "Brussels", "Belgium", "2023-10-16", 18000),
    (16, "Cobalt Robotics", "Mateo Silva", "Sao Paulo", "Brazil", "2024-01-08", 40000),
    (17, "Tulip Foods", "Noor Bakker", "Utrecht", "Netherlands", "2024-02-27", 9000),
    (18, "Alpine Tours", "Luca Berger", "Zurich", "Switzerland", "2024-04-15", 22000),
    (19, "Northgate Clinic", "Hanna Vogt", "Vienna", "Austria", "2024-06-24", None),
    (20, "Riverside Hotels", "Pawel Zielinski", "Krakow", "Poland", "2024-09-02", 28000),
    (21, "Quiet Quarry", "Sam Okoye", "Lagos", "Nigeria", "2025-01-13", 6000),
    (22, "Zenith Partners", "Mia Larsen", "Copenhagen", "Denmark", "2025-03-04", 32000),
]

CONTACTLESS = {4, 19}  # customers with a NULL contact_name
NO_ORDER_CUSTOMERS = {12, 19, 21}  # never ordered: useful for LEFT JOIN / NOT EXISTS

def build_orders():
    orders, items, payments = [], [], []
    sales_reps = [3, 9, 10, 11, 12, 13]
    order_id = 1000
    payment_id = 5000
    start = date(2024, 1, 2)
    buyers = [c[0] for c in CUSTOMER_SEED if c[0] not in NO_ORDER_CUSTOMERS]
    for day_offset in range(0, 640, 3):
        d = start + timedelta(days=day_offset)
        if d > date(2025, 10, 1):
            break
        for _ in range(random.choice([0, 1, 1, 1, 2, 2, 3])):
            order_id += 1
            cust = random.choice(buyers)
            rep = random.choice(sales_reps)
            # Orders near the end of the window are still open.
            age = (date(2025, 10, 20) - d).days
            if age < 25:
                status = random.choice(["pending", "pending", "shipped"])
            else:
                status = random.choices(
                    ["delivered", "shipped", "cancelled"], weights=[78, 14, 8])[0]
            ship = None
            if status in ("shipped", "delivered"):
                ship = (d + timedelta(days=random.randint(1, 9))).isoformat()
            freight = round(random.uniform(4.5, 120.0), 2)
            orders.append((order_id, cust, rep, d.isoformat(), ship, status, freight))

            picks = random.sample(range(1, 30), random.randint(1, 5))
            total = 0.0
            for pid in picks:
                price = next(p[4] for p in PRODUCTS if p[0] == pid)
                price = round(price * random.choice([1.0, 1.0, 1.0, 0.95, 1.05]), 2)
                qty = random.choices([1, 2, 3, 4, 5, 8, 10, 15], weights=[28, 20, 14, 10, 9, 8, 7, 4])[0]
                disc = random.choices([0, 0, 0, 0.05, 0.1, 0.15], weights=[55, 12, 8, 12, 9, 4])[0]
                items.append((order_id, pid, price, qty, disc))
                total += price * qty * (1 - disc)
            total = round(total + freight, 2)
            if status != "cancelled" and random.random() < 0.88:
                pay_day = d + timedelta(days=random.randint(0, 30))
                if random.random() < 0.18:  # partial payments
                    half = round(total / 2, 2)
                    payment_id += 1
                    payments.append((payment_id, order_id, pay_day.isoformat(), half,
                                     random.choice(["card", "transfer"])))
                    payment_id += 1
                    payments.append((payment_id, order_id,
                                     (pay_day + timedelta(days=random.randint(5, 40))).isoformat(),
                                     round(total - half, 2), "transfer"))
                else:
                    payment_id += 1
                    payments.append((payment_id, order_id, pay_day.isoformat(), total,
                                     random.choices(["card", "transfer", "paypal", "invoice"],
                                                    weights=[45, 30, 15, 10])[0]))
    return orders, items, payments

def build_reviews(order_items):
    bought = sorted({(oid, pid) for oid, pid, *_ in order_items})
    comments = [
        "Exactly what we needed.", "Shipping took a while.", "Great build quality.",
        "Stopped working after a month.", "Good value for the price.", None,
        "Would buy again.", "Noisier than expected.", None, "Packaging was damaged.",
    ]
    reviews = []
    rid = 9000
    seen = set()
    for oid, pid in random.sample(bought, 90):
        cust = next(o[1] for o in ORDERS if o[0] == oid)
        if (pid, cust) in seen:
            continue
        seen.add((pid, cust))
        rid += 1
        rating = random.choices([1, 2, 3, 4, 5], weights=[6, 9, 18, 34, 33])[0]
        created = next(o[3] for o in ORDERS if o[0] == oid)
        created = (date.fromisoformat(created) + timedelta(days=random.randint(5, 60))).isoformat()
        reviews.append((rid, pid, cust, rating, random.choice(comments), created))
    return reviews

def build_logins():
    out = []
    for cid, *_ in CUSTOMER_SEED:
        if cid in NO_ORDER_CUSTOMERS:
            continue
        d = date(2025, 6, 1)
        # Streaks separated by gaps, so islands are visible.
        while d < date(2025, 8, 31):
            run = random.randint(1, 6)
            for i in range(run):
                day = d + timedelta(days=i)
                if day < date(2025, 8, 31):
                    out.append((cid, day.isoformat()))
            d = d + timedelta(days=run + random.randint(1, 7))
    return out

STAGING = [
    (1, "Brightline Studio", "info@brightline.example", "Paris", "2025-09-01 08:00:00"),
    (2, "brightline studio", "INFO@brightline.example", "paris", "2025-09-01 08:00:00"),
    (3, "Nordwind AG", "kontakt@nordwind.example", "Hamburg", "2025-09-01 08:00:00"),
    (4, "Nordwind AG ", "kontakt@nordwind.example", "Hamburg", "2025-09-02 09:30:00"),
    (5, "Olive & Pine", None, "Milan", "2025-09-02 09:30:00"),
    (6, "Kappa Labs", "hello@kappa.example", "Oslo", "2025-09-02 09:30:00"),
    (7, "Kappa labs", "hello@kappa.example", "OSLO", "2025-09-03 11:15:00"),
    (8, "Cedar Consulting", "ana@cedar.example", "Lisbon", "2025-09-03 11:15:00"),
    (9, "Zenith Partners", "mia@zenith.example", "Copenhagen", "2025-09-04 07:45:00"),
    (10, "ZENITH PARTNERS", "mia@zenith.example", "Copenhagen", "2025-09-05 07:45:00"),
]

SPECS = [
    (1, '{"switch":"brown","layout":"87-key","backlight":true,"weight_g":820,"ports":["usb-c"]}'),
    (2, '{"switch":"red","layout":"60-key","backlight":true,"weight_g":540,"ports":["usb-c"]}'),
    (3, '{"switch":"scissor","layout":"full","backlight":false,"weight_g":610,"ports":["usb-a"]}'),
    (4, '{"switch":"brown","layout":"split","backlight":true,"weight_g":1100,"ports":["usb-c","usb-c"]}'),
    (6, '{"dpi":4000,"wireless":true,"buttons":6,"weight_g":88}'),
    (7, '{"dpi":8000,"wireless":true,"buttons":8,"weight_g":74}'),
    (10, '{"panel":"IPS","size_in":27,"resolution":"2560x1440","hz":75,"ports":["hdmi","dp","usb-c"]}'),
    (11, '{"panel":"IPS","size_in":32,"resolution":"3840x2160","hz":60,"ports":["hdmi","dp"]}'),
    (12, '{"panel":"VA","size_in":34,"resolution":"3440x1440","hz":120,"ports":["hdmi","dp","usb-c"]}'),
    (14, '{"drivers_mm":40,"wireless":false,"mic":true,"weight_g":320}'),
    (17, '{"drivers_mm":45,"wireless":true,"mic":true,"anc":true,"weight_g":290}'),
    (18, '{"ports":["hdmi","dp","usb-a","usb-a","usb-c","rj45","sd"],"power_w":100}'),
    (22, '{"material":"mesh","armrests":"4d","max_load_kg":130,"warranty_years":5}'),
    (25, '{"lumens":800,"color_temp_k":[2700,6500],"dimmable":true}'),
]

ORDERS, ORDER_ITEMS, PAYMENTS = build_orders()
REVIEWS = build_reviews(ORDER_ITEMS)
LOGINS = build_logins()

sql = [SCHEMA]
sql.append(rows("departments", ["dept_id", "dept_name", "location", "budget"], DEPARTMENTS))
sql.append(rows("employees",
                ["emp_id", "first_name", "last_name", "email", "job_title", "hire_date",
                 "salary", "commission_pct", "manager_id", "dept_id"],
                [(e[0], e[1], e[2], f"{e[1].lower()}.{e[2].lower()}@dunder.example",
                  e[3], e[4], e[5], e[6], e[7], e[8]) for e in EMPLOYEES]))
sql.append(rows("categories", ["category_id", "category_name", "description"], CATEGORIES))
sql.append(rows("suppliers", ["supplier_id", "supplier_name", "country", "rating"], SUPPLIERS))
sql.append(rows("products",
                ["product_id", "product_name", "category_id", "supplier_id",
                 "unit_price", "units_in_stock", "discontinued"], PRODUCTS))
sql.append(rows("customers",
                ["customer_id", "company_name", "contact_name", "city", "country",
                 "signup_date", "credit_limit"],
                [(c[0], c[1], None if c[0] in CONTACTLESS else c[2], c[3], c[4], c[5], c[6])
                 for c in CUSTOMER_SEED]))
sql.append(rows("orders",
                ["order_id", "customer_id", "emp_id", "order_date", "ship_date", "status", "freight"],
                ORDERS))
sql.append(rows("order_items",
                ["order_id", "product_id", "unit_price", "quantity", "discount"], ORDER_ITEMS))
sql.append(rows("payments", ["payment_id", "order_id", "paid_at", "amount", "method"], PAYMENTS))
sql.append(rows("reviews",
                ["review_id", "product_id", "customer_id", "rating", "comment", "created_at"],
                REVIEWS))
sql.append(rows("logins", ["customer_id", "login_date"], LOGINS))
sql.append(rows("staging_customers",
                ["row_id", "company_name", "email", "city", "loaded_at"], STAGING))
sql.append(rows("product_specs", ["product_id", "specs"], SPECS))

body = "".join(sql)
js = (
    "// Generated by tools/gen_seed.py - do not edit by hand.\n"
    "// The practice database: a small hardware reseller (HR + sales + support data).\n"
    "window.SEED_SQL = String.raw`\n" + body.replace("`", "\\`").replace("${", "$\\{") + "`;\n"
)
OUT.write_text(js)
print(f"wrote {OUT} ({len(body)} bytes of SQL)")
print("orders", len(ORDERS), "items", len(ORDER_ITEMS), "payments", len(PAYMENTS),
      "reviews", len(REVIEWS), "logins", len(LOGINS))
