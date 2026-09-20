import React from "react";
import { Img, interpolate, staticFile } from "remotion";
import { BROWSER, FPS, IDLE_S, RUN_S, sec } from "./plan";
import { C } from "./visuals";

/** Plays the REAL screenshots of the console: the alert is picked, the investigation runs (time-lapse), then the results are scrolled through. */
export const BrowserReplay: React.FC<{ frame: number; total: number; width: number }> = ({ frame, total, width }) => {
  const idle = BROWSER.frames.filter((f) => f.phase === "idle" || f.phase === "pick");
  const run = BROWSER.frames.filter((f) => f.phase === "run");
  const tour = BROWSER.frames.filter((f) => f.phase === "tour");
  const idleF = sec(IDLE_S), runF = sec(RUN_S);
  const pick = (list: typeof run, k: number) => list[Math.min(list.length - 1, Math.max(0, Math.floor(k * (list.length - 1))))];
  let f, label = "", tag = "";
  if (frame < idleF) { f = pick(idle, frame / idleF); label = "The console: 20 alerts, and the connection diagram"; }
  else if (frame < idleF + runF) {
    const k = (frame - idleF) / runF; f = pick(run, k);
    const realS = (run[run.length - 1].t - run[0].t) / 1000; label = "Investigating alert " + BROWSER.case + ": every step appears as it happens";
    tag = `⏱ real time ${(k * realS).toFixed(1)} s · time-lapse ×${(realS / RUN_S).toFixed(1)}`;
  } else {
    const k = Math.min(1, (frame - idleF - runF) / Math.max(1, total - idleF - runF - sec(0.6)));
    f = pick(tour, k);
    // the tour stops on five named panels; name the one currently on screen
    const stops = ["Signs of fraud, and signs it is innocent", "The result: what the agent decided, and why", "What to do next — and who has to approve it", "The report for the regulator", "Who talked to whom: every real call"];
    label = stops[Math.min(stops.length - 1, Math.floor(k * stops.length))];
  }
  const height = (width * BROWSER.h) / BROWSER.w;
  return (
    <div style={{ position: "relative", width, height, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}`, boxShadow: "0 24px 80px #000a", background: "#000" }}>
      <Img src={staticFile(`browser/${f.file}`)} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", left: 18, top: 16, background: "rgba(7,13,29,.86)", border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 16px", fontSize: 26, fontWeight: 600, color: C.ink, fontFamily: '"Segoe UI", sans-serif' }}>{label}</div>
      {tag && <div style={{ position: "absolute", right: 18, top: 16, background: "rgba(7,13,29,.86)", border: `1px solid ${C.am}`, borderRadius: 12, padding: "8px 16px", fontSize: 24, color: C.am, fontFamily: '"Segoe UI", sans-serif' }}>{tag}</div>}
    </div>
  );
};
export const browserHeight = (width: number) => (width * BROWSER.h) / BROWSER.w;
void interpolate; void FPS;
