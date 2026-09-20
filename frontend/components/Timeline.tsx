"use client";
import type { AgentEvent } from "@fraud/shared";
import { STEP_PLAIN } from "@fraud/shared";

/** The agent's work as a numbered list of steps: what it is doing, why, and what it found. */
export function Timeline({ events, running }: { events: AgentEvent[]; running: boolean }) {
  if (!events.length) {
    return (
      <div className="empty">
        {running ? "Starting…" : "Pick an alert on the left and press “Investigate this alert”. Every step the agent takes will appear here, one by one, with what it found."}
      </div>
    );
  }
  const finished = events.some((e) => e.kind === "done");
  return (
    <ol className="steps" aria-live="polite">
      {events.map((e, i) => {
        const info = STEP_PLAIN[e.kind] ?? { name: e.kind, why: "" };
        const current = running && !finished && i === events.length - 1;
        return (
          <li key={e.seq} className={`step k-${e.kind} ${current ? "enter" : ""} ${e.kind === "error" ? "bad" : ""}`}>
            <span className="num" aria-hidden>{e.kind === "error" ? "!" : i + 1}</span>
            <div className="body">
              <div className="stepname">{info.name}</div>
              <div className="result">{e.title}</div>
              {e.detail && <div className="detail">{e.detail}</div>}
              {info.why && <div className="why">Why: {info.why}</div>}
            </div>
          </li>
        );
      })}
      {running && !finished && <li className="step working"><span className="num spin" aria-hidden /><div className="body"><div className="stepname">Working on the next step…</div></div></li>}
    </ol>
  );
}
