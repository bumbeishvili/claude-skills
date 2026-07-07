# claude-skills

A [Claude Code](https://code.claude.com) **plugin marketplace** of reusable skills.
Each skill ships as its own plugin, so a project installs only what it needs.

## Skills

| Plugin | Invoke as | What it does |
|--------|-----------|--------------|
| `d3-charts` | `/d3-charts:d3-charts` | Reusable D3.js chart convention — responsive, updatable, framework-agnostic, and free of the duplicate-element re-render bug. |
| `light-cms` | `/light-cms:light-cms` | Lightweight Git-backed CMS for SvelteKit + Vercel — Google-auth admin, commits content JSON to GitHub, no database. |

> Skills also **auto-activate** when Claude detects a matching task (from the skill's `description`) — you rarely need to type the slash command. (Plugin skills are always namespaced `plugin:skill`; see [Good to know](#good-to-know).)

## Install in a project

From Claude Code, in any project:

```
/plugin marketplace add bumbeishvili/claude-skills
/plugin install d3-charts@claude-skills
/plugin install light-cms@claude-skills
```

Add the marketplace once; each `install` enables that plugin's skill in the current project. Install both lines to get everything.

## Try it locally (before pushing)

From this repo's own directory:

```
/plugin marketplace add .
/plugin install d3-charts@claude-skills
```

## Repository layout

```
claude-skills/
├─ .claude-plugin/
│  └─ marketplace.json          # lists the plugins below
├─ plugins/
│  ├─ d3-charts/
│  │  ├─ .claude-plugin/plugin.json
│  │  └─ skills/d3-charts/       # SKILL.md + template.js + examples/ + reference/
│  └─ light-cms/
│     ├─ .claude-plugin/plugin.json
│     └─ skills/light-cms/       # SKILL.md + playbook.md
└─ .claude/                      # config for developing IN this repo (not distributed)
```

## Add a new skill

1. Create `plugins/<name>/.claude-plugin/plugin.json` with `name`, `description`, `author`.
2. Put the skill at `plugins/<name>/skills/<name>/SKILL.md` (with `name` + `description` frontmatter).
3. Add an entry to `.claude-plugin/marketplace.json`:
   ```json
   { "name": "<name>", "source": "./plugins/<name>" }
   ```
4. Commit and push — installers pick up changes automatically.

## Publishing & updates

The marketplace resolves over GitHub, so changes go live when you push:

```
git add .
git commit -m "your message"
git push
```

**How installers get your updates.** Because the plugins omit an explicit `version`, Claude Code treats each new commit as a new version — but **auto-update is off by default for third-party marketplaces**. After you push, an installed user picks up the change by either:

- running `/plugin marketplace update claude-skills` and then `/plugin update`, or
- enabling it once via `/plugin` → **Marketplaces** → `claude-skills` → **Enable auto-update** (Claude Code then refreshes at startup).

For stable, opt-in releases instead of per-commit updates, add `"version": "1.0.0"` to a plugin's `plugin.json` and bump it per change.

## Listing it publicly (optional)

There's no npm-style registry — your GitHub repo *is* the marketplace, and sharing its link lets anyone install. If you also want it in Anthropic's directories:

- **Official** marketplace — curated by Anthropic, browsable at [claude.com/plugins](https://claude.com/plugins); inclusion is at Anthropic's discretion.
- **Community** marketplace — [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community); submit via [platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit). Approved plugins are pinned to a commit SHA in that catalog.

## Good to know

- **Invocation is always namespaced `plugin:skill`** (e.g. `/d3-charts:d3-charts`) — a Claude Code design choice to avoid collisions, with no unnamespaced form. You'll rarely type it, since skills auto-activate from their `description`.
- **`.claude/` is dev config for this repo and is not distributed.** Installers only receive the `plugins/` directories via the marketplace; this repo's own `.claude/CLAUDE.md` and `settings.json` never reach them.
- **`settings.local.json` is git-ignored** — it's meant to be personal and machine-local, so it stays out of the repo (see `.gitignore`).
