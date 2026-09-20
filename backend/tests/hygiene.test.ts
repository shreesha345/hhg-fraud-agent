import { describe, expect, it } from "vitest";
import { recallMemory, runSignatures } from "../src/engines/signatures";
import type { CaseCtx } from "../src/domain/types";
import { loadTestStore } from "./helpers";

const store = loadTestStore();

async function ctx(caseId: string, hub = false): Promise<CaseCtx> {
  const c = store.packCases().find((p) => p.caseId === caseId)!;
  const flagged = (await store.getTxn(c.flaggedTxnId))!;
  return { caseId, asOf: c.openedAt, trigger: c.trigger, triggerScore: c.score, flagged, cardKey: flagged.cardKey, card: await store.cardTxns(flagged.cardKey, c.openedAt), hub };
}

describe("memory is base-rate safe", () => {
  it("a customer's mere closed history is NOT evidence (closed cases are 84% fraud)", async () => {
    // T9101 has a closed, confirmed ring case (CC-T100). With no matching SHAPE, memory must stay silent.
    const t = (await store.cardTxns((await store.customerCards("T9101"))[0], Infinity)).slice(-1)[0];
    const c: CaseCtx = { caseId: "X", asOf: Date.UTC(2016, 11, 1), trigger: "risk_score", triggerScore: 0.6, flagged: t, cardKey: t.cardKey, card: await store.cardTxns(t.cardKey, Date.UTC(2016, 11, 1)), hub: false };
    const m = await recallMemory(c, store, []);
    expect(m.fired).toBe(false);
    expect(m.entityIds).toEqual([]);
    expect(m.logLr).toBe(0);
  });
});

describe("hub hygiene: an aggregate card is not one person", () => {
  const sig = async (hub: boolean, name: string) => (await runSignatures(await ctx("TST-008", hub), store)).find((s) => s.name === name)!;

  it("a New device counts for much less on a hub card", async () => {
    expect((await sig(false, "new_device")).logLr).toBeGreaterThan(0);
    expect((await sig(true, "new_device")).logLr).toBeLessThan((await sig(false, "new_device")).logLr / 3);
  });

  it("an off-profile burst needs more purchases before it fires on a hub card", async () => {
    expect((await sig(false, "off_profile_burst")).fired).toBe(true);   // 3 purchases
    expect((await sig(true, "off_profile_burst")).fired).toBe(false);   // hub needs 4
  });
});
