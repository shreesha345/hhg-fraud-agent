/**
 * Everyday-language names for everything a person sees: verdicts, fraud patterns, actions, approval routes,
 * evidence kinds and the agent's steps. Used by the backend (live step messages) and the console.
 * The technical names (BLOCK_CARD, card_not_present_new_device, R2 ...) stay in the answer files; this is only for people.
 */

export const VERDICT_PLAIN: Record<string, string> = {
  fraud: "Likely fraud",
  uncertain: "Not sure yet",
  legitimate: "Looks genuine",
};

export const VERDICT_SENTENCE: Record<string, string> = {
  fraud: "The evidence points to fraud.",
  uncertain: "The evidence is mixed, so a person should look before anything drastic is done.",
  legitimate: "This looks like normal activity by the real cardholder.",
};

export const PATTERN_PLAIN: Record<string, string> = {
  card_testing: "Card testing: tiny test payments, then a big one",
  card_not_present_fraud: "Stolen card details used online",
  card_not_present_new_device: "Stolen card details used online from a device never seen before",
  out_of_region_use: "Card used in a place the owner does not normally go, while they keep using it at home",
  account_takeover: "Someone took over the customer's account",
  undocumented: "A pattern the bank has no name for yet",
  none: "No fraud pattern",
};

export const ACTION_PLAIN: Record<string, string> = {
  ALLOW_TRANSACTION: "Let the payment go through",
  MONITOR_CARD: "Keep a close eye on this card",
  MONITOR_CONNECTED_CARDS: "Keep a close eye on the other cards linked to this",
  WARN_CUSTOMER: "Warn the customer",
  VERIFY_WITH_CUSTOMER: "Ask the customer to confirm the payment",
  STEP_UP_AUTH: "Ask for an extra security check",
  GENERATE_REPORT: "Prepare a report",
  CREATE_CASE: "Open an investigation case",
  ESCALATE_TO_ANALYST: "Pass it to a human analyst",
  CLOSE_NO_FRAUD: "Close it: no fraud",
  DECLINE_TRANSACTION: "Refuse this payment",
  BLOCK_CARD: "Block the card",
  BLOCK_ALL_CARDS: "Block all of the customer's cards",
  FILE_REPORT: "File a report with the regulator",
};

export const ROUTE_PLAIN: Record<string, string> = {
  auto: "The agent can do this on its own",
  L1: "Needs a team lead to approve",
  L2: "Needs a fraud manager to approve",
};

export const TRIGGER_PLAIN: Record<string, string> = {
  risk_score: "The bank's system flagged it",
  customer_report: "The customer complained",
  analyst_request: "An analyst asked for a check",
};

/** What kinds of evidence exist. Two facts of the same kind count once, so this is what "independent" means. */
export const CLASS_PLAIN: Record<string, string> = {
  bank_score: "the bank's risk score",
  card_behaviour: "how this card is normally used",
  device: "the device that was used",
  geography: "where the card was used",
  network: "links to other cards",
  memory: "similar past cases",
  numeric_lookalike: "look-alike transactions",
  customer_reply: "what the customer said",
  policy: "the bank's own rules",
};

export const SIGNATURE_PLAIN: Record<string, string> = {
  test_then_spend: "Tiny test payments, then a big one",
  off_profile_burst: "Several unusual online purchases in a short time",
  new_device: "A device never seen on this account",
  new_device_at_high_score: "A new device (often just a new phone)",
  threshold_hugging: "Purchases kept just under a limit",
  shared_rare_fingerprint: "A rare device used across many different cards",
  out_of_region_home_continues: "Used far away while the owner keeps spending at home",
  trip_continuity: "Looks like a real trip",
  device_succession: "Looks like the customer got a new phone",
  recurring_cadence: "A regular repeating charge",
  baseline_consistent: "Normal for this card",
  bank_score: "The bank's risk score",
  customer_report: "The customer says it was not them",
  memory_recall: "Similar past cases",
};

/** The agent's steps in the order a person should read them: what it is doing and why. */
export const STEP_PLAIN: Record<string, { name: string; why: string }> = {
  intake: { name: "Read the alert", why: "Looks at the flagged payment and the card's history, using only what was known when the alert opened." },
  prosecution: { name: "Look for signs of fraud", why: "Checks the card's history for known fraud tricks." },
  defence: { name: "Look for signs it is innocent", why: "Checks for honest explanations, like a trip or a new phone, so real customers are not blocked by mistake." },
  sweep: { name: "Check links to other cards", why: "Looks for other cards tied to fraud through the same device, whatever the bank score says." },
  recall: { name: "Compare with past cases", why: "Finds earlier investigations that look similar and how they ended." },
  judge: { name: "Weigh everything", why: "Adds up the signs for and against into one chance that this is fraud." },
  stop_check: { name: "Is that enough to decide?", why: "Stops when the evidence is strong, or decides what to ask next." },
  plan: { name: "Decide what to ask", why: "If unsure, picks the most useful extra check." },
  checkpoint: { name: "Save the first recommendation", why: "Records what it would do now, before any extra information." },
  reply: { name: "The customer's answer", why: "The customer's answer is not in the data, so nothing is made up unless you choose a what-if." },
  policy: { name: "Apply the bank's rules", why: "Fixed rules, not the AI, decide which actions are allowed and who must approve." },
  explain: { name: "Write the summary", why: "The AI only puts the findings into plain words." },
  sar: { name: "Write the regulator report", why: "Needed when fraud is confirmed or strongly suspected." },
  learn: { name: "Save the case in the graph", why: "Stores the case, its evidence and its actions in the database." },
  validate: { name: "Double-check the answer", why: "Checks every ID exists and every rule was followed." },
  done: { name: "Finished", why: "" },
  error: { name: "Something went wrong", why: "" },
};

const pct = (p: number): string => `${Math.round(p * 100)}%`;
export const chance = (p: number): string => pct(p);

export function howSure(p: number): string {
  if (p >= 0.85) return "Very likely fraud";
  if (p >= 0.7) return "Probably fraud";
  if (p > 0.3) return "Could go either way";
  if (p > 0.15) return "Probably genuine";
  return "Very likely genuine";
}

export const plainClass = (c: string): string => CLASS_PLAIN[c] ?? c.replace(/_/g, " ");
export const plainAction = (a: string): string => ACTION_PLAIN[a] ?? a.replace(/_/g, " ").toLowerCase();
