/**
 * Backtest: replay closed cases (whose real outcome is known) through the whole agent, as if each were a new alert,
 * frozen at its own opening time, then compare the agent's answer with what really happened.
 *
 *   DATASET_DIR=data/slim pnpm --filter @fraud/backend run backtest [-- --from 2016-10-01 --limit 400]
 *
 * Time split: only cases OPENED on or after --from are scored (default 1 October, the held-out month), and the agent can only
 * recall cases that had already CLOSED at each replay's as-of. The 20 exam cases are never used here.
 * Every replay uses the same trigger (a bank risk-score alert), so the trigger type cannot leak the outcome.
 * Caveat: the history is 84% fraud and cleared cases only exist for high-score alerts, so read AUC and calibration, not raw accuracy.
 */
import { InMemoryStore } from "./store/InMemoryStore";
import { investigate } from "./agent/orchestrator";
import { DecisionOnlyNarrator } from "./llm/narrator";
import { datasetDir } from "./config";
import type { PackCase } from "./domain/types";

const arg = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const from = Date.parse(`${arg("--from") ?? "2016-10-01"}T00:00:00Z`);
const limit = Number(arg("--limit") ?? 400);

const store = InMemoryStore.load(datasetDir());
const all = (await store.closedCases(Number.MAX_SAFE_INTEGER)).filter((c) => c.openedAt >= from && c.txnIds.length);
// an even spread over the month, not just the first days
const step = Math.max(1, Math.floor(all.length / limit));
const picked = all.filter((_, i) => i % step === 0).slice(0, limit);

interface Row { id: string; truth: 1 | 0; p: number; verdict: string; pattern: string; truePattern: string; actions: string[]; trueActions: string[] }
const rows: Row[] = [];
let skipped = 0;
const t0 = Date.now();
for (const cc of picked) {
  const flagged = await store.getTxn(cc.txnIds[0]);
  if (!flagged || flagged.ts > cc.openedAt) { skipped++; continue; }
  const pack: PackCase = { caseId: cc.caseId, openedAt: cc.openedAt, openedAtRaw: "", trigger: "risk_score", triggerText: "", flaggedTxnId: flagged.id, cardLabel: cc.cardLabel, customer: cc.customer, score: flagged.score };
  const r = (await investigate(store, pack, { narrator: new DecisionOnlyNarrator() })).answer;
  rows.push({
    id: cc.caseId, truth: cc.outcome === "confirmed_fraud" ? 1 : 0, p: r.case.fraud_probability, verdict: r.case.verdict, pattern: r.case.pattern, truePattern: cc.pattern,
    actions: r.next_best_actions.final.map((a) => a.action), trueActions: cc.actions,
  });
}

// ---- metrics
const pos = rows.filter((x) => x.truth === 1), neg = rows.filter((x) => x.truth === 0);
let wins = 0, ties = 0;
for (const a of pos) for (const b of neg) { if (a.p > b.p) wins++; else if (a.p === b.p) ties++; }
const auc = pos.length && neg.length ? (wins + ties / 2) / (pos.length * neg.length) : NaN;
const brier = rows.reduce((s, x) => s + (x.p - x.truth) ** 2, 0) / Math.max(1, rows.length);
const base = pos.length / Math.max(1, rows.length);
const brierBase = rows.reduce((s, x) => s + (base - x.truth) ** 2, 0) / Math.max(1, rows.length);
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

console.log(`\nBacktest on ${rows.length} closed cases opened from ${arg("--from") ?? "2016-10-01"} (${skipped} skipped, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
console.log(`real outcomes: ${pos.length} confirmed fraud, ${neg.length} cleared (${pct(pos.length, rows.length)} fraud)\n`);
console.log(`Separation (AUC): ${auc.toFixed(3)}   (0.5 = coin flip, 1.0 = perfect: how well the fraud chance ranks real fraud above real innocent cases)`);
console.log(`Brier score:      ${brier.toFixed(3)}   (lower is better; always guessing the base rate would give ${brierBase.toFixed(3)})\n`);

console.log("Calibration: when the agent says X% fraud, how often was it really fraud?");
for (const [lo, hi] of [[0, 0.15], [0.15, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.85], [0.85, 1.01]]) {
  const b = rows.filter((x) => x.p >= lo && x.p < hi);
  if (b.length) console.log(`  said ${(lo * 100).toFixed(0).padStart(3)}-${Math.min(100, hi * 100).toFixed(0).padEnd(3)}%: ${String(b.length).padStart(4)} cases, really fraud ${pct(b.filter((x) => x.truth).length, b.length).padStart(6)}`);
}

console.log("\nVerdicts:");
for (const v of ["fraud", "uncertain", "legitimate"]) {
  const b = rows.filter((x) => x.verdict === v);
  console.log(`  ${v.padEnd(11)} ${String(b.length).padStart(4)} cases; really fraud ${pct(b.filter((x) => x.truth).length, b.length)}`);
}
const decided = rows.filter((x) => x.verdict !== "uncertain");
console.log(`  When it commits (not "uncertain"): right ${pct(decided.filter((x) => (x.verdict === "fraud") === (x.truth === 1)).length, decided.length)} of ${decided.length}; it stays uncertain on ${pct(rows.length - decided.length, rows.length)}`);

const fraudRows = pos;
console.log(`\nPattern (real fraud cases only): named the right pattern in ${pct(fraudRows.filter((x) => x.pattern === x.truePattern).length, fraudRows.length)} of ${fraudRows.length}`);
const blocked = (a: string[]) => a.includes("BLOCK_CARD") || a.includes("BLOCK_ALL_CARDS");
console.log(`Actions: on real fraud it recommended a block/decline/escalation ${pct(fraudRows.filter((x) => blocked(x.actions) || x.actions.includes("DECLINE_TRANSACTION") || x.actions.includes("ESCALATE_TO_ANALYST")).length, fraudRows.length)}; ` +
  `on cleared cases it wrongly recommended BLOCK_CARD ${pct(neg.filter((x) => blocked(x.actions)).length, neg.length)} (a policy breach if it happens on a single signal)`);
console.log(`          analysts blocked ${pct(fraudRows.filter((x) => blocked(x.trueActions)).length, fraudRows.length)} of the real fraud cases`);
