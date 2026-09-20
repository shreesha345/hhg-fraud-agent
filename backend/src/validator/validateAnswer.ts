/**
 * Answer-file validator. Runs before every file is written (and in tests). It encodes the README's answer
 * rules, so a malformed or self-contradicting file cannot be submitted by accident.
 */
import { AnswerFile } from "@fraud/shared";
import type { ActionItem } from "@fraud/shared";
import type { GraphStore } from "../store/GraphStore";
import { routeFor } from "../engines/policy";

export interface Issue { level: "error" | "warn"; code: string; message: string }

const sameActions = (a: ActionItem[], b: ActionItem[]): boolean => {
  const k = (x: ActionItem[]) => x.map((y) => `${y.action}:${y.route}`).sort().join("|");
  return k(a) === k(b);
};
const sentenceCount = (t: string): number => t.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;

export async function validateAnswer(input: unknown, store: GraphStore, opts: { allowBlockAll?: boolean } = {}): Promise<Issue[]> {
  const issues: Issue[] = [];
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warn", code, message });

  const parsed = AnswerFile.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) err("schema", `${i.path.join(".")}: ${i.message}`);
    return issues;
  }
  const a = parsed.data;
  const c = a.case;
  const txns = await store.getTxns([...new Set([...c.affected_txn_ids, c.first_suspicious_txn_id, ...c.evidence.flatMap((e) => e.entity_ids), ...a.sar.subjects].filter(Boolean))]);

  // --- every ID must exist
  const checkId = async (id: string, where: string): Promise<void> => {
    if (txns.has(id) || (await store.closedCaseExists(id))) return;
    if (/^.+-K\d+$/.test(id)) {
      if (await store.resolveLabel(id)) return;
      const cust = id.replace(/-K\d+$/, "");
      // A K label that no source file names is a guess and may not exist: made-up IDs score zero, so this is an error.
      if ((await store.customerCards(cust)).length) { err("derived_card_label", `${where}: card label ${id} is inferred, not read from a source file`); return; }
    }
    if (id.includes(" | ")) { if (await store.deviceExists(id)) return; }
    else if ((await store.customerCards(id)).length) return;
    err("unknown_id", `${where}: ${id} does not exist in the dataset`);
  };
  await Promise.all([
    ...c.affected_txn_ids.map((id) => checkId(id, "affected_txn_ids")),
    ...(c.first_suspicious_txn_id ? [checkId(c.first_suspicious_txn_id, "first_suspicious_txn_id")] : []),
    ...c.connected_card_ids.map((id) => checkId(id, "connected_card_ids")),
    ...c.connected_device_profiles.map((id) => checkId(id, "connected_device_profiles")),
    ...c.similar_prior_cases.map(async (id) => { if (!(await store.closedCaseExists(id)) && !/^EX-/.test(id)) err("unknown_id", `similar_prior_cases: ${id} is not a closed case`); }),
    ...c.evidence.flatMap((e, i) => e.entity_ids.map((id) => checkId(id, `evidence[${i}]`))),
    ...a.sar.subjects.map((id) => checkId(id, "sar.subjects")),
  ]);

  // --- exposure
  const sum = c.affected_txn_ids.reduce((s, id) => s + Math.abs(txns.get(id)?.amt ?? 0), 0);
  if (Math.abs(sum - c.exposure_usd) > 0.011) err("exposure", `exposure_usd ${c.exposure_usd} != sum of affected amounts ${sum.toFixed(2)}`);
  if (c.verdict === "legitimate" && (c.affected_txn_ids.length || c.exposure_usd !== 0)) err("legit_exposure", "legitimate verdict must have no affected transactions and zero exposure");

  // --- actions and routes
  const nbaIssues = (label: string, list: ActionItem[]) => {
    for (const x of list) {
      if (x.route !== routeFor(x.action, c.exposure_usd)) err("route", `${label}: ${x.action} must be ${routeFor(x.action, c.exposure_usd)}, not ${x.route}`);
      if (x.action === "BLOCK_ALL_CARDS" && !opts.allowBlockAll) err("r10", `${label}: BLOCK_ALL_CARDS requires two cards with confirmed fraud (R10)`);
    }
  };
  nbaIssues("initial", a.next_best_actions.initial);
  nbaIssues("final", a.next_best_actions.final);
  const same = sameActions(a.next_best_actions.initial, a.next_best_actions.final);
  if (same && a.next_best_actions.what_changed !== "nothing") err("what_changed", 'initial equals final, so what_changed must be "nothing"');
  if (!same && a.next_best_actions.what_changed === "nothing") err("what_changed", "initial differs from final but what_changed says nothing");
  if (!a.next_best_actions.initial.length || !a.next_best_actions.final.length) err("actions_empty", "initial and final must each contain at least one action");
  if (same && a.evidence_requests.length) warn("requests_no_change", "evidence was requested but the recommendation did not change");

  const fin = new Set(a.next_best_actions.final.map((x) => x.action));
  if (fin.has("FILE_REPORT") && !fin.has("CREATE_CASE")) err("report_without_case", "a report always has a case behind it");
  if (c.fraud_probability >= 0.3 && !fin.has("CREATE_CASE") && !fin.has("CLOSE_NO_FRAUD")) warn("case_threshold", "probability >= 0.30 should have a CREATE_CASE (policy 3a)");
  if (a.evidence_requests.length && !a.next_best_actions.initial.some((x) => x.action === "VERIFY_WITH_CUSTOMER" || x.action === "STEP_UP_AUTH")) warn("request_action", "evidence was requested but the initial actions do not ask for it");

  // --- SAR
  if (a.sar.file !== fin.has("FILE_REPORT")) err("sar_consistency", "sar.file must be true if and only if FILE_REPORT is in final");
  if (a.sar.file) {
    const n = sentenceCount(a.sar.narrative);
    if (n < 6 || n > 12) err("sar_length", `SAR narrative must be 6 to 12 sentences, got ${n}`);
    if (a.sar.activity_dates.length !== 2) err("sar_dates", "activity_dates must hold two dates");
    if (Math.abs(a.sar.total_amount_usd - c.exposure_usd) > 0.011) warn("sar_total", "SAR total differs from exposure");
    for (const s of a.sar.subjects) if (!a.sar.narrative.includes(s)) err("sar_subject", `subject ${s} does not appear in the narrative`);
  } else if (a.sar.narrative !== "" || a.sar.subjects.length || a.sar.total_amount_usd !== 0 || a.sar.activity_dates.length) {
    err("sar_empty", "when file is false, narrative, subjects, total and dates must be empty");
  }

  // --- pattern and evidence
  if ((c.pattern === "undocumented") !== (c.pattern_description.trim().length > 0)) err("pattern_description", "pattern_description is required exactly when pattern is undocumented");
  c.evidence.forEach((e, i) => { if (e.source !== "customer" && !e.entity_ids.length) err("evidence_ids", `evidence[${i}] cites no entity IDs`); });
  if (c.verdict === "fraud" && c.status === "closed_legitimate") err("status", "fraud verdict with closed_legitimate status");
  return issues;
}

export const hasErrors = (i: Issue[]): boolean => i.some((x) => x.level === "error");
