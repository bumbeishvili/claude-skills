// Rule engines, normalised to the audit's finding shape. Two engines catch more than one: axe-core and IBM Equal
// Access implement many of the same WCAG rules differently, and each finds things the other misses. Chrome's own
// Issues (the DevTools "Issues" panel) add form label and autocomplete problems the browser itself detects.
const fs = require('fs');
const { load, resolveFile } = require('./deps.cjs');
const { scFromAxeTag } = require('./wcag.cjs');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * axe leaves aria-controls on a popup button undecided, since a popup can be built when it opens. When every id the
 * button names is already in the page, the reference is valid and the "needs review" is settled.
 */
async function popupControlsExist(page, rule, node) {
	if (rule.id !== 'aria-valid-attr-value' || node.target.length !== 1 || typeof node.target[0] !== 'string') return false;
	const reasons = [...node.any, ...node.all, ...node.none].map((check) => check.message || '');
	if (!reasons.length || !reasons.every((message) => message.includes('aria-controls'))) return false;
	return page.evaluate((selector) => {
		const ids = (document.querySelector(selector)?.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
		return ids.length > 0 && ids.every((id) => document.getElementById(id));
	}, node.target[0]);
}

/** axe-core on the page. Colour-contrast "incomplete" nodes are returned separately for the pixel check. */
async function runAxe(page, { state, exclude = [] }) {
	const { AxeBuilder } = load('@axe-core/playwright');
	let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
	for (const selector of exclude) builder = builder.exclude(selector);
	const result = await builder.analyze();
	const scOf = (tags) => tags.map(scFromAxeTag).filter(Boolean);
	const toFinding = (rule, node, outcome) => ({
		check: `axe:${rule.id}`,
		sc: scOf(rule.tags),
		bestPractice: !scOf(rule.tags).length,
		severity: rule.impact || node.impact || 'moderate',
		outcome,
		title: rule.help,
		state,
		target: node.target.join(' >>> '),
		selector: node.target.length === 1 && typeof node.target[0] === 'string' ? node.target[0] : null,
		// The rule's own summary first, then the first concrete reason axe gives for this element.
		message: `${rule.help}${(() => {
			const reason = (node.failureSummary || '').split('\n').map((l) => l.trim()).find((l) => l && !/^Fix (any|all) of the following:?$/.test(l));
			return reason ? ` (${reason.slice(0, 180)})` : '';
		})()}`,
		html: node.html.slice(0, 200),
		helpUrl: rule.helpUrl,
		source: 'axe'
	});
	const findings = result.violations.flatMap((rule) => rule.nodes.map((node) => toFinding(rule, node, 'fail')));
	const contrastIncomplete = [];
	for (const rule of result.incomplete) {
		for (const node of rule.nodes) {
			if (rule.id === 'color-contrast') contrastIncomplete.push({ selector: node.target.length === 1 ? node.target[0] : null, target: node.target.join(' >>> '), reason: node.any?.[0]?.message || '' });
			else if (!(await popupControlsExist(page, rule, node))) findings.push(toFinding(rule, node, 'review'));
		}
	}
	// Criteria some rule actually tested here (inapplicable rules found nothing to test).
	const tested = [...result.passes, ...result.violations, ...result.incomplete].flatMap((rule) => scOf(rule.tags));
	return { findings, contrastIncomplete, version: result.testEngine.version, tested: [...new Set(tested)] };
}

let aceSource = null;
// IBM rules whose "potential" results this audit replaces with a measurement, or that are generic reminders
// repeated on every page. Their definite failures (VIOLATION/FAIL) are still reported.
const IBM_POTENTIAL_REPLACED = {
	style_focus_visible: 'the keyboard walk measures every focus indicator in pixels',
	element_tabbable_visible: 'the keyboard walk measures whether each focused control is on screen and visible',
	style_color_misuse: 'colour-only cues are a manual step in the WCAG worksheet (1.4.1)',
	text_sensory_misuse: 'struct:sensory-instruction reports sensory wording with its context',
	frame_src_valid: 'generic reminder; framed content is listed for review in the inventory',
	html_skipnav_exists: 'axe bypass and the keyboard walk cover the skip link',
	aria_keyboard_handler_exists: 'the arrow-key and custom-control probes press the keys and measure what moves',
	widget_tabbable_exists: 'the roving-reach probe presses the arrow keys and lists controls they do not reach',
	element_tabbable_unobscured: 'the keyboard walk checks each focused control for cover at nine points'
};
const IBM_SEVERITY = { 'VIOLATION|FAIL': ['serious', 'fail'], 'VIOLATION|POTENTIAL': ['moderate', 'review'], 'RECOMMENDATION|FAIL': ['minor', 'review'], 'RECOMMENDATION|POTENTIAL': ['minor', 'review'] };

/** IBM Equal Access with its WCAG 2.2 policy, injected into the page (it defines a global `ace`). */
async function runIbm(page, { state }) {
	aceSource = aceSource || fs.readFileSync(resolveFile('accessibility-checker-engine/ace.js'), 'utf8');
	await page.addScriptTag({ content: aceSource });
	const raw = await page.evaluate(async () => {
		const checker = new window.ace.Checker();
		const policy = checker.getGuidelines().find((g) => g.id === 'WCAG_2_2');
		const scByRule = {};
		for (const checkpoint of policy.checkpoints) for (const rule of checkpoint.rules || []) (scByRule[rule.id] = scByRule[rule.id] || []).push(checkpoint.num);
		const report = await checker.check(document, ['WCAG_2_2']);
		const tested = [...new Set(report.results.flatMap((r) => scByRule[r.ruleId] || []))];
		const results = report.results
			.filter((r) => r.value[1] === 'FAIL' || r.value[1] === 'POTENTIAL')
			.filter((r) => r.value[0] !== 'INFORMATION')
			.map((r) => ({ ruleId: r.ruleId, value: r.value, message: r.message, xpath: r.path?.dom, snippet: (r.snippet || '').slice(0, 200), sc: scByRule[r.ruleId] || [] }));
		return { results, tested };
	});
	const replaced = (r) => r.value[1] === 'POTENTIAL' && (IBM_POTENTIAL_REPLACED[r.ruleId] || (r.ruleId === 'input_label_visible' && /^<button/i.test(r.snippet)));
	const findings = raw.results
		.filter((r) => IBM_SEVERITY[r.value.join('|')] && !replaced(r))
		.map((r) => {
			const [severity, outcome] = IBM_SEVERITY[r.value.join('|')];
			return { check: `ibm:${r.ruleId}`, sc: r.sc, bestPractice: r.value[0] === 'RECOMMENDATION' || !r.sc.length, severity, outcome, title: r.message, state, target: r.xpath, xpath: r.xpath, message: r.message, html: r.snippet, source: 'ibm' };
		});
	return { findings, tested: raw.tested };
}

// Chrome DevTools issue types that concern accessibility, with the criteria they bear on.
const CHROME_ISSUES = {
	FormLabelForNameError: ['1.3.1', '4.1.2'],
	FormDuplicateIdForInputError: ['1.3.1', '4.1.2'],
	FormInputWithNoLabelError: ['1.3.1', '4.1.2'],
	FormLabelForMatchesNonExistingIdError: ['1.3.1', '4.1.2'],
	FormLabelHasNeitherForNorNestedInput: ['1.3.1', '4.1.2'],
	FormAriaLabelledByToNonExistingId: ['1.3.1', '4.1.2'],
	FormAutocompleteAttributeEmptyError: ['1.3.5'],
	FormInputHasWrongButWellIntendedAutocompleteValueError: ['1.3.5'],
	FormInputAssignedAutocompleteValueToIdOrNameAttributeError: ['1.3.5'],
	FormEmptyIdAndNameAttributesForInputError: ['1.3.1']
};

/** Starts collecting Chrome's Issues for a page; call before navigation. Chromium only. */
async function watchChromeIssues(context, page) {
	const cdp = await context.newCDPSession(page);
	const issues = [];
	cdp.on('Audits.issueAdded', ({ issue }) => issues.push(issue));
	await cdp.send('Audits.enable');
	return {
		async findings(state) {
			const out = [];
			for (const issue of issues) {
				const details = issue.details?.genericIssueDetails;
				if (issue.code !== 'GenericIssue' || !details || !CHROME_ISSUES[details.errorType]) continue;
				let target = null;
				if (details.violatingNodeId) {
					// The node can be gone by the time the issues are read (re-rendered); say so instead of guessing.
					const resolved = await cdp.send('DOM.resolveNode', { backendNodeId: details.violatingNodeId }).catch(() => null);
					if (resolved?.object?.objectId) {
						const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: resolved.object.objectId, functionDeclaration: 'function () { return window.__a11y.cssPath(this); }', returnByValue: true });
						target = result.value;
					} else target = '(element removed before the audit read the issue)';
				}
				out.push({ check: `chrome:${details.errorType}`, sc: CHROME_ISSUES[details.errorType], severity: 'moderate', outcome: 'fail', title: `Chrome Issues: ${details.errorType}`, state, target, node: target, message: `Chrome reports ${details.errorType}${details.violatingNodeAttribute ? ` on attribute ${details.violatingNodeAttribute}` : ''}`, source: 'chrome' });
			}
			return out;
		}
	};
}

module.exports = { runAxe, runIbm, watchChromeIssues, AXE_TAGS, IBM_POTENTIAL_REPLACED };
