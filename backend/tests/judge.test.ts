import { describe, expect, it } from "vitest";
import { judge } from "../src/engines/judge";
import type { SigResult } from "../src/domain/types";
import type { EvidenceClass } from "@fraud/shared";

const sig = (name: string, cls: EvidenceClass, logLr: number): SigResult => ({
  name, side: logLr >= 0 ? "prosecution" : "defence", cls, fired: true, strength: 1, logLr, claim: name, ref: name, entityIds: [], facts: {},
});

describe("judge: log-odds ledger with independence classes", () => {
  it("no evidence returns the prior", () => {
    const a = judge([]);
    expect(a.p).toBeCloseTo(0.4, 2);
    expect(a.k).toBe(0);
    expect(a.stop).toBeNull();
  });

  it("two correlated signals in the SAME class do not stack", () => {
    const one = judge([sig("a", "card_behaviour", 2.0)]);
    const two = judge([sig("a", "card_behaviour", 2.0), sig("b", "card_behaviour", 1.5)]);
    expect(two.p).toBeCloseTo(one.p, 6);
    expect(two.k).toBe(1);
  });

  it("independent classes add", () => {
    const one = judge([sig("a", "card_behaviour", 2.0)]);
    const two = judge([sig("a", "card_behaviour", 2.0), sig("b", "device", 1.5)]);
    expect(two.p).toBeGreaterThan(one.p);
    expect(two.k).toBe(2);
  });

  it("a defence signature in the same class offsets a prosecution signature", () => {
    const a = judge([sig("fraud", "device", 1.2), sig("innocent", "device", -2.6)]);
    expect(a.classes.device).toBeCloseTo(-1.4, 2);
    expect(a.p).toBeLessThan(0.4);
  });

  it("stop rule needs BOTH the threshold and two independent classes", () => {
    const strongOne = judge([sig("a", "card_behaviour", 6)]);
    expect(strongOne.p).toBeGreaterThan(0.85);
    expect(strongOne.stop).toBeNull(); // only one class
    const strongTwo = judge([sig("a", "card_behaviour", 4), sig("b", "network", 3)]);
    expect(strongTwo.stop).toBe("hi");
  });

  it("the innocent direction stops too, at 0.15 with two classes", () => {
    const a = judge([sig("trip", "geography", -2.6), sig("memory", "memory", -0.9), sig("base", "card_behaviour", -0.8)]);
    expect(a.p).toBeLessThan(0.15);
    expect(a.stop).toBe("lo");
  });

  it("the bank score never counts as an independent class", () => {
    const a = judge([sig("bank", "bank_score", 3.0), sig("a", "card_behaviour", 2.0)]);
    expect(a.k).toBe(1);
  });

  it("a class below the minimum weight does not count toward k", () => {
    expect(judge([sig("weak", "memory", 0.3), sig("a", "device", 2)]).k).toBe(1);
  });

  it("open questions explain why the stop rule is not met", () => {
    const a = judge([sig("a", "geography", 1.0)]);
    expect(a.stop).toBeNull();
    expect(a.openQuestions.join(" ")).toMatch(/independent/);
  });
});
