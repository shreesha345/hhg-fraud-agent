"use client";
import type { InvestigationResult } from "@fraud/shared";

export function Evidence({ r }: { r: InvestigationResult }) {
  const c = r.answer.case;
  return (
    <div className="pad stack">
      <ul className="ev">
        {c.evidence.map((e, i) => (
          <li key={i}>
            <span className={`tag ${e.source === "customer" ? "t-gate" : e.source === "document" ? "t-agent" : "t-graph"}`}>{e.source === "graph" ? "from the data" : e.source === "document" ? "from the bank's rules" : e.source === "customer" ? "from the customer" : e.source}</span> {e.claim}
            <details className="ids"><summary>Where this comes from</summary>
              <div className="chips">
                <span className="chip" title="the check or document that produced this">{e.ref}</span>
                {e.entity_ids.slice(0, 8).map((id) => <span key={id} className="chip">{id}</span>)}
                {e.entity_ids.length > 8 && <span className="chip">+{e.entity_ids.length - 8}</span>}
              </div>
            </details>
          </li>
        ))}
        {c.evidence.length === 0 && <li className="detail" style={{ color: "var(--muted)" }}>No evidence found.</li>}
      </ul>
      {c.similar_prior_cases.length > 0 && (
        <div>
          <div className="label">Similar past cases the agent remembered</div>
          <div className="chips">{c.similar_prior_cases.map((id) => <span key={id} className="chip">{id}</span>)}</div>
        </div>
      )}
      {c.pattern === "undocumented" && (
        <div className="diff"><b>A pattern the bank has no name for, in the agent&apos;s own words:</b> {c.pattern_description}</div>
      )}
    </div>
  );
}

export function Sar({ r }: { r: InvestigationResult }) {
  const s = r.answer.sar;
  return (
    <div className="pad stack">
      <div><span className={`tag ${s.file ? "t-gate" : "t-mute"}`}>{s.file ? "report to the regulator needed" : "no report needed"}</span> <span className="detail" style={{ color: "var(--muted)", fontSize: 12.5 }}>{s.reason}</span></div>
      {s.file && (
        <>
          <div className="sar">{s.narrative}</div>
          <div className="chips">
            <span className="chip">${s.total_amount_usd.toFixed(2)}</span>
            {s.activity_dates.map((d, i) => <span key={`date-${i}-${d}`} className="chip">{d}</span>)}
            {s.subjects.map((x, i) => <span key={`subject-${i}-${x}`} className="chip">{x}</span>)}
          </div>
        </>
      )}
    </div>
  );
}
