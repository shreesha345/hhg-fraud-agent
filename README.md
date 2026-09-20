# Fraud investigation agent (TigerGraph, Hacker House Goa)

An agent that investigates card-fraud alerts, decides what kind of fraud it is (or that it is innocent), recommends the next best action with the correct approval route, asks for more evidence when it is unsure, and explains itself. Design and rationale: `CLAUDE.md`. Problem statement: `spec.md`. Dataset guide and policy: `Dataset/README.md`.

**Read first:** [`BLOG.md`](BLOG.md) — how TigerGraph solved this, component by component, including the alert the bank's own model scored **0.05** that turned out to be a 44-customer device ring. Demo video: [`video/remotion/out/fraud-investigator.mp4`](video/remotion/out/fraud-investigator.mp4) (4:58, with subtitles).

**Status: the agent runs end to end on TigerGraph (Savanna): the graph is loaded (590,742 transactions), 16 GSQL queries are installed, every read goes through the TigerGraph MCP server, cases are written back to the graph, and GraphRAG (vector search plus graph expansion) supplies a cited context. The same 138 tests pass on the in-memory store and on the cloud graph.** See `TODO.md` for what is left and "What is and is not built".

## Layout

| Folder | What |
|---|---|
| `py/` | Offline analytics and the TigerGraph tooling: notebooks, the test-data generator, slim export, and the scripts that create the schema, load the data, install the queries, embed the documents (`tg_*.py`). Python, managed with `uv` |
| `gsql/` | GSQL templates: schema, vector attributes, loading job, the installed queries (`queries.gsql.tmpl`, `rag.gsql.tmpl`) |
| `shared/` | `@fraud/shared`: the policy vocabulary, the answer-file schema (Zod) and the API contract, used by backend and frontend |
| `backend/` | `@fraud/backend`: TypeScript agent, policy engine, judge, validator, HTTP API, batch runner. Tests in `backend/tests/` |
| `frontend/` | `@fraud/frontend`: Next.js analyst console |
| `Dataset/` | The provided data (not committed) and `Dataset/test/`, the **synthetic test dataset** (committed) |
| `calibration/` | Numbers written by the notebooks and read by the tests (`baseline_v0.json`) |
| `data/` | Generated caches and outputs (git-ignored) |

## Quick start

Requirements: Node 24, pnpm, Python 3.10+, `uv`. Ollama is optional. For the cloud graph: a Savanna workspace and a database secret in `.env` (see `.env.example`; verify with `bash scripts/tg-check.sh`).

```bash
pnpm install                      # workspace: shared + backend + frontend
pnpm test                         # 138 tests, ~2 s, on Dataset/test (in-memory store)
STORE=tigergraph pnpm test        # the same tests against the FraudTest graph in TigerGraph, through MCP (~90 s)
pnpm dev:backend                  # API on http://localhost:4000
pnpm dev:frontend                 # console on http://localhost:3000  (start the backend first)
```

Real data (optional; needs the provided `Dataset/*.csv`):

```bash
cd py && uv sync
uv run python scripts/export_slim.py               # builds a DuckDB cache, then data/slim/ (about 1 min)
cd .. && DATASET_DIR=data/slim pnpm run:cases -- --out data/out-real     # in-memory store
```

TigerGraph (Savanna). Put `TG_HOST` and `TG_SECRET` (a database secret) in `.env`, resume the workspace, then:

```bash
bash scripts/tg-check.sh                                                          # address, secret, token, REST++, GSQL
cd py
uv run python scripts/export_tg.py --src ../data/slim --out ../data/tg-real       # loading files (use ../Dataset/test for FraudTest)
uv run python scripts/tg_schema.py FraudGraph                                     # local types, so nothing collides with the sample graph
uv run python scripts/tg_load.py FraudGraph ../data/tg-real                       # streams the files through REST++ (~5 min)
uv run python scripts/tg_queries.py FraudGraph                                    # creates and installs the GSQL queries (~4 min)
ollama serve                                                                      # in another terminal (nomic-embed-text for GraphRAG)
uv run python scripts/tg_rag_load.py FraudGraph ../data/tg-real                   # embeds policy, FinCEN guidance and closed-case notes (~10 min)
cd .. && DATASET_DIR=data/slim pnpm run:cases -- --store tigergraph --rag --write-graph --out cases
```

`--store tigergraph` reads through the MCP server (`py/scripts/tg_mcp_launcher.py` fetches a fresh one-hour token from the secret); `--rag` turns on GraphRAG; `--write-graph` stores each case, its evidence and actions in the graph. `STORE=tigergraph` does the same for the API and the tests.

Notebooks (`py/notebooks/`, already executed with outputs): `01_dataset_understanding.ipynb` measures what the data says; `02_features_and_baseline_calibration.ipynb` measures how much graph features help and writes `calibration/baseline_v0.json`. Rebuild with `cd py && uv run python scripts/build_notebooks.py --execute`.

The AI model that writes the summaries and regulator reports is chosen in `.env` (`LLM_MODEL_OLLAMA`, default the free cloud model `gemma4:31b-cloud`). There is no template mode: if the model fails the case stops with a clear error. Decisions never depend on the model; it only puts the findings into words.

## What is and is not built

Built and tested:
- Synthetic test dataset with eight planted scenarios and an expectations file
- **TigerGraph**: schema (local types), vector attributes, loading through REST++, 16 installed GSQL queries (card history, device statistics and the shared-fingerprint ring query, causal closed-case recall, contagion sweep, vector search), the TigerGraph MCP server as the agent's only path to the graph, case write-back
- A hard as-of time bound (no look-ahead) enforced inside every query, and causal memory; the same test suite proves it on the in-memory store and on the cloud graph
- **GraphRAG**: policy rules, the five known patterns and FinCEN SAR guidance chunked and embedded (`nomic-embed-text`), closed-case notes embedded; retrieval is vector search plus graph expansion, rendered as a cited context for the narrator, and the policy rules behind a recommendation are attached as `document` evidence
- Signature library: prosecution (card testing, off-profile burst, new device, threshold hugging, shared rare fingerprint, out-of-region), defence (trip, device succession, recurring charge with a coincidence test, baseline-consistent spend), memory recall by shape
- Score-blind contagion sweep (personalised PageRank written in GSQL); it is reported in the trace and never moves the probability
- Judge (log-odds ledger with independence classes and the stop rule), policy engine (rules R1 to R10, routes), a precomputed contingency plan for each customer reply
- **Nothing is invented**: there is no simulator. `fraud_probability`, verdict, pattern and evidence are the pre-reply values; the customer's answer is not in the data, so no reply is fabricated (the rules for "no reply", R4/R7, apply and are recorded) and the plans for a denial and a confirmation are shown in the contingency table. The text is always written by the AI model in `.env`; if it fails the case stops with an error
- Card IDs that no source file names (the `Kn` suffix cannot be derived) are never emitted; the validator rejects them
- Answer-file validator, template and local-Ollama narrators with schema checks and fallback, HTTP API with live event stream, batch runner, the console

Not built yet:
1. Account-takeover signature and the numeric "lookalike" channel (Vesta features)
2. Full backtest harness that replays closed cases through the agent, and calibration from it (the ledger constants are still v0)
3. LLM "plan next evidence" call (v0 chooses the request deterministically); response cache and free fallback providers
4. Recall of earlier exam cases; the console does not show the GraphRAG context or the sweep result as panels yet
5. The contagion sweep only ranks the ring fingerprint 69th of the shared devices as of HHG-014 (top few percent); it is an independent hint, not a detector
6. The demo video, blog post and social post

## Rules that matter

- Never use the original public IEEE-CIS files to recover outcomes.
- Every ID in an answer file must exist in the dataset.
- Do not tune on the 20 exam cases. Tune only on closed cases with a time split.
- Action names and approval routes are copied exactly from the policy; do not rename them.
