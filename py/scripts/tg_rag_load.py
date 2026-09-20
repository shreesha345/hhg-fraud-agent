"""GraphRAG loader: chunk the policy and reference documents, embed them and the closed-case notes with nomic-embed-text (Ollama),
and store the vectors in TigerGraph vector attributes (PolicyChunk.emb, ClosedCase.emb).

    uv run python scripts/tg_rag_load.py FraudTest ../data/tg-test
    uv run python scripts/tg_rag_load.py FraudGraph ../data/tg-real

Needs `ollama serve` running. Document embeddings are cached in data/rag/ so the second graph does not re-embed them.
Corpus: Dataset/README.md (the fraud policy R1-R10 and the five known patterns) and the FinCEN SAR guidance PDFs listed in the README's
regulatory references (downloaded to data/docs/). Sources are public documents; nothing private is sent anywhere (Ollama is local)."""
import csv
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import fitz  # pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from fraudpy.tg import ROOT, TG

graph, tgdir = sys.argv[1], Path(sys.argv[2])
OLLAMA, MODEL = "http://localhost:11434", "nomic-embed-text"
CACHE = ROOT / "data" / "rag"
CACHE.mkdir(parents=True, exist_ok=True)
PATTERNS = {"1": "card_testing", "2": "card_not_present_fraud", "3": "card_not_present_new_device", "4": "out_of_region_use", "5": "account_takeover"}


def embed(texts: list[str], prefix: str = "search_document: ") -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), 32):
        batch = [prefix + t[:2400] for t in texts[i:i + 32]]
        r = urllib.request.Request(OLLAMA + "/api/embed", data=json.dumps({"model": MODEL, "input": batch}).encode(), headers={"Content-Type": "application/json"})
        out += json.load(urllib.request.urlopen(r, timeout=300))["embeddings"]
    return out


def readme_chunks() -> list[dict]:
    lines = (ROOT / "Dataset" / "README.md").read_text(encoding="utf-8").split("\n")
    chunks: list[dict] = []
    # the five known patterns
    for l in lines:
        m = re.match(r"\*\*(\d)\. ([^*]+)\.\*\* (.*)", l)
        if m and m.group(1) in PATTERNS:
            chunks.append({"id": f"readme:pattern:{PATTERNS[m.group(1)]}", "title": m.group(2), "doc": "Dataset/README.md (known fraud patterns)", "text": f"{m.group(2)}. {m.group(3)}", "pattern": PATTERNS[m.group(1)]})
    # the fraud policy: each rule paragraph and each numbered section
    start = next(i for i, l in enumerate(lines) if l.startswith("# Fraud Policy"))
    end = next(i for i, l in enumerate(lines) if l.startswith("# Answer Format"))
    sec, buf = "policy", []
    def flush():
        text = "\n".join(buf).strip()
        if len(text) > 40: chunks.append({"id": f"policy:{sec}", "title": sec, "doc": "Dataset/README.md (fraud policy)", "text": text})
    for l in lines[start:end]:
        m = re.match(r"\*\*(R\d+)\. ([^*]*)\*\*", l)
        h = re.match(r"###+ (\S+?)\.? (.*)", l)
        if m:
            flush(); sec, buf = m.group(1), [l]; continue
        if h and not l.startswith("####"):
            flush(); sec, buf = "sec" + h.group(1).rstrip("."), [l]; continue
        buf.append(l)
    flush()
    return chunks


def pdf_chunks() -> list[dict]:
    chunks: list[dict] = []
    for pdf in sorted((ROOT / "data" / "docs").glob("*.pdf")):
        doc = fitz.open(pdf)
        for pno, page in enumerate(doc, 1):
            text = re.sub(r"[ \t]+", " ", page.get_text()).strip()
            paras, cur = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()], ""
            i = 0
            for p in paras + [""]:
                if p and len(cur) + len(p) < 1300: cur = (cur + "\n" + p).strip(); continue
                if len(cur) > 200:
                    i += 1
                    chunks.append({"id": f"doc:{pdf.stem}:p{pno}:{i}", "title": f"{pdf.stem} p.{pno}", "doc": f"FinCEN {pdf.stem}", "text": cur})
                cur = p
    return chunks


def upsert(payload: dict, tg: TG) -> None:
    r = tg.post_json(f"/restpp/graph/{graph}", payload)
    if r.get("error"): raise SystemExit(f"upsert failed: {str(r)[:300]}")


tg = TG()
t0 = time.time()
chunks = readme_chunks() + pdf_chunks()
key = hashlib.sha1("".join(c["id"] + c["text"] for c in chunks).encode()).hexdigest()[:12]
cf = CACHE / f"chunks-{key}.json"
if cf.exists():
    vecs = json.loads(cf.read_text())
else:
    vecs = embed([c["title"] + ". " + c["text"] for c in chunks]); cf.write_text(json.dumps(vecs))
print(f"{len(chunks)} policy/document chunks embedded ({time.time()-t0:.0f}s)")

for i in range(0, len(chunks), 40):
    part = {c["id"]: {"title": {"value": c["title"]}, "doc": {"value": c["doc"]}, "text": {"value": c["text"]}, "emb": {"value": v}} for c, v in zip(chunks[i:i + 40], vecs[i:i + 40])}
    upsert({"vertices": {"PolicyChunk": part}}, tg)
pats = sorted({c["pattern"] for c in chunks if "pattern" in c})
upsert({"vertices": {"Pattern": {p: {} for p in pats}}}, tg)
upsert({"edges": {"PolicyChunk": {c["id"]: {"DESCRIBES_PATTERN": {"Pattern": {c["pattern"]: {}}}} for c in chunks if "pattern" in c}}}, tg)
print(f"PolicyChunk vertices upserted: {len(chunks)}; pattern links: {len(pats)}")

# closed-case notes
with open(tgdir / "v_closedcase.tsv", encoding="utf-8", newline="") as f:
    rows = list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
t1 = time.time()
for i in range(0, len(rows), 200):
    part = rows[i:i + 200]
    vs = embed([r["notes"] for r in part])
    upsert({"vertices": {"ClosedCase": {r["id"]: {"emb": {"value": v}} for r, v in zip(part, vs)}}}, tg)
    if (i // 200) % 5 == 0: print(f"  closed cases {min(i + 200, len(rows))}/{len(rows)}  {time.time()-t1:.0f}s", flush=True)
print(f"ClosedCase embeddings stored: {len(rows)} ({time.time()-t1:.0f}s)")
