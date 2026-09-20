"""Create the loading job and stream the export files into a graph through REST++ (no shared folder needed).
    uv run python scripts/tg_load.py FraudTest ../data/tg-test
Files are sent in chunks of --chunk lines (header repeated). Vertices first, then edges."""
import argparse
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from fraudpy.tg import ROOT, TG

ap = argparse.ArgumentParser()
ap.add_argument("graph"); ap.add_argument("dir"); ap.add_argument("--chunk", type=int, default=150000)
ap.add_argument("--skip-job", action="store_true"); ap.add_argument("--only", default="")
a = ap.parse_args()
tg, d = TG(), Path(a.dir)
job = f"{a.graph}_load"
if not a.skip_job:
    tg.gsql(f"USE GRAPH {a.graph}\nDROP JOB {job}")
    print(tg.gsql((ROOT / "gsql" / "load.gsql.tmpl").read_text().replace("@G@", a.graph))[-200:])

order = ["v_customer", "v_card", "v_transaction", "v_device", "v_region", "v_email", "v_pattern", "v_closedcase",
         "e_owns", "e_made", "e_next", "e_from_device", "e_billed_in", "e_purchaser_email",
         "e_closed_involves", "e_closed_on_card", "e_closed_connected", "e_closed_matches"]
only = set(a.only.split(",")) if a.only else set(order)
tot = {}
for name in [n for n in order if n in only]:
    lines = (d / f"{name}.tsv").read_text(encoding="utf-8").split("\n")
    head, rows = lines[0], [l for l in lines[1:] if l]
    t0 = time.time()
    for i in range(0, max(len(rows), 1), a.chunk):
        with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False, encoding="utf-8", newline="\n") as f:
            f.write("\n".join(rows[i:i + a.chunk]) + "\n"); p = Path(f.name)
        r = tg.load_file(a.graph, job, name, p); p.unlink()
        res = r.get("results", [{}])[0] if isinstance(r.get("results"), list) and r.get("results") else {}
        if r.get("error") or not res:
            print("FAILED", name, str(r)[:400]); sys.exit(1)
        st = res.get("statistics", {})
        for k, v in st.items():
            if isinstance(v, dict): tot.setdefault(name, {}).update({kk: tot.get(name, {}).get(kk, 0) + vv for kk, vv in v.items() if isinstance(vv, int)}) if False else None
        print(f"{name:20s} rows {i}-{i+len(rows[i:i+a.chunk])} of {len(rows)}  {time.time()-t0:5.1f}s  {str(st)[:150]}", flush=True)
