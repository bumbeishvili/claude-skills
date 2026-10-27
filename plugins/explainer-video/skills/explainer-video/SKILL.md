---
name: explainer-video
description: Make a narrated explainer or guide video of a web app — a cursor that clicks and types through the real UI, callouts and captions naming each part, a camera that zooms on what matters, marks drawn on the word that names them, chapters, title and recap cards, diagram/terminal/code scenes, and a local AI voice (Kokoro 82M, voice af_heart) reading the script — recorded with Playwright and built into a web-sized H.264 MP4 with captions, chapters, a transcript, an embed page, a written guide and a click-through walkthrough. Use when asked for a product tour, feature preview, onboarding, how-to, CMS guide or demo video of a site or app, or to add narration, cursor animation, zooms or callouts to a screen recording. Checks the voice setup first and has the user install the model if it is missing. Start from templates/; playbook.md has the calls, recipes and traps.
---
# Explainer video

A video built the same way every time: a script of short narration lines, voiced
locally, and a Playwright tour that plays one segment per line against the running app.
Frames are captured at 1920x1080, the build lays the voice and captions under them, and a
check reports gaps, silences and chapter problems before anyone watches it.

| File | What it does |
|---|---|
| [`setup.sh`](setup.sh) | `--check` reports what is missing; without it, installs the voice, ffmpeg and Playwright |
| [`voice.cjs`](voice.cjs) | voices `narration.json` with Kokoro, keeps each word's start time, re-voices only changed lines |
| [`tour-kit.cjs`](tour-kit.cjs) | `record()`: the overlay, the camera, capture, and every call a tour script uses |
| [`build.cjs`](build.cjs) | frames + voice → `video.mp4`, plus captions, chapters, transcript, poster, `embed.html` |
| [`verify.cjs`](verify.cjs) | length, gaps between lines, long silences, YouTube chapter rules, `contact-sheet.png` |
| [`guide.cjs`](guide.cjs) | from a dry run: `guide.md` (written steps) and `walkthrough.html` (click-through) |
| [`diff-stills.cjs`](diff-stills.cjs) | after a UI change: which segments look different from the approved stills |
| [`templates/`](templates/) | a starter `tour.cjs` and `narration.json` |
| [`playbook.md`](playbook.md) | every call, recipes, planning numbers, and the traps behind each rule |

## 0. The voice is fixed, and set up first

Every video uses **Kokoro 82M through mlx-audio, voice `af_heart`**, running on this
machine. Keep the script on this machine: no cloud voice, no macOS `say`, no other model.
Changing the voice (including `EXPLAINER_VOICE` for another language) is the user's call.

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
- **Length**: Kokoro speaks about 3.2 words a second. With actions and pauses, two
  minutes holds about 25 lines and 300 words; one minute, about 13 lines and 140 words.
- **Sections, in order**, and anything to leave out. Over a minute, sections become chapters.
- **Where it will play**: a docs page, a video host, social feeds that autoplay muted, a
  README. This decides captions, the frame and the outputs (section 7).
- **How to name the product aloud** ("this portal", the product name) and which
  address the intro types. Do not speak URLs or domains unless asked; show them.
- **Demo data**: a demo account and made-up records. Never film a real account or real
  people's data. Serve fixtures by `context.route` if the app has no demo mode.

## 2. Choose the effects that fit this video

The kit has many effects; a good explainer uses few. Start from the base, then add an
effect only where a line needs it, and say which ones you picked when you agree the video.

**The base for every video**: the cursor doing the real actions, a short label callout
(`callouts: 'label'`) on the part a line names, and captions. The rules for any effect:

- **It points at what the line names, when the line names it.** Fire it with
  `untilWord`. A cue matched to the spoken word in time and place is what makes cues help.
- **One effect at a time.** A camera move, a mark and a callout landing together compete
  for the same glance; stagger them across the line or drop one.
- **Nothing decorative.** Motion that carries no meaning lowers what viewers learn; leave
  the confetti, the 3D and the transitions for their own sake out.

| Effect | Use it when | Leave it out when |
|---|---|---|
| Spotlight (`spot`) | one control among many, on a page at full view | the camera is already zoomed on it |
| Camera zoom (`camera.focus`) | the target is small at full view: a number, a field, a badge | the line is about the whole page or a layout |
| Follow-cam (`camera.follow`) | the cursor travels a long way while zoomed (a form, a canvas) | the cursor stays in one area |
| Drift (`camera.drift`) | a held shot of 3 s or more with nothing moving | anything else is moving |
| Focus blur (`focus`) | a busy page, one panel matters | the rest of the page is context the viewer needs |
| Circle, underline, marker (`ink`) | a number or word the line says aloud | the label callout already names it |
| Note with arrow (`note`, `pulse`) | one data point or spot needs a name | the spot already has a visible label |
| Step badges (`badge`) | a how-to with ordered steps on one screen | the video is a tour, not a task |
| Dim others (`dim`), scrub (`scrub`) | a chart: one series or the trend along a line | the chart has one series and no hover readout |
| Stat card (`stat`) | a headline number the app does not show large | the app's own number is on screen |
| Lower third (`lowerThird`) | naming a screen or a person once | the chapter chip or a callout already names it |
| Before/after wipe (`before`, `wipe`) | a setting or edit changes how the page looks | the change is too small to see at full view |
| Strike (`ink` strike) | an old value replaced by a new one | — |
| Fast-forward (`fastForward`) | long typing or a repeated action the viewer should see happen | a wait: cut it (`offCamera`) |
| Chapters (`chapter` lines) | over a minute, with sections | under a minute |
| Preview and recap cards (`card`) | a tutorial over a minute: list the steps, then show them again | a short tour or a launch teaser |
| Scenes (`flow`, `terminal`, `code`) | a concept with no UI: how data moves, an install step, a config | the app can show it |
| Context menu, drag, text select, keys | the task uses them | — |
| Second cursor (`ghost`) | the feature is shared editing | one person uses the feature |
| Framed background (`FRAME=1`) | a marketing page or social post | docs, where the video sits in the page |
| Burned-in captions | autoplay muted, social, viewers in a second language | the player shows `captions.vtt` and viewers can turn it on |
| Motion blur, music | the user asks for them | by default |

## 3. Write the script, one action per line

`narration.json` is a list of `{ id, label, text }` in playing order. `label` is the
callout's two-or-three-word name for the part; `speak` respells what Kokoro says wrong;
`card` is on-screen text when it should differ from the voice; `chapter` starts a chapter
at that line; `speed` (default 1) slows or quickens one line. Keep the video's work
(frames, audio, video) in a folder outside the repo.

- One line names one thing the viewer sees happen. If a line covers two actions
  ("paste your file, or link a sheet"), split it, or the picture runs ahead of the voice.
- 6–16 words. Plain words, concrete nouns, no marketing adjectives. A closing line says
  what to do next in plain words ("Try it on your own pages"), not a stock call to action.
- Check names and acronyms: Kokoro runs letters together ("TQQQ" → "tikyukyukyu") and can
  stress a name wrongly. Fix it in `speak` with spaced letters ("T Q Q Q") or a phoneme
  override (`[Kokoro](/kˈOkəɹO/)`); `playbook.md` shows how to check pronunciation.

Then `node <skill>/voice.cjs <dir>`. It fails loudly if a clip's length doesn't fit its
words; check that clip (its word timings show whether anything is missing) before going on.

## 4. Write the tour, one segment per line

Copy `templates/tour.cjs`. Each `t.segment(id, run)` is one narration line; the segment
lasts until its line has been spoken, counted from the `t.say()` or `t.speak()` that starts it.

The rules that make it watchable (each came from a review):

- **The voice starts with the video.** `intro({ voiceFirst: true, typeAtWord, zoomAtWord })`
  types the address under the first line instead of in silence.
- **Actions land on their words.** `await t.untilWord(id, 'Save')` before the click; the
  word times are Kokoro's own.
- **Callouts never cover what the cursor uses.** Pass those selectors as `avoid`.
- **Show a screen before acting on it.** A library or list gets a second or two of a
  glide over its items before the click.
- **Cut waits, don't film them.** Loading goes in `t.offCamera()`, long typing in
  `t.fastForward()`; both sit between spoken lines, never inside one.
- **Native `<select>` popups and context menus never show in screenshots**: use
  `t.pickOption()` and `t.contextMenu()`.
- **A mocked third-party screen** (an AI chat) is labelled generically and is not made
  to look like a real company's product.
- **No click sounds.** The build has none; don't add them.
- **State the app starts in is checked, not assumed.** Before a toggle, assert it is in
  the state the line describes; after an action the line reports, assert it happened.

## 5. Dry run, then record

```bash
NODE_PATH="$(npm root -g)" node tour.cjs <dir> dry     # a still per segment in <dir>/dry/
NODE_PATH="$(npm root -g)" node tour.cjs <dir> rec     # frames + timeline.json
node <skill>/build.cjs <dir>
node <skill>/verify.cjs <dir>
```

Look at every dry still before recording: callout placement, spotlight fit, the camera's
framing, the right state on screen. `STOP_AFTER=<id>` ends a take early to check one part.
A take records at half speed (about 2.5x the video's length in real time) and writes about
13 MB of PNG frames per second of video. The kit refuses to write into a full `frames/`,
so move the old one aside (`mv frames frames-take1`) before the next take.

## 6. Check before handing it over

`verify.cjs` must show every gap at 0.25 s or more and no unexplained long silence. Open
`contact-sheet.png` and look at it, and pull single frames at the moments each effect
should land. Then give the user the file, its length and size, and ask them to listen:
you cannot hear it, so pronunciation and pacing are theirs to judge. Name any rough spot.

When the user asks for a change: a script change means `voice.cjs` (it re-voices only
changed lines), then a new take; a visual change needs only a new take and build.

## 7. Outputs

`build.cjs` writes `video.mp4` (H.264, crf 28, 2.5–4 MB a minute) with chapters inside,
and beside it `captions.vtt`, `chapters.vtt` and `youtube-chapters.txt` (when lines have
chapters), `transcript.md`, `poster.jpg` and `embed.html`. Options, by environment variable:
`CAPTIONS=off`, `FRAME=1`, `MOTION_BLUR=1`, `MUSIC=<file>` (its licence is the user's to
check), `TITLE`, `BASE_URL` (adds `video.jsonld`), `AV1=1` (17% smaller, ~10 minutes of
encoding: offer it, don't default to it). Offer the outputs that fit where the video will play.

- **Docs**: `guide.cjs` turns the dry run into `guide.md` and `walkthrough.html` for readers
  who would rather click or read than watch.
- **Re-shooting after a UI change**: keep `tour.cjs` and `narration.json` where the team
  can find them (the project's repo if the team wants that; frames, audio and video stay
  out). Approve a dry run's stills with `diff-stills.cjs <dir> --approve`; after the UI
  changes, a new dry run and `diff-stills.cjs <dir>` list the segments to fix.
