"""Runs every SQL snippet in the course against SQLite and reports problems.
Usage: node tools/collect.mjs /tmp/items.json && python3 tools/validate.py /tmp/items.json
"""
import json, re, sqlite3, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
seed = root.joinpath("js/seed.js").read_text().split("String.raw`", 1)[1].rsplit("`;", 1)[0]
seed = seed.replace("\\`", "`").replace("$\\{", "${")
data = json.loads(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sqlcourse-items.json").read_text())

base = sqlite3.connect(":memory:")
base.executescript(seed)

def split_statements(script):
    """Split a SQL script the way SQLite does.

    sqlite3.complete_statement() respects strings and comments but not trigger bodies,
    so a CREATE TRIGGER is only treated as finished once its BEGIN ... END block closes.
    """
    out, cut, i = [], 0, 0
    while True:
        j = script.find(";", i)
        if j < 0:
            break
        head = script[cut : j + 1]
        is_trigger = re.match(r"\s*create\s+(temp\s+|temporary\s+)?trigger", head, re.I)
        closed = re.search(r"\bend\s*;\s*$", head, re.I)
        if sqlite3.complete_statement(head) and (not is_trigger or closed):
            if head.strip(" \n\t;"):
                out.append(head)
            cut = j + 1
        i = j + 1
    tail = script[cut:]
    if tail.strip(" \n\t;"):
        out.append(tail)
    return out


def fresh():
    # autocommit: lessons contain explicit BEGIN / COMMIT / ROLLBACK scripts
    db = sqlite3.connect(":memory:", isolation_level=None)
    base.backup(db)
    db.execute("PRAGMA foreign_keys = ON")
    return db

errors, warns = [], []
for it in data["items"]:
    where, kind = it["where"], it["kind"]
    if kind in ("dup", "badquiz"):
        errors.append(f"[{kind}] {where}")
        continue
    if kind == "exercise":
        if not it["sql"]:
            errors.append(f"[no-solution] {where}"); continue
        if not it["hasPrompt"]:
            errors.append(f"[no-prompt] {where}")
    db = fresh()
    try:
        cur = db.cursor()
        cur.executescript(it["sql"])
        last = None
        # executescript discards results; re-run statements individually for the result set
        db2 = fresh()
        rows = None
        cols = None
        for stmt in split_statements(it["sql"]):
            c = db2.execute(stmt)
            if c.description:
                cols = [d[0] for d in c.description]
                rows = c.fetchall()
        if it.get("check"):
            c = db2.execute(it["check"])
            cols = [d[0] for d in c.description]
            rows = c.fetchall()
        if kind == "exercise":
            if rows is None:
                errors.append(f"[no-result-set] {where}")
            elif len(rows) == 0 and not it.get("allowEmpty"):
                warns.append(f"[empty-result] {where}")
            if rows:
                # Determinism check: SQLite's reverse_unordered_selects flips the row order of
                # anything the query does not pin down, which exposes ambiguous ORDER BY / LIMIT.
                rev = fresh()
                rev.execute("PRAGMA reverse_unordered_selects = ON")
                rrows = None
                for stmt in split_statements(it["sql"]):
                    rc = rev.execute(stmt)
                    if rc.description:
                        rrows = rc.fetchall()
                if it.get("check"):
                    rrows = rev.execute(it["check"]).fetchall()
                rev.close()
                if rrows is not None:
                    if it["orderMatters"]:
                        if [tuple(r) for r in rrows] != [tuple(r) for r in rows]:
                            warns.append(f"[ambiguous-order] {where}")
                    elif sorted(map(repr, rrows)) != sorted(map(repr, rows)):
                        warns.append(f"[ambiguous-rows] {where}")
            for pat in it.get("requireSql", []):
                if not re.search(pat, it["sql"], re.I):
                    errors.append(f"[solution-fails-requireSql] {where} :: {pat}")
        db2.close()
    except Exception as e:
        errors.append(f"[sql-error] {where} :: {e} :: {it['sql'][:90].strip()!r}")
    finally:
        db.close()

print(json.dumps(data["stats"]))
for e in errors:
    print("ERROR " + e)
for w in warns:
    print("warn  " + w)
print(f"\n{len(errors)} errors, {len(warns)} warnings")
sys.exit(1 if errors else 0)
