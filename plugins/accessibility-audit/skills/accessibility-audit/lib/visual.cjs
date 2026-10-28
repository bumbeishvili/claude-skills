// Page-level visual checks, each in its own browser context because each needs a different window or preference:
//   reflow at 320 CSS px (400% zoom of a 1280 px window), 200% zoom (half the desktop window at 2x scale), the WCAG
//   1.4.12 text-spacing override, fixed and sticky bars at zoomed-in window heights, portrait against landscape,
//   reduced motion, and a six-second watch for content that moves or updates on its own (2.2.2).
// Clipping and overflow are compared against the page's own desktop state, so an ellipsis the design always shows
// is not reported as a zoom failure.
const path = require('path');
const { finding } = require('./checks.cjs');

const TEXT_SPACING_CSS = `*, *::before, *::after { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

// Runs in the page: elements whose text is cut off (overflow hidden or clip, or an ellipsis, with content larger
// than the box). Visually-hidden helpers (1px boxes) are left out.
function clippedText() {
	const A = window.__a11y;
	const out = [];
	for (const el of document.querySelectorAll('body *')) {
		if (el.closest('[data-a11y-tool], svg, canvas, iframe, video') || !A.isRendered(el)) continue;
		const r = el.getBoundingClientRect();
		if (r.width < 4 || r.height < 4) continue;
		const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
		if (!own) continue;
		const s = getComputedStyle(el);
		const hidesY = s.overflowY === 'hidden' || s.overflowY === 'clip';
		const hidesX = s.overflowX === 'hidden' || s.overflowX === 'clip';
		const overY = el.scrollHeight > el.clientHeight + 1;
		const overX = el.scrollWidth > el.clientWidth + 1;
		if ((hidesY && overY) || (hidesX && overX) || (s.textOverflow === 'ellipsis' && overX) || (s.webkitLineClamp !== 'none' && s.webkitLineClamp && overY)) {
			out.push({ path: A.cssPath(el), name: A.describe(el), by: `${overY ? el.scrollHeight - el.clientHeight + 'px tall' : el.scrollWidth - el.clientWidth + 'px wide'}` });
		}
	}
	return out;
}

// Runs in the page: what pushes the page sideways. Data tables, code, media, maps and diagrams may scroll in their
// own box (1.4.10 exception); the page itself may not.
function horizontalOverflow() {
	const A = window.__a11y;
	const width = document.documentElement.clientWidth;
	const scrolls = document.documentElement.scrollWidth > width + 1;
	const offenders = [];
	if (scrolls) {
		for (const el of document.querySelectorAll('body *')) {
			if (el.closest('[data-a11y-tool], table, pre, code, svg, canvas, video, iframe, [role="img"], [role="application"], [data-a11y-reflow-exempt]') || !A.isRendered(el)) continue;
			const r = el.getBoundingClientRect();
			if (r.right <= width + 1 || r.width === 0) continue;
			let contained = false;
			for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
				const s = getComputedStyle(p);
				if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.getBoundingClientRect().right <= width + 1) { contained = true; break; }
			}
			if (contained || offenders.some((o) => o.el.contains(el))) continue;
			offenders.push({ el, path: A.cssPath(el), name: A.describe(el), right: Math.round(r.right), width: Math.round(r.width) });
			if (offenders.length >= 6) break;
		}
	}
	return { scrolls, scrollWidth: document.documentElement.scrollWidth, width, offenders: offenders.map(({ el, ...rest }) => rest) };
}

// Runs in the page: how much of the window fixed and sticky elements cover, at the top and after scrolling down.
async function stickyCover() {
	const measure = () => {
		const ranges = [];
		for (const el of document.querySelectorAll('body *')) {
			if (el.closest('[data-a11y-tool]')) continue;
			const p = getComputedStyle(el).position;
			if (p !== 'fixed' && p !== 'sticky') continue;
			if (!window.__a11y.isRendered(el)) continue;
			const r = el.getBoundingClientRect();
			if (r.bottom <= 0 || r.top >= innerHeight || r.width < innerWidth * 0.5) continue;
			ranges.push([Math.max(0, r.top), Math.min(innerHeight, r.bottom)]);
		}
		ranges.sort((a, b) => a[0] - b[0]);
		let covered = 0, end = -1;
		for (const [top, bottom] of ranges) {
			if (bottom <= end) continue;
			covered += bottom - Math.max(top, end);
			end = bottom;
		}
		return covered / innerHeight;
	};
	const atTop = measure();
	scrollTo(0, document.documentElement.scrollHeight / 2);
	await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	const scrolled = measure();
	scrollTo(0, 0);
	return { atTop: +atTop.toFixed(2), scrolled: +scrolled.toFixed(2) };
}

// Runs in the page: animations still running (CSS and Web Animations), and whether scrolling is smooth.
function runningMotion() {
	const A = window.__a11y;
	const out = [];
	for (const animation of document.getAnimations()) {
		if (animation.playState !== 'running') continue;
		const timing = animation.effect?.getComputedTiming?.();
		const target = animation.effect?.target;
		if (!timing || !target || !(target instanceof Element) || !A.isRendered(target)) continue;
		if (timing.iterations === Infinity || timing.activeDuration > 1000) out.push({ path: A.cssPath(target), name: A.describe(target), animation: animation.animationName || animation.transitionProperty || 'animation', infinite: timing.iterations === Infinity, ms: Math.round(timing.activeDuration) });
	}
	const smooth = [document.documentElement, document.body].some((el) => getComputedStyle(el).scrollBehavior === 'smooth');
	return { animations: out.slice(0, 10), smooth };
}

// Runs in the page: watches DOM changes for `ms` and returns elements that changed in at least three separate
// seconds (carousels, tickers, timers), plus media that is playing.
async function watchMotion(ms) {
	const A = window.__a11y;
	const seconds = new Map();
	const start = performance.now();
	const observer = new MutationObserver((mutations) => {
		const second = Math.floor((performance.now() - start) / 1000);
		for (const m of mutations) {
			const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
			if (!t || t.closest('[data-a11y-tool]') || t === document.documentElement || t === document.body) continue;
			const set = seconds.get(t) || new Set();
			set.add(second);
			seconds.set(t, set);
		}
	});
	observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
	await new Promise((r) => setTimeout(r, ms));
	observer.disconnect();
	const changing = [...seconds].filter(([el, set]) => set.size >= 3 && el.isConnected && A.isRendered(el));
	const outermost = changing.filter(([el]) => !changing.some(([other]) => other !== el && other.contains(el)));
	const playing = [...document.querySelectorAll('video, audio')].filter((m) => !m.paused && !m.ended && A.isRendered(m));
	const infinite = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations === Infinity && a.effect.target instanceof Element && A.isRendered(a.effect.target));
	return {
		changing: outermost.slice(0, 8).map(([el, set]) => ({ path: A.cssPath(el), name: A.describe(el), seconds: set.size })),
		playing: playing.map((m) => ({ path: A.cssPath(m), name: A.describe(m) })),
		infinite: [...new Set(infinite.map((a) => a.effect.target))].slice(0, 8).map((el) => ({ path: A.cssPath(el), name: A.describe(el) }))
	};
}

/**
 * All visual checks for one page path. `open(options)` gives a fresh, ready page in a new context with the given
 * context options; the runner supplies it (it applies blocking, init scripts and the ready condition).
 */
async function visualChecks(open, { pagePath, pageId, desktop, outDir }) {
	const findings = [];
	const evidence = {};
	const add = (check, target, message, extra = {}) => findings.push(finding(check, { state: pageId, target: target?.path ?? null, node: target?.path ?? null, name: target?.name ?? pageId, message, evidence: extra, source: 'visual' }));
	const shot = async (page, name) => {
		const file = `${pageId}-${name}.png`;
		await page.screenshot({ path: path.join(outDir, file) });
		evidence[name] = file;
		return file;
	};

	// Desktop baseline, then the text-spacing override on the same page.
	{
		const { page, close } = await open({ viewport: desktop });
		const before = new Set((await page.evaluate(clippedText)).map((c) => c.path));
		evidence.desktopClipped = before.size;
		await page.addStyleTag({ content: TEXT_SPACING_CSS });
		await page.waitForTimeout(400);
		const after = (await page.evaluate(clippedText)).filter((c) => !before.has(c.path));
		await shot(page, 'text-spacing');
		for (const c of after.slice(0, 10)) add('vis:text-spacing-clip', c, `${c.name} is cut off by ${c.by} once the WCAG text spacing is applied`, { shot: evidence['text-spacing'] });
		evidence.baselineClipped = [...before];
		await close();
	}

	// 200% zoom: half the desktop window at twice the scale.
	{
		const { page, close } = await open({ viewport: { width: Math.round(desktop.width / 2), height: Math.round(desktop.height / 2) }, deviceScaleFactor: 2 });
		const overflow = await page.evaluate(horizontalOverflow);
		const clipped = (await page.evaluate(clippedText)).filter((c) => !evidence.baselineClipped.includes(c.path));
		await shot(page, 'zoom-200');
		if (overflow.scrolls) add('vis:zoom-overflow', overflow.offenders[0], `At 200% zoom the page is ${overflow.scrollWidth} px wide in a ${overflow.width} px window; widest: ${overflow.offenders.map((o) => `${o.name} to ${o.right}px`).join('; ')}`, { ...overflow, shot: evidence['zoom-200'] });
		for (const c of clipped.slice(0, 8)) add('vis:zoom-clip', c, `${c.name} is cut off by ${c.by} at 200% zoom`, { shot: evidence['zoom-200'] });
		await close();
	}

	// Reflow at 320 CSS px.
	{
		const { page, close } = await open({ viewport: { width: 320, height: 640 } });
		const overflow = await page.evaluate(horizontalOverflow);
		await shot(page, 'reflow-320');
		if (overflow.scrolls) add('vis:reflow-overflow', overflow.offenders[0], `At 320 CSS px the page is ${overflow.scrollWidth} px wide; pushing it: ${overflow.offenders.map((o) => `${o.name} (${o.width}px, to ${o.right}px)`).join('; ')}`, { ...overflow, shot: evidence['reflow-320'] });
		await close();
	}

	// Fixed and sticky bars in zoomed-in windows: 400% of 1280x1024 and 200% of 1280x720.
	for (const [label, viewport] of [['320x256', { width: 320, height: 256 }], ['640x360', { width: 640, height: 360 }]]) {
		const { page, close } = await open({ viewport });
		const cover = await page.evaluate(stickyCover);
		evidence[`sticky-${label}`] = cover;
		if (Math.max(cover.atTop, cover.scrolled) > 0.4) {
			await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 2));
			await page.waitForTimeout(200);
			const file = await shot(page, `sticky-${label}`);
			add('vis:sticky-cover', null, `In a ${label} window (a zoomed-in screen) fixed and sticky bars cover ${Math.round(Math.max(cover.atTop, cover.scrolled) * 100)}% of the height (${Math.round(cover.atTop * 100)}% at the top, ${Math.round(cover.scrolled * 100)}% scrolled)`, { ...cover, shot: file });
		}
		await close();
	}

	// Portrait against landscape on a phone.
	{
		const text = () => document.body.innerText.replace(/\s+/g, ' ').trim().length;
		const portrait = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const portraitText = await portrait.page.evaluate(text);
		await portrait.close();
		const landscape = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
		const landscapeText = await landscape.page.evaluate(text);
		const locks = await landscape.page.evaluate(() => window.__a11y.orientationLocks);
		await shot(landscape.page, 'landscape');
		await landscape.close();
		evidence.orientation = { portraitText, landscapeText, locks };
		if (locks.length || landscapeText < portraitText * 0.5) add('vis:orientation-lock', null, locks.length ? `The page calls screen.orientation.lock(${locks.map((l) => l.type).join(', ')})` : `Landscape shows ${landscapeText} characters of text against ${portraitText} in portrait`, { ...evidence.orientation, shot: evidence.landscape });
	}

	// Reduced motion requested.
	{
		const { page, close } = await open({ viewport: desktop, reducedMotion: 'reduce' });
		await page.waitForTimeout(1500);
		const motion = await page.evaluate(runningMotion);
		evidence.reducedMotion = motion;
		for (const a of motion.animations.slice(0, 6)) add('motion:ignores-reduced-motion', a, `${a.name} keeps animating (${a.infinite ? 'looping' : `${a.ms} ms`}) with reduced motion requested`, a);
		if (motion.smooth) add('motion:smooth-scroll', null, 'scroll-behavior: smooth stays on with reduced motion requested', {});
		await close();
	}

	// Content that moves or updates by itself for more than five seconds.
	{
		const { page, close } = await open({ viewport: desktop });
		const watched = await page.evaluate(watchMotion, 6500);
		evidence.motionWatch = watched;
		for (const c of watched.changing) add('motion:auto-moving', c, `${c.name} changed in ${c.seconds} separate seconds of a 6.5-second watch with no input: it needs a pause, stop or hide control unless it is essential`, c);
		for (const m of watched.playing) add('motion:auto-moving', m, `${m.name} is playing on its own`, m);
		for (const a of watched.infinite) if (!watched.changing.some((c) => c.path === a.path)) add('motion:auto-moving', a, `${a.name} runs a looping animation`, a);
		await close();
	}

	return { findings, evidence };
}

module.exports = { visualChecks, TEXT_SPACING_CSS };
