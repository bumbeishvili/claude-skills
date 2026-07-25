# d3-charts

Reusable D3.js chart convention — responsive, updatable, no duplicate-element re-render bug.

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/d3-charts/skills/d3-charts .claude/skills/d3-charts
```

Needs `npx`. The skill auto-activates on matching tasks, or invoke it manually with `/d3-charts`.

## What's inside

| Path | Purpose |
|---|---|
| `skills/d3-charts/SKILL.md` | The convention: chainable state, `_add()`, the render pipeline |
| `skills/d3-charts/template.js` | Copy this to start any new chart |
| `skills/d3-charts/examples/` | Complete `line-chart.js`, `sankey-chart.js`, `map-chart.js` |
| `skills/d3-charts/reference/conventions.md` | Full write-up — why each piece exists |
| `skills/d3-charts/reference/replacements.js` | Cheatsheet: old `.append()` / enter-exit to `_add` |

Part of [claude-skills](../../).
