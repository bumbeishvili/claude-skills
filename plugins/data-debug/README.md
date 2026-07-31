# data-debug

Check a page's numbers against their source without opening the code. Tag each figure with a `data-calc` formula in `file.column` dot notation, then add `#debug` to the URL: every tagged element gets a ƒx badge that shows the formula on hover.

```html
<div
  data-calc="round(occupations.avg_pct_automated×100)"
  data-calc-note="Share of this role's tasks AI can fully automate, as a whole percent."
>
  42%
</div>
```

## Install

```bash
npx degit bumbeishvili/claude-skills/plugins/data-debug/skills/data-debug .claude/skills/data-debug
```

Needs `npx`. Invoke with `/data-debug`, or ask to make a chart's numbers traceable.

## What it covers

The dot-notation rules and the discipline for keeping formulas current are in `skills/data-debug/SKILL.md`. Two overlays read the attributes: `data-debug-overlay.js`, zero-dependency and framework-agnostic, and `DataDebugOverlay.svelte` for Svelte + Tailwind. `#debug` on, Esc off.

Part of [claude-skills](../../).
