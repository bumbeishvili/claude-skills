# claude-skills

Agent skills for [Claude Code](https://code.claude.com) and for [Codex](https://learn.chatgpt.com/docs/build-skills), the coding agent in ChatGPT. Install all of them, plus the shared instructions in `AGENTS.md` and Claude Code's `settings.local.json`, into the current project:

```bash
curl -fsSL https://raw.githubusercontent.com/bumbeishvili/claude-skills/main/scripts/install.sh | FORCE=1 bash
```

Existing files are kept; `| FORCE=1 bash` replaces them, with backups. `settings.local.json` grants `Bash(*)`.

Both agents end up reading the same files:

| Installed | Read by |
|---|---|
| `AGENTS.md` | Codex directly, Claude Code through the `@../AGENTS.md` import in `.claude/CLAUDE.md` |
| `.claude/skills/<skill>/` | Claude Code |
| `.agents/skills/<skill>` | Codex. Each entry is a relative link to the folder in `.claude/skills/` |

Or one at a time. Each command below installs a skill for Claude Code; link it for Codex as well with:

```bash
mkdir -p .agents/skills && ln -s ../../.claude/skills/<skill> .agents/skills/<skill>
```

---

### [d3-charts](plugins/d3-charts/)

D3.js chart convention — responsive, updatable, no duplicate-element re-render bug.

```bash
npx degit bumbeishvili/claude-skills/plugins/d3-charts/skills/d3-charts .claude/skills/d3-charts
```

---

### [light-cms](plugins/light-cms/)

Git-backed CMS for SvelteKit + Vercel. No database.

```bash
npx degit bumbeishvili/claude-skills/plugins/light-cms/skills/light-cms .claude/skills/light-cms
```

---

### [playwright-repro](plugins/playwright-repro/)

Fix web bugs with throwaway Playwright scripts — reproduce first, measure against ground truth, then prove the fix.

```bash
npx degit bumbeishvili/claude-skills/plugins/playwright-repro/skills/playwright-repro .claude/skills/playwright-repro
```

---

### [ai-deslop](plugins/ai-deslop/)

Strip the AI tells from prose — numbers you measured, claims a reader can check. Separate rules for human-facing writing and for files a model reads.

```bash
npx degit bumbeishvili/claude-skills/plugins/ai-deslop/skills/ai-deslop .claude/skills/ai-deslop
```

Style is an attribute of every task, not a task itself, so this one will not load on description match. To apply it to every reply, add a line to `AGENTS.md` pointing at `.claude/skills/ai-deslop/SKILL.md`; its [README](plugins/ai-deslop/README.md) has the wording.

---

### [mcp-api-integration](plugins/mcp-api-integration/)

Working rules for Figma and Asana over MCP and REST. Create tickets before feature work, follow the project's completion workflow, and attach before/after evidence. Connections act as you, so text comments require authorization.

```bash
npx degit bumbeishvili/claude-skills/plugins/mcp-api-integration/skills/mcp-api-integration .claude/skills/mcp-api-integration
```

---

### [data-debug](plugins/data-debug/)

Check a page's numbers against their source. Tag each figure with a `data-calc` formula, then add `#debug` to the URL to read it back in the browser.

```bash
npx degit bumbeishvili/claude-skills/plugins/data-debug/skills/data-debug .claude/skills/data-debug
```

---

### [project-handover](plugins/project-handover/)

Fill a project handover Google Doc from the codebase and its hosting — facts from git, the manifest and the hosting CLI, `TBC` where nothing supports a claim, then filled and formatted through the user's own signed-in Chrome.

```bash
npx degit bumbeishvili/claude-skills/plugins/project-handover/skills/project-handover .claude/skills/project-handover
```

---

### [explainer-video](plugins/explainer-video/)

Narrated explainer and guide videos of a web app: a cursor driving the real UI, callouts, a browser-window intro, and a local Kokoro voice. 1080p, web-sized MP4.

```bash
npx degit bumbeishvili/claude-skills/plugins/explainer-video/skills/explainer-video .claude/skills/explainer-video
```

The voice installs once per machine with `bash .claude/skills/explainer-video/setup.sh` (Apple Silicon Mac); the skill checks for it first.

---

### As plugins

The repo is also a plugin marketplace, and both agents read the same `.claude-plugin/marketplace.json`. A plugin installed this way is available in every project on the machine, where the installer above writes into one.

```bash
claude plugin marketplace add bumbeishvili/claude-skills && claude plugin install d3-charts@claude-skills
codex plugin marketplace add bumbeishvili/claude-skills && codex plugin add d3-charts@claude-skills
```
