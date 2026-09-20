import { describe, expect, it } from "vitest";
import { runSignatures } from "../src/engines/signatures";
import type { CaseCtx, SigResult } from "../src/domain/types";
import { loadTestStore } from "./helpers";

const store = loadTestStore();

async function ctxFor(caseId: string): Promise<CaseCtx> {
  const c = store.packCases().find((p) => p.caseId === caseId)!;
  const flagged = (await store.getTxn(c.flaggedTxnId))!;
  const card = await store.cardTxns(flagged.cardKey, c.openedAt);
  return { caseId, asOf: c.openedAt, trigger: c.trigger, triggerScore: c.score, flagged, cardKey: flagged.cardKey, card, hub: false };
}
const cache = new Map<string, Promise<Record<string, SigResult>>>();
const sigs = (id: string): Promise<Record<string, SigResult>> => {
  if (!cache.has(id)) cache.set(id, ctxFor(id).then((c) => runSignatures(c, store)).then((r) => Object.fromEntries(r.map((s) => [s.name, s]))));
  return cache.get(id)!;
};
const firedNames = async (id: string) => Object.values(await sigs(id)).filter((s) => s.fired).map((s) => s.name);

describe("prosecution signatures fire on the planted scenarios", () => {
  it("TST-001 card testing: three small online auths then a purchase over $100", async () => {
    const s = (await sigs("TST-001")).test_then_spend;
    expect(s.fired).toBe(true);
    expect(s.entityIds.length).toBe(5);
    expect(s.facts.bigCleared).toBe(true);
  });
  it("TST-002 structuring: four purchases just under $500 in 30 minutes", async () => {
    const s = (await sigs("TST-002")).threshold_hugging;
    expect(s.fired).toBe(true);
    expect(s.entityIds.length).toBe(4);
    expect(s.pattern).toBe("undocumented");
  });
  it("TST-003 ring: a rare fingerprint shared by many cards, with live and already-handled members", async () => {
    const s = (await sigs("TST-003")).shared_rare_fingerprint;
    expect(s.fired).toBe(true);
    expect((s.facts.connectedLive as string[]).length).toBe(5); // T9107-T9111 (T9112 appears only after the case opens)
    expect((s.facts.connectedClosed as string[]).length).toBe(6); // the September wave, already blocked
  });
  it("TST-007 out of region while home spending continues", async () => {
    expect((await sigs("TST-007")).out_of_region_home_continues.fired).toBe(true);
  });
  it("TST-008 off-profile online burst from a device marked New", async () => {
    const s = await sigs("TST-008");
    expect(s.off_profile_burst.fired).toBe(true);
    expect(s.new_device.fired).toBe(true);
  });
});

describe("defence signatures find the innocent explanations", () => {
  it("TST-004 trip: consecutive days in a new region while home activity stops", async () => expect((await sigs("TST-004")).trip_continuity.fired).toBe(true));
  it("TST-005 recurring: same amount at a regular monthly gap, beyond coincidence", async () => {
    const s = (await sigs("TST-005")).recurring_cadence;
    expect(s.fired).toBe(true);
    expect(Math.round(s.facts.medianGap as number)).toBeGreaterThanOrEqual(29);
  });
  it("TST-006 new phone: the new device replaces an older one of the same family and is not shared", async () => expect((await sigs("TST-006")).device_succession.fired).toBe(true));
});

describe("negative controls: signatures stay quiet where they should", () => {
  it("TST-002 has no shared fingerprint, no trip, no card testing", async () => {
    const f = (await firedNames("TST-002"));
    expect(f).not.toContain("shared_rare_fingerprint");
    expect(f).not.toContain("trip_continuity");
    expect(f).not.toContain("test_then_spend");
  });
  it("TST-007 (single-day out-of-region use) is not a trip", async () => expect((await sigs("TST-007")).trip_continuity.fired).toBe(false));
  it("TST-004 (a trip) is not out-of-region fraud, because home activity stopped", async () => expect((await sigs("TST-004")).out_of_region_home_continues.fired).toBe(false));
  it("TST-005 has no fraud signature besides the customer's own report", async () => {
    const f = (await firedNames("TST-005")).filter((n) => !["recurring_cadence", "baseline_consistent", "customer_report", "bank_score"].includes(n));
    expect(f).toEqual([]);
  });
  it("TST-006 does not fire a fraud burst or a shared fingerprint", async () => {
    const f = (await firedNames("TST-006"));
    expect(f).not.toContain("off_profile_burst");
    expect(f).not.toContain("shared_rare_fingerprint");
  });
  it("a generic, widely shared device profile is never a ring", async () => {
    for (const id of ["TST-002", "TST-004", "TST-005", "TST-007"]) expect((await sigs(id)).shared_rare_fingerprint.fired).toBe(false);
  });
});

describe("memory recall is causal and grounded", () => {
  it("TST-002 recalls the earlier structuring cases from September", async () => {
    const m = (await sigs("TST-002")).memory_recall;
    expect(m.fired).toBe(true);
    expect(m.entityIds).toEqual(expect.arrayContaining(["CC-T200", "CC-T201"]));
  });
  it("TST-004 recalls cleared travel cases, which lower the odds", async () => {
    const m = (await sigs("TST-004")).memory_recall;
    expect(m.logLr).toBeLessThan(0);
  });
  it("never recalls a case that had not closed by as-of", async () => {
    const c = store.packCases().find((p) => p.caseId === "TST-002")!;
    const visible = new Set((await store.closedCases(c.openedAt)).map((x) => x.caseId));
    for (const id of (await sigs("TST-002")).memory_recall.entityIds) expect(visible.has(id)).toBe(true);
  });
});
