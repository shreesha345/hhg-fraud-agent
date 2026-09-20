"use client";
import type { InvestigationResult, SignatureView } from "@fraud/shared";
import { SIGNATURE_PLAIN, plainClass } from "@fraud/shared";

const MAX = 4;

function Bar({ v }: { v: number }) {
  const w = Math.min(50, (Math.abs(v) / MAX) * 50);
  return (
    <div className="bar" role="img" aria-label={v >= 0 ? "points toward fraud" : "points toward innocence"} style={{ width: 110 }}>
      <i style={{ left: "50%", width: 1, background: "var(--line)" }} />
      <i style={{ left: v >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: v >= 0 ? "var(--gate)" : "var(--ok)" }} />
    </div>
  );
}

function Sig({ s }: { s: SignatureView }) {
  return (
    <div className={`sig ${s.fired ? "" : "off"}`}>
      <span className="name">{SIGNATURE_PLAIN[s.name] ?? s.name}{s.fired ? "" : " — not seen"}</span>
      {s.fired ? <Bar v={s.logLr} /> : <span />}
      <span className="claim">{s.claim}</span>
    </div>
  );
}

export function Advocates({ r }: { r: InvestigationResult }) {
  const sigs = r.trace.signatures;
  const pro = sigs.filter((s) => s.side === "prosecution").sort((a, b) => Number(b.fired) - Number(a.fired));
  const def = sigs.filter((s) => s.side === "defence").sort((a, b) => Number(b.fired) - Number(a.fired));
  const meta = sigs.filter((s) => s.side === "meta" && s.fired);
  const classes = Object.entries(r.trace.assessment.classes);
  return (
    <div className="pad stack">
      <p className="hint">The agent argues both sides on purpose, like a prosecutor and a defence lawyer, so a genuine customer is not blocked by mistake. Bars show how strongly each point pushes toward fraud (orange) or innocence (green).</p>
      <div className="sigs two">
        <div>
          <div className="label" style={{ color: "var(--gate)" }}>Signs of fraud</div>
          {pro.map((s) => <Sig key={s.name} s={s} />)}
        </div>
        <div>
          <div className="label" style={{ color: "var(--ok)" }}>Signs it is innocent</div>
          {def.map((s) => <Sig key={s.name} s={s} />)}
          {meta.length > 0 && <div className="label" style={{ marginTop: 10 }}>Other context</div>}
          {meta.map((s) => <Sig key={s.name} s={s} />)}
        </div>
      </div>
      <div>
        <div className="label">Kinds of evidence (facts of the same kind count only once)</div>
        {classes.length === 0 && <div className="detail" style={{ color: "var(--muted)" }}>No evidence found.</div>}
        {classes.map(([c, v]) => (
          <div key={c} className="sig">
            <span className="name">{plainClass(c)}</span>
            <Bar v={v} />
          </div>
        ))}
      </div>
    </div>
  );
}
