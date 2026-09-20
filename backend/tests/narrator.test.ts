import { describe, expect, it } from "vitest";
import { NarratorError, OllamaNarrator, checkExplain, checkSar, type Brief } from "../src/llm/narrator";
import { TemplateNarrator } from "./fixtures/templateNarrator";

const brief: Brief = {
  caseId: "TST-002", customer: "T9002", cardLabel: "T9002-K1", trigger: "customer_report", verdict: "fraud", pattern: "undocumented",
  patternDescription: "Several online purchases just under a round threshold.", probability: 0.97, exposure: 1906.07,
  affected: [
    { id: "9003001", amt: 478.95, ts: "2016-11-21 20:00:00", channel: "online", region: null },
    { id: "9003002", amt: 456.96, ts: "2016-11-21 20:10:00", channel: "online", region: null },
    { id: "9003003", amt: 488.04, ts: "2016-11-21 20:24:00", channel: "online", region: null },
    { id: "9003004", amt: 482.12, ts: "2016-11-21 20:30:00", channel: "online", region: null },
  ],
  connectedCards: [], devices: ["Windows | Windows 7 | ie 11.0 for desktop | 1366x768"],
  evidence: [{ claim: "4 online purchases within 30 minutes, each just under $500", source: "graph", ref: "signature:threshold_hugging", entity_ids: ["9003001"] }],
  initial: [{ action: "BLOCK_CARD", route: "L1", reason: "R2" }], final: [{ action: "BLOCK_CARD", route: "L1", reason: "R2" }, { action: "FILE_REPORT", route: "L2", reason: "R9" }],
  whatChanged: "nothing", rules: ["R2", "R9"], fileReport: true, activityDates: ["2016-11-21", "2016-11-21"], subjects: ["T9002", "T9002-K1"], openQuestions: [],
};

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean);

describe("template narrator (always available)", () => {
  it("writes a 2 to 6 sentence summary that passes its own check", async () => {
    const r = await new TemplateNarrator().explain(brief);
    expect(checkExplain(r.text, brief)).toBeNull();
    expect(r.tokens).toBe(0);
  });
  it("writes a SAR of 6 to 12 sentences that names every subject and passes its own check", async () => {
    const r = await new TemplateNarrator().sar(brief);
    expect(sentences(r.text).length).toBeGreaterThanOrEqual(6);
    expect(sentences(r.text).length).toBeLessThanOrEqual(12);
    for (const s of brief.subjects) expect(r.text).toContain(s);
    expect(r.text).toMatch(/1906\.07/);
    expect(checkSar(r.text, brief)).toBeNull();
  });
});

describe("output checks reject what a small model might invent", () => {
  it("a number that is not in the brief", () => expect(checkExplain("The fraud probability is 0.55. The exposure is $9999.00.", brief)).toMatch(/not in the brief/));
  it("a summary that is too long", () => expect(checkExplain("A. B. C. D. E. F. G.", brief)).toMatch(/2 to 6/));
  it("a SAR that omits a subject", () => {
    const text = Array.from({ length: 7 }, (_, i) => `Sentence ${i + 1} about the case.`).join(" ");
    expect(checkSar(text, brief)).toMatch(/subject|not in the brief/);
  });
});

function fakeOllama(replies: string[]) {
  let i = 0;
  const calls: string[] = [];
  const impl = (async (_url: unknown, init: { body: string }) => {
    calls.push(init.body);
    const content = replies[Math.min(i++, replies.length - 1)];
    return { ok: true, json: async () => ({ message: { content }, prompt_eval_count: 100, eval_count: 40 }) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("Ollama narrator: structured output, retries, then a clear error (never a substitute text)", () => {
  const opts = (fetchImpl: typeof fetch) => ({ host: "http://x", model: "qwen2.5-coder:7b", numCtx: 8192, fetchImpl });

  it("accepts a valid model reply and counts its tokens", async () => {
    const good = JSON.stringify({ summary: "Assessment: likely fraud with probability 0.97. Recommended: BLOCK_CARD (L1) and FILE_REPORT (L2) under R2, R9." });
    const { impl, calls } = fakeOllama([good]);
    const r = await new OllamaNarrator(opts(impl)).explain(brief);
    expect(r.fellBack).toBe(false);
    expect(r.tokens).toBe(140);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0]);
    expect(body.format.required).toEqual(["summary"]);       // structured output is requested
    expect(body.options.num_ctx).toBe(8192);                 // context window is set explicitly
  });

  it("retries with feedback when the model invents a number, then succeeds", async () => {
    const bad = JSON.stringify({ summary: "Probability is 0.11. Exposure $12345.67." });
    const good = JSON.stringify({ summary: "Assessment: likely fraud with probability 0.97. Exposure is $1906.07." });
    const { impl, calls } = fakeOllama([bad, good]);
    const r = await new OllamaNarrator(opts(impl)).explain(brief);
    expect(r.fellBack).toBe(false);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]).messages[1].content).toMatch(/rejected/);
  });

  it("stops with a clear error after three bad replies; nothing is written in the model's place", async () => {
    const { impl, calls } = fakeOllama(["not json at all"]);
    await expect(new OllamaNarrator(opts(impl)).sar(brief)).rejects.toThrow(NarratorError);
    expect(calls).toHaveLength(3);
    await expect(new OllamaNarrator(opts(fakeOllama(["not json at all"]).impl)).sar(brief)).rejects.toThrow(/qwen2\.5-coder:7b.*could not write the regulator report/);
  });

  it("stops with a clear error when the server is down, naming the model and where to fix it", async () => {
    const impl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(new OllamaNarrator(opts(impl)).explain(brief)).rejects.toThrow(/LLM_MODEL_OLLAMA in \.env/);
  });

  it("accepts JSON that a cloud model wrapped in a markdown fence", async () => {
    const fenced = "```json\n" + JSON.stringify({ summary: "Assessment: likely fraud with probability 0.97. Exposure is $1906.07." }) + "\n```";
    const r = await new OllamaNarrator(opts(fakeOllama([fenced]).impl)).explain(brief);
    expect(r.text).toMatch(/likely fraud/);
  });

  it("records every model call so the console can show who talked to whom", async () => {
    const good = JSON.stringify({ summary: "Assessment: likely fraud with probability 0.97. Exposure is $1906.07." });
    const n = new OllamaNarrator(opts(fakeOllama([good]).impl));
    await n.explain(brief);
    const log = n.takeLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ from: "Agent", to: "Ollama · qwen2.5-coder:7b", ok: true });
    expect(n.takeLog()).toHaveLength(0);
  });
});
