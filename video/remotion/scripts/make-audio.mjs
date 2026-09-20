// Narration: turns the script into one neural-voice clip per sentence (Microsoft Edge TTS through `uvx edge-tts`),
// measures each clip's exact length with ffprobe, and extracts a loudness envelope (30 values per second) so the avatar's mouth
// follows the REAL audio.   node scripts/make-audio.mjs [--edition short|full] [--voice en-US-AriaNeural]
// Only the (public) script text is sent to Microsoft's text-to-speech service; nothing else.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const edition = arg("--edition", "short");
const voice = arg("--voice", "en-US-AriaNeural");
const rate = arg("--rate", "+0%");
const root = resolve(import.meta.dirname, "..");
const script = JSON.parse(readFileSync(resolve(root, "..", "..", "frontend", "public", "video-script.json"), "utf8"));
const outDir = join(root, "public", "audio");
mkdirSync(outDir, { recursive: true });

const sentences = (t) => t.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [t];
const short = edition === "short";

// ---- scenes: one per chapter; a demo chapter becomes an intro plus one scene per demo step
const scenes = [];
for (const c of script.chapters) {
  if (short && !c.core) continue;
  const body = c.type === "demo" ? (short ? c.shortText ?? c.text : c.text) : short ? c.short ?? c.text : c.text;
  scenes.push({ kind: c.type === "demo" ? "demo-intro" : "talk", chapterId: c.id, visual: c.visual, title: c.title, texts: sentences(body) });
  if (c.type === "demo") for (const q of c.cues) if (!short || q.short) scenes.push({ kind: "cue", chapterId: c.id, visual: "demo", title: q.title, command: q.command, texts: sentences(short ? q.shortSay ?? q.say : q.say) });
}

// ---- synthesise every clip (4 at a time), reusing files whose text has not changed
const clips = [];
scenes.forEach((s, si) => s.texts.forEach((text, ti) => clips.push({ si, ti, text, id: `${edition}-${String(clips.length).padStart(3, "0")}` })));
const hash = (t) => createHash("sha1").update(`${voice}|${rate}|${t}`).digest("hex").slice(0, 10);

function synth(clip) {
  return new Promise((res, rej) => {
    const file = join(outDir, `${clip.id}.mp3`), stamp = join(outDir, `${clip.id}.txt`);
    if (existsSync(file) && existsSync(stamp) && readFileSync(stamp, "utf8") === hash(clip.text)) return res();
    const tmp = join(tmpdir(), `tts-${clip.id}.txt`); writeFileSync(tmp, clip.text, "utf8");
    const p = spawn("uvx", ["edge-tts", "--voice", voice, `--rate=${rate}`, "--file", tmp, "--write-media", file], { stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
    let err = ""; p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 && existsSync(file) ? (writeFileSync(stamp, hash(clip.text)), res()) : rej(new Error(`edge-tts failed for ${clip.id}: ${err.slice(-200)}`))));
  });
}
let next = 0, done = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < clips.length) { const c = clips[next++]; for (let a = 0; ; a++) { try { await synth(c); break; } catch (e) { if (a >= 2) throw e; } } process.stdout.write(`\rsynthesised ${++done}/${clips.length}`); }
}));
console.log();

// ---- measure length and loudness
function measure(clip) {
  const file = join(outDir, `${clip.id}.mp3`);
  const d = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const dur = parseFloat(d.stdout);
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"], { maxBuffer: 1 << 28 });
  const pcm = new Int16Array(raw.stdout.buffer, raw.stdout.byteOffset, Math.floor(raw.stdout.length / 2));
  const win = Math.round(8000 / 30), env = [];
  for (let i = 0; i + win <= pcm.length; i += win) { let s = 0; for (let k = 0; k < win; k++) s += pcm[i + k] ** 2; env.push(Math.sqrt(s / win)); }
  const peak = Math.max(1, ...env.slice().sort((a, b) => a - b).slice(Math.floor(env.length * 0.9))) ;
  return { dur, env: env.map((v) => Math.round(Math.min(1, v / peak) * 100) / 100) };
}
const out = scenes.map((s) => ({ ...s, texts: undefined, clips: [] }));
for (const c of clips) { const m = measure(c); out[c.si].clips.push({ id: c.id, text: c.text, file: `audio/${c.id}.mp3`, dur: m.dur, env: m.env }); }
const total = out.reduce((a, s) => a + s.clips.reduce((b, c) => b + c.dur, 0), 0);
writeFileSync(join(root, "src", `timeline.${edition}.json`), JSON.stringify({ edition, voice, scenes: out }));
console.log(`${edition}: ${clips.length} clips, ${total.toFixed(1)} s of narration, ${out.length} scenes -> src/timeline.${edition}.json`);
