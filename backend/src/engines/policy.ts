/**
 * The fraud policy as code. Action names and routes are the README's, verbatim. The LLM never chooses actions:
 * this engine does, and cites the rule. `decide()` is a pure function so every branch is unit tested.
 *
 * Interpretations (README is silent, so they are fixed HERE and stated in each `reason`):
 *  - A customer report of a transaction counts as the customer denying it (R2), unless the recurring-charge
 *    defence fired, in which case R7 applies and nothing is blocked.
 *  - "D0": when independent evidence alone reaches p >= 0.85 (no customer reply), recommend BLOCK_CARD and
 *    CREATE_CASE, because R1 only restrains blocks on a weak, single signal.
 *  - BLOCK_ALL_CARDS is never produced unless R10's condition is passed in explicitly.
 */
import type { Action, ActionItem, Pattern, RequestType, Route, TriggerType } from "@fraud/shared";

export type Reply = "none" | "denies" | "confirms" | "silent";

export interface PolicyInput {
  p: number;
  k: number;
  stop: "hi" | "lo" | null;
  trigger: TriggerType;
  /** sum of |amount| of the affected transactions incl. the flagged one (computed by code, never by the LLM) */
  exposure: number;
  pattern: Pattern;
  flags: {
    testThenSpend: boolean;
    bigCleared: boolean;
    sharedFingerprint: boolean;
    connectedLive: number;
    recurring: boolean;
    otherCardFraud: boolean;
    /** number of the customer's cards with confirmed fraud or compromised credentials (R10) */
    confirmedFraudCards: number;
  };
  reply: Reply;
  budgetSpent: boolean;
}

export interface PolicyOutput {
  actions: ActionItem[];
  rules: string[];
  needsEvidence: { type: RequestType; why: string } | null;
  fileReport: boolean;
}

const AUTO = new Set<Action>([
  "ALLOW_TRANSACTION", "MONITOR_CARD", "MONITOR_CONNECTED_CARDS", "WARN_CUSTOMER", "VERIFY_WITH_CUSTOMER",
  "STEP_UP_AUTH", "GENERATE_REPORT", "CREATE_CASE", "ESCALATE_TO_ANALYST", "CLOSE_NO_FRAUD",
]);

/** Approval route for an action at a given exposure (README section 2). */
export function routeFor(action: Action, exposure: number): Route {
  if (AUTO.has(action)) return "auto";
  if (action === "DECLINE_TRANSACTION") return "L1";
  if (action === "BLOCK_CARD") return exposure > 2500 ? "L2" : "L1";
  return "L2"; // BLOCK_ALL_CARDS, FILE_REPORT
}

/** Only these may be executed by the agent; L1/L2 are recommended and wait for a human. */
export const isAuto = (a: Action): boolean => AUTO.has(a);

const ORDER: Action[] = [
  "STEP_UP_AUTH", "VERIFY_WITH_CUSTOMER", "DECLINE_TRANSACTION", "BLOCK_CARD", "BLOCK_ALL_CARDS", "WARN_CUSTOMER",
  "MONITOR_CARD", "MONITOR_CONNECTED_CARDS", "CREATE_CASE", "ESCALATE_TO_ANALYST", "FILE_REPORT", "ALLOW_TRANSACTION",
  "CLOSE_NO_FRAUD", "GENERATE_REPORT",
];

export function decide(i: PolicyInput): PolicyOutput {
  const reasons = new Map<Action, string[]>();
  const rules: string[] = [];
  const add = (a: Action, why: string) => {
    if (!reasons.has(a)) reasons.set(a, []);
    if (!reasons.get(a)!.includes(why)) reasons.get(a)!.push(why);
  };
  const rule = (r: string) => { if (!rules.includes(r)) rules.push(r); };
  let needs: PolicyOutput["needsEvidence"] = null;

  const undocumented = i.pattern === "undocumented";
  const strongFraud = i.reply === "denies" || i.stop === "hi";
  // A report is treated as a denial unless the defence has already cleared it (stop "lo") or it is a recurring charge (R7).
  const denial = i.reply === "denies" || (i.reply === "none" && i.trigger === "customer_report" && !i.flags.recurring && i.stop !== "lo");
  let fileReport = false;

  const shared = () => {
    if (i.flags.sharedFingerprint) {
      rule("R6");
      add("CREATE_CASE", "R6: several cards share one rare device profile");
      add("FILE_REPORT", "R6: the fraud links to a shared device profile across cards");
      fileReport = true;
      if (i.flags.connectedLive > 0) add("MONITOR_CONNECTED_CARDS", `R6: ${i.flags.connectedLive} other card(s) still live on the shared device profile`);
    }
  };
  const r9 = () => {
    if (undocumented) {
      rule("R9");
      add("CREATE_CASE", "R9: activity fits no documented pattern but shows coordinated or repeated abuse");
      add("FILE_REPORT", "R9: undocumented coordinated abuse warrants a report");
      add("ESCALATE_TO_ANALYST", "R9: undocumented pattern needs an analyst to name it");
      fileReport = true;
    }
  };

  if (i.reply === "confirms") {
    rule("R3");
    add("CLOSE_NO_FRAUD", "R3: the customer confirmed the transaction");
  } else if (i.reply === "silent" && !(i.flags.recurring && i.trigger === "customer_report")) {
    // A recurring-charge dispute stays under R7 (never block) even when no reply arrives, so it is handled in the R7 branch below.
    rule("R4");
    add("MONITOR_CARD", "R4: no customer reply within 24 hours");
    add("DECLINE_TRANSACTION", "R4: decline pending authorizations while unanswered");
    add("CREATE_CASE", "Policy 3a: evidence was requested, so a case exists");
    if (i.exposure > 500) add("ESCALATE_TO_ANALYST", `R4 and R8: no reply and exposure $${i.exposure.toFixed(2)} exceeds $500`);
  } else if (denial) {
    rule("R2");
    const why = i.reply === "denies" ? "R2: the customer denied the transaction" : "R2: the customer reports they did not make the transaction";
    add("BLOCK_CARD", why);
    add("CREATE_CASE", why);
    if (i.exposure > 1000) { add("FILE_REPORT", `R2: exposure $${i.exposure.toFixed(2)} exceeds $1,000`); fileReport = true; }
    if (i.flags.otherCardFraud) { add("FILE_REPORT", "R2: connects to another card's fraud"); fileReport = true; }
    if (i.flags.testThenSpend) { rule("R5"); add("STEP_UP_AUTH", "R5: card-testing sequence observed"); if (!reasons.has("BLOCK_CARD")) add("BLOCK_CARD", "R5: purchase over $100 cleared"); }
    shared();
    r9();
  } else if ((i.reply === "none" || i.reply === "silent") && i.flags.recurring && i.trigger === "customer_report") {
    rule("R7");
    add("CREATE_CASE", "R7: a dispute that matches the customer's own recurring pattern");
    add("VERIFY_WITH_CUSTOMER", "R7: ask the customer; the charge repeats at a regular cadence");
    add("WARN_CUSTOMER", "R7: remind the customer of the recurring charge; do not block");
    if (i.reply === "none") needs = { type: "customer_validation", why: "separates a disputed recurring charge from genuine fraud" };
  } else if (i.stop === "lo") {
    add("ALLOW_TRANSACTION", `Probability ${i.p.toFixed(2)} is at or below 0.15 with ${i.k} independent classes supporting innocence`);
    add("CLOSE_NO_FRAUD", `Probability ${i.p.toFixed(2)} is at or below 0.15 with ${i.k} independent classes supporting innocence`);
  } else if (i.stop === "hi") {
    if (i.flags.testThenSpend) {
      rule("R5");
      add("DECLINE_TRANSACTION", "R5: three or more small online authorizations then a larger purchase");
      add("STEP_UP_AUTH", "R5: require step-up authentication for further activity");
      if (i.flags.bigCleared) add("BLOCK_CARD", "R5: a purchase over $100 has already cleared");
    }
    shared();
    r9();
    if (!i.flags.testThenSpend && !i.flags.sharedFingerprint && !undocumented) {
      rule("D0");
      add("BLOCK_CARD", `D0: p=${i.p.toFixed(2)} from ${i.k} independent evidence classes, so R1's caution for weak single signals does not apply`);
      if (i.exposure > 1000) { add("FILE_REPORT", `Exposure $${i.exposure.toFixed(2)} exceeds $1,000`); fileReport = true; }
    }
    add("CREATE_CASE", `Policy 3a: probability ${i.p.toFixed(2)} is at or above 0.30`);
  } else {
    // uncertain: not enough independent evidence to act on a block
    if (i.p < 0.7 && i.k <= 1) {
      rule("R1");
      add("VERIFY_WITH_CUSTOMER", `R1: p=${i.p.toFixed(2)} rests on ${i.k} independent class, so verify before any block`);
      needs = { type: "customer_validation", why: "one independent signal and probability below 0.70: verify before any block" };
    } else {
      add("VERIFY_WITH_CUSTOMER", `Probability ${i.p.toFixed(2)} is between the stop thresholds; the customer's answer settles it`);
      needs = { type: "customer_validation", why: "probability is between 0.15 and 0.85, so a customer answer is the most informative next step" };
    }
    if (i.p >= 0.3 || needs) add("CREATE_CASE", "Policy 3a: evidence is being requested, so an internal case exists");
    if (i.budgetSpent) {
      needs = null;
      rule("R8");
      add("MONITOR_CARD", "R1: monitor while the case is open");
      if (i.exposure > 500) add("ESCALATE_TO_ANALYST", `R8: uncertain and exposure $${i.exposure.toFixed(2)} exceeds $500`);
    }
  }

  // R10 guard: BLOCK_ALL_CARDS is only ever emitted when its condition is explicitly true.
  if (i.reply === "denies" && i.flags.confirmedFraudCards >= 2) {
    rule("R10");
    add("BLOCK_ALL_CARDS", "R10: two or more of the customer's cards show confirmed fraud");
  }

  const actions: ActionItem[] = ORDER.filter((a) => reasons.has(a)).map((a) => ({
    action: a, route: routeFor(a, i.exposure), reason: reasons.get(a)!.join("; "),
  }));
  return { actions, rules, needsEvidence: i.reply === "none" ? needs : null, fileReport: actions.some((a) => a.action === "FILE_REPORT") };
}

/** The plan for every possible reply, computed BEFORE asking (the "contingency" field). */
/** What the rules would recommend for each possible customer answer. The probability is left as it is: an answer is not evidence about the case here. */
export function contingency(i: PolicyInput) {
  return (["denies", "confirms", "silent"] as const).map((reply) => {
    const out = decide({ ...i, reply, budgetSpent: true });
    return { reply, rules: out.rules, actions: out.actions };
  });
}
