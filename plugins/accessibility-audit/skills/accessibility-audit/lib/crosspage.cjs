// Checks across the audited pages: repeated navigation keeps its relative order (3.2.3), one destination keeps one
// name (3.2.4), help and contact links sit in the same place (3.2.6), titles differ (2.4.2), and pages can be found
// more than one way (2.4.5).
const { finding } = require('./checks.cjs');

// Runs in the page.
function collect() {
	const A = window.__a11y;
	const nameOf = (a) => (a.getAttribute('aria-label') || A.text(a) || a.querySelector('img[alt]')?.alt || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
	const href = (a) => {
		const u = new URL(a.href, location.href);
		return u.origin + u.pathname.replace(/\/$/, '') + u.hash;
	};
	const linksIn = (root) => (root ? [...root.querySelectorAll('a[href]')].filter((a) => A.isRendered(a) && !a.closest('[data-a11y-tool]')).map((a) => ({ name: nameOf(a), href: href(a) })) : null);
	const top = (selector) => [...document.querySelectorAll(selector)].find((el) => !el.parentElement.closest('article, aside, section, main, nav')) || null;
	const regions = {};
	const banner = top('header, [role="banner"]');
	const footer = top('footer, [role="contentinfo"]');
	if (banner) regions.banner = linksIn(banner);
	if (footer) regions.footer = linksIn(footer);
	[...document.querySelectorAll('nav, [role="navigation"]')].filter((n) => A.isRendered(n)).forEach((nav, i) => {
		regions[`navigation "${nav.getAttribute('aria-label') || `#${i + 1}`}"`] = linksIn(nav);
	});
	const HELP = /contact|help|support|faq|chat|feedback/i;
	const help = [];
	for (const [region, links] of Object.entries(regions)) links?.forEach((l, i) => { if (HELP.test(l.name) || HELP.test(l.href)) help.push({ region, index: i, name: l.name, href: l.href }); });
	return {
		title: document.title.trim(),
		h1: [...document.querySelectorAll('h1')].map((h) => A.text(h)).join(' | '),
		regions,
		help,
		search: !!document.querySelector('[role="search"], input[type="search"], form[action*="search" i]'),
		sitemap: [...document.querySelectorAll('a[href]')].some((a) => /site-?map/i.test(a.getAttribute('href') + ' ' + A.text(a))),
		breadcrumbs: !!document.querySelector('nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i]')
	};
}

function crossPageFindings(pages) {
	const findings = [];
	const add = (check, page, message, evidence) => findings.push(finding(check, { state: page, target: null, node: `${check}|${message}`, name: page, message, evidence, source: 'cross-page' }));
	const entries = Object.entries(pages);
	if (entries.length < 2) return findings;

	// 3.2.3: links that every page's copy of a region shares must keep their relative order.
	const regionNames = new Set(entries.flatMap(([, p]) => Object.keys(p.regions)));
	for (const region of regionNames) {
		const having = entries.filter(([, p]) => p.regions[region]?.length);
		if (having.length < 2) continue;
		const common = having.map(([, p]) => new Set(p.regions[region].map((l) => l.href))).reduce((a, b) => new Set([...a].filter((h) => b.has(h))));
		const orderOf = (links) => links.map((l) => l.href).filter((h, i, all) => common.has(h) && all.indexOf(h) === i);
		const [refPage, ref] = having[0];
		const reference = orderOf(ref.regions[region]);
		for (const [pagePath, p] of having.slice(1)) {
			const order = orderOf(p.regions[region]);
			if (order.join('|') !== reference.join('|')) add('xpage:nav-inconsistent', pagePath, `The ${region} links shared with ${refPage} come in a different order on ${pagePath}`, { region, reference, order });
		}
	}

	// 3.2.4: one destination, one name, across the repeated regions.
	const names = new Map();
	for (const [pagePath, p] of entries) for (const links of Object.values(p.regions)) for (const l of links || []) {
		if (!l.name) continue;
		const set = names.get(l.href) || new Map();
		set.set(l.name.toLowerCase(), [...(set.get(l.name.toLowerCase()) || []), pagePath]);
		names.set(l.href, set);
	}
	for (const [href, byName] of names) {
		if (byName.size > 1) add('xpage:inconsistent-identification', [...byName.values()][0][0], `${href} is named ${[...byName.keys()].map((n) => `"${n}"`).join(', ')} on different pages`, { href, names: Object.fromEntries(byName) });
	}

	// 3.2.6: help in the same relative place on every page that has it.
	const withHelp = entries.filter(([, p]) => p.help.length);
	if (withHelp.length && withHelp.length < entries.length) {
		const missing = entries.filter(([, p]) => !p.help.length).map(([path]) => path);
		add('xpage:help-inconsistent', missing[0], `Help or contact links appear on ${withHelp.length} of ${entries.length} pages; missing on ${missing.join(', ')}`, { missing });
	}
	const placement = (p) => p.help.map((h) => `${h.region}#${h.href}`).join(' ');
	if (withHelp.length > 1) {
		const ref = placement(withHelp[0][1]);
		for (const [pagePath, p] of withHelp.slice(1)) if (placement(p) !== ref) add('xpage:help-inconsistent', pagePath, `Help links sit differently on ${pagePath} (${placement(p)}) than on ${withHelp[0][0]} (${ref})`, {});
	}

	// 2.4.2: distinct pages, distinct titles.
	const byTitle = new Map();
	for (const [pagePath, p] of entries) byTitle.set(p.title, [...(byTitle.get(p.title) || []), pagePath]);
	for (const [title, paths] of byTitle) if (paths.length > 1) add('xpage:duplicate-title', paths[1], `${paths.length} pages share the title "${title}": ${paths.join(', ')}`, { paths });

	// 2.4.5: more than one way to reach pages.
	const ways = new Set();
	for (const [, p] of entries) {
		if (Object.keys(p.regions).some((r) => r.startsWith('navigation') || r === 'banner')) ways.add('navigation');
		if (p.regions.footer?.length) ways.add('footer links');
		if (p.search) ways.add('search');
		if (p.sitemap) ways.add('site map');
		if (p.breadcrumbs) ways.add('breadcrumbs');
	}
	if (ways.size < 2) add('xpage:multiple-ways', entries[0][0], `Only ${[...ways].join(', ') || 'no way'} found to reach pages; WCAG 2.4.5 asks for two (navigation, search, site map, related links)`, { ways: [...ways] });
	return findings;
}

module.exports = { collect, crossPageFindings };
