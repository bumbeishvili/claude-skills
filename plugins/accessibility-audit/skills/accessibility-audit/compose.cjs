#!/usr/bin/env node
// One before/after image per fix: the two full-window screenshots side by side, the affected spot boxed in red, and
// a short caption under each screenshot saying what was wrong and what changed (straight quotes, no title banner).
// Boxes come from the .json that capture.cjs writes next to each screenshot, or are given in the spec.
//
//   node compose.cjs spec.json
// spec.json: [{ "out": "focus-ring.png",
//              "before": { "image": "before.png", "caption": "Before: the green ring is 2.3:1 on the footer" },
//              "after":  { "image": "after.png",  "caption": "After: a white ring, 12.6:1" } }]
// A side may give "box": { "x", "y", "width", "height" } in CSS px of its screenshot instead of the capture .json.
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/deps.cjs');
const png = require('./lib/png.cjs');

// Screenshots keep their CSS size (1:1), so a 2 px focus ring stays visible when the image is zoomed; captions grow
// with the panel so they stay readable when a viewer scales a wide composite down to its column.
const MARK = { colour: '#e0201d', width: 3, pad: 10 }; // pad in CSS px: clear of focus rings drawn outside the control
const captionPx = (panel) => Math.min(40, Math.max(16, Math.round(panel / 40)));

function side(spec, base) {
	const image = path.resolve(base, spec.image);
	if (!fs.existsSync(image)) throw new Error(`compose: ${image} not found`);
	const metaFile = image.replace(/\.png$/i, '') + '.json';
	const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null;
	const box = spec.box || meta?.box || null;
	const { width, height } = png.decode(fs.readFileSync(image));
	const cssWidth = meta?.viewport?.width || width;
	if (typeof spec.caption !== 'string' || !spec.caption.trim()) throw new Error(`compose: ${spec.image} needs a caption saying what it shows`);
	return { image, box, width, height, cssWidth, caption: spec.caption.replace(/[“”]/g, '"').replace(/[‘’]/g, "'") };
}

function panelHtml(s, panel) {
	const scale = panel / s.cssWidth;
	const imgHeight = Math.round((s.height / s.width) * panel);
	const mark = s.box
		? `<div class="mark" style="left:${Math.round((s.box.x - MARK.pad) * scale)}px;top:${Math.round((s.box.y - MARK.pad) * scale)}px;width:${Math.round((s.box.width + 2 * MARK.pad) * scale)}px;height:${Math.round((s.box.height + 2 * MARK.pad) * scale)}px"></div>`
		: '';
	return `<figure><div class="frame" style="height:${imgHeight}px"><img src="data:image/png;base64,${fs.readFileSync(s.image).toString('base64')}">${mark}</div><figcaption></figcaption></figure>`;
}

async function main() {
	const specFile = process.argv[2];
	if (!specFile) throw new Error('Usage: node compose.cjs spec.json');
	const base = path.dirname(path.resolve(specFile));
	const items = JSON.parse(fs.readFileSync(specFile, 'utf8'));
	const browser = await load('playwright').chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
	for (const item of items) {
		const before = side(item.before, base);
		const after = side(item.after, base);
		const panel = Math.max(before.cssWidth, after.cssWidth);
		await page.setViewportSize({ width: panel * 2 + 72, height: 600 });
		await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
			body { margin: 0; padding: 24px; background: #fff; display: inline-flex; gap: 24px; align-items: flex-start; font: ${captionPx(panel)}px/1.4 Arial, sans-serif; color: #222; }
			figure { margin: 0; width: ${panel}px; }
			.frame { position: relative; border: 1px solid #ccc; overflow: hidden; }
			img { width: ${panel}px; display: block; }
			.mark { position: absolute; box-sizing: border-box; border: ${MARK.width}px solid ${MARK.colour}; border-radius: 3px; }
			figcaption { margin-top: 0.6em; white-space: pre-wrap; }
		</style></head><body>${panelHtml(before, panel)}${panelHtml(after, panel)}</body></html>`);
		// Captions are set as text, never parsed as HTML.
		await page.evaluate(([a, b]) => {
			const caps = document.querySelectorAll('figcaption');
			caps[0].textContent = a;
			caps[1].textContent = b;
		}, [before.caption, after.caption]);
		await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
		const out = path.resolve(base, item.out);
		await page.locator('body').screenshot({ path: out });
		console.log(`wrote ${out}`);
	}
	await browser.close();
}

main().catch((error) => {
	console.error(error.stack || error.message);
	process.exit(1);
});
