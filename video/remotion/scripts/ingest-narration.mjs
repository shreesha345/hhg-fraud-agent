// Takes the narration you generated with Gemini TTS and builds the video's timeline from it.
//
//   node scripts/ingest-narration.mjs --in <folder>
//
// Expects one file per segment of video/NARRATION.md, named nar-01 ... nar-16 (.mp3 or .wav),
// matching the 16 scenes of the submission cut in order.
//
// For each segment it measures the REAL length, cuts the audio into one piece per sentence
// (on the silences the narrator actually left, falling back to a proportional cut if the
// silences do not line up), and writes src/timeline.short.json. The rest of the pipeline is
// unchanged: `npm run render` then times every animation to your audio.
//
// Nothing here re-times or pitch-shifts your voice. It only measures and cuts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const inDir = resolve(arg("--in", resolve(import.meta.dirname, "..", "..", "narration-audio")));
const root = resolve(import.meta.dirname, "..");
const outDir = join(root, "public", "audio");
mkdirSync(outDir, { recursive: true });

const script = JSON.parse(readFileSync(resolve(root, "..", "..", "frontend", "public", "video-script.json"), "utf8"));
const sentences = (t) => t.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [t];

// ---- the words that were actually SPOKEN come from NARRATION.md, which is what the audio was
// generated from. The captions and the SRT must match the voice, and the audio must be cut on the
// sentence boundaries of the text that was read -- not on a differently-worded copy.
const md = readFileSync(resolve(root, "..", "NARRATION.md"), "utf8");
const quoted = (b) => b.split("\n").filter((l) => l.trim().startsWith(">")).map((l) => l.replace(/^\s*>\s?/, "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
const heads = [...md.matchAll(/^### (S\d+)\s+—\s+(.+?)$/gm)];
const spoken = heads.map((h, i) => {
  const body = md.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : md.length);
  return quoted(/\*\*SAY\*\*\s*\n([\s\S]*?)(\n---|\n### |$)/.exec(body)[1]);
});

// ---- the 16 scenes of the submission cut; structure from the script, words from NARRATION.md
const scenes = [];
for (const c of script.chapters) {
  if (!c.core) continue;
  scenes.push({ kind: c.type === "demo" ? "demo-intro" : "talk", chapterId: c.id, visual: c.visual, title: c.title });
  if (c.type === "demo") for (const q of c.cues) if (q.short) scenes.push({ kind: "cue", chapterId: c.id, visual: "demo", title: q.title, command: q.command });
}
if (scenes.length !== spoken.length) {
  console.error(`\n${scenes.length} scenes but ${spoken.length} segments in NARRATION.md -- they must match one to one.`);
  process.exit(1);
}
scenes.forEach((s, i) => { s.texts = sentences(spoken[i]); });
console.log(`${scenes.length} scenes expected: nar-01 .. nar-${String(scenes.length).padStart(2, "0")}`);

// ---- find the audio file for each segment
const have = existsSync(inDir) ? readdirSync(inDir) : [];
const fileFor = (i) => {
  const stem = `nar-${String(i + 1).padStart(2, "0")}`;
  const f = have.find((x) => x.toLowerCase().startsWith(stem) && /\.(mp3|wav|m4a|ogg|flac)$/i.test(x));
  return f ? join(inDir, f) : null;
};
const missing = scenes.map((_, i) => (fileFor(i) ? null : i + 1)).filter(Boolean);
if (missing.length) {
  console.error(`\nMissing audio in ${inDir} for segment(s): ${missing.join(", ")}`);
  console.error(`Expected names like nar-01.mp3 ... nar-${String(scenes.length).padStart(2, "0")}.mp3 (see video/NARRATION.md).`);
  process.exit(1);
}

const ffprobe = (f) => parseFloat(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout);

/** where the narrator actually paused, from ffmpeg's silencedetect */
function silences(file, noiseDb = -34, minS = 0.22) {
  const r = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minS}`, "-f", "null", "-"], { encoding: "utf8" });
  const log = (r.stderr ?? "") + (r.stdout ?? "");
  const out = [];
  const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
  let m; while ((m = re.exec(log))) out.push({ start: +m[1], end: +m[2] });
  return out;
}

/** cut points for n sentences: prefer the narrator's own pauses, weighted to where the text says they should be */
function cutPoints(file, dur, texts) {
  const n = texts.length;
  if (n <= 1) return [];
  const w = texts.map((t) => t.length), tot = w.reduce((a, b) => a + b, 0);
  const wanted = []; let acc = 0;
  for (let i = 0; i < n - 1; i++) { acc += w[i]; wanted.push((acc / tot) * dur); }

  const gaps = silences(file).filter((g) => g.start > 0.25 && g.end < dur - 0.25);
  if (gaps.length < n - 1) {
    console.log(`     ${gaps.length} pause(s) for ${n} sentences -> proportional cut`);
    return wanted;
  }
  // Pick, for each wanted point, the nearest real pause, never going backwards.
  // Cut near the END of the pause (not its middle) so the trailing silence stays with the sentence
  // that just finished, and the next clip starts close to where the voice actually starts again.
  const at = (g) => g.start + (g.end - g.start) * 0.82;
  const picked = []; let from = 0;
  for (const target of wanted) {
    let best = null, bestD = Infinity;
    for (const g of gaps) { const c = at(g); if (c <= from + 0.15) continue; const d = Math.abs(c - target); if (d < bestD) { bestD = d; best = c; } }
    if (best === null) { picked.push(Math.max(from + 0.2, target)); from = picked.at(-1); continue; }
    picked.push(best); from = best;
  }
  return picked;
}

/** loudness envelope, 30 values per second (kept so existing scenes that use it still work) */
function envelope(file) {
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"], { maxBuffer: 1 << 28 });
  if (!raw.stdout?.length) return [];
  const pcm = new Int16Array(raw.stdout.buffer, raw.stdout.byteOffset, Math.floor(raw.stdout.length / 2));
  const win = Math.round(8000 / 30), env = [];
  for (let i = 0; i + win <= pcm.length; i += win) { let s = 0; for (let k = 0; k < win; k++) s += pcm[i + k] ** 2; env.push(Math.sqrt(s / win)); }
  const sorted = env.slice().sort((a, b) => a - b);
  const peak = Math.max(1, ...sorted.slice(Math.floor(env.length * 0.9)));
  return env.map((v) => Math.round(Math.min(1, v / peak) * 100) / 100);
}

// ---- cut each segment into one clip per sentence
let clipN = 0, totalS = 0;
const out = [];
for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i], src = fileFor(i), dur = ffprobe(src);
  if (!Number.isFinite(dur)) throw new Error(`could not read a duration from ${src} (is ffprobe on PATH?)`);
  console.log(`nar-${String(i + 1).padStart(2, "0")}  ${dur.toFixed(1)}s  ${s.texts.length} sentence(s)  ${s.title.slice(0, 44)}`);

  const cuts = [0, ...cutPoints(src, dur, s.texts), dur];
  const clips = [];
  for (let k = 0; k < s.texts.length; k++) {
    const from = cuts[k], to = cuts[k + 1];
    const id = `gem-${String(clipN++).padStart(3, "0")}`;
    const dst = join(outDir, `${id}.mp3`);
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-ss", String(from), "-to", String(to), "-ac", "1", "-ar", "44100", "-b:a", "160k", dst]);
    if (r.status !== 0 || !existsSync(dst)) throw new Error(`ffmpeg failed cutting ${src} [${from}-${to}]`);
    const d = ffprobe(dst);
    clips.push({ id, text: s.texts[k], file: `audio/${id}.mp3`, dur: d, env: envelope(dst) });
    totalS += d;
  }
  out.push({ kind: s.kind, chapterId: s.chapterId, visual: s.visual, title: s.title, command: s.command, clips });
}

writeFileSync(join(root, "src", "timeline.short.json"), JSON.stringify({ edition: "short", voice: "gemini-tts", scenes: out }));
console.log(`\n${clipN} clips, ${totalS.toFixed(1)} s of narration, ${out.length} scenes -> src/timeline.short.json`);
console.log(`Now run:  npm run render`);
