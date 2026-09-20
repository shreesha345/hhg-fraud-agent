/**
 * GraphRAG retrieval: vector search finds passages by meaning (closed-case notes, policy, FinCEN guidance); the graph then
 * says how retrieved cases connect (their cards, transactions, device profiles). The result is a compact, CITED context the
 * narrator receives alongside the evidence ledger. Retrieval never changes a probability or an action: the engines decide.
 */
import type { Comm } from "@fraud/shared";
import type { GraphStore, RagClosedHit, RagPolicyHit } from "../store/GraphStore";

export interface Embedder { embed(text: string): Promise<number[]>; takeLog?(): Comm[] }

/** nomic-embed-text through a local Ollama. Queries use the model's "search_query:" prefix. */
export class OllamaEmbedder implements Embedder {
  constructor(private readonly host = process.env.OLLAMA_HOST ?? "http://localhost:11434", private readonly model = process.env.EMBED_MODEL ?? "nomic-embed-text") {}
  private log: Comm[] = [];
  takeLog(): Comm[] { const l = this.log; this.log = []; return l; }
  async embed(text: string): Promise<number[]> {
    const t0 = performance.now();
    const res = await fetch(`${this.host}/api/embed`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.model, input: `search_query: ${text.slice(0, 2000)}` }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`embedding request failed: ${res.status}`);
    const j = (await res.json()) as { embeddings?: number[][] };
    if (!j.embeddings?.[0]) throw new Error("embedding response had no vector");
    this.log.push({ from: "Agent", to: `Ollama · ${this.model}`, what: "turn text into a vector (find similar past cases)", ms: Math.round(performance.now() - t0), ok: true });
    return j.embeddings[0];
  }
}

export interface RagPassage { ref: string; kind: "closed_case" | "policy" | "regulatory"; text: string; distance: number }
export interface RagContext {
  passages: RagPassage[];
  closed: RagClosedHit[];
  policy: RagPolicyHit[];
  /** rendered, cited text within the character budget */
  text: string;
}

export interface RagOptions { embedder: Embedder; kClosed?: number; kPolicy?: number; charBudget?: number }

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "...");

/** Retrieve by meaning, expand along the graph, and render a cited context. `query` describes the case in plain words. */
export async function retrieve(store: GraphStore, opts: RagOptions, query: string, asOf: number, extraPolicyQuery?: string): Promise<RagContext> {
  const { kClosed = 5, kPolicy = 3, charBudget = 4000 } = opts;
  if (!store.semanticClosedCases || !store.semanticPolicy) throw new Error("this store has no vector index (GraphRAG needs the TigerGraph store)");
  const [qv, pv] = await Promise.all([opts.embedder.embed(query), opts.embedder.embed(extraPolicyQuery ?? query)]);
  const [closed, policy] = await Promise.all([store.semanticClosedCases(qv, asOf, kClosed), store.semanticPolicy(pv, kPolicy)]);
  const passages: RagPassage[] = [
    ...closed.map((h): RagPassage => ({
      ref: h.case.caseId, kind: "closed_case", distance: h.distance,
      text: `${h.case.outcome === "confirmed_fraud" ? "confirmed fraud" : "cleared"}${h.case.pattern && h.case.pattern !== "none" ? `, pattern ${h.case.pattern}` : ""}. ${clip(h.case.notes.replace(/^Case CC-[\w-]+:\s*/, ""), 260)}` +
        `${h.nTxns ? ` Involved ${h.nTxns} transaction(s)` : ""}${h.devices.length ? ` on ${h.devices.length} device profile(s)` : ""}${h.cards.length ? `; cards ${h.cards.slice(0, 3).join(", ")}` : ""}.`,
    })),
    ...policy.map((h): RagPassage => ({ ref: h.id, kind: h.id.startsWith("doc:") ? "regulatory" : "policy", distance: h.distance, text: `${h.title}: ${clip(h.text.replace(/\s+/g, " "), 420)}` })),
  ];
  let text = "", used = 0;
  for (const p of passages) {
    const line = `[${p.ref}] ${p.text}\n`;
    if (used + line.length > charBudget) break;
    text += line; used += line.length;
  }
  return { passages, closed, policy, text: text.trim() };
}

/** A plain-words description of the case for the embedding query: what was found, not who the customer is. */
export function describeCase(parts: { trigger: string; triggerText: string; claims: string[]; pattern: string }): string {
  return [`${parts.trigger.replace(/_/g, " ")}: ${parts.triggerText}`, ...parts.claims.slice(0, 6), parts.pattern !== "none" ? `pattern ${parts.pattern.replace(/_/g, " ")}` : ""].filter(Boolean).join(". ");
}
