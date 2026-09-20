# CLAUDE.md — TigerGraph Agentic Fraud Investigation (Hacker House Goa)

This file is the single briefing for anyone (human or Claude) working in this repo. Read it fully before changing code. If something here conflicts with `spec.md` or `Dataset/README.md`, those two files win, and this file should then be corrected.

Design page (living, shareable): https://claude.ai/artifact/EsZtbNYzWkJ3EpK7A7DvVp
**Status (2026-09-20): the agent runs end to end on TigerGraph.** The cloud graph `FraudGraph` (590,742 transactions, 14,318 cards, 9,706 device profiles, 5,565 closed cases) and the test graph `FraudTest` are loaded on Savanna; 16 GSQL queries are installed; every read goes through the TigerGraph MCP server (`TigerGraphStore`); cases are written back to the graph; GraphRAG (vector search plus graph expansion) builds a cited context. 138 tests pass on the in-memory store **and** on `FraudTest` (`STORE=tigergraph pnpm test`). The 20 real answer files are in `cases/`. Still open: the backtest and calibration (constants are v0), account takeover, the numeric lookalike channel, the deliverables (video, blog, social post). The ordered list is `TODO.md`; section 14 says exactly what exists. Quick start and layout are in `README.md`.
Note: the provided dataset folder was renamed from `HHGOA_IEEE` to `Dataset`. The synthetic test data lives at `Dataset/test/`.

---

## 1. What we are building

An **agentic fraud investigation system on TigerGraph**. Given one of 20 alerts (the "case pack"), the agent must:

1. investigate using the graph, closed cases and policy documents,
2. decide what kind of fraud it is (or that it is legitimate) and how far it goes,
3. recommend the **next best action** with the required **approval route**, both **before** and **after** any evidence it asks for,
4. produce a case record (also written into the graph), and a suspicious activity report (SAR) when the policy calls for one,
5. stop when a defensible decision is reached.

Deliverables (from `spec.md`): working agent, GitHub repo, **20 answer files** in `cases/<case_id>.json`, a 3–5 minute demo video, a technical blog post, and a social post tagging @TigerGraphDB. A UI is **required** (spec: "Provide a user interface"). A live hosted deployment is **not** required; the demo video is the presentation.

Judging weights: Investigation accuracy 25 · Next best action 25 · Case summary and explainability 10 · Agentic design and engineering 15 · Innovation 15 · Demo quality 10.
The answer key is hidden. Answers are scored against it, including **calibration of `fraud_probability`**.

## 2. Source-of-truth files and hard rules

| File | Role |
|---|---|
| `spec.md` | Problem statement, required components, judging |
| `Dataset/README.md` | Dataset guide, **Fraud Policy (actions, routes, rules R1–R10)**, **Answer Format**, the 20 cases |
| `Dataset/transactions.csv` | 590,742 rows × 397 columns (~708 MB) |
| `Dataset/identity.csv` | 144,432 rows × 41 columns (online only) |
| `Dataset/closed_cases_history.csv` | 5,565 closed cases Jul–Oct (4,665 fraud, 900 cleared) |
| `Dataset/case_pack.csv` | The 20 exam cases (Nov–Dec) |

**Hard rules (breaking any can disqualify or zero a score):**
- **Never use the original public IEEE-CIS / Kaggle files** to recover outcomes. Use only the provided files. IDs, times and amounts were deliberately transformed.
- **Every ID in an answer file must exist in the dataset** (transactions, cards, customers, `CC-` cases, device profiles). Made-up IDs score zero.
- **Action names and approval routes must match the policy exactly** (section 9).
- **The agent recommends; only `auto` actions may be executed.** `L1` / `L2` actions are recommended with the route and wait for a human.
- **No look-ahead.** Every query is bounded by `as_of = case.opened_at`. The data runs to Dec 31; a case opens 1–6 hours after its flagged transaction.
- **Do not tune on the 20 exam cases.** Tune only on the closed cases with a time split.
- **Do not use data-generation artifacts as features** (for example quirks in how rows were seeded, such as timestamp granularity). A feature must be explainable in a fraud analyst's language.
- Do not commit the dataset, API keys, or `.env`.

## 3. Dataset facts

- `transactions.csv` joins `identity.csv` on `TransactionID`. All 393 original Vesta columns are kept, plus `customer_id`, `ts`, `channel`, `risk_score`. **No fraud flag exists.**
- `ts` is real time, 2016-07-02 to 2016-12-31. **Use `ts`, not `TransactionDT`.**
- `channel`: `in_person` = product `W`, no identity record (439,670 rows). `online` = products C/H/R/S (151,072 rows).
- `customer_id` is derived from the issuer field (`card1`). 13,553 customers.
- `risk_score` is 0–1 from the bank model: **an input, never an answer.**
- `addr1` = billing region (332 values), `addr2` = country (87 = home). `dist1/2`, `P_/R_emaildomain` (60 domains).
- `C1–C14` counts, `D1–D15` day deltas, `M1–M9` match flags, `V1–V339` engineered features — **all unnamed**. May be used as signals; the evidence must say they are unnamed engineered features. Never claim to know what `V127` means.
- Identity: `id_15` (New/Found), `id_23` (proxy: TRANSPARENT/ANONYMOUS/HIDDEN), `id_30` OS, `id_31` browser, `id_33` screen, `DeviceType`, `DeviceInfo`.
- **Device profile** = `DeviceInfo | id_30 | id_31 | id_33` (README definition). 9,706 distinct profiles.
- Closed cases columns: `case_id, customer_id, card_id, opened_at, closed_at, outcome, pattern, first_fraud_txn_id, txn_ids (pipe-separated), n_txns, exposure_usd, connected_card_ids, actions_taken, report_filed, analyst_notes`.
- Case pack columns: `case_id, opened_at, trigger_type, trigger_text, flagged_txn_id, card_id, customer_id, risk_score`.
- Case card IDs look like `C01234-K1`. **`transactions.csv` has no card ID.** See 6.3.

## 4. What the data actually says (measured, do not re-litigate without re-measuring)

Measured with DuckDB. Model comparisons use a time split: train Jul–Sep, test Oct.

1. **The risk score is close to a decoy.** All 900 cleared cases scored ≥ 0.81 (mean 0.88). Confirmed-fraud transactions average 0.47; 31% score under 0.3. Undocumented-pattern fraud averages 0.14. Un-cased transactions average 0.16.
2. **Innocence has three faces** (all 900 cleared cases were score-triggered): travel to the billing region 716 (80%), confirmed purchase from a new phone 158 (18%), confirmed unusual-amount purchase 26 (3%). **There are no historical negatives for customer-report or analyst triggers**, so policy R7 (recurring charge) needs rule-based tests, not memory.
3. **Graph features resolve what the score cannot.** Among alerts scoring ≥ 0.8 (52% fraud in the held-out month), graph features alone reach AUC 0.914.
4. **Anonymous Vesta features carry independent signal.** C/D/M/V alone: AUC 0.845. Score+amount: 0.874. All: 0.931.
5. **Two undocumented patterns exist in history:**
   - **Device ring:** fingerprint `SM-G935F Build/NRD90M | Android 7.0 | chrome 62.0 for android | 1920x1080`, always `New` and `IP_PROXY:ANONYMOUS`. 114 transactions, 52 customers overall. **Nov–Dec: 60 transactions, 28 customers, every score 0.01–0.44, none in any closed case.** As of HHG-014's open time: 44 customers, 80 transactions.
   - **Threshold structuring:** four online purchases each just under $500 within about 30–40 minutes (e.g. CC-3748, CC-3841).
6. **Customers are aggregates, not people.** 26 customers have > 3,000 transactions (one card > 10,000); 104 customers with > 1,000 transactions hold 284k of 590k rows (48%). Baselines must be per card / per region and hub-aware.
7. **Card IDs (`K1`/`K2`) cannot be derived** from card fields (best rule matches ~80%). Card ≈ (customer, `card4` network, `card6` type) with `card5` variants merged; empty-field rows form their own card. Labels come from an alias table.
8. **Closed cases are templated.** Analyst notes are near-identical per pattern, so text search alone is weak memory. The value is **structural** (shared transactions, cards, devices, regions).
9. Closed history is **84% fraud**; the exam is described as about half legitimate. Correct the prior; do not train on raw class frequency.
10. **A signal's meaning depends on the bank-score zone (measured in `py/notebooks/02_*`, section 6b).** Inside score ≥ 0.8 (the only place both outcomes exist), "suspicious-looking" signals point to *innocence*: among online alerts, 98% of cleared cases show a `New` device vs 36% of fraud; new region and unusual amount behave the same way (false alarms are the decoys). Below 0.8 a New device is evidence of fraud. So there are two signatures, `new_device` (< 0.8, prosecution, +1.2) and `new_device_at_high_score` (≥ 0.8, defence, −0.7 = `baseline_v0.json`). A test keeps the constant in sync with the JSON. Inside the zone the bank score alone has AUC 0.62; graph features alone 0.91.
11. **The ring rule must be specific.** Measured over all 9,706 device profiles (notebook 01, section 7c): a loose rule (users ≥ 8 and New share ≥ 0.7) flagged **212** profiles, mostly generic iPhones shared by hundreds of customers. The coded rule (5 to 200 users, New share ≥ 0.9, anonymous-proxy share ≥ 0.8) flags 2. It follows the closed ring cases ("behind an anonymous proxy, never seen on this account").
12. **Memory must not use "same customer".** Closed history is 84% fraud, so any customer with history looks guilty. Only *shape* matches (same structuring, same ring device, same trip or new-phone pattern) count as memory evidence. Enforced by `backend/tests/hygiene.test.ts`.

## 5. Architecture (v2, decided)

**Principle: the graph does analysis, the LLM plans and explains, a deterministic policy engine decides what may happen.**

Layers:
1. **Entry:** risk-score alert, customer report, analyst request; analyst console.
2. **Orchestrator (LangGraph.js state machine):** Intake → Recall → Advocates (parallel) → Judge → [stop rule] → Plan → Gate → Act → Learn. Evidence ledger and case state are typed and versioned.
3. **Deterministic engines:** signature library (GSQL), contagion + rarity (personalised PageRank), calibrated judge (log-likelihood ledger), policy engine (R1–R10), response simulator.
4. **TigerGraph:** transaction graph, case memory, vector indexes (text; numeric not built), installed GSQL + algorithms (the contagion sweep is our own personalised PageRank in GSQL, degree-normalised and rarity-weighted; the GDS library was not needed), all exposed through TigerGraph MCP (`tigergraph-mcp`, 69 tools; the agent uses `run_installed_query`, `add_nodes`, `add_edges`, `has_node`).
5. **Offline pipeline:** loader, backtest harness (time-machine replay of closed cases), calibration tables as JSON.

### Six differentiators (keep them; they are the Innovation score)
1. **Prosecutor and defence in parallel.** Fraud signatures vs innocence signatures (trip continuity, device succession, recurring cadence with a coincidence test, baseline-consistent spend).
2. **Score-blind contagion sweep.** Personalised PageRank from confirmed-fraud entities over card/device/region/email, with **fingerprint-rarity (IDF) weighting** so generic devices are noise and the ring fingerprint stands out.
3. **Evidence ledger with independence classes.** Classes: bank score, card behaviour, device, geography, network, memory, numeric lookalike, customer reply. Same-class evidence contributes its maximum, not its sum. This computes the policy's "at least two independent pieces of evidence".
4. **Response-conditional planning.** Precompute the action plan for all three replies (denies R2 / confirms R3 / silent R4) before asking. By default no reply is invented: silence (R4) is assumed and recorded in `evidence_requests`, and the other two plans stay in `next_best_actions.contingency` (section 15, decision 1).
5. **Time-machine backtest and causal memory.** Replay any closed case as if new, frozen at its `as_of`. Exam cases are processed in `opened_at` order and may recall only earlier cases.
6. **Deterministic engines, three LLM calls.** Plan next evidence, write explanation, compose SAR narrative. Counters `tool_calls`, `tokens`, `latency_s` are measured by the orchestrator and reported.

### Investigation loop (maps to the README's eight steps)
Trigger → Intake (pin `as_of`, resolve card, open/attach case) → Recall (structural, semantic, numeric) → Advocates in parallel (Prosecution, Defence, Sweep) → Judge (p, independent classes, open questions) → **stop rule**:
- Stop if **p ≥ 0.85 or p ≤ 0.15 with ≥ 2 independent evidence classes**, or a verification reply settles it, or further steps are unlikely to change the decision (write `stop_reason`).
- Else if budget remains: Plan the request with best value of information → **Checkpoint 1 (initial actions)** → simulated reply → back to Judge.
- Else (budget spent, still uncertain and exposed): add `ESCALATE_TO_ANALYST` (R8) with the gap list.
Then Act (auto only) → Explain → SAR if required → write case to the graph.
Budgets (defaults): 3 evidence rounds, 20 graph calls, 1 request per type per case.
If no evidence was requested, `initial` equals `final` and `what_changed` is `"nothing"`.

## 6. Graph model and loading

### 6.1 Schema (README suggestion plus derived vertices)
Vertices: `Customer`, `Card`, `Transaction`, `DeviceProfile`, `BillingRegion`, `EmailDomain`, `ClosedCase`, `Case`, `Evidence`, `Action`, `Pattern`, `PolicyChunk`, and derived `Episode` and `Ring`.
Edges: `Customer-OWNS->Card`, `Card-MADE->Transaction`, `Transaction-NEXT->Transaction` (by `ts`, within a card), `Transaction-FROM_DEVICE->DeviceProfile`, `Transaction-BILLED_IN->BillingRegion`, `Transaction-PURCHASER_EMAIL->EmailDomain`, `Transaction-IN_EPISODE->Episode`, `Card-MEMBER_OF->Ring`, `ClosedCase-INVOLVES->Transaction`, `ClosedCase-ON_CARD->Card`, `ClosedCase-CONNECTED_TO->Card`, `Case-INVOLVES/CONNECTED_TO/SUSPECTS/MATCHES/RETRIEVED/HAS_EVIDENCE/RECOMMENDS`, `Evidence-CITES->Transaction`, `Action-UNDER_RULE->PolicyChunk`, `PolicyChunk-DESCRIBES->Pattern`.
Every time-queried edge carries the transaction `ts`. Every installed query takes `as_of`.

**Names as built** (the workspace's sample graph owns the global types `Card`, `Cases`, `Product`, edge `DESCRIBES`; `Case` is a GSQL keyword; `proxy` is a reserved attribute name): `BankCard` (not Card), `FraudCase` (not Case), `DESCRIBES_PATTERN`, `proxy_kind`. Edges are directed with reverse edges: `OWNS/OWNED_BY`, `MADE/MADE_BY`, `NEXT/PREV`, `FROM_DEVICE/DEVICE_OF` (carries `ts`, `is_new`, `proxy_kind`), `BILLED_IN`, `PURCHASER_EMAIL`, `CLOSED_INVOLVES` (with `seq`, the position in the case's transaction list), `CLOSED_ON_CARD`, `CLOSED_CONNECTED`, `CLOSED_MATCHES`, and for our own cases `INVOLVES`, `CASE_ON_CARD`, `CASE_CONNECTED_TO`, `CASE_SUSPECTS`, `CASE_MATCHES`, `RETRIEVED`, `HAS_EVIDENCE`, `CITES`, `RECOMMENDS`. Vector attributes `emb` (768, cosine) live on `ClosedCase`, `PolicyChunk`, `FraudCase`. `Episode`, `Ring` and stored derived attributes were not built: as-of-dependent aggregates are computed in queries so they cannot look ahead.

### 6.2 What to load (393 columns is too many)
- **Keep as attributes:** `TransactionID`, `ts`, `TransactionAmt`, `ProductCD`, `channel`, `risk_score`, `addr1/2`, `dist1/2`, email domains, `card2–6`, `M1–M9`, `C1–C14`, `D1–D15`, identity ratings, `id_15/23/30/31/33`, `DeviceType/Info`.
- **Compress:** V1–V339 plus C and D into a 32-dim standardised vector (PCA fitted on Jul–Sep only), stored as a vector attribute for lookalike search.
- **Keep out of the online store:** raw V columns (leave in Parquet under `data/`).
- **Derived vertex/edge attributes computed offline:** device rarity (distinct customers, first/last seen, share New, share behind proxy, IDF weight), card baselines (median, p95, home region, product set), hub flag (volume implausible for one person), ring membership, episode grouping (default 2-hour burst window).

### 6.3 Card resolution
Card = (customer, `card4`, `card6`). Build an **alias table** mapping label `Cxxxxx-Kn` to that tuple from `closed_cases_history.csv` and `case_pack.csv`. **Implemented:** an alias is used when a source file names the card; otherwise the label is a best-effort `Cxxxxx-Kn` guess (~80% right) and is **marked `derived`**. The customer ID is always real. **Decided (user, 2026-09-20): omit unresolved cards.** Only labels a source file names are emitted; the orchestrator drops derived labels and the validator treats one as an error (`derived_card_label`). Evidence text says how many more cards share a device but cannot be named.

## 7. Signature library (each = one installed GSQL query returning boolean, strength, entity IDs, provenance)

| Signature | Side | Test | Supports |
|---|---|---|---|
| Test then spend | prosecution | 3+ online auths under ~$5 on one card within an hour, then a larger purchase | `card_testing`, R5 |
| Off-profile burst | prosecution | 2–4 online txns in 48 h, amount above card p95 or unused product | `card_not_present_fraud`, R1–R4 |
| New-device attribution | prosecution (score < 0.8) / **defence** `new_device_at_high_score` (score ≥ 0.8) | `id_15 = New`, weighted by fingerprint rarity; at bank score ≥ 0.8 it reads as a new phone and counts toward innocence (finding 10). ×0.25 on hub cards | `card_not_present_new_device` |
| Out-of-region while home continues | prosecution | card-present in a region with no card history while home-region activity continues | `out_of_region_use`, R2/R3 |
| Mixed-channel inconsistency | prosecution | in-person and online mix inconsistent with history, `M` flag and device anomalies | `account_takeover` |
| Threshold hugging | prosecution | 3+ txns in ~40 min each within ~10% below a round threshold ($500, $1,000) | `undocumented`, R9 |
| Shared rare fingerprint | prosecution | 5 to 200 users, New on ≥ 90% of uses, anonymous proxy on ≥ 80% (finding 11); returns ring, still-live members, and already-handled members | R6, R9 |
| Trip continuity | defence | consecutive days in the new region at human cadence and home activity stops | cleared: travel |
| Device succession | defence | new profile replaces an old one for the same card, same brand/OS family, not shared with unrelated cards | cleared: new phone |
| Recurring cadence | defence | same amount at regular gaps **with a coincidence test** against the card's own amount distribution | R7 |
| Baseline-consistent spend | defence | within p95, product and region already used, typical hour | cleared: unusual purchase |
| Hub hygiene | meta | flags aggregate customers; switches to per-card, per-region baselines | all |
| Novelty detector | meta | strong cumulative evidence with cross-customer coordination or evasion but no known signature | R9, `pattern_description` |

**The bank score is not a signature.** It enters the ledger as one evidence class through a learned, non-monotonic curve, so a 0.9 can lower the probability when the defence explains it.

## 8. The calibrated judge

- `fraud_probability` is computed, not guessed: prior by trigger type + sum of per-class log-likelihood ratios (learned from closed history for each signature, shrunk toward zero for small samples) → probability.
- **Prior-shift correction:** history is 84% fraud, exam ≈ 50% legitimate. Reset prior odds; estimate ratios against matched negatives.
- **Independence classes** cap correlated evidence; across classes log-ratios add with a global damping factor tuned on backtest.
- Three quantities, kept separate: **probability p**, **independent classes k**, **open questions** (unanswered signatures / defence tests).
- All coefficients ship as a JSON table in `calibration/`. Production code only does lookups and additions. **No ML runtime in TypeScript.**
- Thresholds from the policy: 0.15, 0.30, 0.70, 0.85.

## 9. Fraud policy (copy exactly; source is the README)

### Actions and routes
- **`auto`:** `ALLOW_TRANSACTION`, `MONITOR_CARD`, `MONITOR_CONNECTED_CARDS`, `WARN_CUSTOMER`, `VERIFY_WITH_CUSTOMER`, `STEP_UP_AUTH`, `GENERATE_REPORT`, `CREATE_CASE`, `ESCALATE_TO_ANALYST`, `CLOSE_NO_FRAUD`
- **`L1` (team lead):** `DECLINE_TRANSACTION`; `BLOCK_CARD` when exposure ≤ $2,500
- **`L2` (fraud manager):** `BLOCK_CARD` when exposure > $2,500; `BLOCK_ALL_CARDS` always; `FILE_REPORT` always

### Rules
- **R1** Single signal (including score alone) and p < 0.70 → `VERIFY_WITH_CUSTOMER` or `STEP_UP_AUTH` before any block. Blocking a legitimate customer on one signal is a policy breach.
- **R2** Customer denies → `BLOCK_CARD`, `CREATE_CASE`; add `FILE_REPORT` if exposure > $1,000 or shared device profile or another card's fraud.
- **R3** Customer confirms → `CLOSE_NO_FRAUD`; note confirmation.
- **R4** No reply in 24 h → `MONITOR_CARD`, `DECLINE_TRANSACTION` for pending; escalate if exposure > $500.
- **R5** Card testing (3+ small online auths within an hour, then a larger purchase) → `DECLINE_TRANSACTION`, `STEP_UP_AUTH`; if a purchase > $100 already cleared → `BLOCK_CARD`.
- **R6** Several cards show fraud from the same device profile, region or recipient email in one window → name the shared element; `CREATE_CASE`, `FILE_REPORT`, `MONITOR_CONNECTED_CARDS` for every card that shares it.
- **R7** Customer disputes a charge matching their own recurring pattern → `CREATE_CASE`, `VERIFY_WITH_CUSTOMER`, `WARN_CUSTOMER`. Do not block.
- **R8** Verdict `uncertain` and exposure > $500, or evidence conflicts → `ESCALATE_TO_ANALYST`.
- **R9** No known pattern but coordinated or repeated abuse across customers → `CREATE_CASE`, `FILE_REPORT`, `ESCALATE_TO_ANALYST`; describe the pattern in own words; do not force a category.
- **R10** Never `BLOCK_ALL_CARDS` unless ≥ 2 of the customer's cards show confirmed fraud or credentials are confirmed compromised.

### Case vs report
- `CREATE_CASE` when p ≥ 0.30, whenever evidence is requested, or on any customer dispute.
- `FILE_REPORT` only if fraud is confirmed or strongly suspected **and** at least one of: exposure > $1,000; shared device profile / region cluster / another customer's fraud; coordinated or undocumented (R9). A report always has a case behind it.
- **Exposure** = sum of absolute amounts of every affected transaction including the flagged one. **Computed by the policy engine from transaction IDs, never by the LLM.**
- Customer/analyst replies are **not provided**: simulate them and record the assumption in `evidence_requests[].assumed_response`.
- Every recommendation must cite: evidence used, why more evidence was requested, and the rule number.

## 10. Answer format (one file per case: `cases/<case_id>.json`)

Top level: `case_id`, `case`, `evidence_requests[]`, `next_best_actions`, `sar`, `stop_reason`, `tool_calls`, `tokens`, `latency_s`.

- **`case`:** `status` (`open|closed_fraud|closed_legitimate|escalated`), `verdict` (`fraud|legitimate|uncertain`), `fraud_probability` (0–1, scored for calibration), `pattern` (`card_testing|card_not_present_fraud|card_not_present_new_device|out_of_region_use|account_takeover|undocumented|none`), `pattern_description` (required iff `undocumented`, else `""`), `affected_txn_ids`, `first_suspicious_txn_id`, `connected_card_ids`, `connected_device_profiles`, `exposure_usd`, `evidence[]` (`claim`, `source` = `graph|document|customer|external`, `ref`, `entity_ids`), `similar_prior_cases` (real `CC-` IDs), `summary` (2–6 sentences), `written_to_graph`, `graph_case_id`.
- **`evidence_requests[]`:** `type` (`customer_validation|step_up_auth|analyst_info`), `asked_after_step`, `assumed_response`.
- **`next_best_actions`:** `initial[]`, `final[]` (each `action`, `route`, `reason` citing the rule), `what_changed`.
- **`sar`:** `file`, `reason`, `narrative` (6–12 sentences: who, what, when, where, how, why suspicious; must stand alone), `subjects[]`, `total_amount_usd`, `activity_dates` (two `YYYY-MM-DD`). If `file` is false: `narrative` `""`, `subjects` `[]`, amount `0`, dates `[]`.

Validator (build it; run before writing every file):
- All IDs exist in the graph. `exposure_usd` = sum of |amount| of `affected_txn_ids`; 0 and empty list for `legitimate`.
- `sar.file` ⇔ `FILE_REPORT` in `final`.
- Route for each action matches the policy engine for that exposure.
- `pattern_description` non-empty exactly when `undocumented`.
- `what_changed` is `"nothing"` exactly when `initial` equals `final`.
- Every evidence claim has `source`, `ref`, and entity IDs (customer replies excepted).
- The README's HHG-017 example must pass; deliberately broken files must fail.
`uncertain` is a valid verdict and earns full credit on designed-ambiguous cases if actions follow R1 and R8. Keep `summary` short; the SAR narrative is the one place to be complete.

## 11. Models and environment (**free models only at runtime**)

**Decision (user):** use free models, with **`qwen2.5-coder:7b` on local Ollama as the primary**. The project makes only three LLM calls per case (plan, explain, SAR narrative), each with a strict schema, and everything else is deterministic, so a small local model is acceptable.

**Superseded 2026-09-20: the writer model is set in `.env` (`LLM_MODEL_OLLAMA`), default the free cloud model `gemma4:31b-cloud`; the local `qwen2.5-coder:7b` remains available. Earlier decision, kept for history: `qwen2.5-coder:7b` via local Ollama.** It is already installed (Ollama v0.30.10), free, unlimited, private, offline and reproducible, and needs no API key. Other models present: `qwen2.5-coder:1.5b`, `qwen2.5vl:3b`, `minicpm-v4.6`, `nomic-embed-text` (embeddings), `gemma4:31b-cloud` (Ollama cloud-hosted; limits unverified, not relied on).

### Provider chain (one OpenAI-compatible adapter, config-driven)
1. **Primary: local Ollama `qwen2.5-coder:7b`.** Use Ollama's JSON-schema `format` for structured output; low temperature.
2. **Optional fallback: Google AI Studio free tier**, a current Gemini Flash-class model, no credit card. Only used if the local model fails validation after retries and a key is configured. Caveat: outside the EU/UK/EEA Google may use free-tier prompts to improve its products; never send secrets or keys.
3. **Optional fallback: Groq free tier** (e.g. `gpt-oss-120b`, Llama 3.3 70B; reported ~1,000 requests and ~200k tokens/day per model) and **OpenRouter `:free` models** (reported ~50 requests/day).
4. **Last resort: deterministic templates** (always available, always valid).
5. **No template mode (decided 2026-09-20).** The text is always written by the model in `.env` (`LLM_MODEL_OLLAMA`); if it fails after retries the case stops with a clear error. Backtests only look at decisions and use `DecisionOnlyNarrator`, which writes no text. A deterministic writer exists only as a test fixture (`backend/tests/fixtures/templateNarrator.ts`).

### Running qwen2.5-coder:7b well (constraints to design around)
- **It is code-tuned.** Strong at following JSON schemas; weaker at fluent narrative. So: keep prompts short and structured, ask it to fill fields, and let templates carry the SAR skeleton (who/what/when/where/how/why) while the model only polishes wording. Validate everything.
- **Set the context window explicitly.** Ollama's default context is small. Use `num_ctx` 8192 (env `OLLAMA_NUM_CTX`) and budget the GraphRAG brief to **at most ~5k tokens** for the local model (make the context builder's token budget a parameter, larger for Gemini).
- **VRAM is tight.** RTX 4060 Laptop has 8 GB; a 7B Q4 model is ~4.7 GB plus KV cache, and only ~5.8 GB was free at check time. Close other GPU apps before runs; if it spills to CPU it still works but slower. Do not run the embedding model and the chat model in a way that forces repeated reloads (Ollama keeps models loaded for a short time; batch embeddings first, then run the LLM).
- **One request at a time** locally. Keep the parallel advocates in code (they are GSQL, not LLM); only the three LLM calls per case are sequential.
- **Decide with a quick A/B, not a guess.** After the first end-to-end run, compare `qwen2.5-coder:7b` against Gemini on 3 cases (schema pass rate, evidence citation accuracy, SAR completeness). Keep the local model primary unless it clearly loses; record the result here.

Free-tier limits change often. **Re-check current limits before the final run.**

### LLM usage rules
- Only three call types: `plan_next_evidence`, `explain_case`, `compose_sar`. No other LLM use in the decision path.
- Every call returns JSON validated by a Zod schema (from one source of truth). On failure: retry up to 2 times feeding the validator error back, then **fall back to a deterministic template** so a valid file is always produced. The system must never fail to write a case because a free model misbehaved.
- Cache responses by hash of (model, prompt, schema). Reruns and demos then cost nothing and are reproducible. Record the model name in run logs.
- The LLM cannot add actions, change routes, set exposure, or invent IDs. It phrases; the engines decide.
- Explanation checker: reject any sentence without an evidence citation; check numbers in text against the ledger.
- SAR composer: fill who/what/when/where/how/why from the ledger, LLM only smooths; validator checks all six are present and every subject ID exists.
- Rate-limit handling: queue with exponential backoff; automatic fall-through to the next provider.

### Embeddings (free, already available)
`nomic-embed-text` through Ollama (installed, 768-dim). Use for closed-case notes, README pattern text, policy, and chunked regulatory documents. Numeric lookalike vector is PCA(32) from scikit-learn, not an LLM.

### Machine (checked 2026-09-19)
Windows 11; Ryzen 7 7435HS (16 threads); **23.7 GB RAM** (give WSL/Docker ~12 GB for TigerGraph); RTX 4060 Laptop 8 GB VRAM; D: 799 GB free, C: 47 GB free (keep data/Docker volumes on D:); Docker 28.3.3; Git 2.53; WSL Ubuntu; Node 24.12; npm 11.6; pnpm 11.1; Python 3.11.5; uv 0.11; Ollama 0.30.10. **No LLM API keys are set, and none are required** because the primary model is local.

### Environment variables (`.env`, git-ignored; commit `.env.example`)
```
LLM_PROVIDER_CHAIN=ollama,gemini,groq,openrouter
OLLAMA_HOST=http://localhost:11434
LLM_MODEL_OLLAMA=qwen2.5-coder:7b
OLLAMA_NUM_CTX=8192
LLM_BRIEF_TOKEN_BUDGET=5000   # GraphRAG brief size for the local model
GEMINI_API_KEY=            # optional fallback, Google AI Studio free
LLM_MODEL_GEMINI=          # current Flash-class model id from AI Studio
GROQ_API_KEY=              # optional fallback
LLM_MODEL_GROQ=gpt-oss-120b
OPENROUTER_API_KEY=        # optional fallback
EMBED_MODEL=nomic-embed-text
TG_HOST=https://<workspace-domain>.i.tgcloud.io
TG_RESTPP_PORT=443
TG_GS_PORT=443
TG_GRAPH=FraudGraph
TG_GRAPH_TEST=FraudTest
TG_SECRET=                 # from Savanna > Database Secrets; never commit
DATA_DIR=D:/Coding/hhg-task/Dataset
RUN_MODE=benchmark         # benchmark | live | backtest
```

### TigerGraph
- **TigerGraph Savanna (cloud), decided 2026-09-20** because local Docker was too resource-heavy. Workspace `MyWorkgroup / MyWorkspace`, TigerGraph **4.2.5**, 2 vCPU, 16 GiB, AWS us-east-1, address in `.env` (`TG_HOST`, port 443). Auth: a database secret in `.env` (`TG_SECRET`) is exchanged for a **1-hour** JWT with `POST /gsql/v1/tokens` (the old `/restpp/requesttoken` does not work); REST++ is under `/restpp`, GSQL under `/gsql/v1/statements`. Verify with `bash scripts/tg-check.sh`. Free credits, not a free instance ($75 total via onboarding). Auto Suspend is on (60 min) but **Auto Resume is off**: turn it on or the workspace stays asleep. A sample graph `Transaction_Fraud` already exists with global types (Card, Device, Merchant, ...): do not touch it, and keep our types local to our own graphs (`FraudTest`, `FraudGraph`). The Docker files in `docker/` are an unused fallback.
- Install the GDS algorithm library (personalised PageRank, components, Louvain).
- `tigergraph-mcp` (Python, needs 3.10+) with `pyTigerGraph`, as a stdio sidecar. Node uses the official MCP client SDK.
- **Verify early that the pulled version supports vector attributes.** If not, use Savanna or a small local index (for example hnswlib) behind the same tool interface. Ask on the TigerGraph Discord.

## 12. Tech stack and repo layout

**Runtime: TypeScript, one monorepo** (Node 24, pnpm). Next.js (App Router) analyst console + API; LangGraph.js state machine; Zod for the shared schemas (case, evidence, answer file); `@modelcontextprotocol/sdk`; `openai` SDK pointed at each provider's OpenAI-compatible endpoint (also works for Ollama); vitest; Tailwind + shadcn/ui; a graph view (cytoscape or react-force-graph); recharts for the calibration plot.
**Offline: Python via `uv`** (DuckDB, pandas, pyarrow, scikit-learn, PDF extractor such as pymupdf). Output is JSON/Parquet only; nothing ML runs in production TypeScript.

**Actual layout (as built).** This replaced the earlier `packages/` + `apps/` plan; the folders are flatter, and the agent core lives inside `backend/`:

```
repo/
  shared/          @fraud/shared: policy vocabulary, AnswerFile schema (zod), API contract (used by backend AND frontend)
  backend/         @fraud/backend (TypeScript, Fastify, vitest)
    src/domain/      types
    src/store/       GraphStore (async interface) + InMemoryStore (CSV, as-of safe) + TigerGraphStore (GSQL through the MCP client) + openStore() (STORE=memory|tigergraph)
    src/rag/         GraphRAG: Ollama embedder, vector search + graph expansion, cited context
    src/engines/     signatures/, judge, policy, simulator, calibration
    src/agent/       orchestrator (the investigation loop)
    src/llm/         narrator (template + local Ollama, schema checks, fallback)
    src/validator/   answer-file checks
    src/api/         HTTP + SSE server        src/cli.ts batch runner        src/inspect.ts debug helper
    tests/           10 files, 138 tests, run on Dataset/test (STORE=tigergraph runs them on FraudTest)
  frontend/        @fraud/frontend: Next.js analyst console (talks to the backend directly; CORS on)
  py/              uv project: notebooks/ (2, executed), scripts/ (test data, slim export, notebook builder, tg_*.py TigerGraph tooling), src/fraudpy/ (tg.py client)
  Dataset/         the provided data (git-ignored) and Dataset/test/ (SYNTHETIC test data, committed)
  calibration/     baseline_v0.json (written by notebook 02, read by a test)
  data/            caches and outputs (git-ignored): work.duckdb, slim/, out-test/, out-real/
  gsql/            schema, vectors, loading job, installed queries (`queries.gsql.tmpl`, `rag.gsql.tmpl`); templates with `@G@` for the graph name
  cases/           the 20 real answer files (written by `run:cases`)
```
The batch runner and the API call the same `investigate()` function. **Never put agent logic in a route handler.** Both read data through the `GraphStore` interface, so swapping in TigerGraph is one new class.

**TigerGraph commands** (see README for the order): `py/scripts/tg_schema.py`, `tg_load.py`, `tg_queries.py`, `tg_rag_load.py`, `tg_mcp_launcher.py`; run cases with `pnpm run:cases -- --store tigergraph --rag --write-graph`.

**Commands.** `pnpm test` · `pnpm run:cases` · `pnpm dev:backend` · `pnpm dev:frontend` · `pnpm typecheck` · `cd py && uv run python scripts/build_notebooks.py --execute` · `cd py && uv run python scripts/make_test_dataset.py` · `cd py && uv run python scripts/export_slim.py` · `DATASET_DIR=data/slim pnpm --filter @fraud/backend run inspect HHG-014` (bash syntax). pnpm 11 needs `allowBuilds` in `pnpm-workspace.yaml` (already set).

Coding conventions: strict TypeScript; schemas defined once in Zod and reused for LLM output, API and validator; deterministic engines are pure functions with unit tests; no ad-hoc GSQL from the LLM; every tool call is logged as a JSON line with timings (this produces `tool_calls`, `tokens`, `latency_s`). Serve Next.js as a normal Node server (Docker Compose next to TigerGraph), not serverless.

## 13. The 20 cases: first-look observations (as-of facts, **not verdicts**; no answer key exists)

| Case | Trigger, score | Observation before `opened_at` |
|---|---|---|
| HHG-001 | score 0.61, in-person $77.07, region 444 | Home 204; region seen 10× before; many regions in last 48 h |
| HHG-002 | score 0.79, online C $292.36 | 35 prior txns, median $47, p95 $91 (~3× p95); no region |
| HHG-003 | report, in-person $49.00, region 330 | Hub-like (980 prior); $49.00 seen once (Aug); many regions same day |
| HHG-004 | report, online C $128.33 | Above p95 ($96); device New, 5 other customers share profile |
| HHG-005 | score 0.54, online R $100.07 | Product R rare for card (6 of 90); device New but generic (109 others) |
| **HHG-006** | report, online C $482.12, score 0.25 | **Four purchases in 30 min: $478.95, $456.96, $488.04, $482.12** (all under $500, regions 264/476). Matches structuring. Exposure $1,906.07 |
| HHG-007 | score 0.87, in-person $111.92 | Hub (2,434 prior); region is home (2,223 prior there); defence likely |
| HHG-008 | report, online C $55.68 | Near-equal amounts repeated ($55.6, $55.69, $55.68) after an early-morning small burst; device Found, used 9× |
| HHG-009 | report, online S $30.02 | Region 203 seen once (home 441); device Found; 46 prior, small |
| HHG-010 | score 0.90, online R $1000.03 | Above p95 ($670); device New; region is home |
| HHG-011 | report, online C $131.30 | Hub card (10,311 prior); device New but only 2 other customers |
| HHG-012 | score 0.55, in-person $30.91, region 494 | Home 325; many regions in 48 h |
| HHG-013 | score 0.76, online C $35.66 | Card is mostly in-person at home; product C seen once; device New |
| **HHG-014** | analyst request, online C $74.96, **score 0.05** | **Ring fingerprint** (New + anonymous proxy); 44 customers / 80 txns already on it as of open time |
| HHG-015 | score 0.77, online R $599.94, region 327 | Region never seen (home 299); prior day two $550 in-person charges within 10 min; device New (IE) |
| HHG-016 | report, online C $59.67 | Amount is below the card's p95 ($84); device New but generic (142 others) |
| HHG-017 | score 0.57, online R $100.09, region 204 | Three ~$100 R purchases within an hour; proxy HIDDEN; device Found, generic |
| **HHG-018** | report, in-person $39.08, region 126 | Hub (5,862 prior); **$39.08 seen 7 times before** (Jul 6, Jul 31, Aug 8, Sep 21, Oct 9, Nov 14, Nov 23): recurring-charge candidate (R7), needs coincidence test |
| HHG-019 | score 0.90, online R $99.92, region 264 | Home 325; device New and rare (2 others) |
| HHG-020 | score 0.52, online R $125.08 | Product R never used by this card; device New, generic (231 others) |

Card "home" region = the card's most frequent in-person billing region before `opened_at`. Amounts and counts are from rows before `opened_at` only.

## 14. Build order and status

Legend: DONE = exists and is tested · PARTIAL · TODO.

1. **Load and resolve.** DONE. Slim export, card resolution with alias table, schema, loading through REST++ (`tg_load.py`), both graphs loaded and counted. Derived device statistics are computed in queries, not stored.
2. **Time machine.** DONE for both stores: `as_of` in every query, the look-ahead tests (`store.test.ts`, `e2e.test.ts`, the T9112 trap) pass on the in-memory store and on `FraudTest`.
3. **Signatures.** DONE for 6 prosecution and 4 defence signatures plus memory (`backend/src/engines/signatures/`); device statistics and memory recall are GSQL queries on TigerGraph. TODO: account takeover (`M` flags, mixed channel), numeric lookalike, per-signature precision report on closed history.
4. **Judge and policy.** DONE: log-odds ledger, stop rule, R1 to R10, simulator with contingency plan, validator. 138 tests.
5. **Backtest and calibrate.** PARTIAL. Notebook 02 measures signal and writes `baseline_v0.json`; only one constant is wired to it. **TODO: replay closed cases through the whole agent** with a time split, fit ratios and thresholds, calibration plot, action agreement with analysts. This is where accuracy is won.
6. **Sweep and memory.** DONE / PARTIAL. Ring query, causal shape recall, contagion sweep (informational), semantic recall (vector search + expansion) and write-back of new cases are done. TODO: recall of earlier exam cases, numeric (Vesta) recall.
7. **LLM layer.** PARTIAL. Template and local-Ollama narrators with checks, retries and fallback are done; the GraphRAG context feeds the brief. **Not yet A/B tested against a real Ollama run of the narrator.** TODO: response cache, Gemini/Groq fallbacks, the LLM plan call.
8. **Console and run.** PARTIAL. Console works (synthetic data). The 20 real cases are run into `cases/` and validated. TODO: console panels for GraphRAG and the sweep, calibration plot, replay button, demo video, blog, social post.

Notebooks: `py/notebooks/01_dataset_understanding.ipynb` and `02_features_and_baseline_calibration.ipynb` are executed and committed with outputs.

Demo path (5 minutes): HHG-014 (0.05 score becomes a ring) → HHG-018 (report undermined by the defence, one reply, checkpoint diff) → HHG-006 (structuring, L1 and L2 approval cards) → backtest calibration plot and "replay a closed case as new".

## 15. Risks and open questions

**Decisions made (2026-09-20):**
1. **No simulated replies (final).** The simulator is deleted. The customer's answer is not in the data, so none is invented: `fraud_probability`, verdict, pattern, affected transactions and evidence are the pre-reply values; when the agent needs the customer it follows the "no reply" rules (R4, or R7 for a recurring-charge dispute) and records that no reply was available; the plans for "not me" and "it was me" are in `next_best_actions.contingency` (same probability, only the rule changes). An `uncertain` case above $500 ends in `ESCALATE_TO_ANALYST` (R8), never in `CLOSE_NO_FRAUD` (tested).
2. **Derived card labels** are omitted (section 6.3).
3. The interpretation "a customer report counts as a denial (R2)" and the default rule D0 (block at p >= 0.85 without a reply) are mine; the README is silent. Both are in `policy.ts`, tested, and stated in each `reason`.

**Known v0 limits:** account takeover is not detected; numeric lookalike channel absent; the contagion sweep is a hint (ring fingerprint ranks in the top few percent, not first), not a detector; hub handling is a first pass (New-device weight ×0.25, burst needs 4); on the real data an in-person hub case (HHG-018) still gets a card-not-present new-device pattern because the New-device signal looks at the whole 48-hour window, not only the flagged transaction. All exam outputs so far are unvalidated v0 (no answer key).

**Standing risks:**
- Card `K` labels are underivable (see 6.3).
- Learned ratios could overfit history (84% fraud, negatives only for score alerts): prior-shift correction, shrinkage, per-class caps, time-split evaluation only. Rule-based defence tests cover report/analyst triggers. In the ≥ 0.8 zone signs flip (finding 10), so a signal's weight must be conditional on the zone.
- Free-model rate limits and weaker schema adherence: retries, deterministic templates (done); response cache and provider fallbacks (TODO).
- Free-tier privacy: Gemini free tier may use prompts for training outside the EU/UK/EEA; the data is anonymised, never send secrets.
- Do not tune on the 20 exam cases. On 2026-09-19 the 20 cases were run once on real data **for feasibility and timing**; the outputs were looked at, and the only changes made afterwards were (a) a population-level fix (ring rule specificity, measured on all 9,706 device profiles), (b) a base-rate fix (no same-customer memory), (c) implementing the already-designed hub hygiene, (d) two bug fixes (SAR sentence count, number-format check). No threshold was fitted to an exam case. Keep it that way.
- Open: exact structuring window/threshold and rarity cut-off (freeze after backtest); whether to build the optional monitor mode; vector-attribute support in the chosen TigerGraph version.

## 16. Working agreements for Claude in this repo

- Start by reading this file, then `spec.md` and the README policy and answer sections if touching policy or output.
- Prefer small, tested increments following section 14. Do not build UI polish before the backtest exists.
- Do not change action names, route mappings, or thresholds without citing the README text.
- Do not add LLM calls outside the three defined types. Do not let model output override policy engine results.
- Never read or print `.env` or keys. Ask before spending money or enabling a paid provider.
- The measurements behind section 4 are reproducible: `py/notebooks/01_*` and `02_*` (run with `cd py && uv run python scripts/build_notebooks.py --execute`). If a number matters to a decision, re-measure it there and update this file.
- Tests come first for anything the policy specifies. `Dataset/test/expected.json` is written from the policy, not from the agent's output; never regenerate it from the output.
- Before claiming something works, run it: `pnpm test`, `pnpm typecheck`, and for UI changes look at the running console.
- Keep this file current: update the status in section 14 and the decisions whenever they change.
