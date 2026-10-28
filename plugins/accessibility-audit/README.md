# accessibility-audit

Audit a web app against WCAG 2.2 A and AA the way an accessibility review team tests it, fix what it finds, and prove
each fix.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/accessibility-audit/skills/accessibility-audit .claude/skills/accessibility-audit
mkdir -p .agents/skills && ln -s ../../.claude/skills/accessibility-audit .agents/skills/accessibility-audit
```

The first line installs the skill for Claude Code, the second links it for Codex. Invoke with `/accessibility-audit`
in Claude Code or `$accessibility-audit` in Codex, or ask for an accessibility audit, a WCAG review, or keyboard and
screen-reader testing.

The tools, once per machine (Node 18 or later):

```bash
bash .claude/skills/accessibility-audit/setup.sh --check   # what is missing
bash .claude/skills/accessibility-audit/setup.sh           # install it
```

That puts about 120 MB of pinned packages (Playwright, axe-core, IBM Equal Access, a virtual screen reader, Guidepup,
ffmpeg) in `~/.cache/accessibility-audit` and Playwright's browsers (about 1.2 GB, shared with other Playwright
installs) in Playwright's cache. Nothing is added to the project. Optional: `brew install poppler` for linked PDFs, and
`npx @guidepup/setup setup` once, run by you, to let the skill drive VoiceOver.

## What it covers

`skills/accessibility-audit/SKILL.md` has the workflow: agree the states and tasks, run the audit, verify each
finding, run the headed review and real screen readers, do the manual checks, fix with regression tests, and report.

The audit (`audit.cjs`) runs on every state in a small config file:

- axe-core and IBM Equal Access rule engines, plus Chrome's own Issues panel
- a keyboard walk with real Tab presses: focus indicators measured in pixels, order against the layout, traps, focus
  lost or hidden under sticky bars, controls never reached, Shift+Tab retracing, target size
- probes that press keys: skip links, arrow keys in menus, tabs, lists, radio groups, trees and grids, Enter and Space
  on custom controls, popups that should take focus and close on Escape, single-key shortcuts
- a virtual screen reader reading every state, with its transcript
- contrast measured from pixels for text over images, SVG text, icons and field borders
- 200% zoom, 320 px reflow, text spacing, sticky bars, orientation, reduced motion, content that moves by itself
- tooltips and hover cards: dismiss, hover and persistence
- consistency across pages, linked PDFs, and scripted tasks that check where focus lands, what is announced and the
  page title after each step

It writes a report with failures, items to review and best practice, a worksheet of all 55 criteria, focus-order maps,
transcripts and screenshots. `headed.cjs` replays each state and task in a visible browser with a caption panel and
records narrated, captioned videos; `voiceover.cjs` drives real VoiceOver on macOS and records what it says.
`capture.cjs` and `compose.cjs` make before/after images, and `acr.cjs` builds the per-criterion conformance table for
a review team. `patterns.md` has a fix for each kind of finding and `templates/` the config, regression tests and
report. `selftest.cjs` checks the audit itself against a page of planted failures and a page that must come out
clean.

A state takes 40 seconds to a few minutes to audit, growing with its Tab stops: a page with 104 stops took 200 s.

Part of [claude-skills](../../).
