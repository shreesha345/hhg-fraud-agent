// Runs the real demo commands and records their real output with real timings, for the video's terminal scenes.
//   node scripts/capture-terminal.mjs [--steps 1,2,3,4,5,6]
// Nothing is faked: the video replays exactly what these commands printed. Only the database address is masked.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..", "..");
const outFile = resolve(import.meta.dirname, "..", "src", "captures", "terminal.json");
mkdirSync(resolve(outFile, ".."), { recursive: true });
const si = process.argv.indexOf("--steps");
const want = (si >= 0 ? process.argv[si + 1] : "1,2,3,4,5,6").split(",");

// values to hide in the recording (read from .env, never printed)
const secrets = [];
try {
  const env = readFileSync(resolve(repo, ".env"), "utf8");
  for (const k of ["TG_HOST", "TG_SECRET"]) { const m = new RegExp(`^${k}=(.*)$`, "m").exec(env); if (m?.[1]?.trim()) secrets.push([m[1].split(/\s+#/)[0].trim(), k === "TG_HOST" ? "https://<your-workspace>.i.tgcloud.io" : "<hidden>"]); }
} catch { /* no .env: nothing to mask */ }
const mask = (t) => secrets.reduce((s, [v, r]) => (v ? s.split(v).join(r) : s), t).replace(/https:\/\/tg-[0-9a-f-]+\.tg-\d+\.i\.tgcloud\.io/g, "https://<your-workspace>.i.tgcloud.io");

const CASE = "pnpm --filter @fraud/backend run cases -- --only HHG-014 --write-graph --out data/out-demo";
const steps = {
  "1": { title: "Is the database awake?", display: "bash scripts/tg-check.sh", cmd: "bash scripts/tg-check.sh" },
  "2": { title: "Prove it with tests", display: "pnpm test", cmd: "pnpm test" },
  "3": { title: "Investigate one real alert", display: CASE, cmd: CASE },
  "4": { title: "Read the answer", display: "node video/show-case.mjs data/out-demo/HHG-014.json", cmd: "node video/show-case.mjs data/out-demo/HHG-014.json" },
  "5": { title: "Break the AI model on purpose", display: "LLM_MODEL_OLLAMA=no-such-model pnpm --filter @fraud/backend run cases -- --only HHG-019 --out data/out-fail",
    cmd: "pnpm --filter @fraud/backend run cases -- --only HHG-019 --out data/out-fail", env: { LLM_MODEL_OLLAMA: "no-such-model" } },
  "6": { title: "The backtest", display: "pnpm --filter @fraud/backend run backtest -- --limit 300", cmd: "pnpm --filter @fraud/backend run backtest -- --limit 300" },
};

const result = {};
try { Object.assign(result, JSON.parse(readFileSync(outFile, "utf8"))); } catch { /* first run */ }
for (const id of want) {
  const s = steps[id]; if (!s) continue;
  console.log(`step ${id}: ${s.display}`);
  const t0 = performance.now(), events = [];
  await new Promise((res) => {
    const p = spawn(s.cmd, { cwd: repo, shell: true, env: { ...process.env, ...(s.env ?? {}), FORCE_COLOR: "1", NO_COLOR: "" } });
    const on = (d) => events.push({ t: Math.round(performance.now() - t0), text: mask(d.toString("utf8")) });
    p.stdout.on("data", on); p.stderr.on("data", on); p.on("close", (code) => { events.push({ t: Math.round(performance.now() - t0), text: "", exit: code }); res(); });
  });
  result[id] = { title: s.title, display: s.display, events, totalMs: events[events.length - 1].t };
  console.log(`   ${events.length} chunks, ${(result[id].totalMs / 1000).toFixed(1)} s`);
  writeFileSync(outFile, JSON.stringify(result));
}
console.log("saved", outFile);
