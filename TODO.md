# TODO: pick up here

Last updated 2026-09-20 (end of the TigerGraph session). Read `CLAUDE.md` (the full briefing) and `README.md` (layout, commands) when you need detail. This file is only "what is done, what to do next, in order".

## 0. Where things stand

**Spec requirements: met.** The agent runs on TigerGraph Savanna end to end:
- Schema, vector attributes and loading through REST++ (`py/scripts/tg_schema.py`, `tg_load.py`); graphs `FraudTest` (synthetic) and `FraudGraph` (real: 590,742 transactions, 14,318 cards, 9,706 device profiles, 5,565 closed cases) are loaded and counted.
- 16 installed GSQL queries (`gsql/queries.gsql.tmpl`, `gsql/rag.gsql.tmpl`), every one taking `as_of`.
- The TigerGraph MCP server (`tigergraph-mcp`, launched by `py/scripts/tg_mcp_launcher.py` with a fresh token each start) is the agent's only path to the graph (`backend/src/store/TigerGraphStore.ts`).
- `GraphStore` is asynchronous; **138 tests pass on the in-memory store and on `FraudTest`** (`STORE=tigergraph pnpm test`), including the look-ahead tests.
- Cases are written back to the graph (`--write-graph`): `FraudCase`, `Evidence`, `Action` vertices with edges to transactions, cards, devices, similar closed cases.
- GraphRAG (`--rag`): policy, the five patterns, FinCEN SAR guidance and closed-case notes embedded with `nomic-embed-text`; vector search + graph expansion; cited context for the narrator; the policy rules behind a recommendation are attached as `document` evidence.
- The 20 real answer files are in `cases/` (validated).

**Decisions taken (2026-09-20, by the user):** local Ollama only, no other LLM keys; nothing is invented (pre-reply `fraud_probability`, no fabricated customer reply, silence/R4 assumed and recorded); card labels that no source names are omitted. Details in `CLAUDE.md` section 15.

## 1. First 5 minutes next time

```bash
cd D:\Coding\hhg-task
bash scripts/tg-check.sh     # address, secret, token, REST++, GSQL; never prints secrets
pnpm test                    # expect 138 passing
# Ollama must be running (Windows app): it writes the text and finds similar cases
```

If `tg-check.sh` says "reachable: NO", the workspace auto-suspended (60 idle minutes; **Auto Resume is off**). Resume it in Savanna (workspace menu, Configuration, Advanced Settings). Tokens last 1 hour; the MCP launcher and the client refresh them. Savanna credits are limited; keep auto-suspend on.

## 2. Accuracy work (this is where the score is won)

- [ ] **Backtest harness.** Replay closed cases through the whole agent frozen at their `as_of` (the in-memory store is fast; TigerGraph is ~10 s per case), with a time split (train Jul to Sep, test Oct). Fit the log-likelihood ratios and thresholds in `backend/src/engines/calibration.ts` (only one constant is wired to `calibration/baseline_v0.json` today). Calibration plot, action agreement with analysts. **Do not tune on the 20 exam cases.**
- [ ] **In-person hub case scope.** On real data an in-person case on an aggregate customer (HHG-018) gets a card-not-present `new_device` because the signal looks at the whole 48-hour window, not the flagged transaction. Make device signals attach to the flagged transaction's own channel. Fix as a general rule, and check it on closed cases, not on the exam.
- [ ] Account-takeover signature (mixed channel, `M1` to `M9`) and the numeric lookalike channel (PCA(32) of the Vesta features, `emb` vector attribute on Transaction or a new vertex, vector search).
- [ ] The contagion sweep ranks the ring fingerprint 69th of the shared devices (top few percent), not first. Try seeding only from cases closed as `undocumented`, or weight by recency, and measure on closed cases.

## 3. LLM layer

- [x] The AI writer runs for real (`gemma4:31b-cloud`, tested on HHG-006 and in the browser). Still to do: compare models on a few cases (schema pass rate, citation accuracy, SAR completeness).
- [ ] Response cache (hash of model, prompt, schema), the LLM "plan next evidence" call (v0 chooses the request deterministically). Gemini/Groq fallbacks are optional and need keys the user has said they do not want to add.

## 4. Console and submission

- [ ] Console: panels for the GraphRAG context and the contagion sweep (they are in the trace events), calibration plot, "replay a closed case as new".
- [ ] Review the 20 answer files by hand (`cases/`). Every ID must exist; action names and routes match the policy.
- [ ] **Submission items:** GitHub repo (do not commit `Dataset/*`, `data/`, `.env`), 3 to 5 minute demo video (script, teleprompter, animated presenter and live-demo driver are ready in `video/`: record it with OBS following `video/README.md`), technical blog post, social post tagging @TigerGraphDB.
- [ ] Turn on Auto Resume in Savanna (account setting; not changed by the agent).

## 5. Cautions

- Never paste the secret, token or `.env` into chat. `.env` is git-ignored.
- Do not tune thresholds on the 20 exam cases. On 2026-09-19 they were run once for feasibility and again on 2026-09-20 on TigerGraph; only population-level or structural fixes followed (see `CLAUDE.md` section 15).
- Every ID in an answer file must exist in the dataset. Do not use the original public IEEE-CIS files.
- `CREATE OR REPLACE QUERY` un-installs the query: run `INSTALL QUERY ALL` afterwards (about 50 s).
- On Windows, regexes with backslashes get mangled by shell heredocs and `sed`; use the editor tools.

## 6. Useful commands

```bash
pnpm test                       STORE=tigergraph pnpm test          pnpm typecheck
pnpm run:cases -- --write-graph --out cases     # everything comes from .env (database, data, AI model, GraphRAG)
pnpm dev:backend                pnpm dev:frontend                   # console at http://localhost:3000
bash scripts/tg-check.sh
cd py && uv run python scripts/tg_queries.py FraudGraph             # (re)create + install queries
cd py && uv run python scripts/build_notebooks.py --execute
```

Design page: https://claude.ai/artifact/EsZtbNYzWkJ3EpK7A7DvVp
