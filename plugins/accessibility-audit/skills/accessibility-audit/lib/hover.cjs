// Content that appears on hover or focus (WCAG 1.4.13), and hover content keyboard users cannot reach (2.1.1).
// For each element that could show a tooltip, popover, menu or hover card, the pointer rests on it; any popup that
// appears is then checked: Escape dismisses it without moving the pointer, the pointer can move onto it, it stays
// for two seconds, and focusing (or activating, for menu buttons) the trigger shows it too.
const { finding } = require('./checks.cjs');

// Runs in the page: candidate triggers and the elements that could be their popups (absolutely or fixed
// positioned, or with a popup role), recorded before any hover so a popup hidden with display:none is included.
function prepare(limit) {
	const A = window.__a11y;
	const hoverListeners = [...A.listenersOf('mouseenter'), ...A.listenersOf('mouseover'), ...A.listenersOf('pointerenter'), ...A.listenersOf('pointerover')];
	const triggers = new Set([...hoverListeners, ...document.querySelectorAll('[aria-describedby], [aria-haspopup], [data-tooltip], [data-tippy-content], [data-bs-toggle="tooltip"]')]);
	const list = [...triggers].filter((el) => el instanceof Element && el !== document.body && el !== document.documentElement && A.isRendered(el) && !el.closest('[data-a11y-tool]'));
	window.__a11yHoverTriggers = list.slice(0, limit);
	window.__a11yPopups = [...document.querySelectorAll('body *')].filter((el) => {
		if (el.closest('[data-a11y-tool]')) return false;
		const s = getComputedStyle(el);
		return s.position === 'absolute' || s.position === 'fixed' || /^(tooltip|dialog|menu|listbox)$/.test(el.getAttribute('role') || '');
	});
	return window.__a11yHoverTriggers.map((el) => ({ path: A.cssPath(el), name: A.describe(el) }));
}

// Runs in the page: the popups now showing for trigger `i` (outermost only, with text, not containing the trigger).
function visiblePopups(i) {
	const A = window.__a11y;
	const trigger = window.__a11yHoverTriggers[i];
	const showing = window.__a11yPopups.filter((el) => el.isConnected && A.isRendered(el) && !el.contains(trigger) && A.text(el).length > 0);
	const outer = showing.filter((el) => !showing.some((o) => o !== el && o.contains(el)));
	return outer.map((el) => {
		const r = el.getBoundingClientRect();
		return { path: A.cssPath(el), text: A.text(el).slice(0, 80), box: { x: r.left, y: r.top, w: r.width, h: r.height } };
	});
}

async function hoverChecks(page, { state, limit = 40, seen = new Set() }) {
	const triggers = await page.evaluate(prepare, limit);
	const viewport = page.viewportSize();
	const away = () => page.mouse.move(viewport.width - 2, viewport.height - 2);
	const findings = [];
	const checked = [];
	for (let i = 0; i < triggers.length; i++) {
		const trigger = triggers[i];
		if (seen.has(trigger.path)) continue;
		seen.add(trigger.path);
		const locator = page.locator(trigger.path).first();
		if (!(await locator.count())) continue;
		await away();
		await page.waitForTimeout(150);
		const before = new Set((await page.evaluate(visiblePopups, i)).map((p) => p.path));
		await locator.scrollIntoViewIfNeeded();
		const box = await locator.boundingBox();
		if (!box) continue;
		const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		await page.mouse.move(centre.x, centre.y);
		await page.waitForTimeout(350);
		const popup = (await page.evaluate(visiblePopups, i)).find((p) => !before.has(p.path));
		if (!popup) continue;
		const stillShowing = async () => (await page.evaluate(visiblePopups, i)).some((p) => p.path === popup.path);
		const result = { trigger: trigger.name, popup: popup.text };
		const add = (check, message) => findings.push(finding(check, { state, target: trigger.path, node: trigger.path, name: trigger.name, message, evidence: result, source: 'hover' }));

		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
		result.dismissible = !(await stillShowing());
		if (!result.dismissible) add('hover:not-dismissible', `"${popup.text}" stays after Escape with the pointer on ${trigger.name}`);

		await away();
		await page.mouse.move(centre.x, centre.y);
		await page.waitForTimeout(350);
		if (await stillShowing()) {
			// The way a person moves onto it: straight to its nearest edge, then into it.
			const nearest = { x: Math.min(Math.max(centre.x, popup.box.x + 2), popup.box.x + popup.box.w - 2), y: Math.min(Math.max(centre.y, popup.box.y + 2), popup.box.y + popup.box.h - 2) };
			await page.mouse.move(nearest.x, nearest.y, { steps: 8 });
			await page.mouse.move(popup.box.x + popup.box.w / 2, popup.box.y + popup.box.h / 2, { steps: 8 });
			await page.waitForTimeout(300);
			result.hoverable = await stillShowing();
			if (!result.hoverable) add('hover:not-hoverable', `"${popup.text}" disappears when the pointer moves from ${trigger.name} onto it`);
			await page.mouse.move(centre.x, centre.y);
			await page.waitForTimeout(2000);
			result.persistent = await stillShowing();
			if (!result.persistent) add('hover:not-persistent', `"${popup.text}" disappears by itself within 2 seconds of hovering ${trigger.name}`);
		}

		await away();
		await page.waitForTimeout(250);
		// The trigger itself, or the first control inside it (a wrapper with the hover listener around a button).
		const keyboardTarget = await locator.evaluateHandle((el) => {
			const order = window.__a11y.tabbables();
			return order.includes(el) ? el : order.find((c) => el.contains(c)) || null;
		});
		const focusable = !!keyboardTarget.asElement();
		if (focusable) {
			await page.keyboard.press('Shift'); // keyboard modality, so :focus-visible and focus handlers behave as for Tab
			await keyboardTarget.asElement().focus();
			await page.waitForTimeout(350);
			result.onFocus = await stillShowing();
			// Activation is tried only on menu and disclosure buttons: Enter on an ordinary button could save or delete.
			if (!result.onFocus && (await keyboardTarget.evaluate((el) => el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded')))) {
				await page.keyboard.press('Enter');
				await page.waitForTimeout(350);
				result.onActivate = await stillShowing();
				await page.keyboard.press('Escape');
			}
		}
		if (!result.onFocus && !result.onActivate) add('hover:hover-only', `"${popup.text}" appears on hovering ${trigger.name} but not when it is ${focusable ? 'focused or activated from the keyboard' : 'reached by keyboard (it is not focusable)'}, unless the same information is available another way`);
		if (focusable) await keyboardTarget.evaluate((el) => el.blur());
		await keyboardTarget.dispose();
		checked.push(result);
	}
	await away();
	return { findings, checked };
}

module.exports = { hoverChecks };
