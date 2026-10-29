# Fix patterns

One recipe per kind of finding, with the check ids that lead here. Native HTML first; ARIA only for what HTML cannot
express; every widget behaves as its [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/) pattern
says. Fix the shared component, then re-run the check that found it (`audit.cjs --states <id>`) and leave a
regression test (playbook.md §8). Snippets are framework-free; port them to the project's components and tokens.

## Keyboard and focus

### Visible focus on every background
`kbd:focus-not-visible`, `kbd:focus-low-contrast` (2.4.7, 1.4.11). One global rule, two tones, so the ring reaches 3:1
on light and dark sections alike:

```css
:focus-visible {
	outline: 2px solid #1a1a1a;
	outline-offset: 2px;
	box-shadow: 0 0 0 2px #ffffff; /* light band in the offset gap: the ring reads on dark backgrounds too */
}
```

A control that fills a parent with `overflow: hidden` (a card-sized button, a carousel slide) has its outline clipped:
draw the ring inside it with `outline-offset: -4px` or `box-shadow: inset 0 0 0 3px #1a1a1a, inset 0 0 0 5px #fff`.
To hide the ring after a mouse click on text fields only, record the input mode and scope the rule:
`html[data-input="pointer"] input:focus-visible { outline: none; }`, with `data-input` set to `keyboard` on Tab, arrows,
Enter, Escape and Space, and to `pointer` on `pointerdown`. Verify: the headed walk, `expectVisibleFocus` in a test.

### Skip link that moves focus
`kbd:skip-link`, `kbd:no-skip-link` (2.4.1).

```html
<a class="skip-link" href="#main">Skip to main content</a>
<!-- header, navigation -->
<main id="main" tabindex="-1">…</main>
```
```css
.skip-link { position: absolute; left: 8px; top: -100px; }
.skip-link:focus { top: 8px; }
```

A router that intercepts `#` links cancels the browser's focus move; focus the target in the handler:
`main.focus({ preventScroll: true }); main.scrollIntoView();`.

### Focus that goes somewhere after an action
`kbd:focus-lost`, `flow:focus-lost`, `flow:focus-unexpected`, `kbd:popup-focus` (2.4.3).

- Removing the focused element (delete a row, dismiss a banner): focus the next item, else the previous one, else
  the list's heading with `tabindex="-1"`.
- Closing a dialog, menu or popover: focus returns to the control that opened it.
- Single-page navigation: set `document.title`, then focus the new page's `h1` (`tabindex="-1"`) or `main`. A
  focused `main` needs a name: VoiceOver read an unnamed one as just "main", and the focus move cut off SvelteKit's
  title announcement, so the new page went unnamed. `main.setAttribute('aria-labelledby', h1.id)` after each
  navigation makes it "<page heading>, main"; a page without an `h1` removes the attribute.
- A deep link or `#hash` on load: focus the target section.
- A multi-step form's "Next": focus the next step's heading or first field.

### Dialogs
`kbd:modal-escape`, `kbd:popup-focus`, `kbd:popup-escape`, `struct:dialog-not-modal` (2.4.3, 2.1.2, 4.1.2). Prefer the
native element: `showModal()` moves focus in, makes the page behind inert, and closes on Escape.

```js
const opener = document.activeElement;
dialog.showModal();
dialog.addEventListener('close', () => opener.focus(), { once: true });
```

A custom dialog needs `role="dialog"`, `aria-modal="true"`, `aria-labelledby` its title, focus moved inside on open,
Tab and Shift+Tab kept inside (wrap from last to first and back), `inert` on the rest of the page, Escape to close, and
focus returned to the opener.

Record the opener once, when the dialog opens. Code that also runs on later updates records the focused field
instead, and focus is lost when the dialog closes: a Svelte 4 `$:` block that read `document.activeElement` re-ran on
every keystroke in the dialog's field. Keep the open and close logic in a function and call it from a statement that
depends on the open state alone:

```js
function onOpenChange(open) { /* open: remember the opener, focus the field; closed: reset, opener.focus() */ }
$: onOpenChange($dialogOpen);
```

### Menu button
`kbd:popup-*`, `kbd:composite-*`, `hover:hover-only` (2.1.1, 4.1.2). For site navigation a disclosure (a button with
`aria-expanded` showing a list of links) is simpler and what users expect; use the menu pattern for app menus.

```html
<button id="actions" aria-haspopup="menu" aria-expanded="false" aria-controls="actions-menu">Actions</button>
<ul id="actions-menu" role="menu" aria-labelledby="actions" hidden>
	<li role="none"><button role="menuitem" tabindex="-1">Copy link</button></li>
	<li role="none"><button role="menuitem" tabindex="-1">Download</button></li>
</ul>
```

Enter, Space and Down open it on the first item, Up on the last; inside, Up, Down, Home and End move; Escape closes
with focus on the button; Tab closes and moves on; choosing an item closes it. When nested elements both handle the
arrow keys (the button inside a wrapper that walks the menu), the outer handler gets the event after the inner one has
acted, so it skips handled events: `if (event.defaultPrevented) return;`. Otherwise the Down that opened the menu
also moves focus to the second item.

### Tabs
`kbd:composite-unreachable`, `kbd:composite-no-arrows`, `ibm:widget_tabbable_single` (2.1.1). One Tab stop on the
selected tab; Left and Right (Up and Down when `aria-orientation="vertical"`), Home and End move; `aria-selected`,
`aria-controls` and a `role="tabpanel"` with `aria-labelledby`. Selection follows focus unless showing a panel is slow,
then Enter or Space selects (manual activation).

```js
tablist.addEventListener('keydown', (event) => {
	const tabs = [...tablist.querySelectorAll('[role="tab"]')];
	const at = tabs.indexOf(document.activeElement);
	const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
	if (next === undefined) return;
	event.preventDefault();
	select(tabs[(next + tabs.length) % tabs.length]); // sets aria-selected, tabIndex 0/-1, shows the panel, focuses the tab
});
```

Leaving every tab as a Tab stop keeps them reachable (2.1.1 holds) but reviewers flag it as best practice.

### Roving tabindex for long lists and chart marks
`kbd:roving-unreachable`, `ibm:widget_tabbable_exists` (2.1.1). One Tab stop for the set, arrows inside, the current
item remembered:

```js
function roving(container, selector) {
	const items = () => [...container.querySelectorAll(selector)].filter((el) => el.getClientRects().length);
	let current = items()[0];
	const apply = () => {
		for (const el of items()) el.tabIndex = el === current ? 0 : -1;
	};
	container.addEventListener('focusin', (event) => {
		const item = event.target.closest(selector);
		if (item) { current = item; apply(); }
	});
	container.addEventListener('keydown', (event) => {
		const list = items();
		const at = list.indexOf(document.activeElement);
		const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
		if (at < 0 || (step === undefined && event.key !== 'Home' && event.key !== 'End')) return;
		event.preventDefault();
		const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (at + step + list.length) % list.length;
		list[next].focus();
	});
	new MutationObserver(apply).observe(container, { childList: true, subtree: true });
	apply();
}
```

Tell sighted keyboard users the keys while the set has focus ("Up and down arrows move through the list"), and give
the container a name and a description with the same words (`aria-describedby`).

### Combobox and list box
`kbd:composite-unreachable` (2.1.1, 4.1.2). Focus stays in the input; the highlighted option is
`aria-activedescendant`:

```html
<input role="combobox" aria-expanded="false" aria-controls="opts" aria-autocomplete="list" aria-activedescendant="">
<ul id="opts" role="listbox" hidden><li id="o1" role="option" aria-selected="false">North</li>…</ul>
```

Down opens and moves, Up moves back, Enter chooses and closes, Escape closes (a second Escape clears), Tab closes and
moves on. Give the highlighted option a visible ring of 3:1.

### Radio groups and checkboxes
`kbd:composite-no-arrows`, `struct:group-unlabeled` (1.3.1, 2.1.1). Radios share a `name` (that makes them one group
with one Tab stop and arrow keys), inside `<fieldset>` with a `<legend>`. Browsers leave Enter unused on checkboxes
and radios; making Enter check them outside forms is a convenience users ask for.

### Controls built from divs and spans
`kbd:custom-control-keys`, `kbd:no-role`, `kbd:no-name`, `kbd:pointer-only`, `sr:unnamed` (2.1.1, 4.1.2). Replace with
`<button type="button">` or `<a href>`. When the element has to stay:

```js
el.setAttribute('role', 'button');
el.tabIndex = 0;
el.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter' && event.key !== ' ') return;
	event.preventDefault(); // Space would scroll the page
	el.click();
});
```

and expose its state: `aria-pressed` for toggles, `aria-expanded` for disclosures, `aria-checked` for `role="switch"`.
VoiceOver with Safari read an unpressed `aria-pressed` button as "toggle button" with no state and said nothing about
the change when Enter pressed it; when the change matters, a status message also says it ("Selected: …").

### Order
`kbd:order-jump`, `kbd:positive-tabindex`, `struct:css-reorder`, `sr:reading-order-jump`, `kbd:reverse-mismatch`
(1.3.2, 2.4.3). Make the source order the visual order; remove positive `tabindex`; avoid CSS `order`, `row-reverse`
and grid placement that contradict the DOM. Map dots and chart marks read in data order: sort them by position or by
value and say which in the description.

### Keys and pointers that act too early
- `kbd:context-change-on-focus` (3.2.1): open menus and navigate on activation, never on focus.
- `kbd:context-change-on-input` (3.2.2): a select that navigates gets a separate "Go" button, or says what will
  happen before it is changed.
- `kbd:down-event-activation` (2.5.2): act on `click`, not on `mousedown` or `pointerdown`.
- `kbd:single-key-shortcut` (2.1.4): require a modifier, act only while the owning control has focus, or offer a
  setting to turn shortcuts off.

## Screen-reader output

### Names, roles and states
`axe:button-name`, `axe:link-name`, `kbd:no-name`, `sr:unnamed`, `axe:label-content-name-mismatch` (4.1.2, 2.5.3).
Icon-only buttons get `aria-label`; their SVG gets `aria-hidden="true" focusable="false"`. An `aria-label` on a control
with visible text starts with that text, so voice users can say what they see: visible "Menu" with context becomes
`aria-label="Menu, Public Servant Pulse: open site navigation"`. Repeated "Learn more" links and buttons carry their
subject: `aria-label="Learn more: Belonging"`.

### Status messages
`flow:announce-missing`, `flow:live-region-created` (4.1.3). The region exists, empty, from page load; the message is
written into it later. A region created together with its message is often not read.

```html
<p id="status" role="status" class="visually-hidden"></p>
```
```js
function announce(message) {
	status.textContent = '';
	requestAnimationFrame(() => (status.textContent = message)); // the same message twice is read twice
}
```

Errors that need attention now use `role="alert"`. Announce what the user cannot see change: result counts, "Saved",
loading finished, filters applied.

### Form errors
`flow:error-not-associated`, `struct:placeholder-only-label`, `struct:autocomplete-missing` (3.3.1, 3.3.2, 3.3.3,
1.3.5). Each field has a visible `<label>`. On a failed submit: `aria-invalid="true"`, the error in text next to the
field and tied to it, a suggested fix, and focus on the first invalid field (or on an error summary whose links focus
the fields). Fields for the user's own details carry `autocomplete` (`email`, `name`, `tel`, `street-address`).

```html
<label for="email">Email address</label>
<input id="email" type="email" autocomplete="email" aria-invalid="true" aria-describedby="email-error">
<p id="email-error">Enter an email address like name@example.org</p>
```

### Headings, landmarks, language, titles
`struct:heading-skip`, `struct:multiple-h1`, `struct:looks-like-heading`, `axe:region`, `axe:landmark-*`,
`axe:html-has-lang`, `xpage:duplicate-title`, `flow:title-unexpected` (1.3.1, 2.4.2, 2.4.6, 3.1.1, 3.1.2). One `h1`;
levels without gaps; text that looks like a heading is one. `header`, `nav`, `main` and `footer` hold all content; a
second `nav` gets an `aria-label`. `<html lang>` matches the page; passages in another language get their own `lang`.
Every page and every single-page view has its own `document.title`.

### Links
`struct:generic-link-text`, `struct:ambiguous-link-text`, `struct:new-window-unannounced`, `axe:link-in-text-block`
(2.4.4, 3.2.5, 1.4.1). Link text says where it goes; the same text goes to the same place. A link that opens a new
tab says so: `<span class="visually-hidden">(opens in a new tab)</span>` or an icon with that text. Links inside text
are underlined, or differ from the text by 3:1 and gain an underline on hover and focus.

### Images and charts
`axe:image-alt`, `struct:graphic-no-alt`, `struct:image-alt-suspicious`, `sr:repetitive`, `px:svg-text-contrast`
(1.1.1, 1.4.1, 1.4.11). Informative images say what they show; decorative ones get `alt=""`; an image inside a link
with text gets `alt=""` so the name is not read twice. A chart is a `<figure>` with a caption; its SVG has
`role="img"` and an `aria-label` that gives the numbers ("Satisfied 69%, neutral 20%, dissatisfied 11%"), or is
hidden from assistive technology next to a data table with the same numbers. Focusable marks use the roving pattern
above, each named "series: label value"; the tooltip a focused mark opens closes on Escape. Series differ by more than
colour (labels, patterns, position) and each mark reaches 3:1 against the background.

### Media and documents
`media:*`, `doc:*` (1.2.x, 1.4.2, 1.3.1). Video has a captions track and, when the picture carries information the
sound does not, audio description or a described transcript; audio has a transcript; nothing plays sound by itself. A
third-party player loads behind a real button ("Play video: title") and its iframe has a `title`. PDFs are exported
tagged from the source (Word's "Document structure tags for accessibility", InDesign's tagged PDF export) with a title,
a language and alt text on figures, checked with PAC; or the content is published as HTML too.

## Visual

### Contrast
`axe:color-contrast`, `px:text-contrast`, `px:icon-contrast`, `vis:control-border-contrast` (1.4.3, 1.4.11). Text 4.5:1
(3:1 from 24 px, or 18.66 px bold); icons, field borders, focus rings and chart marks 3:1 against what is next to
them. Use the design system's tokens; when no token passes, report the measured ratio and the nearest passing value
and let the team choose. Text over images gets a scrim measured at its lightest point. On white, `#767676` is the
lightest grey that reaches 4.5:1.

### Zoom, reflow and text spacing
`vis:reflow-overflow`, `vis:zoom-overflow`, `vis:zoom-clip`, `vis:text-spacing-clip`, `vis:sticky-cover` (1.4.4,
1.4.10, 1.4.12).

```css
.row > * { min-width: 0; }                      /* flex children may shrink below their content width */
.contact, .url { overflow-wrap: anywhere; }     /* long emails and URLs wrap at 320 px */
img, svg, video { max-width: 100%; height: auto; }
.card { min-height: 12rem; }                    /* min-height, not height: text spacing can grow the box */
@media (max-height: 30rem) { .site-header { position: static; } } /* sticky bars release in a zoomed-in window */
```

Wide tables and charts scroll inside their own box, which is reachable and named:
`<div role="region" aria-label="Scores by region" tabindex="0" style="overflow-x: auto">`.

### Target size
`kbd:target-size` (2.5.8). At least 24 by 24 CSS px, by padding or by a larger hit area
(`.icon-button::before { content: ''; position: absolute; inset: -6px; }`), or spaced so 24 px circles centred on
neighbours do not overlap. Links inside sentences are exempt. Small dots on a map pass when a list or table on the
page offers the same choices at full size (the equivalent exception), or when their size and place carry the
information (essential); say which in the report.

### Content on hover or focus
`hover:not-dismissible`, `hover:not-hoverable`, `hover:not-persistent`, `hover:hover-only` (1.4.13, 2.1.1).

```js
const show = () => (tip.hidden = false);
const hide = () => (tip.hidden = true);
wrapper.addEventListener('mouseenter', show);   // the wrapper holds trigger and tooltip: moving onto the tip keeps it
wrapper.addEventListener('mouseleave', hide);
trigger.addEventListener('focus', show);
trigger.addEventListener('blur', hide);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); }); // without moving focus or pointer
```

The trigger is focusable and points at the tip with `aria-describedby`; nothing hides it on a timer.

### Motion
`motion:auto-moving`, `motion:ignores-reduced-motion`, `motion:smooth-scroll`, `vis:orientation-lock` (2.2.2, 2.3.3,
1.3.4).

```css
@media (prefers-reduced-motion: reduce) {
	*, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```

Carousels, tickers and background video get a visible pause button, stop while hovered or focused, and do not start
by themselves when reduced motion is requested. Layouts work in portrait and landscape; nothing calls
`screen.orientation.lock`.

## Across pages

`xpage:nav-inconsistent`, `xpage:inconsistent-identification`, `xpage:help-inconsistent`, `xpage:multiple-ways` (3.2.3,
3.2.4, 3.2.6, 2.4.5). Shared header and footer components keep navigation in one order and one set of names; help and
contact sit in the same place on every page; every page is reachable from navigation and from search or a site map.
