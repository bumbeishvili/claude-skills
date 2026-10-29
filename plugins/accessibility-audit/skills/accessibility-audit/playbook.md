# Accessibility audit playbook

Reference for SKILL.md: every config key, what each layer measures and how, how to read and verify the report, the
headed and screen-reader protocols, regression tests, before/after evidence, what review teams ask for, and the traps
behind the checks.

## 0. Setup

`setup.sh` installs the npm packages pinned in `package.json` into the workspace `A11Y_AUDIT_HOME` (default
`~/.cache/accessibility-audit`, about 120 MB) and Playwright's Chromium, Firefox and WebKit into Playwright's shared
cache (about 1.2 GB for this Playwright version). Scripts load packages from the workspace through `lib/deps.cjs`, so
the project under test gets no new dependencies. Re-running `setup.sh` skips finished steps; `--check` reports only.

| Package | Used for |
|---|---|
| playwright | every browser run |
| axe-core, @axe-core/playwright | rule engine (`axe:` checks) |
| accessibility-checker-engine | IBM Equal Access rule engine (`ibm:` checks), injected into the page |
| @guidepup/virtual-screen-reader, esbuild | the virtual screen reader, bundled for the page on first use |
| @guidepup/guidepup | real VoiceOver automation (`voiceover.cjs`) |
| ffmpeg-static | narrated walkthrough videos (H.264, AAC, soft captions) |

Optional, reported by `--check`: `pdfinfo` (poppler) for linked PDFs, macOS `say` and `afinfo` for spoken and narrated
walks, VoiceOver automation (two `npx @guidepup/setup` commands that change VoiceOver settings and ask for
permissions, so the person runs them; §6).

## 1. Config reference

A CommonJS module (start from `templates/audit.config.example.cjs`). Paths in states, pages and flows are relative to
`baseUrl`.

| Key | Meaning |
|---|---|
| `name` | report title |
| `baseUrl` | required; the server under test |
| `viewports` | named viewports; `desktop` is used by default and by the per-page checks. A value is `{ width, height }` or Playwright context options with a `viewport` (`deviceScaleFactor`, `isMobile`, `hasTouch`) |
| `desktopViewport` | another viewport name for the per-page checks |
| `states` | required; `[{ id, path, viewport?, setup?, wait?, reducedMotion?, colorScheme?, measureFocus?, maxStops? }]` |
| `states[].setup(page, a11y)` | reaches the state; `a11y` has `tabTo(pattern, { max, reverse })` (returns the Tab presses taken), `press(key)`, `focused()`, `announcements()` |
| `states[].wait` | ms to wait after `setup` (default 300) |
| `states[].reducedMotion`, `colorScheme` | `'reduce'`, `'dark'`: a state under that preference |
| `pages` | paths for the per-page and cross-page checks; default: the states' paths |
| `flows` | `[{ id, path, viewport?, steps: [{ label, run({ page, keyboard, a11y }), wait?, expect? }] }]` |
| `flows[].steps[].expect` | `focus` (text or RegExp matched against the focused element's snapshot line, `textbox "Email"`), `focusBody: true` (focus on body intended), `announce` (live-region text), `fieldError` (selector of a field that must be `aria-invalid` with a described error), `title` (document title) |
| `voFlows` | tasks for `voiceover.cjs --flows`: `[{ id, path, wait?, steps: [{ label, run(helpers), wait?, expect?, shot? }] }]`. `helpers` has `tabTo`, `readTo` and `headingTo` (`(pattern, { max })`, by Tab, VO-Right and VO-Command-H; default max 80), `press(key)`, `type(text)`, `act()`, `next()`, `perform(command)`, `commands` and `voiceOver` |
| `voFlows[].steps[].expect` | `spoken` and `notSpoken` (text or RegExp) matched against everything VoiceOver said during the step and in the `wait` after it (default 300 ms); `shot: true` saves a VoiceOver cursor screenshot |
| `voWait`, `states[].voWait`, `voFlows[].wait` | ms `voiceover.cjs` waits after loading a page (default 6000) |
| `voWindow` | `{ width, height }` of the Safari window `voiceover.cjs` opens, at the top left of the main display; without it the window keeps the size of the person's last Safari window |
| `block` | RegExp sources of requests to abort: feedback widgets, chat, analytics |
| `init` | function run in every page and frame before the app's scripts (dismiss tours, set consent) |
| `ready(page)` | resolves when the page can be measured; default waits for network idle up to 30 s |
| `exclude` | selectors axe leaves out: third-party embeds the team cannot change (frames still appear in the inventory) |
| `skip` | layers never run for this config |
| `out` | output folder; default `<cwd>/_raw/a11y` |
| `maxStops`, `measureFocus`, `transcriptMax`, `locale` | walk length (400), pixel focus measurement on or off, browse-transcript length (4000), browser locale (`en-US`) |

CLI: `node audit.cjs --config <file> [--states a,b] [--skip layer,...] [--only layer,...] [--out dir] [--browser chromium|firefox|webkit]`.
Layers: `engines, structure, contrast, keyboard, speech, hover, probes, visual, crosspage, documents, flows`.

## 2. What each layer measures

Every state gets a fresh browser context with the in-page recorder (`lib/inpage.cjs`) installed before the app's
scripts: it logs live-region announcements (politeness, and whether the region was created already holding the text),
focus moves, event listeners by type, `window.open` and history changes, and orientation locks. Nodes the audit draws
carry `data-a11y-tool` and are left out of everything.

| Layer | Method | Checks |
|---|---|---|
| engines | axe-core with tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice; IBM Equal Access with its WCAG 2.2 policy; Chrome's Issues panel (Chromium) | `axe:*` (violations fail; "needs review" becomes review, except colour contrast, measured by the contrast layer, and popup `aria-controls`, checked against the page), `ibm:*` (violations fail; "potential" results review, except those a measurement here replaces: `IBM_POTENTIAL_REPLACED` in `lib/engines.cjs`), `chrome:*` (form label and autocomplete errors) |
| structure | one pass over the DOM | heading skips and extra h1, text styled as a heading, generic and ambiguous link text, new windows not announced, characters drawn as lists, sensory instructions, tables without headers, graphics with no text alternative, file-name alt text, placeholder-only labels, missing `autocomplete` on personal fields, radio and checkbox groups without a label, CSS order against source order, open dialogs without `aria-modal`, media (autoplay with sound, captions, transcripts, third-party players); plus the inventory a person reads: title, lang, heading outline, landmarks, images with alt, media, frames, language changes, linked documents |
| contrast | each element captured as drawn and with its text (or icon) transparent; glyph pixels compared with the pixels behind them | `px:text-contrast` for axe's undecided nodes (gradients, images), `px:svg-text-contrast` (axe skips SVG text; three samples per style), `px:icon-contrast` (icon-only controls and lone symbols such as ✕), `vis:control-border-contrast` (field border or fill against the page, or the wrapper that draws the box). Elements under an overlay are left to the state where nothing covers them |
| keyboard | real Tab presses from where a user starts; at each stop the accessibility snapshot, the virtual screen reader's words, cover at nine points, on-screen position; the focus indicator measured by capturing the control focused and unfocused and comparing pixels (3:1 change over at least half a 1 px outline of the long side) | `kbd:focus-not-visible`, `kbd:focus-low-contrast` (with a screenshot), `kbd:focus-obscured`, `kbd:focus-partly-obscured`, `kbd:focus-offscreen`, `kbd:trap`, `kbd:focus-loop`, `kbd:focus-lost`, `kbd:modal-escape`, `kbd:unreachable` (visible focusable controls Tab never reached), `kbd:no-role`, `kbd:no-name`, `kbd:positive-tabindex`, `kbd:order-jump` (against the layout, inside scroll containers too), `kbd:reverse-mismatch` (Shift+Tab does not retrace), `kbd:context-change-on-focus`, `kbd:target-size` (2.5.8 with the spacing, inline and native-control exceptions), `kbd:pointer-only`; and the focus-order map (`maps/<state>.jpg`) |
| speech | the virtual screen reader reads the page top to bottom in browse mode | `sr:unnamed`, `sr:repetitive` (alt repeated as the next text), `sr:reading-order-jump`; transcripts `transcripts/<state>.txt` (browse) and `<state>-tab.txt` (what each Tab stop says) |
| hover | the pointer rests on each element with hover listeners, a description, a popup or a tooltip attribute; any popup that appears is tested | `hover:not-dismissible` (Escape), `hover:not-hoverable` (pointer moved onto it), `hover:not-persistent` (2 s), `hover:hover-only` (not shown on focus, or on Enter for menu and disclosure buttons) |
| probes | key and pointer presses after the walk; the effect is read from focus and ARIA state, or from DOM changes that a second run confirms after a quiet window | `kbd:skip-link` (Enter on the first stop's same-page link moves focus to its target, or the next Tab lands there), `kbd:no-skip-link` (six or more stops before main, best practice), `kbd:single-key-shortcut`, `kbd:down-event-activation`, `kbd:context-change-on-input` (select change navigates), `kbd:composite-unreachable` and `kbd:composite-no-arrows` (arrow keys in tab lists, menus, menu bars, list boxes, radio groups, trees, grids, comboboxes), `kbd:roving-unreachable` (tabindex="-1" controls arrow keys do not reach), `kbd:custom-control-keys` (Enter and Space on controls built from divs and spans; the click they produce is cancelled at the window so no action runs), `kbd:popup-focus` and `kbd:popup-escape` (buttons with `aria-expanded` or `aria-haspopup`) |
| visual | per page, each in its own context | `vis:text-spacing-clip` (WCAG 1.4.12 spacing, against the page's own desktop clipping), `vis:zoom-overflow` and `vis:zoom-clip` (200%: half the desktop window at scale 2), `vis:reflow-overflow` (320 CSS px; data tables, code, media, maps and `[data-a11y-reflow-exempt]` may scroll in their own box), `vis:sticky-cover` (fixed and sticky bars over 40% of a 320×256 or 640×360 window), `vis:orientation-lock`, `motion:ignores-reduced-motion`, `motion:smooth-scroll`, `motion:auto-moving` (a 6.5 s watch: elements changing in three separate seconds, playing media, looping animations) |
| crosspage | links in banner, footer and each navigation, titles, help links, search, site map, breadcrumbs per page | `xpage:nav-inconsistent`, `xpage:inconsistent-identification`, `xpage:help-inconsistent`, `xpage:duplicate-title`, `xpage:multiple-ways` |
| documents | each linked PDF downloaded and read with `pdfinfo` and its own objects | `doc:pdf-untagged`, `doc:pdf-no-title`, `doc:pdf-no-lang`, `doc:pdf-structure-errors`; figures against alt texts in the report; Office files listed for checking in their application |
| flows | the config's tasks, step by step | `flow:focus-lost`, `flow:focus-unexpected`, `flow:announce-missing`, `flow:live-region-created`, `flow:error-not-associated`, `flow:title-unexpected`; each flow's transcript (focus, announcements, title per step) in the report |

The full list with criteria, default severity and outcome is `lib/checks.cjs`.

## 3. Reading the report

`summary.md`, in order:

- **Header**: states and pages checked, failures by severity, tool versions.
- **States that did not run**: a state whose `setup` or `ready` threw. Fix the config and re-run that state.
- **Failures**: definite failures against A or AA, most severe first. One row per element: what several engines and
  checks said about it is merged, with every state it appears in and links to screenshots.
- **To review**: heuristics and partial results. Each needs a person to confirm or dismiss it, with a reason.
- **Best practice**: beyond A and AA; review teams raise many of these anyway.
- **WCAG 2.2 conformance worksheet**: every A and AA criterion with its status from this run and its manual step.
- **States**: Tab stops, reached against focusable, how the walk ended, the focus map and transcript.
  Walk endings: "came round to the first stop" and "came round to a walked stop" (complete: Tab passed the end of the
  page and returned), "cycled back to the first stop" (complete: the page itself moved focus from its last control to
  its first, as a focus trap does), "cycled inside the modal dialog" (expected with a dialog open), "no focusable
  content", "loop" and "trapped at the last control" (a `kbd:focus-loop` or `kbd:trap` row explains it), "focus left
  the page and did not come back", "stop limit reached" (raise `maxStops`). Unreached controls are reported only
  after a complete walk.
- **Flows**, **Linked documents**, **For a person to read** (inventories).

`findings.json` holds `rows` (merged), `matrix` (worksheet), `flows` and `raw` (every finding with its evidence);
`states/<id>.json` holds each state's walk, stops and timings.

## 4. Verifying a finding, and the traps

Open the evidence first: `shots/<state>-stop<n>-focus.png` for focus rows, `maps/<state>.jpg` for order, the
transcripts for speech, `aria/<state>.yml` for names and roles, `shots/page-*` for zoom, reflow and spacing. Then look
at the element in the running page. A row the evidence does not support is a measurement defect: reproduce it with
`--states <id>`, find the cause in the check, add the case to `fixtures/` (a planted failure with `data-expect` in
`known-failures.html`, the correct version in `known-good.html`), and run `node selftest.cjs` until it passes.

Traps found while building the checks, with what the audit does about each:

| Symptom | Cause | What the audit does |
|---|---|---|
| Names and handlers missing on a single-page app | measured before hydration | `ready` waits for the app's own content, not only `load` |
| Focus reported off screen | `scroll-behavior: smooth` still scrolling when measured | `settle()` waits for finite animations (up to 400 ms) and for scrolling to stop |
| Dozens of "no role" rows | Playwright's aria snapshot is YAML: a name with `: ` is quoted, `- 'button "Menu: open"': Menu` | `parseSnapshotLine` unquotes |
| Positive tabindex missed | after any `focus()`, Tab starts from that node | the walk starts fresh when nothing has had focus, so the first Tab is a user's first Tab |
| axe crashes after a popup handler | the app's popups are closed, and axe opens a helper page of its own | only `page.on('popup')` windows are closed |
| Flow cannot find focus in an iframe | focus inside a frame leaves the `<iframe>` as the active element | `focused()` reports the frame by its title |
| Feedback widget stops and violations | third-party script loaded on dev hosts | `block` it; audit it separately if the team ships it |
| Carousel cards "out of order" | positions read after the carousel scrolled between stops | order compares positions with every scroll container scrolled back |
| Skip link "out of order", reverse walk diverges at the body | Tab wraps from the last control through `<body>` to the first | the wrap is recorded, and the order check and reverse walk expect it |
| Reverse walk diverges in a menu state | the menu closed when focus left it | the reverse walk leaves out stops that are no longer tabbable |
| Text under an open menu fails contrast | measured through the menu's backdrop tint | contrast skips elements another element paints over (hiding it changes at least 5% of the pixels) |
| Focus ring counted on the wrong control | Shift+Tab put focus on a neighbour whose ring overlaps | the measurement steps back until the neighbour does not overlap, and masks it |
| A ring in computed style, nothing on screen | `outline` clipped by a parent's `overflow: hidden` | the indicator is judged by pixels only |
| A key or press "did something" on a busy page | carousels and tickers mutate all the time; input-modality scripts write attributes on `<html>` | a quiet window before each probe, two runs that must agree, html and body attribute writes ignored |
| IBM repeats a reminder on every element | "potential" results for things this audit measures | those rules' potentials are replaced; their violations stay |
| `timeout: command not found` | macOS has no GNU `timeout` | give long runs the tool's own timeout or run them in the background |
| ffmpeg hangs | a Homebrew ffmpeg built against a missing library | `ffmpeg-static` from the workspace, and `setup.sh` polls it with a deadline |
| WebKit never launches | Playwright 1.64's WebKit on macOS 14 hung at launch on the machine these were built on | run `--browser webkit` on one state first; use Chromium and Firefox when it hangs |
| `createRequire` error | a relative `A11Y_AUDIT_HOME` | resolved to an absolute path |

## 5. Headed review protocol

The person watches with you, or gets the videos. Ask before launching: the window takes keyboard focus, and typing
into it disturbs the run.

```bash
node headed.cjs --config _raw/a11y/audit.config.cjs --confirm [--states a,b] [--flows] [--no-walks] [--speak] [--narrate] [--views] [--step-ms 900]
```

| Output (`<out>/headed/`) | Content |
|---|---|
| `<state>-walk.webm`, `.mp4`, `.vtt` | the walk; the MP4 (with `--narrate`) carries the spoken track and captions |
| `<state>-steps.json` | each stop: snapshot line, speech, flags, time in the video |
| `<state>-zoom-200.webm`, `-reflow-320px`, `-text-spacing`, `-reduced-motion` | `--views`; with `--no-walks`, the views alone, for states that share a page with one already walked |
| `<flow>-flow.webm`, `.mp4`, `.vtt`, `.json` | `--flows`: each step announced, then focus, announcements and title |

What to watch, per stop: an indicator you can see against that background; the order follows reading order; nothing
covers the focused control (sticky header, cookie banner, chat button); the caption names the control with its role
and state. In the views: nothing cut off, overlapping or scrolling sideways; nothing moving with reduced motion. In
flows: focus lands where the task continues, every status is announced, the title changes on navigation. Write each
observation into the worksheet's Result column with the video time.

Narration and speech use macOS `say` (voice `A11Y_VOICE`, default Samantha; rate `A11Y_VOICE_RATE`, default 210 words
per minute). On other systems, run without `--speak` and `--narrate`.

## 6. Screen readers

**Virtual screen reader.** Reads the accessibility tree the way browse mode does ("heading, Report, level 1", "button,
Learn more, not expanded", "polite: Saved") and follows focus on Tab. It shows reading order, names, roles, states and
live regions. It does not show pronunciation, verbosity settings, forms-mode switching, or a particular browser and
screen reader's bugs.

**VoiceOver, automated (`voiceover.cjs`).** macOS only. It switches VoiceOver on, which speaks aloud and takes over the
keyboard, screen and pointer until it finishes, so it runs only after the person has said yes to this run
(`--confirm`).

```bash
node <skill>/voiceover.cjs --config <config> --confirm [--states home,faq] [--flows newsletter-error] \
  [--browser safari|chromium] [--modes tab,rotor,browse] [--max 150] [--out dir] [--tab-key Tab|Alt+Tab]
```

- `--browser safari` (the default) opens a Safari window of its own, loads each URL in it and closes it at the end.
  States with a `setup` need `--browser chromium`, which runs the setup first.
- `--modes`, for states: `tab`, `rotor` (every Web Rotor list: headings, landmarks, links, form controls), `browse`
  (VO-Right), `headings`, `links`, `controls`; default `tab,rotor,browse`. A mode stops when VoiceOver says the same
  thing three times running, comes back to its first phrase, or after `--max` steps.
- `--flows` replays `voFlows` (§1) with VoiceOver's keys and checks each step's `expect` against everything VoiceOver
  said during and after the step. A flow that cannot finish is recorded as failed and the run goes on to the next one.
- Output in `voiceover/`: `<state>-<browser>-<mode>.txt`, `flow-<id>-<browser>.txt`, `shots/` for steps with
  `shot: true`, and `run-<browser>-<time>.json` with each step's phrases, Safari's focused element (role, name,
  position), the pointer position and the failures. Compare the transcripts with `transcripts/<state>.txt`: same
  items, same order, names and states spoken.

*One-time setup*, which the person runs in their own terminal:

```bash
npx @guidepup/setup@0.29.3 setup --macos-ignore-tcc-db   # opens VoiceOver Utility: tick "Allow VoiceOver to be controlled with AppleScript"
npx @guidepup/setup@0.29.3 install voiceover             # guidepup's VoiceOver settings image, in ~/Library/Caches/guidepup
```

With System Integrity Protection on, setup cannot write macOS's permission databases; `--macos-ignore-tcc-db` skips
those writes and the person grants the permissions to the app that runs the script (Terminal, or the editor whose
terminal runs it): Privacy & Security > Accessibility on, and Automation for System Events, VoiceOver and Safari, each
asked on first use. A first run can also ask "<app> wants access to control osascript". If it does, answer Allow and
run again: a prompt that opens mid-run takes VoiceOver's focus, and every step after it fails. `setup.sh --check`
reports the AppleScript switch and the settings image.

*Before each run*, with the person:

- VoiceOver speaks through the speakers, so the run waits until the person is off any call.
- The keyboard and pointer stay untouched for the whole run. VoiceOver started in 2 to 26 s; four flows on one site
  took 361 to 368 s; one state in the three default modes took 172 to 300 s (the explorer's rotor alone 141 s).
  A run stops at the first app that comes forward and loses the states after it, so long batches run one state per
  invocation (`for s in home faq about; do node voiceover.cjs ... --states $s; done`).
- Other browser windows showing web pages are closed or their apps hidden: VoiceOver walked out of the run's page
  into another app's page, by VO-Right and through the Item Chooser.
- Apps that take Tab or Option-Tab as a global shortcut are quit first. ScreenBrush took Option-Tab, so Safari never
  received it.
- Another app coming to the front stops the run (`Stopped: <bundle id> came to the front`): the script checks its own
  window is in front before every key press.
- A hung app makes VoiceOver say "<app> is not responding" every few seconds, on top of the page's speech; wait until
  the app recovers or the person quits it.

*What the script does about guidepup and Safari.* Each behavior below broke a run on macOS 14 before the script
handled it; the log lines named here show it working.

- **Start.** guidepup's own start uses a private call that SIP blocks, and fails with "VoiceOver cannot be started".
  The script starts VoiceOver with `VoiceOverStarter`, as System Settings does.
- **Keyboard focus.** guidepup activates VoiceOver before every VoiceOver command, and afterwards Safari had no
  focused element: Tab and Option-Tab reached nothing. The script sends VoiceOver's keys without activating it;
  VoiceOver reads them from whichever app is in front.
- **What VoiceOver said.** guidepup's `lastSpokenPhrase()` returns its own log. After a key press VoiceOver stays
  quiet for, that log records an empty phrase, then records the previous phrase again, as new, on the next press.
  Every step (the modes, `tabTo`, `readTo`, `headingTo`, the Tab-key detection and the page entry) takes what guidepup
  logged during the key press minus that repeat, and VoiceOver's live phrase when it logged nothing. The live phrase
  alone missed items: guidepup returns from a key press after several seconds of polling, and by then VoiceOver can
  be reading its hint ("You are currently on a button..."). Flow transcripts drop the repeated phrase.
- **Into the page.** Safari usually puts VoiceOver inside the page by itself, and from inside the page the Item
  Chooser lists only the page's own items. The script steps out (VO-Shift-Up) until VoiceOver names the page area
  ("Out of <title> web content"), then interacts. After a reload, stepping out says nothing, so once Safari's Tab key
  is known the script presses it once instead. The page area must carry the run's page title, so another window's
  page ("Occupation distribution · Explore Programs web content") is never entered. Log line: `Into the page:`.
- **Safari's Tab key.** With "Press Tab to highlight each item on a webpage" off, Safari's default, Tab reaches
  buttons and fields only and Option-Tab reaches links. From the top of the page the script presses Tab, then
  Option-Tab, and flows use the first key after which VoiceOver names a link. Log: `Safari's Tab key here:`, with each
  press, the focused element and the pointer. The detection failed on a page whose first controls open popups, so a
  run that already knows the key passes `--tab-key` (the person's Safari setting does not change between runs).
- **Pointer.** guidepup's settings move the pointer onto whatever VoiceOver reads
  (`SCRConfigurationCursorTrackingMToVO`), which hovers it: a menu that opens on hover opened as VoiceOver reached its
  button, and the button then announced its "close" label. The script starts VoiceOver with that setting off, which
  guidepup writes to a shadow of its settings image, and parks the pointer on the menu bar, putting it back at the end.
- **Window size.** Safari opens the window at the size of the person's last Safari window; one left 564 px for the
  page, which got the phone layout. `voWindow` (§1) sets the size.
- **Screenshots.** VoiceOver says "Screenshot saved" after each `shot`; the script listens until that has been said
  before the next step.

*When a step fails*, read that step's `focus` in the run JSON before calling it a site defect. An empty `focus`
means Safari has no focused element. Repeat the same keys without VoiceOver (System Events key codes, then Safari's
`AXFocusedUIElement`) and in headless Chromium: a dialog that dropped focus on Escape under VoiceOver dropped it in
both repeats too, so the defect was the site's. `DEBUG='guidepup*'` traces every key and phrase poll, and `/usr/bin/log show --predicate
'subsystem == "com.apple.TCC"'` shows permission prompts (call `/usr/bin/log` by path when a shell function shadows
`log`).

*After a run.* If VoiceOver stays on after a failure, Command+F5 turns it off. guidepup's teardown detaches its
settings image and leaves four symlinks pointing into it,
`~/Library/Preferences/com.apple.VoiceOver4.portable.{scrd,scrd.vou,scro,scui}`; the next run replaces them. When the
person uses VoiceOver themselves, remove the symlinks, and only symlinks:
`for f in ~/Library/Preferences/com.apple.VoiceOver4.portable.*; do [ -L "$f" ] && rm "$f"; done`.

**Manual protocol, per combination.** Run each key state and each flow, and write down what was spoken:

| Screen reader | Start | Read next | Lists of elements | Activate | Notes |
|---|---|---|---|---|---|
| VoiceOver, macOS (Safari, Chrome) | Command+F5 | Control+Option+Right | rotor: Control+Option+U | Control+Option+Space | Safari is the pairing users expect |
| NVDA, Windows (Firefox, Chrome) | Control+Alt+N | Down arrow in browse mode | NVDA+F7 | Enter or Space | NVDA+Space switches browse and focus mode; check fields switch to focus mode |
| JAWS, Windows (Chrome, Edge) | from the Start menu | Down arrow | Insert+F6 headings, Insert+F7 links, Insert+F5 fields | Enter or Space | licence needed |
| VoiceOver, iOS (Safari) | Accessibility Shortcut (triple-click side button) | swipe right | rotor: two-finger rotate | double-tap | check targets and gesture alternatives |
| TalkBack, Android (Chrome) | hold both volume keys | swipe right | reading controls menu | double-tap | |

Listen for: every control's name, role and state; headings and landmarks that outline the page; images described or
silent as intended; status messages read without moving focus; dialogs read on open with focus inside; nothing read
twice; nothing important silent.

## 7. Manual checks

`wcag-checklist.md` gives the step for each criterion. Methods for the ones automation never settles:

- **Alt text and chart alternatives** (1.1.1): read the "For a person to read" inventory beside the page. Informative
  images say what they show; decorative ones are empty or hidden; a chart's alternative gives its numbers.
- **Media** (1.2.x): play each video with sound for captions, with eyes closed for audio description, and look for
  transcripts of audio.
- **Link and heading meaning** (2.4.4, 2.4.6): read the links list and heading outline alone; each says where it goes
  or what follows.
- **Errors** (3.3.1, 3.3.3, 3.3.4): submit each form empty, then wrong: the field is named, the fix is suggested, data
  changes can be reviewed or undone.
- **Timing and motion** (2.2.1, 2.2.2, 2.3.1): find session timeouts and auto-dismissing messages; watch animations
  and videos for flashing.
- **Pointer** (2.5.1, 2.5.4, 2.5.7): every drag, swipe, pinch or shake has a single-pointer or button alternative.
- **Authentication and repeated entry** (3.3.7, 3.3.8): paste and password managers work; no puzzle without an
  alternative; earlier answers are not asked again.

## 8. Regression tests

Every fix leaves a test in the project, so CI catches it coming back. Copy `templates/a11y-helpers.ts` to
`tests/a11y/helpers.ts`, `templates/playwright.a11y.config.ts` to the project root, and write one
`tests/a11y/<flow>.a11y.spec.ts` per flow from `templates/a11y.spec.ts`. Install with
`npm i -D @playwright/test @axe-core/playwright` (ask before adding dependencies). Each test names the finding it
guards in a comment. Run each new test once on the code before the fix: it must fail there, or it does not test the
fix. A test passes on the bug when it skips a step of the path that failed: a dialog test that pressed Escape straight
after opening passed, while the bug needed an address typed and submitted first, so the test repeats the whole path.

Against a dev server that has just started, run with `--workers=1` or load the pages once first: in parallel, 7 of 37
tests failed while their pages were still compiling, and all passed one at a time.

Good regression tests: axe on the state (serious and critical), Tab sequence names, focus after open, close and
navigation, `toMatchAriaSnapshot` for names, roles and states, announcements, reflow at 320 px, a visible focus
change. Real screen-reader tests (`@guidepup/playwright`) need macOS or Windows runners; keep them out of the default
CI job.

## 9. Before and after evidence

The before image comes from the code before the fix, in a separate copy so the working tree stays as it is:

```bash
git worktree add ../<repo>-before <commit-before-the-fix>
cd ../<repo>-before && npm ci && npm run dev -- --port 5174     # its own node_modules: a symlinked one makes Vite refuse files outside its root
# on APFS, `cp -cR ../<repo>/node_modules .` clones them in seconds instead of npm ci;
# gitignored files such as .env are missing too: link them (ln -s ../<repo>/.env .) when a step calls the app's API
node <skill>/capture.cjs --config _raw/a11y/audit.config.cjs --base-url http://localhost:5174 --state home --target "footer a" --focus --out _raw/a11y/report/focus-ring-before.png
node <skill>/capture.cjs --config _raw/a11y/audit.config.cjs --state home --target "footer a" --focus --out _raw/a11y/report/focus-ring-after.png
git worktree remove ../<repo>-before
```

`capture.cjs` scrolls the target to the middle of the window, takes the full window, and writes the box to mark
next to the image. `--focus` reaches the target with Tab; `--hover` rests the pointer on it; `--press <key>` (repeatable)
presses keys after that, such as Escape or ArrowRight; `--viewport 320x640` changes the window; `--mark <selector>`
boxes another element, such as the card whose edge clips the target's ring. Then one spec for all fixes:

```json
[{ "out": "focus-ring.png",
   "before": { "image": "focus-ring-before.png", "caption": "Before: the green ring is 2.3:1 on the dark footer" },
   "after": { "image": "focus-ring-after.png", "caption": "After: a white ring with a dark outer edge, 12.6:1" } }]
```

`node <skill>/compose.cjs _raw/a11y/report/spec.json` writes each image with the spot boxed in red and the captions
below. Look at every composed image before handing it over.

## 10. What review teams ask for

Reviewers test with real assistive technology and report against WCAG criteria. The complaints this skill is built to
catch, and where each shows up:

| Complaint | Caught by |
|---|---|
| Focus not visible, or faint on some backgrounds | `kbd:focus-not-visible`, `kbd:focus-low-contrast`, headed walk |
| Focus order does not follow the page | focus map, `kbd:order-jump`, `kbd:reverse-mismatch`, `struct:css-reorder` |
| Cannot reach or operate a control by keyboard | `kbd:unreachable`, `kbd:pointer-only`, `kbd:composite-*`, `kbd:roving-unreachable`, `kbd:custom-control-keys`, `hover:hover-only` |
| Keyboard trap, or Tab escapes a dialog | `kbd:trap`, `kbd:focus-loop`, `kbd:modal-escape` |
| Focus lost after closing, deleting or navigating | `kbd:focus-lost`, `kbd:popup-focus`, flows |
| Control announced without a name, role or state | `kbd:no-name`, `kbd:no-role`, `sr:unnamed`, axe and IBM name rules, transcripts |
| Status, error or result count not announced | flows (`announce`), `flow:live-region-created` |
| Errors not tied to fields | flows (`fieldError`) |
| Contrast of text, icons, borders, focus rings, chart marks | axe, `px:*`, `vis:control-border-contrast`, `kbd:focus-low-contrast` |
| Content lost at 200% or 320 px, or with text spacing | `vis:*`, headed views |
| Tooltips that vanish or cannot be dismissed | `hover:*` |
| Targets too small | `kbd:target-size` |
| Headings, landmarks and skip links | `struct:*`, axe, `kbd:skip-link`, inventory |
| Missing or wrong alt text, charts without numbers in text | axe, IBM, `struct:graphic-no-alt`, inventory read by a person |
| Captions, transcripts, audio description | `media:*`, manual |
| Inaccessible PDFs | `doc:*` |
| Moving content without a pause | `motion:auto-moving` |

They also expect: the tested browser and screen-reader combinations, a conformance level per criterion with remarks,
known issues with dates, and evidence. `acr.cjs` and `templates/review-report.md` produce those.

## 11. Browsers and platforms

- `audit.cjs --browser firefox|webkit` runs the same layers in another engine; Chrome's Issues are Chromium only.
  `headed.cjs`, `capture.cjs` and `voiceover.cjs --browser chromium` use Chromium.
- Safari's "Press Tab to highlight each item on a webpage" setting is off by default, so Safari users reach links with
  Option+Tab. Turn it on before a keyboard pass in Safari.
- VoiceOver automation, `say` narration and the Safari pairing are macOS only. On Windows, run the audit and headed
  walk without narration and test NVDA by hand (§6).

## 12. Adding a check

1. Add the id to `lib/checks.cjs` with its criteria, severity, outcome and title.
2. Implement it in the layer's module, returning `finding(id, { state, target, node, name, message, evidence, source })`
   with a message that names the element and the measured value.
3. Plant the failure in `fixtures/known-failures.html` (`data-expect="<id>"` on the element the finding targets) and
   build the correct version into `fixtures/known-good.html`.
4. `node selftest.cjs` must report it found and nothing on the good page.
5. Run it on a real app and read every new row before trusting it there.
