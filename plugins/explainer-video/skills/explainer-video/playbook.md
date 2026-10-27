# Explainer video playbook

The calls a tour script has, recipes for each, the numbers to plan with, and the traps
behind each rule in SKILL.md. `t` is the object `record()` passes to `tour`. SKILL.md
section 2 says when each effect helps; this file says how.

## The tour API

**Lines and timing**

| Call | Does |
|---|---|
| `t.segment(id, run)` | one narration line; lasts until that line has been spoken |
| `t.say(id, label, anchor, side, pad, avoid)` | shows the callout and starts the line's audio |
| `t.speak(id)` | starts the line's audio with no callout (over a card, or where ink points) |
| `t.retip(...)` / `t.sayNext(...)` | moves the callout (same line) / fades it and starts the next line |
| `t.untilWord(id, word)` | waits for the moment `word` is spoken (Kokoro's own word times) |
| `t.offCamera(run)` | the stretch inside is cut from the video |
| `t.fastForward(run, { factor })` | the stretch inside plays `factor` times faster, with an `N×` badge |
| `t.pause(ms)` / `t.sleep(ms)` | a pause in video time / in real time |

**Cursor and input**

| Call | Does |
|---|---|
| `t.glide(x, y, ms)` / `t.glideTo(sel, ms, dx, dy)` | moves the cursor, in video milliseconds; long moves bow slightly |
| `t.click()` / `t.clickOn(sel, ms)` | real mouse input; the cursor presses down |
| `t.typeInto(sel, text)` / `t.paste(sel, text)` | typing, or a ⌘V paste with a keycap |
| `t.press('Meta+K')` | a shortcut, its keys shown next to the cursor (⌘ K) |
| `t.pickOption(select, value)` | a native `<select>` through the overlay menu |
| `t.contextMenu(items, pick)` | a context menu drawn at the cursor; the tour then does what the row would |
| `t.drag(dx, dy, ms)` / `t.dragTo(from, to, { ms })` | drags, with a closed hand while held |
| `t.selectText(sel)` | selects an element's text with an I-beam |
| `t.scrub(sel, { ms, from, to })` | runs the cursor along an SVG line or path (or across a box), so hover readouts follow |
| `t.wheelTo(container, target)` | wheels a scrolling panel until `target` is near its top |
| `t.ghost({ name, color, at })` | another person's cursor: `.glideTo(sel, ms)`, `.tap()`, `.remove()` |
| `t.keycap(text \| null)` | a key label next to the cursor |
| `t.settle(sel)` | waits for an element to stop moving |

**Marks on the page** (they move with the camera)

| Call | Does |
|---|---|
| `t.spot(sel, pad)` / `t.spotOff()` | spotlight ring; it follows its target as it moves or grows |
| `t.focus(sel, pad)` / `t.focusOff()` | blurs and greys everything but the target |
| `t.ink(kind, sel, { pad, ms })` | drawn on: `circle`, `underline`, `box`, `marker`, `strike` |
| `t.arrow(from, to)` / `t.note(sel, text, { dx, dy })` | an arrow between two parts / a note with an arrow to the part |
| `t.pulse(sel)` / `t.badge(sel, n)` | three rings spreading from a point / a numbered step marker |
| `t.inkOff()` | fades every mark drawn so far |
| `t.dim(sel, { except, opacity })` / `t.undim()` | fades matching elements except some (one chart series kept) |
| `t.before()` / `t.wipe({ ms, labels })` | freezes the page as a still / sweeps it away to show the live page |

**The camera**

| Call | Does |
|---|---|
| `t.camera.focus(sel, { zoom, pad, ms })` | frames `sel`, zoomed up to `zoom`, eased over `ms` |
| `t.camera.reset(ms)` | back to the whole page |
| `t.camera.follow({ zoom, lag })` | zoomed on the cursor, trailing it, until the next camera call |
| `t.camera.drift({ scale, ms })` | a slow push in on a held shot (`scale` 1.06 = 6% closer) |

**The screen layer** (stays put while the camera moves)

| Call | Does |
|---|---|
| `t.lowerThird({ title, subtitle })` / `t.lowerThirdOff()` | a name bar, bottom left |
| `t.stat({ label, value, prefix, suffix, decimals, at })` / `t.statOff()` | a number card counting up, in a corner (`at`) |
| `t.card({ kicker, title, subtitle, items, steps, logo })` / `t.cardOff()` | a full-screen card: title, preview list (`items`) or recap pictures (`steps`) |
| `t.snap(name)` | keeps a still of this moment for a recap card's `steps` |
| `t.flow(boxes, { title })` | a flowchart scene: boxes rising in, arrows drawn between them |
| `t.terminal({ title, lines })` | a terminal scene: `{ cmd }` lines typed, `{ out }` lines shown |
| `t.code({ code, lang, highlight, typeMs })` | a code scene, `highlight` lines (1-based) swept with colour |
| `t.scene({ html, css })` / `t.sceneOff()` | a full-screen scene of the tour's own HTML |

**Openings, AI chat, the app itself**

| Call | Does |
|---|---|
| `t.intro({ id, address, voiceFirst, typeAtWord, zoomAtWord, afterZoom })` | the browser-window opening |
| `t.chat.open / pastePrompt / send / waitWritten / copy / close` | the illustrative AI chat |
| `t.navigated()` | after a navigation: overlay back, slow motion re-applied |
| `t.page`, `t.context`, `t.cdp` | Playwright objects, for anything app-specific |

**`record()` options**: `callouts` (`'full'` or `'label'`), `pointer` (`'mouse'` or
`'touch'`), `locale` (`'es-ES'`), `viewport`, `scale`, `chapterChipMs` (0 hides the chip),
`prepare`, `ready`, `tour`.

Callout sides: `right left top bottom inside inside-right inside-bottom-left
inside-bottom-right center`. The `avoid` list wins over the side asked for: if the
callout would cover one of those elements, the first side that covers none is used.

## Planning numbers

- Kokoro `af_heart` speaks about **3.2 words a second** over a script; one line runs from
  2.3 (numbers, which it reads out in full) to 4.1 words a second (short plain words).
- Each segment adds about 0.3 s after its line, plus any action that outlasts it.
- Two minutes held 26 lines and 300 words, with ~5 s of loading cut out.
- Cursor glides of 500–900 ms read as deliberate; under 400 ms looks like a jump.
- A camera move of 800–1000 ms reads as calm; a punch-in for emphasis is under 500 ms.
- A take records at half speed: a 2-minute video takes about 5 minutes, plus 1–3
  minutes to build. Its frames take about 1.5 GB.
- `video.mp4` at crf 28: 2.5–4 MB a minute of busy UI.
- An intro with `voiceFirst` spends about 2.4 s from its typing word to the loaded page;
  put the zoom word at least that far after the typing word.

## Recipes

**A click on the word that names it**

```js
await t.say('save', 'Save', ['form'], 'right', 6, ['button[type=submit]']);
await t.glideTo('button[type=submit]', 600);
await t.untilWord('save', 'Save');
await t.click();
```

**Two actions in one line.** Split the line in `narration.json` instead. If it must
stay one line, put an `untilWord` before each action.

**Let a screen be seen first.** After opening a list or gallery, glide across two or
three items (`t.glideTo(card, 900, -120, 40)`) before clicking the one you need, and
time the click with `untilWord`.

**The opening.** `t.intro()` must be the first segment. With `voiceFirst` the first line
plays from the start, the address is typed on `typeAtWord` and the page zooms in on
`zoomAtWord`; `afterZoom` runs once the page is full screen (start the app's count-up
there, without awaiting it, so the next line is not held back).

**Chapters, a preview and a recap.** Put `"chapter": "Export"` on the first line of each
section; a chip shows `2 / 4 · Export` as it starts, and the build writes the chapters.
For a tutorial, open with `t.card({ kicker: 'In this video', title, items: [...] })`,
take `t.snap('export')` at the end of each step, and close with
`t.card({ title: 'Recap', steps: [{ snap: 'export', label: 'Export' }, ...] })`.

**Zoom on a number, mark it on its word.**

```js
await t.speak('revenue');
await t.untilWord('revenue', 'up');
const zoom = t.camera.focus(['#kpi-revenue'], { zoom: 2.4, pad: 40, ms: 800 });
await t.untilWord('revenue', 'twelve');
await t.ink('circle', ['#rev-delta'], { pad: 9, ms: 650 });
await zoom;
```

**A pull-back.** Start zoomed with `t.camera.focus(sel, { ms: 0 })` before the line, then
`t.camera.reset(1200)` on the word that widens the view.

**Before and after.** Freeze, change the app out of sight, reveal:

```js
await t.before();
await t.offCamera(async () => { await applyTheSetting(t.page); await t.page.waitForSelector('.applied'); });
await t.speak('compare');
await t.wipe({ ms: 1100 });
```

**A chart.** `t.dim(['#chart circle'], { except: ['#peak'] })` keeps one point,
`t.scrub('#trend-line', { ms: 1600 })` runs the cursor along the line so the app's own
tooltip follows, and `t.note(['#peak'], 'Spring sale', { dx: -230, dy: -40 })` with
`t.pulse(['#peak'])` names one value.

**Native selects and context menus.** `await t.pickOption('#status', 'published')`. The
overlay draws the option list, the cursor picks a row, then the real value is set. Do not
press Escape afterwards: many apps close the surrounding modal on Escape.
`t.contextMenu(['Copy', 'Rename'], 1)` draws a context menu at the cursor; then do what
the row does (the app's handler through `t.page.evaluate`, or its menu item if it has one).

**Loading you don't want to show.**

```js
await t.clickOn('#generate', 500);
await t.offCamera(() => t.page.waitForSelector('.result'));   // cut from the video
await t.say('result', 'Result', ['.result'], 'right');         // the line starts after the cut
```

The build throws if a cut falls inside a spoken line: start the line after the cut. A
fast-forward follows the same rule; use it for something the viewer should see happen
(typing a long entry), and a cut for a wait.

**A drag on a chart or a divider.**

```js
await t.glideTo('#chart', 450, -100, 0);
await t.untilWord('drag', 'Drag');
await t.drag(240, 0, 1100);
```

`t.dragTo(from, to)` is for items the app makes draggable (a card onto a column, a file
onto a drop zone); on anything else the browser selects the text it passes over.

**Widening or scrolling a side panel.** `t.drag` on its resizer, then `t.settle` on the
panel before spotting it; `t.wheelTo(panelBody, sectionHeading)` to scroll inside it.

**Shared editing.** A ghost's actions are the tour's to perform: the main cursor is the
only real mouse.

```js
const ana = await t.ghost({ name: 'Ana', color: '#12805c', at: [1000, 140] });
await ana.glideTo('#title', 900);
await ana.tap();
await t.page.evaluate(() => window.app.applyRemoteEdit());   // what Ana's tap does
await ana.remove();
```

**A concept with no UI.** `t.flow(['Pick a region', 'Data loads', 'Chart redraws'], { title })`,
`t.terminal({ lines: [{ cmd: 'npm i' }, { out: 'added 12 packages' }] })` or
`t.code({ code, lang: 'config.js', highlight: [3] })`, each followed by `t.sceneOff()`.
`t.scene({ html, css })` takes anything else. `t.ink` marks a scene's elements too (a
circle round one flowchart box: `t.ink('circle', ['#demo-flow-2'])`).

**Copy to an AI and paste back.** For an app that hands a prompt to an AI chat.
`prompt` is whatever the app copied; the reply is text you wrote and verified beforehand.

```js
await t.clickOn('#copy-prompt', 500);                     // the app copies its prompt
await t.chat.open();
const prompt = await t.chat.pastePrompt();
await t.chat.send(prompt, REPLY, { ms: 3000, note: 'Here is your template:', lang: 'html' });
await t.chat.waitWritten();
await t.chat.copy(REPLY);
await t.chat.close();
await t.clickOn('#code', 600);
await t.paste('#code', REPLY);
```

**A closing card.** `t.card({ title, subtitle: 'example.com', logo })`, then `t.speak()`
the last line over it. The cursor hides while a card or scene is up.

**A phone-sized take.** `record({ viewport: { width: 390, height: 844 }, scale: 3,
pointer: 'touch' })` films 1170x2532 with a touch circle in place of the cursor; the
build sizes the captions for portrait.

**A translated take.** Translate `narration.json`, voice it with the language's own
Kokoro voice (`EXPLAINER_VOICE=ef_dora` for Spanish; the user chooses it), and record with
`record({ locale: 'es-ES' })` so the app and number formats follow. Word timings exist for
English only: other languages' cues fall back to the word's share of the line, and their
captions show without word highlighting. Japanese and Mandarin also need misaki's extras.

**Leaving the page.** To film another page, set the link to open in the same tab
(`a.target = '_self'`) so the one capture keeps going, click it, wait for the page, then
`await t.navigated()`.

**Settings the app reads at load** (a default panel width, a toggle's saved state) go in
`prepare` as `context.addInitScript(() => localStorage.setItem(...))`.

**Docs and hosts.** `embed.html` is a working page: the video with its caption and chapter
tracks, and a transcript whose times play from that line. `TITLE` names it; `BASE_URL`
(the page the video will sit on) adds `video.jsonld` for search key moments. YouTube shows
chapters only with three or more, each 10 s or longer, the first at 0:00; `verify.cjs`
checks. `node <skill>/guide.cjs <dir>` after a dry run writes `guide.md` and `walkthrough.html`.

**Re-shooting after a UI change.** `node <skill>/diff-stills.cjs <dir> --approve` once the
video is accepted; after the app changes, a new dry run and `node <skill>/diff-stills.cjs <dir>`
list the segments whose stills changed. Fix those segments' selectors and lines, re-voice
(only changed lines are voiced again), and record.

## Checking pronunciation without listening

Kokoro's text processor shows what it will say. A run-together word is one token with a
single stress mark; spaced letters each get one:

```bash
P=~/.cache/explainer-video/venv/bin/python
$P -c "
import misaki.espeak
from phonemizer.backend.espeak.wrapper import EspeakWrapper
EspeakWrapper.set_data_path('$HOME/.cache/explainer-video/espeak-ng-data')
from misaki import en
g2p = en.G2P(trf=False, british=False, fallback=misaki.espeak.EspeakFallback(british=False))
for t in ['every TQQQ day', 'every T Q Q Q day', 'The voice is Kokoro']: print(t, '->', g2p(t)[0])"
```

`every TQQQ day -> ˈɛvəɹi tˌikjˌukjˌukjˈu dˈA` (mushed) against
`every T Q Q Q day -> ˈɛvəɹi tˈi kjˈu kjˈu kjˈu dˈA` (four letters). A name stressed wrongly
(`Kokoro -> kəkˈɔɹO`) takes a phoneme override in `speak`: `[Kokoro](/kˈOkəɹO/)`.

## Traps, and why the kit does what it does

| Symptom | Cause | What the kit does |
|---|---|---|
| Video stuck at 1280x720 | Chrome's screencast delivers frames at the CSS viewport size, whatever the device scale | captures with `Page.captureScreenshot` at `clip.scale` 1.5 |
| Capture only ~15 fps on a busy app | each 1080p screenshot costs real render time | records at half speed and slows page CSS animations by the same factor (`Animation.setPlaybackRate`), then build plays it back at full speed |
| D3 transitions and count-ups twice too fast in the video | `setPlaybackRate` slows CSS and the document timeline, not `performance.now`, `Date.now` or timers | an init script runs those at half speed too |
| A JS animation stuck at its start for seconds | Chrome's `requestAnimationFrame` timestamp follows the slowed document timeline, so it lags `performance.now` more every second | frame callbacks get the slowed `performance.now` instead |
| Canvas charts soft after the first frame | the clip capture drops `devicePixelRatio` to 1, and a canvas redrawn after that has a 1x backing store | `devicePixelRatio` pinned to the capture scale |
| An action lands up to 0.9 s off its word | the word's place in the text is not its place in time (numbers are read out in full, commas pause) | Kokoro's own word timings, kept by `voice.cjs` |
| Overlay restyled (a chat bubble squashed to 32 px) | the app's CSS for a common class (`.user`) reached the overlay | the overlay lives in a shadow root |
| A zoomed frame 1–3 px short | Chrome snaps the clip to whole pixels | the build scales every frame to the full size (`-reinit_filter 0`) |
| Blank frames once the page scrolls | the screenshot clip is in page coordinates, so a clip at 0,0 stays above the scrolled viewport | every capture adds the window's scroll offset to its clip |
| A click does nothing | an invisible element (a toast at opacity 0) sits on top of the target | assert the result of every click the line reports; check `document.elementFromPoint` |
| Everything magnified 1.5x after a screenshot | Playwright's `page.screenshot` re-sets the device emulation, and the frame loop inherits it | the intro and before/after pictures use Chrome's own capture |
| The intro's page shows as a 2x2 grid of small copies, sometimes | a clip capture briefly overrides the page's scale; the frame loop and the intro's picture interleaved | every capture goes through one queue |
| A frame without the overlay | the overlay is hidden while the page's own picture is taken | the frame loop holds still meanwhile |
| Four silent seconds at the start | the address was typed before the first line | `intro({ voiceFirst: true })` |
| `build.cjs` cannot open a frame | a failed take left the previous take's `timeline.json` | the build names the missing frame; record again |
| `zoom: 1.5` on the page | breaks Chart.js-style canvases, which measure in one coordinate space and draw in another | not used; the camera zooms through the capture instead |
| Segments run long, video stretched | waiting out a line's remaining time with the slowed `pause` doubles it | the end-of-line wait uses real-time `sleep` |
| Share line talks over the previous one | a line that starts partway into its segment was timed from the segment's start | each segment lasts from its `say()` to the line's end |
| Big web files | JPEG frame noise is costly to re-encode | PNG frames; H.264 crf 28 with `-tune stillimage` |
| A dropdown "changes by itself" | native `<select>` popups are never in screenshots | `pickOption` draws one |
| A modal closed mid-take | Escape after a pick closed it | `pickOption` never presses Escape |
| Callout over the button being clicked | placement ignored the cursor's target | `avoid` selectors |
| Spotlight smaller than the box it rings | the box grew (pasted content, a preview table) after it was measured | the ring follows its target every frame |
| The page selects text during a drag | the dragged element is not draggable | use `dragTo` for draggable items only |
| Captions on a striped box | libass draws the box per glyph; a see-through colour shows the overlaps | an opaque box |
| The intro's page shows a stray tooltip | the mouse sat over a chart when the picture was taken | the mouse moves to the top edge first |
| `voice.cjs` stops: "looks wrong" on a line of short words | under 0.2 s a word reads as merged lines | check the line's word timings for missing words; rephrase with longer words |
| Voice fails with "Error importing numpy" | an Intel Node (Rosetta) started the Python as Intel | `voice.cjs` runs it with `arch -arm64` |
| Kokoro exits silently, "phontab: No such file" | espeak-ng truncates long data paths | the voice scripts point espeak at a short copy |
| Kokoro "Can't find model en_core_web_sm" | spaCy's model is on GitHub, not PyPI, and spaCy's own downloader needs pip | `setup.sh` installs the wheel |
| `uv pip install mlx-audio` resolves old or Intel builds | a uv built for Intel resolves Intel wheels; the default macOS target is older than the mlx wheels | `--python-platform aarch64-apple-darwin` and `MACOSX_DEPLOYMENT_TARGET` = this macOS |
| ffmpeg hangs | Homebrew's ffmpeg with a missing dylib | `setup.sh` tests with a timeout and falls back to ffmpeg-static |
| A cut audio clip is the wrong part | `-ss/-to` placed after `-i` apply to the output timeline, after filters like `atempo` | (if you cut audio yourself) put `-ss/-to` before `-i` |
| A toggle ends up off when the line says on | its default depended on the time of day (a market's hours) | set it in `prepare`, assert it before clicking |

## Looking at a take

`verify.cjs` writes `contact-sheet.png`, one frame every 4 seconds. For a closer look:

```bash
FF=$(cat ~/.cache/explainer-video/ffmpeg-path)
$FF -ss 12.5 -i video.mp4 -frames:v 1 at-12.5.png
```

`cues.json` lists when each line starts in the video; pull a frame where each effect
should land. To tile dry stills, pass `-reinit_filter 0` before the input: zoomed stills
differ by a few pixels, and a rebuilt filter graph drops a half-filled tile.

Check: the callout never sits on the control being used; the spotlight fits its target;
each screen shows the state its line describes; no frozen frame longer than a line pause;
the intro hands over to the live page without a jump; no screen-layer item (stat card,
lower third, chip) covers what the line is about.
