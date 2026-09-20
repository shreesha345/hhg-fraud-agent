import { describe, expect, it } from "vitest";
import { contingency, decide, routeFor, type PolicyInput } from "../src/engines/policy";

const base = (o: Partial<PolicyInput> = {}): PolicyInput => ({
  p: 0.5, k: 1, stop: null, trigger: "risk_score", exposure: 100, pattern: "none",
  flags: { testThenSpend: false, bigCleared: false, sharedFingerprint: false, connectedLive: 0, recurring: false, otherCardFraud: false, confirmedFraudCards: 0 },
  reply: "none", budgetSpent: false, ...o,
});
const names = (o: ReturnType<typeof decide>) => o.actions.map((a) => a.action);

describe("approval routes (README section 2)", () => {
  it("auto actions", () => {
    for (const a of ["ALLOW_TRANSACTION", "MONITOR_CARD", "MONITOR_CONNECTED_CARDS", "WARN_CUSTOMER", "VERIFY_WITH_CUSTOMER", "STEP_UP_AUTH", "GENERATE_REPORT", "CREATE_CASE", "ESCALATE_TO_ANALYST", "CLOSE_NO_FRAUD"] as const)
      expect(routeFor(a, 99999)).toBe("auto");
  });
  it("DECLINE_TRANSACTION is L1", () => expect(routeFor("DECLINE_TRANSACTION", 10)).toBe("L1"));
  it("BLOCK_CARD is L1 up to $2,500 and L2 above", () => {
    expect(routeFor("BLOCK_CARD", 2500)).toBe("L1");
    expect(routeFor("BLOCK_CARD", 2500.01)).toBe("L2");
  });
  it("BLOCK_ALL_CARDS and FILE_REPORT are always L2", () => {
    expect(routeFor("BLOCK_ALL_CARDS", 1)).toBe("L2");
    expect(routeFor("FILE_REPORT", 1)).toBe("L2");
  });
});

describe("rules", () => {
  it("R1: a single weak signal below 0.70 verifies before any block", () => {
    const o = decide(base({ p: 0.45, k: 1 }));
    expect(names(o)).toContain("VERIFY_WITH_CUSTOMER");
    expect(names(o)).not.toContain("BLOCK_CARD");
    expect(o.rules).toContain("R1");
    expect(o.needsEvidence?.type).toBe("customer_validation");
  });
  it("R2: customer denies -> BLOCK_CARD and CREATE_CASE, no report under $1,000 and no shared element", () => {
    const o = decide(base({ reply: "denies", p: 0.9, exposure: 268.43 }));
    expect(names(o)).toEqual(expect.arrayContaining(["BLOCK_CARD", "CREATE_CASE"]));
    expect(names(o)).not.toContain("FILE_REPORT");
    expect(o.actions.find((a) => a.action === "BLOCK_CARD")?.route).toBe("L1");
  });
  it("R2: adds FILE_REPORT over $1,000 or with a shared device or another card's fraud", () => {
    expect(names(decide(base({ reply: "denies", exposure: 1000.01 })))).toContain("FILE_REPORT");
    expect(names(decide(base({ reply: "denies", exposure: 50, flags: { ...base().flags, otherCardFraud: true } })))).toContain("FILE_REPORT");
  });
  it("R3: customer confirms -> CLOSE_NO_FRAUD", () => expect(names(decide(base({ reply: "confirms" })))).toEqual(["CLOSE_NO_FRAUD"]));
  it("R4: no reply -> MONITOR_CARD and DECLINE_TRANSACTION, escalate over $500", () => {
    expect(names(decide(base({ reply: "silent", exposure: 100 })))).toEqual(expect.arrayContaining(["MONITOR_CARD", "DECLINE_TRANSACTION"]));
    expect(names(decide(base({ reply: "silent", exposure: 100 })))).not.toContain("ESCALATE_TO_ANALYST");
    expect(names(decide(base({ reply: "silent", exposure: 500.5 })))).toContain("ESCALATE_TO_ANALYST");
  });
  it("R5: card testing -> DECLINE and STEP_UP; BLOCK_CARD only if a purchase over $100 cleared", () => {
    const f = { ...base().flags, testThenSpend: true };
    const a = decide(base({ p: 0.95, k: 2, stop: "hi", flags: f }));
    expect(names(a)).toEqual(expect.arrayContaining(["DECLINE_TRANSACTION", "STEP_UP_AUTH"]));
    expect(names(a)).not.toContain("BLOCK_CARD");
    expect(names(decide(base({ p: 0.95, k: 2, stop: "hi", flags: { ...f, bigCleared: true } })))).toContain("BLOCK_CARD");
  });
  it("R6: shared device -> CREATE_CASE, FILE_REPORT and MONITOR_CONNECTED_CARDS", () => {
    const o = decide(base({ p: 0.9, k: 3, stop: "hi", pattern: "undocumented", flags: { ...base().flags, sharedFingerprint: true, connectedLive: 5 } }));
    expect(names(o)).toEqual(expect.arrayContaining(["CREATE_CASE", "FILE_REPORT", "MONITOR_CONNECTED_CARDS"]));
  });
  it("R7: a disputed recurring charge is never blocked", () => {
    const o = decide(base({ trigger: "customer_report", p: 0.26, flags: { ...base().flags, recurring: true } }));
    expect(names(o)).toEqual(expect.arrayContaining(["CREATE_CASE", "VERIFY_WITH_CUSTOMER", "WARN_CUSTOMER"]));
    expect(names(o)).not.toContain("BLOCK_CARD");
  });
  it("R8: uncertain and exposed after the evidence budget is spent -> escalate", () => {
    expect(names(decide(base({ p: 0.5, budgetSpent: true, exposure: 501 })))).toContain("ESCALATE_TO_ANALYST");
    expect(names(decide(base({ p: 0.5, budgetSpent: true, exposure: 400 })))).not.toContain("ESCALATE_TO_ANALYST");
  });
  it("R9: undocumented pattern -> CREATE_CASE, FILE_REPORT, ESCALATE_TO_ANALYST", () => {
    const o = decide(base({ p: 0.95, k: 2, stop: "hi", pattern: "undocumented" }));
    expect(names(o)).toEqual(expect.arrayContaining(["CREATE_CASE", "FILE_REPORT", "ESCALATE_TO_ANALYST"]));
  });
  it("R10: BLOCK_ALL_CARDS never appears unless two cards show confirmed fraud", () => {
    expect(names(decide(base({ reply: "denies" })))).not.toContain("BLOCK_ALL_CARDS");
    expect(names(decide(base({ reply: "denies", flags: { ...base().flags, confirmedFraudCards: 1 } })))).not.toContain("BLOCK_ALL_CARDS");
    expect(names(decide(base({ reply: "denies", flags: { ...base().flags, confirmedFraudCards: 2 } })))).toContain("BLOCK_ALL_CARDS");
  });
  it("a customer report counts as a denial (R2), unless defence has cleared it", () => {
    expect(names(decide(base({ trigger: "customer_report", p: 0.9, k: 2, stop: "hi" })))).toContain("BLOCK_CARD");
    expect(names(decide(base({ trigger: "customer_report", p: 0.05, k: 2, stop: "lo" })))).not.toContain("BLOCK_CARD");
  });
  it("very low probability with independent defence evidence closes as legitimate", () => {
    expect(names(decide(base({ p: 0.05, k: 2, stop: "lo" })))).toEqual(expect.arrayContaining(["ALLOW_TRANSACTION", "CLOSE_NO_FRAUD"]));
  });
  it("every action carries a reason", () => {
    for (const a of decide(base({ reply: "denies", exposure: 3000 })).actions) expect(a.reason.length).toBeGreaterThan(3);
  });
});

describe("README example 3b: probability 0.45 on one signal, customer denies", () => {
  it("initial is VERIFY_WITH_CUSTOMER, final is BLOCK_CARD and CREATE_CASE", () => {
    const initial = decide(base({ p: 0.45, k: 1, exposure: 268 }));
    expect(names(initial)).toContain("VERIFY_WITH_CUSTOMER");
    expect(names(initial)).not.toContain("BLOCK_CARD");
    const final = decide(base({ p: 0.86, k: 2, reply: "denies", exposure: 268, budgetSpent: true }));
    expect(names(final)).toEqual(expect.arrayContaining(["BLOCK_CARD", "CREATE_CASE"]));
  });
  it("contingency covers all three replies", () => {
    const c = contingency(base({ p: 0.45, exposure: 600 }));
    expect(c.map((x) => x.reply).sort()).toEqual(["confirms", "denies", "silent"]);
    expect(c.find((x) => x.reply === "confirms")!.actions.map((a) => a.action)).toEqual(["CLOSE_NO_FRAUD"]);
  });
});
