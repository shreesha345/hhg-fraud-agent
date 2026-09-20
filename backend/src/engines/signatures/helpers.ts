import type { Txn } from "../../domain/types";

export const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Linear-interpolated quantile, q in [0,1]. */
export const quantile = (a: number[], q: number): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

export const mode = <T>(a: T[]): T | undefined => {
  const c = new Map<T, number>();
  for (const x of a) c.set(x, (c.get(x) ?? 0) + 1);
  let best: T | undefined, n = 0;
  for (const [k, v] of c) if (v > n) { best = k; n = v; }
  return best;
};

export interface Baseline {
  n: number;
  median: number;
  p95: number;
  prods: Set<string>;
  regions: Set<number>;
  home?: number;
}

/** Per-card baseline computed from a slice of the card's own history (never from the customer as a whole). */
export function baseline(history: Txn[]): Baseline {
  const amts = history.map((t) => t.amt);
  const inPerson = history.filter((t) => t.channel === "in_person" && t.region !== null).map((t) => t.region as number);
  return {
    n: history.length,
    median: median(amts),
    p95: quantile(amts, 0.95),
    prods: new Set(history.map((t) => t.prod)),
    regions: new Set(history.filter((t) => t.region !== null).map((t) => t.region as number)),
    home: mode(inPerson),
  };
}

/** Rarity weight: many users of a fingerprint means background noise. 1 = unique, 0.1 = ubiquitous. */
export const idf = (users: number): number => Math.min(1, Math.max(0.1, 1 - Math.log(Math.max(1, users)) / Math.log(1000)));

const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
/** P(X >= k) for X ~ Poisson(lambda). Used as a coincidence test for repeated amounts. */
export function poissonTail(k: number, lambda: number): number {
  let cdf = 0;
  for (let i = 0; i < k; i++) cdf += (Math.exp(-lambda) * Math.pow(lambda, i)) / fact(i);
  return Math.max(0, 1 - cdf);
}

export const utcDay = (t: number): number => Math.floor(t / 86_400_000);
