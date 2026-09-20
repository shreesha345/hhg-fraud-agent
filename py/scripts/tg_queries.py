"""Create and install every GSQL query (gsql/queries.gsql.tmpl and gsql/rag.gsql.tmpl).   uv run python scripts/tg_queries.py FraudTest
`CREATE OR REPLACE QUERY` un-installs a query, so this always ends with INSTALL QUERY ALL (about 4 minutes on 2 vCPU)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from fraudpy.tg import ROOT, TG

g = sys.argv[1]
tg = TG()
for name in ("queries", "rag"):
    out = tg.gsql((ROOT / "gsql" / f"{name}.gsql.tmpl").read_text(encoding="utf-8").replace("@G@", g))
    print(f"{name}: {out.count('Successfully created')} queries created")
if "--no-install" not in sys.argv:
    print(tg.gsql(f"USE GRAPH {g}\nINSTALL QUERY ALL")[-400:])
