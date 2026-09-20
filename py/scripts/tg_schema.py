"""Create a graph, its schema and its vector attributes.   uv run python scripts/tg_schema.py FraudTest [--drop]
Applies gsql/schema.gsql.tmpl then gsql/vectors.gsql.tmpl (768-dim cosine `emb` on ClosedCase, PolicyChunk, FraudCase)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from fraudpy.tg import ROOT, TG

g = sys.argv[1]
tg = TG()
if "--drop" in sys.argv:
    print(tg.gsql(f"DROP GRAPH {g}"))
for name in ("schema", "vectors"):
    print(tg.gsql((ROOT / "gsql" / f"{name}.gsql.tmpl").read_text().replace("@G@", g))[-160:])
