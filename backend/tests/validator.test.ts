import { beforeAll, describe, expect, it } from "vitest";
import type { AnswerFile } from "@fraud/shared";
import { investigate } from "../src/agent/orchestrator";
import { TemplateNarrator } from "./fixtures/templateNarrator";
import { validateAnswer } from "../src/validator/validateAnswer";
import { loadTestStore } from "./helpers";

const store = loadTestStore();
let good: AnswerFile;   // TST-002: fraud, exposure 1906.07, report filed
let legit: AnswerFile;  // TST-005 after confirmation
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const codes = async (a: unknown) => (await validateAnswer(a, store)).filter((i) => i.level === "error").map((i) => i.code);

beforeAll(async () => {
  const run = async (id: string) => (await investigate(store, store.packCases().find((c) => c.caseId === id)!, { narrator: new TemplateNarrator() })).answer;
  good = await run("TST-002");
  legit = await run("TST-005");
});

describe("answer-file validator accepts a correct file", () => {
  it("passes a real fraud answer", async () => expect(await codes(good)).toEqual([]));
  it("passes a real legitimate answer", async () => expect(await codes(legit)).toEqual([]));
});

describe("and rejects each way a file can be wrong", () => {
  it("unknown transaction ID", async () => {
    const a = clone(good); a.case.affected_txn_ids[0] = "99999999";
    expect(await codes(a)).toContain("unknown_id");
  });
  it("exposure that is not the sum of the affected amounts", async () => {
    const a = clone(good); a.case.exposure_usd = 1;
    expect(await codes(a)).toContain("exposure");
  });
  it("legitimate verdict with exposure", async () => {
    const a = clone(legit); a.case.verdict = "legitimate"; a.case.exposure_usd = 10; a.case.affected_txn_ids = [good.case.affected_txn_ids[0]];
    expect(await codes(a)).toContain("legit_exposure");
  });
  it("wrong approval route: BLOCK_CARD above $2,500 must be L2, FILE_REPORT must be L2", async () => {
    const a = clone(good); a.next_best_actions.final.find((x) => x.action === "FILE_REPORT")!.route = "auto";
    expect(await codes(a)).toContain("route");
  });
  it("BLOCK_ALL_CARDS without R10", async () => {
    const a = clone(good); a.next_best_actions.final.push({ action: "BLOCK_ALL_CARDS", route: "L2", reason: "x" });
    expect(await codes(a)).toContain("r10");
  });
  it("SAR flag that disagrees with FILE_REPORT", async () => {
    const a = clone(good); a.sar.file = false;
    expect(await codes(a)).toContain("sar_consistency");
  });
  it("SAR narrative too short", async () => {
    const a = clone(good); a.sar.narrative = "One sentence only.";
    expect(await codes(a)).toContain("sar_length");
  });
  it("SAR subject missing from the narrative", async () => {
    const a = clone(good); a.sar.subjects.push("T0001");
    expect(await codes(a)).toContain("sar_subject");
  });
  it("SAR fields must be empty when no report is filed", async () => {
    const a = clone(legit); a.sar.narrative = "text";
    expect(await codes(a)).toContain("sar_empty");
  });
  it("pattern_description is required exactly for undocumented", async () => {
    const a = clone(good); a.case.pattern_description = "";
    expect(await codes(a)).toContain("pattern_description");
    const b = clone(legit); b.case.pattern_description = "some text";
    expect(await codes(b)).toContain("pattern_description");
  });
  it("what_changed must match whether the recommendation changed", async () => {
    const a = clone(good); a.next_best_actions.what_changed = "The customer said something.";
    expect(await codes(a)).toContain("what_changed");
  });
  it("a report without a case behind it", async () => {
    const a = clone(good); a.next_best_actions.final = a.next_best_actions.final.filter((x) => x.action !== "CREATE_CASE"); a.next_best_actions.initial = clone(a.next_best_actions.final);
    expect(await codes(a)).toContain("report_without_case");
  });
  it("evidence with no entity IDs (except customer replies)", async () => {
    const a = clone(good); a.case.evidence[0].entity_ids = [];
    expect(await codes(a)).toContain("evidence_ids");
  });
  it("schema violations: a made-up action name", async () => {
    const a = clone(good) as unknown as { next_best_actions: { final: { action: string }[] } }; a.next_best_actions.final[0].action = "FREEZE_EVERYTHING";
    expect(await codes(a)).toContain("schema");
  });
  it("similar_prior_cases must be real closed cases", async () => {
    const a = clone(good); a.case.similar_prior_cases = ["CC-9999"];
    expect(await codes(a)).toContain("unknown_id");
  });
});
