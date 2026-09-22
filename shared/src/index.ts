/**
 * Shared contract: policy vocabulary and the answer-file schema.
 * Names and routes are copied EXACTLY from the fraud policy in Dataset/README.md. Do not rename.
 */
import { z } from "zod";

// ---------------------------------------------------------------- policy vocabulary
export const ACTIONS = [
  "ALLOW_TRANSACTION",
  "DECLINE_TRANSACTION",
  "MONITOR_CARD",
  "MONITOR_CONNECTED_CARDS",
  "WARN_CUSTOMER",
  "VERIFY_WITH_CUSTOMER",
  "STEP_UP_AUTH",
  "BLOCK_CARD",
  "BLOCK_ALL_CARDS",
  "GENERATE_REPORT",
  "CREATE_CASE",
  "FILE_REPORT",
  "ESCALATE_TO_ANALYST",
  "CLOSE_NO_FRAUD",
] as const;
export type Action = (typeof ACTIONS)[number];

export const ROUTES = ["auto", "L1", "L2"] as const;
export type Route = (typeof ROUTES)[number];

export const PATTERNS = [
  "card_testing",
  "card_not_present_fraud",
  "card_not_present_new_device",
  "out_of_region_use",
  "account_takeover",
  "undocumented",
  "none",
] as const;
export type Pattern = (typeof PATTERNS)[number];

export const VERDICTS = ["fraud", "legitimate", "uncertain"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CASE_STATUSES = ["open", "closed_fraud", "closed_legitimate", "escalated"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const EVIDENCE_SOURCES = ["graph", "document", "customer", "external"] as const;
export const REQUEST_TYPES = ["customer_validation", "step_up_auth", "analyst_info"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** Independence classes of the evidence ledger (see CLAUDE.md section 5 and 8). */
export const EVIDENCE_CLASSES = [
  "bank_score",
  "card_behaviour",
  "device",
  "geography",
  "network",
  "memory",
  "numeric_lookalike",
  "customer_reply",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const TRIGGER_TYPES = ["risk_score", "customer_report", "analyst_request"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

// ---------------------------------------------------------------- answer file (README "Answer Format")
export const ActionItem = z.object({
  action: z.enum(ACTIONS),
  route: z.enum(ROUTES),
  reason: z.string().min(1),
});
export type ActionItem = z.infer<typeof ActionItem>;

export const EvidenceItem = z.object({
  claim: z.string().min(1),
  source: z.enum(EVIDENCE_SOURCES),
  ref: z.string().min(1),
  entity_ids: z.array(z.string()),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const EvidenceRequest = z.object({
  type: z.enum(REQUEST_TYPES),
  asked_after_step: z.number().int().nonnegative(),
  assumed_response: z.string().min(1),
});
export type EvidenceRequest = z.infer<typeof EvidenceRequest>;

export const CasePart = z.object({
  status: z.enum(CASE_STATUSES),
  verdict: z.enum(VERDICTS),
  fraud_probability: z.number().min(0).max(1),
  pattern: z.enum(PATTERNS),
  pattern_description: z.string(),
  affected_txn_ids: z.array(z.string()),
  first_suspicious_txn_id: z.string(),
  connected_card_ids: z.array(z.string()),
  connected_device_profiles: z.array(z.string()),
  exposure_usd: z.number().nonnegative(),
  evidence: z.array(EvidenceItem),
  similar_prior_cases: z.array(z.string()),
  summary: z.string().min(1),
  customer_explanation: z.string().optional(), // NEW: Simple language explanation for customers
  written_to_graph: z.boolean(),
  graph_case_id: z.string(),
});

export const SarPart = z.object({
  file: z.boolean(),
  reason: z.string().min(1),
  narrative: z.string(),
  subjects: z.array(z.string()),
  total_amount_usd: z.number().nonnegative(),
  activity_dates: z.array(z.string()),
});

export const NextBestActions = z.object({
  initial: z.array(ActionItem),
  final: z.array(ActionItem),
  what_changed: z.string().min(1),
  /** Extra field (allowed): the plan for every possible customer reply, precomputed before asking. */
  contingency: z
    .array(z.object({ reply: z.enum(["denies", "confirms", "silent"]), rules: z.array(z.string()), actions: z.array(ActionItem) }))
    .optional(),
});

export const AnswerFile = z.object({
  case_id: z.string(),
  case: CasePart,
  evidence_requests: z.array(EvidenceRequest),
  next_best_actions: NextBestActions,
  sar: SarPart,
  stop_reason: z.string().min(1),
  tool_calls: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  latency_s: z.number().nonnegative(),
});
export type AnswerFile = z.infer<typeof AnswerFile>;

// ---------------------------------------------------------------- UI / API contract
/** One message between two parts of the system, for the "who talked to whom" view. */
export interface Comm {
  from: string;
  to: string;
  what: string;
  ms: number;
  ok: boolean;
}

export interface AgentEvent {
  seq: number;
  kind:
    | "intake" | "recall" | "prosecution" | "defence" | "sweep" | "judge" | "stop_check"
    | "plan" | "checkpoint" | "reply" | "policy" | "explain" | "sar" | "learn" | "validate" | "done" | "error";
  title: string;
  detail?: string;
  data?: unknown;
}

export interface SignatureView {
  name: string;
  side: "prosecution" | "defence" | "meta";
  cls: EvidenceClass;
  fired: boolean;
  strength: number;
  logLr: number;
  claim: string;
  entityIds: string[];
}

export interface CaseSummaryView {
  case_id: string;
  opened_at: string;
  trigger_type: TriggerType;
  trigger_text: string;
  flagged_txn_id: string;
  card_id: string;
  customer_id: string;
  risk_score: number | null;
}

export interface GraphView {
  nodes: { id: string; label: string; kind: "card" | "txn" | "device" | "case" | "other_card"; flag?: "flagged" | "affected" | "live" | "closed" }[];
  edges: { from: string; to: string; label: string }[];
}

export interface InvestigationResult {
  answer: AnswerFile;
  trace: {
    assessment: { p: number; logOdds: number; prior: number; k: number; classes: Record<string, number>; open_questions: string[] };
    signatures: SignatureView[];
    events: AgentEvent[];
    graph: GraphView;
    narrator: { mode: "template" | "ollama" | "none"; model?: string; fell_back: boolean };
    /** every message between the agent and the database / AI model during this case */
    comms?: Comm[];
    validation: { level: "error" | "warn"; code: string; message: string }[];
  };
}

export const ROUTE_NOTE: Record<Route, string> = {
  auto: "the agent may act alone",
  L1: "team lead must approve",
  L2: "fraud manager must approve",
};
export * from "./plain";
