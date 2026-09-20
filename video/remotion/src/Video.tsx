import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame } from "remotion";
import { BrowserReplay } from "./Browser";
import { FPS, H, PLAN, TERM, W, type Clip, type Scene, sec } from "./plan";
import { TerminalReplay } from "./Terminal";
import { C, FONT, VISUALS } from "./visuals";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** which narration clip is being spoken right now */
function useSpeech(scene: Scene, frame: number) {
  const clip = scene.clips.find((c) => frame >= c.start && frame < c.start + c.frames) ?? null;
  return { clip, speaking: !!clip };
}

/* ------------------------------------------------------------------ background */

/** A slowly breathing backdrop. Nothing on screen is ever completely still, which is what
 *  stops a slide deck from looking like a slide deck. */
const Backdrop: React.FC<{ frame: number; tint?: string }> = ({ frame, tint = C.bl }) => {
  const t = frame / FPS;
  const blob = (x: number, y: number, r: number, col: string, ph: number, op: number) => (
    <div style={{
      position: "absolute",
      left: `calc(${x}% + ${Math.sin(t * 0.22 + ph) * 3.2}%)`,
      top: `calc(${y}% + ${Math.cos(t * 0.17 + ph) * 3.6}%)`,
      width: `${r}%`, height: `${r * 1.7}%`, transform: "translate(-50%,-50%)",
      background: `radial-gradient(circle, ${col} 0%, transparent 68%)`, opacity: op, filter: "blur(22px)",
    }} />
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 22% 12%, #14224f 0%, ${C.bg} 62%)` }} />
      {blob(20, 18, 46, tint, 0, 0.3)}
      {blob(86, 76, 40, C.cy, 2.1, 0.16)}
      {blob(60, 4, 34, C.pu, 4.4, 0.12)}
      {/* a grid that drifts, so motion continues even when nothing is animating */}
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
        backgroundSize: "68px 68px",
        backgroundPosition: `${(t * 5) % 68}px ${(t * 3) % 68}px`,
        opacity: 0.1,
        maskImage: "radial-gradient(ellipse at 50% 45%, #000 15%, transparent 78%)",
        WebkitMaskImage: "radial-gradient(ellipse at 50% 45%, #000 15%, transparent 78%)",
      }} />
      <AbsoluteFill style={{ boxShadow: "inset 0 0 340px rgba(0,0,0,.72)" }} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ captions */

const Captions: React.FC<{ clip: Clip | null; frame: number; left?: number; right?: number; bottom?: number }> = ({ clip, frame, left = 200, right = 200, bottom = 46 }) => {
  if (!clip) return <div style={{ position: "absolute", left, right, bottom, height: 92 }} />;
  const words = clip.text.split(/\s+/);
  const weights = words.map((w) => w.length + 2), tot = weights.reduce((a, b) => a + b, 0);
  const prog = clamp01((frame - clip.start) / Math.max(1, clip.frames - 6));
  const rise = clamp01((frame - clip.start) / 7);
  let acc = 0;
  return (
    <div style={{
      position: "absolute", left, right, bottom, minHeight: 92, padding: "16px 34px",
      background: "rgba(4,8,20,.80)", backdropFilter: "blur(10px)", border: `1px solid ${C.line}`,
      borderRadius: 22, fontSize: 40, lineHeight: 1.3, fontWeight: 500, textAlign: "center", fontFamily: FONT,
      display: "flex", alignItems: "center", justifyContent: "center",
      opacity: rise, transform: `translateY(${(1 - rise) * 12}px)`, boxShadow: "0 18px 50px rgba(0,0,0,.45)",
    }}>
      <span>{words.map((w, i) => {
        const start = acc / tot; acc += weights[i];
        const state = prog >= acc / tot ? "past" : prog >= start ? "on" : "future";
        return <span key={i} style={{ color: state === "on" ? C.cy : state === "past" ? C.ink : "rgba(232,238,252,.42)", transition: "color .1s" }}>{w} </span>;
      })}</span>
    </div>
  );
};

const Chip: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = C.cy }) => (
  <div style={{ display: "inline-block", fontFamily: FONT, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", fontSize: 26, color, background: "rgba(7,13,29,.86)", border: `1px solid ${color}`, borderRadius: 12, padding: "8px 18px" }}>{children}</div>
);

const Audios: React.FC<{ scene: Scene }> = ({ scene }) => (
  <>{scene.clips.map((c) => <Sequence key={c.file} from={c.start} durationInFrames={c.frames}><Audio src={staticFile(c.file)} /></Sequence>)}</>
);

/** every scene fades in, fades out, and drifts very slightly: a cut is never hard */
const useSceneMotion = (frame: number, frames: number) => {
  const inK = clamp01(frame / 10);
  const outK = clamp01((frames - frame) / 10);
  const drift = frame / FPS;
  return { opacity: inK * outK, transform: `scale(${1 + drift * 0.0016}) translateY(${-drift * 0.9}px)` };
};

/* ------------------------------------------------------------------ scenes */

const TalkScene: React.FC<{ scene: Scene; index: number; count: number }> = ({ scene, index, count }) => {
  const frame = useCurrentFrame();
  const { clip } = useSpeech(scene, frame);
  const p = clamp01((frame - scene.lead) / Math.max(1, scene.narr));
  const V = VISUALS[scene.visual] ?? (() => null);
  const motion = useSceneMotion(frame, scene.frames);
  const titleK = spring({ frame, fps: FPS, config: { damping: 18, stiffness: 110, mass: 0.8 }, durationInFrames: 24 });
  const eyebrow = scene.kind === "demo-intro" ? "Live demo" : scene.chapterId === "close" ? "Wrap-up" : `Part ${index} of ${count}`;
  const title = scene.kind === "demo-intro" ? "Now, the live demo" : scene.title;

  return (
    <AbsoluteFill style={{ opacity: motion.opacity }}>
      <Backdrop frame={frame} />
      <AbsoluteFill style={{ transform: motion.transform }}>
        {/* header */}
        <div style={{ position: "absolute", left: 92, top: 64, right: 92, fontFamily: FONT }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, opacity: titleK }}>
            <div style={{ width: 8, height: 34, borderRadius: 4, background: `linear-gradient(180deg,${C.cy},${C.bl})`, transform: `scaleY(${titleK})` }} />
            <div style={{ fontSize: 26, letterSpacing: "0.18em", textTransform: "uppercase", color: C.cy, fontWeight: 700 }}>{eyebrow}</div>
          </div>
          <div style={{
            fontSize: 70, fontWeight: 800, lineHeight: 1.08, marginTop: 10, color: C.ink,
            opacity: titleK, transform: `translateY(${(1 - titleK) * 22}px)`,
          }}>{title}</div>
        </div>
        {/* stage */}
        {/* the stage: content sits in the optical middle rather than hugging the title */}
        <div style={{ position: "absolute", left: 92, right: 92, top: 232, bottom: 178, fontFamily: FONT, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ width: "100%" }}><V p={p} frame={frame} /></div>
        </div>
      </AbsoluteFill>
      <Captions clip={clip} frame={frame} />
      <Audios scene={scene} />
    </AbsoluteFill>
  );
};

const CueScene: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { clip } = useSpeech(scene, frame);
  const motion = useSceneMotion(frame, scene.frames);
  const step = scene.title.split(". ");
  const k = spring({ frame, fps: FPS, config: { damping: 18, stiffness: 120, mass: 0.7 }, durationInFrames: 20 });
  return (
    <AbsoluteFill style={{ opacity: motion.opacity }}>
      <Backdrop frame={frame} tint={C.am} />
      <div style={{ position: "absolute", left: 60, top: 30, display: "flex", alignItems: "center", gap: 16, opacity: k, transform: `translateY(${(1 - k) * 14}px)` }}>
        <Chip color={C.am}>{`Live · step ${step[0]}`}</Chip>
        <span style={{ fontFamily: FONT, fontSize: 36, fontWeight: 700, color: C.ink }}>{step[1] ?? scene.title}</span>
        <span style={{ fontFamily: FONT, fontSize: 24, color: C.mut, border: `1px solid ${C.line}`, borderRadius: 10, padding: "5px 12px" }}>real run · not a recording of a script</span>
      </div>
      {scene.term && (
        <>
          <div style={{ position: "absolute", left: 60, top: 100, transform: `scale(${0.985 + k * 0.015})`, transformOrigin: "top left" }}>
            <TerminalReplay capKey={scene.term} frame={frame} startAt={scene.lead} width={1800} height={756} />
          </div>
          <Captions clip={clip} frame={frame} left={60} right={60} bottom={24} />
        </>
      )}
      {scene.browser && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 88, display: "grid", placeItems: "center", transform: `scale(${0.985 + k * 0.015})` }}>
            <BrowserReplay frame={frame} total={scene.frames} width={1500} />
          </div>
          <Captions clip={clip} frame={frame} left={60} right={60} bottom={24} />
        </>
      )}
      <Audios scene={scene} />
    </AbsoluteFill>
  );
};

const Title: React.FC<{ scene: Scene; end?: boolean }> = ({ scene, end }) => {
  const frame = useCurrentFrame();
  const k = spring({ frame, fps: FPS, config: { damping: 20, stiffness: 90, mass: 1 }, durationInFrames: 30 });
  const out = interpolate(frame, [scene.frames - 14, scene.frames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Backdrop frame={frame} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: FONT, textAlign: "center" }}>
        <div style={{ opacity: k, transform: `translateY(${(1 - k) * 34}px) scale(${0.96 + k * 0.04})` }}>
          <div style={{ fontSize: 34, letterSpacing: "0.3em", color: C.cy, fontWeight: 700 }}>{end ? "BUILT WITH" : "HACKER HOUSE GOA · TIGERGRAPH"}</div>
          <div style={{ fontSize: end ? 86 : 132, fontWeight: 800, margin: "20px 0", background: `linear-gradient(90deg,${C.cy},${C.bl})`, WebkitBackgroundClip: "text", color: "transparent", lineHeight: 1.05 }}>
            {end ? "TigerGraph · MCP · GraphRAG · Ollama" : "Fraud Investigator"}
          </div>
          <div style={{ fontSize: 44, color: C.mut, maxWidth: 1400 }}>
            {end ? "A graph that finds the links. Rules that decide. An AI that explains. Nothing made up." : "An AI that checks suspicious card payments and shows its work"}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ root */

export const Main: React.FC = () => {
  const frame = useCurrentFrame();
  const talks = PLAN.scenes.filter((s) => s.kind === "talk" && s.chapterId !== "close");
  const bar = frame / PLAN.total;
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, color: C.ink }}>
      {PLAN.scenes.map((s, i) => (
        <Sequence key={i} from={s.start} durationInFrames={s.frames}>
          {s.kind === "title" && <Title scene={s} />}
          {s.kind === "end" && <Title scene={s} end />}
          {(s.kind === "talk" || s.kind === "demo-intro") && <TalkScene scene={s} index={Math.max(1, talks.indexOf(s) + 1)} count={talks.length} />}
          {s.kind === "cue" && <CueScene scene={s} />}
        </Sequence>
      ))}
      {/* chapter ticks, so the viewer can see the shape of the video */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, background: "rgba(255,255,255,.06)" }}>
        {PLAN.scenes.map((s, i) => <div key={i} style={{ position: "absolute", left: `${(s.start / PLAN.total) * 100}%`, width: 2, height: 6, background: "rgba(255,255,255,.18)" }} />)}
        <div style={{ position: "absolute", left: 0, height: 6, width: `${bar * 100}%`, background: `linear-gradient(90deg,${C.cy},${C.bl})`, boxShadow: `0 0 14px ${C.cy}` }} />
      </div>
    </AbsoluteFill>
  );
};
void W; void H; void sec; void TERM;
