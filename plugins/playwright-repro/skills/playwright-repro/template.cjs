#!/usr/bin/env node
// Copy this per investigation, fill in CONFIG and reproduce(), then run it with:
//   NODE_PATH="$(npm root -g)" node repro.cjs
// NODE_PATH points Node at the global Playwright install; drop it when running from
// inside a project that has playwright in its own node_modules.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  startPath: '/',
  viewport: { width: 1400, height: 900 },
  // Headed by default so you watch the bug happen. HEADLESS=1 for long soak loops.
  headless: process.env.HEADLESS === '1',
  slowMo: Number(process.env.SLOWMO || 0),
  artifacts: path.join(__dirname, 'artifacts'),
  storageState: path.join(__dirname, 'auth.json'),
  // Set to enable auth reuse: { path, user, pass, userSelector, passSelector, submitName } — delete auth.json to re-authenticate.
  login: null,
  // Batch report only: REPORT_DIR is the project's _raw/report folder, where the report screenshots go.
  reportDir: process.env.REPORT_DIR,
  // Batch report only: PHASE=before while the bug still reproduces, PHASE=after on the re-run that verifies the fix.
  phase: process.env.PHASE,
};

const PHASES = ['before', 'after'];
// The red pencil for report screenshots: a loop `pad` px outside the target whose tail runs `overlap`
// radians past its own start and drifts `drift` px outward, like a circle drawn by hand.
// `start` and `start + overlap` both sit on the top-left corner (-π to -π/2), where the two ends cross.
const PENCIL = { color: '#ff0000', width: 7, pad: 10, start: -2.6, overlap: 0.9, drift: 11, steps: 120 };

const log = (...a) => console.log(...a);
const problems = [];

// Wait on a real condition. Use this for anything the page has to finish first.
async function until(page, fn, { timeout = 20000, every = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for: ${fn}`);
    await page.waitForTimeout(every);
  }
}

function watch(page) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
}

async function authenticate(browser) {
  const { login, storageState, baseUrl } = CONFIG;
  if (!login) return undefined;
  if (fs.existsSync(storageState)) return storageState;
  const ctx = await browser.newContext({ viewport: CONFIG.viewport });
  const page = await ctx.newPage();
  await page.goto(baseUrl + login.path, { waitUntil: 'domcontentloaded' });
  await page.fill(login.userSelector, login.user);
  await page.fill(login.passSelector, login.pass);
  await page.getByRole('button', { name: login.submitName }).click();
  await page.waitForURL((u) => !u.pathname.startsWith(login.path), { timeout: 30000 });
  await ctx.storageState({ path: storageState });
  await ctx.close();
  log(`saved session to ${storageState}`);
  return storageState;
}

async function shot(page, name, dir = CONFIG.artifacts) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log(`shot: ${file}`);
  return file;
}

function dump(name, data) {
  fs.mkdirSync(CONFIG.artifacts, { recursive: true });
  const file = path.join(CONFIG.artifacts, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  log(`dump: ${file}`);
}

// Circle the target (a locator) in red pencil. Returns a handle to the mark, so the caller can remove it.
async function mark(page, target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  return page.evaluateHandle(({ box, pencil }) => {
    // Keep the loop inside the viewport, so a target that touches an edge still gets a whole circle.
    const margin = pencil.pad + pencil.drift + pencil.width;
    const left = Math.max(box.x, margin);
    const top = Math.max(box.y, margin);
    const right = Math.min(box.x + box.width, document.documentElement.clientWidth - margin);
    const bottom = Math.min(box.y + box.height, document.documentElement.clientHeight - margin);
    const halfWidth = (right - left) / 2;
    const halfHeight = (bottom - top) / 2;
    // Rounder corners where the target has room for them, capped so its own corners stay inside the loop.
    const inset = Math.min(2 * pencil.pad, halfWidth, halfHeight);
    const fullTurn = 2 * Math.PI;
    const points = Array.from({ length: pencil.steps + 1 }, (_, i) => {
      const travelled = (i / pencil.steps) * (fullTurn + pencil.overlap);
      const angle = pencil.start + travelled;
      // The loop keeps its distance all the way round; only the tail past the start drifts outward.
      const radius = pencil.pad + inset + pencil.drift * Math.max(0, travelled - fullTurn) / pencil.overlap;
      const x = left + halfWidth + Math.sign(Math.cos(angle)) * (halfWidth - inset) + radius * Math.cos(angle);
      const y = top + halfHeight + Math.sign(Math.sin(angle)) * (halfHeight - inset) + radius * Math.sin(angle);
      return `${x},${y}`;
    });
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647';
    const loop = document.createElementNS(NS, 'path');
    loop.setAttribute('d', `M${points.join('L')}`);
    // Inline styles, because a page stylesheet that styles every path would win over presentation attributes.
    loop.style.cssText = `fill:none;stroke:${pencil.color};stroke-width:${pencil.width}px;stroke-linecap:round;stroke-linejoin:round`;
    svg.appendChild(loop);
    document.body.appendChild(svg);
    return svg;
  }, { box, pencil: PENCIL });
}

// The Before/After screenshot for the batch report: the target circled, saved as <script>-<phase>.png in the report folder.
async function reportShot(page, target) {
  const { reportDir, phase } = CONFIG;
  if (!reportDir || !PHASES.includes(phase)) {
    throw new Error(`reportShot needs REPORT_DIR=<project>/_raw/report and PHASE=before or PHASE=after, got REPORT_DIR=${reportDir} PHASE=${phase}`);
  }
  const circle = await mark(page, target);
  const file = await shot(page, `${path.basename(__filename, '.cjs')}-${phase}`, reportDir);
  await circle.evaluate((svg) => svg.remove());
  return file;
}

// Everything specific to the bug goes here. Return the observation, do not judge it.
async function reproduce(page) {
  // Replace with the condition that means "this screen is actually ready".
  await until(page, () => !document.querySelector('.spinner, [aria-busy="true"]'));

  const observed = await page.evaluate(() => ({
    title: document.title,
    rows: document.querySelectorAll('[data-row]').length,
  }));

  await shot(page, 'state');
  // In a batch, call reportShot(page, <locator of the issue>) here too (SKILL.md "Reporting a batch").
  return observed;
}

(async () => {
  const browser = await chromium.launch({ headless: CONFIG.headless, slowMo: CONFIG.slowMo });
  const state = await authenticate(browser);
  const ctx = await browser.newContext({ viewport: CONFIG.viewport, storageState: state });
  const page = await ctx.newPage();
  watch(page);

  await page.goto(CONFIG.baseUrl + CONFIG.startPath, { waitUntil: 'domcontentloaded', timeout: 45000 });

  const observed = await reproduce(page);

  log('\n=== OBSERVED ===');
  log(JSON.stringify(observed, null, 2));
  dump('observed', observed);

  log(`\n=== PROBLEMS (${problems.length}) ===`);
  problems.slice(0, 40).forEach((p) => log(`  ${p}`));

  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
