# light-cms

Git-backed CMS for SvelteKit + Vercel. No database. Use for a requested Git-backed CMS; ordinary copy changes should use the project's existing content source.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/light-cms/skills/light-cms .claude/skills/light-cms
mkdir -p .agents/skills && ln -s ../../.claude/skills/light-cms .agents/skills/light-cms
```

Needs `npx`. The first line installs the skill for Claude Code, the second links it for Codex. The skill auto-activates on matching tasks, or invoke it manually with `/light-cms` in Claude Code or `$light-cms` in Codex.

## What's inside

| Path | Purpose |
|---|---|
| `skills/light-cms/SKILL.md` | The map: two cardinal rules, build order, the gotchas |
| `skills/light-cms/playbook.md` | The territory: copy-ready code for every module, lessons learned, verify checklist |

Part of [claude-skills](../../).
