import { describe, expect, it } from "vitest";
import type { InMemoryStore } from "../src/store/InMemoryStore";
import { STORE_KIND, loadTestStore } from "./helpers";

const store = loadTestStore();

describe("the store on the synthetic test dataset", () => {
  it.skipIf(STORE_KIND !== "memory")("loads all four files", () => {
    const s = (store as InMemoryStore).stats();
    expect(s.pack).toBe(8);
    expect(s.closed).toBe(12);
    expect(s.transactions).toBeGreaterThan(4000);
    expect(s.devices).toBeGreaterThan(5);
  });

  it("never returns anything later than as_of (no look-ahead)", async () => {
    for (const c of store.packCases()) {
      const flagged = (await store.getTxn(c.flaggedTxnId))!;
      expect(flagged.ts).toBeLessThanOrEqual(c.openedAt); // a case opens after its flagged transaction
      const card = await store.cardTxns(flagged.cardKey, c.openedAt);
      expect(card.length).toBeGreaterThan(0);
      expect(Math.max(...card.map((t) => t.ts))).toBeLessThanOrEqual(c.openedAt);
    }
    const tst3 = store.packCases().find((c) => c.caseId === "TST-003")!;
    const profile = (await store.getTxn(tst3.flaggedTxnId))!.dev!.profile;
    const before = await store.deviceStats(profile, tst3.openedAt);
    const after = await store.deviceStats(profile, Number.MAX_SAFE_INTEGER);
    expect(after.txns).toBeGreaterThan(before.txns); // later ring activity exists in the file...
    expect(before.lastByCard.size).toBeGreaterThan(0);
    for (const last of before.lastByCard.values()) expect(last).toBeLessThanOrEqual(tst3.openedAt); // ...but is invisible as of the case opening
  });

  it("resolves a card as customer + network + type, with K labels only as aliases", async () => {
    const key = await store.resolveLabel("T9003-K1");
    expect(key).toBeDefined();
    expect(key!.startsWith("T9003|")).toBe(true);
    expect(await store.labelFor(key!)).toEqual({ label: "T9003-K1", derived: false });
  });

  it("marks a label as derived when no source file names the card", async () => {
    const key = (await store.customerCards("T9107"))[0];
    const l = await store.labelFor(key);
    expect(l.derived).toBe(true);
    expect(l.label).toMatch(/^T9107-K\d$/);
  });

  it("distinguishes the two cards of a two-card customer", async () => {
    const cards = await store.customerCards("T0005");
    expect(cards.length).toBe(2);
    expect(new Set((await Promise.all(cards.map((k) => store.labelFor(k)))).map((l) => l.label)).size).toBe(2);
  });

  it("memory is causal: a closed case is invisible before it closed", async () => {
    const anyClosed = (await store.closedCases(Number.MAX_SAFE_INTEGER))[0];
    expect((await store.closedCases(anyClosed.closedAt - 1)).some((c) => c.caseId === anyClosed.caseId)).toBe(false);
    expect((await store.closedCases(anyClosed.closedAt)).some((c) => c.caseId === anyClosed.caseId)).toBe(true);
  });
});
