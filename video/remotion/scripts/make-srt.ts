// Writes the narration subtitles as SRT, straight from the video's own timeline,
// so the timings are exactly the ones the renderer uses.
//
//   npm run srt            -> out/fraud-investigator.srt
//
// Re-run this whenever the narration changes (after `npm run narration`), because
// every cue is anchored to the real length of the audio clips.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FPS, PLAN } from "../src/plan";

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
const stamp = (sec: number) => {
  const ms = Math.round(sec * 1000);
  return `${pad(ms / 3600000)}:${pad((ms % 3600000) / 60000)}:${pad((ms % 60000) / 1000)},${pad(ms % 1000, 3)}`;
};

const LINE = 42;      // characters per line
const MAX = LINE * 2; // a cue is at most two lines; longer sentences become several cues

/** break a long sentence into readable chunks, on word boundaries */
function chunk(t: string): string[] {
  if (t.length <= MAX) return [t];
  const n = Math.ceil(t.length / MAX);
  const target = Math.ceil(t.length / n);
  const out: string[] = [];
  let cur = "";
  for (const w of t.split(" ")) {
    if (cur && (cur + " " + w).length > target && out.length < n - 1) { out.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

interface Cue { start: number; end: number; text: string }
const cues: Cue[] = [];

for (const scene of PLAN.scenes) {
  for (const clip of scene.clips) {
    const start = (scene.start + clip.start) / FPS;
    // the clip's real audio length, not its padded frame count
    const dur = clip.dur || clip.frames / FPS;
    const text = clip.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    // share the clip's time between its chunks, in proportion to how much text each carries
    const parts = chunk(text);
    const total = parts.reduce((a, s) => a + s.length, 0);
    let at = start;
    for (const part of parts) {
      const d = dur * (part.length / total);
      cues.push({ start: at, end: at + d, text: part });
      at += d;
    }
  }
}

cues.sort((a, b) => a.start - b.start);

// never let one cue run into the next
for (let i = 0; i < cues.length - 1; i++) {
  if (cues[i].end > cues[i + 1].start - 0.04) cues[i].end = Math.max(cues[i].start + 0.4, cues[i + 1].start - 0.04);
}

/** two lines at most, split near the middle on a word boundary */
function wrap(t: string, max = 42): string {
  if (t.length <= max) return t;
  const words = t.split(" ");
  let best = "", bestD = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const d = Math.abs(a.length - b.length) + (Math.max(a.length, b.length) > max ? 100 : 0);
    if (d < bestD) { bestD = d; best = `${a}\n${b}`; }
  }
  return best || t;
}

const srt = cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${wrap(c.text)}\n`).join("\n");
const out = resolve(import.meta.dirname, "..", "out", "fraud-investigator.srt");
writeFileSync(out, srt, "utf8");

const last = cues[cues.length - 1];
console.log(`${cues.length} cues, last ends ${stamp(last.end)} (video ${stamp(PLAN.total / FPS)}) -> ${out}`);
