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
const MARK = { color: '#ff0000', width: 3, pad: 6 };

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

// Mark the target without changing app layout. The caller removes the returned SVG.
async function mark(page, target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box || box.width === 0 || box.height === 0) {
    throw new Error('Screenshot target has no visible area; choose the affected element or its container.');
  }
  return page.evaluateHandle(({ box, marker }) => {
    const inset = marker.width / 2;
    const left = Math.max(inset, box.x - marker.pad);
    const top = Math.max(inset, box.y - marker.pad);
    const right = Math.min(window.innerWidth - inset, box.x + box.width + marker.pad);
    const bottom = Math.min(window.innerHeight - inset, box.y + box.height + marker.pad);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647';
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', left);
    rect.setAttribute('y', top);
    rect.setAttribute('width', right - left);
    rect.setAttribute('height', bottom - top);
    rect.style.cssText = `fill:none;stroke:${marker.color};stroke-width:${marker.width}px`;
    svg.appendChild(rect);
    document.body.appendChild(svg);
    return svg;
  }, { box, marker: MARK });
}

// Add a caption below the captured viewport in a separate document, keeping the app unchanged.
async function captionedShot(page, name, caption, dir) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Report screenshots require an explicit viewport size.');
  const screenshot = await page.screenshot({ fullPage: false });
  const reportPage = await page.context().newPage();
  try {
    await reportPage.setViewportSize(viewport);
    await reportPage.setContent(`<!doctype html><html><head><style>
      html, body { margin: 0; background: white; overflow: hidden; }
      img { display: block; width: 100%; }
      p { margin: 0; padding: 16px 20px; color: #222; font: 16px/1.5 Arial, sans-serif;
          white-space: pre-wrap; overflow-wrap: anywhere; }
    </style></head><body><img alt="Captured application viewport"><p></p></body></html>`);
    await reportPage.evaluate(async ({ image, text }) => {
      const img = document.querySelector('img');
      img.src = image;
      document.querySelector('p').textContent = text;
      await img.decode();
      await document.fonts.ready;
    }, {
      image: `data:image/png;base64,${screenshot.toString('base64')}`,
      text: caption.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
    });
    const height = await reportPage.locator('body').evaluate(el => Math.ceil(el.getBoundingClientRect().height));
    await reportPage.setViewportSize({ width: viewport.width, height });
    return await shot(reportPage, name, dir);
  } finally {
    await reportPage.close();
  }
}

// Capture each view separately so chart and table evidence cannot overwrite each other.
async function reportShot(page, target, { captions = {}, view = '' } = {}) {
  const { reportDir, phase } = CONFIG;
  if (!reportDir || !PHASES.includes(phase)) {
    throw new Error(`reportShot needs REPORT_DIR=<project>/_raw/report and PHASE=before or PHASE=after, got REPORT_DIR=${reportDir} PHASE=${phase}`);
  }
  const caption = captions[phase];
  if (typeof caption !== 'string' || !caption.trim()) {
    throw new Error(`Provide captions.${phase} explaining the original issue or verified change.`);
  }
  await page.evaluate(() => document.fonts.ready);
  const annotation = await mark(page, target);
  try {
    const name = [path.basename(__filename, '.cjs'), view, phase].filter(Boolean).join('-');
    return await captionedShot(page, name, `${phase.toUpperCase()}: ${caption}`, reportDir);
  } finally {
    await annotation.evaluate(svg => svg.remove());
    await annotation.dispose();
  }
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
  // In a batch, use reportShot(page, target, { captions: { before: '...', after: '...' }, view: 'chart' }).
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
