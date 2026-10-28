// The virtual screen reader (@guidepup/virtual-screen-reader), bundled for the browser with esbuild and run inside
// the page. It reads the accessibility tree the way a screen reader's browse mode does ("heading, Report, level 1",
// "button, Learn more, not expanded", "polite: Saved"), so its transcript shows reading order, names, roles, states
// and live-region speech without a real screen reader. It is a model of one: real VoiceOver and NVDA differ in
// wording and verbosity (voiceover.cjs runs the real one on macOS).
const { load, HOME } = require('./deps.cjs');
const { finding } = require('./checks.cjs');

let bundle = null;
function virtualBundle() {
	if (bundle) return bundle;
	const esbuild = load('esbuild');
	bundle = esbuild.buildSync({
		stdin: { contents: "import { virtual } from '@guidepup/virtual-screen-reader/browser.js'; window.__vsr = virtual;", resolveDir: HOME, loader: 'js' },
		bundle: true,
		format: 'iife',
		platform: 'browser',
		target: 'es2020',
		write: false,
		logLevel: 'error'
	}).outputFiles[0].text;
	return bundle;
}

async function install(page) {
	if (await page.evaluate(() => !!window.__vsr)) return;
	await page.addScriptTag({ content: virtualBundle() });
}

/**
 * Starts the virtual screen reader for the keyboard walk: `take()` returns what it said since the last call (it
 * follows real focus moves, so each Tab yields the announcement for the newly focused control).
 */
async function startSpeech(page) {
	await install(page);
	await page.evaluate(async () => {
		await window.__vsr.start({ container: document.body });
		window.__vsrSeen = (await window.__vsr.spokenPhraseLog()).length;
	});
	return {
		take: () => page.evaluate(async () => {
			const log = await window.__vsr.spokenPhraseLog();
			const fresh = log.slice(window.__vsrSeen);
			window.__vsrSeen = log.length;
			return fresh;
		}),
		stop: () => page.evaluate(() => window.__vsr.stop())
	};
}

/** Reads the page from top to bottom in browse mode. Each item: the phrase, the element it is on, and where it is. */
async function browseTranscript(page, { max = 4000 } = {}) {
	await install(page);
	return page.evaluate(async (limit) => {
		const v = window.__vsr;
		await v.start({ container: document.body });
		const items = [];
		let spoken = 0;
		for (let i = 0; i < limit; i++) {
			await v.next();
			const log = await v.spokenPhraseLog();
			const phrases = log.slice(spoken);
			spoken = log.length;
			const node = v.activeNode;
			const el = node && (node.nodeType === 1 ? node : node.parentElement);
			const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
			for (const phrase of phrases) items.push({ phrase, path: el ? window.__a11y.cssPath(el) : null, doc: r && r.width ? { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } : null });
			if (phrases.includes('end of document')) break;
		}
		await v.stop();
		return items;
	}, max);
}

const UNNAMED = new Set(['button', 'link', 'image', 'img', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'searchbox', 'listbox', 'option', 'treeitem', 'menuitemcheckbox', 'menuitemradio']);
const STRUCTURAL = /^(end of |document$|banner$|main$|contentinfo$|navigation|complementary|region|list$|listitem|group$|paragraph$|figure$|table$|row|cell|columnheader|rowheader|form$|search$|article$|section$|generic$)/;

/** Findings from a browse transcript: unnamed controls, redundant alternatives, reading-order jumps. */
function transcriptFindings(items, state) {
	const out = [];
	const content = items.filter((it) => !STRUCTURAL.test(it.phrase));
	for (const it of items) {
		if (UNNAMED.has(it.phrase.trim())) out.push(finding('sr:unnamed', { state, target: it.path, node: it.path, name: it.path, message: `The screen reader says only "${it.phrase}": no name tells the user what it is`, source: 'virtual-sr' }));
	}
	for (let i = 1; i < content.length; i++) {
		const a = content[i - 1], b = content[i];
		const [role, ...rest] = a.phrase.split(', ');
		const name = rest.join(', ').trim();
		if ((role === 'image' || role === 'link') && name.length > 3 && b.phrase.trim() === name) out.push(finding('sr:repetitive', { state, target: a.path, node: a.path, name: a.path, message: `"${name}" is read twice in a row: as the ${role}'s name and again as the next text`, source: 'virtual-sr' }));
	}
	let jumps = 0;
	for (let i = 1; i < content.length && jumps < 10; i++) {
		const a = content[i - 1].doc, b = content[i].doc;
		if (!a || !b || content[i].path === content[i - 1].path) continue;
		const up = b.y + b.h / 2 < a.y - Math.max(48, a.h);
		const newColumn = b.x > a.x + a.w * 0.5;
		if (up && !newColumn) {
			jumps++;
			out.push(finding('sr:reading-order-jump', { state, target: content[i].path, node: content[i].path, name: content[i].path, message: `Reading goes from "${content[i - 1].phrase.slice(0, 50)}" to "${content[i].phrase.slice(0, 50)}", ${Math.round(a.y - b.y)} px higher on the page`, source: 'virtual-sr' }));
		}
	}
	return out;
}

module.exports = { startSpeech, browseTranscript, transcriptFindings, virtualBundle };
