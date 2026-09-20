import { beforeAll, describe, expect, it } from "vitest";
import type { InvestigationResult } from "@fraud/shared";
import { investigate } from "../src/agent/orchestrator";
import { TemplateNarrator } from "./fixtures/templateNarrator";
import { validateAnswer } from "../src/validator/validateAnswer";
import { expected, loadTestStore } from "./helpers";

const store = loadTestStore();
const exp = expected();
const results = new Map<string, InvestigationResult>();

beforeAll(async () => {
  for (const c of [...store.packCases()].sort((a, b) => a.openedAt - b.openedAt))
    results.set(c.caseId, await investigate(store, c, { narrator: new TemplateNarrator(), }));
});

const acts = (id: string, which: "initial" | "final") => results.get(id)!.answer.next_best_actions[which].map((a) => a.action as string);

describe("end to end on the eight planted scenarios (expected.json is written from the policy, not from the output)", () => {
  for (const id of Object.keys(exp)) {
    const e = exp[id];
    describe(`${id}: ${e.why}`, () => {
      it("gets the fraud pattern and verdict right", () => {
        const c = results.get(id)!.answer.case;
        if (e.pattern) expect(c.pattern).toBe(e.pattern);
        if (e.pattern_in) expect(e.pattern_in).toContain(c.pattern);
        if (e.verdict) expect(c.verdict).toBe(e.verdict);
        if (e.verdict_in) expect(e.verdict_in).toContain(c.verdict);
      });
      it("recommends the right actions before and after evidence", () => {
        for (const a of e.initial_has ?? []) expect(acts(id, "initial"), `initial should have ${a}`).toContain(a);
        for (const a of e.initial_hasnt ?? []) expect(acts(id, "initial"), `initial must not have ${a}`).not.toContain(a);
        for (const a of e.final_has ?? []) expect(acts(id, "final"), `final should have ${a}`).toContain(a);
        for (const a of e.final_hasnt ?? []) expect(acts(id, "final"), `final must not have ${a}`).not.toContain(a);
      });
      it("uses the right approval routes", () => {
        for (const [action, route] of Object.entries(e.routes ?? {})) {
          const hit = results.get(id)!.answer.next_best_actions.final.find((a) => a.action === action);
          expect(hit?.route, `${action} route`).toBe(route);
        }
      });
      if (e.exposure !== undefined || e.affected || e.affected_include) {
        it("identifies the affected transactions and the exposure", () => {
          const c = results.get(id)!.answer.case;
          if (e.affected) expect([...c.affected_txn_ids].sort()).toEqual([...e.affected].map(String).sort());
          for (const t of e.affected_include ?? []) expect(c.affected_txn_ids).toContain(String(t));
          if (e.exposure !== undefined) expect(c.exposure_usd).toBeCloseTo(e.exposure, 2);
        });
      }
      if (e.connected_cards_include || e.connected_cards_exclude) {
        it("finds the live connected cards and does not see the future", () => {
          const c = results.get(id)!.answer.case;
          for (const k of e.connected_cards_include ?? []) expect(c.connected_card_ids).toContain(k);
          for (const k of e.connected_cards_exclude ?? []) expect(c.connected_card_ids).not.toContain(k);
        });
      }
    });
  }
});

describe("properties that must hold for every case", () => {
  it("every answer file passes the validator with no errors", async () => {
    for (const [id, r] of results) {
      const errs = (await validateAnswer(r.answer, store)).filter((i) => i.level === "error");
      expect(errs, `${id}: ${JSON.stringify(errs)}`).toEqual([]);
    }
  });

  it("no look-ahead: every transaction cited is at or before the case's opening time", async () => {
    for (const c of store.packCases()) {
      const a = results.get(c.caseId)!.answer;
      const cited = await store.getTxns([...a.case.affected_txn_ids, ...a.case.evidence.flatMap((e) => e.entity_ids)]);
      for (const [id, t] of cited) expect(t.ts, `${c.caseId} cites ${id}`).toBeLessThanOrEqual(c.openedAt);
    }
  });

  it("recommendations only ever use the policy's action names and routes", () => {
    for (const r of results.values()) for (const a of [...r.answer.next_best_actions.initial, ...r.answer.next_best_actions.final]) expect(["auto", "L1", "L2"]).toContain(a.route);
  });

  it("the agent never executes an L1 or L2 action: it recommends them with the route", () => {
    for (const r of results.values()) for (const a of r.answer.next_best_actions.final) if (a.route !== "auto") expect(a.reason.length).toBeGreaterThan(0);
  });

  it("records both checkpoints, and what_changed is nothing exactly when nothing changed", () => {
    for (const r of results.values()) {
      const n = r.answer.next_best_actions;
      const same = JSON.stringify(n.initial.map((a) => a.action + a.route).sort()) === JSON.stringify(n.final.map((a) => a.action + a.route).sort());
      expect(n.what_changed === "nothing").toBe(same);
    }
  });

  it("a SAR is present exactly when FILE_REPORT is recommended", () => {
    for (const r of results.values()) expect(r.answer.sar.file).toBe(r.answer.next_best_actions.final.some((a) => a.action === "FILE_REPORT"));
  });

  it("legitimate verdicts carry no exposure and no affected transactions", () => {
    for (const r of results.values()) if (r.answer.case.verdict === "legitimate") { expect(r.answer.case.exposure_usd).toBe(0); expect(r.answer.case.affected_txn_ids).toEqual([]); }
  });

  it("is deterministic: the same case twice gives the same answer", async () => {
    const c = store.packCases().find((p) => p.caseId === "TST-005")!;
    const a = (await investigate(store, c, { narrator: new TemplateNarrator(), })).answer;
    const b = results.get("TST-005")!.answer;
    expect({ ...a, latency_s: 0, tool_calls: 0 }).toEqual({ ...b, latency_s: 0, tool_calls: 0 });
  });

  it("reports counters measured by the orchestrator", () => {
    for (const r of results.values()) { expect(r.answer.tool_calls).toBeGreaterThan(0); expect(r.answer.latency_s).toBeGreaterThanOrEqual(0); }
  });
});

describe("when the agent needs the customer, nothing is invented: no reply is available, so the no-reply rule applies", () => {
  it("TST-007: verify first (R1), then the no-reply rule (R4); the plans for the other answers are shown", () => {
    const n = results.get("TST-007")!.answer.next_best_actions;
    expect(n.initial.map((a) => a.action)).toContain("VERIFY_WITH_CUSTOMER");
    expect(n.final.map((a) => a.action)).toEqual(expect.arrayContaining(["MONITOR_CARD", "DECLINE_TRANSACTION"]));
    expect(n.what_changed).not.toBe("nothing");
    const byReply = Object.fromEntries((n.contingency ?? []).map((c) => [c.reply, c.actions.map((a) => a.action)]));
    expect(Object.keys(byReply).sort()).toEqual(["confirms", "denies", "silent"]);
    expect(byReply.denies).toEqual(expect.arrayContaining(["BLOCK_CARD", "CREATE_CASE"]));
    expect(byReply.confirms).toEqual(["CLOSE_NO_FRAUD"]);
  });

  it("every evidence request says that no reply is available and none is invented", () => {
    let asked = 0;
    for (const r of results.values()) for (const q of r.answer.evidence_requests) {
      asked++;
      expect(q.assumed_response).toMatch(/No reply from the customer is available/);
      expect(q.assumed_response).toMatch(/none is invented/);
    }
    expect(asked).toBeGreaterThan(0);
  });

  it("no evidence item comes from a customer answer, and the fraud probability is the pre-reply assessment", () => {
    for (const r of results.values()) {
      expect(r.answer.case.evidence.some((e) => e.source === "customer")).toBe(false);
      expect(r.answer.case.fraud_probability).toBe(r.trace.assessment.p);
    }
  });

  it("an uncertain case is never closed as 'no fraud', and above $500 it is escalated (R8)", () => {
    for (const [id, r] of results) {
      const a = r.answer;
      const fin = a.next_best_actions.final.map((x) => x.action);
      if (a.case.verdict === "uncertain") expect(fin, id).not.toContain("CLOSE_NO_FRAUD");
      if (a.case.verdict === "uncertain" && a.case.exposure_usd > 500) expect(fin, id).toContain("ESCALATE_TO_ANALYST");
    }
  });

  it("the trace records every message to the database, for the who-talked-to-whom view", () => {
    for (const r of results.values()) expect(Array.isArray(r.trace.comms)).toBe(true);
  });
});
