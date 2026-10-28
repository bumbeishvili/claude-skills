---
name: accessibility-audit
description: Audit and fix a web app against WCAG 2.2 A and AA the way an accessibility review team tests it. axe-core and IBM Equal Access on every page state; a real-Tab keyboard walk (focus order, focus indicators measured in pixels, traps, covered focus); key probes for menus, tabs, lists, custom controls, skip links and popups; a virtual screen reader; contrast, zoom, reflow, text spacing, hover, motion, target size and PDF checks; scripted keyboard tasks. Then a narrated headed pass in a visible browser, real VoiceOver, fix recipes, regression tests, before/after images and a conformance report. Use for any accessibility audit, a11y or WCAG review, VPAT or ACR preparation, keyboard or screen-reader testing, or fixing accessibility complaints. Checks its setup first; playbook.md has every option and trap, patterns.md the fixes.
---
# Accessibility audit

Tests a running web app with the methods an accessibility review team uses, measures instead of inferring, fixes
what it finds, and proves each fix with the same measurement. Scripts run with plain `node`; `<skill>` below is this
folder (`.claude/skills/accessibility-audit`).

| File | What it does |
|---|---|
| [`setup.sh`](setup.sh) | `--check` reports what is missing; without it, installs the pinned tools and browsers |
| [`audit.cjs`](audit.cjs) | the automated audit of every state, page and flow in a config: `summary.md`, `findings.json`, evidence |
| [`headed.cjs`](headed.cjs) | the headed review: a visible browser walks each state and plays each flow, captioned, spoken and recorded |
| [`voiceover.cjs`](voiceover.cjs) | real VoiceOver on macOS, driven through a state; records every phrase it speaks |
| [`capture.cjs`](capture.cjs), [`compose.cjs`](compose.cjs) | before/after screenshots of a fix with the spot boxed, side by side with captions |
| [`acr.cjs`](acr.cjs) | the per-criterion conformance table for the review team, kept consistent with the audit's failures |
| [`selftest.cjs`](selftest.cjs) | proves every check against pages with planted failures and a page that must come out clean |
| [`templates/`](templates/) | audit config, regression-test helpers, spec and Playwright config, the review-team report |
| [`playbook.md`](playbook.md) | config keys, what each layer measures, reading the report, headed and screen-reader protocols, traps |
| [`patterns.md`](patterns.md) | fix recipes for every failure the audit reports |
| [`wcag-checklist.md`](wcag-checklist.md) | the 55 WCAG 2.2 A/AA criteria with what a person confirms for each |

## 0. Check the setup

```bash
bash <skill>/setup.sh --check
```

It changes nothing and exits 1 when a required part is missing. Then ask the person to run `bash <skill>/setup.sh` in
their own terminal: it installs about 120 MB of pinned npm packages into `~/.cache/accessibility-audit`
(`A11Y_AUDIT_HOME` moves it) plus Playwright's Chromium, Firefox and WebKit (about 1.2 GB, shared with other
Playwright installs). Optional parts it reports: `pdfinfo` for linked PDFs (`brew install poppler`), macOS `say` for
spoken walkthroughs, and VoiceOver automation (`npx @guidepup/setup setup`, run by the person).

## 1. Agree the scope, write the config

Copy [`templates/audit.config.example.cjs`](templates/audit.config.example.cjs) to `_raw/a11y/audit.config.cjs` in the
project (create `_raw/` when missing) and fill it from the app, not from the template:

- **States**: every page a user reaches, plus each state with different content: menus and dialogs open, form errors,
  empty, loading and populated results, phone layout, dark mode. A `setup(page, a11y)` reaches the state by keyboard.
- **Flows**: each task a user completes (sign up, search, filter, read a chart, submit), step by step, with where focus
  must land, what must be announced, which field must show its error, and the title after navigation.
- **Hosts**: the local dev server or a staging host the person named. The probes press Enter on buttons and flows
  submit forms, so a production host needs the person's yes and flows that change no data.

Ask the person to confirm the list of states and flows before the first full run. A state takes 40 seconds to a few
minutes, growing with its Tab stops: 15 stops took 43 s, 104 stops took 200 s.

## 2. Run the automated audit

```bash
node <skill>/audit.cjs --config _raw/a11y/audit.config.cjs            # every state, page and flow
node <skill>/audit.cjs --config ... --states home,home-menu --skip visual,crosspage,documents   # a quick re-check
```

It runs headless and writes `_raw/a11y/summary.md` (failures, items to review, best practice, the WCAG worksheet,
states, flows, linked documents, inventories for a person to read), `findings.json`, and the evidence it cites:
focus screenshots, focus-order maps, screen-reader transcripts, accessibility snapshots. Exit code 2 means a state did
not run; its error is in the report.

## 3. Verify before reporting or fixing

Every row is a claim. Open its evidence (the screenshot, the map, the transcript, the snapshot) and look at the
element in the page before reporting it as a defect or changing code. When the evidence contradicts the row, the
measurement is the suspect: reproduce it with one state (`--states`), find the cause in the check, fix the check, add
the case to the fixtures, and run `node <skill>/selftest.cjs` until it passes. playbook.md §4 lists the traps found so
far and how each check avoids them.

## 4. Headed review (ask first)

A review team watches the keyboard and listens to the screen reader; the headed pass gives the same view. It opens a
visible Chromium window that takes keyboard focus, so **ask the person first**, then run:

```bash
node <skill>/headed.cjs --config _raw/a11y/audit.config.cjs --confirm --narrate --views --flows
```

Each state's walk shows every stop's role, name and speech in a caption panel, flags covered or off-screen focus, and
records `headed/<state>-walk.mp4` with the spoken track and captions; `--views` adds 200% zoom, 320 px reflow, text
spacing and reduced motion; `--flows` plays each task with focus and announcements per step. `--speak` also says each
stop aloud live. Without the person's yes, run it with `--headless` and hand over the videos. playbook.md §5 lists
what to watch for.

## 5. Real screen readers (ask first)

The virtual screen reader models a screen reader's browse mode; real ones differ in wording, verbosity and browser
pairing. On macOS, with the person's yes and VoiceOver automation enabled:

```bash
node <skill>/voiceover.cjs --config _raw/a11y/audit.config.cjs --state home --confirm --browser safari
```

It turns VoiceOver on, which speaks aloud and takes over the keyboard until it finishes, and records reading order,
headings, links, landmarks and Tab. NVDA, JAWS, TalkBack and iOS VoiceOver are run by a person with the protocol in
playbook.md §6; list each combination tested in the report.

## 6. The criteria no script decides

The worksheet in `summary.md` marks each criterion "Fails", "Review", "No automated failures" or "Not covered by
automation". Every criterion that is not "Fails" still needs its manual step from
[`wcag-checklist.md`](wcag-checklist.md): alt text that says the right thing, captions that match the audio, link
text in context, error suggestions, time limits, consistent help. Record each result; it feeds step 9.

## 7. Fix, one finding at a time

- Read the finding's evidence, then the component that renders it. Fix the shared component, and check its other
  uses.
- Use the recipe in [`patterns.md`](patterns.md): native HTML first, ARIA only for what HTML cannot express, every
  widget operated the way its ARIA Authoring Practices pattern says.
- Re-run the check that found it (`--states <id>`), then the whole state, so a fix that breaks something else shows.
- Leave a regression test per fix in the project, from [`templates/a11y.spec.ts`](templates/a11y.spec.ts) with
  [`templates/a11y-helpers.ts`](templates/a11y-helpers.ts) and
  [`templates/playwright.a11y.config.ts`](templates/playwright.a11y.config.ts). Run it against the old code once to
  see it fail.
- Copy, layout and design-token changes are the team's decision: report the finding with the measured value and the
  smallest change that passes, and ask.

## 8. Before and after

For each fix: `capture.cjs` on an isolated copy of the code before the fix and on the fixed code, same state and
target, then `compose.cjs` for one image per fix with the spot boxed in red and captions below. playbook.md §9 has
the commands, including the git worktree for the before copy.

## 9. Report to the review team

- `node <skill>/acr.cjs --findings _raw/a11y/findings.json --init _raw/a11y/conformance.json`, fill in each criterion's
  level and remarks from the audit, the headed pass and step 6, then render with `--manual ... --out
  _raw/a11y/conformance.md`. It refuses a blank criterion and "Supports" where failures are open.
- Fill [`templates/review-report.md`](templates/review-report.md): scope, methods with tool versions, browser and
  screen-reader combinations, the conformance table, open issues with plans, fixes with their tests, evidence, and
  what was not tested and why.

## Reporting to the person

Lead with what was tested and the result in counts. Then list on its own line each part not done or not verified:
states that errored, screen readers not run, criteria still waiting for their manual step. A run with no automated
failures is evidence for the criteria it covered; it is not a conformance claim.
