import { datasetDir } from "../config";
import type { GraphStore } from "./GraphStore";
import { InMemoryStore } from "./InMemoryStore";
import { TigerGraphStore } from "./TigerGraphStore";

/** STORE=memory (default) reads the CSV files; STORE=tigergraph reads the cloud graph through the TigerGraph MCP server.
 *  The synthetic test folder maps to TG_GRAPH_TEST (FraudTest), the real data to TG_GRAPH (FraudGraph). */
export function openStore(kind: string = process.env.STORE ?? "memory", dir: string = datasetDir()): GraphStore {
  if (kind !== "tigergraph") return InMemoryStore.load(dir);
  const isTest = /(^|[\\/])test$/.test(dir);
  const graph = isTest ? (process.env.TG_GRAPH_TEST ?? "FraudTest") : (process.env.TG_GRAPH ?? "FraudGraph");
  return new TigerGraphStore({ graph, datasetDir: dir });
}

export const closeStore = async (s: GraphStore): Promise<void> => { await (s as { close?: () => Promise<void> }).close?.(); };
