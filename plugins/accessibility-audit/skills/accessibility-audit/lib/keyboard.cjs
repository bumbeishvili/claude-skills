// The keyboard walk: real Tab presses from the top of the page (or from where the state's setup left focus), and at
// every stop what a keyboard and screen-reader user meets there. Measured, not inferred:
//   - role, name and states from Playwright's accessibility snapshot, and the virtual screen reader's speech;
//   - whether the focus indicator is visible: the control is captured focused and unfocused (Shift+Tab away, then
//     focus restored) and the pixels compared, so outlines, shadows, underlines and colour changes all count, and an
//     outline the same colour as the page does not;
//   - whether anything covers it (elementFromPoint on a 3x3 grid), and whether it is on screen at all;
//   - traps, loops, focus dropping to <body>, focus escaping an open modal, controls never reached;
//   - order: backward jumps against the layout, positive tabindex, Shift+Tab not retracing Tab;
//   - pointer target size (2.5.8, with the inline and spacing exceptions), pointer-only controls;
//   - context changes on focus (new window, navigation), on input (select changes), single-key shortcuts and
//     down-event activation, by probing after the walk;
//   - widgets operated the way their pattern says, also by probing after the walk: the skip link moves focus, arrow
//     keys move inside tab lists, menus, list boxes, radio groups, trees and grids, Enter and Space operate custom
//     controls, and buttons that open popups move focus in and get it back after Escape.
const path = require('path');
const png = require('./png.cjs');
const { finding } = require('./checks.cjs');

const PAD = 8; // CSS px around the control captured for the focus indicator (outline width plus offset)
const WIDE_PAD = 40; // second, wider look, for indicators drawn on a container or label around the control
const NAME_REQUIRED = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'treeitem', 'img', 'listbox', 'tree', 'grid', 'gridcell', 'region']);
const MAX_EVIDENCE_SHOTS = 20;

/**
 * Waits for the page to come to rest after a key press: finite CSS and Web Animations end, and scrolling stops.
 * Animations on the focused element, its ancestors or its descendants get up to 1500 ms, since they decide how the
 * focused control looks (a label that fades back in after a delay); others get up to 400 ms. Smooth scrolling
 * (scroll-behavior: smooth) moves the page for several frames after focus arrives, and measuring earlier finds the
 * control still outside the window.
 */
async function settle(page) {
	await page.evaluate(() => new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => {
			const focused = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
			const running = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming?.().endTime));
			const onFocus = (a) => {
				const t = a.effect?.target;
				return !!focused && t instanceof Element && (t === focused || t.contains(focused) || focused.contains(t));
			};
			// A cancelled animation rejects `finished`; that still means it is over.
			const until = (list, ms) => Promise.race([Promise.all(list.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, ms))]);
			Promise.all([until(running.filter(onFocus), 1500), until(running.filter((a) => !onFocus(a)), 400)]).then(resolve);
		}));
	}));
	await page.evaluate(() => new Promise((resolve) => {
		const scrollers = () => {
			const list = [document.scrollingElement || document.documentElement];
			for (let el = document.activeElement?.parentElement; el; el = el.parentElement) if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) list.push(el);
			return list;
		};
		const position = () => scrollers().map((el) => `${el.scrollLeft},${el.scrollTop}`).join('|');
		let last = position();
		let still = 0;
		const started = performance.now();
		const tick = () => {
			const now = position();
			still = now === last ? still + 1 : 0;
			last = now;
			if (still >= 3 || performance.now() - started > 1500) resolve();
			else requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}));
}

// Runs in the page: the focused element (through shadow roots) as the walk records it.
function focusInfo() {
	const A = window.__a11y;
	let el = document.activeElement;
	while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
	if (!el || el === document.body || el === document.documentElement || el.closest('[data-a11y-tool]')) return { body: true, url: location.href };
	const stops = window.__a11yStops;
	let index = stops.indexOf(el);
	const again = index >= 0;
	if (!again) index = stops.push(el) - 1;
	const r = el.getBoundingClientRect();
	const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
	let sampled = 0, covered = 0, coveredBy = null;
	if (onScreen) {
		for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.2, 0.5, 0.8]) {
			const x = r.left + r.width * fx, y = r.top + r.height * fy;
			if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
			sampled++;
			const top = document.elementFromPoint(x, y);
			if (!top || top.closest('[data-a11y-tool]')) continue;
			const mine = top === el || el.contains(top) || top.contains(el) || (el.labels && [...el.labels].some((l) => l.contains(top)));
			if (!mine) { covered++; coveredBy = coveredBy || A.describe(top); }
		}
	}
	let fixed = false;
	for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
		const p = getComputedStyle(n).position;
		if (p === 'fixed' || p === 'sticky') { fixed = true; break; }
	}
	// Where the element sits with every scroll container scrolled back to its start: stops inside a carousel or a
	// scrolling panel then compare by their place in it, not by how far it had scrolled when each took focus.
	let layoutX = r.left + scrollX, layoutY = r.top + scrollY;
	for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
		layoutX += p.scrollLeft;
		layoutY += p.scrollTop;
	}
	const tabindex = el.getAttribute('tabindex');
	return {
		body: false, again, index, tag: el.localName, iframe: el.localName === 'iframe', path: A.cssPath(el), describe: A.describe(el),
		rect: { x: r.left, y: r.top, w: r.width, h: r.height }, doc: { x: r.left + scrollX, y: r.top + scrollY }, layout: { x: layoutX, y: layoutY }, scroll: [scrollX, scrollY],
		onScreen, sampled, covered, coveredBy, fixed, landmark: A.landmarkOf(el), inModal: !!el.closest('[aria-modal="true"], dialog:modal'),
		positiveTabindex: tabindex !== null && Number(tabindex) > 0, url: location.href
	};
}

/**
 * First line of a Playwright aria snapshot → { role, name, states }, from `- button "Save" [pressed]`. Playwright
 * writes the entry as YAML, so a name containing ": " arrives single-quoted: `- 'button "Menu: open"': Menu`.
 */
function parseSnapshotLine(snapshot) {
	const line = (snapshot || '').split('\n')[0].trim();
	let entry = line.replace(/^- /, '');
	if (entry.startsWith("'")) {
		let end = 1;
		while (end < entry.length && !(entry[end] === "'" && entry[end + 1] !== "'")) end += entry[end] === "'" ? 2 : 1;
		entry = entry.slice(1, end).replace(/''/g, "'");
	}
	const m = /^([a-zA-Z]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]+\])*)/.exec(entry);
	if (!m) return { role: null, name: '', states: [], line };
	return { role: m[1], name: (m[2] || '').replace(/\\"/g, '"'), states: (m[3] || '').match(/\[([^\]]+)\]/g)?.map((s) => s.slice(1, -1)) || [], line };
}

async function accessibleOf(page) {
	const focused = page.locator(':focus').last();
	if (!(await focused.count())) return { role: null, name: '', states: [], line: '(focused element not found by :focus)' };
	return parseSnapshotLine(await focused.ariaSnapshot({ timeout: 3000 }));
}

function clipFor(rect, pad, viewport) {
	const x = Math.max(0, Math.floor(rect.x - pad)), y = Math.max(0, Math.floor(rect.y - pad));
	const right = Math.min(viewport.width, Math.ceil(rect.x + rect.w + pad)), bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.h + pad));
	return right - x >= 2 && bottom - y >= 2 ? { x, y, width: right - x, height: bottom - y } : null;
}

async function capture(page, rect, pad) {
	const clip = clipFor(rect, pad, page.viewportSize());
	return clip ? { ...png.decode(await page.screenshot({ clip })), clip } : null;
}

/** The focused neighbour's box (plus room for its ring) in the device pixels of `image`, to leave out of a compare. */
function neighbourMask(image, neighbour, dsf) {
	if (!image || !neighbour) return [];
	const ring = 6;
	return [{ x: Math.floor((neighbour.x - ring - image.clip.x) * dsf), y: Math.floor((neighbour.y - ring - image.clip.y) * dsf), w: Math.ceil((neighbour.w + 2 * ring) * dsf), h: Math.ceil((neighbour.h + 2 * ring) * dsf) }];
}

const currentRect = (page, index) => page.evaluate((i) => {
	const r = window.__a11yStops[i].getBoundingClientRect();
	return { x: r.left, y: r.top, w: r.width, h: r.height, scroll: [scrollX, scrollY] };
}, index);

/**
 * Focused and unfocused captures of a stop, compared. Focus leaves with Shift+Tab (so menus and roving groups keep
 * their state) and comes back by focus() on the same element, which keeps :focus-visible after keyboard use.
 * Returns { status: visible | low-contrast | none | unmeasured, any, strong, threshold, maxRatio } in CSS px².
 */
const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function measureIndicator(page, stop, dsf) {
	const focusedNear = await capture(page, stop.rect, PAD);
	const focusedWide = await capture(page, stop.rect, WIDE_PAD);
	if (!focusedNear) return { status: 'unmeasured', reason: 'no visible area to capture' };
	const whereFocusIs = () => page.evaluate((i) => {
		const el = document.activeElement;
		if (el === window.__a11yStops[i]) return null;
		const r = el && el !== document.body ? el.getBoundingClientRect() : null;
		return { neighbour: r && r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null };
	}, stop.index);
	// Step back until the focused neighbour does not sit on top of the control (a skip link that appears over the
	// header when focused would otherwise hide the very pixels being compared). Two extra steps at most.
	let moved = null;
	let rect = stop.rect;
	for (let step = 0; step < 3; step++) {
		await page.keyboard.press('Shift+Tab');
		await settle(page);
		moved = await whereFocusIs();
		if (!moved) return { status: 'unmeasured', reason: 'Shift+Tab did not move focus off the control' };
		// Same window region when the page did not scroll (a control that appears on focus is compared against the
		// spot where it appeared); the control's new position when the page scrolled under it.
		const now = await currentRect(page, stop.index);
		const scrolled = now.scroll[0] !== stop.scroll[0] || now.scroll[1] !== stop.scroll[1];
		rect = scrolled ? now : stop.rect;
		if (!overlaps(moved.neighbour, rect)) break;
		if (step === 2) {
			await page.evaluate((i) => window.__a11yStops[i].focus({ preventScroll: true }), stop.index);
			await settle(page);
			return { status: 'unmeasured', reason: 'every nearby control overlaps it while focused' };
		}
	}
	const unfocusedNear = await capture(page, rect, PAD);
	const unfocusedWide = await capture(page, rect, WIDE_PAD);
	await page.evaluate((i) => window.__a11yStops[i].focus({ preventScroll: true }), stop.index);
	await settle(page);
	const back = await page.evaluate((i) => document.activeElement === window.__a11yStops[i], stop.index);
	if (!back) throw new Error(`focus could not be restored to ${stop.path} after measuring its focus indicator`);
	if (!unfocusedNear) return { status: 'unmeasured', reason: 'the control left the window when focus moved off it' };
	const area = (n) => n / (dsf * dsf);
	const threshold = Math.max(stop.rect.w, stop.rect.h, 8); // at least a 1 CSS px line along the long side
	const near = png.compare(unfocusedNear, focusedNear, { minRatio: 3, mask: neighbourMask(unfocusedNear, moved.neighbour, dsf) });
	let result = { any: area(near.changed), strong: area(near.strong), maxRatio: near.maxRatio, threshold, where: 'on the control' };
	if (result.strong < threshold / 2 && focusedWide && unfocusedWide) {
		const wide = png.compare(unfocusedWide, focusedWide, { minRatio: 3, mask: neighbourMask(unfocusedWide, moved.neighbour, dsf) });
		if (area(wide.strong) >= threshold / 2) result = { any: area(wide.changed), strong: area(wide.strong), maxRatio: wide.maxRatio, threshold, where: 'around the control' };
	}
	result.status = result.any < threshold / 2 ? 'none' : result.strong < threshold / 2 ? 'low-contrast' : 'visible';
	return result;
}

/** Moves focus to the first tabbable element after `index` in document order (to continue past a trap). */
const skipPast = (page, index) => page.evaluate((i) => {
	const el = window.__a11yStops[i];
	const next = window.__a11y.tabbables().find((c) => el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING && !el.contains(c));
	if (next) next.focus();
	return !!next;
}, index);

/** True when stop `index` is the last stop of the page's Tab sequence, so focus leaving it is the normal end. */
const isLastInSequence = (page, index) => page.evaluate((i) => {
	const el = window.__a11yStops[i];
	const modal = document.querySelector('[aria-modal="true"]:not([hidden]), dialog:modal');
	const order = window.__a11y.tabbables(modal || document).filter((c) => !(Number(c.getAttribute('tabindex')) > 0));
	const last = order[order.length - 1];
	return !last || el === last || el.contains(last) || last.localName === 'iframe' && el === last;
}, index);

async function keyboardWalk(page, { state, maxStops = 400, measureFocus = true, speech = null, outDir }) {
	const dsf = await page.evaluate(() => devicePixelRatio);
	const viewport = page.viewportSize();
	await page.mouse.move(viewport.width - 2, viewport.height - 2);
	// Carets blink in text fields and would read as a focus change; hide them while measuring.
	await page.evaluate(() => {
		const style = document.createElement('style');
		style.id = 'a11y-caret-style';
		style.setAttribute('data-a11y-tool', '');
		style.textContent = '* { caret-color: transparent !important; }';
		document.head.appendChild(style);
		window.__a11yStops = [];
		window.__a11yInventory = window.__a11y.tabbables();
	});
	// Where the walk starts. 'fresh': nothing has been focused since load, so the first Tab is a user's first Tab
	// (positive tabindex first). 'top': focus has been used, so a node at the start of the body takes it; browsers
	// then start from document order, and positive-tabindex controls come round after the end of the page.
	// 'focused': the state's setup left focus on a control (an open menu, a dialog); the walk starts there.
	const start = await page.evaluate(() => {
		let el = document.activeElement;
		while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
		if (el && el !== document.body && el !== document.documentElement) return 'focused';
		if (!window.__a11y.focusLog.length) return 'fresh';
		const sentinel = document.createElement('span');
		sentinel.setAttribute('data-a11y-tool', 'sentinel');
		sentinel.tabIndex = -1;
		sentinel.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden';
		document.body.prepend(sentinel);
		sentinel.focus({ preventScroll: true });
		return 'top';
	});

	const stops = [];
	const findings = [];
	const add = (check, stop, message, evidence) => {
		const f = finding(check, { state, target: stop?.path, node: stop?.path, name: stop?.describe, message, evidence, source: 'keyboard' });
		findings.push(f);
		return f;
	};
	let shots = 0;
	let end = 'stop limit reached';
	let previous = null;
	let popups = 0;
	const onPopup = () => popups++;
	page.on('popup', onPopup);
	const take = async () => {
		await settle(page);
		return page.evaluate(focusInfo);
	};
	const tab = async () => {
		await page.evaluate(() => window.__a11y.drainNavigations());
		const before = popups;
		await page.keyboard.press('Tab');
		const info = await take();
		info.newWindow = popups > before;
		info.navigations = await page.evaluate(() => window.__a11y.drainNavigations());
		return info;
	};

	let current = start === 'focused' ? { ...(await take()), navigations: [], newWindow: false } : await tab();
	// Focus passes through the browser (document.activeElement is <body>) between the last control and the first.
	// The walk goes on round until it meets its first stop again, so controls before the start point are walked.
	let wrapped = false;
	let bodyInARow = 0;
	let presses = 0;
	// Stops (by n) that focus reached by way of the page body: the step from the end of the page round to the start.
	const throughBody = new Set();
	while (stops.length < maxStops && presses++ < maxStops * 3) {
		if (current.body) {
			if (++bodyInARow >= 2) { end = stops.length ? 'focus left the page and did not come back' : 'no focusable content'; break; }
			if (previous && !(await isLastInSequence(page, previous.index))) add('kbd:focus-lost', previous, `After ${previous.describe}, Tab put focus on the page body instead of the next control`, {});
			wrapped = true;
			throughBody.add(stops.length + 1);
			current = await tab();
			continue;
		}
		bodyInARow = 0;
		if (current.again && current.index === 0) { end = wrapped ? 'came round to the first stop' : 'cycled back to the first stop'; break; }
		// Round the end of the page and back to a stop already walked: the whole sequence has been seen. (A menu
		// that closed when focus left it no longer holds the walk's first stop, so the walk meets a later one.)
		if (current.again && wrapped) { end = 'came round to a walked stop'; break; }
		if (current.again && previous && current.index === previous.index) {
			// Focus did not move. Press once more, then try Escape, then step past it so the walk can go on.
			const retry = await tab();
			if (retry.body || retry.index !== current.index) { current = retry; continue; }
			await page.keyboard.press('Escape');
			const escaped = await tab();
			const stuck = stops[current.index];
			add('kbd:trap', stuck, `Tab does not move focus off ${stuck.describe} (${!escaped.body && escaped.index !== current.index ? 'Escape then Tab does leave it' : 'Escape does not help either'})`, {});
			if (!escaped.body && escaped.index !== current.index) { current = escaped; continue; }
			if (!(await skipPast(page, current.index))) { end = 'trapped at the last control'; break; }
			current = { ...(await take()), navigations: [], newWindow: false };
			previous = null;
			continue;
		}
		if (current.again) {
			const inModal = stops[current.index].inModal;
			if (!inModal) add('kbd:focus-loop', stops[current.index], `Tab came back to stop ${current.index + 1} (${current.describe}) without reaching the rest of the page`, { stop: current.index + 1 });
			end = inModal ? 'cycled inside the modal dialog' : 'loop';
			break;
		}

		const { role, name, states, line } = current.iframe ? { role: 'iframe', name: '', states: [], line: '- iframe' } : await accessibleOf(page);
		const spoken = speech ? await speech.take() : [];
		const stop = { ...current, n: stops.length + 1, role, name, states, snapshot: line, speech: spoken };
		stops.push(stop);

		const moved = current.navigations.filter((nav) => nav.kind === 'window.open' || nav.kind === 'hashchange' || nav.kind === 'history.pushState');
		const pathChanged = previous && new URL(previous.url).pathname !== new URL(current.url).pathname;
		if (moved.length || current.newWindow || pathChanged) add('kbd:context-change-on-focus', stop, `Focusing ${stop.describe} ${current.newWindow ? 'opened a new window' : moved.length ? `caused ${moved.map((m) => m.kind).join(', ')}` : 'changed the page URL'}`, { navigations: current.navigations });
		const nativePlayer = current.tag === 'video' || current.tag === 'audio';
		if (!current.iframe && !nativePlayer) {
			if (!role || role === 'generic' || role === 'none' || role === 'presentation' || role === 'text') add('kbd:no-role', stop, `${stop.describe} takes focus but has no role a screen reader can announce (snapshot: ${line})`, { snapshot: line });
			else if (NAME_REQUIRED.has(role) && !name.trim()) add('kbd:no-name', stop, `${role} with no accessible name: ${stop.describe}`, { snapshot: line });
		}
		if (current.positiveTabindex) add('kbd:positive-tabindex', stop, `${stop.describe} has a positive tabindex, so it is reached out of the page order`, {});
		if (!current.onScreen) add('kbd:focus-offscreen', stop, `${stop.describe} has focus but is outside the window (${Math.round(current.rect.x)}, ${Math.round(current.rect.y)}, ${Math.round(current.rect.w)}x${Math.round(current.rect.h)})`, { rect: current.rect });
		else if (current.sampled && current.covered === current.sampled) add('kbd:focus-obscured', stop, `${stop.describe} is entirely covered by ${current.coveredBy} while focused`, { coveredBy: current.coveredBy });
		else if (current.covered) add('kbd:focus-partly-obscured', stop, `${current.covered} of ${current.sampled} sample points of ${stop.describe} are covered by ${current.coveredBy}`, { coveredBy: current.coveredBy });
		if (previous && previous.inModal && !current.inModal) add('kbd:modal-escape', stop, `Tab moved from inside an open modal dialog (${previous.describe}) to ${stop.describe} behind it`, {});

		if (measureFocus && current.onScreen && !current.iframe) {
			const indicator = await measureIndicator(page, stop, dsf);
			stop.indicator = indicator;
			if (speech) await speech.take(); // the measurement's own focus moves are not part of the transcript
			await page.evaluate(() => window.__a11y.drainNavigations());
			let f = null;
			if (indicator.status === 'none') f = add('kbd:focus-not-visible', stop, `No visible change when ${stop.describe} takes focus (${Math.round(indicator.any)} CSS px² changed; at least ${Math.round(indicator.threshold / 2)} expected)`, indicator);
			else if (indicator.status === 'low-contrast') f = add('kbd:focus-low-contrast', stop, `The focus change on ${stop.describe} is faint: ${Math.round(indicator.strong)} CSS px² reach 3:1 against the unfocused state (best ${indicator.maxRatio}:1)`, indicator);
			if (f && outDir && shots < MAX_EVIDENCE_SHOTS) {
				const clip = clipFor(current.rect, WIDE_PAD, viewport);
				if (clip) {
					shots++;
					f.shot = `${state}-stop${stop.n}-focus.png`;
					await page.screenshot({ path: path.join(outDir, f.shot), clip });
				}
			}
		}
		previous = stop;
		current = await tab();
	}
	page.off('popup', onPopup);

	// Order against the layout: a stop well above the previous one (not moving right into a new column), or behind
	// it in the same row. The step round from the end of the page to its start is not a jump.
	for (let i = 1; i < stops.length; i++) {
		const a = stops[i - 1], b = stops[i];
		if (a.fixed || b.fixed || a.inModal !== b.inModal || a.iframe || b.iframe || throughBody.has(b.n)) continue;
		const up = b.layout.y + b.rect.h / 2 < a.layout.y - Math.max(24, a.rect.h / 2);
		const sameRowBackwards = Math.abs(b.layout.y - a.layout.y) < 8 && b.layout.x + b.rect.w / 2 < a.layout.x;
		const newColumn = b.layout.x > a.layout.x + a.rect.w * 0.5;
		if ((up && !newColumn) || sameRowBackwards) add('kbd:order-jump', b, `Stop ${b.n} (${b.describe}) comes after stop ${a.n} (${a.describe}) but sits ${up ? 'above' : 'to the left of'} it`, { from: a.n, to: b.n });
	}

	// Controls never reached: only meaningful when the walk ran to its natural end.
	const complete = ['came round to the first stop', 'came round to a walked stop', 'cycled back to the first stop', 'cycled inside the modal dialog', 'no focusable content'].includes(end);
	const reach = await page.evaluate(() => {
		const A = window.__a11y;
		const walked = new Set(window.__a11yStops);
		const modal = document.querySelector('[aria-modal="true"]:not([hidden]), dialog:modal');
		const inventory = window.__a11yInventory.filter((el) => el.isConnected && A.isRendered(el) && (!modal || modal.contains(el)));
		const groupOf = (el) => `${el.form ? A.cssPath(el.form) : ''}|${el.name}`;
		const radioGroups = new Set(inventory.filter((el) => walked.has(el) && el.type === 'radio').map(groupOf));
		const unreached = inventory.filter((el) => !walked.has(el) && !(el.type === 'radio' && radioGroups.has(groupOf(el))) && !el.closest('iframe'));
		return { inventory: inventory.length, unreached: unreached.slice(0, 40).map((el) => ({ path: A.cssPath(el), describe: A.describe(el) })) };
	});
	if (complete) for (const u of reach.unreached) findings.push(finding('kbd:unreachable', { state, target: u.path, node: u.path, name: u.describe, message: `${u.describe} is visible and focusable but Tab never reached it`, source: 'keyboard' }));

	// Shift+Tab from the last stop should visit the same stops in reverse. Stops that are no longer tabbable (a menu
	// that closed when focus left it) are left out, and focus may pass through the page body where Tab did.
	let reverse = null;
	if (complete && stops.length > 2 && end !== 'cycled inside the modal dialog') {
		const stillTabbable = await page.evaluate((indices) => {
			const order = new Set(window.__a11y.tabbables());
			return indices.map((i) => order.has(window.__a11yStops[i]));
		}, stops.map((s) => s.index));
		const expected = stops.filter((s, i) => stillTabbable[i]).reverse();
		const activeStop = () => page.evaluate(() => {
			let el = document.activeElement;
			while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
			const body = !el || el === document.body || el === document.documentElement;
			return { index: window.__a11yStops.indexOf(el), body, describe: body ? '<body>' : window.__a11y.describe(el) };
		});
		let retraced = Math.min(1, expected.length);
		let divergedTo = null;
		if (expected.length > 1) await page.evaluate((i) => window.__a11yStops[i].focus(), expected[0].index);
		while (retraced < expected.length) {
			const from = expected[retraced - 1];
			await page.keyboard.press('Shift+Tab');
			let at = await activeStop();
			for (let extra = 0; at.body && throughBody.has(from.n) && extra < 2; extra++) {
				await page.keyboard.press('Shift+Tab');
				at = await activeStop();
			}
			if (at.index !== expected[retraced].index) { divergedTo = at; break; }
			retraced++;
		}
		reverse = { expected: expected.length, retraced };
		if (divergedTo) {
			const at = expected[retraced];
			add('kbd:reverse-mismatch', at, `Shift+Tab retraced ${retraced} of ${expected.length} stops, then went to ${divergedTo.describe} instead of stop ${at.n} (${at.describe})`, { divergedTo: divergedTo.describe });
		}
	}

	await page.evaluate(() => {
		document.getElementById('a11y-caret-style')?.remove();
		document.querySelector('[data-a11y-tool="sentinel"]')?.remove();
	});
	return { stops, findings, end, inventory: reach.inventory, reverse };
}

/** 2.5.8 target size of every tabbable control plus `extraPaths` (pointer-only ones), with the inline and spacing
 * exceptions. Run it before the walk, so controls are measured at rest (a skip link is not showing). */
async function targetSizes(page, { state, extraPaths = [] }) {
	const hits = await page.evaluate((extra) => {
		const A = window.__a11y;
		const targets = [...new Set([...A.tabbables(), ...extra.map((p) => document.querySelector(p)).filter(Boolean)])].filter((el) => el.isConnected && A.isRendered(el) && el.localName !== 'iframe');
		const boxes = targets.map((el) => ({ el, r: el.getBoundingClientRect() }));
		const inline = (el) => {
			if (getComputedStyle(el).display !== 'inline') return false;
			const block = el.parentElement?.closest('p, li, td, dd, dt, label, span, div, blockquote, figcaption, caption');
			return !!block && A.text(block).length > A.text(el).length + 3;
		};
		const uaControl = (el) => (el.type === 'checkbox' || el.type === 'radio') && getComputedStyle(el).appearance !== 'none';
		const intersectsCircle = (cx, cy, rad, r) => {
			const nx = Math.max(r.left, Math.min(cx, r.right)), ny = Math.max(r.top, Math.min(cy, r.bottom));
			return (cx - nx) ** 2 + (cy - ny) ** 2 < rad * rad;
		};
		const out = [];
		for (const { el, r } of boxes) {
			if ((r.width >= 24 && r.height >= 24) || r.width === 0 || r.height === 0 || inline(el) || uaControl(el)) continue;
			const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
			const crowded = boxes.find((o) => {
				if (o.el === el || o.el.contains(el) || el.contains(o.el) || o.r.width === 0) return false;
				if (intersectsCircle(cx, cy, 12, o.r)) return true;
				const small = o.r.width < 24 || o.r.height < 24;
				return small && Math.hypot(cx - (o.r.left + o.r.width / 2), cy - (o.r.top + o.r.height / 2)) < 24;
			});
			if (crowded) out.push({ path: A.cssPath(el), name: A.describe(el), size: `${Math.round(r.width)}x${Math.round(r.height)}`, near: A.describe(crowded.el) });
		}
		return out;
	}, extraPaths);
	return hits.map((h) => finding('kbd:target-size', { state, target: h.path, node: h.path, name: h.name, message: `${h.size} CSS px target, with ${h.near} inside its 24 px spacing circle (passes only if another control on the page does the same job at 24 px, or the size is essential, as for dots placed on a map)`, evidence: h, source: 'keyboard' }));
}

/** Elements that react to clicks but cannot take keyboard focus. */
async function pointerOnly(page, { state }) {
	const hits = await page.evaluate(() => {
		const A = window.__a11y;
		const tabbable = new Set(A.tabbables());
		const focusable = (el) => tabbable.has(el) || el.matches('a[href], button, input, select, textarea, summary, [tabindex], label, [contenteditable="true"]');
		const viewportArea = innerWidth * innerHeight;
		const candidates = new Set([...A.listenersOf('click'), ...A.listenersOf('mousedown'), ...A.listenersOf('pointerdown'), ...document.querySelectorAll('[onclick]')].filter((t) => t instanceof Element));
		for (const el of document.querySelectorAll('body *')) {
			if (getComputedStyle(el).cursor === 'pointer' && getComputedStyle(el.parentElement || document.body).cursor !== 'pointer') candidates.add(el);
		}
		const out = [];
		for (const el of candidates) {
			if (el === document.body || el === document.documentElement || el.closest('[data-a11y-tool]') || !A.isRendered(el) || A.hiddenFromAT(el)) continue;
			if (focusable(el) || el.closest('a[href], button, [role="button"], [role="link"], label, summary, [tabindex]:not([tabindex="-1"])')) continue;
			if (el.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) continue; // a whole-card click with a real link inside
			const r = el.getBoundingClientRect();
			if (r.width * r.height > viewportArea * 0.5) continue; // a delegating container, not a control
			out.push({ path: A.cssPath(el), name: A.describe(el) });
		}
		return out.slice(0, 30);
	});
	return hits.map((h) => finding('kbd:pointer-only', { state, target: h.path, node: h.path, name: h.name, message: `${h.name} responds to the pointer (listener or pointer cursor) but cannot be reached with Tab`, source: 'keyboard' }));
}

// ---- probes: run after everything else, because they can change the page ----

/** Runs `action` and reports what it changed: the elements that mutated (leaving out the html/body attribute writes
 * that input-modality scripts make on every key and pointer press), URL, scroll and recorded navigations. */
async function mutationProbe(page, action, wait = 350) {
	await page.evaluate(() => {
		window.__probe = { targets: new Map(), before: location.href, scroll: [scrollX, scrollY] };
		window.__probeObserver = new MutationObserver((ms) => {
			for (const m of ms) {
				const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
				if (!t || t.closest('[data-a11y-tool]')) continue;
				if (m.type === 'attributes' && (t === document.documentElement || t === document.body)) continue;
				const kinds = window.__probe.targets.get(t) || new Set();
				kinds.add(m.type === 'attributes' ? 'attributes' : 'content');
				window.__probe.targets.set(t, kinds);
			}
		});
		window.__probeObserver.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
		window.__a11y.drainNavigations();
	});
	await action();
	await page.waitForTimeout(wait);
	return page.evaluate(() => {
		window.__probeObserver.disconnect();
		const p = window.__probe;
		const targets = [...p.targets].filter(([t]) => t.isConnected).map(([t, kinds]) => ({ path: window.__a11y.cssPath(t), name: window.__a11y.describe(t), kinds: [...kinds] }));
		return { targets, urlChanged: location.href !== p.before, scrolled: scrollX !== p.scroll[0] || scrollY !== p.scroll[1], navigations: window.__a11y.drainNavigations() };
	});
}

/** What `action` changed beyond the page's own background activity (tickers, carousels), confirmed by a second run:
 * targets that changed in both runs and in neither quiet window before them. */
async function confirmedChange(page, action, { quiet = 1200, before = async () => {} } = {}) {
	const runs = [];
	for (let i = 0; i < 2; i++) {
		await before();
		const background = await mutationProbe(page, async () => {}, quiet);
		await before();
		const result = await mutationProbe(page, action);
		const ignore = new Set(background.targets.map((t) => t.path));
		runs.push({ ...result, fresh: result.targets.filter((t) => !ignore.has(t.path)), moved: result.urlChanged || result.navigations.some((n) => n.kind !== 'history.replaceState') });
	}
	const second = new Set(runs[1].fresh.map((t) => t.path));
	const both = runs[0].fresh.filter((t) => second.has(t.path));
	return { changed: both, moved: runs[0].moved && runs[1].moved, first: runs[0] };
}

const focusNothing = (page) => page.evaluate(() => {
	const sentinel = document.createElement('span');
	sentinel.setAttribute('data-a11y-tool', 'sentinel');
	sentinel.tabIndex = -1;
	document.body.prepend(sentinel);
	sentinel.focus();
	sentinel.remove();
});

/** 2.1.4: with nothing focused, do single printable keys do anything? Probed only when page-wide key listeners exist. */
async function singleKeyShortcuts(page, { state, keys = ['s', '/', '?', 'k', 'j', 'g', 'n', 'p', '.', '1'] }) {
	const global = await page.evaluate(() => ['keydown', 'keyup', 'keypress'].some((type) => window.__a11y.listenersOf(type).some((t) => t === 'window' || t === 'document' || t === document.body || t === document.documentElement)));
	if (!global) return { findings: [], probed: false };
	for (const key of keys) {
		const result = await confirmedChange(page, () => page.keyboard.press(key), { quiet: 600, before: () => focusNothing(page) });
		if (result.moved || result.changed.length) {
			const where = result.changed[0];
			return { probed: true, findings: [finding('kbd:single-key-shortcut', { state, target: where?.path, node: where?.path, name: where?.name, message: `Pressing "${key}" with nothing focused ${result.moved ? 'moved the page' : `changed ${where.name}`}, twice in a row: confirm it can be turned off, remapped, or works only while its control has focus`, evidence: { key, changed: result.changed.slice(0, 5) }, source: 'probe' })] };
		}
	}
	return { findings: [], probed: true };
}

/** 2.5.2: controls with pointer-down listeners, pressed and released elsewhere: did the press alone act? */
async function downEventActivation(page, { state, limit = 10 }) {
	const candidates = await page.evaluate((max) => {
		const A = window.__a11y;
		const els = [...new Set([...A.listenersOf('mousedown'), ...A.listenersOf('pointerdown'), ...A.listenersOf('touchstart')])].filter((t) => t instanceof Element && A.isRendered(t) && t !== document.body && t !== document.documentElement);
		return els.slice(0, max).map((el) => ({ path: A.cssPath(el), name: A.describe(el) }));
	}, limit);
	const findings = [];
	const viewport = page.viewportSize();
	const release = async () => {
		await page.mouse.move(viewport.width - 2, viewport.height - 2);
		await page.mouse.up();
	};
	for (const c of candidates) {
		const target = page.locator(c.path).first();
		if (!(await target.count())) continue;
		await target.scrollIntoViewIfNeeded();
		const box = await target.boundingBox();
		if (!box) continue;
		const press = async () => {
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
		};
		const result = await confirmedChange(page, press, { quiet: 600, before: release });
		await release();
		// The pressed control restyling itself (an :active-like class or style) is feedback, not the action.
		const acted = result.changed.filter((t) => t.path !== c.path || t.kinds.includes('content'));
		if (acted.length || result.moved) findings.push(finding('kbd:down-event-activation', { state, target: c.path, node: c.path, name: c.name, message: `Pressing ${c.name} without releasing already changed ${result.moved ? 'the page location' : acted[0].name}; the action should complete on release so a slip can be cancelled`, evidence: { changed: acted.slice(0, 5) }, source: 'probe' }));
	}
	return findings;
}

/** 3.2.2: choosing another option in each select: did that alone navigate or open a window? */
async function selectChanges(page, { state }) {
	const selects = await page.evaluate(() => [...document.querySelectorAll('select')].filter((s) => window.__a11y.isRendered(s) && !s.disabled && s.options.length > 1).map((s) => ({ path: window.__a11y.cssPath(s), name: window.__a11y.describe(s), value: s.value, other: [...s.options].find((o) => o.value !== s.value && !o.disabled)?.value })));
	const findings = [];
	for (const s of selects) {
		if (s.other === undefined) continue;
		const popups = [];
		const onPopup = (p) => popups.push(p);
		page.on('popup', onPopup);
		const result = await mutationProbe(page, () => page.locator(s.path).selectOption(s.other));
		page.off('popup', onPopup);
		if (result.urlChanged || popups.length || result.navigations.some((n) => n.kind !== 'history.replaceState')) {
			findings.push(finding('kbd:context-change-on-input', { state, target: s.path, node: s.path, name: s.name, message: `Choosing another option in ${s.name} ${popups.length ? 'opened a window' : 'moved the page'} without a separate submit`, evidence: { ...result, popups: popups.length }, source: 'probe' }));
			break;
		}
		await page.locator(s.path).selectOption(s.value);
	}
	return findings;
}

// ---- widgets: arrow keys, popups, the skip link, custom controls ----

const POPUP_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog, [role="menu"], [role="listbox"], [role="tree"], [role="grid"]';

/** Where the keyboard is: the focused element, the option it points at (aria-activedescendant), its expanded state,
 * and whether it is inside the element at `withinPath`. */
const keyState = (page, withinPath = null) => page.evaluate((within) => {
	let el = document.activeElement;
	while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
	const body = !el || el === document.body || el === document.documentElement;
	const container = within ? document.querySelector(within) : null;
	return {
		body,
		path: body ? null : window.__a11y.cssPath(el),
		describe: body ? '<body>' : window.__a11y.describe(el),
		descendant: body ? null : el.getAttribute('aria-activedescendant'),
		expanded: body ? null : el.getAttribute('aria-expanded'),
		inside: !body && !!container && container.contains(el)
	};
}, withinPath);

/** Focuses the element at `path` the way Tab would leave it: keyboard modality first, so :focus-visible applies. */
async function focusByKeyboard(page, path) {
	await page.keyboard.press('Shift');
	await page.evaluate((p) => {
		const el = document.querySelector(p);
		if (!el) throw new Error(`focusByKeyboard: ${p} is no longer on the page`);
		el.focus();
	}, path);
	await settle(page);
}

/** True while the element at `path` is on the page and drawn. An earlier probe can re-render part of the page, and
 * the element that replaces it is probed under its own path on the next run. */
const stillShown = (page, path) => page.evaluate((p) => {
	const el = document.querySelector(p);
	return !!el && window.__a11y.isRendered(el);
}, path);

const blurActive = (page) => page.evaluate(() => document.activeElement?.blur?.());

// Runs in the page: tab lists, menus, menu bars, list boxes, radio groups (and fieldsets of radio buttons), trees and
// grids on screen, each with its items, where keyboard focus enters it, and the arrow-key pairs its ARIA Authoring
// Practices pattern uses (the second pair for a widget laid out the other way).
function findComposites(limit) {
	const A = window.__a11y;
	const CONTAINERS = '[role="tablist"], [role="menubar"], [role="menu"], [role="listbox"], [role="radiogroup"], fieldset, [role="tree"], [role="grid"], [role="treegrid"]';
	const ITEMS = {
		tablist: '[role="tab"]',
		menubar: '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
		menu: '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
		listbox: '[role="option"]',
		radiogroup: '[role="radio"], input[type="radio"]',
		tree: '[role="treeitem"]',
		grid: '[role="gridcell"], [role="columnheader"], [role="rowheader"]'
	};
	const kindOf = (c) => {
		const role = c.getAttribute('role');
		if (role === 'treegrid') return 'grid';
		if (ITEMS[role]) return role;
		return c.localName === 'fieldset' ? 'radiogroup' : null;
	};
	const vertical = ['ArrowDown', 'ArrowUp'];
	const horizontal = ['ArrowRight', 'ArrowLeft'];
	const usable = (el) => A.isRendered(el) && !A.hiddenFromAT(el) && !el.closest('[data-a11y-tool]') && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
	const tabbable = new Set(A.tabbables());
	const controllers = [...document.querySelectorAll('[aria-controls], [aria-owns]')].filter((x) => tabbable.has(x));
	const selected = (i) => i.matches('[aria-selected="true"], [aria-checked="true"], :checked');
	const out = [];
	for (const c of document.querySelectorAll(CONTAINERS)) {
		const kind = kindOf(c);
		if (!kind || !usable(c)) continue;
		const items = [...c.querySelectorAll(ITEMS[kind])].filter((i) => usable(i) && i.parentElement.closest(CONTAINERS) === c);
		if (items.length < 2) continue;
		const orientation = c.getAttribute('aria-orientation');
		const sideways = kind === 'grid' || ((kind === 'tablist' || kind === 'menubar') && orientation !== 'vertical') || (kind === 'listbox' && orientation === 'horizontal');
		const tabItems = items.filter((i) => tabbable.has(i));
		const controller = c.id ? controllers.find((x) => `${x.getAttribute('aria-controls') || ''} ${x.getAttribute('aria-owns') || ''}`.split(/\s+/).includes(c.id)) : null;
		const focusedItem = items.find((i) => i.contains(document.activeElement));
		// An open menu got focus from its button; the probe puts focus on its first item the same way.
		const entry = tabItems.find(selected) || tabItems[0] || focusedItem || (tabbable.has(c) ? c : null) || controller || (kind === 'menu' ? items[0] : null);
		out.push({
			kind,
			path: A.cssPath(c),
			name: A.describe(c),
			items: items.length,
			tabItems: tabItems.length,
			entry: entry ? A.cssPath(entry) : null,
			viaController: !!controller && entry === controller,
			keys: sideways ? [horizontal, vertical] : [vertical, horizontal]
		});
		if (out.length >= limit) break;
	}
	return out;
}

/**
 * 2.1.1 in composite widgets. From where focus enters the widget, an arrow key moves to another item, or moves the
 * option a controlling combobox points at. One Tab stop with arrows inside is the pattern; with no arrows the other
 * items are out of keyboard reach. When every item is a Tab stop anyway, the missing arrows are best practice only.
 */
async function arrowKeys(page, { state, limit = 20 }) {
	const widgets = await page.evaluate(findComposites, limit);
	const findings = [];
	for (const w of widgets) {
		const add = (check, message, extra = {}) => findings.push(finding(check, { state, target: w.path, node: w.path, name: w.name, message, evidence: { kind: w.kind, items: w.items, tabItems: w.tabItems, entry: w.entry }, source: 'probe', ...extra }));
		if (!w.entry) {
			add('kbd:composite-unreachable', `None of the ${w.items} items of ${w.name} takes keyboard focus, and nothing that controls it does`);
			continue;
		}
		if (!(await stillShown(page, w.entry))) continue;
		await focusByKeyboard(page, w.entry);
		const start = await keyState(page, w.path);
		let moved = false;
		for (const [forward, back] of w.keys) {
			await page.keyboard.press(forward);
			await settle(page);
			const now = await keyState(page, w.path);
			moved = (now.path !== start.path && now.inside) || (!!now.descendant && now.descendant !== start.descendant) || (now.expanded === 'true' && start.expanded !== 'true');
			if (moved) {
				await page.keyboard.press(w.viaController ? 'Escape' : back);
				await settle(page);
				break;
			}
		}
		await blurActive(page);
		if (moved) continue;
		if (w.tabItems === w.items) add('kbd:composite-no-arrows', `Arrow keys do not move between the ${w.items} items of ${w.name}. Each item is a Tab stop, so all are reachable, but the ${w.kind} pattern moves with arrows and keeps one Tab stop`, { bestPractice: true });
		else add('kbd:composite-unreachable', `Arrow keys do not move from ${start.describe} to the other items of ${w.name}: ${w.items - w.tabItems} of its ${w.items} items have no Tab stop, so the keyboard cannot reach them`);
	}
	return findings;
}

// Runs in the page: controls taken out of the Tab order (tabindex="-1") outside the ARIA composite widgets, and
// elements in a roving set (siblings of one tag, one of them tabindex="0", the rest "-1", such as chart marks),
// grouped by the nearest ancestor holding a Tab stop: arrow keys would have to start from that stop.
function findRovingGroups(limit) {
	const A = window.__a11y;
	const COMPOSITE = '[role="tablist"], [role="menubar"], [role="menu"], [role="listbox"], [role="radiogroup"], fieldset, [role="tree"], [role="grid"], [role="treegrid"]';
	const CONTROL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="option"], [role="menuitem"], [role="slider"], [role="spinbutton"], [role="treeitem"]';
	const tabbable = A.tabbables();
	const inRovingSet = (el) => !!el.parentElement && [...el.parentElement.children].some((s) => s !== el && s.localName === el.localName && s.getAttribute('tabindex') === '0');
	const groups = new Map();
	for (const el of document.querySelectorAll('[tabindex="-1"]')) {
		if (!(el.matches(CONTROL) || inRovingSet(el)) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
		if (!A.isRendered(el) || A.hiddenFromAT(el) || el.closest(`${COMPOSITE}, [data-a11y-tool], [inert]`)) continue;
		let container = el.parentElement;
		while (container && !tabbable.some((t) => container.contains(t))) container = container.parentElement;
		if (!container) continue;
		const group = groups.get(container) || { container, items: [] };
		group.items.push(el);
		groups.set(container, group);
	}
	return [...groups.values()].slice(0, limit).map(({ container, items }) => {
		const inside = tabbable.filter((t) => container.contains(t));
		// Arrows start from the Tab stop that looks like the items (the current item of the set), else the first one.
		const entry = inside.find((t) => t.localName === items[0].localName && t.getAttribute('role') === items[0].getAttribute('role')) || inside[0];
		// Arrow keys can also visit elements outside `items` (aria-disabled options, for one), so the walk through the
		// group may take as many presses as the group has focusable elements.
		const focusables = [...container.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')].filter((el) => A.isRendered(el)).length;
		return { path: A.cssPath(container), name: A.describe(container), entry: A.cssPath(entry), entryName: A.describe(entry), items: items.map((i) => A.cssPath(i)), names: items.map((i) => A.describe(i)), focusables };
	});
}

/**
 * 2.1.1 for controls with tabindex="-1": Tab skips them, so the arrow keys from the group's Tab stop have to reach
 * them (the roving tabindex pattern), or the same function has to be reachable another way. The probe presses Down
 * (then Right) from the Tab stop until focus leaves the group, stops moving, or comes round, and lists what it never
 * reached. Duplicates made for the pointer (a card's second link) show up here too: a person decides.
 */
async function rovingReach(page, { state, limit = 12 }) {
	const groups = await page.evaluate(findRovingGroups, limit);
	const findings = [];
	for (const g of groups) {
		if (!(await stillShown(page, g.entry))) continue;
		const reached = new Set();
		for (const key of ['ArrowDown', 'ArrowRight']) {
			await focusByKeyboard(page, g.entry);
			let last = g.entry;
			for (let i = 0; i < g.focusables + 2; i++) {
				await page.keyboard.press(key);
				await settle(page);
				const now = await keyState(page, g.path);
				if (!now.inside || now.path === last || now.path === g.entry || reached.has(now.path)) break;
				reached.add(now.path);
				last = now.path;
			}
			if (reached.size) break;
		}
		await blurActive(page);
		const missing = g.items.map((p, i) => ({ path: p, name: g.names[i] })).filter((item) => !reached.has(item.path));
		if (!missing.length) continue;
		findings.push(finding('kbd:roving-unreachable', { state, target: g.path, node: g.path, name: g.name, message: `${missing.length} of ${g.items.length} controls in ${g.name} have tabindex="-1" and the arrow keys from ${g.entryName} do not reach them (first: ${missing.slice(0, 3).map((m) => m.name).join('; ')}), unless the same function is reachable another way`, evidence: { entry: g.entry, missing: missing.slice(0, 10), reached: reached.size }, source: 'probe' }));
	}
	return findings;
}

// Runs in the page: closed buttons that open something (aria-expanded or aria-haspopup).
function findPopupTriggers(limit) {
	const A = window.__a11y;
	const tabbable = new Set(A.tabbables());
	return [...document.querySelectorAll('button[aria-expanded], [role="button"][aria-expanded], button[aria-haspopup], [role="button"][aria-haspopup]')]
		.filter((el) => tabbable.has(el) && !A.hiddenFromAT(el) && el.getAttribute('aria-expanded') !== 'true' && el.getAttribute('aria-haspopup') !== 'false' && el.getAttribute('aria-disabled') !== 'true')
		.slice(0, limit)
		.map((el) => ({ path: A.cssPath(el), name: A.describe(el), haspopup: el.getAttribute('aria-haspopup') }));
}

const listPopups = (page) => page.evaluate((selector) => [...document.querySelectorAll(selector)].filter((el) => window.__a11y.isRendered(el)).map((el) => window.__a11y.cssPath(el)), POPUP_SELECTOR);

// Runs in the page: what the trigger has open now (the element it controls, or a popup that was not showing before),
// and where focus is.
function openedBy([triggerPath, before, selector]) {
	const A = window.__a11y;
	const trigger = document.querySelector(triggerPath);
	const controlled = (trigger.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter((el) => el && A.isRendered(el));
	const fresh = [...document.querySelectorAll(selector)].filter((el) => A.isRendered(el) && !before.includes(A.cssPath(el)));
	const popup = controlled[0] || fresh[0] || null;
	let active = document.activeElement;
	while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
	const role = popup ? popup.getAttribute('role') || '' : '';
	return {
		expanded: trigger.getAttribute('aria-expanded') === 'true',
		popup: popup ? A.cssPath(popup) : null,
		kind: !popup ? null : popup.localName === 'dialog' || role === 'dialog' || role === 'alertdialog' ? 'dialog' : role || 'region',
		focusInside: !!popup && popup.contains(active),
		onTrigger: active === trigger,
		focus: !active || active === document.body ? '<body>' : A.describe(active)
	};
}

/**
 * Buttons that open a menu, list box, dialog or disclosure. Enter opens it; a dialog takes focus; Escape closes a
 * popup (a plain disclosure, such as an accordion section, stays open until toggled, so it is toggled back); and
 * focus returns to the button.
 */
async function popupKeys(page, { state, limit = 12 }) {
	const triggers = await page.evaluate(findPopupTriggers, limit);
	const findings = [];
	for (const t of triggers) {
		const add = (check, message, evidence) => findings.push(finding(check, { state, target: t.path, node: t.path, name: t.name, message, evidence, source: 'probe' }));
		if (!(await stillShown(page, t.path))) continue;
		const before = await listPopups(page);
		await focusByKeyboard(page, t.path);
		await page.keyboard.press('Enter');
		await settle(page);
		await page.waitForTimeout(250);
		const open = await page.evaluate(openedBy, [t.path, before, POPUP_SELECTOR]);
		if (!open.expanded && !open.popup) continue; // Enter opened nothing: custom buttons that ignore Enter are customControlKeys' job
		if (open.kind === 'dialog' && !open.focusInside) add('kbd:popup-focus', `Enter on ${t.name} opened a dialog but focus stayed on ${open.focus}`, open);
		const popupLike = (t.haspopup && t.haspopup !== 'false') || ['dialog', 'menu', 'listbox', 'tree', 'grid'].includes(open.kind);
		const toggleBack = async () => {
			await focusByKeyboard(page, t.path);
			await page.keyboard.press('Enter');
			await settle(page);
		};
		if (!popupLike) {
			await toggleBack();
			continue;
		}
		await page.keyboard.press('Escape');
		await settle(page);
		await page.waitForTimeout(200);
		const after = await page.evaluate(openedBy, [t.path, before, POPUP_SELECTOR]);
		if (after.expanded || (after.popup && after.popup === open.popup)) {
			add('kbd:popup-escape', `Escape does not close the ${open.kind || 'popup'} that ${t.name} opened (focus is on ${after.focus})`, after);
			await toggleBack();
			const still = await page.evaluate(openedBy, [t.path, before, POPUP_SELECTOR]);
			if (still.expanded || (still.popup && still.popup === open.popup)) break; // it stays open: later triggers may be behind it
		} else if (!after.onTrigger) {
			add('kbd:popup-focus', `After Escape closed the ${open.kind || 'popup'} that ${t.name} opened, focus is on ${after.focus} instead of the button`, after);
		}
	}
	await blurActive(page);
	return findings;
}

/**
 * 2.4.1. When the first Tab stop is a link to a spot on the same page, Enter on it moves keyboard focus there: focus
 * lands on the target, or the next Tab does (browsers move the Tab starting point to a target that cannot take focus).
 * A page whose first stop is not such a link is reported when many stops come before its main content.
 */
async function skipLink(page, { state, minStops = 6 }) {
	const info = await page.evaluate(() => {
		const A = window.__a11y;
		if (document.querySelector('[aria-modal="true"]:not([hidden]), dialog:modal')) return null;
		const order = A.tabbables().filter((el) => !(Number(el.getAttribute('tabindex')) > 0));
		const first = order[0];
		if (!first) return null;
		const main = document.querySelector('main, [role="main"]');
		const before = main ? order.filter((el) => !main.contains(el) && el.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).length : null;
		const url = first.localName === 'a' && first.href ? new URL(first.href) : null;
		const samePage = !!url && url.hash.length > 1 && url.origin + url.pathname + url.search === location.origin + location.pathname + location.search;
		if (!samePage) return { skip: false, before, first: A.describe(first) };
		const id = decodeURIComponent(url.hash.slice(1));
		const target = document.getElementById(id) || document.getElementsByName(id)[0] || null;
		return { skip: true, path: A.cssPath(first), name: A.describe(first), href: url.hash, target: target ? A.cssPath(target) : null, before };
	});
	if (!info) return [];
	const report = (check, message, extra = {}) => [finding(check, { state, target: info.path || null, node: info.path || null, name: info.name || info.first, message, evidence: info, source: 'probe', ...extra })];
	if (!info.skip) {
		if (info.before === null || info.before < minStops) return [];
		return report('kbd:no-skip-link', `${info.before} Tab stops come before the main content and the first, ${info.first}, is not a skip link. Landmarks let screen-reader users jump; keyboard-only users press Tab ${info.before} times on every page`, { bestPractice: true });
	}
	if (!info.target) return report('kbd:skip-link', `${info.name} points at ${info.href}, which is not on the page`);
	await focusByKeyboard(page, info.path);
	await page.keyboard.press('Enter');
	await settle(page);
	const landed = await keyState(page, info.target);
	let next = landed;
	if (!landed.inside) {
		await page.keyboard.press('Tab');
		await settle(page);
		next = await page.evaluate((targetPath) => {
			const target = document.querySelector(targetPath);
			let el = document.activeElement;
			while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
			const body = !el || el === document.body;
			return { inside: !body && (target.contains(el) || !!(target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), describe: body ? '<body>' : window.__a11y.describe(el) };
		}, info.target);
	}
	await blurActive(page);
	await page.evaluate(() => scrollTo(0, 0));
	if (next.inside) return [];
	return report('kbd:skip-link', `Enter on ${info.name} does not move keyboard focus to ${info.href}: focus stays on ${landed.describe} and the next Tab goes to ${next.describe}, before the target`);
}

// Keys a control with each widget role answers to (ARIA Authoring Practices).
const ROLE_KEYS = { button: ['Enter', ' '], link: ['Enter'], checkbox: [' '], switch: [' '], menuitem: ['Enter'], menuitemcheckbox: [' '], menuitemradio: [' '] };

// Runs in the page: Tab stops whose widget role comes from ARIA rather than from the element, with a pointer listener
// on them or on an ancestor below <body> (a document-wide listener says nothing about one control).
function findCustomControls([limit, roles]) {
	const A = window.__a11y;
	const NATIVE = 'a[href], area[href], button, input, select, textarea, summary, [contenteditable="true"]';
	const listening = new Set(['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].flatMap((type) => A.listenersOf(type)).filter((t) => t instanceof Element));
	const hasPointerListener = (el) => {
		for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) if (listening.has(n)) return true;
		return false;
	};
	return A.tabbables()
		.filter((el) => roles.includes(el.getAttribute('role')) && !el.matches(NATIVE) && el.getAttribute('aria-disabled') !== 'true' && !A.hiddenFromAT(el) && hasPointerListener(el))
		.slice(0, limit)
		.map((el) => ({ path: A.cssPath(el), name: A.describe(el), role: el.getAttribute('role') }));
}

/**
 * 2.1.1 for controls built from divs and spans: each key its role answers to (Enter and Space for a button) does
 * something. A click the key produces is caught at the window and cancelled, so the control's action does not run;
 * a key handler that acts directly is seen by what it changes, confirmed by running the key twice. The page cannot
 * scroll meanwhile, so Space scrolling the page is not taken for the control acting.
 */
async function customControlKeys(page, { state, limit = 15 }) {
	const controls = await page.evaluate(findCustomControls, [limit, Object.keys(ROLE_KEYS)]);
	const findings = [];
	for (const c of controls) {
		if (!(await stillShown(page, c.path))) continue;
		const failed = [];
		for (const key of ROLE_KEYS[c.role]) {
			await page.evaluate((path) => {
				const target = document.querySelector(path);
				const lock = document.createElement('style');
				lock.id = 'a11y-scroll-lock';
				lock.setAttribute('data-a11y-tool', '');
				lock.textContent = 'html, body { overflow: hidden !important; }';
				document.head.appendChild(lock);
				window.__a11yKeyClicks = 0;
				window.__a11yClickCatcher = (event) => {
					if (!(event.target instanceof Node) || !(target.contains(event.target) || event.target.contains(target))) return;
					window.__a11yKeyClicks++;
					event.preventDefault();
					event.stopImmediatePropagation();
				};
				window.addEventListener('click', window.__a11yClickCatcher, true);
			}, c.path);
			const result = await confirmedChange(page, () => page.keyboard.press(key), { quiet: 500, before: () => focusByKeyboard(page, c.path) });
			const clicks = await page.evaluate(() => {
				window.removeEventListener('click', window.__a11yClickCatcher, true);
				document.getElementById('a11y-scroll-lock').remove();
				return window.__a11yKeyClicks;
			});
			if (!clicks && !result.moved && !result.changed.length) failed.push(key === ' ' ? 'Space' : key);
		}
		await blurActive(page);
		if (failed.length) findings.push(finding('kbd:custom-control-keys', { state, target: c.path, node: c.path, name: c.name, message: `${c.name} has role ${c.role} and reacts to the pointer, but ${failed.join(' and ')} ${failed.length > 1 ? 'do' : 'does'} nothing on it (a native <${c.role === 'link' ? 'a href' : 'button'}> does this without code)`, evidence: { role: c.role, failed }, source: 'probe' }));
	}
	return findings;
}

/** The focus path drawn over a full-page screenshot: a numbered dot per stop, joined in Tab order. */
async function focusOrderMap(page, stops, file) {
	if (!stops.length) return null;
	await page.evaluate((points) => {
		const NS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('data-a11y-tool', 'focus-map');
		const width = Math.max(document.documentElement.scrollWidth, innerWidth), height = Math.max(document.documentElement.scrollHeight, innerHeight);
		svg.setAttribute('width', width);
		svg.setAttribute('height', height);
		svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:2147483647';
		const centre = (p) => [p.x + p.w / 2, p.y + p.h / 2];
		const line = document.createElementNS(NS, 'polyline');
		line.setAttribute('points', points.map((p) => centre(p).join(',')).join(' '));
		line.setAttribute('style', 'fill:none;stroke:#e0201d;stroke-width:2;stroke-opacity:0.7');
		svg.appendChild(line);
		points.forEach((p, i) => {
			const [cx, cy] = centre(p);
			const box = document.createElementNS(NS, 'rect');
			box.setAttribute('x', p.x); box.setAttribute('y', p.y); box.setAttribute('width', p.w); box.setAttribute('height', p.h);
			box.setAttribute('style', 'fill:none;stroke:#e0201d;stroke-width:1.5;stroke-dasharray:3 2');
			const dot = document.createElementNS(NS, 'circle');
			dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', 11);
			dot.setAttribute('style', 'fill:#e0201d');
			const label = document.createElementNS(NS, 'text');
			label.setAttribute('x', cx); label.setAttribute('y', cy + 4); label.setAttribute('text-anchor', 'middle');
			label.setAttribute('style', 'font:bold 11px Arial,sans-serif;fill:#fff');
			label.textContent = String(i + 1);
			svg.append(box, dot, label);
		});
		document.documentElement.appendChild(svg);
	}, stops.map((s) => ({ x: s.fixed ? s.rect.x : s.doc.x, y: s.fixed ? s.rect.y : s.doc.y, w: s.rect.w, h: s.rect.h })));
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	const viewport = page.viewportSize();
	await page.evaluate(() => scrollTo(0, 0));
	await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: viewport.width, height: Math.min(height, 16000) } });
	await page.evaluate(() => document.querySelector('[data-a11y-tool="focus-map"]')?.remove());
	return file;
}

module.exports = { keyboardWalk, targetSizes, pointerOnly, singleKeyShortcuts, downEventActivation, selectChanges, skipLink, arrowKeys, rovingReach, customControlKeys, popupKeys, focusOrderMap, settle, parseSnapshotLine };
