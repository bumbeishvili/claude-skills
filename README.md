# claude-skills

Reusable [Claude Code](https://code.claude.com) skills. Each command below copies a skill into `.claude/skills/` (needs `npx`). A skill loads when the task matches its description, or on `/<skill>`.

---

### d3-charts

D3.js chart convention — responsive, updatable, no duplicate-element re-render bug.

```bash
npx degit bumbeishvili/claude-skills/plugins/d3-charts/skills/d3-charts .claude/skills/d3-charts
```

---

### light-cms

Git-backed CMS for SvelteKit + Vercel. No database.

```bash
npx degit bumbeishvili/claude-skills/plugins/light-cms/skills/light-cms .claude/skills/light-cms
```

---

### playwright-repro

Fix web bugs with throwaway Playwright scripts — reproduce first, measure against ground truth, then prove the fix.

```bash
npx degit bumbeishvili/claude-skills/plugins/playwright-repro/skills/playwright-repro .claude/skills/playwright-repro
```

---

### ai-deslop

Strip the AI tells from prose — numbers you measured, claims a reader can check. Separate rules for human-facing writing and for files a model reads.

```bash
npx degit bumbeishvili/claude-skills/plugins/ai-deslop/skills/ai-deslop .claude/skills/ai-deslop
```

Style is an attribute of every task, not a task itself, so this one will not load on description match. To apply it to every reply, add a line to `.claude/CLAUDE.md` pointing at `.claude/skills/ai-deslop/SKILL.md`; its [README](plugins/ai-deslop/README.md) has the wording.
