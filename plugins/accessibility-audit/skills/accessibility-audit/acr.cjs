#!/usr/bin/env node
// The conformance table for the review team, in the style of a VPAT accessibility conformance report: one row per
// WCAG 2.2 A and AA criterion with its conformance level and remarks. A person decides each level after the audit,
// the headed pass and the manual checks; this script keeps the levels consistent with the audit's evidence.
//
//   node acr.cjs --findings _raw/a11y/findings.json --init _raw/a11y/conformance.json
//       writes the file to fill in: every criterion with what the audit found for it
//   node acr.cjs --findings _raw/a11y/findings.json --manual _raw/a11y/conformance.json --out _raw/a11y/conformance.md
//       renders the table; stops on a criterion left blank, an unknown level, or "Supports" with open failures
const fs = require('fs');
const path = require('path');
const { CRITERIA } = require('./lib/wcag.cjs');

const LEVELS = ['Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable'];

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const [flag, inline] = argv[i].split('=');
		const value = () => inline ?? argv[++i];
		if (flag === '--findings') args.findings = value();
		else if (flag === '--init') args.init = value();
		else if (flag === '--manual') args.manual = value();
		else if (flag === '--out') args.out = value();
		else throw new Error(`Unknown argument ${argv[i]}`);
	}
	if (!args.findings || !(args.init || (args.manual && args.out))) throw new Error('Usage: node acr.cjs --findings findings.json (--init conformance.json | --manual conformance.json --out conformance.md)');
	return args;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Per criterion: the audit's open failures and review items (best-practice rows left out). */
function evidence(findingsFile) {
	const { rows, meta } = JSON.parse(fs.readFileSync(findingsFile, 'utf8'));
	const bySc = new Map(CRITERIA.map((c) => [c.sc, { fails: [], reviews: [] }]));
	for (const row of rows.filter((r) => !r.bestPractice)) {
		for (const sc of row.sc) {
			const entry = bySc.get(sc);
			if (!entry) continue;
			(row.outcome === 'fail' ? entry.fails : entry.reviews).push(`${row.messages[0]} [${row.name || row.element}]`);
		}
	}
	return { bySc, meta };
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const { bySc, meta } = evidence(args.findings);
	const criteria = CRITERIA.filter((c) => c.level === 'A' || c.level === 'AA');
	if (args.init) {
		if (fs.existsSync(args.init)) throw new Error(`${args.init} exists; it holds decisions, so it is not overwritten`);
		const skeleton = Object.fromEntries(criteria.map((c) => {
			const e = bySc.get(c.sc);
			return [c.sc, { criterion: c.name, conformance: '', remarks: '', audit: `${e.fails.length} failures, ${e.reviews.length} to review`, failures: e.fails.slice(0, 5), toReview: e.reviews.slice(0, 5), manualStep: c.manual }];
		}));
		fs.writeFileSync(args.init, JSON.stringify(skeleton, null, 1));
		console.log(`Wrote ${args.init}: set "conformance" (${LEVELS.join(', ')}) and "remarks" for all ${criteria.length} criteria.`);
		return;
	}
	const manual = JSON.parse(fs.readFileSync(args.manual, 'utf8'));
	const problems = [];
	const rows = criteria.map((c) => {
		const m = manual[c.sc];
		const e = bySc.get(c.sc);
		if (!m || !m.conformance) problems.push(`${c.sc} ${c.name}: no conformance level`);
		else if (!LEVELS.includes(m.conformance)) problems.push(`${c.sc}: "${m.conformance}" is not one of ${LEVELS.join(', ')}`);
		else if (m.conformance === 'Supports' && e.fails.length) problems.push(`${c.sc}: marked Supports with ${e.fails.length} open audit failures (first: ${e.fails[0]})`);
		if (m && m.conformance && m.conformance !== 'Supports' && !String(m.remarks || '').trim()) problems.push(`${c.sc}: ${m.conformance} needs remarks saying what does not conform and where`);
		return { ...c, conformance: m?.conformance, remarks: m?.remarks || '' };
	});
	if (problems.length) throw new Error(`${args.manual} is not ready:\n  ${problems.join('\n  ')}`);
	const count = (level) => rows.filter((r) => r.conformance === level).length;
	const lines = [
		`# WCAG 2.2 conformance: ${meta.name}`,
		'',
		`Evaluated ${meta.date} at ${meta.baseUrl} against WCAG 2.2 levels A and AA. ${LEVELS.map((l) => `${count(l)} ${l}`).join(', ')}.`,
		'',
		'| Criterion | Level | Conformance | Remarks |',
		'|---|---|---|---|',
		...rows.map((r) => `| ${r.sc} ${cell(r.name)} | ${r.level} | ${r.conformance} | ${cell(r.remarks)} |`),
		''
	];
	fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
	fs.writeFileSync(args.out, lines.join('\n'));
	console.log(`Wrote ${args.out}`);
}

try {
	main();
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
