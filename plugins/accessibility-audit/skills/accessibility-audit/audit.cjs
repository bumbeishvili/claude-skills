#!/usr/bin/env node
// The automated accessibility audit. For every state in the config it runs, in one browser context:
//   axe-core and IBM Equal Access (WCAG 2.2 A/AA plus best practice), Chrome's own Issues, page structure checks,
//   pixel-measured contrast, target size, pointer-only controls, the keyboard walk (with the virtual screen reader
//   speaking each stop), a focus order map, the browse-mode transcript, hover and focus content, and probes for the
//   skip link, single-key shortcuts, press activation, select changes, arrow keys in widgets, Enter and Space on
//   custom controls, and buttons that open popups.
// Then, per page: reflow, 200% zoom, text spacing, sticky bars, orientation, reduced motion, auto-moving content;
// across pages: consistency, titles, ways to navigate; linked PDFs; and the scripted flows.
//
//   node audit.cjs --config a11y.config.cjs [--states home,menu] [--skip hover,visual] [--out dir] [--browser firefox]
//
// Writes <out>/summary.md (the report), findings.json, and per-state data, screenshots, focus maps, transcripts
// and accessibility snapshots. Headless; the headed review is headed.cjs.
const fs = require('fs');
const path = require('path');
const { load, resolveFile } = require('./lib/deps.cjs');
const { initScript } = require('./lib/inpage.cjs');
const { runAxe, runIbm, watchChromeIssues } = require('./lib/engines.cjs');
const { structureChecks } = require('./lib/structure.cjs');
const { resolveIncompleteContrast, svgTextContrast, iconContrast, controlBoundaries } = require('./lib/contrast.cjs');
const kbd = require('./lib/keyboard.cjs');
const { startSpeech, browseTranscript, transcriptFindings } = require('./lib/sr.cjs');
const { hoverChecks } = require('./lib/hover.cjs');
const { visualChecks } = require('./lib/visual.cjs');
const { collect, crossPageFindings } = require('./lib/crosspage.cjs');
const { documentChecks } = require('./lib/documents.cjs');
const { runFlow, helpers } = require('./lib/flows.cjs');
const { writeReport, coverageFrom } = require('./lib/report.cjs');

const LAYERS = ['engines', 'structure', 'contrast', 'keyboard', 'speech', 'hover', 'probes', 'visual', 'crosspage', 'documents', 'flows'];
const PREFIX_OF = { engines: [], structure: ['struct', 'media'], contrast: ['px', 'vis'], keyboard: ['kbd'], speech: ['sr'], hover: ['hover'], probes: ['kbd'], visual: ['vis', 'motion'], crosspage: ['xpage'], documents: ['doc'], flows: ['flow'] };

function parseArgs(argv) {
	const args = { states: null, skip: [], only: null, out: null, browser: 'chromium' };
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].split('=');
		const value = () => inline ?? argv[++i];
		if (flag === '--config') args.config = value();
		else if (flag === '--states') args.states = value().split(',');
		else if (flag === '--skip') args.skip = value().split(',');
		else if (flag === '--only') args.only = value().split(',');
		else if (flag === '--out') args.out = value();
		else if (flag === '--browser') args.browser = value();
		else throw new Error(`Unknown argument ${argv[i]}. Usage: node audit.cjs --config <file> [--states a,b] [--skip layer,...] [--only layer,...] [--out dir] [--browser chromium|firefox|webkit]`);
	}
	if (!args.config) throw new Error('Missing --config <file>; start from templates/audit.config.example.cjs');
	for (const layer of [...args.skip, ...(args.only || [])]) if (!LAYERS.includes(layer)) throw new Error(`Unknown layer "${layer}"; layers: ${LAYERS.join(', ')}`);
	return args;
}

function loadConfig(file) {
	const full = path.resolve(file);
	const config = require(full);
	if (!config.baseUrl) throw new Error(`${file}: baseUrl is required`);
	if (!Array.isArray(config.states) || !config.states.length) throw new Error(`${file}: states must list at least one { id, path }`);
	const ids = new Set();
	for (const s of config.states) {
		if (!s.id || typeof s.path !== 'string') throw new Error(`${file}: every state needs an id and a path (got ${JSON.stringify(s)})`);
		if (ids.has(s.id)) throw new Error(`${file}: state id "${s.id}" is used twice`);
		ids.add(s.id);
	}
	const viewports = { desktop: { width: 1440, height: 900 }, ...(config.viewports || {}) };
	return { ...config, viewports, dir: path.dirname(full), pages: config.pages || [...new Set(config.states.map((s) => s.path))], flows: config.flows || [], exclude: config.exclude || [], block: (config.block || []).map((b) => (b instanceof RegExp ? b : new RegExp(b))) };
}

function contextOptions(config, viewportName, extra = {}) {
	const vp = config.viewports[viewportName];
	if (!vp) throw new Error(`Unknown viewport "${viewportName}"; config.viewports has ${Object.keys(config.viewports).join(', ')}`);
	const base = vp.viewport ? { ...vp } : { viewport: vp };
	delete base.defaultBrowserType;
	return { ...base, bypassCSP: true, locale: config.locale || 'en-US', reducedMotion: 'no-preference', ...extra };
}

async function defaultReady(page) {
	await page.waitForLoadState('networkidle', { timeout: 30000 });
}

/** A fresh context and page at `pagePath`, with third parties blocked, recorders installed and the page ready. */
async function openPage(browser, config, options, pagePath, { issues = false } = {}) {
	const context = await browser.newContext(options);
	for (const pattern of config.block) await context.route(pattern, (route) => route.abort());
	await context.addInitScript(initScript);
	if (config.init) await context.addInitScript(config.init);
	const page = await context.newPage();
	const startedAt = Date.now(); // a recorded video starts with the page
	// Windows the app opens (window.open, target=_blank) are closed; axe opens a helper page of its own, left alone.
	page.on('popup', (popup) => popup.close());
	const chrome = issues && browser.browserType().name() === 'chromium' ? await watchChromeIssues(context, page) : null;
	const response = await page.goto(new URL(pagePath, config.baseUrl).href, { waitUntil: 'load', timeout: 60000 });
	if (response && response.status() >= 400) throw new Error(`${pagePath} returned HTTP ${response.status()}`);
	await (config.ready || defaultReady)(page);
	await page.evaluate(() => document.fonts.ready);
	await kbd.settle(page);
	return { context, page, chrome, startedAt, close: () => context.close() };
}

/**
 * Engine findings carry a selector (axe) or an XPath (IBM); resolve both to the audit's own element path, so the
 * report can merge what several engines say about one element. IBM's paths are walked step by step by element name,
 * because document.evaluate does not match SVG elements by name in HTML documents, and they continue into frames.
 */
async function attachNodes(page, findings) {
	const paths = await page.evaluate((items) => {
		const fromXPath = (xpath) => {
			let node = document;
			const prefix = [];
			for (const step of xpath.split('/').filter(Boolean)) {
				const m = /^([\w-]+)\[(\d+)\]$/.exec(step);
				if (!m) return null;
				let parent = node;
				if (node.nodeType === 1 && node.localName === 'iframe') {
					prefix.push(window.__a11y.cssPath(node));
					parent = node.contentDocument;
				}
				if (!parent) return null;
				node = [...parent.children].filter((c) => c.localName === m[1])[Number(m[2]) - 1];
				if (!node) return null;
			}
			return { node, prefix };
		};
		return items.map(({ selector, xpath }) => {
			if (selector) {
				let el = null;
				try {
					el = document.querySelector(selector);
				} catch {
					return null; // a selector into a frame or shadow root: the row keeps the engine's own target
				}
				return el ? window.__a11y.cssPath(el) : null;
			}
			if (!xpath) return null;
			const found = fromXPath(xpath);
			if (!found || found.node.nodeType !== 1) return null;
			const inner = found.node.ownerDocument === document ? window.__a11y.cssPath(found.node) : found.node.localName;
			return [...found.prefix, inner].join(' >>> ');
		});
	}, findings.map((f) => ({ selector: f.selector, xpath: f.xpath })));
	findings.forEach((f, i) => (f.node = paths[i] || f.target));
}

async function runState(browser, config, state, layer, dirs, shared) {
	const viewport = state.viewport || 'desktop';
	const result = { id: state.id, path: state.path, viewport, error: null, findings: [], stops: 0, inventory: 0, reached: 0, end: '', map: null, transcript: null, structure: null, tested: [] };
	const started = Date.now();
	let opened = null;
	try {
		opened = await openPage(browser, config, contextOptions(config, viewport, { reducedMotion: state.reducedMotion || 'no-preference', colorScheme: state.colorScheme }), state.path, { issues: layer('engines') });
		const { page } = opened;
		if (state.setup) {
			await state.setup(page, { ...helpers(page), press: (key) => page.keyboard.press(key) });
			await kbd.settle(page);
			await page.waitForTimeout(state.wait ?? 300);
		}
		const findings = result.findings;
		if (layer('engines')) {
			const axe = await runAxe(page, { state: state.id, exclude: config.exclude });
			const ibm = await runIbm(page, { state: state.id });
			await attachNodes(page, [...axe.findings, ...ibm.findings]);
			findings.push(...axe.findings, ...ibm.findings);
			result.tested.push(...axe.tested, ...ibm.tested);
			shared.axeVersion = axe.version;
			result.contrastIncomplete = axe.contrastIncomplete;
		}
		if (layer('structure')) {
			const s = await structureChecks(page, state.id);
			findings.push(...s.findings);
			result.structure = s.inventory;
		}
		const scroll = await page.evaluate(() => [scrollX, scrollY]);
		if (layer('contrast')) {
			if (result.contrastIncomplete) findings.push(...(await resolveIncompleteContrast(page, result.contrastIncomplete, state.id)).findings);
			findings.push(...(await svgTextContrast(page, state.id)).findings);
			findings.push(...(await iconContrast(page, state.id)).findings);
			findings.push(...(await controlBoundaries(page, state.id)));
			await page.evaluate(([x, y]) => scrollTo(x, y), scroll);
		}
		if (layer('keyboard')) {
			const pointer = await kbd.pointerOnly(page, { state: state.id });
			findings.push(...pointer);
			findings.push(...(await kbd.targetSizes(page, { state: state.id, extraPaths: pointer.map((p) => p.target) })));
			const speech = layer('speech') ? await startSpeech(page) : null;
			const walk = await kbd.keyboardWalk(page, { state: state.id, speech, measureFocus: state.measureFocus ?? config.measureFocus ?? true, maxStops: state.maxStops || config.maxStops || 400, outDir: dirs.shots });
			if (speech) await speech.stop();
			findings.push(...walk.findings);
			Object.assign(result, { stops: walk.stops.length, inventory: walk.inventory, end: walk.end, reverse: walk.reverse });
			result.reached = walk.stops.length;
			result.walk = walk.stops.map((s) => ({ n: s.n, snapshot: s.snapshot, speech: s.speech, path: s.path, indicator: s.indicator?.status, covered: s.covered, landmark: s.landmark }));
			const map = path.join(dirs.maps, `${state.id}.jpg`);
			if (await kbd.focusOrderMap(page, walk.stops, map)) result.map = path.relative(dirs.out, map);
		}
		if (layer('speech')) {
			const items = await browseTranscript(page, { max: config.transcriptMax || 4000 });
			findings.push(...transcriptFindings(items, state.id));
			const file = path.join(dirs.transcripts, `${state.id}.txt`);
			fs.writeFileSync(file, items.map((it) => it.phrase).join('\n') + '\n');
			result.transcript = path.relative(dirs.out, file);
			if (result.walk) fs.writeFileSync(path.join(dirs.transcripts, `${state.id}-tab.txt`), result.walk.map((s) => `${s.n}. ${s.speech.join(' | ') || s.snapshot}`).join('\n') + '\n');
		}
		if (layer('hover')) findings.push(...(await hoverChecks(page, { state: state.id, seen: shared.hovered(viewport) })).findings);
		fs.writeFileSync(path.join(dirs.aria, `${state.id}.yml`), await page.locator('body').ariaSnapshot());
		await page.evaluate(() => scrollTo(0, 0));
		await page.screenshot({ path: path.join(dirs.shots, `${state.id}.png`) });
		if (layer('probes')) {
			findings.push(...(await kbd.skipLink(page, { state: state.id })));
			findings.push(...(await kbd.singleKeyShortcuts(page, { state: state.id })).findings);
			findings.push(...(await kbd.downEventActivation(page, { state: state.id })));
			findings.push(...(await kbd.selectChanges(page, { state: state.id })));
			findings.push(...(await kbd.arrowKeys(page, { state: state.id })));
			findings.push(...(await kbd.rovingReach(page, { state: state.id })));
			findings.push(...(await kbd.customControlKeys(page, { state: state.id })));
			findings.push(...(await kbd.popupKeys(page, { state: state.id }))); // last: a popup that will not close stays open
		}
		if (opened.chrome) findings.push(...(await opened.chrome.findings(state.id)));
	} catch (error) {
		result.error = error.message.split('\n')[0];
		console.error(`  ${state.id}: ${error.stack}`);
	} finally {
		if (opened) await opened.close();
	}
	result.ms = Date.now() - started;
	return result;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const config = loadConfig(args.config);
	const layer = (name) => (args.only ? args.only.includes(name) : !args.skip.includes(name)) && !(config.skip || []).includes(name);
	const out = path.resolve(args.out || config.out || path.join(process.cwd(), '_raw', 'a11y'));
	const dirs = { out, shots: path.join(out, 'shots'), maps: path.join(out, 'maps'), transcripts: path.join(out, 'transcripts'), aria: path.join(out, 'aria'), states: path.join(out, 'states') };
	for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

	const playwright = load('playwright');
	if (!playwright[args.browser]) throw new Error(`Unknown browser ${args.browser}`);
	const browser = await playwright[args.browser].launch({ headless: true });
	const hovered = new Map();
	const shared = { hovered: (vp) => hovered.get(vp) || hovered.set(vp, new Set()).get(vp) };
	const states = config.states.filter((s) => !args.states || args.states.includes(s.id));
	if (args.states) for (const id of args.states) if (!states.some((s) => s.id === id)) throw new Error(`--states: no state "${id}" in the config`);

	const findings = [];
	const results = [];
	for (const state of states) {
		process.stdout.write(`state ${state.id} (${state.path}, ${state.viewport || 'desktop'}) … `);
		const r = await runState(browser, config, state, layer, dirs, shared);
		results.push(r);
		findings.push(...r.findings);
		fs.writeFileSync(path.join(dirs.states, `${state.id}.json`), JSON.stringify(r, null, 1));
		const fails = r.findings.filter((f) => f.outcome === 'fail').length;
		console.log(r.error ? `ERROR ${r.error}` : `${r.findings.length} findings (${fails} fail), ${r.stops} Tab stops, ${(r.ms / 1000).toFixed(1)}s`);
	}

	const desktopName = config.desktopViewport || 'desktop';
	const open = (pagePath) => async (extra) => openPage(browser, config, { ...contextOptions(config, desktopName), ...extra }, pagePath);
	if (layer('visual')) {
		for (const pagePath of config.pages) {
			process.stdout.write(`page ${pagePath}: reflow, zoom, spacing, sticky, orientation, motion … `);
			const id = `page${pagePath.replace(/[^\w]+/g, '-').replace(/-$/, '') || '-home'}`;
			const v = await visualChecks(open(pagePath), { pagePath, pageId: id, desktop: contextOptions(config, desktopName).viewport, outDir: dirs.shots });
			findings.push(...v.findings);
			fs.writeFileSync(path.join(dirs.states, `${id}.json`), JSON.stringify(v, null, 1));
			console.log(`${v.findings.length} findings`);
		}
	}
	if (layer('crosspage') && config.pages.length > 1) {
		const pages = {};
		for (const pagePath of config.pages) {
			const { page, close } = await open(pagePath)({});
			pages[pagePath] = await page.evaluate(collect);
			await close();
		}
		const x = crossPageFindings(pages);
		findings.push(...x);
		fs.writeFileSync(path.join(dirs.states, 'cross-page.json'), JSON.stringify(pages, null, 1));
		console.log(`cross-page: ${x.length} findings over ${config.pages.length} pages`);
	}
	let documents = [];
	if (layer('documents')) {
		const linked = results.flatMap((r) => (r.structure?.documents || []).map((d) => ({ ...d, page: r.id })));
		if (linked.length) {
			const context = await browser.newContext();
			const d = await documentChecks(context.request, linked, { outDir: out });
			await context.close();
			findings.push(...d.findings);
			documents = d.results;
			console.log(`documents: ${documents.length} checked, ${d.findings.length} findings`);
		}
	}
	const flows = [];
	if (layer('flows')) {
		for (const flow of config.flows) {
			let opened = null;
			try {
				opened = await openPage(browser, config, contextOptions(config, flow.viewport || 'desktop'), flow.path);
				const f = await runFlow(opened.page, flow);
				findings.push(...f.findings);
				flows.push({ id: flow.id, transcript: f.transcript });
				console.log(`flow ${flow.id}: ${f.findings.length} findings`);
			} catch (error) {
				flows.push({ id: flow.id, transcript: [], error: error.message.split('\n')[0] });
				console.error(`flow ${flow.id}: ${error.stack}`);
			} finally {
				if (opened) await opened.close();
			}
		}
	}

	const ran = new Set(LAYERS.filter(layer).flatMap((l) => PREFIX_OF[l]));
	if (!config.flows.length) ran.delete('flow');
	if (config.pages.length < 2) ran.delete('xpage');
	const version = (pkg) => JSON.parse(fs.readFileSync(resolveFile(`${pkg}/package.json`), 'utf8')).version;
	const meta = {
		name: config.name || config.baseUrl,
		baseUrl: config.baseUrl,
		date: new Date().toISOString().slice(0, 10),
		browser: `${args.browser} ${browser.version()}`,
		axeVersion: shared.axeVersion || 'not run',
		ibmVersion: version('accessibility-checker-engine'),
		vsrVersion: version('@guidepup/virtual-screen-reader'),
		pages: config.pages,
		layers: LAYERS.filter(layer)
	};
	const inventories = Object.fromEntries(results.filter((r) => r.structure).map((r) => [r.id, r.structure]));
	const { rows } = writeReport(out, { findings, coverage: coverageFrom(results.flatMap((r) => r.tested), ran), meta, states: results, documents, inventories, flows });
	await browser.close();
	const fails = rows.filter((r) => r.outcome === 'fail' && !r.bestPractice).length;
	console.log(`\n${rows.length} rows after merging ${findings.length} findings: ${fails} failures. Report: ${path.join(out, 'summary.md')}`);
	if (results.some((r) => r.error)) process.exitCode = 2;
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error.stack || error.message);
		process.exit(1);
	});
}

module.exports = { loadConfig, openPage, contextOptions, runState, LAYERS };
