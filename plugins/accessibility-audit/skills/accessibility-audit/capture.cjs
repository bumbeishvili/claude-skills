#!/usr/bin/env node
// Full-window screenshot of one state for before/after evidence, with the target element scrolled to the middle of
// the window and its box written next to the image, so compose.cjs can mark it. Run it once on the code before the
// fix (an isolated copy, see playbook.md "Before and after") and once after, with the same state and target.
//
//   node capture.cjs --config a11y.config.cjs --state home --target "#footer a" --out before.png [--focus] [--hover]
//                    [--base-url http://localhost:5174]
//     --focus     presses Tab until the target has keyboard focus (for focus indicator, order and obscuring fixes)
//     --hover     rests the pointer on the target (for tooltip and hover-card fixes)
//     --base-url  the server to capture instead of the config's (the copy of the code before the fix)
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/deps.cjs');
const { loadConfig, openPage, contextOptions } = require('./audit.cjs');
const kbd = require('./lib/keyboard.cjs');
const { helpers } = require('./lib/flows.cjs');

function parseArgs(argv) {
	const args = { focus: false, hover: false };
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].split('=');
		const value = () => inline ?? argv[++i];
		if (flag === '--config') args.config = value();
		else if (flag === '--state') args.state = value();
		else if (flag === '--target') args.target = value();
		else if (flag === '--out') args.out = value();
		else if (flag === '--base-url') args.baseUrl = value();
		else if (flag === '--focus') args.focus = true;
		else if (flag === '--hover') args.hover = true;
		else throw new Error(`Unknown argument ${argv[i]}`);
	}
	for (const k of ['config', 'state', 'target', 'out']) if (!args[k]) throw new Error(`Missing --${k}. Usage: node capture.cjs --config <file> --state <id> --target <selector> --out <file.png> [--focus] [--hover]`);
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const config = { ...loadConfig(args.config), ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}) };
	const state = config.states.find((s) => s.id === args.state);
	if (!state) throw new Error(`No state "${args.state}" in the config`);
	const browser = await load('playwright').chromium.launch();
	const opened = await openPage(browser, config, contextOptions(config, state.viewport || 'desktop'), state.path);
	const { page } = opened;
	try {
		if (state.setup) await state.setup(page, { ...helpers(page), press: (key) => page.keyboard.press(key) });
		const target = page.locator(args.target).first();
		if (!(await target.count())) throw new Error(`--target ${args.target} matches nothing in state ${state.id}`);
		if (args.focus) {
			const want = await target.evaluate((el) => window.__a11y.cssPath(el));
			for (let presses = 0; ; presses++) {
				if (presses > 400) throw new Error(`${args.target} was not reached within 400 Tab presses`);
				await page.keyboard.press('Tab');
				await kbd.settle(page);
				if (await page.evaluate((p) => document.activeElement && window.__a11y.cssPath(document.activeElement) === p, want)) break;
			}
		}
		await target.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
		await kbd.settle(page);
		if (args.hover) {
			const b = await target.boundingBox();
			await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
			await page.waitForTimeout(400);
		}
		const box = await target.boundingBox();
		fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
		await page.screenshot({ path: args.out });
		const meta = { state: state.id, path: state.path, viewport: page.viewportSize(), target: args.target, box, focus: args.focus, hover: args.hover, url: page.url() };
		fs.writeFileSync(args.out.replace(/\.png$/i, '') + '.json', JSON.stringify(meta, null, 1));
		console.log(`${args.out} (${box ? `${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}` : 'target not visible'})`);
	} finally {
		await opened.close();
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error.stack || error.message);
	process.exit(1);
});
