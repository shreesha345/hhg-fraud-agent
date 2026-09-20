# The bank's fraud score was a decoy. The graph wasn't.

## Building an agentic fraud investigator on TigerGraph

We were given twenty fraud alerts, six months of card payments, and a rule: decide what each alert
is, recommend the next best action, say who has to approve it — and never make anything up.

The most useful thing we learned came in the first hour of looking at the data, and it had nothing to
do with AI. It was this: **the signal everyone would naturally trust is the one that lies.**

This post is about what we built, component by component, and specifically what TigerGraph did for
each piece that we could not have done as easily any other way. Every number here comes from a run
you can reproduce from this repo.

---

## 1. The trap in the data

The dataset ships a `risk_score` from "the bank's model". It is the obvious thing to build on. It is
also nearly useless on its own:

| Measurement | Value |
|---|---|
| Cleared (innocent) cases in history that scored **high** (≥ 0.81) | **900 of 900** |
| Mean score of those cleared cases | 0.88 |
| Mean score of **confirmed fraud** | 0.47 |
| Confirmed fraud scoring **under 0.30** | **31%** |
| Mean score of the undocumented-pattern fraud | 0.14 |

Read that table twice. Every single false alarm in the history looked *more* suspicious to the bank's
model than the average real fraud did. An agent that trusts the score inherits its blind spot
perfectly.

So the score enters our system as **one piece of evidence among eight independent classes**, through
a learned non-monotonic curve — a 0.9 can *lower* the fraud probability when the defence explains it.
It is never the answer.

Which raises the obvious question: if not the score, then what?

---

## 2. Why a graph, measured rather than assumed

Fraud in this data is not a property of a payment. It is a property of the *connections between*
payments — the same rare device across unrelated cards, the same billing region, purchases shaped
around a limit.

We measured this properly, with a time split (train Jul–Sep, test Oct):

| Feature set | AUC |
|---|---|
| Bank score alone, inside the high-score zone | 0.62 |
| Anonymous Vesta columns (C/D/M/V) alone | 0.845 |
| Score + amount | 0.874 |
| **Graph features alone** (among alerts scoring ≥ 0.8) | **0.914** |
| Everything | 0.931 |

Graph structure alone beat every tabular combination we tried short of the full kitchen sink. That is
the whole justification for the architecture, and it was a measurement, not a preference.

**What TigerGraph did here:** made these features *askable at query time* rather than precomputed.
"How many distinct customers have used this device profile, as of this timestamp?" is a two-hop
traversal. In a relational store it's a self-join over 590,742 rows with a correlated time predicate,
recomputed per alert. In GSQL it is a query that returns in milliseconds and takes `as_of` as a
parameter.

---

## 3. The schema, and the one rule it had to enforce

```
Customer --OWNS--> BankCard --MADE--> Transaction --FROM_DEVICE--> DeviceProfile
                                            |--BILLED_IN--> BillingRegion
                                            |--PURCHASER_EMAIL--> EmailDomain
                                            |--NEXT--> Transaction   (time-ordered, per card)
ClosedCase --CLOSED_INVOLVES--> Transaction      FraudCase --HAS_EVIDENCE--> Evidence --CITES--> Transaction
```

590,742 transactions · 14,318 cards · 9,706 device profiles · 5,565 closed cases.

The hard requirement was **no look-ahead**. A case opens 1–6 hours after its flagged transaction, and
the data runs to 31 December. If any query can see the future, the whole result is worthless — and
worse, it looks *excellent* while being worthless.

We enforced this structurally: **every edge that is queried by time carries the transaction's `ts`,
and every one of the 16 installed GSQL queries takes `as_of` as a required parameter.** There is no
code path that reads the graph without a time bound.

Notably, we *chose not to store* derived aggregates like device rarity or card baselines as vertex
attributes. A stored aggregate is computed over all time — it silently leaks the future into every
query that touches it. Instead these are computed inside the query, under the same `as_of` bound.
Slower, and correct.

There is a test that tries to cheat (the "T9112 trap") and fails the build if it succeeds. It runs
against both the in-memory store and the live cloud graph.

> **Naming note for anyone rebuilding this:** the workspace's sample graph owns the global types
> `Card`, `Cases` and `Product`; `Case` is a GSQL keyword; `proxy` is a reserved attribute name. We
> use `BankCard`, `FraudCase` and `proxy_kind`. Keep your types local to your own graph.

---

## 4. The case that justifies the whole project

**HHG-014.** Bank score: **0.05**. By the score, this customer is innocent and nobody would look
twice. It arrived as an analyst request, not a score alert — the model never flagged it.

Here is what the graph found, as of the moment the case opened:

- The flagged payment came from device profile
  `SM-G935F Build/NRD90M | Android 7.0 | chrome 62.0 for android | 1920x1080`
- That profile was marked **New** on **100% of its 80 uses**
- It sat behind an **anonymous proxy** on every one
- It was shared by **44 different customers**
- 9 other cards were still live on it; 34 had already been handled
- Four previously confirmed fraud cases (CC-2649, CC-2971, CC-2985, CC-3035) touched the same profile

Verdict: **fraud, p = 0.94**, pattern `undocumented`, exposure $187.33. Actions: monitor the connected
cards, open a case, escalate to an analyst, and file a regulator report — that last one routed to
**L2 (fraud manager)** by the policy engine, not by the model.

No single-row feature finds this. The transaction is unremarkable: a $74.96 online purchase. The
fraud is *only* visible as a shape in the graph — one device, 44 customers, always new, always hidden.

**What TigerGraph did here:** this is a fan-out from a transaction to a device to every other customer
who has ever touched it, filtered by time, aggregated, and returned as a single result. One query.

---

## 5. Making the ring rule specific enough to be useful

Our first ring rule was "device used by ≥ 8 customers and marked New on ≥ 70% of uses". Run across
all 9,706 device profiles, it flagged **212** of them — overwhelmingly generic iPhone fingerprints
shared by hundreds of ordinary people. A detector that fires 212 times is a detector nobody reads.

The version we shipped requires all three of:

- between **5 and 200** distinct customers (an upper bound matters — above it, you have found a
  popular phone, not a ring)
- **New** on ≥ 90% of uses
- behind an **anonymous proxy** on ≥ 80% of uses

That flags **2 profiles out of 9,706**. It follows the language the analysts themselves used in the
closed cases: *"behind an anonymous proxy, never seen on this account."*

The point worth generalising: **we could only tune this because the population-level query was cheap
to run.** Sweeping a candidate rule across every device profile in the graph, repeatedly, is how you
find out your threshold is wrong. If that sweep had been an overnight batch job we would have shipped
the 212-hit version.

---

## 6. Score-blind contagion: personalised PageRank in GSQL

The ring rule catches a known shape. For unknown shapes we run a **contagion sweep**: personalised
PageRank seeded from entities in *confirmed* fraud cases, propagating across card → device → region →
email edges.

Two design choices that mattered:

1. **It never looks at the bank score.** That is the point — it finds things the score missed.
2. **Fingerprint-rarity (IDF) weighting.** Without it, generic devices shared by thousands of people
   dominate the ranking and the result is noise. Weighting each edge by the inverse frequency of the
   fingerprint makes the rare shared device stand out and the common one vanish.

We implemented this directly in GSQL rather than reaching for the GDS library — degree-normalised,
rarity-weighted, and bounded by `as_of` like everything else.

**Honest limitation:** the sweep is a *hint*, not a detector. The ring fingerprint ranks in the top
few percent, not first. It earns its place by surfacing candidates for the signature library, not by
making the call itself.

---

## 7. GraphRAG: retrieval where the graph is the context

Semantic search over the 5,565 closed cases alone is weak, because the analyst notes are templated —
near-identical text per pattern. Embedding similarity mostly rediscovers the template.

So retrieval is two-stage:

1. **Vector search** over 768-dimension cosine embeddings stored as vector attributes directly on
   `ClosedCase`, `PolicyChunk` and `FraudCase` vertices (`nomic-embed-text`, run locally).
2. **Graph expansion** from each hit — the shared transactions, cards, devices and regions — which is
   where the actual signal is.

Every claim in the final case file carries a `source`, a `ref` and the entity IDs behind it. The
citations are graph paths, not similarity scores.

**The memory rule that made this honest:** closed history is **84% fraud**, so *any* customer with
history looks guilty. Matching on "same customer" would be a base-rate trap that scores well and
means nothing. Only **shape** matches count as memory evidence — same structuring pattern, same ring
device, same trip. There is a test (`hygiene.test.ts`) that fails the build if same-customer matching
creeps back in.

---

## 8. How the agent actually talks to the graph

Every read goes through the **TigerGraph MCP server**. The agent calls `run_installed_query`,
`add_nodes`, `add_edges`, `has_node` — and nothing else.

**The LLM never writes GSQL.** This is deliberate and worth being blunt about: a model that can
compose arbitrary queries can compose one without an `as_of` bound, and then your no-look-ahead
guarantee is a suggestion. Sixteen installed, reviewed, parameterised queries are the entire surface
area.

The division of labour across the whole system:

| Component | Decides | Implemented as |
|---|---|---|
| Graph | What is true, as of a timestamp | 16 installed GSQL queries |
| Judge | The fraud probability | Log-likelihood ledger, JSON coefficients |
| Policy engine | The action and the approval route | Deterministic rules R1–R10 |
| LLM | Only the wording | 3 calls per case, schema-validated |

The model makes exactly three calls per case (plan the next evidence, explain, write the SAR
narrative). It cannot add an action, change a route, set the exposure figure, or invent an ID.

Finished cases are written **back into the graph** as `FraudCase` vertices with `HAS_EVIDENCE` and
`CITES` edges, so an investigation becomes queryable memory for the next one.

---

## 9. The scorecard, including the parts that aren't flattering

Three hundred closed cases replayed as if new, each frozen at its own opening moment:

| Metric | Result |
|---|---|
| Separation (AUC) | **0.771** |
| Brier score | 0.329 (base rate would give 0.095) |
| "Likely fraud" verdicts that really were fraud | **97.2%** |
| Correct fraud **pattern** named | **14.9%** |
| Recommended block/decline/escalate on real fraud | 95.5% |
| Wrongly recommended `BLOCK_CARD` on a cleared case | **0.0%** |
| Stays `uncertain` | 73.7% |

The good: when it commits to fraud it is right 97.2% of the time, and it never once recommended
blocking a card that turned out to be innocent — the specific failure the policy calls a breach.

The bad, stated plainly: **naming the exact pattern works less than 15% of the time.** Calibration
drifts at the edges — in the 0–15% band, 70.6% were actually fraud, which means the low end is badly
under-confident. And it declines to commit on nearly three quarters of cases. That last one is
defensible (an `uncertain` verdict with an escalation is a valid, credited outcome) but it is not the
same as being right.

Those numbers are in the demo video too, on screen, unedited.

---

## 10. What we'd tell someone starting this tomorrow

1. **Measure whether you need a graph before you build on one.** We ran the comparison (0.914 vs
   0.874) and it justified the architecture. If the tabular baseline had won, the honest move was to
   ship the tabular baseline.
2. **Put the time bound in the schema, not in the discipline of whoever writes the next query.**
   Every edge carries `ts`; every query takes `as_of`. Make the cheating path not exist.
3. **Don't store derived aggregates you intend to query historically.** They leak the future.
4. **Tune population-wide, not on your examples.** 212 hits versus 2 was the difference between a
   rule and a nuisance, and we only saw it by sweeping all 9,706 profiles.
5. **Let the graph decide and the model describe.** Every hard guarantee in this system — no
   look-ahead, valid IDs, correct approval routes, exposure arithmetic — holds because a deterministic
   component owns it.

The headline result stands on its own: a transaction the bank's own model scored at **0.05**, correctly
identified as part of a 44-customer device ring, with a citation for every claim and a report routed to
the right approver. The score said nothing. The connections said everything.

---

### Reproducing this

```bash
bash scripts/tg-check.sh                     # TigerGraph reachable, 4.2.5, both graphs
pnpm test                                    # 138 tests, in-memory and against the live graph
pnpm run:cases -- --store tigergraph --rag   # run all 20 alerts
pnpm --filter @fraud/backend run backtest -- --limit 300
```

Full setup, schema and query installation are in [`README.md`](README.md); the design decisions and
every measurement behind this post are in [`CLAUDE.md`](CLAUDE.md), reproducible from the notebooks in
`py/notebooks/`.

*Built for Hacker House Goa on [TigerGraph](https://www.tigergraph.com/) Savanna. Thanks to
[@TigerGraphDB](https://twitter.com/TigerGraphDB).*
