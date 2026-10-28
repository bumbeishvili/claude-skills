// The audit's own checks: one entry per check id, naming the WCAG 2.2 success criteria it gives evidence for, its
// default severity, and whether a hit is a failure or something a person has to look at ("review"). Engine results
// (axe, IBM Equal Access, Chrome's Issues) carry their own criteria and come in through engines.cjs.
//
// Severity follows axe's scale: critical blocks a task outright for some users, serious makes it very hard,
// moderate makes it harder, minor is friction. "BP" marks best practice beyond WCAG A/AA that reviewers still flag.

const CHECKS = {
	// Keyboard and focus (kbd:)
	'kbd:focus-not-visible': { sc: ['2.4.7'], severity: 'serious', outcome: 'fail', title: 'No visible change when the control takes keyboard focus' },
	'kbd:focus-low-contrast': { sc: ['2.4.7', '1.4.11'], severity: 'serious', outcome: 'fail', title: 'Focus indicator below 3:1 against the unfocused state' },
	'kbd:focus-obscured': { sc: ['2.4.11'], severity: 'serious', outcome: 'fail', title: 'Focused control entirely hidden by other content' },
	'kbd:focus-partly-obscured': { sc: ['2.4.11'], severity: 'minor', outcome: 'review', title: 'Focused control partly hidden by other content' },
	'kbd:focus-offscreen': { sc: ['2.4.7'], severity: 'serious', outcome: 'fail', title: 'Focus lands on something outside the window' },
	'kbd:trap': { sc: ['2.1.2'], severity: 'critical', outcome: 'fail', title: 'Tab cannot move focus off this control' },
	'kbd:focus-loop': { sc: ['2.1.2'], severity: 'critical', outcome: 'fail', title: 'Tab cycles inside part of the page while no modal dialog is open' },
	'kbd:focus-lost': { sc: ['2.4.3'], severity: 'serious', outcome: 'fail', title: 'Focus dropped to the page body in the middle of the Tab order' },
	'kbd:modal-escape': { sc: ['2.4.3'], severity: 'serious', outcome: 'fail', title: 'Tab leaves an open modal dialog for the page behind it' },
	'kbd:unreachable': { sc: ['2.1.1'], severity: 'serious', outcome: 'fail', title: 'Visible control never reached by Tab' },
	'kbd:pointer-only': { sc: ['2.1.1', '4.1.2'], severity: 'serious', outcome: 'review', title: 'Clickable element that is not keyboard focusable' },
	'kbd:positive-tabindex': { sc: ['2.4.3'], severity: 'moderate', outcome: 'review', title: 'Positive tabindex reorders focus away from the reading order' },
	'kbd:order-jump': { sc: ['2.4.3', '1.3.2'], severity: 'moderate', outcome: 'review', title: 'Focus moves backwards against the visual order' },
	'kbd:reverse-mismatch': { sc: ['2.4.3'], severity: 'moderate', outcome: 'review', title: 'Shift+Tab does not retrace the Tab order' },
	'kbd:no-name': { sc: ['4.1.2'], severity: 'serious', outcome: 'fail', title: 'Focusable control with no accessible name' },
	'kbd:no-role': { sc: ['4.1.2'], severity: 'serious', outcome: 'fail', title: 'Focusable element with no role a screen reader can announce' },
	'kbd:target-size': { sc: ['2.5.8'], severity: 'moderate', outcome: 'fail', title: 'Pointer target under 24 by 24 CSS px without the spacing exception' },
	'kbd:context-change-on-focus': { sc: ['3.2.1'], severity: 'serious', outcome: 'fail', title: 'Focusing the control opened a window or moved the page' },
	'kbd:context-change-on-input': { sc: ['3.2.2'], severity: 'serious', outcome: 'fail', title: 'Changing the value opened a window or moved the page without warning' },
	'kbd:down-event-activation': { sc: ['2.5.2'], severity: 'moderate', outcome: 'review', title: 'Acts on pointer press rather than release' },
	'kbd:single-key-shortcut': { sc: ['2.1.4'], severity: 'moderate', outcome: 'review', title: 'A single printable key triggers an action' },
	'kbd:composite-unreachable': { sc: ['2.1.1'], severity: 'serious', outcome: 'fail', title: 'Items of a tab list, menu, list box, radio group, tree or grid that the keyboard cannot reach' },
	'kbd:composite-no-arrows': { sc: ['2.1.1'], severity: 'minor', outcome: 'review', title: 'Arrow keys do nothing in a tab list, menu, list box or radio group whose items are all Tab stops (BP)' },
	'kbd:roving-unreachable': { sc: ['2.1.1'], severity: 'serious', outcome: 'review', title: 'Controls taken out of the Tab order (tabindex -1) that arrow keys do not reach either' },
	'kbd:popup-escape': { sc: ['2.1.1'], severity: 'moderate', outcome: 'review', title: 'Escape does not close an open menu, list box or dialog' },
	'kbd:popup-focus': { sc: ['2.4.3'], severity: 'serious', outcome: 'fail', title: 'Focus not moved into an opened dialog, or not returned to its button when it closes' },
	'kbd:skip-link': { sc: ['2.4.1'], severity: 'serious', outcome: 'fail', title: 'Skip link that does not move keyboard focus past the repeated content' },
	'kbd:no-skip-link': { sc: ['2.4.1'], severity: 'minor', outcome: 'review', title: 'Many Tab stops before the main content and no skip link (BP)' },
	'kbd:custom-control-keys': { sc: ['2.1.1'], severity: 'serious', outcome: 'fail', title: 'Custom control that Enter or Space does not operate' },

	// Structure and semantics (struct:)
	'struct:heading-skip': { sc: ['1.3.1'], severity: 'moderate', outcome: 'review', title: 'Heading level skipped' },
	'struct:multiple-h1': { sc: ['1.3.1'], severity: 'minor', outcome: 'review', title: 'More than one level-1 heading' },
	'struct:looks-like-heading': { sc: ['1.3.1'], severity: 'moderate', outcome: 'review', title: 'Text styled as a heading but not marked up as one' },
	'struct:generic-link-text': { sc: ['2.4.4'], severity: 'moderate', outcome: 'review', title: 'Link text that does not say where it goes' },
	'struct:ambiguous-link-text': { sc: ['2.4.4'], severity: 'moderate', outcome: 'review', title: 'Same link text, different destinations' },
	'struct:new-window-unannounced': { sc: ['3.2.5'], severity: 'minor', outcome: 'review', title: 'Opens a new window or tab without saying so (BP)' },
	'struct:fake-list': { sc: ['1.3.1'], severity: 'moderate', outcome: 'review', title: 'A list drawn with characters instead of list markup' },
	'struct:sensory-instruction': { sc: ['1.3.3'], severity: 'moderate', outcome: 'review', title: 'Instruction that relies on colour, shape or position' },
	'struct:table-no-headers': { sc: ['1.3.1'], severity: 'serious', outcome: 'fail', title: 'Data table without header cells' },
	'struct:graphic-no-alt': { sc: ['1.1.1'], severity: 'serious', outcome: 'review', title: 'Chart or illustration with no text alternative and not hidden' },
	'struct:image-alt-suspicious': { sc: ['1.1.1'], severity: 'moderate', outcome: 'review', title: 'Alt text that looks like a file name or placeholder' },
	'struct:placeholder-only-label': { sc: ['3.3.2', '1.3.1'], severity: 'serious', outcome: 'fail', title: 'Field labelled only by its placeholder' },
	'struct:autocomplete-missing': { sc: ['1.3.5'], severity: 'moderate', outcome: 'fail', title: 'Personal-data field without an autocomplete purpose' },
	'struct:group-unlabeled': { sc: ['1.3.1'], severity: 'moderate', outcome: 'review', title: 'Radio or checkbox group without a group label' },
	'struct:css-reorder': { sc: ['1.3.2', '2.4.3'], severity: 'moderate', outcome: 'review', title: 'CSS reorders focusable content away from the source order' },
	'struct:dialog-not-modal': { sc: ['2.4.3', '4.1.2'], severity: 'moderate', outcome: 'review', title: 'Open dialog without aria-modal; content behind stays reachable' },

	// Media (media:)
	'media:autoplay-audio': { sc: ['1.4.2'], severity: 'serious', outcome: 'fail', title: 'Media autoplays with sound' },
	'media:captions-missing': { sc: ['1.2.2'], severity: 'serious', outcome: 'review', title: 'Video without a captions track' },
	'media:audio-transcript': { sc: ['1.2.1'], severity: 'serious', outcome: 'review', title: 'Audio without a transcript nearby' },
	'media:embedded-video': { sc: ['1.2.2', '1.2.5'], severity: 'moderate', outcome: 'review', title: 'Embedded third-party video: confirm captions and audio description' },

	// Pixel-measured contrast (px:)
	'px:text-contrast': { sc: ['1.4.3'], severity: 'serious', outcome: 'fail', title: 'Text below the contrast minimum against what is drawn behind it' },
	'px:svg-text-contrast': { sc: ['1.4.3'], severity: 'serious', outcome: 'fail', title: 'SVG text below the contrast minimum' },
	'px:icon-contrast': { sc: ['1.4.11'], severity: 'moderate', outcome: 'review', title: 'Icon below 3:1 against its background' },

	// Visual adaptation (vis:)
	'vis:control-border-contrast': { sc: ['1.4.11'], severity: 'moderate', outcome: 'fail', title: 'Form control boundary below 3:1' },
	'vis:reflow-overflow': { sc: ['1.4.10'], severity: 'serious', outcome: 'fail', title: 'Content scrolls sideways at 320 CSS px wide' },
	'vis:zoom-overflow': { sc: ['1.4.4'], severity: 'serious', outcome: 'fail', title: 'Content scrolls sideways at 200% zoom' },
	'vis:zoom-clip': { sc: ['1.4.4'], severity: 'moderate', outcome: 'review', title: 'Text clipped at 200% zoom' },
	'vis:text-spacing-clip': { sc: ['1.4.12'], severity: 'moderate', outcome: 'fail', title: 'Text clipped when the WCAG text spacing is applied' },
	'vis:sticky-cover': { sc: ['1.4.10', '2.4.11'], severity: 'moderate', outcome: 'review', title: 'Fixed and sticky bars cover most of a zoomed-in window' },
	'vis:orientation-lock': { sc: ['1.3.4'], severity: 'serious', outcome: 'review', title: 'Content locked to one orientation' },

	// Motion (motion:)
	'motion:auto-moving': { sc: ['2.2.2'], severity: 'serious', outcome: 'review', title: 'Content moves or updates on its own for more than 5 seconds' },
	'motion:ignores-reduced-motion': { sc: ['2.3.3'], severity: 'minor', outcome: 'review', title: 'Animation keeps running with reduced motion requested (BP)' },
	'motion:smooth-scroll': { sc: ['2.3.3'], severity: 'minor', outcome: 'review', title: 'Smooth scrolling with reduced motion requested (BP)' },

	// Content on hover or focus (hover:)
	'hover:not-dismissible': { sc: ['1.4.13'], severity: 'moderate', outcome: 'fail', title: 'Hover content that Escape does not dismiss' },
	'hover:not-hoverable': { sc: ['1.4.13'], severity: 'moderate', outcome: 'fail', title: 'Hover content that disappears when the pointer moves onto it' },
	'hover:not-persistent': { sc: ['1.4.13'], severity: 'moderate', outcome: 'review', title: 'Hover content that disappears on its own' },
	'hover:hover-only': { sc: ['2.1.1'], severity: 'serious', outcome: 'fail', title: 'Information shown on hover but not on keyboard focus' },

	// Virtual screen reader transcript (sr:)
	'sr:unnamed': { sc: ['4.1.2', '1.1.1'], severity: 'serious', outcome: 'fail', title: 'Screen reader announces a role with no name' },
	'sr:repetitive': { sc: ['2.4.4', '2.4.6'], severity: 'minor', outcome: 'review', title: 'The same announcement repeats many times in a row' },
	'sr:reading-order-jump': { sc: ['1.3.2'], severity: 'moderate', outcome: 'review', title: 'Reading order jumps backwards against the layout' },

	// Scripted flows (flow:)
	'flow:focus-lost': { sc: ['2.4.3'], severity: 'serious', outcome: 'fail', title: 'Focus dropped to the page body after an action' },
	'flow:focus-unexpected': { sc: ['2.4.3'], severity: 'moderate', outcome: 'fail', title: 'Focus did not go where the flow expects' },
	'flow:announce-missing': { sc: ['4.1.3'], severity: 'serious', outcome: 'fail', title: 'Status change not announced to screen readers' },
	'flow:live-region-created': { sc: ['4.1.3'], severity: 'moderate', outcome: 'review', title: 'Live region created together with its message (often not read)' },
	'flow:error-not-associated': { sc: ['3.3.1', '1.3.1'], severity: 'serious', outcome: 'fail', title: 'Field error not tied to its field' },
	'flow:title-unexpected': { sc: ['2.4.2'], severity: 'moderate', outcome: 'fail', title: 'Page title not what the flow expects after a step (single-page navigation)' },

	// Across pages (xpage:)
	'xpage:nav-inconsistent': { sc: ['3.2.3'], severity: 'moderate', outcome: 'review', title: 'Repeated navigation in a different order on another page' },
	'xpage:inconsistent-identification': { sc: ['3.2.4'], severity: 'moderate', outcome: 'review', title: 'Same destination named differently across pages' },
	'xpage:help-inconsistent': { sc: ['3.2.6'], severity: 'moderate', outcome: 'review', title: 'Help or contact link missing or moved on some pages' },
	'xpage:duplicate-title': { sc: ['2.4.2'], severity: 'moderate', outcome: 'review', title: 'Different pages share a title' },
	'xpage:multiple-ways': { sc: ['2.4.5'], severity: 'moderate', outcome: 'review', title: 'Only one way found to reach pages' },

	// Linked documents (doc:)
	'doc:pdf-untagged': { sc: ['1.3.1', '1.1.1'], severity: 'serious', outcome: 'fail', title: 'Linked PDF has no tags' },
	'doc:pdf-no-title': { sc: ['2.4.2'], severity: 'minor', outcome: 'fail', title: 'Linked PDF has no document title' },
	'doc:pdf-no-lang': { sc: ['3.1.1'], severity: 'moderate', outcome: 'fail', title: 'Linked PDF has no document language' },
	'doc:pdf-structure-errors': { sc: ['1.3.1'], severity: 'moderate', outcome: 'review', title: 'Linked PDF structure tree has errors' },
	'doc:office-document': { sc: ['1.3.1'], severity: 'moderate', outcome: 'review', title: 'Linked Office document: check it in its own application' }
};

const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];

/** A finding from one of the audit's own checks. `fields` carries state, target, name, message and evidence. */
function finding(check, fields) {
	const meta = CHECKS[check];
	if (!meta) throw new Error(`finding: unknown check "${check}" (add it to lib/checks.cjs)`);
	return { check, sc: meta.sc, severity: meta.severity, outcome: meta.outcome, title: meta.title, ...fields };
}

module.exports = { CHECKS, SEVERITY_ORDER, finding };
