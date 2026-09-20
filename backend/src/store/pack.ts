import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type { TriggerType } from "@fraud/shared";
import { ms, type PackCase } from "../domain/types";

const num = (s: string | undefined): number | null => (s === undefined || s === "" || s === "nan" || s === "NaN" ? null : Number(s));

/** The case pack (the alerts to investigate) is an input file, not graph data, so both stores read it from the dataset folder. */
export function loadPack(dir: string): PackCase[] {
  const rows = parse(readFileSync(join(dir, "case_pack.csv")), { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  return rows.map((r) => ({
    caseId: r.case_id, openedAt: ms(r.opened_at), openedAtRaw: r.opened_at, trigger: r.trigger_type as TriggerType, triggerText: r.trigger_text,
    flaggedTxnId: r.flagged_txn_id, cardLabel: r.card_id, customer: r.customer_id, score: num(r.risk_score),
  }));
}
