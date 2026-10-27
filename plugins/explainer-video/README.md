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

`skills/explainer-video/SKILL.md` has the workflow: agree the video, choose the effects that suit it, write one narration line per action, voice it, write the tour from `templates/`, dry-run, record, build and verify. Its effects table says when each one helps and when to leave it out; a video uses a few of them, not all.

The kit films the real app with a cursor that clicks, types, drags and selects, and adds:

- a camera that zooms in, follows the cursor or drifts on a held shot
- callouts, a spotlight, a blur round one panel, and marks (circle, underline, highlighter, strike, arrows, notes, step badges) drawn on the word that names them
- chapters, preview and recap cards, lower thirds, stat cards, a before/after wipe, fast-forward over long typing
- flowchart, terminal and code scenes for what the app cannot show
- captions that light up word by word, a voice that starts with the first frame, a closing card

`build.cjs` writes the MP4 with chapters inside, plus captions and chapter files, a transcript, a poster and an embed page; options add a framed background, motion blur or a music bed. `guide.cjs` turns a dry run into a written guide and a click-through walkthrough, and `diff-stills.cjs` lists the segments a UI change affects. `playbook.md` has every call, recipes, planning numbers and the traps behind each rule.

A two-minute video takes about 5 minutes to record and 1–3 to build, and comes out at 5–8 MB.

Part of [claude-skills](../../).
