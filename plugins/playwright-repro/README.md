# playwright-repro

Fix web bugs with throwaway Playwright scripts — reproduce first, measure against ground truth, then prove the fix.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/playwright-repro/skills/playwright-repro .claude/skills/playwright-repro
mkdir -p .agents/skills && ln -s ../../.claude/skills/playwright-repro .agents/skills/playwright-repro
```

Needs `npx`. The first line installs the skill for Claude Code, the second links it for Codex. Invoke with `/playwright-repro` in Claude Code or `$playwright-repro` in Codex, or describe a browser bug.

Playwright itself, globally, once per machine:

```bash
npm i -g playwright && playwright install chromium
```

Node does not search npm's global directory, so run scripts with `NODE_PATH` set:

```bash
NODE_PATH="$(npm root -g)" node repro.cjs
```

## What it covers

The loop, the four rules and the practices are in `skills/playwright-repro/SKILL.md`. Start an investigation by copying `template.cjs`; `playbook.md` has the recipes for auth, waiting, reading state, measuring, ground truth and soak loops.

A batch of bugs ends with `_raw/report.md`, with one item per piece of feedback. Each item includes the feedback verbatim and full viewport before/after images with red rectangles and captions below. The template captures these without altering the app layout. Include distinct affected views such as tables; phone checks depend on the change. Notes stay empty unless the reader needs information the images cannot show.

Part of [claude-skills](../../).
