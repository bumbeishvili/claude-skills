// Linked documents. PDFs are downloaded and read: tagged or not (pdfinfo), document title, document language, and
// structure-tree errors (pdfinfo -struct). Language and figure alt text are read from the PDF's own objects,
// inflating its compressed streams. Office documents are listed for checking in their own application.
// A tagged PDF can still read in the wrong order or miss alt text: PAC (free) or Acrobat's checker settles that.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');
const { finding } = require('./checks.cjs');

function pdfinfo(args) {
	return execFileSync('pdfinfo', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The PDF's objects as text, with Flate streams inflated (object streams hide the catalog in compressed PDFs). */
function readableObjects(buffer) {
	const parts = [buffer.toString('latin1')];
	const raw = parts[0];
	const re = /stream\r?\n/g;
	let match;
	while ((match = re.exec(raw))) {
		const start = match.index + match[0].length;
		const end = raw.indexOf('endstream', start);
		if (end < 0) break;
		const dict = raw.slice(Math.max(0, match.index - 300), match.index);
		if (/\/FlateDecode/.test(dict) && !/\/(Image|DCTDecode|JPXDecode)/.test(dict)) {
			try {
				parts.push(zlib.inflateSync(buffer.subarray(start, end)).toString('latin1'));
			} catch {
				// Streams with a trailing newline inside the length, or other filters chained, are left unread.
			}
		}
		re.lastIndex = end;
	}
	return parts.join('\n');
}

function inspectPdf(file) {
	const info = pdfinfo([file]);
	const field = (name) => (new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(info) || [])[1]?.trim() || '';
	// pdfinfo -struct prints the structure tree on stdout and each problem as a "Syntax Error" line on stderr.
	const struct = spawnSync('pdfinfo', ['-struct', file], { encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 * 1024 });
	if (struct.error) throw new Error(`pdfinfo -struct failed on ${file}: ${struct.error.message}`);
	const errors = (struct.stderr || '').split('\n').filter((l) => /Syntax Error/.test(l));
	const structErrors = errors.length;
	const structSample = [...new Set(errors.map((l) => l.replace(/^Syntax Error( \(\d+\))?: /, '')))].slice(0, 3).join(' | ');
	const text = readableObjects(fs.readFileSync(file));
	// Strings are literal "(en-US)" or hex "<FEFF0065006E>"; both count.
	const langMatch = /\/Lang\s*(?:\(([^)]*)\)|<([0-9A-Fa-f\s]+)>)/.exec(text);
	const lang = langMatch ? langMatch[1] ?? Buffer.from(langMatch[2].replace(/\s+/g, ''), 'hex').toString('utf16le').replace(/^\uFFFE|^\uFEFF/, '').replace(/\0/g, '') : '';
	const figures = (text.match(/\/S\s*\/Figure\b/g) || []).length;
	const alts = (text.match(/\/Alt\s*[(<]/g) || []).length;
	return { title: field('Title'), tagged: field('Tagged') === 'yes', pages: Number(field('Pages')) || null, producer: field('Producer'), version: field('PDF version'), lang, figures, alts, structErrors, structSample };
}

/** Checks every linked document found on the audited pages. `documents` is [{ href, name, page }]. */
async function documentChecks(request, documents, { outDir }) {
	const findings = [];
	const results = [];
	const seen = new Set();
	const pdfDir = path.join(outDir, 'documents');
	fs.mkdirSync(pdfDir, { recursive: true });
	const hasPdfinfo = (() => {
		try {
			pdfinfo(['-v']);
			return true;
		} catch (error) {
			return error.code !== 'ENOENT';
		}
	})();
	for (const doc of documents) {
		if (seen.has(doc.href)) continue;
		seen.add(doc.href);
		const add = (check, message, evidence) => findings.push(finding(check, { state: doc.page, target: doc.href, node: doc.href, name: doc.name || doc.href, message, evidence, source: 'documents' }));
		if (!/\.pdf(\?|#|$)/i.test(doc.href)) {
			add('doc:office-document', `${doc.href.split('/').pop()} is linked from ${doc.page}: check headings, alt text, tables and reading order in its own application, or link an accessible HTML or PDF version`, {});
			results.push({ href: doc.href, kind: 'office' });
			continue;
		}
		if (!hasPdfinfo) throw new Error('pdfinfo is not installed, so linked PDFs cannot be checked: brew install poppler (or remove the pages linking PDFs from this run)');
		const response = await request.get(doc.href);
		if (!response.ok()) throw new Error(`Linked PDF ${doc.href} (from ${doc.page}) returned HTTP ${response.status()}`);
		const file = path.join(pdfDir, `${results.length + 1}-${decodeURIComponent(doc.href.split('/').pop().split('?')[0]).replace(/[^\w.-]+/g, '_')}`);
		fs.writeFileSync(file, await response.body());
		const r = inspectPdf(file);
		results.push({ href: doc.href, file: path.relative(outDir, file), ...r });
		if (!r.tagged) add('doc:pdf-untagged', `${doc.name || doc.href} has no tags: screen readers get no headings, lists, tables or alt text, and reading order is a guess`, r);
		if (!r.title) add('doc:pdf-no-title', `${doc.name || doc.href} has no document title`, r);
		if (!r.lang) add('doc:pdf-no-lang', `${doc.name || doc.href} declares no document language`, r);
		if (r.structErrors) add('doc:pdf-structure-errors', `pdfinfo reports ${r.structErrors} structure-tree errors (${r.structSample}); ${r.figures} figures, ${r.alts} alt texts; check it with PAC or Acrobat's accessibility checker`, r);
		else if (r.tagged && r.figures > r.alts) add('doc:pdf-structure-errors', `${r.figures} figures but ${r.alts} alt texts in ${doc.name || doc.href}`, r);
	}
	return { findings, results };
}

module.exports = { documentChecks, inspectPdf };
