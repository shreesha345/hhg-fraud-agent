import { PLAN, FPS } from "../src/plan";
let acc = 0;
for (const s of PLAN.scenes) { console.log(String(s.start).padStart(6), (s.frames / FPS).toFixed(1).padStart(6) + "s", s.kind.padEnd(11), s.title.slice(0, 40)); acc += s.frames; }
console.log("TOTAL", PLAN.total, "frames =", (PLAN.total / FPS).toFixed(1), "s =", Math.floor(PLAN.total / FPS / 60) + ":" + String(Math.round((PLAN.total / FPS) % 60)).padStart(2, "0"));
