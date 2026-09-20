"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, InvestigationResult } from "@fraud/shared";
import { TRIGGER_PLAIN } from "@fraud/shared";
import { getCases, getHealth, streamCase, type CaseRow, type Health } from "@/lib/api";
import { CaseQueue } from "@/components/CaseQueue";
import { Timeline } from "@/components/Timeline";
import { Advocates } from "@/components/Advocates";
import { Verdict } from "@/components/Verdict";
import { Actions, type Decisions } from "@/components/Actions";
import { Evidence, Sar } from "@/components/Evidence";
import { GraphView } from "@/components/GraphView";
import { Comms, Wiring } from "@/components/Comms";

export default function Console() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [current, setCurrent] = useState<string | undefined>();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(true);
  const [decisions, setDecisions] = useState<Decisions>({});
  const close = useRef<null | (() => void)>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([getCases(), getHealth()]);
      setCases(c); setHealth(h); setError(null);
    } catch {
      setHealth(null);
      setError("Cannot reach the agent. Start it with run-all.bat (or: pnpm dev:backend).");
    }
  }, []);
  useEffect(() => { refresh(); return () => close.current?.(); }, [refresh]);

  const pick = (id: string) => { close.current?.(); setCurrent(id); setEvents([]); setResult(null); setRunning(false); setError(null); };

  const run = () => {
    if (!current) return;
    close.current?.();
    setEvents([]); setResult(null); setError(null); setRunning(true);
    close.current = streamCase(current, { delay: slow ? 380 : 0 }, {
      step: (e) => setEvents((xs) => [...xs, e]),
      result: (r) => { setResult(r); setRunning(false); refresh(); },
      error: (m) => { setError(m); setRunning(false); },
    });
  };

  const sel = cases.find((c) => c.case_id === current);
  return (
    <>
      <header className="top">
        <h1>Fraud Investigator</h1>
        <span className="sub">An AI assistant that checks suspicious card payments and shows how it decided.</span>
        <span className="meta"><span className={`dot ${health ? "on" : "off"}`} />{health
          ? `Connected · data from ${health.dataset.store === "tigergraph" ? "the TigerGraph cloud database" : "local files"} · ${(health.dataset.transactions ?? 0).toLocaleString()} payments · ${(health.dataset.closed ?? 0).toLocaleString()} past cases · text written by ${health.narratorModel ? `AI model ${health.narratorModel}` : "a fixed template"}`
          : "Not connected to the agent"}</span>
        {health && /test$/.test(health.dataset.dir.replace(/\\/g, "/")) && <span className="tag t-gate">practice data, not real</span>}
      </header>

      {health && health.problems && health.problems.length > 0 && (
        <div className="err" role="alert" style={{ margin: "10px 16px 0" }}>
          <b>Something needs fixing before the agent can work properly:</b>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{health.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <main className="grid">
        <CaseQueue cases={cases} current={current} onPick={pick} />

        <div className="stack">
          <section className="card"><h2>How the parts are connected</h2><div className="pad"><Wiring health={health} /></div></section>
          <section className="card">
            <h2>1 · The alert and what the agent does</h2>
            <div className="pad stack">
              {sel ? (
                <>
                  <div>
                    <div style={{ fontWeight: 600 }}>{sel.case_id} · {TRIGGER_PLAIN[sel.trigger_type] ?? sel.trigger_type}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{sel.trigger_text}</div>
                    <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span className="tag t-mute">card {sel.card_id}</span><span className="tag t-mute">customer {sel.customer_id}</span><span className="tag t-mute">alert opened {sel.opened_at}</span>
                    </div>
                  </div>
                  <div className="controls">
                    <button className="btn" onClick={run} disabled={running}>{running ? "Investigating…" : result ? "Investigate again" : "Investigate this alert"}</button>
                    <label className="label" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> slow down so I can watch
                    </label>
                  </div>
                </>
              ) : <div className="intro">
                  <p style={{ margin: "0 0 8px" }}><b>Pick an alert on the left.</b> Each one is a card payment that might be fraud. The agent will:</p>
                  <ol>
                    <li>Look at the card&apos;s history and the devices used.</li>
                    <li>Argue both sides: signs of fraud, and reasons it could be innocent.</li>
                    <li>Compare with past cases and add it all up into a fraud chance.</li>
                    <li>Recommend what to do, and who has to approve it.</li>
                  </ol>
                  <p className="hint" style={{ margin: 0 }}>You can watch every step as it happens. The AI only writes the explanation; fixed bank rules decide the actions.</p>
                </div>}
            </div>
            {error && <div className="err" role="alert">{error}</div>}
            <Timeline events={events} running={running} />
          </section>

          {result && (
            <>
              <section className="card"><h2>2 · Signs of fraud and signs it is innocent</h2><Advocates r={result} /></section>
              <section className="card"><h2>3 · What the agent found</h2><Evidence r={result} /></section>
            </>
          )}
        </div>

        <div className="stack">
          {result ? (
            <>
              <section className="card"><h2>Result</h2><Verdict r={result} /></section>
              <section className="card"><h2>What to do next</h2><Actions r={result} decisions={decisions} setDecisions={setDecisions} /></section>
              <section className="card"><h2>Report for the regulator</h2><Sar r={result} /></section>
              <section className="card"><h2>Who talked to whom</h2><Comms r={result} /></section>
              <section className="card"><h2>Connections the agent used</h2><GraphView graph={result.trace.graph} /></section>
            </>
          ) : (
            <section className="card"><h2>Result</h2><p className="empty">The chance of fraud, what to do next, who must approve it, and the report for the regulator will appear here when the investigation finishes.</p></section>
          )}
        </div>
      </main>
    </>
  );
}
