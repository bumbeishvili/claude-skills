// Contrast measured from pixels, for what computed styles cannot settle: text over gradients, images or other
// elements (axe's "incomplete" colour-contrast nodes), SVG text (axe skips it), and icon-only controls. Each element
// is captured twice, as drawn and with its text or icon made transparent, so the second image is exactly what sits
// behind it (png.textContrast). Form field boundaries (1.4.11) are judged from computed colours.
const png = require('./png.cjs');
const { finding } = require('./checks.cjs');

const HIDE_ATTR = 'data-a11y-hide';
const PROBE_ATTR = 'data-a11y-probe';
const COVER_ATTR = 'data-a11y-cover';
const HIDE_CSS = `[${HIDE_ATTR}="text"], [${HIDE_ATTR}="text"] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; fill: transparent !important; stroke: transparent !important; }
[${HIDE_ATTR}="graphic"], [${COVER_ATTR}] { visibility: hidden !important; }
[${PROBE_ATTR}], [${PROBE_ATTR}] * { pointer-events: auto !important; }`;

async function ensureHideStyle(page) {
	await page.evaluate((css) => {
		if (document.getElementById('a11y-hide-style')) return;
		const style = document.createElement('style');
		style.id = 'a11y-hide-style';
		style.setAttribute('data-a11y-tool', '');
		style.textContent = css;
		document.head.appendChild(style);
	}, HIDE_CSS);
}

/** Scrolls the element into the middle of the window and returns its clip rectangle, or null if it has no area. */
async function clipOf(handle) {
	return handle.evaluate((el) => {
		el.scrollIntoView({ block: 'center', inline: 'nearest' });
		const r = el.getBoundingClientRect();
		const x = Math.max(0, Math.floor(r.left)), y = Math.max(0, Math.floor(r.top));
		const right = Math.min(innerWidth, Math.ceil(r.right)), bottom = Math.min(innerHeight, Math.ceil(r.bottom));
		return right - x >= 2 && bottom - y >= 2 ? { x, y, width: right - x, height: bottom - y } : null;
	});
}

/**
 * True when something else is painted over the element: an open menu's backdrop, a dialog, a panel. The elements on
 * top at three points across it are hidden for one screenshot; when that changes at least 5% of the pixels, the
 * element sits under them and is measured in the state where nothing covers it. A transparent element on top (a
 * card's stretched link) changes nothing and is ignored. The element takes pointer events for the probe, so text
 * with pointer-events: none is not mistaken for covered by the chart or card behind it.
 */
async function paintedOver(page, handle, clip, drawn) {
	const covers = await handle.evaluate((el, [probe, cover]) => {
		el.setAttribute(probe, '');
		const r = el.getBoundingClientRect();
		const found = new Set();
		for (const fx of [0.2, 0.5, 0.8]) {
			const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2);
			if (top && top !== el && !el.contains(top) && !top.contains(el) && !top.closest('[data-a11y-tool]')) found.add(top);
		}
		el.removeAttribute(probe);
		for (const c of found) c.setAttribute(cover, '');
		return found.size;
	}, [PROBE_ATTR, COVER_ATTR]);
	if (!covers) return false;
	const uncovered = png.decode(await page.screenshot({ clip, animations: 'disabled' }));
	await page.evaluate((attr) => {
		for (const c of document.querySelectorAll(`[${attr}]`)) c.removeAttribute(attr);
	}, COVER_ATTR);
	return png.compare(drawn, uncovered, { minRatio: 1 }).changed >= 0.05 * drawn.width * drawn.height;
}

/** Captures `handle` as drawn and with `mode` ("text" or "graphic") hidden; null when it cannot be measured. */
async function twoShots(page, handle, mode) {
	const clip = await clipOf(handle);
	if (!clip) return null;
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	const drawn = png.decode(await page.screenshot({ clip, animations: 'disabled' }));
	if (await paintedOver(page, handle, clip, drawn)) return null;
	await handle.evaluate((el, [attr, value]) => el.setAttribute(attr, value), [HIDE_ATTR, mode]);
	const hidden = png.decode(await page.screenshot({ clip, animations: 'disabled' }));
	await handle.evaluate((el, attr) => el.removeAttribute(attr), HIDE_ATTR);
	return { clip, drawn, hidden };
}

const describeText = (el) => {
	const style = getComputedStyle(el);
	const isSvg = el instanceof SVGElement;
	const colour = window.__a11y.parseColor(isSvg ? style.fill : style.color);
	let size = parseFloat(style.fontSize);
	if (isSvg && el.getScreenCTM()) {
		const m = el.getScreenCTM();
		size *= Math.hypot(m.a, m.b);
	}
	const weight = Number(style.fontWeight) || 400;
	return { colour, size, weight, large: size >= 24 || (size >= 18.66 && weight >= 700), text: window.__a11y.text(el).slice(0, 60), path: window.__a11y.cssPath(el), name: window.__a11y.describe(el) };
};

async function measureText(page, handle, check, state) {
	const info = await handle.evaluate(describeText);
	if (!info.colour || info.colour.a === 0 || !info.text) return null;
	const shots = await twoShots(page, handle, 'text');
	if (!shots) return null;
	const result = png.textContrast(shots.drawn, shots.hidden, info.colour.rgb, { alpha: info.colour.a });
	if (!result.glyphPixels) return null;
	// A lone symbol with no letters or digits (✕, ›, ▾) works as an icon: 3:1 under 1.4.11, not the text minimum.
	const symbol = !/[\p{L}\p{N}]/u.test(info.text);
	const need = symbol || info.large ? 3 : 4.5;
	const evidence = { ...result, need, colour: info.colour, sizePx: +info.size.toFixed(1), weight: info.weight, symbol };
	if (result.p10 >= need) return { pass: true, evidence };
	return {
		pass: false,
		evidence,
		finding: finding(symbol ? 'px:icon-contrast' : check, { state, target: info.path, node: info.path, name: info.name, message: `"${info.text}" measures ${result.p10}:1 (lowest ${result.min}:1, median ${result.median}:1) against what is drawn behind it; ${need}:1 needed for ${symbol ? 'a symbol used as an icon' : info.large ? 'large text' : 'normal text'}`, evidence, source: 'pixels' })
	};
}

/** Resolves axe's undecided colour-contrast nodes by measurement. */
async function resolveIncompleteContrast(page, incomplete, state, { limit = 60 } = {}) {
	await ensureHideStyle(page);
	const findings = [];
	let measured = 0;
	for (const node of incomplete.slice(0, limit)) {
		if (!node.selector) continue;
		const handle = await page.$(node.selector);
		if (!handle) continue;
		const result = await measureText(page, handle, 'px:text-contrast', state);
		await handle.dispose();
		if (!result) continue;
		measured++;
		if (!result.pass) findings.push({ ...result.finding, evidence: { ...result.finding.evidence, axeReason: node.reason } });
	}
	return { findings, measured, skipped: Math.max(0, incomplete.length - limit) };
}

/** SVG text: up to three samples per distinct colour and size, since charts repeat one style many times. */
async function svgTextContrast(page, state) {
	await ensureHideStyle(page);
	const handles = await page.$$('svg text, svg tspan');
	const seen = new Map();
	const findings = [];
	for (const handle of handles) {
		// Text hidden from assistive technology still has to be readable on screen, so aria-hidden charts count too.
		const key = await handle.evaluate((el) => {
			if (!window.__a11y.isRendered(el)) return null;
			if (el.localName === 'text' && el.querySelector('tspan')) return null; // measured through its tspans
			const s = getComputedStyle(el);
			return el.textContent.trim() ? `${s.fill}|${s.fontSize}|${s.fontWeight}` : null;
		});
		if (!key || (seen.get(key) || 0) >= 3) {
			await handle.dispose();
			continue;
		}
		seen.set(key, (seen.get(key) || 0) + 1);
		const result = await measureText(page, handle, 'px:svg-text-contrast', state);
		await handle.dispose();
		if (result && !result.pass) findings.push(result.finding);
	}
	return { findings, styles: seen.size };
}

/** Icon-only buttons and links: the icon's pixels against the background with the icon hidden. */
async function iconContrast(page, state, { limit = 40 } = {}) {
	await ensureHideStyle(page);
	const controls = await page.$$('button, a[href], [role="button"]');
	const findings = [];
	let measured = 0;
	for (const control of controls) {
		if (measured >= limit) break;
		const icon = await control.evaluateHandle((el) => {
			if (!window.__a11y.isRendered(el) || window.__a11y.text(el)) return null;
			const graphics = [...el.querySelectorAll('svg, img')].filter((g) => window.__a11y.isRendered(g));
			return graphics.length === 1 ? graphics[0] : null;
		});
		const element = icon.asElement();
		if (!element) {
			await control.dispose();
			continue;
		}
		const shots = await twoShots(page, element, 'graphic');
		if (shots) {
			measured++;
			const diff = png.compare(shots.hidden, shots.drawn, { minRatio: 3 });
			if (diff.changed > 0 && diff.p90Ratio < 3) {
				const info = await control.evaluate((el) => ({ path: window.__a11y.cssPath(el), name: window.__a11y.describe(el) }));
				findings.push(finding('px:icon-contrast', { state, target: info.path, node: info.path, name: info.name, message: `Icon pixels reach ${diff.p90Ratio}:1 (p90) against the background; 3:1 needed when the icon carries meaning`, evidence: diff, source: 'pixels' }));
			}
		}
		await element.dispose();
		await control.dispose();
	}
	return { findings, measured };
}

/** Text fields, selects and custom checkboxes: their boundary (border or fill) against what surrounds them. */
async function controlBoundaries(page, state) {
	const hits = await page.evaluate(() => {
		const A = window.__a11y;
		const out = [];
		const fields = [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="range"]):not([type="color"]), select, textarea')]
			.filter((el) => A.isRendered(el) && !A.hiddenFromAT(el));
		// Contrast of a box's edge (border or fill) against what surrounds it; null when it draws no edge at all.
		const edge = (box) => {
			const style = getComputedStyle(box);
			const outside = A.backgroundOf(box.parentElement);
			if (!outside) return { unknown: true };
			const own = A.parseColor(style.backgroundColor);
			const fills = own && own.a > 0.5 ? [A.contrast(A.backgroundOf(box) || own.rgb, outside)] : [];
			const borders = ['Top', 'Right', 'Bottom', 'Left']
				.filter((side) => parseFloat(style[`border${side}Width`]) >= 1 && style[`border${side}Style`] !== 'none')
				.map((side) => A.parseColor(style[`border${side}Color`]))
				.filter((c) => c && c.a > 0.5)
				.map((c) => A.contrast(c.rgb, outside));
			const drawn = fills.length || borders.length;
			return drawn ? { best: Math.max(...fills, ...borders), border: style.borderBottomColor, background: `rgb(${outside})` } : null;
		};
		for (const el of fields) {
			if ((el.type === 'checkbox' || el.type === 'radio') && getComputedStyle(el).appearance !== 'none') continue; // drawn by the browser
			// A borderless field inside a wrapper that draws the box (search icon and input in one bordered div).
			let box = el;
			let measured = edge(el);
			const r = el.getBoundingClientRect();
			for (let p = el.parentElement; !measured && p && p !== document.body; p = p.parentElement) {
				const pr = p.getBoundingClientRect();
				if (pr.height > r.height + 32 || pr.width > r.width + 120) break;
				box = p;
				measured = edge(p);
			}
			if (!measured || measured.unknown) continue; // no edge anywhere, or an image behind: the headed pass decides
			if (measured.best < 3) out.push({ path: A.cssPath(el), name: A.describe(el), box: box === el ? 'the field' : A.describe(box), best: +measured.best.toFixed(2), border: measured.border, background: measured.background });
		}
		return out;
	});
	return hits.map((h) => finding('vis:control-border-contrast', { state, target: h.path, node: h.path, name: h.name, message: `The edge of ${h.box} reaches ${h.best}:1 against the page (border ${h.border} on ${h.background}); 3:1 needed to see where to click or type`, evidence: h, source: 'computed' }));
}

module.exports = { resolveIncompleteContrast, svgTextContrast, iconContrast, controlBoundaries };
