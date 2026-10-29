#!/usr/bin/env node
// The real VoiceOver pass (macOS). VoiceOver is switched on and driven through states of the site the way its users
// read a page, and every phrase it speaks is recorded: Tab, the Web Rotor's lists (headings, landmarks, links, form
// controls), reading order with VO-Right, and heading, link and control navigation. The config's `voFlows` replay
// tasks with VoiceOver's own keys and record what it says after each step, so a missing or wrong announcement shows
// up as a failed `expect`. The transcripts sit next to the virtual screen reader's, so a person can compare the model
// with what VoiceOver says.
//
// VoiceOver speaks aloud and takes over the keyboard and screen while it runs. Ask the person at this machine first,
// then pass --confirm. VoiceOver automation is enabled once per machine; setup.sh --check reports it.
//
//   node voiceover.cjs --config a11y.config.cjs --confirm [--states home,faq] [--flows newsletter-error]
//                      [--browser safari|chromium] [--modes tab,rotor,browse] [--max 150] [--out dir]
//                      [--tab-key Tab|Alt+Tab]   (Safari's key for links, when known; otherwise the run finds it)
//
// Safari is the pairing review teams use with VoiceOver. The run opens a Safari window of its own, loads each URL in
// it and closes it at the end; states with a setup function need --browser chromium (Playwright's Chrome for Testing),
// which runs the setup first. Before every key press the script checks that its own window is in front and stops if
// anything else came forward, so no keystroke lands in another app.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { load, resolveFile } = require('./lib/deps.cjs');
const { loadConfig, openPage, contextOptions } = require('./audit.cjs');
const kbd = require('./lib/keyboard.cjs');

const MODES = ['tab', 'rotor', 'browse', 'headings', 'links', 'controls'];
const DEFAULT_MODES = ['tab', 'rotor', 'browse'];
const DEFAULT_WAIT = 6000;
const VOICEOVER_STARTER = '/System/Library/CoreServices/VoiceOver.app/Contents/MacOS/VoiceOverStarter';
// On the main display's menu bar, which no page is under.
const POINTER_PARKED = { x: 200, y: 5 };
// guidepup's VoiceOver settings move the pointer onto whatever VoiceOver reads, which hovers it: a hover menu opened as
// VoiceOver reached its button (29 Oct). The run turns that off; guidepup writes it to a shadow of its settings image.
const VOICEOVER_SETTINGS = { SCRConfigurationCursorTrackingMToVO: 0 };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const osa = (script) => execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim();
const jxa = (script) => execFileSync('osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8' }).trim();
const quote = (text) => `"${String(text).replace(/[\\"]/g, '\\$&')}"`;
const matches = (pattern, text) => (pattern instanceof RegExp ? pattern.test(text) : text.includes(String(pattern)));
// VoiceOver's last phrase, read live. guidepup's lastSpokenPhrase() reads its own log, which records '' for a key press
// VoiceOver stays quiet after, then logs the old phrase again as new on the next press.
const voiceOverSays = () => osa('tell application "VoiceOver" to return content of last phrase');

function parseArgs(argv) {
	const args = { browser: 'safari', max: 150, modes: DEFAULT_MODES, states: [], flows: [], confirm: false, out: null, tabKey: null };
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].split('=');
		const value = () => inline ?? argv[++i];
		const list = () => value().split(',').filter(Boolean);
		if (flag === '--config') args.config = value();
		else if (flag === '--state' || flag === '--states') args.states.push(...list());
		else if (flag === '--flows') args.flows.push(...list());
		else if (flag === '--browser') args.browser = value();
		else if (flag === '--max') args.max = Number(value());
		else if (flag === '--modes') args.modes = list();
		else if (flag === '--out') args.out = value();
		else if (flag === '--tab-key') args.tabKey = value();
		else if (flag === '--confirm') args.confirm = true;
		else throw new Error(`Unknown argument ${argv[i]}`);
	}
	if (!args.config || (!args.states.length && !args.flows.length)) throw new Error('Usage: node voiceover.cjs --config <file> --confirm --states <id,id> [--flows <id,id>]');
	if (!['safari', 'chromium'].includes(args.browser)) throw new Error(`--browser must be safari or chromium, got ${args.browser}`);
	if (args.tabKey && !['Tab', 'Alt+Tab'].includes(args.tabKey)) throw new Error(`--tab-key must be Tab or Alt+Tab, got ${args.tabKey}`);
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

/**
 * guidepup 0.38 starts VoiceOver with libScreenReader's private _ScreenReaderStart. With SIP on, that call cannot
 * write the universal-access "VoiceOver on" key (cfprefsd rejects it), so VoiceOver logs "not launched by UA daemon
 * as expected" and quits within a second, and start() times out after a minute. VoiceOverStarter, the binary System
 * Settings uses, starts it properly; guidepup's own readiness wait and activation run after it as before. On a macOS
 * without VoiceOverStarter, guidepup's own start is left in place.
 */
function startWithVoiceOverStarter(g) {
	if (!fs.existsSync(VOICEOVER_STARTER)) return;
	const dir = path.join(path.dirname(resolveFile('@guidepup/guidepup')), 'macOS', 'VoiceOver');
	const { waitForReady } = require(path.join(dir, 'waitForReady.js'));
	require(path.join(dir, 'start.js')).start = async (options) => {
		spawn(VOICEOVER_STARTER, { detached: true, stdio: 'ignore' }).unref();
		await waitForReady(options);
		await delay(500);
		await g.macOSActivate(g.MacOSApplications.VoiceOver, options);
	};
}

/** Another app or window came in front of the run's window, so key presses would go there: the run stops. */
class FrontLost extends Error {}

/**
 * guidepup activates VoiceOver before every VoiceOver command. VoiceOver is a background-only app; after that
 * activation Safari reported no focused element and Tab, Option-Tab and Enter reached nothing (29 Oct runs). VoiceOver
 * reads its VO-key commands from whichever app is in front, as it does for a person at the keyboard, so the run sends
 * them without activating it and the browser keeps keyboard focus.
 */
function sendKeysWithoutActivatingVoiceOver(g) {
	const keys = require(path.join(path.dirname(resolveFile('@guidepup/guidepup')), 'macOS', 'sendKeys', 'sendKeys.js'));
	const send = keys.sendKeys;
	keys.sendKeys = (keyCommand, applicationName, options) => send(keyCommand, applicationName === g.MacOSApplications.VoiceOver ? undefined : applicationName, options);
}

/** The frontmost app's process id and bundle identifier. */
function frontmost() {
	const [pid, bundle] = osa('tell application "System Events" to tell (first process whose frontmost is true) to return (unix id as text) & " " & bundle identifier').split(' ');
	return { pid: Number(pid), bundle };
}

/** The pointer's position in global display points, origin at the top left of the main display. */
function pointerPosition() {
	return JSON.parse(jxa('ObjC.import("AppKit"); const p = $.NSEvent.mouseLocation; const h = $.NSScreen.screens.objectAtIndex(0).frame.size.height; JSON.stringify({ x: p.x, y: h - p.y })'));
}

/** Moves the pointer without sending a mouse event, so nothing on the way is hovered or clicked. */
function movePointer({ x, y }) {
	jxa(`ObjC.import("CoreGraphics"); $.CGWarpMouseCursorPosition({ x: ${x}, y: ${y} })`);
}

/** The main display's area below the menu bar and beside the Dock, in global display points. */
function mainDisplayArea() {
	return JSON.parse(jxa('ObjC.import("AppKit"); const s = $.NSScreen.screens.objectAtIndex(0); const v = s.visibleFrame; JSON.stringify({ left: v.origin.x, top: s.frame.size.height - v.origin.y - v.size.height, width: v.size.width, height: v.size.height })'));
}

/**
 * The person's own Safari, in a window the run opens and closes. Its Tab key (Tab or Option-Tab) is found at the start
 * of the run by detectSafariTabKey. With `config.voWindow` ({ width, height }) the window opens at that size at the
 * top left of the main display, so the page gets the layout the audit expects rather than the last window's size.
 */
function safariDriver(config) {
	let windowId = null;
	const ours = () => `(first window whose id is ${windowId})`;
	const driver = {
		name: 'safari',
		tabKey: null,
		async load(url, wait) {
			if (windowId === null) {
				windowId = osa(`tell application "Safari"\nmake new document with properties {URL:${quote(url)}}\nreturn id of front window\nend tell`);
				if (config.voWindow) {
					const area = mainDisplayArea();
					const right = area.left + Math.min(config.voWindow.width, area.width);
					const bottom = area.top + Math.min(config.voWindow.height, area.height);
					osa(`tell application "Safari" to set bounds of ${ours()} to {${area.left}, ${area.top}, ${right}, ${bottom}}`);
				}
			} else osa(`tell application "Safari" to set URL of current tab of ${ours()} to ${quote(url)}`);
			await delay(wait);
			await driver.toFront();
		},
		async toFront() {
			osa(`tell application "Safari"\nset index of ${ours()} to 1\nactivate\nend tell`);
			await delay(300);
			driver.assertFront();
		},
		assertFront() {
			const app = frontmost();
			if (app.bundle !== 'com.apple.Safari') throw new FrontLost(`Stopped: ${app.bundle} came to the front, so the next key press would go to it instead of the page`);
			const front = osa('tell application "Safari" to return id of front window');
			if (front !== windowId) throw new FrontLost(`Stopped: another Safari window (${front}) came in front of the run's window (${windowId})`);
		},
		/** The page title of the run's window, which VoiceOver speaks in the page area's name. */
		title() {
			return osa(`tell application "Safari" to return name of current tab of ${ours()}`);
		},
		/** Role, title and description of the element with Safari's keyboard focus, for the run log. */
		focused() {
			return osa(`tell application "System Events" to tell process "Safari"
set focusedElement to value of attribute "AXFocusedUIElement"
set described to {}
repeat with attributeName in {"AXRole", "AXTitle", "AXDescription"}
	try
		set attributeValue to value of attribute (attributeName as text) of focusedElement
		if attributeValue is not missing value and (attributeValue as text) is not "" then set end of described to (attributeValue as text)
	end try
end repeat
try
	set {elementX, elementY} to position of focusedElement
	set {elementWidth, elementHeight} to size of focusedElement
	set end of described to ("at " & (elementX as integer) & "," & (elementY as integer) & " size " & (elementWidth as integer) & "x" & (elementHeight as integer))
end try
set AppleScript's text item delimiters to " / "
return described as text
end tell`);
		},
		async close() {
			if (windowId !== null) osa(`tell application "Safari" to close ${ours()}`);
		}
	};
	return driver;
}

/**
 * Playwright's Chrome for Testing. Any other Chrome for Testing on the machine (another Playwright run, a scraper)
 * shares its bundle identifier, so the window is brought forward by process id, found from a switch only this
 * launch carries.
 */
function chromiumDriver(config) {
	const tag = `--a11y-voiceover-run=${crypto.randomUUID()}`;
	let browser = null;
	let page = null;
	let pid = null;
	const driver = {
		name: 'chromium',
		tabKey: 'Tab',
		get page() {
			return page;
		},
		async load(url, wait, state = null) {
			if (!browser) {
				browser = await load('playwright').chromium.launch({ headless: false, args: [tag] });
				const pids = execFileSync('pgrep', ['-f', tag], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
				if (pids.length !== 1) throw new Error(`Expected one browser process carrying ${tag}, found ${pids.length}`);
				pid = Number(pids[0]);
			}
			if (page) await page.context().close();
			const opened = await openPage(browser, config, contextOptions(config, state?.viewport || 'desktop'), new URL(url).pathname + new URL(url).search);
			page = opened.page;
			if (state?.setup) {
				const { helpers } = require('./lib/flows.cjs');
				await state.setup(page, { ...helpers(page), press: (key) => page.keyboard.press(key) });
				await kbd.settle(page);
			}
			await delay(wait);
			await driver.toFront();
		},
		async toFront() {
			await page.bringToFront();
			osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`);
			await delay(300);
			driver.assertFront();
		},
		assertFront() {
			const app = frontmost();
			if (app.pid !== pid) throw new FrontLost(`Stopped: ${app.bundle} (process ${app.pid}) came to the front, so the next key press would go to it instead of the run's browser (process ${pid})`);
		},
		async title() {
			return page.title();
		},
		async close() {
			if (browser) await browser.close();
		}
	};
	return driver;
}

// Puts the VoiceOver cursor on the first item of the page and returns what VoiceOver said on the way. Once Safari's Tab
// key is known, one press moves keyboard focus, and VoiceOver with it, onto the page's first focusable item; that also
// works after a reload, when stepping out says nothing because the cursor was on the page that went away. Before that,
// the cursor steps out (VO-Shift-Up) until VoiceOver names the page area: "web content" in Chrome, "<title> web
// content" or "HTML content" in Safari, which often lands VoiceOver inside the page by itself. If it never does, the
// cursor is at window level, where the Item Chooser, filtered by "content", lists the page area, as
// @guidepup/playwright does (MIT licence); while filtering, VoiceOver often speaks only the number of matches, so Down
// Arrow walks the matches until it reads the page area. The page area must carry the run's page title: stepping out
// can leave the run's window, and the chooser then lists another window's page (29 Oct, another site's page area).
async function enterWebContent(voiceOver, g, driver) {
	const title = await driver.title();
	const isPageArea = (phrase) => /\b(web|html) content\b/i.test(phrase) && phrase.includes(title);
	const heard = [];
	const listen = async (action) => {
		const phrase = await newSpeech(voiceOver, action);
		heard.push(phrase ?? '(nothing new)');
		return phrase;
	};
	const toPageTop = async () => {
		driver.assertFront();
		await listen(() => voiceOver.perform(g.voiceOverKeyCodeCommands.moveToAreaTop));
		return heard;
	};
	const interactWithPage = async () => {
		await voiceOver.interact({ capture: false });
		await delay(200);
		return toPageTop();
	};
	if (driver.name === 'safari' && driver.tabKey) {
		driver.assertFront();
		if ((await listen(() => voiceOver.press(driver.tabKey))) !== null) return toPageTop();
	}
	for (let level = 0; level < 4; level++) {
		driver.assertFront();
		const phrase = await listen(() => voiceOver.stopInteracting());
		if (phrase !== null && isPageArea(phrase)) return interactWithPage();
	}
	for (let attempt = 0; attempt < 3; attempt++) {
		driver.assertFront();
		await listen(() => voiceOver.perform(g.voiceOverKeyCodeCommands.openItemChooser, { capture: false }));
		await voiceOver.type('content', { capture: false });
		await delay(300);
		for (let match = 0; match < 8; match++) {
			const phrase = await listen(() => voiceOver.press('ArrowDown'));
			if (phrase === null || !isPageArea(phrase)) continue;
			await voiceOver.perform({ keyCode: g.MacOSKeyCodes.Enter }, { capture: false });
			return interactWithPage();
		}
		// Escape closes the chooser; VoiceOver keeps it, so it does not reach the page.
		await voiceOver.perform({ keyCode: g.MacOSKeyCodes.Escape }, { capture: false });
		await delay(150);
	}
	throw new Error(`VoiceOver did not reach the page's web content (last heard: ${heard.slice(-6).join(' | ')})`);
}

/**
 * Runs `action` and returns what VoiceOver said because of it, or null when it said nothing new within 600 ms. A key
 * press returns only after guidepup has polled the item under the cursor for several seconds, and by then VoiceOver
 * can be reading its hint ("You are currently on a button...") instead of the item, so the phrases guidepup logged
 * during the press come first; those equal to the phrase from before are its log repeating itself.
 */
async function newSpeech(voiceOver, action) {
	const before = voiceOverSays();
	const from = (await voiceOver.spokenPhraseLog()).length;
	await action();
	const logged = (await voiceOver.spokenPhraseLog()).slice(from).filter((phrase) => phrase && phrase !== before);
	if (logged.length) return logged.join(' | ');
	for (let check = 0; check < 3; check++) {
		const phrase = voiceOverSays();
		if (phrase !== before) return phrase;
		await delay(200);
	}
	return null;
}

/**
 * Safari's Tab reaches links only when "Press Tab to highlight each item on a webpage" is on, and Option-Tab does the
 * reverse. Its preferences are sandboxed, so the run finds out: from the top of the page, the first key after which
 * VoiceOver names a link within three presses is the one flows use. Returns it with what each press did.
 */
async function detectSafariTabKey(voiceOver, g, driver) {
	const tried = [];
	for (const key of ['Tab', 'Alt+Tab']) {
		driver.assertFront();
		await voiceOver.perform(g.voiceOverKeyCodeCommands.moveToAreaTop);
		for (let press = 0; press < 3; press++) {
			driver.assertFront();
			const phrase = await newSpeech(voiceOver, () => voiceOver.press(key));
			const pointer = pointerPosition();
			tried.push(`${key}: ${phrase ?? '(nothing new)'} [focus: ${driver.focused()}] [pointer: ${Math.round(pointer.x)},${Math.round(pointer.y)}]`);
			if (phrase !== null && /\blink\b/i.test(phrase)) return { key, tried };
		}
	}
	throw new Error(`Neither Tab nor Option-Tab made VoiceOver name a link in Safari:\n${tried.join('\n')}`);
}

/**
 * Repeats `step` and records what VoiceOver says after each one, until it says nothing new twice running (the end of
 * the page), comes back round to the first phrase (Tab wrapping through the browser's toolbar), or `max` steps.
 */
async function record(voiceOver, driver, step, max) {
	const phrases = [];
	const firstPart = (phrase) => phrase.split(' | ')[0];
	let quiet = 0;
	for (let i = 0; i < max; i++) {
		driver.assertFront();
		const phrase = await newSpeech(voiceOver, step);
		if (phrase === null || phrase === phrases.at(-1)) {
			if (++quiet === 2) break;
			continue;
		}
		quiet = 0;
		if (phrases.length > 1 && firstPart(phrase) === firstPart(phrases[0])) break;
		phrases.push(phrase);
	}
	return phrases;
}

/**
 * Reads the Web Rotor (VO-U) the way VoiceOver users survey a page: every list it offers (headings, landmarks, links,
 * form controls...) and each item as VoiceOver speaks it. Right Arrow moves to the next list; the reading stops when
 * a list comes round again. The opening phrase of each list names it. A list ends when Down Arrow says nothing new or
 * comes back to its first item.
 */
async function readRotor(voiceOver, g, driver, maxItems) {
	driver.assertFront();
	let opening = await newSpeech(voiceOver, () => voiceOver.perform(g.voiceOverKeyCodeCommands.openWebItemRotor));
	const lists = [];
	try {
		for (let i = 0; i < 25 && opening !== null; i++) {
			if (lists.some((list) => list.opening === opening)) break;
			const list = { opening, items: [] };
			lists.push(list);
			for (let n = 0; n < maxItems; n++) {
				const phrase = await newSpeech(voiceOver, () => voiceOver.press('ArrowDown'));
				if (phrase === null || phrase === list.items.at(-1) || (list.items.length > 1 && phrase === list.items[0])) break;
				list.items.push(phrase);
			}
			opening = await newSpeech(voiceOver, () => voiceOver.press('ArrowRight'));
		}
	} finally {
		await voiceOver.press('Escape');
	}
	return lists;
}

const STEPS = {
	tab: (voiceOver, g, driver) => voiceOver.press(driver.tabKey),
	browse: (voiceOver) => voiceOver.next(),
	headings: (voiceOver) => voiceOver.nextHeading(),
	links: (voiceOver) => voiceOver.nextLink(),
	controls: (voiceOver, g) => voiceOver.perform(g.voiceOverKeyCodeCommands.findNextControl)
};

function writeMode(outDir, file, mode, result) {
	const lines = mode === 'rotor' ? result.flatMap((list) => [`## ${list.opening}`, ...list.items.map((p, i) => `${i + 1}. ${p}`), '']) : result.map((p, i) => `${i + 1}. ${p}`);
	fs.writeFileSync(path.join(outDir, file), lines.join('\n') + '\n');
}

/** What a voFlow step's run() receives: VoiceOver actions that first check the run's window is in front. */
function flowHelpers(voiceOver, g, driver) {
	const guarded = (action) => async (...args) => {
		driver.assertFront();
		return action(...args);
	};
	const until = (move, what) => async (pattern, { max = 80 } = {}) => {
		const heard = [];
		for (let presses = 1; presses <= max; presses++) {
			driver.assertFront();
			const phrase = await newSpeech(voiceOver, move);
			heard.push(phrase ?? '(nothing new)');
			if (phrase !== null && matches(pattern, phrase)) return presses;
			if (heard.length >= 5 && heard.slice(-5).every((h) => h === '(nothing new)')) {
				throw new Error(`${what}: VoiceOver said nothing new for 5 presses in a row, so the key is not moving through the page (still: ${voiceOverSays()})`);
			}
		}
		throw new Error(`${what}: VoiceOver said nothing matching ${pattern} in ${max} presses (last: ${heard.slice(-3).join(' | ')})`);
	};
	return {
		voiceOver,
		commands: g.voiceOverKeyCodeCommands,
		page: driver.page ?? null,
		press: guarded((key) => voiceOver.press(key)),
		type: guarded((text) => voiceOver.type(text)),
		act: guarded(() => voiceOver.act()),
		next: guarded(() => voiceOver.next()),
		perform: guarded((command) => voiceOver.perform(command)),
		/** Tab (Option-Tab in Safari) until VoiceOver's phrase matches; returns the presses. */
		tabTo: until(() => voiceOver.press(driver.tabKey), 'tabTo'),
		/** VO-Right until the phrase matches. */
		readTo: until(() => voiceOver.next(), 'readTo'),
		/** VO-Command-H until a heading's phrase matches. */
		headingTo: until(() => voiceOver.nextHeading(), 'headingTo')
	};
}

/**
 * Runs one voFlow: loads its path, puts VoiceOver in the page, then runs each step and listens until VoiceOver has
 * been quiet for a moment, so announcements that follow the key press (live regions, dialogs, page titles) are kept.
 */
async function runVoFlow(voiceOver, g, driver, config, flow, outDir) {
	await driver.load(new URL(flow.path, config.baseUrl).href, flow.wait ?? config.voWait ?? DEFAULT_WAIT);
	await enterWebContent(voiceOver, g, driver);
	const helpers = flowHelpers(voiceOver, g, driver);
	const steps = [];
	const failures = [];
	for (const [i, step] of flow.steps.entries()) {
		const label = step.label || `step ${i + 1}`;
		const from = (await voiceOver.spokenPhraseLog()).length;
		await step.run(helpers);
		const ranTo = (await voiceOver.spokenPhraseLog()).length;
		await voiceOver.capture(() => delay(step.wait ?? 300), { capture: true });
		const log = await voiceOver.spokenPhraseLog();
		// When VoiceOver stays quiet, the listening capture returns the phrase before it; that is not a new announcement.
		const tail = log.slice(ranTo).filter((phrase) => phrase && phrase !== log[ranTo - 1]);
		const heard = [...log.slice(from, ranTo), ...tail].filter(Boolean);
		// After a key press VoiceOver stays quiet for, guidepup logs the phrase from before the step again, as if new.
		const before = log.slice(0, from).filter(Boolean).at(-1);
		while (heard.length && heard[0] === before) heard.shift();
		const row = { step: label, heard, pointer: pointerPosition() };
		if (driver.name === 'safari') row.focus = driver.focused();
		if (step.shot) {
			const shot = await voiceOver.takeCursorScreenshot();
			row.shot = path.join(outDir, 'shots', `${flow.id}-${driver.name}-${i + 1}.png`);
			fs.mkdirSync(path.dirname(row.shot), { recursive: true });
			fs.copyFileSync(shot, row.shot);
			// VoiceOver says "Screenshot saved"; listening here keeps it out of the next step's transcript.
			await voiceOver.capture(() => delay(300), { capture: true });
		}
		const all = heard.join(' | ');
		const expect = step.expect || {};
		if (expect.spoken && !matches(expect.spoken, all)) failures.push({ flow: flow.id, step: label, problem: `VoiceOver said nothing matching ${expect.spoken}`, heard });
		if (expect.notSpoken && matches(expect.notSpoken, all)) failures.push({ flow: flow.id, step: label, problem: `VoiceOver said something matching ${expect.notSpoken}`, heard });
		steps.push(row);
		console.log(`${flow.id} / ${label}: ${all || '(nothing)'} [focus: ${row.focus ?? '-'}] [pointer: ${row.pointer.x},${row.pointer.y}]`);
	}
	const lines = steps.flatMap((s, i) => [`${i + 1}. ${s.step}`, ...s.heard.map((h) => `   > ${h}`), ...(s.shot ? [`   [${path.relative(outDir, s.shot)}]`] : [])]);
	fs.writeFileSync(path.join(outDir, `flow-${flow.id}-${driver.name}.txt`), lines.join('\n') + '\n');
	return { steps, failures };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (process.platform !== 'darwin') throw new Error('VoiceOver runs on macOS only. On Windows, NVDA can be driven the same way with @guidepup/guidepup (see playbook.md).');
	if (!args.confirm) {
		console.error('voiceover.cjs switches VoiceOver on: it speaks aloud and takes over the keyboard and screen until it finishes. Ask the person at this machine first, then re-run with --confirm.');
		process.exit(1);
	}
	if (!automationEnabled()) throw new Error('VoiceOver automation is not enabled on this Mac. See playbook.md, "VoiceOver, automated", for the one-time setup and the permissions it asks for.');
	const config = loadConfig(args.config);
	const states = args.states.map((id) => {
		const state = config.states.find((s) => s.id === id);
		if (!state) throw new Error(`No state "${id}" in the config`);
		if (args.browser === 'safari' && state.setup) throw new Error(`State "${id}" has a setup function, which Safari cannot run here; use --browser chromium`);
		return state;
	});
	const flows = args.flows.map((id) => {
		const flow = (config.voFlows || []).find((f) => f.id === id);
		if (!flow) throw new Error(`No voFlow "${id}" in the config`);
		return flow;
	});
	const outDir = path.resolve(args.out || config.out || path.join(process.cwd(), '_raw', 'a11y'), 'voiceover');
	fs.mkdirSync(outDir, { recursive: true });

	const g = load('@guidepup/guidepup');
	const { voiceOver } = g;
	if (!voiceOver.detect()) throw new Error('Guidepup cannot find VoiceOver on this machine');
	startWithVoiceOverStarter(g);
	sendKeysWithoutActivatingVoiceOver(g);
	const driver = args.browser === 'safari' ? safariDriver(config) : chromiumDriver(config);
	const run = { browser: args.browser, started: new Date().toISOString(), states: {}, flows: {}, failures: [] };
	// A page under a resting pointer gets hover events whenever it loads with its window in front, which opened a hover
	// menu between key presses. The pointer waits on the menu bar for the run and goes back at the end.
	const resting = pointerPosition();
	movePointer(POINTER_PARKED);
	try {
		const first = states[0] ?? flows[0];
		await driver.load(new URL(first.path, config.baseUrl).href, DEFAULT_WAIT, states[0] ?? null);
		const startedAt = Date.now();
		await voiceOver.start({ capture: 'initial', settings: VOICEOVER_SETTINGS });
		console.log(`VoiceOver on after ${Math.round((Date.now() - startedAt) / 1000)} s`);
		if (driver.name === 'safari') {
			await driver.toFront();
			console.log(`Into the page: ${(await enterWebContent(voiceOver, g, driver)).join(' | ')} [focus: ${driver.focused()}]`);
			if (args.tabKey) {
				driver.tabKey = args.tabKey;
				console.log(`Safari's Tab key here: ${driver.tabKey} (--tab-key)`);
			} else {
				const detected = await detectSafariTabKey(voiceOver, g, driver);
				driver.tabKey = detected.key;
				console.log(`Safari's Tab key here: ${driver.tabKey}\n${detected.tried.join('\n')}`);
			}
		}
		for (const state of states) {
			const url = new URL(state.path, config.baseUrl).href;
			run.states[state.id] = { url, modes: {} };
			for (const mode of args.modes) {
				// A fresh page for every mode: Tab and VO-Right move focus, and focus decides where the next mode starts.
				await driver.load(url, state.voWait ?? config.voWait ?? DEFAULT_WAIT, state);
				await enterWebContent(voiceOver, g, driver);
				const started = Date.now();
				const result = mode === 'rotor' ? await readRotor(voiceOver, g, driver, args.max) : await record(voiceOver, driver, () => STEPS[mode](voiceOver, g, driver), args.max);
				run.states[state.id].modes[mode] = { seconds: Math.round((Date.now() - started) / 1000), result };
				writeMode(outDir, `${state.id}-${driver.name}-${mode}.txt`, mode, result);
				console.log(`${state.id} ${mode}: ${mode === 'rotor' ? `${result.length} lists` : `${result.length} phrases`} in ${run.states[state.id].modes[mode].seconds} s`);
			}
		}
		for (const flow of flows) {
			try {
				const { steps, failures } = await runVoFlow(voiceOver, g, driver, config, flow, outDir);
				run.flows[flow.id] = steps;
				run.failures.push(...failures);
			} catch (error) {
				if (error instanceof FrontLost) throw error;
				// A flow that cannot finish fails on its own; the next flow starts on a fresh page.
				run.failures.push({ flow: flow.id, step: '(could not finish)', problem: error.message, heard: [] });
				console.log(`${flow.id} could not finish: ${error.message}`);
			}
		}
	} finally {
		await voiceOver.stop().catch((error) => console.error(`VoiceOver did not stop by itself (${error.message}). Press Command+F5 to turn it off.`));
		await driver.close();
		movePointer(resting);
		run.finished = new Date().toISOString();
		fs.writeFileSync(path.join(outDir, `run-${driver.name}-${run.started.replace(/[:.]/g, '-')}.json`), JSON.stringify(run, null, 1));
	}
	for (const f of run.failures) console.log(`FAIL ${f.flow} / ${f.step}: ${f.problem} (heard: ${f.heard.join(' | ') || 'nothing'})`);
	console.log(`Transcripts in ${outDir}. Compare them with transcripts/<state>.txt (virtual screen reader) and listen for names, roles, states and order.`);
}

main().catch((error) => {
	console.error(error.stack || error.message);
	process.exit(1);
});
