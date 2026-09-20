# How to run the fraud investigation agent

This is the operating guide: setup once, then run, check and demo. Design and rationale live in `CLAUDE.md`; the ordered to-do list is `TODO.md`. Commands are bash; in PowerShell set variables with `$env:NAME="value"` first.

## 0. Just run it (Windows)

1. Open **`.env`** and check the settings block at the bottom (the model, the database, the data folder). The defaults work.
2. Double-click **`run-all.bat`** (or run it from a terminal). It checks the Savanna workspace is awake, starts the agent and the console, waits until both answer, and opens http://localhost:3000. Ollama must already be running (it runs as a Windows app); the script does not start it.
3. To change a setting, edit `.env`, run **`stop-all.bat`**, then `run-all.bat` again.

The main settings in `.env`:

| Setting | Meaning |
|---|---|
| `LLM_MODEL_OLLAMA` | the AI model that writes the summaries and reports. `gemma4:31b-cloud` (free Ollama cloud, default; the case text is sent to Ollama's cloud), `glm-5.3:cloud` (exists, needs paid Ollama credits), or `qwen2.5-coder:7b` (local, slow, private) |
| `STORE` | `tigergraph`: the cloud graph database |
| `DATASET_DIR` | `data/slim`: the real data |
| `RAG` | `1`: look up similar past cases and policy text by meaning (needs `EMBED_MODEL` in Ollama) |
| `OLLAMA_HOST`, `EMBED_MODEL`, `OLLAMA_NUM_CTX`, `LLM_TIMEOUT_S` | where Ollama is, the embedding model, context size, and how long to wait for the model per try |

**Nothing is faked.** There is no simulated customer reply, no template text and no practice data in the running app. The customer's answer is not in the data, so the agent does not invent one: it recommends what the rules say for "no reply" and shows the plan for each possible answer. The text is always written by the AI model in `.env`; if the model cannot be reached or gives unusable text three times, the case **stops with a clear error** (and the console shows a red banner up front when Ollama, the model or the database is not reachable).

The console shows how the parts talk to each other: a diagram of console, agent, TigerGraph and the AI model, and after each investigation a "Who talked to whom" panel built from the real message logs.

## 0b. Making the demo video

`video/README.md` explains everything: a script (5-minute cut and a full edition), the Presenter Studio (`video\open-studio.bat`: a teleprompter and an animated AI presenter), the live terminal demo (`video\demo.bat`), and the OBS setup.

## 1. What you are running

An agent that investigates the 20 alert cases. Its reads go through **TigerGraph** (installed GSQL queries, called through the **TigerGraph MCP server**). It writes each case back into the graph, uses **GraphRAG** (vector search + graph expansion) for a cited context, and produces one answer file per case in `cases/<case_id>.json`.

There are two stores behind one interface, and the same tests run on both:

| Store | Selected by | Data | Use it for |
|---|---|---|---|
| in-memory | default (`STORE=memory`) | CSV files in `DATASET_DIR` | fast tests, offline work |
| TigerGraph | `STORE=tigergraph` or `--store tigergraph` | Savanna graphs `FraudTest` (synthetic) and `FraudGraph` (real) | the real workflow |

## 2. Prerequisites

| Need | Check |
|---|---|
| Node 24, pnpm | `node -v`, `pnpm -v` |
| Python 3.10+ and `uv` | `uv --version` |
| Ollama (only for GraphRAG and the LLM narrator) with `nomic-embed-text` (embeddings) and `qwen2.5-coder:7b` (narrator) | `ollama list` |
| A TigerGraph Savanna workspace, **resumed** (Active) | Savanna page |
| `.env` in the repo root with `TG_HOST` and `TG_SECRET` (a Savanna database secret). Never commit or paste it. Template: `.env.example` | `bash scripts/tg-check.sh` |
| The provided data in `Dataset/` (not committed) | `ls Dataset` |

Install once:

```bash
pnpm install
cd py && uv sync && cd ..
```

## 3. Quick check that everything is alive (about 1 minute)

```bash
bash scripts/tg-check.sh
```

Expected: reachable **yes**, token **yes**, REST++ authenticated **4.2.5**, graphs listed. If it says `reachable NO`, the workspace auto-suspended (60 idle minutes, Auto Resume is off): resume it in Savanna. If it says the secret was rejected, create a new database secret in Savanna and update `TG_SECRET`.

Start Ollama in a separate terminal whenever you use `--rag` or the LLM narrator:

```bash
ollama serve
```

## 4. Run the tests

```bash
pnpm typecheck
pnpm test                      # in-memory store, 138 tests, ~2 s
STORE=tigergraph pnpm test     # the same tests against the FraudTest graph through MCP, ~90 s
```

The second command is the proof that the TigerGraph store behaves like the in-memory one, including the no-look-ahead tests. One test that only makes sense in memory is skipped (137 passed, 1 skipped).

## 5. Run cases

All commands run from the repo root. Real data means `DATASET_DIR=data/slim`; without it the synthetic test set (`Dataset/test`) is used.

**One real case on TigerGraph (about 20 s with the cloud AI writer):**
```bash
DATASET_DIR=data/slim pnpm --filter @fraud/backend run cases -- \
  --store tigergraph --rag --only HHG-014 --out data/out-try
```

**All 20 real cases, as submitted (about 8 minutes):**
```bash
DATASET_DIR=data/slim pnpm --filter @fraud/backend run cases -- \
  --store tigergraph --rag --write-graph --out cases
```

Options:

| Flag / variable | Effect |
|---|---|
| `--store tigergraph` | read through the TigerGraph MCP server (default: in-memory) |
| `--rag` | GraphRAG: vector search + graph expansion, cited context for the narrator, policy rules attached as `document` evidence. Needs `ollama serve` and a store with vector indexes (TigerGraph) |
| `--write-graph` | store each case, its evidence and actions in the graph (`written_to_graph: true`, `graph_case_id: FC-<case>`). Omit it for trial runs so you do not add vertices |
| `--only HHG-014,HHG-006` | run only these cases |
| `--out <dir>` | output folder (default `cases/` for real data, `data/out-test/` for synthetic) |
| `LLM_MODEL_OLLAMA` (in `.env`) | the AI model that writes the text. Required: there is no template mode. If it fails three times the case stops with an error |

Cases are processed in `opened_at` order. The command ends with `all files valid`, or lists the files that failed validation (exit code 1).

## 6. Check the results

1. **Read one file**, for example `cases/HHG-006.json`:
   - `case.fraud_probability` is the value **before** any assumed reply.
   - `evidence_requests[].assumed_response` says no reply was invented.
   - `next_best_actions.initial` and `.final` carry the action, route (`auto`, `L1`, `L2`) and the rule cited; `.contingency` holds the plan for a denial, a confirmation and silence.
   - `case.evidence` includes `graph` items and `document` items (policy rules).
   - `sar.file` is true exactly when `FILE_REPORT` is in `final`.
2. **Independent ID check** (every ID must exist in the source data; made-up IDs score zero):
   ```bash
   cd py && uv run python ../data/idcheck.py     # expect: ids checked 315 missing 0
   ```
   (This script is a scratch file in `data/`, which is git-ignored; it reads the CSVs directly, not the graph.)
3. **Look in the graph.** In Savanna, open the workspace, Graph Studio or GSQL, graph `FraudGraph`, and look at the `FraudCase`, `Evidence` and `Action` vertices. Or from the command line:
   ```bash
   cd py && python -c "import sys; sys.path.insert(0,'src'); from fraudpy.tg import TG; print(TG().post_json('/restpp/builtins/FraudGraph?realtime=true',{'function':'stat_vertex_number','type':'FraudCase'}))"
   ```

## 6b. Is the answer correct? Run the backtest

The 20 exam cases have no answer key, so their correctness cannot be proven directly. What can be measured is how the agent does on the 5,565 past **closed cases**, whose real outcome (confirmed fraud or cleared) is known. The backtest replays each one as a brand-new alert, frozen at its own opening time (nothing from the future is visible, and only cases that had already closed can be recalled), and compares the agent's answer with what really happened.

```bash
DATASET_DIR=data/slim pnpm --filter @fraud/backend run backtest -- --limit 300           # ~12 s, October cases
DATASET_DIR=data/slim pnpm --filter @fraud/backend run backtest -- --from 2016-09-01 --limit 1000
```

It prints:
- **Separation (AUC)**: how well the fraud chance ranks real fraud above real innocent cases (0.5 = coin flip, 1.0 = perfect). This is the fairest single number.
- **Calibration**: when the agent says 30 to 50%, how often was it really fraud?
- **Verdicts**: how often "likely fraud", "not sure" and "looks genuine" were right.
- **Pattern** and **action** agreement with what analysts really did.

Read it with care: the history is 89% fraud in October and cleared cases only exist for high-score alerts, so raw accuracy and Brier score mislead. Use AUC and the calibration table. The exam cases are never used here.

Other checks that need no answer key: `pnpm test` (behaviour on planted scenarios written from the policy), the validator (every rule and ID), `data/idcheck.py` (every ID exists), and reading the evidence for a few cases by hand.

## 7. The console (demo view)

```bash
# terminal 1: API on http://localhost:4000
pnpm dev:backend            # reads .env
# terminal 2: console on http://localhost:3000
pnpm dev:frontend
```

Pick a case and press **Investigate**. The timeline shows each step as it happens: Intake, Prosecution, Defence, Sweep (with the contagion rank), Recall (including "GraphRAG: N similar closed cases"), Judge, Stop rule, Plan, Checkpoint, Policy, Explain, SAR, Graph (write-back), Validate.

Suggested demo path: **HHG-014** (a 0.05 score turns out to be a ring on a shared device profile) then **HHG-018** (a report the defence questions) then **HHG-006** (structuring, with L1 and L2 approval cards). The console's reply override (`denies`, `confirms`, `silent`) is a labelled what-if: it changes the actions, never the probability.

## 8. One-time setup of the TigerGraph graphs

Only needed to rebuild from scratch (the graphs are already loaded). Order matters:

```bash
cd py
# loading files from the slim data (use ../Dataset/test and ../data/tg-test for the synthetic graph)
uv run python scripts/export_slim.py                                             # once: data/slim from the full Dataset
uv run python scripts/export_tg.py --src ../data/slim --out ../data/tg-real
uv run python scripts/tg_schema.py FraudGraph                                    # local types, no collision with the sample graph, plus the vector attributes (~75 s)
uv run python scripts/tg_load.py FraudGraph ../data/tg-real                      # streams files through REST++ (~5 min)
uv run python scripts/tg_queries.py FraudGraph                                   # creates and installs all 16 GSQL queries, including the RAG ones (~4 min)
ollama serve                                                                     # other terminal
uv run python scripts/tg_rag_load.py FraudGraph ../data/tg-real                  # embeds policy, FinCEN PDFs and closed-case notes (~10 min)
```

Notes:
- The schema is `gsql/schema.gsql.tmpl`, the vector attributes `gsql/vectors.gsql.tmpl`, the queries `gsql/queries.gsql.tmpl` and `gsql/rag.gsql.tmpl`. The scripts apply them all; `@G@` in each template is the graph name.
- The FinCEN PDFs are read from `data/docs/` (public documents linked in `Dataset/README.md`).
- The MCP server is started for you by the backend through `py/scripts/tg_mcp_launcher.py`, which exchanges `TG_SECRET` for a fresh one-hour token each start. You do not run it by hand.
- Savanna credits are limited. Keep auto-suspend on, and resume only when you need it.

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `reachable NO` in `tg-check.sh` | Workspace suspended. Resume it in Savanna. Consider enabling Auto Resume (workspace menu, Configuration, Advanced Settings). |
| Secret rejected / 401 | Create a new database secret in Savanna, update `TG_SECRET` in `.env`. Tokens last one hour; the client and launcher refresh them. |
| `flagged transaction ... not found` | Wrong graph for the data. Real data (`DATASET_DIR=data/slim`) maps to `FraudGraph`; the synthetic folder maps to `FraudTest`. Set `DATASET_DIR` accordingly. |
| `Query endpoint ... is disabled` / `rag_...` unavailable | A query was re-created and is no longer installed. Run `INSTALL QUERY ALL` on that graph (about 50 s), for example via `py/scripts/tg_queries.py`. |
| `The AI model (...) could not write the summary` | The model is unreachable or gave unusable text 3 times. Check Ollama is running, the name in `LLM_MODEL_OLLAMA` is right, and (for cloud models) that you are signed in to Ollama. The case is not written until it works. |
| `Could not look up similar past cases` in the trace | Ollama is not running (`ollama serve`) or the vectors are not loaded. The case still completes on the graph signatures alone. |
| Slow first call | The MCP sidecar starts on the first query (a few seconds). Each query is then about 0.3 to 1 s over the network. |
| `TigerGraph query ... failed` | A real error, not an empty answer. Read the message; check the workspace is Active. |
| Windows: regexes or paths with backslashes break in shell one-liners | Use the editor tools or a script file, not heredocs or `sed`, for backslash-heavy text. |
| VRAM pressure with the local 7B model | Close other GPU apps, or use the cloud model in `.env` (`gemma4:31b-cloud`). |

## 10. Rules to keep in mind

- Never use the original public IEEE-CIS files to recover outcomes.
- Every ID in an answer file must exist in the dataset. Card labels that no source names are never emitted.
- Do not tune thresholds on the 20 exam cases. Tune only on closed cases with a time split (the backtest is the next piece of work, see `TODO.md`).
- Action names and approval routes are copied exactly from the policy. The agent recommends; only `auto` actions may ever be executed.
- Never paste `.env`, the secret or a token into chat, issues or commits.

## 11. What this run does not tell you

These runs show the system works and is consistent (tests on both stores, valid files, existing IDs). They do **not** measure accuracy: the exam cases have no answer key and the calibration constants are still v0. Accuracy needs the backtest on closed cases (`TODO.md`, section 2).
