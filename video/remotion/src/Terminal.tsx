import React from "react";
import { interpolate } from "remotion";
import { FPS, TERM, TYPE_CPS, compressEvents } from "./plan";
import { C } from "./visuals";

const PALETTE: Record<number, string> = { 30: "#6b7280", 31: "#f87171", 32: "#4ade80", 33: "#fbbf24", 34: "#60a5fa", 35: "#c084fc", 36: "#22d3ee", 37: "#e5e7eb", 90: "#6b7280", 91: "#fca5a5", 92: "#86efac", 93: "#fde68a", 94: "#93c5fd", 95: "#d8b4fe", 96: "#67e8f9", 97: "#ffffff" };
interface Span { text: string; color?: string; bold?: boolean; dim?: boolean }

/** Turns the real terminal output (with its colour codes) into styled spans, line by line. */
export function parseAnsi(raw: string): Span[][] {
  const text = raw.replace(/\r(?!\n)/g, "").replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, "");
  const lines: Span[][] = [[]];
  let color: string | undefined, bold = false, dim = false;
  const re = /\x1b\[([0-9;]*)m/g; let last = 0, m: RegExpExecArray | null;
  const emit = (s: string) => s.split("\n").forEach((part, i) => { if (i > 0) lines.push([]); if (part) lines[lines.length - 1].push({ text: part.replace(/\r/g, ""), color, bold, dim }); });
  while ((m = re.exec(text))) {
    emit(text.slice(last, m.index)); last = m.index + m[0].length;
    for (const code of (m[1] || "0").split(";").map(Number)) {
      if (code === 0) { color = undefined; bold = false; dim = false; } else if (code === 1) bold = true; else if (code === 2) dim = true; else if (code === 22) { bold = false; dim = false; }
      else if (code === 39) color = undefined; else if (PALETTE[code]) color = PALETTE[code];
    }
  }
  emit(text.slice(last));
  return lines;
}

export const TerminalReplay: React.FC<{ capKey: string; frame: number; startAt: number; width: number; height: number }> = ({ capKey, frame, startAt, width, height }) => {
  const cap = TERM[capKey];
  const { comp, total, realTotal } = compressEvents(cap.events);
  const typed = Math.min(cap.display.length, Math.max(0, Math.floor(((frame - startAt) / FPS) * TYPE_CPS)));
  const typingDone = startAt + Math.ceil((cap.display.length / TYPE_CPS) * FPS) + Math.round(0.5 * FPS);
  const tr = Math.max(0, ((frame - typingDone) / FPS) * 1000);
  const started = frame >= typingDone;
  const shown = cap.events.filter((_, i) => started && comp[i] <= tr).map((e) => e.text).join("");
  const lines = parseAnsi(shown);
  const fullLines = parseAnsi(cap.events.map((e) => e.text).join("")).length + 1; // whole output, so the layout does not jump while it grows
  const lh = Math.max(24, Math.min(34, Math.floor((height - 150) / fullLines)));
  const fs = Math.round(lh * 0.79);
  const MAX = Math.floor((height - 150) / lh);
  const visible = lines.slice(-MAX);
  const finished = started && tr >= total;
  const realElapsed = interpolate(tr, [0, Math.max(1, total)], [0, realTotal], { extrapolateRight: "clamp" });
  const lapse = realTotal / Math.max(1, total);
  const cursor = Math.floor(frame / 15) % 2 === 0;

  return (
    <div style={{ width, height, borderRadius: 18, background: "#0c0f1a", border: `1px solid ${C.line}`, boxShadow: "0 24px 80px #000a", overflow: "hidden", fontFamily: 'Consolas, "Cascadia Mono", monospace' }}>
      <div style={{ height: 52, background: "#141a2e", display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderBottom: `1px solid ${C.line}` }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <i key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c, display: "block" }} />)}
        <span style={{ marginLeft: 14, color: C.mut, fontSize: 22, fontFamily: '"Segoe UI", sans-serif' }}>Terminal · D:\Coding\hhg-task</span>
        {started && lapse > 1.25 && !finished && <span style={{ marginLeft: "auto", color: C.am, fontSize: 22, fontFamily: '"Segoe UI", sans-serif' }}>⏱ real time {(realElapsed / 1000).toFixed(1)} s · time-lapse ×{lapse.toFixed(1)}</span>}
        {finished && realTotal > 2500 && <span style={{ marginLeft: "auto", color: C.ok, fontSize: 22, fontFamily: '"Segoe UI", sans-serif' }}>✓ finished in {(realTotal / 1000).toFixed(1)} s (real time)</span>}
      </div>
      <div style={{ padding: "22px 30px", fontSize: fs, lineHeight: `${lh}px`, color: "#e5e7eb", whiteSpace: "pre-wrap", wordBreak: "normal", overflowWrap: "anywhere" }}>
        {frame >= startAt && (
          <div><span style={{ color: C.cy }}>PS D:\Coding\hhg-task&gt; </span><span style={{ color: "#fff" }}>{cap.display.slice(0, typed)}</span>{!started && cursor && <span style={{ background: "#e5e7eb" }}>&nbsp;</span>}</div>
        )}
        {visible.map((spans, i) => (
          <div key={i} style={{ minHeight: lh }}>{spans.map((s, j) => <span key={j} style={{ color: s.color, fontWeight: s.bold ? 700 : 400, opacity: s.dim ? 0.6 : 1 }}>{s.text}</span>)}</div>
        ))}
        {started && !finished && cursor && <span style={{ background: "#e5e7eb" }}>&nbsp;</span>}
      </div>
    </div>
  );
};
