/**
 * In-memory implementation of the graph store, loaded from slim CSVs (the same schema as Dataset/test and
 * the output of py/scripts/export_slim.py). It lets the whole agent run and be tested without TigerGraph.
 *
 * Every read that can return history takes `asOf` and NEVER returns anything later. That is the
 * no-look-ahead guarantee; the TigerGraph store must offer the identical contract (see store/GraphStore.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type { ClosedCaseFilter, DeviceStats, GraphStore } from "./GraphStore";
import { loadPack } from "./pack";
import { ms, type CardLabel, type ClosedCase, type DeviceInfo, type PackCase, type Txn } from "../domain/types";

type Row = Record<string, string>;
const readCsv = (path: string): Row[] => parse(readFileSync(path), { columns: true, skip_empty_lines: true, relax_column_count: true }) as Row[];
const num = (s: string | undefined): number | null => (s === undefined || s === "" || s === "nan" || s === "NaN" ? null : Number(s));

/** Largest index i such that arr[i].ts <= t, +1 (i.e. the exclusive upper bound). */
function upperBound(arr: Txn[], t: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ts <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export class InMemoryStore implements GraphStore {
  /** number of store reads; surfaced as `tool_calls` in the answer file */
  calls = 0;
  private byId = new Map<string, Txn>();
  private byCard = new Map<string, Txn[]>();
  private byProfile = new Map<string, Txn[]>();
  private cardsOfCustomer = new Map<string, Set<string>>();
  private closed: ClosedCase[] = [];
  private pack: PackCase[] = [];
  private aliasToKey = new Map<string, string>();
  private keyToAlias = new Map<string, string>();
  readonly dir: string;

  private constructor(dir: string) {
    this.dir = dir;
  }

  static load(dir: string): InMemoryStore {
    const s = new InMemoryStore(dir);
    const devById = new Map<string, DeviceInfo>();
    for (const r of readCsv(join(dir, "identity.csv"))) {
      const info = r.DeviceInfo || "?";
      devById.set(r.TransactionID, {
        profile: `${r.DeviceInfo || "?"} | ${r.id_30 || "?"} | ${r.id_31 || "?"} | ${r.id_33 || "?"}`,
        family: info.split(/[-_ ]/)[0] || "?",
        isNew: r.id_15 === "New",
        proxy: r.id_23 || "",
      });
    }
    for (const r of readCsv(join(dir, "transactions.csv"))) {
      const card4 = r.card4 || "~", card6 = r.card6 || "~";
      const t: Txn = {
        id: r.TransactionID, customer: r.customer_id, cardKey: `${r.customer_id}|${card4}|${card6}`,
        ts: ms(r.ts), channel: r.channel === "online" ? "online" : "in_person", score: Number(r.risk_score),
        amt: Number(r.TransactionAmt), prod: r.ProductCD, region: num(r.addr1), card4, card6, dev: devById.get(r.TransactionID),
      };
      s.byId.set(t.id, t);
      (s.byCard.get(t.cardKey) ?? s.byCard.set(t.cardKey, []).get(t.cardKey)!).push(t);
      if (t.dev) (s.byProfile.get(t.dev.profile) ?? s.byProfile.set(t.dev.profile, []).get(t.dev.profile)!).push(t);
      (s.cardsOfCustomer.get(t.customer) ?? s.cardsOfCustomer.set(t.customer, new Set()).get(t.customer)!).add(t.cardKey);
    }
    for (const list of s.byCard.values()) list.sort((a, b) => a.ts - b.ts || Number(a.id) - Number(b.id));
    for (const list of s.byProfile.values()) list.sort((a, b) => a.ts - b.ts);

    for (const r of readCsv(join(dir, "closed_cases_history.csv"))) {
      s.closed.push({
        caseId: r.case_id, customer: r.customer_id, cardLabel: r.card_id, openedAt: ms(r.opened_at), closedAt: ms(r.closed_at),
        outcome: r.outcome === "confirmed_fraud" ? "confirmed_fraud" : "cleared", pattern: r.pattern,
        txnIds: (r.txn_ids || "").split("|").filter(Boolean), exposure: Number(r.exposure_usd || 0),
        connectedLabels: (r.connected_card_ids || "").split("|").filter(Boolean),
        actions: (r.actions_taken || "").split("|").filter(Boolean), notes: r.analyst_notes || "",
      });
    }
    s.closed.sort((a, b) => a.openedAt - b.openedAt);
    s.pack = loadPack(dir);
    s.buildAliases();
    return s;
  }

  /** K labels are not derivable from card fields, so learn them from closed cases and the case pack. */
  private buildAliases(): void {
    const bind = (label: string, txnId: string | undefined) => {
      const t = txnId ? this.byId.get(txnId) : undefined;
      if (!t || this.aliasToKey.has(label)) return;
      this.aliasToKey.set(label, t.cardKey);
      this.keyToAlias.set(t.cardKey, label);
    };
    for (const c of this.closed) bind(c.cardLabel, c.txnIds[0]);
    for (const p of this.pack) bind(p.cardLabel, p.flaggedTxnId);
  }

  // -------------------------------------------------------------- reads (all as-of safe, all asynchronous like the TigerGraph store)
  readonly kind = "memory" as const;

  async getTxn(id: string): Promise<Txn | undefined> {
    this.calls++;
    return this.byId.get(id);
  }

  async getTxns(ids: string[]): Promise<Map<string, Txn>> {
    this.calls++;
    const out = new Map<string, Txn>();
    for (const id of ids) { const t = this.byId.get(id); if (t) out.set(id, t); }
    return out;
  }

  async cardTxns(cardKey: string, asOf: number): Promise<Txn[]> {
    this.calls++;
    const all = this.byCard.get(cardKey) ?? [];
    return all.slice(0, upperBound(all, asOf));
  }

  async cardVolume(cardKey: string, asOf: number): Promise<number> {
    const all = this.byCard.get(cardKey) ?? [];
    return upperBound(all, asOf);
  }

  /** Everything about a device profile as it was known at `asOf`. */
  async deviceStats(profile: string, asOf: number): Promise<DeviceStats> {
    this.calls++;
    const all = this.byProfile.get(profile) ?? [];
    const txns = all.slice(0, upperBound(all, asOf));
    const users = new Set<string>();
    const last = new Map<string, number>();
    let news = 0, anon = 0;
    for (const t of txns) {
      users.add(t.customer);
      last.set(t.cardKey, Math.max(last.get(t.cardKey) ?? 0, t.ts));
      if (t.dev?.isNew) news++;
      if (t.dev?.proxy === "IP_PROXY:ANONYMOUS") anon++;
    }
    const n = Math.max(1, txns.length);
    const blocked = new Set<string>();
    for (const cc of this.closed) {
      if (cc.closedAt <= asOf && cc.outcome === "confirmed_fraud" && cc.actions.includes("BLOCK_CARD")) {
        const k = this.aliasToKey.get(cc.cardLabel);
        if (k && last.has(k)) blocked.add(k);
      }
    }
    return { profile, users: users.size, txns: txns.length, newShare: news / n, anonProxyShare: anon / n, lastByCard: users.size <= 300 ? last : new Map(), blocked };
  }

  async deviceExists(profile: string): Promise<boolean> {
    this.calls++;
    return (this.byProfile.get(profile)?.length ?? 0) > 0;
  }

  async customerCards(customer: string): Promise<string[]> {
    this.calls++;
    return [...(this.cardsOfCustomer.get(customer) ?? [])];
  }

  /** Closed cases that had already closed by `asOf` (memory is causal). */
  async closedCases(asOf: number, filter: ClosedCaseFilter = {}): Promise<ClosedCase[]> {
    this.calls++;
    return this.closed.filter((c) => c.closedAt <= asOf && (!filter.pattern || c.pattern === filter.pattern) && (!filter.outcome || c.outcome === filter.outcome));
  }

  async closedCasesOnDevices(profiles: string[], asOf: number, requireNew: boolean): Promise<ClosedCase[]> {
    this.calls++;
    const want = new Set(profiles);
    return this.closed.filter((cc) => cc.closedAt <= asOf && cc.txnIds.slice(0, 3).some((id) => {
      const t = this.byId.get(id);
      return t?.dev && want.has(t.dev.profile) && t.ts <= asOf && (!requireNew || t.dev.isNew);
    }));
  }

  async closedCaseExists(caseId: string): Promise<boolean> {
    this.calls++;
    return this.closed.some((c) => c.caseId === caseId);
  }

  packCases(): PackCase[] {
    return this.pack;
  }

  async resolveLabel(label: string): Promise<string | undefined> {
    return this.aliasToKey.get(label);
  }

  /** The `Cxxxxx-Kn` label for a card: a real alias if we have one, otherwise a heuristic guess flagged as derived. */
  async labelFor(cardKey: string): Promise<CardLabel> {
    const known = this.keyToAlias.get(cardKey);
    if (known) return { label: known, derived: false };
    const customer = cardKey.split("|")[0];
    const keys = [...(this.cardsOfCustomer.get(customer) ?? [])].sort((a, b) => {
      const [, a4, a6] = a.split("|"), [, b4, b6] = b.split("|");
      return a6 === b6 ? (a4 < b4 ? -1 : a4 > b4 ? 1 : 0) : a6 < b6 ? -1 : 1;
    });
    return { label: `${customer}-K${Math.max(1, keys.indexOf(cardKey) + 1)}`, derived: true };
  }

  async latestTs(): Promise<number> {
    let m = 0;
    for (const l of this.byCard.values()) m = Math.max(m, l[l.length - 1].ts);
    return m;
  }

  stats(): { transactions: number; cards: number; devices: number; closed: number; pack: number } {
    return { transactions: this.byId.size, cards: this.byCard.size, devices: this.byProfile.size, closed: this.closed.length, pack: this.pack.length };
  }
}
