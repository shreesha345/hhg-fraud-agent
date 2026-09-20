/**
 * Batch runner: investigates every case in the case pack and writes one answer file per case.
 *   pnpm --filter @fraud/backend run cases [-- --out <dir>] [--store tigergraph] [--write-graph] [--rag] [--only HHG-001,HHG-002]
 * Defaults: DATASET_DIR (Dataset/test) -> data/out-test/ ; any other dataset -> cases/
 * Cases run in opened_at order. Exit code 1 if any file fails validation.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { closeStore, openStore } from "./store";
import { investigate } from "./agent/orchestrator";
import { narratorFromEnv } from "./llm/narrator";
import { OllamaEmbedder } from "./rag/retriever";
import { datasetDir, ROOT } from "./config";
import { hasErrors } from "./validator/validateAnswer";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const dir = datasetDir();
const isTest = /[\\/]test$/.test(dir);
const out = resolve(ROOT, arg("--out") ?? (isTest ? "data/out-test" : "cases"));
mkdirSync(out, { recursive: true });

const store = openStore(arg("--store"), dir);
const narrator = narratorFromEnv();
const only = arg("--only")?.split(",");
console.log(`dataset ${dir}\nstore ${store.kind}\nwriting to ${out}\nnarrator ${narrator.mode}\n`);
let bad = 0;
const cases = [...store.packCases()].filter((c) => !only || only.includes(c.caseId)).sort((a, b) => a.openedAt - b.openedAt);
for (const c of cases) {
  let r: Awaited<ReturnType<typeof investigate>>;
  try {
    r = await investigate(store, c, { narrator, writeToGraph: process.argv.includes("--write-graph"), rag: process.argv.includes("--rag") ? { embedder: new OllamaEmbedder() } : undefined });
  } catch (e) {
    console.error(`
STOPPED at ${c.caseId}: ${(e as Error).message}
No answer file was written for this case.`);
    await closeStore(store);
    process.exit(1);
  }
  writeFileSync(resolve(out, `${c.caseId}.json`), JSON.stringify(r.answer, null, 2));
  const errs = r.trace.validation.filter((v) => v.level === "error");
  if (hasErrors(r.trace.validation)) bad++;
  const a = r.answer;
  console.log(
    `${c.caseId.padEnd(8)} ${a.case.verdict.padEnd(10)} p=${a.case.fraud_probability.toFixed(2)} ${a.case.pattern.padEnd(28)} $${a.case.exposure_usd.toFixed(2).padStart(8)}  ` +
      `${a.next_best_actions.final.map((x) => `${x.action}:${x.route}`).join(" ")}${errs.length ? "  !! " + errs.map((e) => e.code).join(",") : ""}`,
  );
}
console.log(bad ? `\n${bad} file(s) failed validation` : "\nall files valid");
await closeStore(store);
process.exit(bad ? 1 : 0);
