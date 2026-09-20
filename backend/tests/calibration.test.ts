import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LR, loadBaselineJson } from "../src/engines/calibration";
import { runSignatures } from "../src/engines/signatures";
import { ROOT } from "../src/config";
import { loadTestStore } from "./helpers";

const file = resolve(ROOT, "calibration", "baseline_v0.json");
const store = loadTestStore();

describe("calibration: code constants stay in sync with what the notebook measured", () => {
  it.skipIf(!existsSync(file))("the in-zone new-device weight equals baseline_v0.json (within 0.05)", () => {
    const b = loadBaselineJson(file)!;
    expect(b.zone).toBe("risk_score >= 0.8");
    expect(Math.abs(LR.new_device_in_zone - b.signals.new_device.log_lr_present)).toBeLessThanOrEqual(0.05);
  });

  it.skipIf(!existsSync(file))("the notebook table has the signals the design relies on, all shrunk and capped", () => {
    const b = JSON.parse(readFileSync(file, "utf8"));
    for (const k of ["new_device", "proxy", "device_unseen_by_card", "new_region", "new_product", "amount_over_p95"]) {
      expect(b.signals[k]).toBeDefined();
      expect(Math.abs(b.signals[k].log_lr_present)).toBeLessThanOrEqual(Math.log(5) + 1e-9);
    }
  });
});

describe("the score zone selects which meaning a New device has", () => {
  const run = async (caseId: string) => {
    const c = store.packCases().find((p) => p.caseId === caseId)!;
    const flagged = (await store.getTxn(c.flaggedTxnId))!;
    const ctx = { caseId, asOf: c.openedAt, trigger: c.trigger, triggerScore: c.score, flagged, cardKey: flagged.cardKey, card: await store.cardTxns(flagged.cardKey, c.openedAt), hub: false };
    return Object.fromEntries((await runSignatures(ctx, store)).map((s) => [s.name, s]));
  };

  it("below 0.8 (TST-008, score 0.55) a New device is prosecution evidence", async () => {
    const s = await run("TST-008");
    expect(s.new_device.fired).toBe(true);
    expect(s.new_device.logLr).toBeGreaterThan(0);
    expect(s.new_device_at_high_score.fired).toBe(false);
  });

  it("at 0.8 and above (TST-006, score 0.88) the same New device is defence evidence", async () => {
    const s = await run("TST-006");
    expect(s.new_device_at_high_score.fired).toBe(true);
    expect(s.new_device_at_high_score.logLr).toBeLessThan(0);
    expect(s.new_device_at_high_score.side).toBe("defence");
    expect(s.new_device.fired).toBe(false);
  });

  it("the in-zone version never adds affected transactions or a fraud pattern", async () => {
    const s = await run("TST-006");
    expect(s.new_device_at_high_score.facts.txnIds).toEqual([]);
    expect(s.new_device_at_high_score.pattern).toBeUndefined();
  });
});
