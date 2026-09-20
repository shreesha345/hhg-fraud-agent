import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { InMemoryStore } from "../src/store/InMemoryStore";
import { TigerGraphStore } from "../src/store/TigerGraphStore";
import type { GraphStore } from "../src/store/GraphStore";
import { ROOT } from "../src/config";

/** The synthetic dataset planted in Dataset/test (see Dataset/test/README.md). Never the real data. */
export const TEST_DIR = resolve(ROOT, "Dataset", "test");
/** STORE=tigergraph runs every suite against the FraudTest graph in TigerGraph (through the MCP server) instead of the in-memory CSV store. */
export const STORE_KIND: "memory" | "tigergraph" = process.env.STORE === "tigergraph" ? "tigergraph" : "memory";
const made: GraphStore[] = [];
export function loadTestStore(): GraphStore {
  const s: GraphStore = STORE_KIND === "tigergraph"
    ? new TigerGraphStore({ graph: process.env.TG_GRAPH_TEST ?? "FraudTest", datasetDir: TEST_DIR })
    : InMemoryStore.load(TEST_DIR);
  made.push(s);
  return s;
}
export const closeStores = async (): Promise<void> => { await Promise.all(made.map((s) => (s as { close?: () => Promise<void> }).close?.())); };

export interface Expectation {
  pattern?: string;
  pattern_in?: string[];
  verdict?: string;
  verdict_in?: string[];
  affected?: string[] | number[];
  affected_include?: (string | number)[];
  exposure?: number;
  initial_has?: string[];
  initial_hasnt?: string[];
  final_has?: string[];
  final_hasnt?: string[];
  routes?: Record<string, string>;
  connected_cards_include?: string[];
  connected_cards_exclude?: string[];
  why: string;
}
export const expected = (): Record<string, Expectation> => JSON.parse(readFileSync(resolve(TEST_DIR, "expected.json"), "utf8"));
