"use client";
import type { InvestigationResult } from "@fraud/shared";
import { PATTERN_PLAIN, VERDICT_PLAIN, VERDICT_SENTENCE, howSure, plainClass } from "@fraud/shared";
import { CustomerExplanation } from "./CustomerExplanation";

const cls = (v: string) => (v === "fraud" ? "t-bad" : v === "legitimate" ? "t-ok" : "t-gate");

export function Verdict({ r }: { r: InvestigationResult }) {
  const c = r.answer.case;
  const a = r.trace.assessment;
  const grouped = Object.values(
    r.trace.validation.reduce<Record<string, { level: string; code: string; message: string; count: number }>>((m, v) => {
      const k = `${v.level}:${v.code}`;
      m[k] = m[k] ? { ...m[k], count: m[k].count + 1 } : { ...v, count: 1 };
      return m;
    }, {}),
  );
  return (
    <div className="pad stack">
      <div className="headline">
        <span className="big">{Math.round(c.fraud_probability * 100)}%</span>
        <div>
          <div className="howsure">{howSure(c.fraud_probability)}</div>
          <span className={`tag ${cls(c.verdict)}`}>{VERDICT_PLAIN[c.verdict] ?? c.verdict}</span>
        </div>
      </div>
      <div>
        <div className="gauge" role="img" aria-label={`Chance of fraud ${Math.round(c.fraud_probability * 100)} percent`}>
          <span className="mark" style={{ left: `${c.fraud_probability * 100}%` }} />
        </div>
        <div className="label" style={{ display: "flex", justifyContent: "space-between" }}><span>genuine</span><span>fraud</span></div>
      </div>
      <p style={{ margin: 0 }}>{VERDICT_SENTENCE[c.verdict]} <b>{PATTERN_PLAIN[c.pattern] ?? c.pattern}.</b></p>
      {c.exposure_usd > 0 && <p style={{ margin: 0 }}>Money at risk: <b>${c.exposure_usd.toFixed(2)}</b> across {c.affected_txn_ids.length} payment{c.affected_txn_ids.length === 1 ? "" : "s"}.</p>}
      
      {/* Customer-friendly explanation */}
      {c.customer_explanation && (
        <div style={{ marginTop: 12 }}>
          <CustomerExplanation 
            explanation={c.customer_explanation} 
            verdict={c.verdict}
            pattern={c.pattern}
          />
        </div>
      )}
      
      <div className="summary">
        <div className="label">Summary written by {r.trace.narrator.model ? `the AI (${r.trace.narrator.model})` : "a fixed template"}{r.trace.narrator.fell_back ? " — the AI's answer was not usable, so a template was used" : ""}</div>
        <p style={{ margin: "4px 0 0" }}>{c.summary}</p>
      </div>
      <details>
        <summary className="label" style={{ cursor: "pointer" }}>Technical details</summary>
        <div className="stack" style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
          <div>Kinds of evidence used: {Object.keys(a.classes).map(plainClass).join(", ") || "none"} ({a.k} independent). Starting assumption before any evidence: {Math.round(a.prior * 100)}% fraud.</div>
          <div>{r.answer.tool_calls} database calls · {r.answer.latency_s.toFixed(1)} seconds · status: {c.status.replace(/_/g, " ")}</div>
          <div><b>Why it stopped:</b> {r.answer.stop_reason}</div>
          {a.open_questions.length > 0 && <div><b>Still unanswered:</b> {a.open_questions.join("; ")}</div>}
          {grouped.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {grouped.map((v) => <span key={v.code} className={`tag ${v.level === "error" ? "t-bad" : "t-mute"}`} title={v.message}>{v.level}: {v.code}{v.count > 1 ? ` ×${v.count}` : ""}</span>)}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
