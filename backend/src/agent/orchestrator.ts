/**
 * The investigation loop (CLAUDE.md section 5):
 *   Intake -> Recall/Advocates (signatures) -> Judge -> stop rule -> [Plan -> Checkpoint 1 -> Reply -> Judge]
 *   -> Policy -> Explain -> SAR -> Validate.
 * Deterministic engines decide; the narrator only phrases. Every query is bounded by as_of = opened_at.
 */
import type { AgentEvent, AnswerFile, EvidenceItem, GraphView, InvestigationResult, Pattern, SignatureView, Verdict } from "@fraud/shared";
import { ACTION_PLAIN, PATTERN_PLAIN, ROUTE_PLAIN, SIGNATURE_PLAIN, TRIGGER_PLAIN, VERDICT_PLAIN, howSure, plainAction, plainClass } from "@fraud/shared";
import type { GraphStore } from "../store/GraphStore";
import { iso, type CaseCtx, type PackCase, type SigResult, type Txn } from "../domain/types";
import { runSignatures } from "../engines/signatures";
import { judge, type Assessment } from "../engines/judge";
import { LR } from "../engines/calibration";
import { contingency, decide, type PolicyInput, type PolicyOutput } from "../engines/policy";
import type { Brief, Narrator } from "../llm/narrator";
import { validateAnswer } from "../validator/validateAnswer";
import { describeCase, retrieve, type RagContext, type RagOptions } from "../rag/retriever";

export interface InvestigateOptions {
  narrator: Narrator;
  onEvent?: (e: AgentEvent) => void | Promise<void>;
  /** artificial pause between events, for a live demo */
  delayMs?: number;
  /** GraphRAG: retrieve similar closed cases and policy passages by meaning (TigerGraph store with vector indexes) and give the narrator a cited context */
  rag?: RagOptions;
  /** write the finished case (evidence, actions, links) back into the graph when the store supports it */
  writeToGraph?: boolean;
}

const PROSECUTION_FOR_AFFECTED = ["test_then_spend", "off_profile_burst", "new_device", "threshold_hugging", "shared_rare_fingerprint", "out_of_region_home_continues"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Choose the fraud pattern from the fired signatures. Only labelled when the case leans toward fraud. */
export function classify(sigs: SigResult[], p: number): Pattern {
  if (p < 0.5) return "none";
  const f = (n: string) => sigs.some((s) => s.name === n && s.fired);
  if (f("test_then_spend")) return "card_testing";
  if (f("threshold_hugging") || f("shared_rare_fingerprint")) return "undocumented";
  if (f("out_of_region_home_continues")) return "out_of_region_use";
  if (f("new_device") && f("off_profile_burst")) return "card_not_present_new_device";
  if (f("off_profile_burst")) return "card_not_present_fraud";
  if (f("new_device")) return "card_not_present_new_device";
  return "none";
}

const verdictOf = (p: number, reply: string): Verdict => (reply === "confirms" && p < 0.5 ? "legitimate" : p >= 0.7 ? "fraud" : p <= 0.2 ? "legitimate" : "uncertain");

export async function investigate(store: GraphStore, pack: PackCase, opts: InvestigateOptions): Promise<InvestigationResult> {
  const t0 = performance.now();
  const calls0 = store.calls;
  store.takeLog?.(); opts.narrator.takeLog?.(); opts.rag?.embedder.takeLog?.();
  const events: AgentEvent[] = [];
  let seq = 0;
  const emit = async (kind: AgentEvent["kind"], title: string, detail?: string, data?: unknown) => {
    const e: AgentEvent = { seq: ++seq, kind, title, detail, data };
    events.push(e);
    await opts.onEvent?.(e);
    if (opts.delayMs) await sleep(opts.delayMs);
  };

  // ---------------------------------------------------------------- 1 Intake
  const asOf = pack.openedAt;
  const flagged = await store.getTxn(pack.flaggedTxnId);
  if (!flagged) throw new Error(`flagged transaction ${pack.flaggedTxnId} not found`);
  if (flagged.ts > asOf) throw new Error("flagged transaction is later than the case opening time");
  const card = await store.cardTxns(flagged.cardKey, asOf);
  const hub = (await store.cardVolume(flagged.cardKey, asOf)) > 1500;
  /** Every affected transaction is on this card, so the card history already holds it (saves a graph read per id). */
  const byId = new Map(card.map((t) => [t.id, t] as const));
  const txnOf = (id: string): Txn => byId.get(id) ?? (() => { throw new Error(`transaction ${id} is not in the card history`); })();
  const ctx: CaseCtx = { caseId: pack.caseId, asOf, trigger: pack.trigger, triggerScore: pack.score, flagged, cardKey: flagged.cardKey, card, hub };
  await emit("intake", `Opened case ${pack.caseId}`,
    `${TRIGGER_PLAIN[pack.trigger] ?? pack.trigger}. The payment in question is a ${flagged.channel === "online" ? "online" : "in-person"} purchase of $${flagged.amt.toFixed(2)}. ` +
    `The agent only uses what was known at ${iso(asOf)}, and found ${card.length} earlier payments on this card${hub ? " (this card is shared by many people, so unusual activity counts for less)" : ""}.`,
    { asOf: iso(asOf), hub });

  // ---------------------------------------------------------------- 2-3 Signatures: prosecution, defence, sweep, memory
  const sigs = await runSignatures(ctx, store);
  const fired = (side: string) => sigs.filter((s) => s.side === side && s.fired);
  const bullets = (list: SigResult[], none: string) => list.map((x) => `- ${SIGNATURE_PLAIN[x.name] ?? x.name}: ${x.claim}`).join("\n") || none;
  await emit("prosecution", fired("prosecution").length ? `Found ${fired("prosecution").length} sign${fired("prosecution").length === 1 ? "" : "s"} of fraud` : "Found no clear signs of fraud",
    bullets(fired("prosecution"), "Nothing in this card's history matches a known fraud trick."), fired("prosecution").map((s) => s.name));
  await emit("defence", fired("defence").length ? `Found ${fired("defence").length} reason${fired("defence").length === 1 ? "" : "s"} it could be innocent` : "Found no innocent explanation",
    bullets(fired("defence"), "Nothing suggests a trip, a new phone or a regular charge."), fired("defence").map((s) => s.name));
  const net = sigs.find((s) => s.name === "shared_rare_fingerprint")!;
  // Contagion sweep (personalised PageRank in GSQL, TigerGraph store only). Informational: it never moves the probability.
  let contagion = "";
  if (store.contagionSweep) {
    try {
      const profiles = [...new Set(card.filter((t) => t.dev && t.ts >= flagged.ts - 7 * 86_400_000).map((t) => t.dev!.profile))];
      const sw = await store.contagionSweep(asOf, 400);
      const ranked = profiles.map((p) => ({ p, i: sw.devices.findIndex((d) => d.profile === p) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i);
      contagion = ranked.length
        ? ` Extra check, ignoring the bank's score: starting from ${sw.seeds} cards already proven to be fraud, this card's device is number ${ranked[0].i + 1} of ${sw.devices.length} on the list of shared devices closest to known fraud.`
        : ` Extra check, ignoring the bank's score: starting from ${sw.seeds} cards already proven to be fraud, none of this card's recent devices is close to known fraud.`;
    } catch (e) { contagion = ` (The extra link check could not run: ${(e as Error).message.slice(0, 80)}.)`; }
  }
  await emit("sweep", net.fired ? "Found a suspicious link to other cards" : "No suspicious link to other cards", `${net.claim.replace(/[.\s]+$/, "")}.${contagion}`, net.facts);
  const mem = sigs.find((s) => s.name === "memory_recall")!;
  await emit("recall", mem.fired ? `Found ${mem.entityIds.length} similar past case${mem.entityIds.length === 1 ? "" : "s"}` : "No similar past case", mem.claim, mem.facts);

  // ---------------------------------------------------------------- 4 Judge
  const assess0 = judge(sigs, { hub, asked: false });
  const classLine = (a: Assessment) => Object.entries(a.classes).map(([c, v]) => `${plainClass(c)} (${v > 0 ? "points to fraud" : "points to innocence"})`).join("; ");
  await emit("judge", `${Math.round(assess0.p * 100)}% chance this is fraud: ${howSure(assess0.p).toLowerCase()}`,
    `Adds up ${assess0.k} different kind${assess0.k === 1 ? "" : "s"} of evidence: ${classLine(assess0) || "none found"}. Two facts of the same kind count only once.`, assess0);

  const geometry = (s: SigResult[], a: Assessment, reply: string) => {
    const pattern = classify(s, a.p);
    const ids = new Set<string>();
    for (const r of s) if (r.fired && PROSECUTION_FOR_AFFECTED.includes(r.name)) for (const id of (r.facts.txnIds as string[] | undefined) ?? []) ids.add(id);
    const verdict = verdictOf(a.p, reply);
    let affected: string[] = [];
    if (verdict !== "legitimate") { ids.add(flagged.id); affected = [...ids].sort((x, y) => txnOf(x).ts - txnOf(y).ts); }
    const exposure = Math.round(affected.reduce((sum, id) => sum + Math.abs(txnOf(id).amt), 0) * 100) / 100;
    return { pattern, verdict, affected, exposure };
  };
  const has = (s: SigResult[], n: string) => s.find((x) => x.name === n)?.fired ?? false;
  const policyInput = (s: SigResult[], a: Assessment, g: ReturnType<typeof geometry>, reply: PolicyInput["reply"], spent: boolean): PolicyInput => {
    const shared = s.find((x) => x.name === "shared_rare_fingerprint")!;
    return {
      p: a.p, k: a.k, stop: a.stop, trigger: pack.trigger, exposure: g.exposure || flagged.amt, pattern: g.pattern,
      flags: {
        testThenSpend: has(s, "test_then_spend"), bigCleared: Boolean(s.find((x) => x.name === "test_then_spend")?.facts.bigCleared),
        sharedFingerprint: shared.fired && g.verdict !== "legitimate", connectedLive: ((shared.facts.connectedLive as string[]) ?? []).length,
        recurring: has(s, "recurring_cadence"), otherCardFraud: shared.fired && ((shared.facts.connectedClosed as string[]) ?? []).length > 0, confirmedFraudCards: 0,
      },
      reply, budgetSpent: spent,
    };
  };

  // ---------------------------------------------------------------- 5 Stop rule, policy, optional evidence round
  const g0 = geometry(sigs, assess0, "none");
  const in0 = policyInput(sigs, assess0, g0, "none", false);
  const dec0: PolicyOutput = decide(in0);
  await emit("stop_check", assess0.stop ? "Enough evidence to decide" : "Not sure enough yet",
    assess0.stop ? `The agent is ${assess0.stop === "hi" ? "very sure this is fraud" : "very sure this is genuine"}, and several kinds of evidence agree, so it can act now.` : (assess0.openQuestions.length ? `Still unanswered: ${assess0.openQuestions.join("; ")}` : "The evidence is mixed."));

  let initial = dec0.actions;
  let final = dec0.actions;
  let finalSigs = sigs, finalAssess = assess0, finalRules = dec0.rules, finalIn = in0;
  const requests: AnswerFile["evidence_requests"] = [];
  let stopReason = "";
  let contingencyTable: ReturnType<typeof contingency> | undefined;
  let reply: PolicyInput["reply"] = "none";
  let fileReport = dec0.fileReport;

  if (dec0.needsEvidence && !assess0.stop) {
    await emit("plan", "Would ask the customer to confirm", dec0.needsEvidence.why);
    contingencyTable = contingency(in0);
    await emit("checkpoint", "Saved the first recommendation", `Before any answer from the customer, it would: ${initial.map((a) => `${plainAction(a.action).toLowerCase()} (${ROUTE_PLAIN[a.route]?.toLowerCase()})`).join("; ")}.`, initial);
    // The customer's answer is not part of the data and nothing is invented: the agent has no answer, so the recommendation follows
    // policy R4 (no reply). The plans for a denial and a confirmation are precomputed in the contingency table above.
    reply = "silent";
    const noReply = `No reply from the customer is available. The dataset has no customer replies and none is invented, so policy R4 (no reply within 24 hours) applies; the plans for "not me" and "it was me" are in the contingency table. Fraud probability stays at the pre-reply p=${assess0.p.toFixed(2)}.`;
    requests.push({ type: dec0.needsEvidence.type, asked_after_step: 4, assumed_response: noReply });
    await emit("reply", "No answer from the customer is available",
      "The customer's real answer is not in the data, so the agent does not invent one. It follows the rule for no answer within 24 hours and keeps the plans for the other two answers.");
    finalAssess = judge(sigs, { hub, asked: true });
    const finalGeom = geometry(sigs, finalAssess, "silent");
    finalIn = policyInput(sigs, finalAssess, finalGeom, "silent", true);
    const dec1 = decide(finalIn);
    final = dec1.actions;
    finalRules = dec1.rules;
    fileReport = dec1.fileReport;
    stopReason = "No reply from the customer is available, so policy R4 governs and further evidence requests would not change the decision.";
    await emit("judge", `Fraud chance stays ${Math.round(assess0.p * 100)}%`, "No new evidence arrived, so the fraud chance does not change; only the rule that applies does.", finalAssess);
  } else if (assess0.stop) {
    stopReason = `Probability ${assess0.p.toFixed(2)} is ${assess0.stop === "hi" ? "at or above 0.85" : "at or below 0.15"} and supported by ${assess0.k} independent evidence classes (${assess0.support.join(", ")}), so a defensible action exists and further steps would not change it.`;
  } else {
    stopReason = `Not enough independent evidence and no further permitted evidence request; escalating under R8. Open: ${assess0.openQuestions.join("; ") || "none"}.`;
  }
  await emit("policy", "Applied the bank's rules",
    `${final.map((a) => `- ${plainAction(a.action)}: ${ROUTE_PLAIN[a.route]?.toLowerCase()}`).join("\n")}\n(Rules used: ${finalRules.join(", ") || "none"}. The rules, not the AI, decide the actions.)`, final);

  // ---------------------------------------------------------------- assemble the case
  // The case record reports what the evidence supports BEFORE any (simulated) reply: verdict, pattern, probability, affected
  // transactions and the evidence list are never lifted by an assumed answer. Only the actions reflect the assumption, and it is
  // recorded in evidence_requests[].assumed_response.
  const caseGeom = geometry(sigs, assess0, "none");
  const verdict = caseGeom.verdict;
  const pattern = caseGeom.pattern;
  let rag: RagContext | undefined;
  if (opts.rag && store.semanticClosedCases) {
    try {
      const claims = sigs.filter((x) => x.fired && x.side !== "meta").map((x) => x.claim);
      rag = await retrieve(store, opts.rag, describeCase({ trigger: pack.trigger, triggerText: pack.triggerText, claims, pattern }), asOf,
        fileReport ? "suspicious activity report narrative: who, what, when, where, why and how the activity was suspicious" : `${pack.trigger.replace(/_/g, " ")} ${pattern.replace(/_/g, " ")} ${finalRules.join(" ")} recommended action`);
      await emit("recall", `Looked up ${rag.closed.length} similar past cases and ${rag.policy.length} policy passages`, rag.text,
        { closed: rag.closed.map((h) => ({ id: h.case.caseId, distance: Number(h.distance.toFixed(3)), devices: h.devices.length })), policy: rag.policy.map((h) => h.id) });
    } catch (e) {
      await emit("recall", "Could not look up similar past cases", `${(e as Error).message}. The investigation continues without it.`);
    }
  }
  const shared = finalSigs.find((s) => s.name === "shared_rare_fingerprint")!;
  const newDev = finalSigs.find((s) => s.name === "new_device")!;
  const memory = finalSigs.find((s) => s.name === "memory_recall")!;
  const connectedKeys = [...((shared.facts.connectedLive as string[]) ?? []), ...((shared.facts.connectedClosed as string[]) ?? [])];
  // Card IDs must exist in the dataset. A K label that no source file names is only a guess, so it is left out (user decision).
  const connectedInfo = verdict === "legitimate" ? [] : await Promise.all(connectedKeys.map((k) => store.labelFor(k)));
  const connectedCards = connectedInfo.filter((l) => !l.derived).map((l) => l.label);
  const unresolved = connectedInfo.length - connectedCards.length;
  const devices = verdict === "legitimate" ? [] : [...new Set([shared.fired ? (shared.facts.profile as string) : "", newDev.fired && pattern !== "none" ? (newDev.facts.profile as string) : ""].filter(Boolean))];
  const similar = (await Promise.all((memory.entityIds as string[]).map(async (id) => ((await store.closedCaseExists(id)) ? id : "")))).filter(Boolean);

  const evidence: EvidenceItem[] = sigs.filter((s) => s.fired)
    .map((s) => ({
      claim: s.claim, source: "graph" as const, ref: s.ref,
      entity_ids: s.name === "bank_score" ? [flagged.id] : s.entityIds,
    }));
  if (net.fired && connectedKeys.length && verdict !== "legitimate") {
    evidence.push({
      claim: `Cards sharing that device profile: ${connectedCards.slice(0, 8).join(", ") || "none with a resolvable card ID"}${unresolved ? ` (${unresolved} more card(s) share it; their card IDs cannot be resolved from the data, so they are not named)` : ""}`,
      source: "graph", ref: "query:shared_rare_fingerprint.connected", entity_ids: connectedCards.slice(0, 8),
    });
  }
  const evClasses: string[] = [...sigs.filter((x) => x.fired).map((x) => x.cls as string), ...(evidence.length > sigs.filter((x) => x.fired).length ? ["network"] : [])];
  if (store.policyChunks && finalRules.length) {
    const chunks = await store.policyChunks([...new Set(finalRules)].map((r) => `policy:${r}`));
    for (const c of chunks) {
      const rule = c.id.replace("policy:", "");
      evidence.push({
        claim: `Policy ${rule} governs this recommendation: ${c.text.replace(/\*\*/g, "").replace(/\s+/g, " ").slice(0, 230)}`,
        source: "document", ref: `document:${c.id}`, entity_ids: [flagged.id],
      });
      evClasses.push("policy");
    }
  }
  const affectedTxns = caseGeom.affected.map(txnOf);
  const first = affectedTxns[0];
  const last = affectedTxns[affectedTxns.length - 1];
  const dates: [string, string] | [] = first ? [iso(first.ts).slice(0, 10), iso(last.ts).slice(0, 10)] : [];
  const patternDescription = pattern === "undocumented"
    ? (has(finalSigs, "threshold_hugging")
      ? `Several online purchases in a short window, each just under a round authorization threshold, apparently chosen to avoid it. Found by testing the card's recent activity for clustering just below $500 and $1,000; it matches earlier closed structuring cases.`
      : `A device profile that is rare, always marked New for the account and behind an anonymous proxy is shared by ${shared.facts.users} customers. Found by a score-blind sweep from confirmed-fraud entities; the bank's model scored most of this activity low.`)
    : "";
  const status = verdict === "legitimate" || final.some((a) => a.action === "CLOSE_NO_FRAUD") ? "closed_legitimate" as const
    : final.some((a) => a.action === "ESCALATE_TO_ANALYST") ? "escalated" as const
    : verdict === "fraud" ? "closed_fraud" as const : "open" as const;
  const whatChanged = JSON.stringify(initial.map((a) => a.action + a.route).sort()) === JSON.stringify(final.map((a) => a.action + a.route).sort())
    ? "nothing"
    : `With no customer reply available (fraud_probability stays at the pre-reply ${assess0.p.toFixed(2)}), ${finalRules.join(", ") || "policy"} governs, so the recommendation changed from ${initial.map((a) => a.action).join(", ")} to ${final.map((a) => a.action).join(", ")}.`;

  const cardLabel = (await store.labelFor(flagged.cardKey)).label;
  const subjects = fileReport ? [pack.customer, pack.cardLabel, ...connectedCards.slice(0, 4), ...devices.slice(0, 1)] : [];
  const brief: Brief = {
    caseId: pack.caseId, customer: pack.customer, cardLabel: pack.cardLabel || cardLabel, trigger: pack.trigger, verdict, pattern, patternDescription,
    probability: assess0.p, exposure: caseGeom.exposure,
    affected: affectedTxns.map((t) => ({ id: t.id, amt: t.amt, ts: iso(t.ts), channel: t.channel, region: t.region })),
    connectedCards, devices, evidence, initial, final, whatChanged, rules: finalRules, fileReport, activityDates: dates, subjects, openQuestions: assess0.openQuestions, context: rag?.text,
  };
  const ex = await opts.narrator.explain(brief);
  await emit("explain", "Wrote the summary", ex.text);
  let sarText = "", sarTokens = 0;
  if (fileReport) { const s = await opts.narrator.sar(brief); sarText = s.text; sarTokens = s.tokens; await emit("sar", "Wrote the regulator report", sarText); }
  
  // NEW: Generate customer-friendly explanation
  let customerExplanation = "";
  let customerTokens = 0;
  try {
    const custEx = await opts.narrator.explainToCustomer(brief);
    customerExplanation = custEx.text;
    customerTokens = custEx.tokens;
    await emit("explain", "Wrote customer-friendly explanation", customerExplanation);
  } catch (e) {
    // Customer explanation is optional - don't fail the case if it errors
    await emit("explain", "Could not generate customer explanation", `${(e as Error).message}`);
  }

  const answer: AnswerFile = {
    case_id: pack.caseId,
    case: {
      status, verdict, fraud_probability: assess0.p, pattern, pattern_description: patternDescription,
      affected_txn_ids: caseGeom.affected, first_suspicious_txn_id: verdict === "legitimate" ? "" : (first?.id ?? ""),
      connected_card_ids: connectedCards, connected_device_profiles: devices, exposure_usd: caseGeom.exposure, evidence,
      similar_prior_cases: similar, summary: ex.text, customer_explanation: customerExplanation || undefined, written_to_graph: false, graph_case_id: "",
    },
    evidence_requests: requests,
    next_best_actions: { initial, final, what_changed: whatChanged, contingency: contingencyTable },
    sar: fileReport
      ? { file: true, reason: `${finalRules.filter((r) => ["R2", "R6", "R9"].includes(r)).join(", ") || "Policy 3a"}: fraud confirmed or strongly suspected and a reporting condition holds (exposure $${caseGeom.exposure.toFixed(2)}${shared.fired ? ", shared device profile" : ""}${pattern === "undocumented" ? ", undocumented pattern" : ""})`, narrative: sarText, subjects, total_amount_usd: caseGeom.exposure, activity_dates: [...dates] }
      : { file: false, reason: verdict === "legitimate" ? "No fraud suspected, so no report is required." : "No reporting condition holds (exposure at or under $1,000, no shared device, pattern not undocumented).", narrative: "", subjects: [], total_amount_usd: 0, activity_dates: [] },
    stop_reason: stopReason,
    tool_calls: 0, tokens: ex.tokens + sarTokens + customerTokens, latency_s: 0,
  };

  if (opts.writeToGraph && store.writeCase) {
    const classes = evClasses;
    const gid = await store.writeCase({
      caseId: pack.caseId, status: answer.case.status, verdict, probability: assess0.p, pattern, exposure: caseGeom.exposure, summary: ex.text, openedAt: asOf,
      cardKey: flagged.cardKey, affectedTxnIds: caseGeom.affected, connectedCardKeys: verdict === "legitimate" ? [] : connectedKeys, deviceProfiles: devices, similarClosedCases: similar,
      evidence: evidence.map((e, i) => ({ claim: e.claim, source: e.source, ref: e.ref, klass: classes[i] ?? "network", txnIds: e.entity_ids.filter((x) => byId.has(x)) })),
      actions: [...initial.map((a) => ({ stage: "initial" as const, ...a })), ...final.map((a) => ({ stage: "final" as const, ...a }))],
    });
    answer.case.written_to_graph = true;
    answer.case.graph_case_id = gid;
    await emit("learn", `Saved the case in the graph (${gid})`, `Stored the case, ${evidence.length} pieces of evidence and ${initial.length + final.length} recommended actions, linked to the payments, cards and devices involved.`);
  }
  const validation = await validateAnswer(answer, store);
  await emit("validate", validation.some((v) => v.level === "error") ? "Found problems in the answer" : "Answer double-checked: no problems", validation.some((v) => v.level === "error") ? validation.map((v) => v.message).slice(0, 3).join("; ") : "Every ID exists in the data, the actions and approval routes follow the bank's rules, and the numbers add up.");
  answer.tool_calls = store.calls - calls0;
  answer.latency_s = Math.round(((performance.now() - t0) / 1000) * 1000) / 1000;
  await emit("done", `${VERDICT_PLAIN[verdict]}: ${Math.round(assess0.p * 100)}% chance of fraud`, `${PATTERN_PLAIN[pattern] ?? pattern}. Recommended: ${final.map((a) => plainAction(a.action).toLowerCase()).join("; ")}.`);

  // ---------------------------------------------------------------- graph view for the UI
  const graph: GraphView = { nodes: [], edges: [] };
  const seen = new Set<string>();
  const node = (n: GraphView["nodes"][number]) => { if (!seen.has(n.id)) { seen.add(n.id); graph.nodes.push(n); } };
  node({ id: `card:${flagged.cardKey}`, label: pack.cardLabel || cardLabel, kind: "card" });
  for (const id of caseGeom.affected) {
    const t = txnOf(id);
    node({ id: `txn:${id}`, label: `$${t.amt.toFixed(0)}`, kind: "txn", flag: id === flagged.id ? "flagged" : "affected" });
    graph.edges.push({ from: `card:${flagged.cardKey}`, to: `txn:${id}`, label: "MADE" });
    if (t.dev && devices.includes(t.dev.profile)) {
      node({ id: `dev:${t.dev.profile}`, label: t.dev.profile.split(" | ")[0], kind: "device" });
      graph.edges.push({ from: `txn:${id}`, to: `dev:${t.dev.profile}`, label: "FROM_DEVICE" });
    }
  }
  if (!seen.has(`txn:${flagged.id}`)) { node({ id: `txn:${flagged.id}`, label: `$${flagged.amt.toFixed(0)}`, kind: "txn", flag: "flagged" }); graph.edges.push({ from: `card:${flagged.cardKey}`, to: `txn:${flagged.id}`, label: "MADE" }); }
  const liveSet = new Set((shared.facts.connectedLive as string[]) ?? []);
  const graphKeys = connectedKeys.slice(0, 14);
  const graphLabels = await Promise.all(graphKeys.map((k) => store.labelFor(k)));
  for (const [i, k] of graphKeys.entries()) {
    node({ id: `card:${k}`, label: graphLabels[i].label, kind: "other_card", flag: liveSet.has(k) ? "live" : "closed" });
    if (devices[0]) graph.edges.push({ from: `dev:${devices[0]}`, to: `card:${k}`, label: "USED_BY" });
  }
  for (const id of similar) { node({ id: `case:${id}`, label: id, kind: "case" }); graph.edges.push({ from: `card:${flagged.cardKey}`, to: `case:${id}`, label: "RETRIEVED" }); }

  const signatures: SignatureView[] = finalSigs.map((s) => ({ name: s.name, side: s.side, cls: s.cls, fired: s.fired, strength: s.strength, logLr: s.logLr, claim: s.claim, entityIds: s.entityIds }));
  return {
    answer,
    trace: {
      assessment: { p: assess0.p, logOdds: assess0.logOdds, prior: assess0.prior, k: assess0.k, classes: assess0.classes, open_questions: assess0.openQuestions },
      signatures, events, graph, narrator: { mode: opts.narrator.mode, model: ex.model, fell_back: false },
      comms: [...(store.takeLog?.() ?? []), ...(opts.rag?.embedder.takeLog?.() ?? []), ...(opts.narrator.takeLog?.() ?? [])],
      validation,
    },
  };
}
