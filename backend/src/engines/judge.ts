/**
 * The calibrated judge: a log-odds ledger with independence classes.
 *
 *  - Start from a prior, add class contributions, convert to probability.
 *  - Evidence in the SAME class does not stack: a class contributes its strongest positive plus its strongest
 *    negative (so a defence test can offset a prosecution signal in the same class, but two correlated
 *    prosecution signals count once).
 *  - Classes add, with a global damping factor for residual dependence.
 *  - "k" is the number of independent classes that support the leading direction: this is how the policy's
 *    "at least two independent pieces of evidence" is computed instead of asserted.
 */
import type { EvidenceClass } from "@fraud/shared";
import type { SigResult } from "../domain/types";
import { LR } from "./calibration";

export interface Assessment {
  p: number;
  logOdds: number;
  prior: number;
  /** independent classes supporting the leading direction (bank score excluded) */
  k: number;
  classes: Record<string, number>;
  support: EvidenceClass[];
  stop: "hi" | "lo" | null;
  openQuestions: string[];
}

const logit = (p: number): number => Math.log(p / (1 - p));
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function judge(sigs: SigResult[], opts: { hub?: boolean; asked?: boolean } = {}): Assessment {
  const pos = new Map<EvidenceClass, number>(), neg = new Map<EvidenceClass, number>();
  for (const s of sigs) {
    if (!s.fired || s.logLr === 0) continue;
    if (s.logLr > 0) pos.set(s.cls, Math.max(pos.get(s.cls) ?? 0, s.logLr));
    else neg.set(s.cls, Math.min(neg.get(s.cls) ?? 0, s.logLr));
  }
  const classes: Record<string, number> = {};
  for (const c of new Set([...pos.keys(), ...neg.keys()])) classes[c] = Math.round(((pos.get(c) ?? 0) + (neg.get(c) ?? 0)) * 1000) / 1000;

  const sum = Object.values(classes).reduce((a, b) => a + b, 0);
  const logOdds = logit(LR.prior) + LR.damping * sum;
  const p = sigmoid(logOdds);

  const dir = p >= 0.5 ? 1 : -1;
  const support = (Object.entries(classes) as [EvidenceClass, number][])
    .filter(([c, v]) => c !== "bank_score" && Math.sign(v) === dir && Math.abs(v) >= LR.class_min)
    .map(([c]) => c);
  const k = support.length;
  const stop = p >= LR.hi && k >= 2 ? "hi" : p <= LR.lo && k >= 2 ? "lo" : null;

  const open: string[] = [];
  if (stop === null) {
    if (k < 2) open.push(`Only ${k} independent evidence class${k === 1 ? "" : "es"} support the leading hypothesis (need 2)`);
    if (!opts.asked) open.push("The customer has not been asked about this transaction");
  }
  if (opts.hub) open.push("Card looks like an aggregate customer; baselines are weak");
  return { p: Math.round(p * 1000) / 1000, logOdds: Math.round(logOdds * 1000) / 1000, prior: LR.prior, k, classes, support, stop, openQuestions: open };
}
