---
name: data-debug
description: Tag each data-driven UI element with a `data-calc` attribute naming the source columns and arithmetic behind its number, then add `#debug` to the URL to check them in the browser — every tagged element gets a ƒx badge showing its formula on hover. Use when building dashboards, charts, stat tiles or any figure derived from data, when asked for a data debug or `#debug` overlay, and when someone asks where a number on the page came from. Ships a zero-dependency vanilla overlay (`data-debug-overlay.js`) and a Svelte + Tailwind component (`DataDebugOverlay.svelte`).
---

# data-debug (`data-calc`)

Point at any number on the page and see which source columns and arithmetic produced it, without opening the code. Two attributes on the element carry that; an overlay surfaces them when the URL ends in `#debug`.

Writing the formula down while the source is still in front of you catches "where did this figure come from?" bugs before they ship.

## The two attributes

Put both on the **wrapper of the smallest element that owns the number or chart** — a stat tile, a card value, a chart's container.

- **`data-calc`** — the formula, terse, in `file.column` dot notation.
- **`data-calc-note`** — one plain-English sentence for a reader who knows the data and thinks in spreadsheets. Optional, worth having on anything non-obvious.

```html
<div
  data-calc="round(occupations.avg_pct_automated×100)"
  data-calc-note="Share of this role's tasks AI can fully automate, as a whole percent."
>
  42%
</div>
```

## Dot-notation rules

- **`file.column`** — file is the data source name without extension (a CSV, a table), column is the exact field. `occupations.avg_pct_automated` → the `avg_pct_automated` column of `occupations.csv`. A reader greps the source in one step.
- **`|` separates alternatives** — one of several columns or values that could feed the slot: `occupations.ttf_entry|mid|senior`. Keep `/` for real division, so a ratio stays readable.
- **Derived helpers keep their function name with dotted args**, which makes shared logic recognizable: `taskCategoryOf(tasks.pct_automated, tasks.pct_augmented)`.
- **`;`-separated clauses render one per line** in the overlay. Break a multi-step calculation into clauses.
- Use `×` for multiply, `Σ` for a sum over rows, `mean(...)` and `count(...)` for aggregates.

## The inspector

- **`#debug` on any URL turns it on.** Every `[data-calc]` element gets a dashed outline and a **ƒx** badge; hovering the badge shows `data-calc` split one clause per line, then `data-calc-note` below a divider. **Esc — or removing the hash — turns it off.**
- **Modal-aware.** While a modal is open, only *its* marks show — badges from the page underneath bleed through the backdrop and read as part of the modal. The overlay finds the modal by selector (`.fixed.inset-0.z-50, [aria-modal="true"], [role="dialog"], dialog[open]`) and filters to `modal.contains(el)`.
- **Re-measures every animation frame,** because charts animate in, columns scroll and modals mount asynchronously.

## Install

**Framework-agnostic** — [`data-debug-overlay.js`](data-debug-overlay.js), zero dependencies:

```html
<script src="/data-debug-overlay.js"></script>
<!-- auto-inits on load; or call it yourself for options: -->
<script>initDataDebugOverlay({ accent: '#5450f8', modalSelector: '[role="dialog"]' });</script>
```

**Svelte + Tailwind** — [`DataDebugOverlay.svelte`](DataDebugOverlay.svelte). Mount it **once** in the root layout, after the page slot, so it overlays every route:

```svelte
<slot />
<DataDebugOverlay />
```

Both read the same two attributes; the vanilla file additionally takes `accent` and `modalSelector`. For React or Vue, port its `initDataDebugOverlay` into an effect that runs once on mount and calls the returned `destroy()` on unmount.

## Discipline

- **Add or update `data-calc` in the same edit that adds or changes the number.** Drift here is invisible: the badge keeps showing the old formula with nothing to signal it went stale. When you can't state the source, resolve where the value comes from before shipping it.
- **One `data-calc` per owned figure**, on its wrapper. On a parent holding several unrelated numbers, the badge points at the wrong thing.
- **Keep the note in the data owner's language.** It says what the number means and where it comes from, not how the code works.
