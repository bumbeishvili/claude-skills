---
name: explainer-video
description: Make a narrated explainer or guide video of a web app — a cursor that clicks and types through the real UI, a spotlight and callouts naming each part, a browser-window intro with the address, and a local AI voice (Kokoro 82M, voice af_heart) reading the script — recorded with Playwright at 1920x1080 and built into a web-sized H.264 MP4. Use when asked for a product tour, feature preview, onboarding, how-to, CMS guide or demo video of a site or app, or to add narration, cursor animation or callouts to a screen recording. Checks the voice setup first and has the user install the model if it is missing. Start from templates/; playbook.md has the recipes and traps.
---
# Explainer video

A video built the same way every time: a script of short narration lines, voiced
locally, and a Playwright tour that plays one segment per line against the running app.
Frames are captured at 1920x1080, the build lays the voice under them, and a check
reports gaps, silences and a contact sheet before anyone watches it.

| File | What it does |
|---|---|
| [`setup.sh`](setup.sh) | `--check` reports what is missing; without it, installs the voice, ffmpeg and Playwright |
| [`voice.cjs`](voice.cjs) | voices `narration.json` with Kokoro, one clip per line, and records each line's length |
| [`tour-kit.cjs`](tour-kit.cjs) | `record()`: overlay, capture, and the helpers a tour script uses |
| [`build.cjs`](build.cjs) | frames + narration → `video.mp4` (H.264, 1080p) |
| [`verify.cjs`](verify.cjs) | length, gaps between lines, long silences, `contact-sheet.png` |
| [`templates/`](templates/) | a starter `tour.cjs` and `narration.json` |
| [`playbook.md`](playbook.md) | recipes for each kind of action, pacing numbers, and the traps |

## 0. The voice is fixed, and set up first

Every video uses **Kokoro 82M through mlx-audio, voice `af_heart`**, running on this
machine. Do not swap in a cloud voice, macOS `say` or another model, and do not send the
script to an outside service. Changing the voice is the user's call.

Before anything else, run:

```bash
bash <skill>/setup.sh --check
```

It reads, changes nothing and exits 1 when something is missing. If anything is,
**ask the user to run `bash <skill>/setup.sh` in their own terminal.** It installs into
`~/.cache/explainer-video` (about 1.5 GB): the voice runtime, the 0.4 GB model, a
short-path espeak copy, an ffmpeg with H.264, and Playwright. It ends by voicing a test
line the user can play. Agent-run installs and model downloads are usually blocked by
the permission check, and a half-done install is harder to fix than one the user ran.
Needs an Apple Silicon Mac; elsewhere, say mlx-audio does not run there and stop.

## 1. Agree the video before writing anything

Settle with the user, in a few lines:

- **Audience and goal**: who watches, what they should be able to do after.
- **Length**: Kokoro speaks about 3.3 words a second. With actions and pauses, two
  minutes holds about 25 lines and 300 words; one minute, about 13 lines and 140 words.
- **Sections, in order**, and anything to leave out.
- **How to name the product aloud** ("this portal", the product name) and which
  address the intro types. Do not speak URLs or domains unless asked; show them.
- **Demo data**: a demo account and made-up records. Never film a real account or real
  people's data. Serve fixtures by `context.route` if the app has no demo mode.

## 2. Write the script, one action per line

`narration.json` is a list of `{ id, label, text }` in playing order. `label` is the
callout's small heading; `speak` respells what Kokoro says wrong (tickers, product
names, a domain); `card` is on-screen text when it should differ from the voice (the
address on a closing card). Keep the video's work in a folder outside the repo.

- One line names one thing the viewer sees happen. If a line covers two actions
  ("paste your file, or link a sheet"), split it, or the picture runs ahead of the voice.
- 6–16 words. Plain words, concrete nouns, no marketing adjectives.
- Check acronyms: Kokoro runs letters together ("TQQQ" → "tikyukyukyu"). Spell them
  out in `speak` ("T Q Q Q"); `playbook.md` shows how to check pronunciation.

Then `node <skill>/voice.cjs <dir>`. It fails loudly if a clip's length doesn't fit its
words; listen to that clip before going on.

## 3. Write the tour, one segment per line

Copy `templates/tour.cjs`. Each `t.segment(id, run)` is one narration line; the segment
lasts until its line has been spoken, counted from the `t.say()` that starts it.

The rules that make it watchable (each came from a review):

- **Callouts never cover what the cursor uses.** Pass those selectors as `avoid`.
- **Actions land on their words.** `await t.untilWord(id, 'Save')` before the click.
- **Show a screen before acting on it.** A library or list gets a second or two of a
  glide over its items before the click.
- **Cut waits, don't film them.** Loading and recomputing go in `t.offCamera()`,
  outside any spoken line.
- **Native `<select>` popups never show in screenshots**: use `t.pickOption()`.
- **A mocked third-party screen** (an AI chat) is labelled generically and is not made
  to look like a real company's product.
- **No click sounds.** The build has none; don't add them.
- **State the app starts in is checked, not assumed.** Before a toggle, assert it is
  in the state the line describes (a default can depend on the time of day).

## 4. Dry run, then record

```bash
NODE_PATH="$(npm root -g)" node tour.cjs <dir> dry     # a still per segment in <dir>/dry/
NODE_PATH="$(npm root -g)" node tour.cjs <dir> rec     # frames + timeline.json
node <skill>/build.cjs <dir>
node <skill>/verify.cjs <dir>
```

Look at every dry still before recording: callout placement, spotlight fit, the right
state on screen. `STOP_AFTER=<id>` ends a take early to check one part. A take records
at half speed (about 2.5x the video's length in real time) and writes about 13 MB of
PNG frames per second of video. The kit refuses to write into a full `frames/`, so move
the old one aside (`mv frames frames-take1`) before the next take.

## 5. Check before handing it over

`verify.cjs` must show every gap at 0.25 s or more and no unexplained long silence.
Open `contact-sheet.png` and look at it. Then give the user the file, its length and
size, and ask them to listen: you cannot hear it, so pronunciation and pacing are theirs
to judge. Name any rough spot you know of.

Output defaults: 1920x1080 is the ceiling; `video.mp4` (H.264, crf 28) runs about
4 MB a minute. AV1 (`AV1=1`) saves about 17% and costs ~10 minutes of encoding; offer
it, don't default to it.

When the user asks for a change: a script change means `voice.cjs`, then a new take;
a visual change needs only a new take and build.
