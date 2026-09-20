"use client";
import type { CaseRow } from "@/lib/api";
import { TRIGGER_PLAIN, VERDICT_PLAIN } from "@fraud/shared";

const trig = (t: string) => TRIGGER_PLAIN[t] ?? t.replace(/_/g, " ");

export function CaseQueue({ cases, current, onPick }: { cases: CaseRow[]; current?: string; onPick: (id: string) => void }) {
  return (
    <section className="card" aria-label="Case queue">
      <h2>Alerts to check · {cases.length}</h2>
      {cases.length === 0 && <p className="empty">No alerts loaded. Start the backend and refresh.</p>}
      <ul className="queue">
        {cases.map((c) => (
          <li key={c.case_id}>
            <button onClick={() => onPick(c.case_id)} aria-current={current === c.case_id}>
              <span className="row">
                <span className="id">{c.case_id}</span>
                <span className="tag t-mute">{trig(c.trigger_type)}</span>
                {c.risk_score !== null && <span className="tag t-mute">bank risk {Math.round(c.risk_score * 100)}%</span>}
              </span>
              <span className="txt">{c.trigger_text}</span>
              {c.verdict && (
                <span className="row">
                  <span className={`tag ${c.verdict === "fraud" ? "t-bad" : c.verdict === "legitimate" ? "t-ok" : "t-gate"}`}>{VERDICT_PLAIN[c.verdict] ?? c.verdict}</span>
                  <span className="tag t-mute">{Math.round((c.probability ?? 0) * 100)}% fraud</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
