/**
 * Signature library. Each signature is a pure function of (case context, store) that returns a SigResult:
 * fired or not, strength, a log-odds contribution, and the entity IDs it rests on. Definitions follow the
 * pattern text in Dataset/README.md. Prosecution signatures look for fraud; defence signatures look for
 * innocent explanations; the judge weighs both.
 *
 * All log-odds constants below are v0 defaults. They are replaced by fitted values once the backtest
 * (py/notebooks/02_*) is wired into calibration/ (see engines/calibration.ts).
 */
import type { EvidenceClass, Pattern } from "@fraud/shared";
import type { DeviceStats, GraphStore } from "../../store/GraphStore";
import { DAY, HOUR, iso, type CaseCtx, type ClosedCase, type SigResult, type Side, type Txn } from "../../domain/types";
import { baseline, idf, median, poissonTail, utcDay } from "./helpers";
import { LR } from "../calibration";

interface Draft {
  name: string; side: Side; cls: EvidenceClass; ref: string;
  fired: boolean; strength?: number; base: number; claim: string;
  entityIds?: string[]; pattern?: Pattern; facts?: Record<string, unknown>;
}
const mk = (d: Draft): SigResult => ({
  name: d.name, side: d.side, cls: d.cls, ref: d.ref, fired: d.fired,
  strength: d.fired ? d.strength ?? 1 : 0,
  logLr: d.fired ? Math.round(d.base * (d.strength ?? 1) * 1000) / 1000 : 0,
  claim: d.claim, entityIds: d.entityIds ?? [], pattern: d.pattern, facts: d.facts ?? {},
});
const usd = (n: number): string => `$${n.toFixed(2)}`;

/** Card transactions from 48h before the flagged one up to as-of: the "episode window". */
const episode = (c: CaseCtx): Txn[] => c.card.filter((t) => t.ts >= c.flagged.ts - 48 * HOUR);
const older = (c: CaseCtx, before: number): Txn[] => c.card.filter((t) => t.ts < before);

// ============================================================================ prosecution
export function testThenSpend(c: CaseCtx): SigResult {
  const win = c.card.filter((t) => t.channel === "online" && t.ts >= c.flagged.ts - 24 * HOUR);
  const smalls = win.filter((t) => t.amt <= 5);
  let group: Txn[] = [];
  for (let i = 0; i < smalls.length; i++) {
    const g = smalls.filter((t) => t.ts >= smalls[i].ts && t.ts <= smalls[i].ts + HOUR);
    if (g.length > group.length) group = g;
  }
  const last = group.length ? group[group.length - 1].ts : 0;
  const avgSmall = group.length ? group.reduce((s, t) => s + t.amt, 0) / group.length : 0;
  const bigs = group.length >= 3 ? win.filter((t) => t.ts > last && t.ts <= last + 6 * HOUR && t.amt >= 50 && t.amt >= 10 * avgSmall) : [];
  const fired = group.length >= 3 && bigs.length > 0;
  const ids = [...group, ...bigs].map((t) => t.id);
  return mk({
    name: "test_then_spend", side: "prosecution", cls: "card_behaviour", ref: "signature:test_then_spend", fired, strength: 0.9, base: LR.test_then_spend,
    claim: fired
      ? `${group.length} online authorizations of ${usd(Math.min(...group.map((t) => t.amt)))} to ${usd(Math.max(...group.map((t) => t.amt)))} within an hour, then a ${usd(bigs[0].amt)} purchase`
      : "No run of three small online authorizations followed by a large purchase",
    entityIds: fired ? ids : [], pattern: "card_testing",
    facts: { txnIds: fired ? ids : [], bigCleared: bigs.some((t) => t.amt > 100) },
  });
}

export function offProfileBurst(c: CaseCtx): SigResult {
  const base = baseline(older(c, c.flagged.ts - 48 * HOUR));
  const win = episode(c).filter((t) => t.channel === "online");
  const off = base.n >= 10 ? win.filter((t) => t.amt > base.p95 || !base.prods.has(t.prod)) : [];
  // Hub hygiene: on an aggregate card (many people behind one "customer") a couple of unusual purchases is normal.
  const fired = off.length >= (c.hub ? 4 : 2) && win.length <= 8;
  const strength = Math.min(1, 0.5 + 0.15 * (off.length - 2) + 0.15);
  return mk({
    name: "off_profile_burst", side: "prosecution", cls: "card_behaviour", ref: "signature:off_profile_burst", fired, strength, base: LR.off_profile_burst,
    claim: fired
      ? `${off.length} online purchases in 48 hours outside this card's own profile (amounts above its p95 of ${usd(base.p95)} or products it has not used)`
      : "Online activity is within this card's own profile",
    entityIds: fired ? off.map((t) => t.id) : [], pattern: "card_not_present_fraud", facts: { txnIds: fired ? off.map((t) => t.id) : [], p95: base.p95 },
  });
}

export async function newDevice(c: CaseCtx, store: GraphStore): Promise<SigResult> {
  const recent = episode(c).filter((t) => t.channel === "online" && t.dev?.isNew);
  if (!recent.length) {
    return mk({ name: "new_device", side: "prosecution", cls: "device", ref: "signature:new_device", fired: false, base: LR.new_device, claim: "No device marked New in the last 48 hours" });
  }
  const t0 = recent.find((t) => t.id === c.flagged.id) ?? recent[recent.length - 1];
  const st = await store.deviceStats(t0.dev!.profile, c.asOf);
  // Hub hygiene: on an aggregate card a New device is routine (a different person each time), so it counts for far less.
  const strength = idf(st.users) * (c.hub ? 0.25 : 1);
  const proxy = t0.dev!.proxy ? ` behind ${t0.dev!.proxy.replace("IP_PROXY:", "").toLowerCase()} proxy` : "";
  if (c.flagged.score >= LR.zone_score) {
    // High-score zone: history says a New device here usually means a new phone, so this is DEFENCE evidence.
    return mk({
      name: "new_device_at_high_score", side: "defence", cls: "device", ref: `signature:new_device_at_high_score(profile=${t0.dev!.profile})`, fired: true, strength: 1, base: LR.new_device_in_zone,
      claim: `Device profile is marked New, but at a bank score of ${c.flagged.score.toFixed(2)} that is more often a new phone than fraud (closed history: 86% of cleared alerts in this zone vs 21% of fraud)`,
      entityIds: [c.flagged.id], facts: { profile: t0.dev!.profile, users: st.users, txnIds: [] },
    });
  }
  return mk({
    name: "new_device", side: "prosecution", cls: "device", ref: `signature:new_device(profile=${t0.dev!.profile})`, fired: true, strength, base: LR.new_device,
    claim: `Device profile marked New for this account${proxy}; ${st.users} customer(s) have used this profile so far`,
    entityIds: recent.map((t) => t.id), pattern: "card_not_present_new_device",
    facts: { profile: t0.dev!.profile, users: st.users, txnIds: recent.map((t) => t.id) },
  });
}

export function thresholdHugging(c: CaseCtx): SigResult {
  const win = c.card.filter((t) => t.channel === "online" && t.ts >= c.flagged.ts - 12 * HOUR);
  const need = c.hub ? 4 : 3;
  let best: Txn[] = [], bestT = 0;
  for (const T of [500, 1000]) {
    const cand = win.filter((t) => t.amt >= 0.9 * T && t.amt < T);
    for (let i = 0; i < cand.length; i++) {
      const g = cand.filter((t) => t.ts >= cand[i].ts && t.ts <= cand[i].ts + 45 * 60_000);
      if (g.length > best.length) { best = g; bestT = T; }
    }
  }
  const fired = best.length >= need;
  return mk({
    name: "threshold_hugging", side: "prosecution", cls: "card_behaviour", ref: "signature:threshold_hugging", fired, strength: 0.9, base: LR.threshold_hugging,
    claim: fired
      ? `${best.length} online purchases within ${Math.round((best[best.length - 1].ts - best[0].ts) / 60000)} minutes, each just under $${bestT} (${best.map((t) => usd(t.amt)).join(", ")}): amounts chosen to stay under an authorization threshold`
      : "No cluster of purchases just under a round threshold",
    entityIds: fired ? best.map((t) => t.id) : [], pattern: "undocumented",
    facts: { txnIds: fired ? best.map((t) => t.id) : [], threshold: bestT },
  });
}

export async function sharedRareFingerprint(c: CaseCtx, store: GraphStore): Promise<SigResult> {
  const cands = new Map<string, Txn[]>();
  for (const t of c.card) if (t.dev && t.ts >= c.flagged.ts - 7 * DAY) (cands.get(t.dev.profile) ?? cands.set(t.dev.profile, []).get(t.dev.profile)!).push(t);
  let best: { st: DeviceStats; own: Txn[]; strength: number } | undefined;
  const stats = await Promise.all([...cands.keys()].map((p) => store.deviceStats(p, c.asOf)));
  for (const st of stats) {
    const own = cands.get(st.profile)!;
    // Specificity measured on ALL 9,706 real device profiles (py/notebooks/01_*, section 7c): a looser rule flagged 212 profiles,
    // mostly generic iPhones shared by hundreds of customers. This one is what the closed ring cases describe: a rare profile,
    // used across several cards, almost always marked New for the account, behind an anonymous proxy.
    const hit = st.users >= 5 && st.users <= 200 && st.newShare >= 0.9 && st.anonProxyShare >= 0.8;
    if (!hit) continue;
    const strength = 0.75 + 0.25 * idf(st.users);
    if (!best || strength > best.strength) best = { st, own, strength };
  }
  if (!best) {
    return mk({ name: "shared_rare_fingerprint", side: "prosecution", cls: "network", ref: "signature:shared_rare_fingerprint", fired: false, base: LR.shared_rare_fingerprint, claim: "No rare device profile shared across cards" });
  }
  // Which cards share it, and which of them are still live (not already blocked by a closed, confirmed case)?
  const blocked = best.st.blocked;
  const live: string[] = [], closed: string[] = [];
  for (const [cardKey, last] of best.st.lastByCard) {
    if (cardKey === c.cardKey) continue;
    (blocked.has(cardKey) || last < c.asOf - 30 * DAY ? closed : live).push(cardKey);
  }
  const anon = best.st.anonProxyShare >= 0.5 ? " behind an anonymous proxy" : "";
  return mk({
    name: "shared_rare_fingerprint", side: "prosecution", cls: "network", ref: `signature:shared_rare_fingerprint(profile=${best.st.profile})`, fired: true,
    strength: best.strength, base: LR.shared_rare_fingerprint,
    claim: `Device profile "${best.st.profile}" is marked New on ${Math.round(best.st.newShare * 100)}% of its ${best.st.txns} uses${anon} and is shared by ${best.st.users} customers; ${live.length} other card(s) still live on it, ${closed.length} already handled`,
    entityIds: best.own.map((t) => t.id), pattern: "undocumented",
    facts: { profile: best.st.profile, users: best.st.users, txnIds: best.own.map((t) => t.id), connectedLive: live, connectedClosed: closed },
  });
}

export function outOfRegionHomeContinues(c: CaseCtx): SigResult {
  const start = c.flagged.ts - 48 * HOUR;
  const old = baseline(older(c, start).filter((t) => t.channel === "in_person"));
  const win = c.card.filter((t) => t.ts >= start && t.channel === "in_person" && t.region !== null);
  const away = old.n >= 10 ? win.filter((t) => !old.regions.has(t.region as number)) : [];
  const first = away.length ? Math.min(...away.map((t) => t.ts)) : 0;
  const homeAfter = old.home === undefined ? [] : win.filter((t) => t.region === old.home && t.ts > first);
  const fired = away.length > 0 && homeAfter.length > 0;
  return mk({
    name: "out_of_region_home_continues", side: "prosecution", cls: "geography", ref: "signature:out_of_region_home_continues", fired, strength: 0.7, base: LR.out_of_region_home_continues,
    claim: fired
      ? `Card-present use in billing region ${away[0].region} (no history there), while the same card kept spending in its home region ${old.home}`
      : "No card-present use in an unfamiliar region alongside continuing home activity",
    entityIds: fired ? away.map((t) => t.id) : [], pattern: "out_of_region_use", facts: { txnIds: fired ? away.map((t) => t.id) : [], home: old.home },
  });
}

// ============================================================================ defence
export function tripContinuity(c: CaseCtx): SigResult {
  const f = c.flagged;
  const none = (why: string) => mk({ name: "trip_continuity", side: "defence", cls: "geography", ref: "signature:trip_continuity", fired: false, base: LR.trip_continuity, claim: why });
  if (f.channel !== "in_person" || f.region === null) return none("Flagged transaction is not a card-present purchase in a billing region");
  const stay = c.card.filter((t) => t.channel === "in_person" && t.region === f.region && t.ts >= c.asOf - 10 * DAY);
  if (!stay.length) return none("No stay in the flagged region");
  const stayStart = Math.min(...stay.map((t) => t.ts));
  const old = baseline(older(c, stayStart).filter((t) => t.channel === "in_person"));
  const days = new Set(stay.map((t) => utcDay(t.ts)));
  const homeDuring = old.home === undefined ? [] : c.card.filter((t) => t.region === old.home && t.channel === "in_person" && t.ts > stayStart);
  const fired = old.n >= 10 && !old.regions.has(f.region) && days.size >= 2 && homeDuring.length === 0;
  return mk({
    name: "trip_continuity", side: "defence", cls: "geography", ref: "signature:trip_continuity", fired, strength: 0.9, base: LR.trip_continuity,
    claim: fired
      ? `Purchases in region ${f.region} on ${days.size} consecutive-period days while home-region activity (${old.home}) stopped: consistent with a trip, not a cloned card`
      : "Stay in the flagged region does not look like a trip (too short, or home activity continues)",
    entityIds: fired ? stay.map((t) => t.id) : [], facts: { days: days.size, home: old.home },
  });
}

export async function deviceSuccession(c: CaseCtx, store: GraphStore): Promise<SigResult> {
  const f = c.flagged;
  const no = (why: string) => mk({ name: "device_succession", side: "defence", cls: "device", ref: "signature:device_succession", fired: false, base: LR.device_succession, claim: why });
  if (!f.dev || f.channel !== "online") return no("Flagged transaction has no device record");
  const prior = c.card.filter((t) => t.dev && t.ts < f.ts && t.dev.profile !== f.dev!.profile);
  const byProfile = new Map<string, Txn[]>();
  for (const t of prior) (byProfile.get(t.dev!.profile) ?? byProfile.set(t.dev!.profile, []).get(t.dev!.profile)!).push(t);
  const same = [...byProfile.values()].filter((l) => l.length >= 3 && l[0].dev!.family === f.dev!.family);
  const st = await store.deviceStats(f.dev.profile, c.asOf);
  const benign = st.users <= 3 || st.newShare <= 0.5;
  const fired = same.length > 0 && f.dev.isNew && !f.dev.proxy && benign;
  return mk({
    name: "device_succession", side: "defence", cls: "device", ref: "signature:device_succession", fired, strength: 0.8, base: LR.device_succession,
    claim: fired
      ? `New device replaces an earlier one on this card (same ${f.dev.family} family, earlier device used ${same[0].length} times and now quiet); no proxy, not a shared fingerprint`
      : "No sign that the new device replaces an earlier one",
    entityIds: fired ? [f.id] : [],
  });
}

export function recurringCadence(c: CaseCtx): SigResult {
  const f = c.flagged;
  const hist = c.card.filter((t) => t.id !== f.id);
  const match = hist.filter((t) => Math.abs(t.amt - f.amt) < 0.005 && t.channel === f.channel && t.prod === f.prod);
  const no = (why: string) => mk({ name: "recurring_cadence", side: "defence", cls: "card_behaviour", ref: "signature:recurring_cadence", fired: false, base: LR.recurring_cadence, claim: why, facts: { matches: match.length } });
  if (match.length < 3) return no(`Amount ${usd(f.amt)} has appeared ${match.length} time(s) before: too few to call recurring`);
  const seq = [...match, f].sort((a, b) => a.ts - b.ts);
  const gaps = seq.slice(1).map((t, i) => (t.ts - seq[i].ts) / DAY);
  const med = median(gaps);
  const mad = median(gaps.map((g) => Math.abs(g - med)));
  const periodic = [7, 14, 30].some((p) => Math.abs(med - p) <= 0.2 * p) && mad <= 0.2 * med;
  // Coincidence test: how often would an exact amount repeat this many times in this card's own history by chance?
  const others = hist.filter((t) => !match.includes(t));
  const distinct = new Set(others.map((t) => t.amt.toFixed(2))).size || 1;
  const lambda = others.length / distinct;
  const tail = poissonTail(match.length + 1, lambda);
  const fired = periodic && tail < 0.01;
  return mk({
    name: "recurring_cadence", side: "defence", cls: "card_behaviour", ref: "signature:recurring_cadence", fired, strength: 0.9, base: LR.recurring_cadence,
    claim: fired
      ? `${usd(f.amt)} has recurred ${match.length} times before at a regular gap of about ${Math.round(med)} days (chance of that many exact repeats: ${tail.toExponential(1)})`
      : `${usd(f.amt)} repeats ${match.length} times but ${periodic ? "could be coincidence (p=" + tail.toFixed(3) + ")" : "not at a regular cadence (median gap " + Math.round(med) + " days)"}`,
    entityIds: fired ? seq.map((t) => t.id) : [], facts: { matches: match.length, medianGap: med, tail, periodic },
  });
}

export function baselineConsistent(c: CaseCtx): SigResult {
  const f = c.flagged;
  const base = baseline(older(c, f.ts - 7 * DAY));
  const burst = episode(c).length;
  const regionOk = f.channel === "online" || (f.region !== null && base.regions.has(f.region));
  const fired = base.n >= 10 && f.amt <= base.p95 && base.prods.has(f.prod) && regionOk && burst <= 4;
  return mk({
    name: "baseline_consistent", side: "defence", cls: "card_behaviour", ref: "signature:baseline_consistent", fired, strength: 0.6, base: LR.baseline_consistent,
    claim: fired
      ? `Amount ${usd(f.amt)} is within the card's own p95 (${usd(base.p95)}); product and region already used; no burst`
      : "Transaction is not clearly inside this card's usual profile",
    entityIds: fired ? [f.id] : [],
  });
}

// ============================================================================ bank score and customer report
/** The bank score is NOT a threshold. It is one evidence class through a non-monotonic curve. */
export function bankScore(c: CaseCtx): SigResult {
  const s = c.flagged.score;
  const v = s < 0.3 ? LR.bank_low : s < 0.5 ? 0 : s < 0.8 ? LR.bank_mid : 0;
  return {
    name: "bank_score", side: "meta", cls: "bank_score", ref: "model:risk_score", fired: v !== 0, strength: v !== 0 ? 1 : 0, logLr: v,
    claim: `Bank model scored the flagged transaction ${s.toFixed(2)}. ${s >= 0.8 ? "In the 0.8 and above zone half the closed cases were false alarms, so the score alone says little" : s < 0.3 ? "Low, but confirmed fraud also scores low, so this barely lowers the odds" : "Mid range: weak evidence"}`,
    entityIds: [c.flagged.id], facts: { score: s },
  };
}

export function customerReport(c: CaseCtx): SigResult {
  const fired = c.trigger === "customer_report";
  return mk({
    name: "customer_report", side: "prosecution", cls: "customer_reply", ref: "trigger:customer_report", fired, strength: 1, base: LR.customer_report,
    claim: `Customer reports they did not make transaction ${c.flagged.id}`, entityIds: fired ? [c.flagged.id] : [],
  });
}

// ============================================================================ memory (causal)
export interface MemoryMatch { caseId: string; outcome: string; why: string }

export async function recallMemory(c: CaseCtx, store: GraphStore, fired: SigResult[]): Promise<SigResult> {
  const has = (n: string) => fired.some((s) => s.name === n && s.fired);
  // Candidates keep the FIRST rule (in this order) that recalls them; the newest five overall are used.
  const found = new Map<string, { cc: ClosedCase; why: string }>();
  const add = (cc: ClosedCase, why: string) => { if (!found.has(cc.caseId)) found.set(cc.caseId, { cc, why }); };

  // Deliberately NO "same customer" match: closed history is 84% fraud, so a customer's mere history is base-rate
  // contamination, not evidence (worst for aggregate customers). Only SHAPE matches count as memory.
  const profiles = [...new Set(episode(c).filter((t) => t.dev).map((t) => t.dev!.profile))];
  const strongDevice = has("shared_rare_fingerprint") || has("new_device");
  const [byDevice, undocumented, testing, region, cleared, newDev] = await Promise.all([
    strongDevice && profiles.length ? store.closedCasesOnDevices(profiles, c.asOf, has("shared_rare_fingerprint")) : Promise.resolve([] as ClosedCase[]),
    has("threshold_hugging") ? store.closedCases(c.asOf, { pattern: "undocumented" }) : Promise.resolve([] as ClosedCase[]),
    has("test_then_spend") ? store.closedCases(c.asOf, { pattern: "card_testing" }) : Promise.resolve([] as ClosedCase[]),
    has("out_of_region_home_continues") ? store.closedCases(c.asOf, { pattern: "out_of_region_use" }) : Promise.resolve([] as ClosedCase[]),
    has("trip_continuity") || has("device_succession") ? store.closedCases(c.asOf, { outcome: "cleared" }) : Promise.resolve([] as ClosedCase[]),
    has("new_device") && has("off_profile_burst") ? store.closedCases(c.asOf, { pattern: "card_not_present_new_device" }) : Promise.resolve([] as ClosedCase[]),
  ]);
  const rules: Array<[ClosedCase[], string, (cc: ClosedCase) => boolean]> = [
    [byDevice, "shares a device profile with this card", () => true],
    [undocumented, "same structuring shape", (cc) => /just under|threshold/i.test(cc.notes)],
    [testing, "same card-testing shape", () => true],
    [region, "same out-of-region shape", () => true],
    [has("trip_continuity") ? cleared : [], "cleared earlier: cardholder confirmed travel", (cc) => /travel/i.test(cc.notes)],
    [has("device_succession") ? cleared : [], "cleared earlier: cardholder confirmed a new phone", (cc) => /new phone/i.test(cc.notes)],
    [newDev, "same new-device online shape", () => true],
  ];
  for (const [list, why, ok] of rules) for (const cc of list) if (ok(cc)) add(cc, why);
  const matches = [...found.values()].map((f) => f.cc)
    .sort((a, b) => a.openedAt - b.openedAt || (a.caseId < b.caseId ? -1 : 1))
    .map((cc) => ({ caseId: cc.caseId, outcome: cc.outcome, why: found.get(cc.caseId)!.why }) as MemoryMatch);
  const top = matches.slice(-5);
  const fraud = top.filter((m) => m.outcome === "confirmed_fraud").length, cleared2 = top.length - fraud;
  const logLr = Math.max(-0.9, Math.min(1.0, LR.memory_per_case * (fraud - cleared2)));
  return {
    name: "memory_recall", side: "meta", cls: "memory", ref: `memory:recall(${top.map((m) => m.caseId).join(",")})`, fired: top.length > 0 && logLr !== 0,
    strength: top.length ? 1 : 0, logLr: top.length ? logLr : 0,
    claim: top.length ? `Recalled ${top.length} similar closed case(s): ${fraud} confirmed fraud, ${cleared2} cleared` : "No similar closed case found",
    entityIds: top.map((m) => m.caseId), facts: { matches: top, fraud, cleared: cleared2 },
  };
}

// ============================================================================ run all
/** newDevice() returns the version for this case's score zone; give the other one back as "not applicable" so both always appear. */
async function newDevicePair(c: CaseCtx, store: GraphStore): Promise<SigResult[]> {
  const nd = await newDevice(c, store);
  const other = nd.name === "new_device_at_high_score"
    ? mk({ name: "new_device", side: "prosecution", cls: "device", ref: "signature:new_device", fired: false, base: LR.new_device, claim: "Not applicable: bank score is at or above 0.8, where a New device is read as a new phone" })
    : mk({ name: "new_device_at_high_score", side: "defence", cls: "device", ref: "signature:new_device_at_high_score", fired: false, base: LR.new_device_in_zone, claim: "Not applicable: bank score is below 0.8" });
  return [nd, other];
}

/** Prosecution, defence and the sweep run concurrently (they only read); memory recall needs their output, so it goes last. */
export async function runSignatures(c: CaseCtx, store: GraphStore): Promise<SigResult[]> {
  const [pair, shared, succession] = await Promise.all([newDevicePair(c, store), sharedRareFingerprint(c, store), deviceSuccession(c, store)]);
  const base = [
    testThenSpend(c), offProfileBurst(c), ...pair, thresholdHugging(c), shared, outOfRegionHomeContinues(c),
    tripContinuity(c), succession, recurringCadence(c), baselineConsistent(c), bankScore(c), customerReport(c),
  ];
  return [...base, await recallMemory(c, store, base)];
}

export { iso };
