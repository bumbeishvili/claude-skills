#!/usr/bin/env node
// The real VoiceOver pass (macOS): VoiceOver is switched on, driven through a state of the site, and every phrase it
// speaks is recorded, as reading order (VO-Right), heading, link and landmark navigation, and Tab. The transcripts
// sit next to the virtual screen reader's, so a person can compare what the model predicted with what VoiceOver says.
//
// VoiceOver speaks aloud and takes over the keyboard and screen while it runs. Ask the person at this machine first,
// then pass --confirm. It needs VoiceOver automation enabled once per machine: the person runs
// `npx @guidepup/setup setup` in their own terminal (setup.sh --check reports it).
//
//   node voiceover.cjs --config a11y.config.cjs --state home --confirm [--browser chromium|safari] [--max 120]
//                      [--modes browse,headings,links,landmarks,tab] [--out dir]
// Safari is the pairing review teams use with VoiceOver; it opens the URL in the person's own Safari, so states with
// a setup function need --browser chromium (Playwright's Chrome for Testing), which runs the setup first.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { load } = require('./lib/deps.cjs');
const { loadConfig, openPage, contextOptions } = require('./audit.cjs');
const kbd = require('./lib/keyboard.cjs');

const APP_ID = { chromium: 'com.google.chrome.for.testing', safari: 'com.apple.Safari' };
const MODES = ['browse', 'headings', 'links', 'landmarks', 'tab'];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
	const args = { browser: 'chromium', max: 120, modes: MODES, confirm: false, out: null };
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].split('=');
		const value = () => inline ?? argv[++i];
		if (flag === '--config') args.config = value();
		else if (flag === '--state') args.state = value();
		else if (flag === '--browser') args.browser = value();
		else if (flag === '--max') args.max = Number(value());
		else if (flag === '--modes') args.modes = value().split(',');
		else if (flag === '--out') args.out = value();
		else if (flag === '--confirm') args.confirm = true;
		else throw new Error(`Unknown argument ${argv[i]}`);
	}
	if (!args.config || !args.state) throw new Error('Usage: node voiceover.cjs --config <file> --state <id> --confirm');
	if (!APP_ID[args.browser]) throw new Error(`--browser must be chromium or safari, got ${args.browser}`);
	for (const m of args.modes) if (!MODES.includes(m)) throw new Error(`Unknown mode ${m}; modes: ${MODES.join(', ')}`);
	return args;
}

function automationEnabled() {
	let defaults = '';
	try {
		defaults = execFileSync('defaults', ['read', 'com.apple.VoiceOver4/default', 'SCREnableAppleScript'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		defaults = ''; // the key is absent until automation has been enabled
	}
	return defaults === '1' && fs.existsSync('/private/var/db/Accessibility/.VoiceOverAppleScriptEnabled');
}

// Puts the VoiceOver cursor in the page's web content through the Item Chooser, as @guidepup/playwright does
// (MIT licence): a hidden marker input gives the content something to land on.
async function enterWebContent(voiceOver, g) {
	const cancel = () => voiceOver.perform({ keyCode: g.MacOSKeyCodes.Control }, { capture: false });
	for (let attempt = 0; attempt < 10; attempt++) {
		await cancel();
		await delay(100);
		await voiceOver.perform({ keyCode: g.MacOSKeyCodes.Escape }, { capture: false });
		await delay(100);
		await voiceOver.perform(g.voiceOverKeyCodeCommands.openItemChooser, { capture: true });
		if ((await voiceOver.lastSpokenPhrase()).toLowerCase().includes('item chooser')) {
			for (const character of 'web content') {
				await voiceOver.type(character, { capture: 'initial' });
				if ((await voiceOver.lastSpokenPhrase()).toLowerCase().includes('web content')) {
					await voiceOver.perform({ keyCode: g.MacOSKeyCodes.Enter }, { capture: false });
					await voiceOver.interact({ capture: false });
					await delay(200);
					return;
				}
			}
		}
	}
	throw new Error('VoiceOver did not reach the page\'s web content through the Item Chooser after 10 attempts');
}

/** Repeats `step` and records what VoiceOver says, until it says the same thing three times running or `max`. */
async function record(voiceOver, step, max) {
	const phrases = [];
	let repeats = 0;
	for (let i = 0; i < max && repeats < 3; i++) {
		await step();
		await delay(150);
		const phrase = (await voiceOver.lastSpokenPhrase()).trim();
		repeats = phrase && phrase === phrases[phrases.length - 1] ? repeats + 1 : 0;
		if (repeats === 0) phrases.push(phrase);
	}
	return phrases;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (process.platform !== 'darwin') throw new Error('VoiceOver runs on macOS only. On Windows, NVDA can be driven the same way with @guidepup/guidepup (see playbook.md).');
	if (!args.confirm) {
		console.error('voiceover.cjs switches VoiceOver on: it speaks aloud and takes over the keyboard and screen until it finishes. Ask the person at this machine first, then re-run with --confirm.');
		process.exit(1);
	}
	if (!automationEnabled()) throw new Error('VoiceOver automation is not enabled on this Mac. The person runs `npx @guidepup/setup setup` in their own terminal (it asks for the permissions it needs), then this script can run.');
	const config = loadConfig(args.config);
	const state = config.states.find((s) => s.id === args.state);
	if (!state) throw new Error(`No state "${args.state}" in the config`);
	if (args.browser === 'safari' && state.setup) throw new Error(`State "${state.id}" has a setup function, which Safari cannot run here; use --browser chromium`);
	const outDir = path.resolve(args.out || config.out || path.join(process.cwd(), '_raw', 'a11y'), 'voiceover');
	fs.mkdirSync(outDir, { recursive: true });

	const g = load('@guidepup/guidepup');
	const { voiceOver } = g;
	if (!voiceOver.detect()) throw new Error('Guidepup cannot find VoiceOver on this machine');
	let browser = null;
	let page = null;
	const url = new URL(state.path, config.baseUrl).href;
	const loadPage = async () => {
		if (args.browser === 'safari') {
			execFileSync('open', ['-a', 'Safari', url]);
			await delay(5000);
		} else {
			if (!browser) browser = await load('playwright').chromium.launch({ headless: false });
			if (page) await page.context().close();
			const opened = await openPage(browser, config, contextOptions(config, state.viewport || 'desktop'), state.path);
			page = opened.page;
			if (state.setup) {
				const { helpers } = require('./lib/flows.cjs');
				await state.setup(page, { ...helpers(page), press: (key) => page.keyboard.press(key) });
				await kbd.settle(page);
			}
			await page.bringToFront();
		}
		await g.macOSActivateId(APP_ID[args.browser]);
	};

	const transcripts = {};
	try {
		await loadPage();
		await voiceOver.start({ capture: 'initial' });
		const steps = {
			browse: () => voiceOver.next(),
			headings: () => voiceOver.nextHeading(),
			links: () => voiceOver.nextLink(),
			landmarks: () => voiceOver.nextLandmark(),
			tab: () => voiceOver.press('Tab')
		};
		for (const mode of args.modes) {
			await loadPage();
			await enterWebContent(voiceOver, g);
			await voiceOver.perform(g.voiceOverKeyCodeCommands.moveToAreaTop, { capture: false });
			transcripts[mode] = await record(voiceOver, steps[mode], args.max);
			fs.writeFileSync(path.join(outDir, `${state.id}-${args.browser}-${mode}.txt`), transcripts[mode].map((p, i) => `${i + 1}. ${p}`).join('\n') + '\n');
			console.log(`${mode}: ${transcripts[mode].length} phrases`);
		}
	} finally {
		await voiceOver.stop().catch((error) => console.error(`VoiceOver did not stop by itself (${error.message}). Press Command+F5 to turn it off.`));
		if (browser) await browser.close();
	}
	fs.writeFileSync(path.join(outDir, `${state.id}-${args.browser}.json`), JSON.stringify({ state: state.id, browser: args.browser, url, transcripts }, null, 1));
	console.log(`Transcripts in ${outDir}. Compare them with transcripts/${state.id}.txt (virtual screen reader) and listen for names, roles, states and order.`);
}

main().catch((error) => {
	console.error(error.stack || error.message);
	process.exit(1);
});
