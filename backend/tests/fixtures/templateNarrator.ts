/**
 * TEST FIXTURE ONLY. A deterministic writer used by the automated tests so they do not depend on a model.
 * The running app never uses it: the app's text always comes from the AI model, and if the model fails the case stops with an error.
 */
import type { Brief, NarrationResult, Narrator } from "../../src/llm/narrator";

const oneSentence = (t: string): string => t.trim().replace(/[.!?]+\s+/g, "; ").replace(/[.!?]+$/, "");
const usd = (n: number): string => `$${n.toFixed(2)}`;
const list = (a: string[]): string => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

// ------------------------------------------------------------------ deterministic template
export function templateExplain(b: Brief): string {
  const verdictText = b.verdict === "fraud" ? `likely fraud (${b.pattern.replace(/_/g, " ")})` : b.verdict === "legitimate" ? "likely legitimate" : "uncertain";
  const top = b.evidence.filter((e) => e.source === "graph").slice(0, 2).map((e) => oneSentence(e.claim));
  const s: string[] = [`Assessment: ${verdictText}, fraud probability ${b.probability.toFixed(2)}.`];
  if (top.length) s.push(`Key evidence: ${top.join("; ")}.`);
  if (b.affected.length && b.verdict !== "legitimate") s.push(`${b.affected.length} transaction(s) totalling ${usd(b.exposure)} are treated as one episode.`);
  s.push(`Recommended: ${list(b.final.map((a) => `${a.action} (${a.route})`))}${b.rules.length ? `, under ${b.rules.join(", ")}` : ""}.`);
  s.push(b.whatChanged === "nothing" ? "No additional evidence was needed, so the recommendation did not change." : b.whatChanged);
  return s.slice(0, 6).join(" ");
}

export function templateSar(b: Brief): string {
  const [first, last] = b.activityDates.length === 2 ? b.activityDates : ["an unknown date", "an unknown date"];
  const s: string[] = [];
  s.push(`Subject: customer ${b.customer}, holder of card ${b.cardLabel}.`);
  s.push(`Between ${first} and ${last}, ${b.affected.length} transaction(s) totalling ${usd(b.exposure)} were identified as suspicious activity on this card.`);
  const channels = [...new Set(b.affected.map((t) => (t.channel === "online" ? "online" : "card-present")))];
  const regions = [...new Set(b.affected.map((t) => t.region).filter((r) => r !== null))];
  s.push(`The activity took place ${list(channels)}${regions.length ? ` in billing region(s) ${list(regions.map(String))}` : ""}, with individual amounts of ${list(b.affected.slice(0, 6).map((t) => usd(t.amt)))}.`);
  if (b.devices.length) s.push(`It originated from device profile ${list(b.devices.slice(0, 2).map((d) => `"${d}"`))}.`);
  const graph = b.evidence.filter((e) => e.source === "graph").slice(0, 3);
  s.push(`The activity is suspicious because ${graph.length ? graph.map((e) => oneSentence(e.claim)).join("; ") : "the evidence gathered does not fit the cardholder's history"}.`);
  s.push(`It was identified as ${b.pattern === "undocumented" ? "an undocumented pattern" : b.pattern.replace(/_/g, " ")}${b.patternDescription ? `: ${oneSentence(b.patternDescription)}` : ""}.`);
  if (b.connectedCards.length) s.push(`The same shared element links ${b.connectedCards.length} other card(s): ${list(b.connectedCards.slice(0, 6))}.`);
  s.push(`The bank's internal case ${b.caseId} records the investigation and the evidence relied on.`);
  s.push(`Recommended actions: ${list(b.final.map((a) => a.action))}.`);
  s.push(`Total suspicious amount: ${usd(b.exposure)}.`);
  return s.join(" ");
}

export class TemplateNarrator implements Narrator {
  readonly mode = "template" as const;
  readonly model = undefined;
  async explain(b: Brief): Promise<NarrationResult> { return { text: templateExplain(b), tokens: 0, fellBack: false }; }
  async sar(b: Brief): Promise<NarrationResult> { return { text: templateSar(b), tokens: 0, fellBack: false }; }
}

