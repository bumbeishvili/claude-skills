#!/usr/bin/env node
// Read a Google Doc back through its mobilebasic HTML view, using the signed-in
// browser on CDP :9222. Prints the structure in document order — table rows as
// "label ║ value", list items as bullets — with a bold/italic flag pair and the text
// colour per line, then a link audit. Use it after every edit batch.
//   NODE_PATH="$(npm root -g)" node gdoc-outline.cjs <docId> [--text]   (--text = plain innerText only)
const { chromium } = require('playwright');

const docId = process.argv[2];
const plain = process.argv.includes('--text');
if (!docId) { console.error('usage: node gdoc-outline.cjs <docId> [--text]'); process.exit(1); }
const PORT = process.env.CDP_PORT || '9222';

(async () => {
  const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
  const page = await browser.contexts()[0].newPage();
  await page.goto(`https://docs.google.com/document/d/${docId}/mobilebasic`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2000); // the view can lag a just-made edit

  const result = await page.evaluate((plain) => {
    const root = document.querySelector('.doc-content') || document.body;
    if (plain) return { text: root.innerText };
    const flags = (el) => {
      const spans = [...el.querySelectorAll('span')].filter((s) => s.innerText.trim());
      if (!spans.length) return '--   ' + ' '.repeat(18);
      const cs = getComputedStyle(spans[0]);
      const bold = spans.some((s) => getComputedStyle(s).fontWeight === '700') ? 'B' : '-';
      const ital = spans.some((s) => getComputedStyle(s).fontStyle === 'italic') ? 'I' : '-';
      return `${bold}${ital} ${cs.color.padEnd(18)}`;
    };
    const squash = (t) => t.trim().replace(/\s+/g, ' ');
    const lines = [];
    for (const el of root.children) {
      if (el.tagName === 'TABLE') {
        for (const tr of el.querySelectorAll('tr')) {
          const cells = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim().replace(/\n+/g, ' ⏎ ').replace(/\s+/g, ' '));
          lines.push(`${flags(tr)} [row] ${cells.join('  ║  ')}`);
        }
      } else if (el.tagName === 'UL' || el.tagName === 'OL') {
        for (const li of el.querySelectorAll('li')) lines.push(`${flags(li)}   • ${squash(li.innerText)}`);
      } else {
        const t = squash(el.innerText);
        if (t) lines.push(`${flags(el)} ${t}`);
      }
    }
    const anchors = [...root.querySelectorAll('a')].map((a) => a.innerText.trim().replace(/[.,;)]$/, ''));
    const linked = new Set(anchors);
    const urls = [...new Set([...root.innerText.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0].replace(/[.,;]$/, '')))];
    return {
      lines,
      unlinkedUrls: urls.filter((u) => !linked.has(u)),
      nonUrlLinks: [...linked].filter((l) => !/^https?:|@/.test(l))
    };
  }, plain);

  if (plain) console.log(result.text);
  else {
    console.log('BI colour             | content');
    console.log(result.lines.join('\n'));
    console.log('\nURLs not hyperlinked:', result.unlinkedUrls.length ? result.unlinkedUrls : 'none');
    console.log('links whose text is not a URL/e-mail:', result.nonUrlLinks.length ? result.nonUrlLinks : 'none');
  }
  await page.close();
  process.exit(0); // detach without closing the shared browser
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
