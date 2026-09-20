# Making the demo video

## Compiled with Remotion (one command each)

The video is built by **Remotion** (React to MP4) in `video/remotion/`. It is fully automatic: real command output, real browser footage of the console, and a neural voice narrating the script. Length: **about 3:12** (the spec asks for 3 to 5 minutes): about 1:34 of product explanation and about 1:23 of live demo, plus a title and an end card.

```bash
cd video/remotion
npm install                       # once
npm run capture:terminal          # runs the real demo commands and records their real output and timings (needs Ollama + the Savanna workspace)
npm run capture:browser           # records real screenshots of the console in a headless Chrome (needs the console running: run-all.bat)
npm run render                    # -> video/remotion/out/fraud-investigator.mp4
npm run studio                    # Remotion Studio: scrub and preview the video in the browser
```

### Narration

The script is **`video/NARRATION.md`**: 16 segments, each with a DIRECTION line (the delivery: pitch,
pace, pauses) and the exact words to speak. It is written for **Gemini TTS**, which has no SSML and
ignores bracket tags, so the direction goes in the prompt and the pacing lives in the punctuation.

Generate one file per segment, named `nar-01.mp3` … `nar-16.mp3`, then:

```bash
npm run narration -- --in ../../narration-audio    # measure, cut into sentences, build the timeline
npm run render
```

`ingest-narration.mjs` measures each file's real length and cuts it into one clip per sentence on the
pauses the narrator actually left (falling back to a proportional cut). The animation then times
itself to your audio, so the segment lengths in NARRATION.md are a guide, not a constraint.

The old Edge-TTS path (`npm run audio`) is still there as a fallback.

What is real and what is not, in this video:
- **Terminal scenes** replay exactly what the commands printed, with their real timings. Long waits are shortened (a badge says "real time ... time-lapse x N"); only the database address is masked.
- **Browser scenes** are real screenshots of the real console, taken by a headless Chrome with its own empty profile (nothing from your desktop can appear). The investigation part is sped up and labelled.
- **The narrator** is Microsoft's neural voice (Aria) reading the script; only the public script text is sent to that service. The avatar's mouth follows the real loudness of that audio. It is a cartoon presenter, not a person.
- Numbers on the slides (590,742 payments, AUC 0.77, 315 IDs checked, 138 tests) come from real runs.

To change what it says, edit `frontend/public/video-script.json` (the `short` texts and the demo `shortSay` lines), then `npm run audio` and `npm run render`. The full 12-minute edition uses `--edition full` for the audio; it needs the deep-dive visuals added to `src/visuals.tsx`.

---

## Presenter Studio and OBS (an alternative, for recording yourself live)

Everything you need is here. The hackathon asks for a **3 to 5 minute** video, so there are two editions from one script: a **submission cut** (about 3:12, inside the spec's 3 to 5 minutes) and a **full detailed edition** (about 12 minutes) for a longer upload.

| File | What it is |
|---|---|
| `frontend/public/video-script.json` | The script (single source of truth). Edit the words here. |
| `video/SCRIPT.md` | Printable version of the script with timings. Regenerate: `node video/make-script-md.mjs > video/SCRIPT.md` |
| `frontend/public/studio.html` | **Presenter Studio**: a teleprompter for your head cam, and an animated AI presenter that speaks the script. Opens at http://localhost:3000/studio.html |
| `video/open-studio.bat` | Starts everything if needed and opens the studio (in Edge, for the best voices) |
| `video/demo.bat` | The live terminal demo, step by step, with pauses |
| `video/show-case.mjs` | Prints an answer file in plain, readable colours (used by demo step 4) |

## Two ways to present, and you can mix them

1. **Animated AI presenter** (`AI presenter` tab): a friendly robot speaks each chapter aloud with a moving mouth, live subtitles, and an animated diagram per chapter (numbers, architecture, steps, guardrails, scorecard). It pauses at **LIVE DEMO** and waits for you.
2. **You on the head cam** (`Teleprompter` tab): big scrolling text with a guide line, adjustable speed and size, a mirror mode for a teleprompter glass, and the demo steps shown as amber "DO THIS" cards with the exact command.

A good structure for the submission cut (about 3:12):

| Time | Who / what | Studio chapters |
|---|---|---|
| 0:00 to 1:40 | AI presenter (or you), full screen | 1 to 7: the problem, the trap, the idea, architecture, how it thinks, guardrails, scorecard |
| 1:40 to 3:00 | **You, live** in the terminal, then the browser | 8: LIVE DEMO (steps 1 to 6, then 8) |
| 3:00 to 3:12 | AI presenter or you | 9: what is next, thank you |

For the long edition, switch **Edition** to "Full detailed": it adds seven deep dives (TigerGraph design, signatures, two cases, rules and approvals, GraphRAG, the AI model, engineering) and all eight demo steps.

## Before you record (10 minutes)

1. **Resume the Savanna workspace** and wait until it is Active. Run `bash scripts/tg-check.sh`.
2. Ollama is running (Windows app). `gemma4:31b-cloud` and `nomic-embed-text` are in `ollama list`.
3. **Do a full dry run** of `video\demo.bat`. The first database call after a pause is slower; a rehearsal warms it up and lets you check every step.
4. **Never show `.env`.** It holds the database secret. Do not open it on screen and do not `cat` it.
5. Close chat apps and turn on Do Not Disturb so no notification pops up.
6. Open the studio in **Microsoft Edge** for the natural voices (Aria, Guy, Jenny): `video\open-studio.bat`. Choose a voice, press **Test voice**.

## OBS setup (OBS Studio is installed on this laptop)

Settings: Output resolution 1920x1080, 30 fps, recording format MKV (safe against crashes), then convert with `ffmpeg -i in.mkv -c copy out.mp4`.
Add **Desktop audio** (this captures the AI presenter's voice) and your **microphone** (for your live parts).

Scenes (switch with hotkeys):

1. **AI presenter**: *Window Capture* of the Edge window showing the studio. Press **H** in the studio to hide the controls for a clean picture, and F11 for full screen.
2. **Terminal**: *Window Capture* of Windows Terminal. Set the font to about 20 pt, dark theme, and run `video\demo.bat`.
3. **Browser demo**: *Window Capture* of the console at http://localhost:3000.
4. **Head cam** (if you present yourself): *Video Capture Device* full screen, or small in a corner over another scene.

Use a *Window Capture* (not an OBS Browser Source) for the studio: the studio uses the browser's speech voices, which the built-in OBS browser does not provide.

## Using the teleprompter

- **Best**: put the studio on a second screen or a phone/tablet right under the camera. Phone: open `http://<your-laptop-ip>:3000/studio.html` (the console prints its network address when it starts).
- Press **Space** to start and pause. **+ / -** change speed (words per minute), **[ / ]** change text size, **M** mirrors it for a teleprompter glass, **N / P** jump chapter, **R** restart.
- The teleprompter shows the demo steps as amber cards: the command to type, then what to say. Your own typing time is not scrolled for you, so pause with Space during a command and start again when it finishes.

## The live demo, step by step

Run in a large clean terminal from `D:\Coding\hhg-task`:

```
video\demo.bat            all steps, waiting for a key before each
video\demo.bat 3          just step 3 (for a retake)
```

| Step | What it shows | Time |
|---|---|---|
| 1 | Database check (TigerGraph reachable, secret valid, version 4.2.5) | 5 s |
| 2 | 138 tests pass | 5 s |
| 3 | **Investigate alert HHG-014 for real**: reads TigerGraph over MCP, GraphRAG lookup, the AI model writes the text | about 25 s |
| 4 | **Read the answer** in plain colours: likely fraud, the shared device, the actions and who must approve | 10 s |
| 5 | Break the AI model on purpose: the case stops with a clear error, no fake text | 15 s |
| 6 | The backtest on 300 past cases (AUC 0.77) | 5 s |
| 7 | `run-all.bat`: starts everything and opens the browser | 30 s |
| 8 | In the browser: pick HHG-014, Investigate, show the steps, the wiring diagram, "Who talked to whom", the approval buttons | 60 s |

For the submission cut do steps 1 to 6 and 8 (step 7, `run-all.bat`, only starts the console).

## If something goes wrong on camera

| Symptom | Fix |
|---|---|
| Step 3 says `STOPPED ... could not write the summary` | Ollama is not running, or you are signed out of Ollama cloud. Start Ollama and retry (this is the honest failure behaviour, not a bug). |
| Step 1 says `reachable NO` | The Savanna workspace is suspended. Resume it, wait until Active. |
| The AI presenter is silent | Press **Test voice**. Use Edge. Check Windows volume and that the tab is not muted. |
| The AI presenter stops mid-chapter | Chrome sometimes cuts speech; press Space twice, or use the chapter buttons. |
| Diagrams look cut off | Resize the window to a 16:9 shape, or press F11. |

## What is real and what is not

The demo runs the real agent against the real TigerGraph database with a real AI model; the numbers on the slides (590,742 payments, AUC 0.77, 315 IDs checked, 138 tests) come from real runs. The animated presenter is a cartoon voiced by your computer's text-to-speech; it is not a video of a real person or a lip-synced human, and the video should not claim otherwise.
