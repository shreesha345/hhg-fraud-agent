"use client";
import type { Comm, InvestigationResult } from "@fraud/shared";
import type { Health } from "@/lib/api";

interface Group { to: string; calls: number; ms: number; failed: number; what: Map<string, number> }

function group(comms: Comm[]): Group[] {
  const m = new Map<string, Group>();
  for (const c of comms) {
    const g = m.get(c.to) ?? { to: c.to, calls: 0, ms: 0, failed: 0, what: new Map() };
    g.calls++; g.ms += c.ms; if (!c.ok) g.failed++;
    g.what.set(c.what, (g.what.get(c.what) ?? 0) + 1);
    m.set(c.to, g);
  }
  return [...m.values()];
}

/** The parts of the system and how they are connected. Shown before any case is run, so it is clear what talks to what. */
export function Wiring({ health }: { health: Health | null }) {
  const c = health?.components;
  const up = (ok: boolean | undefined) => (ok ? "on" : "off");
  return (
    <div className="wiring" aria-label="How the parts are connected">
      <div className="node"><b>You</b><span>this web page</span></div>
      <div className="arrow" title="The page asks the agent to investigate and receives each step live">↔<small>live steps</small></div>
      <div className="node"><b>The agent</b><span>decides using fixed rules</span></div>
      <div className="arrow branch">
        <div><span className="line">→</span> <small>asks questions</small></div>
        <div><span className="line">→</span> <small>asks for text</small></div>
      </div>
      <div className="col">
        <div className="node"><span className={`dot ${up(health?.ok !== undefined && c?.store === "tigergraph" && !health.problems?.some((p) => /TigerGraph/.test(p)))}`} /><b>TigerGraph database</b><span>{c?.graph ?? "graph"}, reached through the MCP server</span></div>
        <div className="node"><span className={`dot ${up(c?.ollama.up && c.ollama.writerListed)}`} /><b>AI model</b><span>{c?.ollama.writer ?? "not set"} (writes the text) and {c?.ollama.embed ?? "embedding model"} (finds similar cases)</span></div>
      </div>
    </div>
  );
}

/** What actually happened during this investigation: every message, counted, from the real logs. */
export function Comms({ r }: { r: InvestigationResult }) {
  const comms = r.trace.comms ?? [];
  const groups = group(comms);
  const total = comms.reduce((s, c) => s + c.ms, 0);
  return (
    <div className="pad stack">
      <p className="hint">Every message the agent sent during this investigation, taken from the real logs (nothing here is estimated). The agent decides on its own using fixed rules; it only calls the AI model to put findings into words.</p>
      {groups.length === 0 && <div className="detail" style={{ color: "var(--muted)" }}>No messages were recorded.</div>}
      {groups.map((g) => (
        <div key={g.to} className="comm">
          <div className="head">
            <b>Agent → {g.to}</b>
            <span className="tag t-mute">{g.calls} message{g.calls === 1 ? "" : "s"}</span>
            <span className="tag t-mute">{(g.ms / 1000).toFixed(1)} s in total</span>
            {g.failed > 0 && <span className="tag t-bad">{g.failed} failed</span>}
          </div>
          <div className="chips">
            {[...g.what.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => <span key={w} className="chip">{w}{n > 1 ? ` ×${n}` : ""}</span>)}
          </div>
        </div>
      ))}
      {groups.length > 0 && <div className="hint">All messages together took {(total / 1000).toFixed(1)} s of waiting (some ran at the same time).</div>}
    </div>
  );
}
