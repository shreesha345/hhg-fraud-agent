"use client";
import type { GraphView as G } from "@fraud/shared";

const W = 460, H = 330, CX = W / 2, CY = H / 2 - 5;

function place(g: G): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const ring = (ids: string[], r: number, start: number) =>
    ids.forEach((id, i) => {
      const a = start + (i / Math.max(1, ids.length)) * Math.PI * 2;
      pos[id] = { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
    });
  const by = (k: string) => g.nodes.filter((n) => n.kind === k).map((n) => n.id);
  const card = g.nodes.find((n) => n.kind === "card");
  if (card) pos[card.id] = { x: CX, y: CY };
  ring(by("txn"), 78, -Math.PI / 2);
  ring(by("device"), 128, Math.PI / 2 + 0.4);
  ring(by("other_card"), 150, -Math.PI / 2 + 0.3);
  ring(by("case"), 120, Math.PI * 0.9);
  return pos;
}

const fill = (n: G["nodes"][number]) =>
  n.kind === "card" ? "var(--agent)" : n.kind === "device" ? "var(--graph)" : n.kind === "case" ? "var(--ok)"
  : n.flag === "flagged" ? "var(--bad)" : n.flag === "affected" ? "var(--gate)" : n.flag === "live" ? "var(--gate)" : "var(--muted)";

export function GraphView({ graph }: { graph: G }) {
  if (graph.nodes.length < 2) return <p className="empty">Nothing to draw for this alert.</p>;
  const pos = place(graph);
  return (
    <div className="pad">
      <svg className="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Graph of the card, its suspicious transactions, shared devices and connected cards">
        {graph.edges.map((e, i) => pos[e.from] && pos[e.to] && (
          <line key={i} x1={pos[e.from].x} y1={pos[e.from].y} x2={pos[e.to].x} y2={pos[e.to].y} stroke="var(--line)" strokeWidth={1.4} />
        ))}
        {graph.nodes.map((n) => pos[n.id] && (
          <g key={n.id} transform={`translate(${pos[n.id].x},${pos[n.id].y})`}>
            <circle r={n.kind === "card" ? 15 : n.kind === "txn" ? 10 : 9} fill={fill(n)} opacity={n.flag === "closed" ? 0.45 : 1} />
            <text y={n.kind === "card" ? 30 : 22} textAnchor="middle" fontSize="9.5" fill="var(--muted)" fontFamily="var(--mono)">{n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}</text>
          </g>
        ))}
      </svg>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5, color: "var(--muted)" }}>
        <span><span className="dot" style={{ background: "var(--agent)" }} />this card</span>
        <span><span className="dot" style={{ background: "var(--bad)" }} />the payment in question</span>
        <span><span className="dot" style={{ background: "var(--gate)" }} />other suspicious payments, or linked cards still open</span>
        <span><span className="dot" style={{ background: "var(--graph)" }} />device used</span>
        <span><span className="dot" style={{ background: "var(--muted)", opacity: 0.5 }} />already dealt with</span>
        <span><span className="dot" style={{ background: "var(--ok)" }} />similar past case</span>
      </div>
    </div>
  );
}
