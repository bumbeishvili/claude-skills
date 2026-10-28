// Pixel maths for the checks that measure what is drawn: PNG decoding (the 8-bit, non-interlaced RGB and RGBA
// images browsers produce for screenshots) and WCAG contrast between pixels. No dependencies: zlib is built in.
const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }; // grey, RGB, grey+alpha, RGBA

/** Decodes a PNG buffer to { width, height, data } with data as RGBA bytes. */
function decode(buffer) {
	if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('decode: not a PNG');
	let offset = 8;
	let header = null;
	const idat = [];
	while (offset < buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString('ascii', offset + 4, offset + 8);
		const body = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9], interlace: body[12] };
		} else if (type === 'IDAT') idat.push(body);
		else if (type === 'IEND') break;
		offset += 12 + length;
	}
	if (!header) throw new Error('decode: PNG has no IHDR chunk');
	if (header.depth !== 8 || header.interlace !== 0 || !(header.colour in CHANNELS)) {
		throw new Error(`decode: unsupported PNG (bit depth ${header.depth}, colour type ${header.colour}, interlace ${header.interlace})`);
	}
	const channels = CHANNELS[header.colour];
	const stride = header.width * channels;
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const pixels = Buffer.alloc(header.width * header.height * channels);
	let previous = Buffer.alloc(stride);
	for (let y = 0; y < header.height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const out = pixels.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? out[x - channels] : 0;
			const up = previous[x];
			const upLeft = x >= channels ? previous[x - channels] : 0;
			let value = line[x];
			if (filter === 1) value += left;
			else if (filter === 2) value += up;
			else if (filter === 3) value += (left + up) >> 1;
			else if (filter === 4) {
				const p = left + up - upLeft;
				const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
				value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
			} else if (filter !== 0) throw new Error(`decode: unknown PNG filter ${filter} on row ${y}`);
			out[x] = value & 0xff;
		}
		previous = out;
	}
	const data = Buffer.alloc(header.width * header.height * 4);
	for (let i = 0, j = 0; i < header.width * header.height; i++, j += channels) {
		const grey = channels <= 2;
		data[i * 4] = pixels[j];
		data[i * 4 + 1] = grey ? pixels[j] : pixels[j + 1];
		data[i * 4 + 2] = grey ? pixels[j] : pixels[j + 2];
		data[i * 4 + 3] = channels === 4 ? pixels[j + 3] : channels === 2 ? pixels[j + 1] : 255;
	}
	return { width: header.width, height: header.height, data };
}

const linear = (v) => {
	const c = v / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** WCAG relative luminance of an [r, g, b] colour in 0-255. */
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG contrast ratio of two [r, g, b] colours, 1 to 21. */
function contrast(a, b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const pixelAt = (image, x, y) => {
	const i = (y * image.width + x) * 4;
	return [image.data[i], image.data[i + 1], image.data[i + 2]];
};

function percentile(sorted, p) {
	if (!sorted.length) return null;
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/**
 * Compares two screenshots of the same region: `before` and `after` a change (focus arriving, an icon drawn).
 * Images of different sizes are compared over their common top-left area. Returns the changed area and how strongly
 * it changed, in device pixels: `changed` counts pixels whose colour moved at all, `strong` those whose old and new
 * colours differ by at least `minRatio` contrast (3:1 is the WCAG bar for indicators and graphics). Pixels inside
 * any `mask` box ({ x, y, w, h } in image pixels) are left out, for a neighbour whose own state changed meanwhile.
 */
function compare(before, after, { minRatio = 3, noise = 12, mask = [] } = {}) {
	const width = Math.min(before.width, after.width);
	const height = Math.min(before.height, after.height);
	let changed = 0;
	let strong = 0;
	const ratios = [];
	const box = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
	const masked = (x, y) => mask.some((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const a = pixelAt(before, x, y);
			const b = pixelAt(after, x, y);
			if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= noise) continue;
			if (mask.length && masked(x, y)) continue;
			changed++;
			const ratio = contrast(a, b);
			ratios.push(ratio);
			if (ratio >= minRatio) strong++;
			box.minX = Math.min(box.minX, x);
			box.minY = Math.min(box.minY, y);
			box.maxX = Math.max(box.maxX, x);
			box.maxY = Math.max(box.maxY, y);
		}
	}
	ratios.sort((x, y) => x - y);
	return {
		width,
		height,
		changed,
		strong,
		maxRatio: ratios.length ? +ratios[ratios.length - 1].toFixed(2) : 1,
		p90Ratio: ratios.length ? +percentile(ratios, 90).toFixed(2) : 1,
		box: changed ? { x: box.minX, y: box.minY, w: box.maxX - box.minX + 1, h: box.maxY - box.minY + 1 } : null
	};
}

/**
 * Contrast of text against what is actually behind it: `withText` and `withoutText` are the same region with the
 * text drawn and with it made transparent. Pixels that differ are the glyphs; the background under each is read
 * from `withoutText`. Returns the ratio between `textColour` and those background pixels at the low end (p10) and the
 * median, so a light patch behind part of the text is caught. Translucent text (`alpha` below 1) is blended over
 * each background pixel first, as the browser draws it.
 */
function textContrast(withText, withoutText, textColour, { noise = 24, alpha = 1 } = {}) {
	const width = Math.min(withText.width, withoutText.width);
	const height = Math.min(withText.height, withoutText.height);
	const ratios = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const a = pixelAt(withText, x, y);
			const b = pixelAt(withoutText, x, y);
			if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= noise) continue;
			const fg = alpha >= 1 ? textColour : textColour.map((c, i) => c * alpha + b[i] * (1 - alpha));
			ratios.push(contrast(fg, b));
		}
	}
	ratios.sort((x, y) => x - y);
	if (!ratios.length) return { glyphPixels: 0, p10: null, median: null, min: null };
	return { glyphPixels: ratios.length, min: +ratios[0].toFixed(2), p10: +percentile(ratios, 10).toFixed(2), median: +percentile(ratios, 50).toFixed(2) };
}

module.exports = { decode, luminance, contrast, compare, textContrast, pixelAt };
