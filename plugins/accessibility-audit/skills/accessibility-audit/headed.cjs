#!/usr/bin/env node
// The headed review: a visible Chromium window walks each state with real Tab presses at a pace a person can watch.
// A caption panel shows every stop's role, name and states and what a screen reader would say there (the virtual
// screen reader), and flags a stop that is covered or off screen. Each walk is recorded as a video.
//   --flows     also plays the config's flows: each step shown before it runs, then where focus landed and what was
//               announced (one video per flow)
//   --no-walks  skips the walks: plays only the flows, the views, or both
//   --speak     says each stop or step aloud with the macOS system voice while it runs
//   --narrate   also builds an MP4 per video with the spoken track and captions, for review away from the keyboard
//   --views     after the walk, shows the page at 200% zoom, at 320 px, with the text-spacing override and with
//               reduced motion, scrolling through each (recorded too)
//   --headless  records the same videos without a window (CI, or when nobody can give up the machine)
// The window takes keyboard focus while it runs. Ask the person at this machine first, then pass --confirm.
//
//   node headed.cjs --config a11y.config.cjs --confirm [--states a,b] [--flows] [--no-walks] [--speak] [--narrate]
//                   [--views] [--step-ms 900] [--max-stops 150] [--headless] [--out dir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load } = require('./lib/deps.cjs');
const { loadConfig, openPage, contextOptions } = require('./audit.cjs');
const kbd = require('./lib/keyboard.cjs');
const { startSpeech } = require('./lib/sr.cjs');
const { TEXT_SPACING_CSS } = require('./lib/visual.cjs');
const { runFlow, helpers } = require('./lib/flows.cjs');
const audio = require('./lib/audio.cjs');

function parseArgs(argv) {
	const args = { states: null, stepMs: 900, maxStops: 150, speak: false, narrate: false, views: false, flows: false, walks: true, confirm: false, headless: false, out: null };
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].split('=');
		const value = () => inline ?? argv[++i];
		if (flag === '--config') args.config = value();
		else if (flag === '--states') args.states = value().split(',');
		else if (flag === '--step-ms') args.stepMs = Number(value());
		else if (flag === '--max-stops') args.maxStops = Number(value());
		else if (flag === '--out') args.out = value();
		else if (flag === '--no-walks') args.walks = false;
		else if (['--speak', '--narrate', '--views', '--flows', '--confirm', '--headless'].includes(flag)) args[flag.slice(2)] = true;
		else throw new Error(`Unknown argument ${argv[i]}`);
	}
	if (!args.config) throw new Error('Missing --config <file>');
	if (!args.walks && !args.flows && !args.views) throw new Error('--no-walks leaves nothing to play; add --flows or --views');
	return args;
}

// Runs in the page: the caption panel, moved to another corner when it would cover the focused element.
function showPanel({ text, focus }) {
	let panel = document.querySelector('[data-a11y-tool="hud"]');
	if (!panel) {
		panel = document.createElement('div');
		panel.setAttribute('data-a11y-tool', 'hud');
		panel.setAttribute('aria-hidden', 'true');
		panel.style.cssText = 'position:fixed;z-index:2147483647;max-width:440px;padding:10px 12px;border-radius:8px;background:rgba(18,18,18,.9);color:#fff;font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif;white-space:pre-wrap;pointer-events:none;box-shadow:0 4px 18px rgba(0,0,0,.35)';
		document.documentElement.appendChild(panel);
	}
	panel.textContent = text;
	const corners = [{ top: '8px', right: '8px' }, { bottom: '8px', right: '8px' }, { bottom: '8px', left: '8px' }, { top: '8px', left: '8px' }];
	for (const corner of corners) {
		panel.style.top = panel.style.right = panel.style.bottom = panel.style.left = '';
		Object.assign(panel.style, corner);
		const p = panel.getBoundingClientRect();
		if (!focus || p.right < focus.x || p.left > focus.x + focus.w || p.bottom < focus.y || p.top > focus.y + focus.h) break;
	}
}

// Runs in the page: the focused element and whether it is covered or off screen.
function focusNow() {
	let el = document.activeElement;
	while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
	if (!el || el === document.body || el === document.documentElement || el.closest('[data-a11y-tool]')) return null;
	const stops = (window.__a11yHeaded = window.__a11yHeaded || []);
	const again = stops.includes(el);
	if (!again) stops.push(el);
	const r = el.getBoundingClientRect();
	const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
	const top = onScreen ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
	const covered = !!(top && !top.closest('[data-a11y-tool]') && top !== el && !el.contains(top) && !top.contains(el));
	return { again, index: stops.indexOf(el), describe: window.__a11y.describe(el), iframe: el.localName === 'iframe', onScreen, covered, coveredBy: covered ? window.__a11y.describe(top) : null, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
}

/** Speech line of an aria snapshot entry: `- button "Save" [pressed]` → `button "Save" [pressed]`. */
const plainLine = (line) => line.replace(/^- /, '').replace(/^'(.*)'(:.*)?$/, '$1').replace(/:$/, '');

/**
 * Holds the window on what the panel shows long enough to read it, and voices `words`: aloud (--speak) and as a clip
 * on the recording's narration track (--narrate). Time spent voicing counts toward the hold.
 */
function presenter(page, args, startedAt, workDir, prefix) {
	const clips = [];
	return {
		clips,
		async hold(words) {
			const at = (Date.now() - startedAt) / 1000;
			let hold = args.stepMs;
			if (args.narrate) {
				const file = path.join(workDir, `${prefix}-${String(clips.length + 1).padStart(3, '0')}.wav`);
				const duration = audio.synthesise(words, file);
				clips.push({ start: at, duration, text: words, file });
				hold = Math.max(hold, duration * 1000 + 200);
			}
			if (args.speak) await audio.speak(words);
			const spent = Date.now() - startedAt - at * 1000;
			if (hold > spent) await page.waitForTimeout(hold - spent);
			return at;
		}
	};
}

/** Closes the recording's context, keeps its video as `<base>.webm` and, with --narrate, builds `<base>.mp4`. */
async function finishRecording(opened, base, clips, args, outDir, workDir) {
	const video = opened.page.video();
	const duration = (Date.now() - opened.startedAt) / 1000;
	await opened.close();
	const webm = path.join(outDir, `${base}.webm`);
	fs.renameSync(await video.path(), webm);
	const entry = { video: path.relative(outDir, webm) };
	if (args.narrate && clips.length) {
		const track = path.join(workDir, `${base}.wav`);
		const captions = path.join(outDir, `${base}.vtt`);
		audio.buildTrack(clips, duration, track);
		audio.writeCaptions(clips, captions);
		entry.narrated = path.relative(outDir, audio.muxNarration(webm, track, captions, path.join(outDir, `${base}.mp4`)));
	}
	return entry;
}

async function walk(page, state, args, show) {
	const speech = await startSpeech(page);
	const steps = [];
	let bodyInARow = 0;
	await page.evaluate(showPanel, { text: `${state.id}: keyboard walk with Tab. Please leave this window alone until it closes.`, focus: null });
	await page.waitForTimeout(1500);
	for (let n = 1; n <= args.maxStops; n++) {
		await page.keyboard.press('Tab');
		await kbd.settle(page);
		const focus = await page.evaluate(focusNow);
		if (!focus) {
			if (++bodyInARow >= 2) break;
			n--;
			continue;
		}
		bodyInARow = 0;
		// Back on a stop already walked: the whole Tab sequence has played. (Not only the first stop: a menu open at the
		// start closes once focus leaves it, so its items never come round again.)
		if (focus.again) break;
		const said = (await speech.take()).join(', ');
		const line = focus.iframe ? '- iframe' : kbd.parseSnapshotLine(await page.locator(':focus').last().ariaSnapshot({ timeout: 3000 })).line;
		const flags = [!focus.onScreen && 'OFF SCREEN', focus.covered && `COVERED by ${focus.coveredBy}`].filter(Boolean).join(' · ');
		const words = said || plainLine(line);
		await page.evaluate(showPanel, { text: `Stop ${n} · ${plainLine(line)}\nScreen reader: ${words}${flags ? `\n${flags}` : ''}`, focus: focus.rect });
		const at = await show.hold(words);
		steps.push({ n, at: +at.toFixed(2), line, said: words, flags });
	}
	await speech.stop();
	await page.evaluate(showPanel, { text: `${state.id}: walk finished (${steps.length} stops).`, focus: null });
	await page.waitForTimeout(1200);
	return steps;
}

/** One flow at a watching pace: the step before it runs, then where focus landed and what was announced. */
async function playFlow(page, flow, args, show) {
	await page.evaluate(showPanel, { text: `Flow ${flow.id}: ${flow.steps.length} steps by keyboard. Please leave this window alone until it closes.`, focus: null });
	await page.waitForTimeout(1500);
	const onStep = async ({ phase, index, label, row }) => {
		const head = `Flow ${flow.id} · step ${index + 1} of ${flow.steps.length}: ${label}`;
		if (phase === 'before') {
			await page.evaluate(showPanel, { text: head, focus: null });
			await show.hold(label);
			return;
		}
		const heard = row.announced.map((a) => a.replace(/^\w+( \(new region\))?: /, ''));
		const rect = await page.evaluate(() => {
			const r = document.activeElement && document.activeElement !== document.body ? document.activeElement.getBoundingClientRect() : null;
			return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
		});
		await page.evaluate(showPanel, { text: `${head}\nFocus: ${plainLine(row.focus)}\nAnnounced: ${row.announced.join(' · ') || '(nothing)'}\nTitle: ${row.title}`, focus: rect });
		await show.hold(`Focus on ${plainLine(row.focus)}. ${heard.length ? `Announced: ${heard.join('. ')}` : 'Nothing announced.'}`);
	};
	const result = await runFlow(page, flow, { onStep });
	await page.evaluate(showPanel, { text: `Flow ${flow.id} finished: ${result.findings.length ? result.findings.map((f) => f.message).join('\n') : 'every expectation met'}`, focus: null });
	await show.hold(result.findings.length ? `${result.findings.length} problems in this flow.` : 'Every expectation met.');
	return result;
}

/** One view of the page under a different window or preference, scrolled through slowly while recording. */
async function view(browser, config, state, label, options, outDir, css = null) {
	const opened = await openPage(browser, config, { ...options, recordVideo: { dir: outDir, size: options.viewport } }, state.path);
	const { page } = opened;
	if (css) await page.addStyleTag({ content: css });
	await page.evaluate(showPanel, { text: `${state.id}: ${label}`, focus: null });
	await page.waitForTimeout(1500);
	for (let i = 0; i < 12; i++) {
		const more = await page.evaluate(() => {
			const before = scrollY;
			scrollBy(0, innerHeight * 0.8);
			return scrollY !== before;
		});
		await page.waitForTimeout(1100);
		if (!more) break;
	}
	const video = page.video();
	await opened.close();
	const file = path.join(outDir, `${state.id}-${label.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.webm`);
	fs.renameSync(await video.path(), file);
	return file;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.confirm && !args.headless) {
		console.error('headed.cjs opens a visible Chromium window that takes keyboard focus while it runs' + (args.speak ? ' and speaks aloud' : '') + '. Ask the person at this machine first, then re-run with --confirm.');
		process.exit(1);
	}
	const config = loadConfig(args.config);
	if (args.flows && !config.flows.length) throw new Error('--flows: the config has no flows');
	const outDir = path.resolve(args.out || config.out || path.join(process.cwd(), '_raw', 'a11y'), 'headed');
	fs.mkdirSync(outDir, { recursive: true });
	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-headed-'));
	const states = args.walks || args.views ? config.states.filter((s) => !args.states || args.states.includes(s.id)) : [];
	if (args.states) for (const id of args.states) if (!config.states.some((s) => s.id === id)) throw new Error(`--states: no state "${id}" in the config`);
	const { chromium } = load('playwright');
	const browser = await chromium.launch({ headless: args.headless, args: args.headless ? [] : ['--window-position=40,40'] });
	const summary = [];
	try {
		for (const state of states) {
			const entry = { state: state.id };
			if (args.walks) {
				const options = contextOptions(config, state.viewport || 'desktop', { reducedMotion: state.reducedMotion || 'no-preference' });
				const opened = await openPage(browser, config, { ...options, recordVideo: { dir: workDir, size: options.viewport } }, state.path);
				const { page } = opened;
				if (state.setup) {
					await state.setup(page, { ...helpers(page), press: (key) => page.keyboard.press(key) });
					await kbd.settle(page);
				}
				const show = presenter(page, args, opened.startedAt, workDir, state.id);
				const steps = await walk(page, state, args, show);
				fs.writeFileSync(path.join(outDir, `${state.id}-steps.json`), JSON.stringify(steps, null, 1));
				Object.assign(entry, { stops: steps.length }, await finishRecording(opened, `${state.id}-walk`, show.clips, args, outDir, workDir));
			}
			if (args.views) {
				const desktop = contextOptions(config, config.desktopViewport || 'desktop');
				const views = [
					await view(browser, config, state, 'zoom 200%', { ...desktop, viewport: { width: Math.round(desktop.viewport.width / 2), height: Math.round(desktop.viewport.height / 2) }, deviceScaleFactor: 2 }, outDir),
					await view(browser, config, state, 'reflow 320px', { ...desktop, viewport: { width: 320, height: 640 } }, outDir),
					await view(browser, config, state, 'text spacing', desktop, outDir, TEXT_SPACING_CSS),
					await view(browser, config, state, 'reduced motion', { ...desktop, reducedMotion: 'reduce' }, outDir)
				];
				entry.views = views.map((v) => path.relative(outDir, v));
			}
			summary.push(entry);
			console.log(`${state.id}: ${entry.stops === undefined ? 'no walk' : `${entry.stops} stops → ${entry.narrated || entry.video}`}${entry.views ? `, views: ${entry.views.join(', ')}` : ''}`);
		}
		for (const flow of args.flows ? config.flows : []) {
			const options = contextOptions(config, flow.viewport || 'desktop');
			const opened = await openPage(browser, config, { ...options, recordVideo: { dir: workDir, size: options.viewport } }, flow.path);
			const show = presenter(opened.page, args, opened.startedAt, workDir, flow.id);
			const result = await playFlow(opened.page, flow, args, show);
			fs.writeFileSync(path.join(outDir, `${flow.id}-flow.json`), JSON.stringify(result, null, 1));
			const entry = { flow: flow.id, problems: result.findings.length, ...(await finishRecording(opened, `${flow.id}-flow`, show.clips, args, outDir, workDir)) };
			summary.push(entry);
			console.log(`flow ${flow.id}: ${entry.problems} problems → ${entry.narrated || entry.video}`);
		}
	} finally {
		await browser.close();
		fs.rmSync(workDir, { recursive: true, force: true });
	}
	fs.writeFileSync(path.join(outDir, 'headed.json'), JSON.stringify(summary, null, 1));
	console.log(`Videos in ${outDir}. Watch each walk for: a visible indicator at every stop, an order that follows the layout, nothing covered, and speech that names every control. Watch each flow for focus landing where the task continues and every status being announced.`);
}

main().catch((error) => {
	console.error(error.stack || error.message);
	process.exit(1);
});
