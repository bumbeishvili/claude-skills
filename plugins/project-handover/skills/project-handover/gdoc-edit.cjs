#!/usr/bin/env node
// Edit a Google Doc through Docs' Find box and keyboard shortcuts, on the signed-in
// browser at CDP :9222. Ops come from a JSON file: [{ find, steps }].
//   find  — text to locate; Cmd+F, Cmd+A, type, Esc leaves the match selected
//   steps — run in order: { press: 'Key' } or { type: 'text' } ('\n' in text = Enter)
// Take `find` strings from gdoc-outline.cjs output (Docs curls quotes and capitalises).
// Dry-run one op, read back, then batch. See playbook.md for the key sequences.
//   NODE_PATH="$(npm root -g)" node gdoc-edit.cjs <docId> ops.json
const { chromium } = require('playwright');
const fs = require('fs');

const [docId, opsPath] = process.argv.slice(2);
if (!docId || !opsPath) { console.error('usage: node gdoc-edit.cjs <docId> <ops.json>'); process.exit(1); }
const OPS = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
const PORT = process.env.CDP_PORT || '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().includes(`/document/d/${docId}`));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(`https://docs.google.com/document/d/${docId}/edit`, { waitUntil: 'domcontentloaded' });
  }
  await page.bringToFront();
  await page.waitForSelector('.kix-appview-editor', { timeout: 30000 });
  // Click well right of the outline sidebar, which overlaps the editor's left edge.
  await page.click('.kix-appview-editor', { position: { x: 700, y: 200 }, force: true });
  await sleep(500);

  for (const op of OPS) {
    await page.keyboard.press('Meta+f');
    await sleep(400);
    await page.keyboard.press('Meta+a');
    await page.keyboard.type(op.find, { delay: 5 });
    await sleep(800);
    await page.keyboard.press('Escape');
    await sleep(400);
    for (const s of op.steps ?? []) {
      if (s.press) { await page.keyboard.press(s.press); await sleep(150); }
      if (s.type) { await page.keyboard.type(s.type, { delay: 3 }); await sleep(150); }
    }
    await sleep(500);
    console.log('edited:', op.find.slice(0, 60));
  }
  await sleep(2000); // let Docs save
  process.exit(0); // detach without closing the shared browser
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
