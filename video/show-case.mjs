// Pretty-prints one answer file for the demo video:  node video/show-case.mjs data/out-demo/HHG-014.json
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node video/show-case.mjs <answer.json>"); process.exit(1); }
const a = JSON.parse(readFileSync(file, "utf8"));
const c = a.case;

const on = process.stdout.isTTY || Boolean(process.env.FORCE_COLOR);
const col = (n) => (s) => (on ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const bold = col("1"), dim = col("2"), red = col("31;1"), green = col("32;1"), yellow = col("33;1"), cyan = col("36;1");

const VERDICT = { fraud: red("LIKELY FRAUD"), uncertain: yellow("NOT SURE YET"), legitimate: green("LOOKS GENUINE") };
const PLAIN = {
  BLOCK_CARD: "Block the card", CREATE_CASE: "Open an investigation case", ESCALATE_TO_ANALYST: "Pass it to a human analyst",
  FILE_REPORT: "File a report with the regulator", MONITOR_CARD: "Keep a close eye on this card", MONITOR_CONNECTED_CARDS: "Keep a close eye on the linked cards",
  DECLINE_TRANSACTION: "Refuse this payment", VERIFY_WITH_CUSTOMER: "Ask the customer to confirm", WARN_CUSTOMER: "Warn the customer",
  ALLOW_TRANSACTION: "Let the payment go through", CLOSE_NO_FRAUD: "Close it: no fraud", STEP_UP_AUTH: "Ask for an extra security check", BLOCK_ALL_CARDS: "Block all the customer's cards",
};
const WHO = { auto: green("agent can do this alone"), L1: yellow("needs a TEAM LEAD"), L2: red("needs a FRAUD MANAGER") };
const wrap = (t, w = 100, pad = "    ") => t.replace(new RegExp(`(.{1,${w}})(\\s+|$)`, "g"), `${pad}$1\n`).trimEnd();

console.log(bold(`  ${a.case_id}`) + dim("   answer file written by the agent"));
console.log(`  ${VERDICT[c.verdict] ?? c.verdict}   ${bold(Math.round(c.fraud_probability * 100) + "% chance of fraud")}   ${dim("pattern: " + c.pattern.replace(/_/g, " "))}`);
if (c.exposure_usd) console.log(`  Money at risk: ${bold("$" + c.exposure_usd.toFixed(2))} across ${c.affected_txn_ids.length} payment(s)`);
console.log("");
console.log(cyan("  What the agent found") + dim(`   (${c.evidence.length} pieces of evidence)`));
for (const e of c.evidence.filter((x) => x.source === "graph").slice(0, 2)) console.log(wrap(`• ${e.claim.length > 170 ? e.claim.slice(0, 167) + "..." : e.claim}`, 96, "    ").replace(/^ {4}•/, "   •"));
console.log("");
console.log(cyan("  What to do next") + dim("   (chosen by the bank's rules, not by the AI)"));
for (const x of a.next_best_actions.final) console.log(`    ${bold((PLAIN[x.action] ?? x.action).padEnd(38))} ${WHO[x.route]}`);
console.log("");
console.log(cyan("  Summary written by the AI model"));
console.log(wrap(c.summary.length > 300 ? c.summary.slice(0, 297) + "..." : c.summary, 96));
console.log("");
console.log(dim(`  ${a.tool_calls} database calls · ${a.latency_s.toFixed(1)} s · ${a.tokens} AI tokens · saved in the graph as ${c.graph_case_id || "(not saved)"}`));
console.log("");
