import { describe, expect, it } from "vitest";
import { sharedRareFingerprint } from "../src/engines/signatures";
import type { CaseCtx, Txn } from "../src/domain/types";
import type { DeviceStats, GraphStore } from "../src/store/GraphStore";
import { checkSar, type Brief } from "../src/llm/narrator";
import { TemplateNarrator } from "./fixtures/templateNarrator";

/**
 * Specificity of the ring rule. On the real data a looser rule flagged 212 of 9,706 device profiles, mostly generic
 * iPhones shared by hundreds of customers; the rule below flags only profiles that look like the documented ring.
 */
const T0 = Date.UTC(2016, 10, 20);
const PROFILE = "SM-X Build/1 | Android 7.0 | chrome 62.0 for android | 1920x1080";

function world(opts: { users: number; newShare: number; proxy: string }) {
  const txns: Txn[] = [];
  for (let u = 0; u < opts.users; u++) {
    txns.push({
      id: String(1000 + u), customer: `U${u}`, cardKey: `U${u}|visa|credit`, ts: T0 + u * 60_000, channel: "online", score: 0.1, amt: 50, prod: "C",
      region: null, card4: "visa", card6: "credit",
      dev: { profile: PROFILE, family: "SM", isNew: u < Math.round(opts.users * opts.newShare), proxy: opts.proxy },
    });
  }
  const n = txns.length;
  const stats: DeviceStats = {
    profile: PROFILE, users: new Set(txns.map((t) => t.customer)).size, txns: n,
    newShare: txns.filter((t) => t.dev?.isNew).length / n, anonProxyShare: txns.filter((t) => t.dev?.proxy === "IP_PROXY:ANONYMOUS").length / n,
    lastByCard: new Map(txns.map((t) => [t.cardKey, t.ts])), blocked: new Set(),
  };
  const store = { calls: 0, deviceStats: async () => stats } as unknown as GraphStore;
  const own = txns[0];
  const ctx: CaseCtx = { caseId: "X", asOf: T0 + 10 * 86_400_000, trigger: "analyst_request", triggerScore: null, flagged: own, cardKey: own.cardKey, card: [own], hub: false };
  return { store, ctx };
}
const fires = async (o: Parameters<typeof world>[0]) => { const { store, ctx } = world(o); return (await sharedRareFingerprint(ctx, store)).fired; };

describe("shared rare fingerprint: what counts as a ring", () => {
  it("fires for a rare profile, always New, behind an anonymous proxy, across many customers", async () => expect(await fires({ users: 30, newShare: 1, proxy: "IP_PROXY:ANONYMOUS" })).toBe(true));
  it("does NOT fire for a busy, generic profile even if it is often New (no proxy)", async () => expect(await fires({ users: 400, newShare: 0.85, proxy: "" })).toBe(false));
  it("does NOT fire without the anonymous proxy, however New", async () => expect(await fires({ users: 30, newShare: 1, proxy: "" })).toBe(false));
  it("does NOT fire when the profile is only sometimes New", async () => expect(await fires({ users: 30, newShare: 0.5, proxy: "IP_PROXY:ANONYMOUS" })).toBe(false));
  it("does NOT fire for a tiny group (fewer than 5 users)", async () => expect(await fires({ users: 4, newShare: 1, proxy: "IP_PROXY:ANONYMOUS" })).toBe(false));
  it("does NOT fire for a ubiquitous profile (over 200 users) even behind a proxy", async () => expect(await fires({ users: 250, newShare: 1, proxy: "IP_PROXY:ANONYMOUS" })).toBe(false));
});

describe("SAR sentence count survives claims that contain their own full stops", () => {
  const brief: Brief = {
    caseId: "X-1", customer: "C1", cardLabel: "C1-K1", trigger: "customer_report", verdict: "fraud", pattern: "undocumented",
    patternDescription: "First idea. Second idea. Third idea.", probability: 0.9, exposure: 100,
    affected: [{ id: "1", amt: 100, ts: "2016-11-20 10:00:00", channel: "online", region: null }],
    connectedCards: ["C2-K1", "C3-K1"], devices: ["Windows | Windows 10 | chrome 65.0 | 1920x1080"],
    evidence: [
      { claim: "Bank model scored the flagged transaction 0.62. In the zone above 0.8 half were false alarms. Third sentence here.", source: "graph", ref: "model:risk_score", entity_ids: ["1"] },
      { claim: "Another claim. With its own stops. Again.", source: "graph", ref: "q", entity_ids: ["1"] },
      { claim: "Third claim. More text.", source: "graph", ref: "q", entity_ids: ["1"] },
    ],
    initial: [{ action: "BLOCK_CARD", route: "L1", reason: "R2" }], final: [{ action: "BLOCK_CARD", route: "L1", reason: "R2" }, { action: "FILE_REPORT", route: "L2", reason: "R9" }],
    whatChanged: "nothing", rules: ["R2"], fileReport: true, activityDates: ["2016-11-20", "2016-11-20"], subjects: ["C1", "C1-K1"], openQuestions: [],
  };
  it("stays within 6 to 12 sentences and passes the checker", async () => {
    const r = await new TemplateNarrator().sar(brief);
    expect(r.text.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(12);
    expect(checkSar(r.text, brief)).toBeNull();
  });
});
