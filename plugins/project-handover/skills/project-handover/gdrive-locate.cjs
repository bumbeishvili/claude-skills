#!/usr/bin/env node
// Find where a Google Doc lives in Drive, on the signed-in browser at CDP :9222:
// search by title, right-click the first matching row, File information → Show file
// location, then print the folder URL and the page title ("<folder> - <drive>").
//   NODE_PATH="$(npm root -g)" node gdrive-locate.cjs "<exact document title>"
const { chromium } = require('playwright');

const title = process.argv[2];
if (!title) { console.error('usage: node gdrive-locate.cjs "<document title>"'); process.exit(1); }
const PORT = process.env.CDP_PORT || '9222';

(async () => {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  const page = await browser.contexts()[0].newPage();
  await page.goto(`https://drive.google.com/drive/search?q=${encodeURIComponent(title)}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(4000);

  const row = page.locator('[role="row"]', { hasText: title }).first();
  if (!(await row.count())) { console.error('no Drive row matches that title'); process.exit(1); }
  console.log('search row:', (await row.innerText()).replace(/\s+/g, ' ').trim());

  // "Show file location" sits in the File information submenu; hovering does not open
  // submenus reliably, clicking the parent item does.
  await row.click({ button: 'right' });
  await page.waitForTimeout(1200);
  await page.locator('[role="menuitem"]:visible', { hasText: /^File information/ }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('[role="menuitem"]:visible', { hasText: /file location/i }).first().click();
  await page.waitForTimeout(4500);

  console.log('folder url:', page.url());
  console.log('location  :', await page.title()); // "<folder> - <shared drive> - Google Drive"
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
