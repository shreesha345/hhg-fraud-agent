// Generates the narration with Gemini TTS, one file per segment of video/NARRATION.md.
//
//   node scripts/gemini-tts.mjs [--only 8] [--voice Charon] [--model gemini-2.5-flash-preview-tts]
//
// Reads GEMINI_API_KEY from .env (never printed). Each segment's DIRECTION line is sent as the
// style prompt and the SAY block as the words, exactly as NARRATION.md lays them out -- so the
// script stays the single source of truth. Output: narration-audio/nar-01.wav .. nar-16.wav,
// ready for `npm run narration`.
//
// Gemini TTS has no SSML; the delivery comes from the DIRECTION prompt and the punctuation.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const repo = resolve(import.meta.dirname, "..", "..", "..");
const model = arg("--model", "gemini-2.5-flash-preview-tts");
const voice = arg("--voice", "Charon");
const only = arg("--only", null);
const outDir = resolve(arg("--out", join(repo, "narration-audio")));
mkdirSync(outDir, { recursive: true });

// ---- key (read, never logged)
const env = readFileSync(join(repo, ".env"), "utf8");
const rawKey = (new RegExp("^GEMINI_API_KEY=(.*)$", "m").exec(env)?.[1] ?? "").split(/\s+#/)[0].trim();
const KEY = rawKey.replace(/^["']|["']$/g, "");
if (!KEY) { console.error("GEMINI_API_KEY is empty in .env"); process.exit(1); }

// ---- parse the segments out of NARRATION.md
const md = readFileSync(join(repo, "video", "NARRATION.md"), "utf8");
const quoted = (block) => block.split("\n").filter((l) => l.trim().startsWith(">")).map((l) => l.replace(/^\s*>\s?/, "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

const segments = [];
const secRe = /^### (S\d+)\s+—\s+(.+?)$/gm;
const heads = [...md.matchAll(secRe)];
for (let i = 0; i < heads.length; i++) {
  const body = md.slice(heads[i].index, i + 1 < heads.length ? heads[i + 1].index : md.length);
  const dirM = /\*\*DIRECTION\*\*\s*\n([\s\S]*?)\n\s*\*\*SAY\*\*/.exec(body);
  const sayM = /\*\*SAY\*\*\s*\n([\s\S]*?)(\n---|\n### |$)/.exec(body);
  if (!dirM || !sayM) { console.error(`could not parse ${heads[i][1]}`); process.exit(1); }
  segments.push({ id: heads[i][1], title: heads[i][2].split("·")[0].trim(), direction: quoted(dirM[1]), say: quoted(sayM[1]) });
}
console.log(`${segments.length} segments parsed from NARRATION.md; model ${model}, voice ${voice}`);
if (segments.length !== 16) console.log(`note: expected 16 segments for the submission cut`);

// ---- PCM -> WAV (Gemini returns raw little-endian 16-bit PCM)
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function speak(seg) {
  // One instruction line ending in a colon, then the words, on one line. Multi-sentence or
  // separated directions get spoken aloud instead of obeyed.
  const body = {
    contents: [{ parts: [{ text: `${seg.direction} ${seg.say}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4) throw new Error(`${res.status} after ${attempt + 1} tries: ${(await res.text()).slice(0, 300)}`);
      const wait = 20000 * (attempt + 1);
      console.log(`   ${res.status}; waiting ${wait / 1000}s`);
      await sleep(wait); continue;
    }
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 500)}`);
    const j = await res.json();
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    // the model sometimes returns no audio at all (finishReason OTHER). That is a failed take,
    // not a crash: report it so the caller can retry.
    if (!part) return { error: `no audio (finishReason ${j.candidates?.[0]?.finishReason ?? "?"})` };
    const rate = parseInt(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? "24000", 10);
    return wav(Buffer.from(part.inlineData.data, "base64"), rate);
  }
}

// ---- generate
const want = only ? segments.filter((s) => s.id === `S${String(only).padStart(2, "0")}`) : segments;
if (!want.length) { console.error(`no segment matched --only ${only}`); process.exit(1); }

const CPS = 13.0;           // characters per second, measured from Charon
const MAX_OVER = 1.9;       // real failures measured at 2.2x-70x; a slow-but-valid read sits under 1.9x
const MIN_UNDER = 0.45;     // much shorter => it truncated
const MIN_MEAN_DB = -32;    // quieter than this on average => near-silence, a failed generation

/** measure a generated clip: duration and mean loudness */
function inspect(file) {
  const dur = parseFloat(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout);
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const db = parseFloat(/mean_volume:\s*(-?[\d.]+) dB/.exec((log.stderr ?? "") + (log.stdout ?? ""))?.[1] ?? "NaN");
  return { dur, db };
}

let failed = 0;
for (const seg of want) {
  const n = segments.indexOf(seg) + 1;
  const file = join(outDir, `nar-${String(n).padStart(2, "0")}.wav`);
  const expect = seg.say.length / CPS;
  process.stdout.write(`${seg.id} ${seg.title.slice(0, 30).padEnd(30)} ${String(seg.say.length).padStart(4)}ch exp ${expect.toFixed(0).padStart(3)}s ... `);

  let ok = false;
  for (let take = 1; take <= 4 && !ok; take++) {
    let buf;
    try {
      buf = await speak(seg);
    } catch (e) {
      console.log(`take ${take} errored: ${String(e.message).slice(0, 120)}`);
      if (take < 4) { process.stdout.write(`${" ".repeat(4)}retrying ... `); await sleep(21000); }
      continue;
    }
    if (buf?.error) {                       // no audio came back: a failed take, retry
      console.log(`take ${take}: ${buf.error}`);
      if (take < 4) { process.stdout.write(`${" ".repeat(4)}retrying ... `); await sleep(21000); }
      continue;
    }
    writeFileSync(file, buf);
    const { dur, db } = inspect(file);
    const ratio = dur / expect;
    const bad = ratio > MAX_OVER ? `too long (${ratio.toFixed(1)}x: it likely read the direction)`
      : ratio < MIN_UNDER ? `too short (${ratio.toFixed(1)}x: truncated)`
      : db < MIN_MEAN_DB ? `too quiet (${db.toFixed(1)} dB: near-silence)` : null;
    if (!bad) { console.log(`${dur.toFixed(1)}s ${db.toFixed(0)}dB ok${take > 1 ? ` (take ${take})` : ""}`); ok = true; break; }
    console.log(`${dur.toFixed(1)}s ${db.toFixed(0)}dB REJECTED: ${bad}`);
    if (take < 4) { process.stdout.write(`${" ".repeat(4)}retrying ... `); await sleep(21000); }
  }
  if (!ok) {
    // never leave a bad clip on disk where the ingest would pick it up
    if (existsSync(file)) rmSync(file);
    console.log(`   ${seg.id} still bad after 4 takes; removed ${file.replace(repo, ".")} -- retry: npm run tts -- --only ${n}`);
    failed++;
  }
  if (want.length > 1) await sleep(21000); // free tier is a few requests per minute
}
if (failed) {
  console.log(`\n${failed} segment(s) need another go -- NOT safe to render.`);
  process.exitCode = 1;   // stop any pipeline chained after this
}
console.log(`\ndone -> ${outDir}\nNext:  cd video/remotion && npm run narration -- --in ${outDir.replace(repo, "../..")} && npm run render && npm run srt`);
