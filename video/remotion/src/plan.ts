import timelineShort from "./timeline.short.json";
import terminal from "./captures/terminal.json";
import browser from "../public/browser/frames.json";

export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const sec = (s: number) => Math.round(s * FPS);

export interface Clip { text: string; file: string; dur: number; env: number[]; start: number; frames: number }
export interface Scene {
  kind: "title" | "talk" | "demo-intro" | "cue" | "end";
  chapterId: string; visual: string; title: string; command?: string;
  clips: Clip[]; start: number; frames: number;
  lead: number; narr: number; // frames of silence before the narration, and of narration
  term?: string; browser?: boolean;
}
export type Terminal = Record<string, { title: string; display: string; events: { t: number; text: string; exit?: number }[]; totalMs: number }>;
export const TERM = terminal as unknown as Terminal;
export const BROWSER = browser as { w: number; h: number; case: string; frames: { file: string; t: number; phase: string }[] };

const LEAD = sec(0.4), TAIL = sec(0.6), CLIP_GAP = sec(0.15);

/** Browser scene budget: idle, the time-lapsed investigation, then the guided tour that holds on each panel. */
export const IDLE_S = 2.0, RUN_S = 8, TOUR_S = 11;
export const TYPE_CPS = 42; // typing speed of the command line, characters per second

/** How the real output of a command is replayed: idle gaps are shortened so a 20-second wait does not bore the viewer. */
export function compressEvents(events: { t: number }[], maxGapMs = 650, maxTotalS = 9) {
  const comp: number[] = []; let acc = 0, prev = 0;
  for (const e of events) { acc += Math.min(maxGapMs, e.t - prev); prev = e.t; comp.push(acc); }
  const scale = Math.min(1, (maxTotalS * 1000) / Math.max(1, acc));
  return { comp: comp.map((c) => c * scale), total: acc * scale, realTotal: events[events.length - 1]?.t ?? 0 };
}

export function buildPlan() {
  const scenes: Scene[] = [];
  let cursor = 0;
  const push = (s: Omit<Scene, "start">) => { scenes.push({ ...s, start: cursor }); cursor += s.frames; };

  push({ kind: "title", chapterId: "title", visual: "", title: "Fraud Investigator", clips: [], lead: 0, narr: 0, frames: sec(2.6) });

  for (const raw of timelineShort.scenes as any[]) {
    const clips: Clip[] = []; let t = LEAD;
    for (const c of raw.clips) { const frames = Math.ceil(c.dur * FPS) + 2; clips.push({ text: c.text, file: c.file, dur: c.dur, env: c.env, start: t, frames }); t += frames + CLIP_GAP; }
    const narr = clips.length ? t - CLIP_GAP - LEAD : 0;
    let frames = LEAD + narr + TAIL, term: string | undefined, isBrowser = false;

    if (raw.kind === "cue") {
      const key = String(raw.title).match(/^(\d)\./)?.[1];
      if (key && TERM[key]) {
        term = key;
        const { total } = compressEvents(TERM[key].events);
        const typing = Math.ceil((TERM[key].display.length / TYPE_CPS) * FPS);
        frames = Math.max(LEAD + narr + sec(1.0), LEAD + typing + sec(0.5) + sec(total / 1000) + sec(1.6));
      } else if (key === "8") {
        isBrowser = true;
        // idle + the time-lapsed investigation + the guided tour, which now HOLDS on each panel long enough to read
        frames = Math.max(LEAD + narr + sec(1.5), sec(IDLE_S + RUN_S + TOUR_S));
      }
    }
    push({ kind: raw.kind, chapterId: raw.chapterId, visual: raw.visual, title: raw.title, command: raw.command, clips, lead: LEAD, narr, frames, term, browser: isBrowser });
  }

  push({ kind: "end", chapterId: "end", visual: "", title: "Thank you", clips: [], lead: 0, narr: 0, frames: sec(2.6) });
  return { scenes, total: cursor };
}
export const PLAN = buildPlan();
