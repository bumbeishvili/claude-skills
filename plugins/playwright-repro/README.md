# playwright-repro

Fix web bugs with throwaway Playwright scripts — reproduce first, measure against ground truth, then prove the fix.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/playwright-repro/skills/playwright-repro .claude/skills/playwright-repro
```

Needs `npx`. Invoke with `/playwright-repro`, or describe a browser bug.

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

Part of [claude-skills](../../).
