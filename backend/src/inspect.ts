/** Debug helper: `DATASET_DIR=data/slim pnpm --filter @fraud/backend run inspect HHG-014 HHG-006` prints the signatures that drove each case. */
import { InMemoryStore } from "./store/InMemoryStore";
import { investigate } from "./agent/orchestrator";
import { DecisionOnlyNarrator } from "./llm/narrator";
import { datasetDir } from "./config";
const store = InMemoryStore.load(datasetDir());
for (const id of process.argv.slice(2)) {
  const c = store.packCases().find((p) => p.caseId === id)!;
  const r = await investigate(store, c, { narrator: new DecisionOnlyNarrator() });
  console.log(`\n== ${id} p=${r.trace.assessment.p} classes=${JSON.stringify(r.trace.assessment.classes)}`);
  for (const s of r.trace.signatures.filter((x) => x.fired)) console.log(`  ${s.side.padEnd(11)} ${s.name.padEnd(28)} ${String(s.logLr).padStart(6)}  ${s.claim.slice(0, 110)}`);
}
