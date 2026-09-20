/**
 * The LLM layer. Exactly two model calls exist in the decision path: `explain` and `sar`
 * (the third, "plan next evidence", is deterministic in v0; see CLAUDE.md section 11).
 *
 *  - The LLM only PHRASES. It receives a compact brief of already-decided facts and cannot add actions,
 *    routes, exposure or IDs. Every reply is checked; failures retry, and if the model still cannot produce a valid text the
 *    case STOPS with a clear error. Nothing is ever written in the model's place.
 *  - OllamaNarrator talks to Ollama (a cloud model such as gemma4:31b-cloud, or a local one), chosen in .env (LLM_MODEL_OLLAMA).
 *  - DecisionOnlyNarrator writes no text at all; it exists for analysis runs (the backtest) that only look at decisions.
 */
import { z } from "zod";
import type { ActionItem, Comm, EvidenceItem, Pattern, Verdict } from "@fraud/shared";

export interface Brief {
  caseId: string;
  customer: string;
  cardLabel: string;
  trigger: string;
  verdict: Verdict;
  pattern: Pattern;
  patternDescription: string;
  probability: number;
  exposure: number;
  affected: { id: string; amt: number; ts: string; channel: string; region: number | null }[];
  connectedCards: string[];
  devices: string[];
  evidence: EvidenceItem[];
  initial: ActionItem[];
  final: ActionItem[];
  whatChanged: string;
  rules: string[];
  fileReport: boolean;
  activityDates: [string, string] | [];
  subjects: string[];
  openQuestions: string[];
  /** GraphRAG context: cited passages (similar closed cases, policy, regulatory guidance) retrieved by meaning; for the LLM to phrase from, never to decide from */
  context?: string;
}

export interface NarrationResult { text: string; tokens: number; fellBack: boolean; model?: string; /** why the model output was not used, when it fell back */ note?: string }
export interface Narrator {
  readonly mode: "template" | "ollama" | "none";
  /** the model doing the writing, when there is one */
  readonly model?: string;
  explain(b: Brief): Promise<NarrationResult>;
  sar(b: Brief): Promise<NarrationResult>;
  /** calls made since the last time this was read (for the "who talked to whom" view) */
  takeLog?(): Comm[];
}

const sentences = (t: string): string[] => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
/** A claim may contain its own full stops; inside a composed sentence they become semicolons so sentence counts stay honest. */
const oneSentence = (t: string): string => t.trim().replace(/[.!?]+\s+/g, "; ").replace(/[.!?]+$/, "");
const usd = (n: number): string => `$${n.toFixed(2)}`;
const list = (a: string[]): string => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

// ------------------------------------------------------------------ checks used on model output
/** Numbers as values, so "$100.00" in prose matches 100 in the brief. */
const nums = (t: string): Set<string> => new Set((t.match(/\d+(?:\.\d+)?/g) ?? []).map((x) => String(Number(x))));

export function checkExplain(text: string, b: Brief): string | null {
  const n = sentences(text).length;
  if (n < 2 || n > 6) return `summary must be 2 to 6 sentences, got ${n}`;
  const allowed = nums(JSON.stringify(b));
  for (const x of nums(text)) if (!allowed.has(x)) return `number ${x} is not in the brief`;
  return null;
}

export function checkSar(text: string, b: Brief): string | null {
  const n = sentences(text).length;
  if (n < 6 || n > 12) return `narrative must be 6 to 12 sentences, got ${n}`;
  const allowed = nums(JSON.stringify(b));
  for (const x of nums(text)) if (!allowed.has(x)) return `number ${x} is not in the brief`;
  for (const s of b.subjects.slice(0, 3)) if (!text.includes(s)) return `subject ${s} is missing from the narrative`;
  return null;
}

// ------------------------------------------------------------------ local Ollama
/** Models differ: some honour Ollama's structured output, others (the cloud ones) wrap the JSON in a markdown fence or add a sentence around it. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* try the tolerant paths */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ } }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("the model did not return JSON");
}

export interface OllamaOptions { host: string; model: string; numCtx: number; timeoutMs?: number; fetchImpl?: typeof fetch }

export class OllamaNarrator implements Narrator {
  readonly mode = "ollama" as const;
  private log: Comm[] = [];
  constructor(private o: OllamaOptions) {}
  get model(): string { return this.o.model; }
  takeLog(): Comm[] { const l = this.log; this.log = []; return l; }

  private async ask(system: string, user: string, key: "summary" | "narrative"): Promise<{ text: string; tokens: number }> {
    const f = this.o.fetchImpl ?? fetch;
    const res = await f(`${this.o.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
      body: JSON.stringify({
        model: this.o.model, stream: false, options: { temperature: 0.1, num_ctx: this.o.numCtx },
        format: { type: "object", properties: { [key]: { type: "string" } }, required: [key] },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const j = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    const parsed = z.object({ [key]: z.string().min(1) }).parse(extractJson(j.message?.content ?? "")) as Record<string, string>;
    return { text: parsed[key], tokens: (j.prompt_eval_count ?? 0) + (j.eval_count ?? 0) };
  }

  private async run(kind: "explain" | "sar", b: Brief): Promise<NarrationResult> {
    const key = kind === "explain" ? "summary" : "narrative";
    const check = kind === "explain" ? checkExplain : checkSar;
    const system = kind === "explain"
      ? "You write a 2 to 6 sentence case summary for a fraud analyst. Use ONLY the facts in the JSON brief. Do not invent numbers, IDs or actions. Return JSON {\"summary\": string}."
      : "You write a suspicious activity report narrative of 6 to 12 sentences answering who, what, when, where, how and why it is suspicious. Use ONLY the facts in the JSON brief; mention each subject ID. Do not invent numbers or IDs. Return JSON {\"narrative\": string}.";
    let tokens = 0, feedback = "", lastProblem = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const t0 = performance.now();
        const r = await this.ask(system, JSON.stringify(b) + feedback, key);
        tokens += r.tokens;
        this.log.push({ from: "Agent", to: `Ollama · ${this.o.model}`, what: kind === "explain" ? "write the summary" : "write the regulator report", ms: Math.round(performance.now() - t0), ok: true });
        const problem = check(r.text, b);
        if (!problem) return { text: r.text, tokens, fellBack: false, model: this.o.model };
        lastProblem = `rejected: ${problem}`;
        feedback = `\n\nYour previous answer was rejected: ${problem}. Fix it and answer again.`;
      } catch (e) {
        this.log.push({ from: "Agent", to: `Ollama · ${this.o.model}`, what: `${kind === "explain" ? "write the summary" : "write the regulator report"} (failed: ${(e as Error).message.slice(0, 60)})`, ms: 0, ok: false });
        lastProblem = (e as Error).message;
        feedback = `\n\nYour previous answer could not be used (${(e as Error).message}). Return valid JSON.`;
      }
    }
    throw new NarratorError(`The AI model (${this.o.model}) could not write the ${kind === "explain" ? "summary" : "regulator report"} after 3 tries: ${lastProblem}. ` +
      "Check that Ollama is running and that LLM_MODEL_OLLAMA in .env names a model you can use. Nothing was written in its place.");
  }

  explain(b: Brief): Promise<NarrationResult> { return this.run("explain", b); }
  sar(b: Brief): Promise<NarrationResult> { return this.run("sar", b); }
}

export class NarratorError extends Error {
  constructor(message: string) { super(message); this.name = "NarratorError"; }
}

/** Writes no text. For analysis runs (the backtest) that only look at the agent's decisions, never for a case that is delivered. */
export class DecisionOnlyNarrator implements Narrator {
  readonly mode = "none" as const;
  async explain(): Promise<NarrationResult> { return { text: "", tokens: 0, fellBack: false }; }
  async sar(): Promise<NarrationResult> { return { text: "", tokens: 0, fellBack: false }; }
}

/** The writer is always an AI model, chosen in .env. There is no template mode. */
export function narratorFromEnv(env: NodeJS.ProcessEnv = process.env): Narrator {
  const model = env.LLM_MODEL_OLLAMA?.trim();
  if (!model) throw new NarratorError("LLM_MODEL_OLLAMA is not set. Put the name of the Ollama model that should write the text in .env (for example gemma4:31b-cloud).");
  return new OllamaNarrator({
    host: env.OLLAMA_HOST ?? "http://localhost:11434", model, numCtx: Number(env.OLLAMA_NUM_CTX ?? 8192), timeoutMs: Number(env.LLM_TIMEOUT_S ?? 120) * 1000,
  });
}
