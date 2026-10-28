// Page structure checks that run in the page in one pass, plus the inventories a person reviews by eye (headings
// outline, landmarks, every image with its alt, documents, frames, media, form fields). Each check is a heuristic
// for something axe and IBM do not decide; most produce "review" findings with the element and its context.
const { finding } = require('./checks.cjs');

// Runs in the page. Returns { hits: [{ check, path, name, message, evidence }], inventory }.
function scan() {
	const A = window.__a11y;
	const visible = (el) => A.isRendered(el) && !A.hiddenFromAT(el) && !el.closest('[data-a11y-tool]');
	const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
	const hits = [];
	const hit = (check, el, message, evidence) => hits.push({ check, path: A.cssPath(el), name: A.describe(el), message, evidence });
	const clip = (s, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
	const nameOf = (el) => {
		const ids = el.getAttribute('aria-labelledby');
		if (ids) return ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
		return (el.getAttribute('aria-label') || A.text(el) || [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
	};
	const contextOf = (el) => clip(A.text(el.closest('p, li, td, th, figcaption, dd, section, article') || el.parentElement || el));

	// ---- headings ----
	const headings = all('h1, h2, h3, h4, h5, h6, [role="heading"]').map((el) => ({ el, level: Number(el.getAttribute('aria-level') || el.localName.slice(1)) || 2, text: clip(A.text(el), 100) }));
	headings.forEach((h, i) => {
		const previous = headings[i - 1];
		if (previous && h.level > previous.level + 1) hit('struct:heading-skip', h.el, `h${previous.level} "${previous.text}" is followed by h${h.level} "${h.text}"`, { from: previous.level, to: h.level });
	});
	const ones = headings.filter((h) => h.level === 1);
	if (ones.length > 1) ones.slice(1).forEach((h) => hit('struct:multiple-h1', h.el, `${ones.length} level-1 headings on the page`, { count: ones.length }));

	// ---- text styled like a heading ----
	const paragraphSizes = all('p').map((p) => parseFloat(getComputedStyle(p).fontSize)).sort((a, b) => a - b);
	const base = paragraphSizes.length ? paragraphSizes[Math.floor(paragraphSizes.length / 2)] : parseFloat(getComputedStyle(document.body).fontSize);
	const NOT_HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"], a, button, label, legend, summary, th, caption, figcaption, [role="button"], [role="link"], [role="tab"], [role="menuitem"], option, nav, header nav, [aria-hidden="true"], svg';
	let lookalikes = 0;
	for (const el of all('p, div, span, strong, b, dt')) {
		if (lookalikes >= 15 || el.closest(NOT_HEADING)) continue;
		const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
		if (own.length < 3 || own.length > 120 || /^[\d\s.,%$€£+\-–—:/()]+$/.test(own) || own.replace(/[^a-z]/gi, '').length < 3) continue;
		const style = getComputedStyle(el);
		const size = parseFloat(style.fontSize);
		const weight = Number(style.fontWeight) || 400;
		if (!(size >= base * 1.25 && (weight >= 500 || size >= base * 1.5))) continue;
		if (A.text(el).length > own.length + 40) continue; // a container with more content inside, not a heading line
		lookalikes++;
		hit('struct:looks-like-heading', el, `"${clip(own, 80)}" is ${Math.round(size)}px/${weight} against ${Math.round(base)}px body text, but is not a heading`, { size, weight, base });
	}

	// ---- links ----
	const GENERIC = /^(click here|click|here|read more|learn more|more|more info|more information|details|link|this|this link|go|continue|download|view|view more|see more|find out more|read|start|open)$/i;
	const NEW_WINDOW = /new (tab|window)|opens in|external/i;
	const links = all('a[href], [role="link"]');
	const byName = new Map();
	const documents = [];
	for (const a of links) {
		const name = nameOf(a);
		const plain = name.toLowerCase().replace(/[\s←-⇿➔-➿→←↗↘›»«‹|:.,!?()\-–—]+/g, ' ').trim();
		if (plain && GENERIC.test(plain) && !a.hasAttribute('aria-describedby')) hit('struct:generic-link-text', a, `Link text "${name}" alone; context: "${contextOf(a)}"`, { context: contextOf(a) });
		const href = a.getAttribute('href') || '';
		if (plain && href && !href.startsWith('javascript:')) {
			const url = new URL(href, location.href);
			const key = url.origin + url.pathname.replace(/\/$/, '') + url.search + url.hash;
			if (!byName.has(plain)) byName.set(plain, new Map());
			if (!byName.get(plain).has(key)) byName.get(plain).set(key, a);
		}
		const target = (a.getAttribute('target') || '').toLowerCase();
		if (target && target !== '_self' && target !== '_parent' && target !== '_top') {
			const described = [name, a.getAttribute('title') || '', ...[...a.querySelectorAll('[aria-label], [title], img[alt]')].map((n) => n.getAttribute('aria-label') || n.getAttribute('title') || n.getAttribute('alt') || ''), (a.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')].join(' ');
			if (!NEW_WINDOW.test(described)) hit('struct:new-window-unannounced', a, `target="${target}" with no mention of a new tab or window in "${name}"`, {});
		}
		if (/\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub)(\?|#|$)/i.test(href)) documents.push({ href: new URL(href, location.href).href, name });
	}
	for (const [plain, targets] of byName) {
		if (targets.size < 2) continue;
		const [, ...others] = [...targets.values()];
		for (const a of others) hit('struct:ambiguous-link-text', a, `"${plain}" goes to ${targets.size} different places: ${[...targets.keys()].slice(0, 4).join(', ')}`, { destinations: [...targets.keys()] });
	}

	// ---- images and graphics ----
	const SUSPICIOUS_ALT = /(\.(png|jpe?g|gif|svg|webp|avif)$)|^(image|img|photo|picture|graphic|icon|logo|spacer|banner|untitled|placeholder|screenshot|dsc_?\d+|img_?\d+)$/i;
	const images = all('img, [role="img"], input[type="image"]').map((el) => {
		const alt = el.localName === 'img' || el.localName === 'input' ? el.getAttribute('alt') : nameOf(el);
		if (alt && (SUSPICIOUS_ALT.test(alt.trim()) || alt.length > 180)) hit('struct:image-alt-suspicious', el, alt.length > 180 ? `alt is ${alt.length} characters; long descriptions belong in text or a linked description` : `alt "${alt}" looks like a file name or placeholder`, { alt });
		const r = el.getBoundingClientRect();
		return { path: A.cssPath(el), src: (el.getAttribute('src') || '').split('/').pop().slice(0, 80), alt, size: `${Math.round(r.width)}x${Math.round(r.height)}` };
	});
	const NAMED_PARENT = 'a[href], button, [role="button"], [role="link"], [role="img"][aria-label], [role="img"][aria-labelledby], figure[aria-label], figure[aria-labelledby], [role="figure"][aria-label], [role="figure"][aria-labelledby]';
	for (const g of all('svg, canvas')) {
		const r = g.getBoundingClientRect();
		if (r.width < 48 || r.height < 32 || g.parentElement?.closest('svg')) continue;
		const role = g.getAttribute('role');
		if (role === 'presentation' || role === 'none') continue;
		const named = g.getAttribute('aria-label') || g.getAttribute('aria-labelledby') || (g.localName === 'svg' && g.querySelector(':scope > title')?.textContent.trim());
		if (named || g.closest(NAMED_PARENT) || g.closest('figure')?.querySelector('figcaption')) continue;
		if (g.localName === 'canvas' && A.text(g)) continue; // fallback content
		const shapes = g.localName === 'canvas' ? 2 : g.querySelectorAll('rect, path, circle, line, polygon, polyline, ellipse, text, image').length;
		if (shapes < 2) continue;
		hit('struct:graphic-no-alt', g, `${Math.round(r.width)}x${Math.round(r.height)} ${g.localName} with ${shapes} shapes, no name, not hidden: say what it shows, or hide it if decorative`, { shapes });
	}

	// ---- forms ----
	const PURPOSES = new Set('name honorific-prefix given-name additional-name family-name honorific-suffix nickname organization-title username new-password current-password one-time-code organization street-address address-line1 address-line2 address-line3 address-level4 address-level3 address-level2 address-level1 country country-name postal-code cc-name cc-given-name cc-additional-name cc-family-name cc-number cc-exp cc-exp-month cc-exp-year cc-csc cc-type transaction-currency transaction-amount language bday bday-day bday-month bday-year sex url photo tel tel-country-code tel-national tel-area-code tel-local tel-local-prefix tel-local-suffix tel-extension email impp'.split(' '));
	const PERSONAL = /e-?mail|phone|tel\b|mobile|first.?name|last.?name|full.?name|given|family|surname|address|street|city|town|zip|postal|postcode|country|organi[sz]ation|company|birth|bday|username|password/i;
	const fields = all('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea').map((el) => {
		const labelled = el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
		const type = (el.getAttribute('type') || el.localName).toLowerCase();
		if (!labelled && el.getAttribute('placeholder')) hit('struct:placeholder-only-label', el, `Only the placeholder "${el.getAttribute('placeholder')}" names this field; it disappears on typing`, {});
		const hint = [el.name, el.id, el.getAttribute('placeholder'), el.labels?.[0]?.textContent, el.getAttribute('aria-label')].join(' ');
		const personal = type === 'email' || type === 'tel' || (type !== 'search' && type !== 'checkbox' && type !== 'radio' && PERSONAL.test(hint));
		const tokens = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).filter(Boolean);
		if (personal && !tokens.some((t) => PURPOSES.has(t))) hit('struct:autocomplete-missing', el, `${type} field "${clip(A.text(el.labels?.[0] || el) || hint.trim(), 60)}" collects personal data but has autocomplete="${el.getAttribute('autocomplete') ?? ''}"`, { type });
		return { path: A.cssPath(el), type, label: clip((el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim(), 60), autocomplete: el.getAttribute('autocomplete'), required: el.required || el.getAttribute('aria-required') === 'true' };
	});
	const groups = new Map();
	for (const input of all('input[type="radio"], input[type="checkbox"]')) {
		if (!input.name) continue;
		const key = `${input.form ? A.cssPath(input.form) : 'doc'}|${input.type}|${input.name}`;
		groups.set(key, [...(groups.get(key) || []), input]);
	}
	for (const members of groups.values()) {
		if (members.length < 2) continue;
		const grouped = members[0].closest('fieldset')?.querySelector('legend') || members[0].closest('[role="radiogroup"][aria-label], [role="radiogroup"][aria-labelledby], [role="group"][aria-label], [role="group"][aria-labelledby]');
		if (!grouped) hit('struct:group-unlabeled', members[0], `${members.length} ${members[0].type} inputs named "${members[0].name}" without a fieldset legend or named group`, { size: members.length });
	}

	// ---- tables, lists, instructions ----
	for (const table of all('table')) {
		const role = table.getAttribute('role');
		if (role === 'presentation' || role === 'none') continue;
		const rows = table.rows.length;
		const cols = Math.max(0, ...[...table.rows].map((r) => r.cells.length));
		if (rows < 2 || cols < 2) continue;
		if (!table.querySelector('th, [scope], [headers], [role="columnheader"], [role="rowheader"]')) hit('struct:table-no-headers', table, `${rows}x${cols} table with no header cells; mark headers with <th> (or role="presentation" for layout)`, { rows, cols });
	}
	const BULLET = /^\s*([•·▪◦‣\-–*]|\d{1,2}[.)])\s+\S/;
	for (const el of all('p, div, span, td')) {
		if (el.closest('ul, ol, pre, code, [role="list"]') || el.children.length > 12) continue;
		const ownBreaks = el.querySelectorAll(':scope > br').length;
		if (!ownBreaks) continue;
		const lines = (el.innerText || '').split('\n').filter((l) => l.trim());
		if (lines.filter((l) => BULLET.test(l)).length >= 2) hit('struct:fake-list', el, `${lines.length} lines starting with bullet characters, not a list element`, { lines: lines.length });
	}
	const SENSORY = /\b(click|press|tap|select|choose|use|see|find|look at|follow)\b[^.!?]{0,60}\b(red|green|blue|orange|yellow|purple|pink|grey|gray|round|square|circular|triangle|left|right|above|below|top|bottom|upper|lower|corner)\b/i;
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const sensoryParents = new Set();
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const parent = node.parentElement;
		if (!parent || sensoryParents.has(parent) || parent.closest('code, pre, script, style, [data-a11y-tool]') || !visible(parent)) continue;
		const match = SENSORY.exec(node.textContent);
		if (match) {
			sensoryParents.add(parent);
			hit('struct:sensory-instruction', parent, `"${clip(match[0], 80)}": the instruction depends on colour, shape or position`, {});
		}
	}

	// ---- order: visual sequence of children against their source order ----
	const interesting = (el) => el.matches('a[href], button, input, select, textarea, [tabindex]') || !!el.querySelector('a[href], button, input, select, textarea, [tabindex]') || A.text(el).length > 0;
	for (const box of all('*')) {
		const display = getComputedStyle(box).display;
		if (!/flex|grid/.test(display)) continue;
		const kids = [...box.children].filter((k) => visible(k) && interesting(k) && getComputedStyle(k).position !== 'absolute' && getComputedStyle(k).position !== 'fixed');
		if (kids.length < 2) continue;
		const placed = kids.map((k, i) => ({ i, r: k.getBoundingClientRect() }));
		const rtl = getComputedStyle(box).direction === 'rtl';
		// Rows by vertical overlap (items of different heights centred in one row share a row), then by inline start.
		const rows = [];
		for (const item of [...placed].sort((a, b) => a.r.top - b.r.top)) {
			const row = rows.find((rw) => Math.min(rw.bottom, item.r.bottom) - Math.max(rw.top, item.r.top) >= 0.5 * Math.min(item.r.height, rw.bottom - rw.top));
			if (row) {
				row.items.push(item);
				row.top = Math.min(row.top, item.r.top);
				row.bottom = Math.max(row.bottom, item.r.bottom);
			} else rows.push({ top: item.r.top, bottom: item.r.bottom, items: [item] });
		}
		const visual = rows.flatMap((rw) => rw.items.sort((a, b) => (rtl ? b.r.right - a.r.right : a.r.left - b.r.left)));
		if (visual.some((v, i) => v.i !== i)) hit('struct:css-reorder', box, `${display} container shows its ${kids.length} children in the order ${visual.map((v) => v.i + 1).join(', ')} while the source (and Tab and screen readers) go 1 to ${kids.length}`, { visualOrder: visual.map((v) => v.i + 1) });
	}

	// ---- media ----
	const VIDEO_HOST = /youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|wistia|loom\.com|brightcove|kaltura|jwplayer|dailymotion|facebook\.com\/plugins\/video|player\./i;
	const media = [];
	for (const m of all('video, audio')) {
		const autoplay = m.hasAttribute('autoplay');
		const muted = m.hasAttribute('muted') || m.muted;
		if (autoplay && !muted) hit('media:autoplay-audio', m, `<${m.localName} autoplay> without muted plays sound on load`, {});
		const tracks = [...m.querySelectorAll('track')].map((t) => t.getAttribute('kind'));
		if (m.localName === 'video' && !tracks.some((k) => k === 'captions' || k === 'subtitles')) hit('media:captions-missing', m, 'Video has no captions or subtitles track (open captions burned into the video also pass: check)', {});
		if (m.localName === 'audio') hit('media:audio-transcript', m, 'Audio element: confirm a transcript is next to it', {});
		media.push({ path: A.cssPath(m), kind: m.localName, autoplay, muted, tracks });
	}
	const frames = [...document.querySelectorAll('iframe')].filter((f) => A.isRendered(f)).map((f) => {
		const src = f.getAttribute('src') || '';
		if (VIDEO_HOST.test(src)) {
			hit('media:embedded-video', f, `Embedded player (${src.split('/')[2] || src.slice(0, 40)}): confirm captions, audio description, keyboard access`, { src });
			if (/[?&]autoplay=1/.test(src) && !/[?&](mute|muted)=1/.test(src)) hit('media:autoplay-audio', f, 'Embedded player requests autoplay without mute', { src });
		}
		return { path: A.cssPath(f), src: src.slice(0, 120), title: f.getAttribute('title') };
	});

	// ---- dialogs ----
	for (const d of all('[role="dialog"], [role="alertdialog"], dialog[open]')) {
		const modal = d.getAttribute('aria-modal') === 'true' || (d.localName === 'dialog' && d.matches(':modal'));
		if (!modal) hit('struct:dialog-not-modal', d, 'Open dialog without aria-modal="true": confirm the page behind is meant to stay reachable', {});
	}

	const landmarks = all('header, nav, main, aside, footer, [role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"], [role="search"], [role="region"], [role="form"], form[aria-label], section[aria-label], section[aria-labelledby]')
		.filter((el) => !(el.localName === 'header' || el.localName === 'footer') || !el.parentElement.closest('article, aside, main, nav, section'))
		.map((el) => ({ role: el.getAttribute('role') || el.localName, name: el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim()) || '' }));
	return {
		hits,
		inventory: {
			title: document.title,
			lang: document.documentElement.getAttribute('lang'),
			headings: headings.map((h) => ({ level: h.level, text: h.text })),
			landmarks,
			images,
			documents,
			frames,
			media,
			fields,
			languageParts: [...document.querySelectorAll('body [lang]')].filter(visible).map((el) => ({ lang: el.getAttribute('lang'), text: clip(A.text(el), 60) })),
			links: links.length
		}
	};
}

/** Structure findings and the page inventory for one state. */
async function structureChecks(page, state) {
	const { hits, inventory } = await page.evaluate(scan);
	return { findings: hits.map((h) => finding(h.check, { state, target: h.path, node: h.path, name: h.name, message: h.message, evidence: h.evidence, source: 'structure' })), inventory };
}

module.exports = { structureChecks };
