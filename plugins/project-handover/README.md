# project-handover

Fill a project handover Google Doc from the codebase and its hosting — gather the facts, draft answers that admit gaps, then fill and format the doc through the user's own signed-in browser.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/project-handover/skills/project-handover .claude/skills/project-handover
```

Needs `npx`. Invoke with `/project-handover` and a Google Docs link, or ask to fill in a handover document.

Playwright itself, globally, once per machine:

```bash
npm i -g playwright && playwright install chromium
```

Node does not search npm's global directory, so run scripts with `NODE_PATH` set:

```bash
NODE_PATH="$(npm root -g)" node gdoc-browser.cjs <docId>
```

## What it covers

The workflow: read the template, inventory the project (git history, package manifest, hosting CLI, env example, README, design files, data sources, analytics, tests), write one answer per field with `TBC` where nothing supports a claim, then fill the doc field by field, format it so filled content stays visually distinct from template text, and read it back to verify.

The Docs side has no API here, so a headed Chrome stays open in the background with a CDP port and the user signs in once; short scripts connect to it: `gdoc-outline.cjs` reads the doc through its mobile view, `gdoc-edit.cjs` writes through Docs' Find box and keyboard shortcuts from a JSON op list, `gdrive-locate.cjs` finds the doc's folder in Drive.

`skills/project-handover/SKILL.md` has the workflow and the writing rules; `playbook.md` has the fact-gathering commands, the field checklist and the key sequences.

Part of [claude-skills](../../).
