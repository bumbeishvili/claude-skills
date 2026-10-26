# explainer-video

Narrated explainer and guide videos of a web app, voiced locally with Kokoro 82M.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/explainer-video/skills/explainer-video .claude/skills/explainer-video
mkdir -p .agents/skills && ln -s ../../.claude/skills/explainer-video .agents/skills/explainer-video
```

The first line installs the skill for Claude Code, the second links it for Codex. Invoke with `/explainer-video` in Claude Code or `$explainer-video` in Codex, or ask for a tour, guide or demo video of an app.

The voice and tools, once per machine (Apple Silicon Mac, about 1.5 GB in `~/.cache/explainer-video`):

```bash
bash .claude/skills/explainer-video/setup.sh --check   # what is missing
bash .claude/skills/explainer-video/setup.sh           # install it, then voice a test line
```

That installs mlx-audio with the `mlx-community/Kokoro-82M-bf16` model (voice `af_heart`), an ffmpeg with H.264, and Playwright. The agent runs the check and asks you to run the install when something is missing.

## What it covers

`skills/explainer-video/SKILL.md` has the workflow: agree the video, write one narration line per action, voice it, write the tour from `templates/`, dry-run, record, build and verify. `playbook.md` has the tour API, recipes (clicks on cue, native selects, cutting out loading, drags, an AI chat round trip, the browser intro), planning numbers, and the traps behind each rule.

A two-minute video takes about 5 minutes to record and 1–3 to build, and comes out around 8 MB.

Part of [claude-skills](../../).
