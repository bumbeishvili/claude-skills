# Explainer video playbook

Recipes for the tour script, the numbers to plan with, and the traps behind each rule
in SKILL.md. `t` is the object `record()` passes to `tour`.

## The tour API

| Call | Does |
|---|---|
| `t.segment(id, run)` | one narration line; lasts until that line has been spoken |
| `t.say(id, label, anchor, side, pad, avoid)` | shows the callout and starts the line's audio |
| `t.retip(...)` / `t.sayNext(...)` | moves the callout (same line) / fades it and starts the next line |
| `t.untilWord(id, word)` | waits for the moment `word` is spoken |
| `t.spot(selectors, pad)` / `t.spotOff()` | spotlight ring; it follows its target as it moves or grows |
| `t.glide(x, y, ms)` / `t.glideTo(sel, ms, dx, dy)` | moves the cursor, in video milliseconds |
| `t.click()` / `t.clickOn(sel, ms)` / `t.drag(dx, dy, ms)` | real mouse input to the app |
| `t.typeInto(sel, text)` / `t.paste(sel, text)` | typing, or a ⌘V paste with a keycap |
| `t.pickOption(select, value)` | a native `<select>` through the overlay menu |
| `t.wheelTo(container, target)` | wheels a scrolling panel until `target` is near its top |
| `t.settle(sel)` | waits for an element to stop moving |
| `t.offCamera(run)` | the stretch inside is cut from the video |
| `t.intro({ id, label, address, zoomAtWord, afterZoom })` | the browser-window opening |
| `t.chat.open / pastePrompt / send / waitWritten / copy / close` | the illustrative AI chat |
| `t.navigated()` | after a navigation: overlay back, slow motion re-applied |
| `t.keycap(text \| null)` | a key label next to the cursor (⌘ + scroll, Enter) |
| `t.pause(ms)` | a pause in video time; `t.sleep(ms)` is real time |
| `t.page`, `t.context`, `t.cdp` | Playwright objects, for anything app-specific |

Callout sides: `right left top bottom inside inside-right inside-bottom-left
inside-bottom-right center`. The `avoid` list wins over the side asked for: if the
callout would cover one of those elements, the first side that covers none is used.

## Planning numbers

- Kokoro `af_heart` speaks about **3.3 words a second**. A 9-word line is about 2.7 s.
- Each segment adds about 0.3 s after its line, plus any action that outlasts it.
- Two minutes held 26 lines and 300 words, with ~5 s of loading cut out.
- Cursor glides of 500–900 ms read as deliberate; under 400 ms looks like a jump.
- A take records at half speed: a 2-minute video takes about 5 minutes, plus 1–3
  minutes to build. Its frames take about 1.5 GB.
- `video.mp4` at crf 28: about 8 MB for 2 minutes of busy UI.

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

**Native selects.** `await t.pickOption('#status', 'published')`. The overlay draws the
option list, the cursor picks a row, then the real value is set. Do not press Escape
afterwards: many apps close the surrounding modal on Escape.

**Loading you don't want to show.**

```js
await t.clickOn('#generate', 500);
await t.offCamera(() => t.page.waitForSelector('.result'));   // cut from the video
await t.say('result', 'Result', ['.result'], 'right');         // the line starts after the cut
```

The build throws if a cut falls inside a spoken line: start the line after the cut.

**A drag on a chart or a divider.**

```js
await t.glideTo('#chart', 450, -100, 0);
await t.untilWord('drag', 'Drag');
await t.drag(240, 0, 1100);
```

**Widening or scrolling a side panel.** `t.drag` on its resizer, then `t.settle` on the
panel before spotting it; `t.wheelTo(panelBody, sectionHeading)` to scroll inside it.

**Copy to an AI and paste back.** For an app that hands a prompt to an AI chat.
`prompt` is whatever the app copied; the reply is code you wrote and verified beforehand.

```js
await t.clickOn('#copy-prompt', 500);                     // the app copies its prompt
await t.untilWord('prompt', 'paste');
await t.chat.open();
const prompt = await t.chat.pastePrompt();
await t.chat.send(prompt, REPLY_CODE, { ms: 3000, note: 'Here is your template:', lang: 'html' });
await t.chat.waitWritten();
await t.chat.copy(REPLY_CODE);
await t.chat.close();
await t.clickOn('#code', 600);
await t.paste('#code', REPLY_CODE);
```

**The opening.** `t.intro()` must be the first segment. The line should name the
product in its first words and have a later word to zoom on:
`"This portal manages your site's pages. Every change goes live in one place."` with
`zoomAtWord: 'Every'`. `afterZoom` re-places the callout on the real page.

**A closing card.** Give the last line a `card` (`"card": "example.com"`) and say it
with side `center`: the screen shows the card, the voice says the line.

**Leaving the page.** To film another page, set the link to open in the same tab
(`a.target = '_self'`) so the one capture keeps going, click it, wait for the page, then
`await t.navigated()`.

**Settings the app reads at load** (a default panel width, a toggle's saved state) go in
`prepare` as `context.addInitScript(() => localStorage.setItem(...))`.

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
for t in ['every TQQQ day', 'every T Q Q Q day', 'any AI chat']: print(t, '->', g2p(t)[0])"
```

`every TQQQ day -> ˈɛvəɹi tˌikjˌukjˌukjˈu dˈA` (mushed) against
`every T Q Q Q day -> ˈɛvəɹi tˈi kjˈu kjˈu kjˈu dˈA` (four letters).

## Traps, and why the kit does what it does

| Symptom | Cause | What the kit does |
|---|---|---|
| Video stuck at 1280x720 | Chrome's screencast delivers frames at the CSS viewport size, whatever the device scale | captures with `Page.captureScreenshot` at `clip.scale` 1.5 |
| Capture only ~15 fps on a busy app | each 1080p screenshot costs real render time | records at half speed and slows page CSS animations by the same factor (`Animation.setPlaybackRate`), then build plays it back at full speed |
| Everything magnified 1.5x after a screenshot | Playwright's `page.screenshot` re-sets the device emulation, and the frame loop inherits it | the intro takes its picture with Chrome's own capture |
| The intro's page shows as a 2x2 grid of small copies, sometimes | a clip capture briefly overrides the page's scale; the frame loop and the intro's picture interleaved | every capture goes through one queue |
| `build.cjs` cannot open a frame | a failed take left the previous take's `timeline.json` | the build names the missing frame; record again |
| `zoom: 1.5` on the page | breaks Chart.js-style canvases, which measure in one coordinate space and draw in another | not used |
| Segments run long, video stretched | waiting out a line's remaining time with the slowed `pause` doubles it | the end-of-line wait uses real-time `sleep` |
| Share line talks over the previous one | a line that starts partway into its segment was timed from the segment's start | each segment lasts from its `say()` to the line's end |
| Big web files | JPEG frame noise is costly to re-encode | PNG frames; H.264 crf 28 with `-tune stillimage` |
| A dropdown "changes by itself" | native `<select>` popups are never in screenshots | `pickOption` draws one |
| A modal closed mid-take | Escape after a pick closed it | `pickOption` never presses Escape |
| Callout over the button being clicked | placement ignored the cursor's target | `avoid` selectors |
| Spotlight smaller than the box it rings | the box grew (pasted content, a preview table) after it was measured | the ring follows its target every frame |
| The intro's page shows a stray tooltip | the mouse sat over a chart when the picture was taken | the mouse moves to the top edge first |
| A clip count off by one | an earlier, longer run left clips in the same folder | `voice.cjs` writes each run to a fresh folder |
| Kokoro exits silently, "phontab: No such file" | espeak-ng truncates long data paths | `kokoro_run.py` points espeak at a short copy |
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

Check: the callout never sits on the control being used; the spotlight fits its
target; each screen shows the state its line describes; no frozen frame longer than a
line pause; the intro hands over to the live page without a jump.
