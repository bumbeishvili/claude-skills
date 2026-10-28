#!/usr/bin/env node
// Proves the audit measures what it claims, on two pages with known answers:
//   fixtures/known-failures.html  every element with data-expect="check ids" carries a planted failure, and each id
//                                 must be reported on that element (or inside it);
//   fixtures/known-good.html      the same kinds of content built correctly: nothing may fail or be flagged there.
// Flows add four expectations: an unannounced status message, focus lost when a banner removes itself, a page title
// that a navigation leaves unchanged, and an announced status on the good page. Run it after changing any check:
//   node selftest.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { load } = require('./lib/deps.cjs');
const { initScript } = require('./lib/inpage.cjs');

const FIXTURES = path.join(__dirname, 'fixtures');
const FLOW_EXPECT = { 'failures-save': ['flow:announce-missing'], 'failures-dismiss': ['flow:focus-lost'], 'failures-title': ['flow:title-unexpected'], 'good-save': [] };

// The fixtures are served from this process, so the audit runs as an asynchronous child (a synchronous one would
// block the server it is reading from).
function runAudit(args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '', stderr = '';
		child.stdout.on('data', (d) => (stdout += d));
		child.stderr.on('data', (d) => (stderr += d));
		child.on('error', reject);
		child.on('close', (status) => resolve({ status, stdout, stderr }));
	});
}

function serve() {
	const server = http.createServer((req, res) => {
		const file = path.join(FIXTURES, decodeURIComponent(new URL(req.url, 'http://x').pathname));
		if (!file.startsWith(FIXTURES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			return res.end('not found');
		}
		res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** For each finding, whether its element is (inside) each data-expect element of the page. */
async function locate(browser, url, findings) {
	const page = await browser.newPage();
	await page.addInitScript(initScript);
	await page.goto(url, { waitUntil: 'load' });
	const result = await page.evaluate((items) => {
		const expected = [...document.querySelectorAll('[data-expect]')].map((el) => ({ el, path: window.__a11y.cssPath(el), checks: el.getAttribute('data-expect').split(/\s+/) }));
		const resolve = (p) => {
			if (!p) return null;
			try {
				return p === 'html' ? document.documentElement : document.querySelector(p);
			} catch {
				return null; // a target outside this document (a frame, a URL): it matches no expectation
			}
		};
		return {
			expected: expected.map(({ path, checks }) => ({ path, checks })),
			hits: items.map((f) => {
				const el = resolve(f.node) || resolve(f.target);
				return el ? expected.filter((x) => x.el === el || x.el.contains(el)).map((x) => x.path) : [];
			})
		};
	}, findings.map((f) => ({ node: f.node, target: f.target })));
	await page.close();
	return result;
}

async function main() {
	const server = await serve();
	const base = `http://127.0.0.1:${server.address().port}`;
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-selftest-'));
	console.log(`Fixtures at ${base}; audit output in ${out}`);
	const run = await runAudit([path.join(__dirname, 'audit.cjs'), '--config', path.join(FIXTURES, 'selftest.config.cjs'), '--out', out], { ...process.env, SELFTEST_BASE: base });
	if (run.status !== 0) {
		server.close();
		throw new Error(`audit.cjs exited ${run.status}\n${run.stdout}\n${run.stderr}`);
	}
	console.log(run.stdout.trim().split('\n').map((l) => `  ${l}`).join('\n'));
	const { raw } = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8'));
	const browser = await load('playwright').chromium.launch();
	const onPage = (file, state) => raw.filter((f) => f.state === state || f.state === `page-${file.replace(/\./g, '-')}` || f.state === `page-${file.replace(/[^\w]+/g, '-')}`);

	let failures = 0;
	const failuresFindings = onPage('known-failures.html', 'failures');
	const located = await locate(browser, `${base}/known-failures.html`, failuresFindings);
	console.log('\nPlanted failures (known-failures.html)');
	for (const expectation of located.expected) {
		for (const check of expectation.checks) {
			const found = failuresFindings.some((f, i) => f.check === check && located.hits[i].includes(expectation.path));
			if (!found) failures++;
			console.log(`  ${found ? 'found  ' : 'MISSED '} ${check.padEnd(32)} ${expectation.path}`);
		}
	}

	const goodFindings = onPage('known-good.html', 'good').filter((f) => !f.check.startsWith('xpage:'));
	console.log('\nCorrect page (known-good.html): every finding here is a false positive');
	if (!goodFindings.length) console.log('  none');
	for (const f of goodFindings) {
		failures++;
		console.log(`  FALSE  ${f.check.padEnd(32)} ${f.node || f.target}  ${f.message.slice(0, 120)}`);
	}

	console.log('\nFlows');
	for (const [flow, checks] of Object.entries(FLOW_EXPECT)) {
		const got = raw.filter((f) => f.state === flow).map((f) => f.check);
		const missing = checks.filter((c) => !got.includes(c));
		const extra = got.filter((c) => !checks.includes(c));
		failures += missing.length + extra.length;
		console.log(`  ${missing.length || extra.length ? 'WRONG  ' : 'ok     '} ${flow.padEnd(20)} expected [${checks.join(', ')}] got [${got.join(', ')}]`);
	}
	await browser.close();
	server.close();
	console.log(`\n${failures ? `${failures} problems: the audit is not measuring what it should` : 'Self-test passed'}. Full report: ${path.join(out, 'summary.md')}`);
	process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
	console.error(error.stack || error.message);
	process.exit(1);
});
