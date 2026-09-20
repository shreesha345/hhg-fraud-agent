import { afterAll } from "vitest";
import { closeStores } from "./helpers";

// A TigerGraph store owns an MCP sidecar process; close it so the worker can exit.
afterAll(async () => { await closeStores(); });
