/**
 * GraphStore backed by TigerGraph. Every read is an installed GSQL query (gsql/queries.gsql.tmpl) run through the
 * TigerGraph MCP server (`tigergraph-mcp`, a stdio sidecar), so the agent's tool calls are MCP tool calls.
 *
 * The no-look-ahead contract is enforced inside the queries: every one takes as_of (epoch seconds) and filters edges and
 * closed cases by it. The exact same test-suite that proves the InMemoryStore is run against this class (STORE=tigergraph).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Comm } from "@fraud/shared";
import type { CardLabel, ClosedCase, PackCase, Txn } from "../domain/types";
import { ROOT } from "../config";
import type { CaseWrite, ClosedCaseFilter, ContagionResult, DeviceStats, GraphStore, RagClosedHit, RagPolicyHit } from "./GraphStore";
import { loadPack } from "./pack";

export interface TigerGraphOptions {
  graph: string;
  datasetDir: string;
  /** command that starts the MCP server; the default runs py/scripts/tg_mcp_launcher.py, which fetches a fresh JWT from TG_SECRET */
  command?: string;
  args?: string[];
  /** Python executable to use; defaults to py/.venv/Scripts/python.exe on Windows */
  pythonExe?: string;
}

type Json = Record<string, unknown>;
const FAR_FUTURE = 4_102_444_800; // 2100-01-01 in epoch seconds
const secs = (ms: number): number => (Number.isFinite(ms) ? Math.min(FAR_FUTURE, Math.floor(ms / 1000)) : FAR_FUTURE);
/** query attribute keys come back as "X.ts" or "S.@profile": drop the alias */
const attrs = (v: { attributes?: Json }): Json => Object.fromEntries(Object.entries(v.attributes ?? {}).map(([k, x]) => [k.replace(/^[A-Za-z0-9_]+\./, "").replace(/^@/, ""), x]));
const vtx = (type: string, id: string) => ({ id, type });
const familyOf = (profile: string): string => (profile.split(" | ")[0] || "?").split(/[-_ ]/)[0] || "?";

export class TigerGraphStore implements GraphStore {
  readonly kind = "tigergraph" as const;
  calls = 0;
  private log: Comm[] = [];
  takeLog(): Comm[] { const l = this.log; this.log = []; return l; }
  private client?: Client;
  private connecting?: Promise<Client>;
  private connectedAt = 0;
  private readonly pack: PackCase[];
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly txnCache = new Map<string, Txn>();
  private readonly labels = new Map<string, CardLabel>();
  private readonly aliasToKey = new Map<string, string | undefined>();

  constructor(private readonly opts: TigerGraphOptions) {
    this.pack = loadPack(opts.datasetDir);
  }

  // ---------------------------------------------------------------- MCP plumbing
  private async connect(): Promise<Client> {
    // a JWT lives one hour: reconnect (the launcher fetches a fresh one) well before that
    if (this.client && Date.now() - this.connectedAt < 45 * 60_000) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.client?.close().catch(() => undefined);
      // Use Python directly from .venv to avoid "uv run" dependency installation on every launch
      const defaultPython = process.platform === "win32" ? "py\\.venv\\Scripts\\python.exe" : "py/.venv/bin/python";
      const python = this.opts.pythonExe ?? defaultPython;
      const transport = new StdioClientTransport({
        command: this.opts.command ?? python,
        args: this.opts.args ?? ["py/scripts/tg_mcp_launcher.py", this.opts.graph],
        cwd: ROOT, stderr: "pipe",
      });
      // Listen for stderr to diagnose connection issues
      transport.stderr?.on('data', (data) => {
        console.error('[TigerGraph MCP stderr]:', data.toString());
      });
      const c = new Client({ name: "fraud-agent", version: "0.1.0" });
      await c.connect(transport);
      this.client = c;
      this.connectedAt = Date.now();
      return c;
    })().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = undefined;
  }

  /** Call an MCP tool and unwrap the ```json block its text result carries. */
  private async tool(name: string, args: Json): Promise<{ success: boolean; data?: Json; summary?: string }> {
    this.calls++;
    const t0 = performance.now();
    const label = name === "run_installed_query" ? String(args.query_name) : name;
    const done = (ok: boolean) => this.log.push({ from: "Agent", to: "TigerGraph · via the MCP server", what: label, ms: Math.round(performance.now() - t0), ok });
    for (let attempt = 0; ; attempt++) {
      try {
        const c = await this.connect();
        const r = (await c.callTool({ name: `tigergraph__${name}`, arguments: { graph_name: this.opts.graph, ...args } })) as { content?: Array<{ text?: string }> };
        const text = r.content?.[0]?.text ?? "";
        const m = /```json\n([\s\S]*?)\n```/.exec(text);
        const out = JSON.parse(m ? m[1] : text) as { success: boolean; data?: Json; summary?: string };
        if (!out.success && /expired|unauthori|401|token/i.test(out.summary ?? "") && attempt === 0) { this.connectedAt = 0; continue; }
        done(out.success);
        return out;
      } catch (e) {
        if (attempt >= 2) { done(false); throw e; }
        this.connectedAt = 0; // dead sidecar or stale session: reconnect and retry
      }
    }
  }

  /** Run an installed query. Returns the array of PRINT blocks, or null when the query failed (for example a vertex that does not exist). */
  private async query(name: string, params: Json): Promise<Json[] | null> {
    const key = `${name}:${JSON.stringify(params)}`;
    const hit = this.cache.get(key) as Promise<Json[] | null> | undefined;
    if (hit) return hit;
    const p = this.tool("run_installed_query", { query_name: name, params }).then((r) => {
      if (r.success) return (r.data?.result as Json[]) ?? [];
      // a vertex that does not exist is a legitimate "nothing here"; anything else is a failure and must not look like an empty answer
      if (/convert user vertex id|not a valid vertex id|does not exist/i.test(r.summary ?? "")) return null;
      throw new Error(`TigerGraph query ${name} failed: ${r.summary}`);
    });
    this.cache.set(key, p);
    p.catch(() => this.cache.delete(key)); // never cache a failure
    return p;
  }

  // ---------------------------------------------------------------- mapping
  private txnFrom(v: { v_id: string; attributes?: Json }, cardKey?: string): Txn {
    const a = attrs(v) as Record<string, any>;
    const key: string = cardKey ?? (a.card_id as string);
    const [customer, card4, card6] = key.split("|");
    const profile = (a.profile as string) || "";
    const region = Number(a.region);
    const t: Txn = {
      id: v.v_id, customer, cardKey: key, ts: Number(a.ts) * 1000, channel: a.channel === "online" ? "online" : "in_person", score: Number(a.score),
      amt: Number(a.amt), prod: String(a.prod), region: region < 0 ? null : region, card4, card6,
      dev: profile ? { profile, family: familyOf(profile), isNew: Boolean(a.is_new), proxy: (a.proxy as string) || "" } : undefined,
    };
    this.txnCache.set(t.id, t);
    return t;
  }

  private closedFrom(v: { v_id: string; attributes?: Json }): ClosedCase {
    const a = attrs(v) as Record<string, any>;
    return {
      caseId: v.v_id, customer: a.customer, cardLabel: a.card_label, openedAt: Number(a.opened_ts) * 1000, closedAt: Number(a.closed_ts) * 1000,
      outcome: a.outcome === "confirmed_fraud" ? "confirmed_fraud" : "cleared", pattern: a.pattern, txnIds: [], exposure: Number(a.exposure || 0),
      connectedLabels: [], actions: String(a.actions || "").split("|").filter(Boolean), notes: a.notes || "",
    };
  }

  // ---------------------------------------------------------------- GraphStore
  async getTxns(ids: string[]): Promise<Map<string, Txn>> {
    const out = new Map<string, Txn>();
    const need = [...new Set(ids)].filter((id) => { const t = this.txnCache.get(id); if (t) out.set(id, t); return !t; });
    for (let i = 0; i < need.length; i += 200) {
      const r = await this.query("get_txns", { ids: need.slice(i, i + 200).map((id) => vtx("Transaction", id)) });
      for (const v of ((r?.[0]?.txns as Array<{ v_id: string; attributes?: Json }>) ?? [])) { const t = this.txnFrom(v); out.set(t.id, t); }
    }
    return out;
  }

  async getTxn(id: string): Promise<Txn | undefined> {
    return (await this.getTxns([id])).get(id);
  }

  async cardTxns(cardKey: string, asOf: number): Promise<Txn[]> {
    const r = await this.query("card_history", { card: vtx("BankCard", cardKey), as_of: secs(asOf) });
    const list = ((r?.[0]?.txns as Array<{ v_id: string; attributes?: Json }>) ?? []).map((v) => this.txnFrom(v, cardKey));
    return list.sort((a, b) => a.ts - b.ts || Number(a.id) - Number(b.id));
  }

  async cardVolume(cardKey: string, asOf: number): Promise<number> {
    const r = await this.query("card_volume", { card: vtx("BankCard", cardKey), as_of: secs(asOf) });
    return Number(r?.[0]?.n ?? 0);
  }

  async deviceStats(profile: string, asOf: number): Promise<DeviceStats> {
    const r = await this.query("device_stats", { prof: vtx("DeviceProfile", profile), as_of: secs(asOf) });
    const head = (r?.[0] ?? {}) as Record<string, number>;
    const tail = (r?.[1] ?? {}) as { last_by_card?: Record<string, number>; blocked?: string[] };
    const n = Math.max(1, Number(head.txns ?? 0));
    return {
      profile, users: Number(head.users ?? 0), txns: Number(head.txns ?? 0), newShare: Number(head.news ?? 0) / n, anonProxyShare: Number(head.anon ?? 0) / n,
      lastByCard: new Map(Object.entries(tail.last_by_card ?? {}).map(([k, v]) => [k, Number(v) * 1000])), blocked: new Set(tail.blocked ?? []),
    };
  }

  async deviceExists(profile: string): Promise<boolean> {
    const r = await this.tool("has_node", { vertex_type: "DeviceProfile", vertex_id: profile });
    return r.success && Boolean(r.data?.exists);
  }

  private async cardsOf(customer: string): Promise<Array<{ key: string; label: CardLabel }>> {
    const r = await this.query("customer_cards", { cust: vtx("Customer", customer) });
    const cards = ((r?.[0]?.cards as Array<{ v_id: string; attributes?: Json }>) ?? []).map((v) => ({ key: v.v_id, label: { label: String(attrs(v).label), derived: Boolean(attrs(v).label_derived) } }));
    for (const c of cards) this.labels.set(c.key, c.label);
    return cards;
  }

  async customerCards(customer: string): Promise<string[]> {
    return (await this.cardsOf(customer)).map((c) => c.key);
  }

  async closedCases(asOf: number, filter: ClosedCaseFilter = {}): Promise<ClosedCase[]> {
    const r = await this.query("closed_cases_by", { as_of: secs(asOf), pat: filter.pattern ?? "", outc: filter.outcome ?? "" });
    return ((r?.[0]?.cases as Array<{ v_id: string; attributes?: Json }>) ?? []).map((v) => this.closedFrom(v)).sort((a, b) => a.openedAt - b.openedAt || (a.caseId < b.caseId ? -1 : 1));
  }

  async closedCasesOnDevices(profiles: string[], asOf: number, requireNew: boolean): Promise<ClosedCase[]> {
    if (!profiles.length) return [];
    const r = await this.query("cases_on_devices", { profiles: profiles.map((p) => vtx("DeviceProfile", p)), as_of: secs(asOf), require_new: requireNew });
    return ((r?.[0]?.cases as Array<{ v_id: string; attributes?: Json }>) ?? []).map((v) => this.closedFrom(v));
  }

  async closedCaseExists(caseId: string): Promise<boolean> {
    const r = await this.query("closed_case_exists", { cid: caseId });
    return Number(r?.[0]?.n ?? 0) > 0;
  }

  packCases(): PackCase[] {
    return this.pack;
  }

  async resolveLabel(label: string): Promise<string | undefined> {
    if (!this.aliasToKey.has(label)) {
      const r = await this.query("card_by_label", { lbl: label });
      const hit = (r?.[0]?.cards as Array<{ v_id: string }> | undefined)?.[0];
      this.aliasToKey.set(label, hit?.v_id);
    }
    return this.aliasToKey.get(label);
  }

  async labelFor(cardKey: string): Promise<CardLabel> {
    if (!this.labels.has(cardKey)) await this.cardsOf(cardKey.split("|")[0]);
    return this.labels.get(cardKey) ?? { label: `${cardKey.split("|")[0]}-K1`, derived: true };
  }

  async latestTs(): Promise<number> {
    const r = await this.query("latest_ts", {});
    return Number(r?.[0]?.latest ?? 0) * 1000;
  }

  async contagionSweep(asOf: number, top: number): Promise<ContagionResult> {
    const r = await this.query("contagion_sweep", { as_of: secs(asOf), iters: 5, top });
    const b = (r?.[0] ?? {}) as { seeds?: number; top_devices?: Array<{ id: string; rank: number; info: string }> };
    return { seeds: Number(b.seeds ?? 0), devices: (b.top_devices ?? []).map((d) => ({ profile: d.id, score: Number(d.rank), users: Number(d.info) })) };
  }

  private statsCache?: Promise<{ transactions: number; cards: number; devices: number; closed: number; pack: number }>;

  /** Vertex counts for the health check; fetched once (four MCP calls) and cached. */
  stats(): Promise<{ transactions: number; cards: number; devices: number; closed: number; pack: number }> {
    this.statsCache ??= (async () => {
      const count = async (type: string): Promise<number> => Number(((await this.tool("get_vertex_count", { vertex_type: type })).data as { count?: number } | undefined)?.count ?? 0);
      const [transactions, cards, devices, closed] = await Promise.all([count("Transaction"), count("BankCard"), count("DeviceProfile"), count("ClosedCase")]);
      return { transactions, cards, devices, closed, pack: this.pack.length };
    })();
    this.statsCache.catch(() => { this.statsCache = undefined; });
    return this.statsCache;
  }

  // ---------------------------------------------------------------- GraphRAG (I): vector search + graph expansion
  async semanticClosedCases(vec: number[], asOf: number, k: number): Promise<RagClosedHit[]> {
    const r = await this.query("rag_closed_cases", { qv: vec, as_of: secs(asOf), k });
    const found = (r?.[0]?.cases as Array<{ v_id: string; attributes?: Json }>) ?? [];
    if (!found.length) return [];
    const dist = (r?.[1]?.distance as Record<string, number>) ?? {};
    const top = found.map((v) => ({ v, d: Number(dist[v.v_id] ?? 1) })).sort((a, b) => a.d - b.d).slice(0, k);
    const ex = await this.query("rag_expand", { cs: top.map((t) => vtx("ClosedCase", t.v.v_id)) });
    const expansion = new Map(((ex?.[0]?.expansion as Array<{ v_id: string; attributes?: Json }>) ?? []).map((e) => [e.v_id, attrs(e) as { cards?: string[]; ntx?: number }]));
    const devs = (ex?.[1]?.devices as Record<string, string[]>) ?? {};
    return top.map(({ v, d }) => ({
      case: this.closedFrom(v), distance: d, cards: expansion.get(v.v_id)?.cards ?? [], nTxns: Number(expansion.get(v.v_id)?.ntx ?? 0), devices: devs[v.v_id] ?? [],
    }));
  }

  private policyHits(r: Json[] | null): RagPolicyHit[] {
    const dist = (r?.[1]?.distance as Record<string, number>) ?? {};
    return ((r?.[0]?.chunks as Array<{ v_id: string; attributes?: Json }>) ?? []).map((v) => {
      const a = attrs(v) as Record<string, string>;
      return { id: v.v_id, title: a.title, doc: a.doc, text: a.text, distance: Number(dist[v.v_id] ?? 0) };
    });
  }

  async semanticPolicy(vec: number[], k: number): Promise<RagPolicyHit[]> {
    return this.policyHits(await this.query("rag_policy", { qv: vec, k })).sort((a, b) => a.distance - b.distance);
  }

  async policyChunks(ids: string[]): Promise<RagPolicyHit[]> {
    if (!ids.length) return [];
    return this.policyHits(await this.query("rag_policy_by_id", { ids: ids.map((id) => vtx("PolicyChunk", id)) }));
  }

  // ---------------------------------------------------------------- write-back (H)
  private async upsertNodes(type: string, vertices: Json[]): Promise<void> {
    if (!vertices.length) return;
    const r = await this.tool("add_nodes", { vertex_type: type, vertex_id: "id", vertices });
    if (!r.success) throw new Error(`add_nodes ${type} failed: ${r.summary}`);
  }

  private async upsertEdges(type: string, from: string, to: string, pairs: Array<[string, string]>): Promise<void> {
    if (!pairs.length) return;
    const r = await this.tool("add_edges", { edge_type: type, edges: pairs.map(([s, t]) => ({ source_id: s, target_id: t, source_type: from, target_type: to })) });
    if (!r.success) throw new Error(`add_edges ${type} failed: ${r.summary}`);
  }

  /** Writes FraudCase, Evidence and Action vertices and their edges. Upserts, so re-running a case updates it. */
  async writeCase(w: CaseWrite): Promise<string> {
    const id = `FC-${w.caseId}`;
    await this.upsertNodes("FraudCase", [{ id, case_id: w.caseId, status: w.status, verdict: w.verdict, probability: w.probability, pattern: w.pattern, exposure: w.exposure, summary: w.summary, opened_ts: Math.floor(w.openedAt / 1000) }]);
    const ev = w.evidence.map((e, i) => ({ id: `EV-${w.caseId}-${i + 1}`, claim: e.claim, source: e.source, ref: e.ref, klass: e.klass }));
    const ac = w.actions.map((a, i) => ({ id: `AC-${w.caseId}-${a.stage}-${i + 1}`, action: a.action, route: a.route, stage: a.stage, reason: a.reason }));
    await Promise.all([this.upsertNodes("Evidence", ev), this.upsertNodes("Action", ac), w.pattern !== "none" ? this.upsertNodes("Pattern", [{ id: w.pattern }]) : Promise.resolve()]);
    const cites: Array<[string, string]> = w.evidence.flatMap((e, i) => e.txnIds.map((t): [string, string] => [`EV-${w.caseId}-${i + 1}`, t]));
    await Promise.all([
      this.upsertEdges("INVOLVES", "FraudCase", "Transaction", w.affectedTxnIds.map((t) => [id, t])),
      this.upsertEdges("CASE_ON_CARD", "FraudCase", "BankCard", [[id, w.cardKey]]),
      this.upsertEdges("CASE_CONNECTED_TO", "FraudCase", "BankCard", w.connectedCardKeys.map((k) => [id, k])),
      this.upsertEdges("CASE_SUSPECTS", "FraudCase", "DeviceProfile", w.deviceProfiles.map((d) => [id, d])),
      this.upsertEdges("CASE_MATCHES", "FraudCase", "Pattern", w.pattern !== "none" ? [[id, w.pattern]] : []),
      this.upsertEdges("RETRIEVED", "FraudCase", "ClosedCase", w.similarClosedCases.map((c) => [id, c])),
      this.upsertEdges("HAS_EVIDENCE", "FraudCase", "Evidence", ev.map((e) => [id, e.id as string])),
      this.upsertEdges("CITES", "Evidence", "Transaction", cites),
      this.upsertEdges("RECOMMENDS", "FraudCase", "Action", ac.map((a) => [id, a.id as string])),
    ]);
    return id;
  }
}
