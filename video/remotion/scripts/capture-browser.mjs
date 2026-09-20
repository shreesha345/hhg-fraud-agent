// Records REAL footage of the console: a headless Chrome with its own empty profile (so nothing from your desktop can appear) opens
// http://localhost:3000, picks an alert, presses Investigate, and takes screenshots for the whole run, then scrolls down the results.
//   node scripts/capture-browser.mjs [--case HHG-014]
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const caseId = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : "HHG-014";
const outDir = resolve(import.meta.dirname, "..", "public", "browser");
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!chrome) throw new Error("Chrome or Edge not found");

const W = 1200, H = 675, SCALE = 1.6; // 1200x675 CSS px at 1.6x = a sharp 1920x1080 image with larger text
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: mkdtempSync(join(tmpdir(), "vid-")), defaultViewport: { width: W, height: H, deviceScaleFactor: SCALE }, args: ["--no-first-run", "--hide-scrollbars", "--force-color-profile=srgb"] });
const page = await browser.newPage();
await page.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector(".queue button", { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500)); // let the health line and counts arrive

const frames = [];
const t0 = performance.now();
let n = 0;
const shot = async (phase) => {
  const file = `frame-${String(n++).padStart(4, "0")}.jpg`;
  await page.screenshot({ path: join(outDir, file), type: "jpeg", quality: 80 });
  frames.push({ file, t: Math.round(performance.now() - t0), phase });
};

// idle frame: the connection diagram and the alert list, before anything is chosen
await shot("idle"); await shot("idle");

// pick the alert
await page.evaluate((id) => { for (const b of document.querySelectorAll(".queue button")) if (b.textContent.trim().startsWith(id)) { b.scrollIntoView({ block: "center" }); b.click(); return; } throw new Error("alert not found: " + id); }, caseId);
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => window.scrollTo(0, 0));
await shot("pick"); await shot("pick");

// press Investigate
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Investigate/.test(x.textContent)); b.click(); });
const started = performance.now();
let last = "";
while (performance.now() - started < 240000) {
  // keep the newest step in view while the list grows
  await page.evaluate(() => { const s = document.querySelectorAll(".step"); const el = s[s.length - 1]; if (el) { const r = el.getBoundingClientRect(); if (r.bottom > innerHeight - 40) window.scrollBy(0, r.bottom - innerHeight + 60); } });
  await shot("run");
  const done = await page.evaluate(() => /Investigate again/.test([...document.querySelectorAll("button")].map((b) => b.textContent).join("|")) && !!document.querySelector(".steps .k-done"));
  if (done) break;
  const err = await page.evaluate(() => document.querySelector(".err")?.textContent ?? "");
  if (err && err !== last) { last = err; console.log("console error:", err.slice(0, 200)); if (/AI model|could not/.test(err)) throw new Error("the investigation failed: " + err.slice(0, 200)); }
}
await shot("run"); await shot("run");

// Guided tour of the finished page. Rather than scrolling continuously (which is unreadable on video),
// it travels to each named section and then HOLDS on it, so the viewer can actually read the panel.
await page.evaluate(() => window.scrollTo(0, 0)); await new Promise((r) => setTimeout(r, 500));

const topOf = (re) => page.evaluate((src) => {
  const h = [...document.querySelectorAll("h2")].find((x) => new RegExp(src).test(x.textContent));
  if (!h) return null;
  const sec = h.closest("section") ?? h;
  return Math.max(0, Math.round(sec.getBoundingClientRect().top + window.scrollY - 24));
}, re.source);

// [heading to stop at, frames to hold there]
const TOUR = [
  [/Signs of fraud/, 16],
  [/^Result$/, 22],
  [/What to do next/, 26],
  [/Report for the regulator/, 20],
  [/Who talked to whom/, 22],
];

let from = 0;
for (const [re, hold] of TOUR) {
  const to = await topOf(re);
  if (to === null) { console.log("tour: section not found, skipped:", re.source); continue; }
  const travel = 10;
  for (let i = 1; i <= travel; i++) {                                  // ease in and out between sections
    const y = Math.round(from + (to - from) * (0.5 - 0.5 * Math.cos((i / travel) * Math.PI)));
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await new Promise((r) => setTimeout(r, 60));
    await shot("tour");
  }
  for (let i = 0; i < hold; i++) await shot("tour");                   // hold still and let it be read
  from = to;
}

writeFileSync(resolve(outDir, "frames.json"), JSON.stringify({ w: W * SCALE, h: H * SCALE, case: caseId, frames }));
const run = frames.filter((f) => f.phase === "run");
const tour = frames.filter((f) => f.phase === "tour");
console.log(`${frames.length} frames; investigation ${((run.at(-1).t - run[0].t) / 1000).toFixed(1)} s real time over ${run.length} frames; guided tour ${tour.length} frames, scrolled to ${from}px`);
await browser.close();
