"use client";
import type { ActionItem, InvestigationResult } from "@fraud/shared";
import { ROUTE_PLAIN, plainAction } from "@fraud/shared";
import { postApproval } from "@/lib/api";

const routeCls = (r: string) => (r === "auto" ? "t-ok" : "t-gate");

export type Decisions = Record<string, "approve" | "reject">;

function ActionList({ items, caseId, decisions, onDecide }: { items: ActionItem[]; caseId: string; decisions: Decisions; onDecide?: (k: string, d: "approve" | "reject") => void }) {
  return (
    <ul className="actions">
      {items.map((a) => {
        const key = `${caseId}:${a.action}`;
        const d = decisions[key];
        return (
          <li key={a.action} className="action">
            <div className="head">
              <span className="name">{plainAction(a.action)}</span>
              <span className={`tag ${routeCls(a.route)}`}>{ROUTE_PLAIN[a.route]}</span>
              {d && <span className={`tag ${d === "approve" ? "t-ok" : "t-bad"}`}>{d === "approve" ? "approved" : "rejected"}</span>}
            </div>
            <div className="why">{a.reason}</div>
            <div className="code">{a.action} · {a.route}</div>
            {a.route !== "auto" && onDecide && !d && (
              <div className="approve">
                <span className="label" style={{ alignSelf: "center" }}>{a.route === "L1" ? "Team lead:" : "Fraud manager:"}</span>
                <button className="yes" onClick={() => onDecide(key, "approve")}>Approve</button>
                <button className="no" onClick={() => onDecide(key, "reject")}>Reject</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Actions({ r, decisions, setDecisions }: { r: InvestigationResult; decisions: Decisions; setDecisions: (d: Decisions) => void }) {
  const n = r.answer.next_best_actions;
  const id = r.answer.case_id;
  const decide = (key: string, d: "approve" | "reject") => {
    setDecisions({ ...decisions, [key]: d });
    postApproval(id, key.split(":")[1], d).catch(() => undefined);
  };
  const changed = n.what_changed !== "nothing";
  return (
    <div className="pad stack">
      {r.answer.evidence_requests.length > 0 && (
        <div className="diff">
          <b>The agent would ask the customer to confirm the payment.</b> <span style={{ color: "var(--muted)" }}>{r.answer.evidence_requests[0].assumed_response}</span>
        </div>
      )}
      <div className={changed ? "cols2" : ""}>
        {changed && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>First recommendation (before asking the customer)</div>
            <ActionList items={n.initial} caseId={id} decisions={decisions} />
          </div>
        )}
        <div>
          <div className="label" style={{ marginBottom: 6 }}>{changed ? "Recommendation after the customer step" : "Recommended (no extra information needed)"}</div>
          <ActionList items={n.final} caseId={id} decisions={decisions} onDecide={decide} />
        </div>
      </div>
      <div className="diff"><b>What changed:</b> {n.what_changed === "nothing" ? "Nothing: the recommendation stayed the same." : n.what_changed}</div>
      {n.contingency && (
        <details>
          <summary className="label" style={{ cursor: "pointer" }}>What we would do for each possible answer from the customer</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {n.contingency.map((c) => (
              <div key={c.reply}>
                <span className="tag t-agent">{c.reply === "denies" ? "If the customer says “not me”" : c.reply === "confirms" ? "If the customer says “it was me”" : "If the customer does not answer"}</span> <span className="detail" style={{ color: "var(--muted)" }}>(rules: {c.rules.join(", ") || "none"})</span>
                <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {c.actions.map((a) => <span key={a.action} className={`tag ${routeCls(a.route)}`}>{plainAction(a.action)}</span>)}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
