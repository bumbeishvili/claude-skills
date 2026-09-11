#!/usr/bin/env node
// Long-lived headed Chrome on a persistent profile, exposing CDP on :9222 so the
// other scripts can drive the same signed-in Google session one step at a time.
// The user signs in to Google in this window once; the profile keeps the session.
// Run in the background and leave the window open:
//   NODE_PATH="$(npm root -g)" node gdoc-browser.cjs <docId>
const { chromium } = require('playwright');
const os = require('os');
const path = require('path');

const docId = process.argv[2];
if (!docId) { console.error('usage: node gdoc-browser.cjs <docId>'); process.exit(1); }
// The profile holds a live Google session — keep it out of the project tree.
const PROFILE = process.env.GDOC_PROFILE || path.join(os.tmpdir(), 'project-handover-profile');
const PORT = process.env.CDP_PORT || '9222';

(async () => {
  const opts = { headless: false, viewport: null, args: [`--remote-debugging-port=${PORT}`] };
  let ctx;
  // Installed Chrome is less likely to trip Google's "browser not secure" sign-in block.
  try { ctx = await chromium.launchPersistentContext(PROFILE, { ...opts, channel: 'chrome' }); }
  catch { ctx = await chromium.launchPersistentContext(PROFILE, opts); }
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`https://docs.google.com/document/d/${docId}/edit`, { waitUntil: 'domcontentloaded' });
  console.log(`browser up on CDP :${PORT} — sign in if asked, then leave this window open`);
  ctx.on('close', () => { console.log('browser closed'); process.exit(0); });
  await new Promise(() => {});
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
