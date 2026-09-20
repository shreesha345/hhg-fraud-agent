import type { EvidenceClass, Pattern, TriggerType } from "@fraud/shared";

export type Channel = "online" | "in_person";

export interface DeviceInfo {
  /** DeviceInfo | OS | browser | screen (README definition) */
  profile: string;
  /** brand family, first token(s) of DeviceInfo, used to test "same phone family" */
  family: string;
  isNew: boolean;
  proxy: string; // "", "IP_PROXY:TRANSPARENT", "IP_PROXY:ANONYMOUS", "IP_PROXY:HIDDEN"
}

export interface Txn {
  id: string;
  customer: string;
  /** customer | card4 | card6 : how a card is resolved (the K label is only an alias) */
  cardKey: string;
  ts: number; // epoch ms, UTC
  channel: Channel;
  score: number;
  amt: number;
  prod: string;
  region: number | null;
  card4: string;
  card6: string;
  dev?: DeviceInfo;
}

export interface ClosedCase {
  caseId: string;
  customer: string;
  cardLabel: string;
  openedAt: number;
  closedAt: number;
  outcome: "confirmed_fraud" | "cleared";
  pattern: string;
  txnIds: string[];
  exposure: number;
  connectedLabels: string[];
  actions: string[];
  notes: string;
}

export interface PackCase {
  caseId: string;
  openedAt: number;
  openedAtRaw: string;
  trigger: TriggerType;
  triggerText: string;
  flaggedTxnId: string;
  cardLabel: string;
  customer: string;
  score: number | null;
}

export interface CardLabel {
  label: string;
  /** true when the K number was inferred, not read from a source file */
  derived: boolean;
}

/** Side of the argument a signature belongs to. */
export type Side = "prosecution" | "defence" | "meta";

export interface SigResult {
  name: string;
  side: Side;
  cls: EvidenceClass;
  fired: boolean;
  /** 0..1 confidence that the pattern is really present */
  strength: number;
  /** contribution to fraud log-odds when fired (negative for defence) */
  logLr: number;
  claim: string;
  ref: string;
  entityIds: string[];
  pattern?: Pattern;
  facts: Record<string, unknown>;
}

export interface CaseCtx {
  caseId: string;
  asOf: number;
  trigger: TriggerType;
  triggerScore: number | null;
  flagged: Txn;
  cardKey: string;
  /** every txn on the card with ts <= asOf, sorted ascending (includes the flagged one) */
  card: Txn[];
  /** true when the card/customer volume is implausible for one person */
  hub: boolean;
}

export const ms = (s: string): number => Date.parse(s.replace(" ", "T") + "Z");
export const iso = (t: number): string => new Date(t).toISOString().slice(0, 19).replace("T", " ");
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
