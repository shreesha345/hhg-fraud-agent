# Narration script — Gemini TTS

Submission cut. **16 segments, ~4:40 of finished video** (the spec asks for 3–5 minutes).
Every number here comes from a real run and matches `frontend/public/video-script.json`,
`CLAUDE.md` §4 and the answer files in `cases/`. Do not add numbers.

---

## How to drive Gemini TTS (read this before generating)

Gemini TTS (`gemini-2.5-flash-preview-tts` / `gemini-2.5-pro-preview-tts`) **does not support SSML** —
no `<prosody>`, no `<break/>` — and **inline bracket tags like `[excited]` are read out loud.**
It is steered two ways:

1. **One short instruction ending in a colon, immediately before the words.** This is the documented
   pattern and the only reliable one.
2. **Punctuation inside the text.** Comma = short beat. Full stop = longer. `—` = a cut-in.
   Short sentences read faster and higher; long clauses fall at the end.

### Three rules learned the hard way (all measured, not guessed)

- **Keep DIRECTION to one short sentence, and never refer to the recording itself.** Directions that
  ran to several sentences, or said things like "of the whole video" or "before the last two words",
  were *spoken aloud* instead of obeyed. That was the single biggest failure.
- **Avoid `…` in the text.** Segments built around lone ellipses were the ones that degenerated into
  minutes of near-silence. Ordinary full stops give the same pause and are stable.
- **Charon speaks at about 13 characters per second.** Budget length from that, not from instinct:
  3,200 characters ≈ 4 minutes of narration ≈ a 4:40 video.

Each segment gives you **DIRECTION** (one line, ends with a colon — your "audio tag") and **SAY**
(the exact words). `scripts/gemini-tts.mjs` parses both out of this file and sends them as
`DIRECTION SAY`, so **this file is the single source of truth** — edit here, re-run, audio follows.

### Generating

```bash
cd video/remotion
npm run tts                                        # -> narration-audio/nar-01..16.wav
npm run narration -- --in ../../narration-audio    # measure + cut to sentences
npm run render                                     # -> out/fraud-investigator.mp4
npm run srt                                        # -> out/fraud-investigator.srt
```

`npm run tts` measures every clip against the length its text implies and **retries any segment that
is too long (it read the direction), too short (truncated) or too quiet (near-silence)**, up to three
takes, then names anything still bad. Regenerate one with `npm run tts -- --only 16`.

The animation times itself to the real audio, so you never have to hit a target length.

### Voice

| Voice | Character | Use |
|---|---|---|
| **Charon** | Informative, lower, steady | **Recommended.** Reads as an engineer explaining their own system. |
| Enceladus | Breathy, softer | If Charon feels flat on the demo segments. |
| Kore | Firm, brighter | A more "product launch" tone. |
| Puck | Upbeat | Too salesy for this. Avoid. |

Keep **one voice for all 16**. Switching mid-video reads as a mistake.

---

## The vocal arc

Do not read all sixteen at one level — that is what makes narration sound robotic.

```
  high │                                    ╭──╮ S12 (the 94% reveal)
energy │        ╭──╮ S02 (the trap)      ╭──╯  ╰─╮
       │  ╭──╮  │  ╰─╮        ╭─────────╯       ╰──╮
   low │──╯  ╰──╯    ╰────────╯                    ╰───  S16 (thank you)
       └──────────────────────────────────────────────────
         S01  S02  S03-05   S06-07    S08-11   S12-15  S16
        open  hook  build   sober      demo    payoff  land
```

- **S01–S02** — open warm, then drop on the trap. This earns the attention.
- **S03–S05** — steady, explanatory, slightly quicker. Teaching; do not oversell.
- **S06–S07** — *lower and slower.* The guardrails and the honest scorecard. Understating a limitation
  convinces more than defending it.
- **S08–S11** — live and present-tense, lighter, like narrating your own screen.
- **S12** — the one lift in the video.
- **S13–S15** — back down, matter-of-fact. The *rules* decided, not the AI.
- **S16** — slowest and lowest. Land it and stop.

---

# THE SCRIPT

---

### S01 — The problem

**DIRECTION**
> Read this warmly and calmly, like a documentary narrator:

**SAY**
> Every day, a bank gets thousands of alerts saying a card payment might be fraud. A thief? Or a
> customer on holiday with a new phone? Block the wrong card, you lose a customer. Miss the thief, the
> bank loses money. This AI makes that call, and shows its work.

---

### S02 — The task, and the trap

**DIRECTION**
> Start brisk, then drop lower and slower from the word trap onwards:

**SAY**
> Twenty alerts. For each, the agent decides the kind of fraud, or that the customer is innocent, and
> the next best action, with who approves it. Here is the trap. The bank score is close to a decoy.
> All nine hundred cleared cases scored high. A third of confirmed fraud scored low.

---

### S03 — Fraud lives in the connections

**DIRECTION**
> Quietly confident and a little quicker, reading the numbers as a rising list:

**SAY**
> Fraud lives in the connections. One rare phone setup, across many cards. Purchases kept just under a
> limit. So everything goes into a graph, in TigerGraph. Five hundred and ninety thousand payments.
> Fourteen thousand cards. A graph finds those links in milliseconds.

---

### S04 — The architecture

**DIRECTION**
> Clear and measured, landing the last three sentences separately and firmly:

**SAY**
> Four parts. A console in your browser. The agent, a TypeScript program. TigerGraph in the cloud,
> reached only through sixteen installed GSQL queries on the MCP server. And Ollama for the words.
> The graph analyses. The rules decide. The AI explains.

---

### S05 — How the agent thinks

**DIRECTION**
> Explanatory and even, giving the prosecutor and the defence slightly different colours:

**SAY**
> Every case is frozen at the moment it opened, so there is no look-ahead. Then two advocates run at
> once: a prosecutor hunting fraud, and a defence hunting the innocent explanation, like a holiday or
> a new phone. A judge weighs them, and the rules choose.

---

### S06 — The guardrails

**DIRECTION**
> Read this low and plainly, stating constraints rather than selling a feature:

**SAY**
> The guardrails. The easy way to win a demo is to make things up. The customer reply is not in the
> data, so we do not invent one. Every identifier is checked against the graph. If the model fails,
> the case stops with an error.

---

### S07 — The honest scorecard

**DIRECTION**
> Completely level, reading the weak numbers at the same weight as the good one:

**SAY**
> The honest scorecard. Three hundred past cases replayed with no look-ahead. Area under the curve,
> point seven seven. Likely fraud is right ninety-seven percent of the time. But calibration drifts,
> and naming the pattern still needs work.

---

### S08 — Into the demo

**DIRECTION**
> Lighter and quicker, like turning to a screen to start work:

**SAY**
> So, let us actually run it. Terminal first, then the browser.

---

### S09 — Demo 1: database check

**DIRECTION**
> Relaxed and quick, narrating your own screen:

**SAY**
> A health check. Reachable, the secret works, and TigerGraph comes back with version four point two
> point five.

---

### S10 — Demo 2: tests

**DIRECTION**
> Brisk and light, with a small note of satisfaction on the count:

**SAY**
> Then the tests. A hundred and thirty-eight, in about two seconds, and the same suite runs against
> the live cloud graph.

---

### S11 — Demo 3: investigate HHG-014

**DIRECTION**
> Say the score slowly and flatly, then drop almost to an undertone on the last sentence:

**SAY**
> Now, one real alert. Number fourteen. The bank score is point zero five. By that score, this
> customer is innocent. Watch what the graph finds.

---

### S12 — Demo 4: read the answer

**DIRECTION**
> Lift your pitch and energy on the first line, then pull steadily back down to flat:

**SAY**
> Likely fraud. Ninety-four percent. Forty-four customers share one rare device profile. Always new.
> Always behind an anonymous proxy. The score never saw it. So: monitor the linked cards, open a case,
> escalate, and file a report that needs a fraud manager. The rules chose that, not the AI.

---

### S13 — Demo 5: honest failure

**DIRECTION**
> Slightly wry on the first sentence, then completely flat:

**SAY**
> And now I break the model on purpose. The case stops. A clear error, and no file is written. No
> invented text, no quiet fallback.

---

### S14 — Demo 6: the backtest

**DIRECTION**
> Plain and even, drifting down at the end:

**SAY**
> And the backtest. Three hundred past cases, replayed as if new, each frozen at its own opening
> moment. These numbers are being produced live.

---

### S15 — Demo 8: the console

**DIRECTION**
> Warm and guiding, keeping it moving, landing the last sentence low:

**SAY**
> Now the console. Pick the alert, press Investigate, and every step appears as it happens, with what
> it found and why. The signs of fraud, and the signs of innocence. The next best action, with its
> approval buttons. Every line comes from a real log.

---

### S16 — Close

**DIRECTION**
> Slow, warm and low, ending flat:

**SAY**
> So that is it. A graph that finds the links. Rules that decide. An AI that only explains. And
> nothing made up. Thank you.

---

## Direction vocabulary that actually works

| To get | Write in DIRECTION | And in the text |
|---|---|---|
| **Higher pitch / lift** | "lift the pitch", "brighter" | short sentence, question mark |
| **Lower pitch / drop** | "drop lower", "quieter, more serious" | longer clause, full stop |
| **Slower** | "slow down", "deliberately" | em-dashes, short lines |
| **Quicker** | "brisk", "keep it moving" | commas instead of full stops |
| **Emphasis on a word** | "put weight on the numbers" | isolate it: `Ninety-four percent.` |
| **Two voices in one line** | "give them different colours" | separate sentences per voice |

What does **not** work and will be read aloud: bracket tags (`[excited]`), SSML (`<break/>`),
multi-sentence directions, and anything that talks *about* the recording. Keep DIRECTION to one short
sentence ending in a colon — that is the single most important rule here.
