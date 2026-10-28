// Scripted user tasks: each step does something a user does (keys, clicks, typing) and states what should follow:
// where focus lands, what a screen reader is told, which field is marked in error. After every step the runner
// records the focused element (role and name), the live-region announcements and the URL, so the flow doubles as
// a transcript of the task for the report. See templates/audit.config.example.cjs for the step format.
const { finding } = require('./checks.cjs');
const { settle, parseSnapshotLine } = require('./keyboard.cjs');

const matches = (pattern, text) => (pattern instanceof RegExp ? pattern.test(text) : text.includes(String(pattern)));

async function focused(page) {
	const info = await page.evaluate(() => {
		let el = document.activeElement;
		while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
		if (!el || el === document.body || el === document.documentElement) return { body: true };
		return { body: false, path: window.__a11y.cssPath(el), describe: window.__a11y.describe(el), frame: el.localName === 'iframe' ? el.getAttribute('title') || '' : null };
	});
	if (info.body) return { ...info, role: null, name: '', line: '<body>' };
	// Focus inside a frame leaves the <iframe> as the active element, which :focus does not match from outside.
	if (info.frame !== null) return { ...info, role: 'iframe', name: info.frame, states: [], line: `- iframe "${info.frame}" (focus inside the frame)` };
	const snapshot = await page.locator(':focus').last().ariaSnapshot({ timeout: 3000 });
	return { ...info, ...parseSnapshotLine(snapshot) };
}

/** Helpers a flow step receives as `a11y`. */
function helpers(page) {
	return {
		/** Presses Tab until the focused element's snapshot ("button "Save"") or path matches; returns the presses. */
		async tabTo(pattern, { max = 200, reverse = false } = {}) {
			for (let presses = 0; presses <= max; presses++) {
				const now = await focused(page);
				if (!now.body && (matches(pattern, now.line) || matches(pattern, now.path))) return presses;
				await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
				await settle(page);
			}
			throw new Error(`tabTo: nothing matching ${pattern} within ${max} Tab presses (focus is on ${(await focused(page)).line})`);
		},
		focused: () => focused(page),
		announcements: () => page.evaluate(() => window.__a11y.drainAnnouncements())
	};
}

async function checkFieldError(page, selector) {
	return page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) return { missing: true };
		const ids = [el.getAttribute('aria-describedby'), el.getAttribute('aria-errormessage')].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
		const messages = ids.map((id) => document.getElementById(id)).filter((m) => m && window.__a11y.isRendered(m)).map((m) => window.__a11y.text(m)).filter(Boolean);
		return { missing: false, invalid: el.getAttribute('aria-invalid') === 'true', messages, describe: window.__a11y.describe(el), path: window.__a11y.cssPath(el) };
	}, selector);
}

/**
 * Runs one flow on a ready page. Returns { findings, transcript }. A step that throws stops the flow and is
 * reported with its error, since the remaining steps depend on it. `onStep({ phase: 'before' | 'after', index,
 * label, row })` is awaited around every step; the headed review uses it to show and say each step.
 */
async function runFlow(page, flow, { onStep = null } = {}) {
	const findings = [];
	const transcript = [];
	const a11y = helpers(page);
	await page.evaluate(() => window.__a11y.drainAnnouncements());
	for (const [i, step] of flow.steps.entries()) {
		const label = step.label || `step ${i + 1}`;
		const add = (check, target, message, evidence) => findings.push(finding(check, { state: flow.id, target: target?.path ?? null, node: target?.path ?? `${flow.id}:${label}`, name: target?.describe ?? label, message: `${flow.id} / ${label}: ${message}`, evidence, source: 'flow' }));
		if (onStep) await onStep({ phase: 'before', index: i, label, row: null });
		await step.run({ page, keyboard: page.keyboard, a11y });
		await settle(page);
		await page.waitForTimeout(step.wait ?? 400);
		const focus = await focused(page);
		const announced = await page.evaluate(() => window.__a11y.drainAnnouncements());
		const row = { step: label, focus: focus.line, announced: announced.map((a) => `${a.politeness}${a.created ? ' (new region)' : ''}: ${a.text}`), title: await page.title(), url: page.url() };
		transcript.push(row);
		const expect = step.expect || {};
		if (focus.body && !expect.focusBody) add('flow:focus-lost', null, 'focus is on the page body after this step', row);
		else if (expect.focus && !matches(expect.focus, focus.line)) add('flow:focus-unexpected', focus, `focus is on ${focus.line}, expected ${expect.focus}`, row);
		if (expect.announce && !announced.some((a) => matches(expect.announce, a.text))) add('flow:announce-missing', null, `nothing matching ${expect.announce} was announced (heard: ${row.announced.join(' | ') || 'nothing'})`, row);
		if (expect.title && !matches(expect.title, row.title)) add('flow:title-unexpected', null, `the page title is "${row.title}", expected ${expect.title}`, row);
		for (const a of announced.filter((x) => x.created && x.role !== 'alert')) add('flow:live-region-created', { path: a.region, describe: a.region }, `"${a.text}" arrived in a live region created at the same moment; screen readers often skip that. Keep the region in the page and change its text`, row);
		if (expect.fieldError) {
			const field = await checkFieldError(page, expect.fieldError);
			if (field.missing) throw new Error(`${flow.id} / ${label}: expect.fieldError selector ${expect.fieldError} matched nothing`);
			if (!field.invalid || !field.messages.length) add('flow:error-not-associated', field, `${field.describe} ${field.invalid ? '' : 'is not marked aria-invalid'}${!field.invalid && !field.messages.length ? ' and ' : ''}${field.messages.length ? '' : 'has no visible error message tied to it by aria-describedby or aria-errormessage'}`, field);
		}
		if (onStep) await onStep({ phase: 'after', index: i, label, row });
	}
	return { findings, transcript };
}

module.exports = { runFlow, helpers };
