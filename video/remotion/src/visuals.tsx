import React from "react";
import { interpolate } from "remotion";

export const C = { bg: "#070d1d", panel: "#0e1832", panel2: "#132048", line: "#1f2f5c", ink: "#e8eefc", mut: "#8ea0cf", cy: "#3ee0d0", bl: "#5b8cff", am: "#ffb84d", red: "#ff6b6b", ok: "#4ade80", pu: "#c084fc" };
export const FONT = '"Segoe UI", system-ui, sans-serif';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

/** Reveal with a little overshoot, so entrances have weight instead of just fading.
 *  Driven by the narration progress `p` (not the raw frame), so each element lands on its own cue. */
export const Rv: React.FC<{ p: number; at: number; frame?: number; dx?: number; dy?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ p, at, dx = 0, dy = 26, style, children }) => {
  const t = clamp01((p - at) / 0.07);                 // 0 -> 1 over the cue
  const k = 1 - Math.pow(1 - t, 3);                   // ease-out
  const over = Math.sin(t * Math.PI) * 0.035;         // a brief overshoot in the middle
  return (
    <div style={{
      opacity: clamp01(t * 1.6),
      transform: `translate(${(1 - k) * dx}px, ${(1 - k) * dy}px) scale(${0.965 + k * 0.035 + over})`,
      ...style,
    }}>{children}</div>
  );
};

/** a number that counts up once, with a soft glow while it moves */
const Counter: React.FC<{ to: number; frame: number; start: number; dur?: number; color: string; suffix?: string }> = ({ to, frame, start, dur = 44, color, suffix = "" }) => {
  const t = clamp01((frame - start) / dur);
  const v = Math.round(to * ease(t));
  const glow = Math.sin(Math.PI * t) * 26;
  return <span style={{ color, textShadow: `0 0 ${glow}px ${color}` }}>{v.toLocaleString()}{suffix}</span>;
};

const Tile: React.FC<{ n: React.ReactNode; l: string; color?: string; p: number; at: number; frame: number }> = ({ n, l, color = C.cy, p, at, frame }) => (
  <Rv p={p} at={at} frame={frame} style={{ background: `linear-gradient(160deg, ${C.panel2}, ${C.panel})`, border: `1px solid ${C.line}`, borderRadius: 22, padding: "26px 30px", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
    <div style={{ fontSize: 88, fontWeight: 800, color, lineHeight: 1 }}>{n}</div>
    <div style={{ fontSize: 30, color: C.mut, marginTop: 10, lineHeight: 1.25 }}>{l}</div>
  </Rv>
);

/** `compact` is for lists long enough to overflow the stage (the eight-step loop). */
const Item: React.FC<{ i?: React.ReactNode; ok?: boolean; p: number; at: number; frame: number; children: React.ReactNode; sub?: string; compact?: boolean }> = ({ i, ok, p, at, frame, children, sub, compact }) => (
  <Rv p={p} at={at} frame={frame} dx={-18} dy={10} style={{ display: "flex", gap: compact ? 18 : 22, alignItems: "center", background: `linear-gradient(160deg, ${C.panel2}, ${C.panel})`, border: `1px solid ${C.line}`, borderRadius: compact ? 16 : 20, padding: compact ? "11px 22px" : "18px 26px", fontSize: compact ? 30 : 34, fontWeight: 600, lineHeight: 1.25, boxShadow: "0 14px 34px rgba(0,0,0,.28)" }}>
    <span style={{ flex: "none", width: compact ? 44 : 54, height: compact ? 44 : 54, borderRadius: "50%", background: ok ? C.ok : C.bl, color: ok ? "#052" : "#fff", display: "grid", placeItems: "center", fontSize: compact ? 24 : 28, fontWeight: 700 }}>{i ?? "✓"}</span>
    <span>{children}{sub && <div style={{ fontSize: 26, color: C.mut, fontWeight: 400, marginTop: 4 }}>{sub}</div>}</span>
  </Rv>
);

const Card: React.FC<{ p: number; at: number; frame: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ p, at, frame, children, style }) => (
  <Rv p={p} at={at} frame={frame} style={{ background: `linear-gradient(160deg, ${C.panel2}, ${C.panel})`, border: `1px solid ${C.line}`, borderRadius: 22, padding: "24px 30px", fontSize: 32, lineHeight: 1.4, boxShadow: "0 14px 34px rgba(0,0,0,.28)", ...style }}>{children}</Rv>
);

const Box: React.FC<{ x: number; y: number; w: number; h: number; t: string; sub?: string; c: string; pulse?: number }> = ({ x, y, w, h, t, sub, c, pulse = 0 }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={18} fill={C.panel} stroke={c} strokeWidth={3} opacity={1} />
    {pulse > 0 && <rect x={x} y={y} width={w} height={h} rx={18} fill="none" stroke={c} strokeWidth={3} opacity={pulse * 0.5} transform={`translate(${-w * 0.02 * pulse} ${-h * 0.05 * pulse}) scale(${1 + 0.04 * pulse})`} style={{ transformOrigin: `${x + w / 2}px ${y + h / 2}px` }} />}
    <text x={x + w / 2} y={y + h / 2 + (sub ? -2 : 8)} fill={C.ink} fontSize={25} fontWeight={700} textAnchor="middle">{t}</text>
    {sub && <text x={x + w / 2} y={y + h / 2 + 26} fill={C.mut} fontSize={17} textAnchor="middle">{sub}</text>}
  </g>
);

export interface VProps { p: number; frame: number }

export const VISUALS: Record<string, React.FC<VProps>> = {
  /** the two readings of one alert, drifting apart, then the verdict line lands between them */
  hook: ({ p, frame }) => {
    const split = ease((frame - 30) / 60);
    return (
      <div style={{ display: "grid", gap: 26 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26 }}>
          <div style={{ transform: `translateX(${-split * 14}px)` }}>
            <Card p={p} at={0} frame={frame}><div style={{ fontSize: 48, fontWeight: 800, color: C.red }}>A thief?</div>Stolen card details, spent online within minutes.</Card>
          </div>
          <div style={{ transform: `translateX(${split * 14}px)` }}>
            <Card p={p} at={0.3} frame={frame}><div style={{ fontSize: 48, fontWeight: 800, color: C.ok }}>Or a customer?</div>On holiday, with a brand-new phone.</Card>
          </div>
        </div>
        <Rv p={p} at={0.6} frame={frame} style={{ fontSize: 76, fontWeight: 800, background: `linear-gradient(90deg,${C.cy},${C.bl})`, WebkitBackgroundClip: "text", color: "transparent" }}>Same alert. Opposite answers.</Rv>
      </div>
    );
  },

  /** the decoy: cleared cases pile up at a high score while fraud spreads across the whole axis */
  trap: ({ p, frame }) => {
    const grow = ease((frame - 18) / 70);
    // fixed pseudo-random layout so the picture is identical on every render
    const dots = Array.from({ length: 64 }, (_, i) => {
      const r = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const r2 = (Math.sin(i * 78.233) * 12345.6789) % 1;
      const fraud = i % 5 !== 0;
      const x = fraud ? Math.abs(r) : 0.81 + Math.abs(r) * 0.19;
      return { x, y: Math.abs(r2), fraud };
    });
    return (
      <div style={{ display: "grid", gap: 22 }}>
        <div style={{ position: "relative", height: 210, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 20, overflow: "hidden" }}>
          {/* the 0.81 line, in the SAME coordinate space as the dots (x * 92 + 4) */}
          <div style={{ position: "absolute", left: `${(0.81 * 92 + 4) * grow + 4 * (1 - grow)}%`, top: 0, bottom: 0, width: 2, background: C.am, opacity: grow }} />
          <div style={{ position: "absolute", left: `${0.81 * 92 + 4}%`, bottom: 8, fontSize: 20, color: C.am, opacity: grow, transform: "translateX(-50%)" }}>0.81</div>
          {dots.map((d, i) => {
            const on = clamp01((frame - 20 - i * 1.1) / 10);
            return <div key={i} style={{ position: "absolute", left: `calc(${d.x * 92 + 4}% - 6px)`, top: `${d.y * 80 + 10}%`, width: 12, height: 12, borderRadius: "50%", background: d.fraud ? C.red : C.ok, opacity: on * 0.85, transform: `scale(${on})` }} />;
          })}
          <div style={{ position: "absolute", left: 16, bottom: 8, fontSize: 22, color: C.mut }}>bank score 0.0</div>
          <div style={{ position: "absolute", right: 16, bottom: 8, fontSize: 22, color: C.mut }}>1.0</div>
          <div style={{ position: "absolute", right: 16, top: 10, fontSize: 22, color: C.ok }}>● cleared</div>
          <div style={{ position: "absolute", right: 150, top: 10, fontSize: 22, color: C.red }}>● fraud</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <Tile p={p} at={0.25} frame={frame} n={<><Counter to={900} frame={frame} start={26} color={C.am} /> / 900</>} l="cleared cases had a HIGH bank score (0.81 or more)" color={C.am} />
          <Tile p={p} at={0.55} frame={frame} n={<Counter to={31} frame={frame} start={52} color={C.red} suffix="%" />} l="of confirmed fraud scored under 0.30" color={C.red} />
        </div>
        <Item p={p} at={0.82} frame={frame} i="!"><b style={{ color: C.cy }}>The bank's risk score is close to a decoy.</b></Item>
      </div>
    );
  },

  /** cards drift in and snap onto one shared device: the picture of the whole project */
  numbers: ({ p, frame }) => {
    const pull = ease((frame - 34) / 74);
    const nodes = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      const R = 200 - pull * 128;
      return { x: 450 + Math.cos(a) * R * 1.55, y: 170 + Math.sin(a) * R * 0.8, a };
    });
    return (
      <div style={{ display: "grid", gap: 20 }}>
        <svg viewBox="0 0 900 340" width="100%" height={300}>
          {nodes.map((n, i) => (
            <line key={`l${i}`} x1={n.x} y1={n.y} x2={450} y2={170} stroke={C.cy} strokeWidth={2} opacity={pull * 0.55} strokeDasharray="6 8" strokeDashoffset={-frame * 1.1} />
          ))}
          {nodes.map((n, i) => {
            const on = clamp01((frame - 12 - i * 2) / 12);
            return <g key={i} opacity={on}><circle cx={n.x} cy={n.y} r={16} fill={C.panel} stroke={C.bl} strokeWidth={3} /><text x={n.x} y={n.y + 6} fontSize={15} fill={C.mut} textAnchor="middle">card</text></g>;
          })}
          <circle cx={450} cy={170} r={44 + Math.sin(frame / 9) * 3} fill={C.panel} stroke={C.am} strokeWidth={4} opacity={clamp01((frame - 30) / 14)} />
          <circle cx={450} cy={170} r={60 + (frame % 45) * 1.6} fill="none" stroke={C.am} strokeWidth={2} opacity={Math.max(0, 0.45 - (frame % 45) / 100)} />
          <text x={450} y={176} fontSize={19} fontWeight={700} fill={C.am} textAnchor="middle" opacity={clamp01((frame - 34) / 14)}>one device</text>
        </svg>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
          {([[590742, "payments"], [14318, "cards"], [9706, "device profiles"], [5565, "past cases"]] as [number, string][]).map(([n, l], i) => (
            <Rv key={l} p={p} at={0.35 + i * 0.12} frame={frame} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: "16px 20px" }}>
              <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1 }}><Counter to={n} frame={frame} start={20 + i * 10} color={C.cy} /></div>
              <div style={{ fontSize: 24, color: C.mut, marginTop: 6 }}>{l}</div>
            </Rv>
          ))}
        </div>
      </div>
    );
  },

  /** the wiring, with a packet that actually travels along each link */
  arch: ({ p, frame }) => {
    const dash = -(frame * 1.4);
    const o = (at: number) => interpolate(p, [at, at + 0.06], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const pulseAt = (x1: number, y1: number, x2: number, y2: number, phase: number) => {
      const t = ((frame / 34) + phase) % 1;
      return <circle cx={x1 + (x2 - x1) * t} cy={y1 + (y2 - y1) * t} r={6} fill={C.cy} opacity={0.9} />;
    };
    const line = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.cy} strokeWidth={4} strokeDasharray="8 8" strokeDashoffset={dash} markerEnd="url(#ar)" />;
    return (
      <svg viewBox="0 0 900 500" width="100%" height="100%">
        <defs><marker id="ar" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill={C.cy} /></marker></defs>
        <g opacity={o(0.02)}><Box x={10} y={170} w={190} h={92} t="Console" sub="your browser" c={C.bl} /></g>
        <g opacity={o(0.15)}>{line(200, 216, 288, 216)}{pulseAt(200, 216, 288, 216, 0)}<Box x={290} y={170} w={210} h={92} t="The agent" sub="TypeScript · rules" c={C.cy} pulse={0.5 + 0.5 * Math.sin(frame / 12)} /></g>
        <g opacity={o(0.4)}>{line(500, 192, 598, 112)}{pulseAt(500, 192, 598, 112, 0.33)}<Box x={600} y={20} w={290} h={132} t="TigerGraph (cloud)" sub="16 GSQL queries · vectors" c={C.am} />
          <text x={452} y={118} fill={C.am} fontSize={19} textAnchor="middle" transform="rotate(-34 452 118)">via the MCP server</text></g>
        <g opacity={o(0.6)}>{line(500, 242, 598, 332)}{pulseAt(500, 242, 598, 332, 0.66)}<Box x={600} y={300} w={290} h={132} t="Ollama · AI model" sub="writes the text" c={C.pu} />
          <text x={452} y={346} fill={C.pu} fontSize={19} textAnchor="middle" transform="rotate(34 452 346)">words + similar cases</text></g>
        <g opacity={o(0.8)}><rect x={10} y={418} width={580} height={72} rx={14} fill={C.panel} stroke={C.line} />
          <text x={30} y={448} fill={C.ink} fontSize={21} fontWeight={700}>The graph analyses. <tspan fill={C.am}>Fixed bank rules decide.</tspan> <tspan fill={C.pu}>The AI only explains.</tspan></text>
          <text x={30} y={476} fill={C.mut} fontSize={17}>The AI never chooses an action or writes to the database.</text></g>
      </svg>
    );
  },

  /** the loop, with a light running down the list as each step is reached */
  steps: ({ p, frame }) => {
    const items = ["Read the alert, frozen at the moment it opened", "Argue both sides: prosecution vs. defence", "Check links to known fraud (ignores the bank score)", "Compare with similar past cases", "Weigh it all into one chance of fraud", "Apply the bank's rules: actions and who approves", "The AI writes the summary and the report", "Double-check every ID and rule"];
    return (
      <div style={{ display: "grid", gap: 10, position: "relative" }}>
        {items.map((t, i) => {
          const at = (i / items.length) * 0.9;
          const hot = clamp01((p - at) / 0.06) * clamp01(1 - (p - at - 0.12) / 0.1);
          return (
            <div key={t} style={{ position: "relative" }}>
              <div style={{ position: "absolute", inset: -3, borderRadius: 18, boxShadow: `0 0 ${hot * 34}px ${C.cy}`, opacity: hot * 0.55, pointerEvents: "none" }} />
              <Item p={p} at={at} frame={frame} i={i + 1} compact>{t}</Item>
            </div>
          );
        })}
      </div>
    );
  },

  /** the guardrails, each one stamped in */
  honest: ({ p, frame }) => (
    <div style={{ display: "grid", gap: 16 }}>
      {([["No look-ahead", "every query is cut off at the alert's opening time"], ["No invented replies", "the customer's answer is not in the data, so none is made up"], ["Every ID exists", "315 IDs across 20 files, all checked against the source"], ["No fake text", "if the AI model fails, the case stops with a clear error"], ["138 tests", "pass locally, and again on the live cloud graph"]] as [string, string][]).map(([t, s], i) => (
        <Item key={t} p={p} at={(i / 5) * 0.9} frame={frame} ok sub={s}><b style={{ color: C.cy }}>{t}</b></Item>
      ))}
    </div>
  ),

  /** the scorecard, with the ROC curve drawing itself */
  proof: ({ p, frame }) => {
    const draw = ease((frame - 20) / 70);
    const pts = Array.from({ length: 41 }, (_, i) => { const x = i / 40; return { x, y: Math.pow(x, 0.42) }; });
    const n = Math.max(2, Math.floor(pts.length * draw));
    const d = pts.slice(0, n).map((q, i) => `${i ? "L" : "M"}${20 + q.x * 250} ${200 - q.y * 180}`).join(" ");
    return (
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, alignItems: "start" }}>
        <Rv p={p} at={0.05} frame={frame} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 20, padding: 16 }}>
          <svg viewBox="0 0 290 220" width="100%">
            <line x1={20} y1={200} x2={270} y2={200} stroke={C.line} strokeWidth={2} />
            <line x1={20} y1={200} x2={20} y2={20} stroke={C.line} strokeWidth={2} />
            <line x1={20} y1={200} x2={270} y2={20} stroke={C.mut} strokeWidth={2} strokeDasharray="6 6" opacity={0.5} />
            <path d={d} fill="none" stroke={C.cy} strokeWidth={4} strokeLinecap="round" />
            <text x={150} y={216} fill={C.mut} fontSize={15} textAnchor="middle">false alarms →</text>
          </svg>
          <div style={{ textAlign: "center", fontSize: 26, color: C.mut, marginTop: 4 }}>ROC · 300 replayed cases</div>
        </Rv>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <Tile p={p} at={0.15} frame={frame} n="0.77" l="AUC (0.5 would be a coin flip)" />
          <Tile p={p} at={0.4} frame={frame} n={<Counter to={97} frame={frame} start={34} color={C.cy} suffix="%" />} l={'of "likely fraud" verdicts really were fraud'} />
          <Tile p={p} at={0.62} frame={frame} n={<Counter to={15} frame={frame} start={52} color={C.am} suffix="%" />} l="exact fraud pattern named correctly" color={C.am} />
          <Tile p={p} at={0.82} frame={frame} n="drifts" l="calibration at the edges: the next fix" color={C.am} />
        </div>
      </div>
    );
  },

  demo: ({ p, frame }) => (
    <div style={{ display: "grid", gap: 14 }}>
      {["Database check", "Investigate alert HHG-014, for real", "Read the answer", "Break the AI model on purpose", "The console: steps, evidence, approvals"].map((t, i) => <Item key={t} p={p} at={i * 0.15} frame={frame} i={i + 1}>{t}</Item>)}
    </div>
  ),

  close: ({ p, frame }) => (
    <div style={{ display: "grid", gap: 18 }}>
      {[["A graph", "that finds the links"], ["Rules", "that decide"], ["An AI", "that only explains"], ["Nothing", "made up"]].map(([a, b], i) => <Item key={a} p={p} at={0.1 + i * 0.2} frame={frame} ok><b style={{ color: C.cy }}>{a}</b> {b}</Item>)}
      <Card p={p} at={0.85} frame={frame}><b>Next:</b> better calibration · naming fraud patterns · account takeover</Card>
    </div>
  ),
};
