import type { AgentEvent, CaseSummaryView, InvestigationResult } from "@fraud/shared";

/** Backend base URL. The backend enables CORS, so the browser talks to it directly (this keeps SSE unbuffered). */
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type CaseRow = CaseSummaryView & { verdict?: string; probability?: number };

export interface Health {
  ok: boolean;
  problems?: string[];
  dataset: { dir: string; store?: string; transactions?: number; cards?: number; devices?: number; closed?: number; pack?: number };
  narrator: string;
  narratorModel?: string | null;
  components?: { store: string; graph: string | null; rag: boolean; ollama: { up: boolean; host: string; writer: string | null; writerListed: boolean; embed: string; embedListed: boolean } };
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { cache: "no-store", ...init });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

export const getHealth = () => json<Health>("/api/health");
export const getCases = () => json<CaseRow[]>("/api/cases");

export function postApproval(caseId: string, action: string, decision: "approve" | "reject") {
  return json(`/api/cases/${caseId}/approvals`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, decision, by: "analyst (console)" }),
  });
}

/** Stream one investigation. Returns a function that closes the stream. */
export function streamCase(
  id: string,
  opts: { delay: number },
  on: { step: (e: AgentEvent) => void; result: (r: InvestigationResult) => void; error: (m: string) => void },
): () => void {
  const q = new URLSearchParams({ delay: String(opts.delay) });
  const es = new EventSource(`${API}/api/cases/${id}/stream?${q}`);
  es.addEventListener("step", (m) => on.step(JSON.parse((m as MessageEvent).data)));
  es.addEventListener("result", (m) => { on.result(JSON.parse((m as MessageEvent).data)); es.close(); });
  es.addEventListener("error", (m) => {
    const data = (m as MessageEvent).data;
    if (data) on.error(JSON.parse(data).message);
    else if (es.readyState === EventSource.CLOSED) return;
    else on.error("Lost connection to the backend. Is it running on " + API + "?");
    es.close();
  });
  return () => es.close();
}
