# claude-skills

[Claude Code](https://code.claude.com) skills. Install all of them, plus `CLAUDE.md` and `settings.local.json`, into the current project:

```bash
curl -fsSL https://raw.githubusercontent.com/bumbeishvili/claude-skills/main/scripts/install.sh | FORCE=1 bash
```

Existing files are kept; `| FORCE=1 bash` replaces them, with backups. `settings.local.json` grants `Bash(*)`.

Or one at a time:

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

Style is an attribute of every task, not a task itself, so this one will not load on description match. To apply it to every reply, add a line to `.claude/CLAUDE.md` pointing at `.claude/skills/ai-deslop/SKILL.md`; its [README](plugins/ai-deslop/README.md) has the wording.

---

### [mcp-api-integration](plugins/mcp-api-integration/)

Working rules for Figma and Asana over MCP and REST. An OAuth connection writes under your name, so state edits are fine and comments are not.

```bash
npx degit bumbeishvili/claude-skills/plugins/mcp-api-integration/skills/mcp-api-integration .claude/skills/mcp-api-integration
```

---

### [data-debug](plugins/data-debug/)

Check a page's numbers against their source. Tag each figure with a `data-calc` formula, then add `#debug` to the URL to read it back in the browser.

```bash
npx degit bumbeishvili/claude-skills/plugins/data-debug/skills/data-debug .claude/skills/data-debug
```
