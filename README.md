# claude-skills

Reusable [Claude Code](https://code.claude.com) skills, published as a **plugin marketplace**. Each skill is its own plugin, so you install only what a project needs.

## Skills

| Plugin | Invoke as | What it does |
|--------|-----------|--------------|
| `d3-charts` | `/d3-charts:d3-charts` | A reusable D3.js chart convention — a chainable Chart class and enter-exit-update helper for responsive, updatable, framework-agnostic visualizations with no duplicate-element re-render bug. Ships a template, worked examples, and reference docs. |
| `light-cms` | `/light-cms:light-cms` | A lightweight Git-backed CMS for SvelteKit + Vercel — Google-auth admin, saves that commit content JSON to GitHub, and public pages that read bundled JSON. No database. Ships a full as-built playbook. |

## Requirements

[Claude Code](https://code.claude.com) with plugin support (run `/plugin` to confirm).

## Install

In any project, from Claude Code:

```
/plugin marketplace add bumbeishvili/claude-skills
/plugin install d3-charts@claude-skills     # or light-cms@claude-skills
```

Add the marketplace once, then install whichever plugins you want.

## Usage

Skills **auto-activate** when Claude detects a matching task (from each skill's `description`) — you rarely type anything. To trigger one manually, use its namespaced name, e.g. `/d3-charts:d3-charts`.

## Contributing a skill

1. Add `plugins/<name>/.claude-plugin/plugin.json` (`name`, `description`, `author`).
2. Add the skill at `plugins/<name>/skills/<name>/SKILL.md` (with `name` + `description` frontmatter).
3. Register it in `.claude-plugin/marketplace.json`: `{ "name": "<name>", "source": "./plugins/<name>" }`.
4. Test locally with `/plugin marketplace add .`, then commit and push.

### Layout

```
claude-skills/
├─ .claude-plugin/marketplace.json   # lists the plugins
└─ plugins/
   ├─ d3-charts/    ( .claude-plugin/plugin.json + skills/d3-charts/ )
   └─ light-cms/    ( .claude-plugin/plugin.json + skills/light-cms/ )
```

### Updates

Plugins omit an explicit `version`, so each commit is a new version. Auto-update is **off by default** for third-party marketplaces, so users pull changes with `/plugin marketplace update claude-skills` then `/plugin update` (or enable auto-update once via `/plugin` → Marketplaces).
