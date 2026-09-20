/**
 * HTTP API for the analyst console.
 *   GET  /api/health
 *   GET  /api/cases                        the case pack, with the last verdict if already investigated
 *   POST /api/cases/:id/investigate        run and return the full result (?reply=denies|confirms|silent overrides the simulator)
 *   GET  /api/cases/:id/stream             Server-Sent Events: every step as it happens, then the result
 *   GET  /api/cases/:id/result             last result
 *   POST /api/cases/:id/approvals          record an L1/L2 approval decision (in memory)
 */
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { CaseSummaryView, InvestigationResult } from "@fraud/shared";
import { InMemoryStore } from "../store/InMemoryStore";
import { openStore } from "../store";
import { OllamaEmbedder } from "../rag/retriever";
import { investigate } from "../agent/orchestrator";
import { narratorFromEnv } from "../llm/narrator";
import { datasetDir } from "../config";

type Q = Record<string, string | undefined>;

export function buildServer(dir = datasetDir()) {
  const store = openStore(undefined, dir);
  const narrator = narratorFromEnv();
  /** GraphRAG is on when the store has vector indexes (TigerGraph) and RAG=1 */
  const rag = process.env.RAG === "1" && store.kind === "tigergraph" ? { embedder: new OllamaEmbedder() } : undefined;
  const results = new Map<string, InvestigationResult>();
  const approvals: { case_id: string; action: string; decision: string; by: string; at: string }[] = [];
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  const find = (id: string) => store.packCases().find((c) => c.caseId === id);

  /** Is Ollama up, and does it have the chosen writer model and the embedding model? Each answer is a real check, not an assumption. */
  const checkOllama = async () => {
    const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
    const embed = process.env.EMBED_MODEL ?? "nomic-embed-text";
    try {
      const j = (await (await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) })).json()) as { models?: { name: string }[] };
      const names = (j.models ?? []).map((m) => m.name);
      const has = (want: string) => names.some((n) => n === want || n.startsWith(want.includes(":") ? want : `${want}:`));
      return { up: true, host, writer: narrator.model ?? null, writerListed: narrator.model ? has(narrator.model) : false, embed, embedListed: has(embed) };
    } catch (e) {
      return { up: false, host, writer: narrator.model ?? null, writerListed: false, embed, embedListed: false, error: (e as Error).message };
    }
  };

  app.get("/api/health", async () => {
    // counts come from the store itself (CSV rows in memory, vertex counts in TigerGraph); a failure must not take the health check down
    let countsError: string | undefined;
    const counts = (await Promise.resolve((store as { stats?: () => unknown }).stats?.()).catch((e: Error) => { countsError = e.message; return undefined; })) as Record<string, number> | undefined;
    const ollama = await checkOllama();
    const problems: string[] = [];
    if (!ollama.up) problems.push(`Ollama is not running at ${ollama.host}. The AI writer cannot work without it.`);
    else {
      if (ollama.writer && !ollama.writerListed) problems.push(`The AI model "${ollama.writer}" is not available in Ollama. Check LLM_MODEL_OLLAMA in .env (or run: ollama pull ${ollama.writer}).`);
      if (rag && !ollama.embedListed) problems.push(`The embedding model "${ollama.embed}" is not in Ollama, so similar-case lookup will not work (ollama pull ${ollama.embed}).`);
    }
    if (store.kind === "tigergraph" && countsError) problems.push(`The TigerGraph database did not answer: ${countsError.slice(0, 120)}. Is the Savanna workspace resumed?`);
    return {
      ok: problems.length === 0,
      problems,
      dataset: { dir, store: store.kind, transactions: 0, cards: 0, devices: 0, closed: 0, pack: store.packCases().length, ...counts },
      narrator: narrator.mode, narratorModel: narrator.model ?? null,
      components: { store: store.kind, graph: store.kind === "tigergraph" ? (process.env.TG_GRAPH ?? "FraudGraph") : null, rag: Boolean(rag), ollama },
    };
  });

  app.get("/api/cases", async () =>
    store.packCases().map((c): CaseSummaryView & { verdict?: string; probability?: number } => {
      const r = results.get(c.caseId)?.answer.case;
      return {
        case_id: c.caseId, opened_at: c.openedAtRaw, trigger_type: c.trigger, trigger_text: c.triggerText, flagged_txn_id: c.flaggedTxnId,
        card_id: c.cardLabel, customer_id: c.customer, risk_score: c.score, verdict: r?.verdict, probability: r?.fraud_probability,
      };
    }));

  app.post<{ Params: { id: string }; Querystring: Q }>("/api/cases/:id/investigate", async (req, reply) => {
    const c = find(req.params.id);
    if (!c) return reply.code(404).send({ error: "unknown case" });
    try {
      const r = await investigate(store, c, { narrator, rag });
      results.set(c.caseId, r);
      return r;
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/cases/:id/result", async (req, reply) => results.get(req.params.id) ?? reply.code(404).send({ error: "not investigated yet" }));

  app.get<{ Params: { id: string }; Querystring: Q }>("/api/cases/:id/stream", async (req, reply) => {
    const c = find(req.params.id);
    if (!c) return reply.code(404).send({ error: "unknown case" });
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const r = await investigate(store, c, {
        narrator, rag, delayMs: Number(req.query.delay ?? 350),
        onEvent: (e) => {
          send("step", e);
        },
      });
      results.set(c.caseId, r);
      send("result", r);
    } catch (e) {
      send("error", { message: (e as Error).message });
    }
    reply.raw.end();
    return reply;
  });

  app.post<{ Params: { id: string }; Body: { action: string; decision: string; by?: string } }>("/api/cases/:id/approvals", async (req) => {
    const rec = { case_id: req.params.id, action: req.body.action, decision: req.body.decision, by: req.body.by ?? "analyst", at: new Date().toISOString() };
    approvals.push(rec);
    return rec;
  });
  app.get("/api/approvals", async () => approvals);
  return app;
}

// run directly: `tsx src/api/server.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 4000);
  buildServer()
    .listen({ port, host: "0.0.0.0" })
    .then(() => console.log(`fraud-agent backend on http://localhost:${port} (dataset ${datasetDir()})`));
}
