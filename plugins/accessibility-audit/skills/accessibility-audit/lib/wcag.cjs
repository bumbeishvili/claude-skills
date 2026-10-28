// WCAG 2.2 success criteria at levels A and AA (55; 4.1.1 Parsing was removed in 2.2), plus the AAA criteria some
// best-practice checks point to. `manual` is what a person still confirms in the headed pass, because no script
// decides it; `common` is how sites usually fail it. The report's conformance table and wcag-checklist.md are both
// generated from this list:  node lib/wcag.cjs --markdown > wcag-checklist.md

const CRITERIA = [
	{ sc: '1.1.1', name: 'Non-text Content', level: 'A', manual: 'Read every image alt and chart alternative in the report inventory: informative images say what they show, decorative ones are hidden, charts carry their numbers in text.', common: 'Charts with no text alternative; icons without names; alt that repeats the file name.' },
	{ sc: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A', manual: 'For each audio-only or silent video, find a transcript or text description that gives the same information.', common: 'Podcast embeds and silent product loops with no text version.' },
	{ sc: '1.2.2', name: 'Captions (Prerecorded)', level: 'A', manual: 'Play each video with sound and confirm synchronised captions exist, are accurate and identify speakers.', common: 'Auto-captions never reviewed; third-party embeds with captions turned off.' },
	{ sc: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', manual: 'Watch each video with the sound on and eyes closed: is anything visual and necessary left undescribed?', common: 'On-screen text and charts in videos never spoken.' },
	{ sc: '1.2.4', name: 'Captions (Live)', level: 'AA', manual: 'Live streams only: confirm live captions are provided.', common: 'Webinar embeds without live captioning.' },
	{ sc: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA', manual: 'For each video, confirm an audio-described version or that the narration already describes all key visuals.', common: 'Explainer videos that show data without saying it.' },
	{ sc: '1.3.1', name: 'Info and Relationships', level: 'A', manual: 'Check that what looks like a heading, list, table, group or label is marked up as one (heading and landmark outline in the report).', common: 'Styled divs as headings; tables without headers; radio groups without a legend.' },
	{ sc: '1.3.2', name: 'Meaningful Sequence', level: 'A', manual: 'Compare the virtual screen reader transcript with the page layout: content is read in an order that makes sense.', common: 'CSS order, absolute positioning or grid placement that puts the reading order out of step.' },
	{ sc: '1.3.3', name: 'Sensory Characteristics', level: 'A', manual: 'Read instructions: none rely only on shape, colour, size, position or sound ("the green button", "on the right").', common: 'Chart legends and help text that name colours only.' },
	{ sc: '1.3.4', name: 'Orientation', level: 'AA', manual: 'Rotate a phone, or use the landscape screenshot: content and functions work in both orientations.', common: 'A "rotate your device" overlay; layouts that hide content in landscape.' },
	{ sc: '1.3.5', name: 'Identify Input Purpose', level: 'AA', manual: 'Fields that collect the user\'s own details (name, email, phone, address) carry the right autocomplete value.', common: 'Newsletter email fields without autocomplete="email".' },
	{ sc: '1.4.1', name: 'Use of Color', level: 'A', manual: 'Check charts, links and states: colour is never the only cue (a pattern, label, underline or icon also carries it).', common: 'Chart series told apart by colour alone; links in text with no underline.' },
	{ sc: '1.4.2', name: 'Audio Control', level: 'A', manual: 'Load each page with sound on: nothing plays sound for more than 3 seconds without a pause or volume control.', common: 'Autoplaying hero videos with sound.' },
	{ sc: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', manual: 'Look at text over images, gradients and video, and text in charts, where tools cannot always compute contrast.', common: 'Light grey helper text; white labels on mid-tone chart colours; text over photos.' },
	{ sc: '1.4.4', name: 'Resize Text', level: 'AA', manual: 'Zoom the browser to 200%: all text grows, nothing is cut off or overlaps, every function still works.', common: 'Fixed-height boxes that clip text; text in images.' },
	{ sc: '1.4.5', name: 'Images of Text', level: 'AA', manual: 'Find text shown as images (banners, chart titles, screenshots of tables) and confirm it is real text or essential.', common: 'Infographics exported as one image.' },
	{ sc: '1.4.10', name: 'Reflow', level: 'AA', manual: 'At 320 CSS px wide (400% zoom), read and use every part of the page without scrolling sideways, except data tables, maps and diagrams.', common: 'Wide tables and charts that push the whole page sideways; sticky bars that fill the window.' },
	{ sc: '1.4.11', name: 'Non-text Contrast', level: 'AA', manual: 'Check icons, form field borders, focus rings, chart marks and the parts of controls needed to see their state: 3:1 against neighbours.', common: 'Pale input borders; thin light focus rings; adjacent chart segments of similar colour.' },
	{ sc: '1.4.12', name: 'Text Spacing', level: 'AA', manual: 'Look at the text-spacing screenshots: no text is cut off or overlaps after the spacing override.', common: 'Buttons and cards with fixed heights.' },
	{ sc: '1.4.13', name: 'Content on Hover or Focus', level: 'AA', manual: 'For each tooltip, popover and chart hover card: Escape dismisses it, the pointer can move onto it, and it stays until dismissed.', common: 'Chart tooltips that vanish when the pointer moves toward them.' },
	{ sc: '2.1.1', name: 'Keyboard', level: 'A', manual: 'Complete every task with the keyboard alone, including charts, carousels, menus, drag-and-drop alternatives and custom widgets.', common: 'Click-only divs; chart data reachable only by hover; custom selects without key handling.' },
	{ sc: '2.1.2', name: 'No Keyboard Trap', level: 'A', manual: 'Tab into and out of every widget, embed and dialog; any non-standard way out is explained.', common: 'Embedded players and editors that keep Tab.' },
	{ sc: '2.1.4', name: 'Character Key Shortcuts', level: 'A', manual: 'If single-key shortcuts exist, they can be turned off or remapped, or act only while their control has focus.', common: 'Search on "/" or "s" that fires while typing in another field.' },
	{ sc: '2.2.1', name: 'Timing Adjustable', level: 'A', manual: 'Find time limits (session timeouts, auto-dismissing messages, timed quizzes): the user can turn off, adjust or extend them.', common: 'Toasts that vanish in 3 seconds; silent session expiry.' },
	{ sc: '2.2.2', name: 'Pause, Stop, Hide', level: 'A', manual: 'Anything that moves, blinks, scrolls or auto-updates for more than 5 seconds can be paused, stopped or hidden.', common: 'Auto-advancing carousels; looping background video; live tickers.' },
	{ sc: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A', manual: 'Watch animations and videos: nothing flashes more than three times in any second.', common: 'Strobing transitions in video.' },
	{ sc: '2.4.1', name: 'Bypass Blocks', level: 'A', manual: 'A skip link is the first Tab stop and moves focus past the header; landmarks and headings let a screen reader jump.', common: 'Skip links that scroll but leave focus in the header.' },
	{ sc: '2.4.2', name: 'Page Titled', level: 'A', manual: 'Each page title, including after in-app navigation, says what the page is.', common: 'Single-page apps that never update the title.' },
	{ sc: '2.4.3', name: 'Focus Order', level: 'A', manual: 'Watch the headed walk and the focus order map: focus moves in an order that matches the meaning, and returns sensibly after dialogs and route changes.', common: 'Focus left on a removed element; dialogs that do not return focus; route changes that leave focus in the header.' },
	{ sc: '2.4.4', name: 'Link Purpose (In Context)', level: 'A', manual: 'Each link says where it goes, by its text or with its sentence, list item, cell or heading.', common: 'Rows of "Learn more"; "click here".' },
	{ sc: '2.4.5', name: 'Multiple Ways', level: 'AA', manual: 'Every page is reachable more than one way: navigation, search, site map, related links.', common: 'Pages linked only from one card.' },
	{ sc: '2.4.6', name: 'Headings and Labels', level: 'AA', manual: 'Headings and labels describe their topic or purpose (read the heading outline on its own).', common: 'Generic headings such as "Overview" repeated in every section.' },
	{ sc: '2.4.7', name: 'Focus Visible', level: 'AA', manual: 'Watch the headed walk: every stop shows a clear focus indicator.', common: 'outline: none without a replacement; rings hidden by overflow: hidden.' },
	{ sc: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA', manual: 'Watch the headed walk, also at 200% zoom: no focused control is entirely hidden by sticky headers, footers, cookie banners or chat widgets.', common: 'Sticky headers and cookie banners covering the focused link.' },
	{ sc: '2.5.1', name: 'Pointer Gestures', level: 'A', manual: 'Any multi-point or path-based gesture (pinch, swipe, draw) has a single-pointer alternative such as buttons.', common: 'Carousels and maps that need a swipe or pinch.' },
	{ sc: '2.5.2', name: 'Pointer Cancellation', level: 'A', manual: 'Press a control, move the pointer off it, release: nothing should happen (or the action is undoable).', common: 'Custom buttons acting on mousedown.' },
	{ sc: '2.5.3', name: 'Label in Name', level: 'A', manual: 'For controls with visible text, the accessible name starts with or contains that text, so speech users can say it.', common: 'aria-label that replaces the visible label with different words.' },
	{ sc: '2.5.4', name: 'Motion Actuation', level: 'A', manual: 'Nothing is operated by shaking or tilting the device, or there is a control alternative and motion can be turned off.', common: 'Shake-to-undo without a button.' },
	{ sc: '2.5.7', name: 'Dragging Movements', level: 'AA', manual: 'Every drag (sliders, sortable lists, map panning, range brushes) has a single-pointer alternative such as clicks or buttons.', common: 'Range sliders and sortable lists that only drag.' },
	{ sc: '2.5.8', name: 'Target Size (Minimum)', level: 'AA', manual: 'Small targets the script flagged: confirm none is essential at that size and none crowds another.', common: 'Tiny close buttons, chip remove icons, pagination dots.' },
	{ sc: '3.1.1', name: 'Language of Page', level: 'A', manual: 'The html lang matches the page language.', common: 'Missing lang on app shells.' },
	{ sc: '3.1.2', name: 'Language of Parts', level: 'AA', manual: 'Passages in another language carry their own lang attribute.', common: 'Quotes and names in another language read with the wrong pronunciation.' },
	{ sc: '3.2.1', name: 'On Focus', level: 'A', manual: 'Tab through every control: focus alone never opens a window, submits, or moves the page.', common: 'Menus that navigate on focus.' },
	{ sc: '3.2.2', name: 'On Input', level: 'A', manual: 'Changing a field, checkbox or select does not move to a new page or window without warning.', common: 'Select menus that navigate on change.' },
	{ sc: '3.2.3', name: 'Consistent Navigation', level: 'AA', manual: 'Repeated navigation appears in the same relative order on every page.', common: 'Section pages that reorder or drop header links.' },
	{ sc: '3.2.4', name: 'Consistent Identification', level: 'AA', manual: 'The same function has the same name everywhere (icons, buttons, links to the same place).', common: 'One page says "Search", another "Find".' },
	{ sc: '3.2.6', name: 'Consistent Help', level: 'A', manual: 'Help (contact details, help page, chat) is in the same relative place on every page that has it.', common: 'Contact link only on some pages.' },
	{ sc: '3.3.1', name: 'Error Identification', level: 'A', manual: 'Submit each form with mistakes: the field in error is identified and the error described in text, and announced.', common: 'Red borders only; errors not tied to their field.' },
	{ sc: '3.3.2', name: 'Labels or Instructions', level: 'A', manual: 'Every field has a visible label or instruction, and required fields and formats are stated.', common: 'Placeholder-only fields.' },
	{ sc: '3.3.3', name: 'Error Suggestion', level: 'AA', manual: 'When an error has a known fix, the message suggests it ("Enter a date like 31/12/2026").', common: '"Invalid input" with no hint.' },
	{ sc: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA', manual: 'Submissions with legal, financial or data-changing effects can be reviewed, corrected or reversed.', common: 'One-click deletes without confirmation.' },
	{ sc: '3.3.7', name: 'Redundant Entry', level: 'A', manual: 'Multi-step forms do not ask again for information already given in the same process.', common: 'Re-entering an address on a later step.' },
	{ sc: '3.3.8', name: 'Accessible Authentication (Minimum)', level: 'AA', manual: 'Sign-in needs no memory or puzzle test without an alternative: paste and password managers work, CAPTCHAs have an accessible option.', common: 'Password fields that block paste; image CAPTCHAs.' },
	{ sc: '4.1.2', name: 'Name, Role, Value', level: 'A', manual: 'Custom widgets announce their name, role and state, and state changes are announced (headed walk transcript).', common: 'Toggle buttons without aria-pressed or aria-expanded; div buttons.' },
	{ sc: '4.1.3', name: 'Status Messages', level: 'AA', manual: 'Messages that appear without a focus move (results counts, saved, errors, loading) are announced: see the flow announcements.', common: 'Filter result counts that update silently.' },
	// Beyond AA, named because some best-practice checks point at them.
	{ sc: '2.3.3', name: 'Animation from Interactions', level: 'AAA', manual: 'With reduced motion requested, motion triggered by interaction can be turned off.', common: 'Parallax and scroll animations that ignore prefers-reduced-motion.' },
	{ sc: '3.2.5', name: 'Change on Request', level: 'AAA', manual: 'New windows open only on request, and links say when they open one.', common: 'target="_blank" without warning.' }
];

const BY_SC = new Map(CRITERIA.map((c) => [c.sc, c]));

/** The criterion for a number, or a stand-in for one outside this list (for example 4.1.1, removed in WCAG 2.2). */
function criterion(sc) {
	return BY_SC.get(sc) || { sc, name: sc === '4.1.1' ? 'Parsing (removed in WCAG 2.2)' : 'Not in the WCAG 2.2 A/AA list', level: '?', manual: '', common: '' };
}

/** "wcag143" (axe tag) → "1.4.3". Returns null for tags that are not success criteria. */
function scFromAxeTag(tag) {
	const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
	return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

function markdown() {
	const rows = CRITERIA.map((c) => `| ${c.sc} | ${c.name} | ${c.level} | ${c.manual} | ${c.common} |`);
	return [
		'# WCAG 2.2 checklist',
		'',
		'Generated from `lib/wcag.cjs` (`node lib/wcag.cjs --markdown > wcag-checklist.md`); edit that file, not this one. Which audit checks give evidence for each criterion is in the report\'s conformance table, computed from `lib/checks.cjs` and the engines\' rule tags.',
		'',
		'| SC | Criterion | Level | What a person confirms | How sites usually fail it |',
		'|---|---|---|---|---|',
		...rows,
		''
	].join('\n');
}

if (require.main === module && process.argv.includes('--markdown')) process.stdout.write(markdown());

module.exports = { CRITERIA, criterion, scFromAxeTag };
