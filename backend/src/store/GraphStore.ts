import type { Comm } from "@fraud/shared";
import type { CardLabel, ClosedCase, PackCase, Txn } from "../domain/types";

/** Everything known about a device profile as of a moment (the shared-fingerprint query). */
export interface DeviceStats {
  profile: string;
  users: number;
  txns: number;
  newShare: number;
  anonProxyShare: number;
  /** last use per card key; empty when the profile is too widely shared to enumerate (users > 300) */
  lastByCard: Map<string, number>;
  /** cards a closed, confirmed case already blocked, among the cards on this profile */
  blocked: Set<string>;
}

export interface ClosedCaseFilter {
  pattern?: string;
  outcome?: ClosedCase["outcome"];
}

/** What a finished investigation writes back into the graph (the case record, its evidence and actions, and their links). */
export interface CaseWrite {
  caseId: string;
  status: string;
  verdict: string;
  probability: number;
  pattern: string;
  exposure: number;
  summary: string;
  openedAt: number;
  cardKey: string;
  affectedTxnIds: string[];
  connectedCardKeys: string[];
  deviceProfiles: string[];
  similarClosedCases: string[];
  evidence: Array<{ claim: string; source: string; ref: string; klass: string; txnIds: string[] }>;
  actions: Array<{ stage: "initial" | "final"; action: string; route: string; reason: string }>;
}

/** A closed case found by meaning (vector search), with what it connects to in the graph (graph expansion). */
export interface RagClosedHit {
  case: ClosedCase;
  /** cosine distance: smaller is more similar */
  distance: number;
  cards: string[];
  nTxns: number;
  /** device profiles the case's transactions ran on */
  devices: string[];
}

export interface RagPolicyHit { id: string; title: string; doc: string; text: string; distance: number }

/** Result of the score-blind contagion sweep (personalised PageRank from confirmed-fraud cards, rarity-weighted, degree-normalised). */
export interface ContagionResult {
  /** cards with a confirmed-fraud closed case (closed by as-of) that the sweep started from */
  seeds: number;
  /** shared device profiles (5 to 200 customers) by fraud-contagion score, highest first */
  devices: Array<{ profile: string; score: number; users: number }>;
}

/**
 * The read contract the agent depends on. There are two implementations:
 *   - InMemoryStore   (CSV, used for tests and the demo fallback)
 *   - TigerGraphStore (installed GSQL queries over REST++ / the TigerGraph MCP server)
 *
 * Every method is asynchronous because the second implementation is a network call.
 * Contract: any method that returns history MUST return nothing later than `asOf`.
 */
export interface GraphStore {
  readonly kind: "memory" | "tigergraph";
  /** number of graph reads; surfaced as `tool_calls` in the answer file */
  readonly calls: number;
  /** messages to the database since the last read, for the "who talked to whom" view */
  takeLog?(): Comm[];
  getTxn(id: string): Promise<Txn | undefined>;
  /** batch form of getTxn; ids that do not exist are absent from the result */
  getTxns(ids: string[]): Promise<Map<string, Txn>>;
  cardTxns(cardKey: string, asOf: number): Promise<Txn[]>;
  cardVolume(cardKey: string, asOf: number): Promise<number>;
  deviceStats(profile: string, asOf: number): Promise<DeviceStats>;
  deviceExists(profile: string): Promise<boolean>;
  customerCards(customer: string): Promise<string[]>;
  /** Closed cases (memory) that had closed by `asOf`, optionally filtered. Memory is causal. */
  closedCases(asOf: number, filter?: ClosedCaseFilter): Promise<ClosedCase[]>;
  /** Closed cases visible at `asOf` whose first three transactions ran on one of these device profiles. */
  closedCasesOnDevices(profiles: string[], asOf: number, requireNew: boolean): Promise<ClosedCase[]>;
  closedCaseExists(caseId: string): Promise<boolean>;
  packCases(): PackCase[];
  resolveLabel(label: string): Promise<string | undefined>;
  labelFor(cardKey: string): Promise<CardLabel>;
  latestTs(): Promise<number>;
  /** Score-blind sweep from confirmed-fraud cards over card - transaction - device profile; never reads the bank score. */
  contagionSweep?(asOf: number, top: number): Promise<ContagionResult>;
  /** GraphRAG: closed cases most similar in meaning to a query vector, visible at `asOf`, expanded along graph edges. */
  semanticClosedCases?(vec: number[], asOf: number, k: number): Promise<RagClosedHit[]>;
  /** GraphRAG: policy / regulatory passages most similar in meaning to a query vector. */
  semanticPolicy?(vec: number[], k: number): Promise<RagPolicyHit[]>;
  /** The exact policy passages with these ids (for example the rules a recommendation cites). */
  policyChunks?(ids: string[]): Promise<RagPolicyHit[]>;
  /** Store the case in the graph and return its graph vertex id. Only stores that hold a graph implement it. */
  writeCase?(w: CaseWrite): Promise<string>;
}
