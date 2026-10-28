// The in-page half of the audit, installed with context.addInitScript so it runs in every page and frame before the
// page's own scripts. It records what a screen reader and a keyboard user would notice while the audit drives the
// page, and exposes the DOM helpers every check uses, as window.__a11y.
//
// Recorders: live-region announcements (with politeness, and whether the region was created already holding the
// text, which screen readers often skip), focus moves, event listeners by type (evidence for pointer-only controls,
// single-key shortcuts, down-event activation, motion actuation), window.open and history changes, orientation
// locks, and a mutation count that probes use to see whether a key press or pointer press changed the page.
// Nodes the audit itself draws carry data-a11y-tool and are left out of every recorder.

function initScript() {
	if (window.__a11y) return;
	const TOOL = '[data-a11y-tool]';
	const now = () => Math.round(performance.now());

	// ---- event listener registry ----
	const LISTENED = new Set(['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keyup', 'keypress', 'mouseenter', 'mouseover', 'mouseleave', 'mouseout', 'focus', 'focusin', 'blur', 'focusout', 'devicemotion', 'deviceorientation', 'dragstart', 'drop', 'pointermove', 'touchmove']);
	const listeners = [];
	const describeTarget = (t) => (t === window ? 'window' : t === document ? 'document' : t instanceof Element ? t : null);
	const originalAdd = EventTarget.prototype.addEventListener;
	EventTarget.prototype.addEventListener = function (type, fn, options) {
		if (LISTENED.has(type)) {
			const target = describeTarget(this);
			if (target) listeners.push({ type, ref: typeof target === 'string' ? target : new WeakRef(target) });
		}
		return originalAdd.call(this, type, fn, options);
	};
	for (const prop of ['onclick', 'onmousedown', 'onpointerdown', 'ontouchstart', 'onkeydown', 'onkeypress']) {
		const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
		if (!descriptor || !descriptor.set) continue;
		Object.defineProperty(HTMLElement.prototype, prop, {
			configurable: true,
			enumerable: descriptor.enumerable,
			get: descriptor.get,
			set(value) {
				if (value) listeners.push({ type: prop.slice(2), ref: new WeakRef(this) });
				descriptor.set.call(this, value);
			}
		});
	}

	// ---- window.open, history and orientation ----
	const navigations = [];
	const originalOpen = window.open;
	window.open = function (...args) {
		navigations.push({ t: now(), kind: 'window.open', url: String(args[0] ?? '') });
		return originalOpen.apply(this, args);
	};
	for (const method of ['pushState', 'replaceState']) {
		const original = history[method];
		history[method] = function (...args) {
			navigations.push({ t: now(), kind: `history.${method}`, url: String(args[2] ?? '') });
			return original.apply(this, args);
		};
	}
	window.addEventListener('hashchange', () => navigations.push({ t: now(), kind: 'hashchange', url: location.href }));
	const orientationLocks = [];
	if (screen.orientation && screen.orientation.lock) {
		const originalLock = screen.orientation.lock.bind(screen.orientation);
		screen.orientation.lock = (type) => {
			orientationLocks.push({ t: now(), type });
			return originalLock(type);
		};
	}

	// ---- live regions, mutations, focus ----
	const announcements = [];
	const focusLog = [];
	let mutationCount = 0;
	const lastText = new WeakMap();
	const liveRegionOf = (node) => {
		for (let el = node && (node.nodeType === 1 ? node : node.parentElement); el; el = el.parentElement) {
			const live = el.getAttribute('aria-live');
			if (live === 'off') return null;
			const role = el.getAttribute('role');
			if (live === 'polite' || live === 'assertive') return { el, politeness: live, role };
			if (role === 'alert') return { el, politeness: 'assertive', role };
			if (role === 'status' || role === 'log' || role === 'timer' || role === 'marquee') return { el, politeness: 'polite', role };
			if (el.tagName === 'OUTPUT') return { el, politeness: 'polite', role: 'status' };
		}
		return null;
	};
	const record = (region, created) => {
		const text = (region.el.textContent || '').replace(/\s+/g, ' ').trim();
		if (!text || lastText.get(region.el) === text) return;
		lastText.set(region.el, text);
		announcements.push({ t: now(), politeness: region.politeness, role: region.role, text: text.slice(0, 300), created, region: cssPath(region.el) });
	};
	const observer = new MutationObserver((mutations) => {
		for (const m of mutations) {
			const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
			if (target && target.closest && target.closest(TOOL)) continue;
			mutationCount++;
			// A live region added together with its text: screen readers usually announce only changes to a region
			// that already existed, so this is recorded with created: true.
			for (const added of m.addedNodes) {
				if (added.nodeType !== 1 || added.closest(TOOL)) continue;
				const own = liveRegionOf(added);
				if (own && own.el === added) record(own, true);
				for (const inner of added.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"], output')) {
					const region = liveRegionOf(inner);
					if (region && region.el === inner) record(region, true);
				}
			}
			const region = liveRegionOf(m.target);
			if (region) record(region, false);
		}
	});
	const startObserving = () => {
		observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-live', 'role', 'hidden', 'style', 'class', 'aria-hidden'] });
		// Text present in live regions on load is not an announcement; remember it so only changes count.
		for (const el of document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"], output')) {
			lastText.set(el, (el.textContent || '').replace(/\s+/g, ' ').trim());
		}
	};
	if (document.documentElement) startObserving();
	else document.addEventListener('readystatechange', startObserving, { once: true });
	document.addEventListener('focusin', (e) => {
		if (e.target.closest && e.target.closest(TOOL)) return;
		focusLog.push({ t: now(), path: cssPath(e.target) });
	}, true);

	// ---- DOM helpers ----
	function cssPath(el) {
		if (!(el instanceof Element)) return el === document ? 'document' : String(el);
		const parts = [];
		for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
			if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
				parts.unshift(`#${CSS.escape(node.id)}`);
				break;
			}
			const tag = node.localName;
			const parent = node.parentElement;
			const same = parent ? [...parent.children].filter((c) => c.localName === tag) : [];
			parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
		}
		return parts.join(' > ') || 'html';
	}
	const text = (el) => (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
	function describe(el) {
		if (!(el instanceof Element)) return String(el);
		const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
		const label = el.getAttribute('aria-label') || text(el) || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
		return `<${el.localName}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}>${label ? ` "${label.slice(0, 60)}"` : ''}`;
	}
	function isRendered(el) {
		if (!(el instanceof Element) || !el.isConnected) return false;
		const style = getComputedStyle(el);
		if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none') return false;
		const rects = el.getClientRects();
		return rects.length > 0 && [...rects].some((r) => r.width > 0 && r.height > 0);
	}
	const hiddenFromAT = (el) => !!el.closest('[aria-hidden="true"], [inert], [hidden]');
	const NATIVE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable=""], [contenteditable="true"]';
	/** Elements a keyboard user can reach with Tab: rendered, enabled, not inert or aria-hidden, tabindex >= 0. */
	function tabbables(root = document) {
		const found = [...root.querySelectorAll(`${NATIVE}, [tabindex]`)];
		return found.filter((el) => {
			if (el.closest(TOOL) || el.disabled || el.closest('[inert]') || !isRendered(el)) return false;
			const tabindex = el.getAttribute('tabindex');
			if (tabindex !== null && Number(tabindex) < 0) return false;
			if (tabindex === null && !el.matches(NATIVE)) return false;
			if (el.matches('summary') && el.parentElement?.localName !== 'details') return false;
			return true;
		});
	}
	function parseColor(value) {
		const m = String(value).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
		if (!m) return null;
		const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
		return { rgb: [+m[1], +m[2], +m[3]], a: alpha };
	}
	const channel = (v) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
	const contrast = (a, b) => {
		const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
		return (hi + 0.05) / (lo + 0.05);
	};
	/**
	 * The solid colour behind an element, compositing translucent layers up the tree. Returns null when an ancestor
	 * paints an image or gradient: then only the pixel-based check can say what is behind.
	 */
	function backgroundOf(el) {
		const layers = [];
		for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (style.backgroundImage && style.backgroundImage !== 'none') return null;
			const colour = parseColor(style.backgroundColor);
			if (colour && colour.a > 0) {
				layers.push(colour);
				if (colour.a >= 0.99) break;
			}
		}
		let result = [255, 255, 255];
		for (const layer of layers.reverse()) result = result.map((c, i) => Math.round(layer.rgb[i] * layer.a + c * (1 - layer.a)));
		return result;
	}
	const docRect = (el) => {
		const r = el.getBoundingClientRect();
		return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
	};
	const LANDMARK = 'header, nav, main, aside, footer, form[aria-label], form[aria-labelledby], section[aria-label], section[aria-labelledby], [role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"], [role="search"], [role="region"], [role="form"], [role="dialog"], [role="alertdialog"], dialog';
	function landmarkOf(el) {
		const lm = el.closest(LANDMARK);
		return lm ? `${lm.getAttribute('role') || lm.localName}${lm.getAttribute('aria-label') ? ` "${lm.getAttribute('aria-label')}"` : ''}` : 'none';
	}
	/** Elements with a listener of `type` attached directly (frameworks that delegate to the root hide these). */
	function listenersOf(type) {
		return listeners.filter((l) => l.type === type).map((l) => (typeof l.ref === 'string' ? l.ref : l.ref.deref())).filter(Boolean);
	}

	window.__a11y = {
		cssPath, describe, text, isRendered, hiddenFromAT, tabbables, parseColor, luminance, contrast, backgroundOf, docRect, landmarkOf, listenersOf,
		listeners, navigations, orientationLocks, announcements, focusLog,
		mutations: () => mutationCount,
		drainAnnouncements: () => announcements.splice(0),
		drainFocusLog: () => focusLog.splice(0),
		drainNavigations: () => navigations.splice(0)
	};
}

module.exports = { initScript };
