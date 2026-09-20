// Builds a printable script from the single source of truth:  node video/make-script-md.mjs > video/SCRIPT.md
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync(new URL("../frontend/public/video-script.json", import.meta.url), "utf8"));
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const RUN = 8; // seconds allowed for typing and running one demo command, on top of talking

function seconds(c, cut) {
  if (c.type === "demo") {
    const cues = c.cues.filter((q) => cut === "full" || q.short);
    return ((words(cut === "full" ? c.text : c.shortText ?? c.text) + cues.reduce((a, q) => a + words(cut === "full" ? q.say : q.shortSay ?? q.say), 0)) / s.wpm) * 60 + cues.length * RUN;
  }
  return (words(cut === "full" ? c.text : c.short ?? c.text) / s.wpm) * 60;
}

let short = 0, full = 0;
let out = `# ${s.title}\n\nTeleprompter script at ${s.wpm} words per minute. Two editions from one source:\n\n- **Submission cut (about 3 minutes)**: the condensed text of the CORE chapters, and the demo steps marked SHORT. The hackathon asks for 3 to 5 minutes.\n- **Full detailed edition**: the long text of every chapter, including the deep dives, and all demo steps.\n\n`;
for (const c of s.chapters) {
  const sShort = c.core ? seconds(c, "short") : 0, sFull = seconds(c, "full");
  short += sShort; full += sFull;
  out += `## ${c.title}  ·  ${c.core ? `submission ${fmt(sShort)}  ·  ` : "full edition only  ·  "}full ${fmt(sFull)}\n\n`;
  if (c.core && c.short) out += `**Submission cut:** ${c.short}\n\n**Full edition:** ${c.text}\n\n`;
  else out += `${c.text}\n\n`;
  if (c.type === "demo") for (const q of c.cues) out += `**${q.title}**${q.short ? "  (SHORT)" : ""}${q.command ? `\n\n    ${q.command}` : ""}\n\n> ${q.say}\n\n`;
}
out += `---\nTotal: submission cut about ${fmt(short)}, full detailed edition about ${fmt(full)}.\n`;
process.stdout.write(out);
