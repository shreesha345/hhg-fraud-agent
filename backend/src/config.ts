import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Repo root, derived from this file's location (backend/src/config.ts). */
export const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * .env is the control panel: which database, which AI model, where the data is. Values already set in the real environment win.
 * Under the tests (VITEST) nothing is loaded, so a test run never depends on someone's .env.
 * Secrets are read into the process environment only, never logged.
 */
export function loadDotEnv(file = resolve(ROOT, ".env")): void {
  if (process.env.VITEST || !existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^["']/.test(value)) value = value.slice(1, value.lastIndexOf(value[0]));
    else value = value.split(/\s+#/)[0].trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

/** Folder with the slim CSVs. Set DATASET_DIR in .env (data/slim is the real data). */
export function datasetDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(ROOT, env.DATASET_DIR ?? "data/slim");
}
