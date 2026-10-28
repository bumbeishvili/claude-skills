// Turns raw findings from every state, page and flow into the audit report: duplicates merged (the same element
// reported by several engines, or in several states, becomes one row listing all its sources and states), sorted
// failures first and by severity, and the WCAG 2.2 conformance worksheet with every A and AA criterion.
const fs = require('fs');
const path = require('path');
const { CHECKS, SEVERITY_ORDER } = require('./checks.cjs');
const { CRITERIA, criterion } = require('./wcag.cjs');

const rank = (s) => (SEVERITY_ORDER.indexOf(s) < 0 ? SEVERITY_ORDER.length : SEVERITY_ORDER.indexOf(s));

/** Merges findings about the same element whose criteria overlap (or the same check with no element). */
function merge(findings) {
	const groups = new Map();
	for (const f of findings) {
		const key = f.node || f.target || `${f.check}|${f.message}`;
		const list = groups.get(key) || [];
		let row = list.find((r) => r.sc.some((sc) => f.sc.includes(sc)) || (!r.sc.length && !f.sc.length && r.checks.has(f.check)));
		if (!row) {
			row = { key, element: f.node || f.target, name: f.name, sc: [], checks: new Set(), states: new Set(), messages: [], severity: f.severity, outcome: f.outcome, bestPractice: true, shots: new Set(), helpUrl: null };
			list.push(row);
		}
		row.sc = [...new Set([...row.sc, ...f.sc])].sort();
		row.checks.add(f.check);
		if (f.state) row.states.add(f.state);
		if (!row.messages.includes(f.message)) row.messages.push(f.message);
		if (rank(f.severity) < rank(row.severity)) row.severity = f.severity;
		if (f.outcome === 'fail') row.outcome = 'fail';
		// Best practice only while every finding in the row is: outside A/AA, or classed as a recommendation by its engine.
		const levels = f.sc.map((sc) => criterion(sc).level);
		if (!f.bestPractice && levels.some((l) => l === 'A' || l === 'AA')) row.bestPractice = false;
		row.name = row.name || f.name;
		if (f.shot) row.shots.add(f.shot);
		if (f.evidence?.shot) row.shots.add(f.evidence.shot);
		row.helpUrl = row.helpUrl || f.helpUrl || null;
		groups.set(key, list);
	}
	return [...groups.values()].flat().map((r) => ({ ...r, checks: [...r.checks], states: [...r.states], shots: [...r.shots] }))
		.sort((a, b) => (a.outcome === b.outcome ? 0 : a.outcome === 'fail' ? -1 : 1) || a.bestPractice - b.bestPractice || rank(a.severity) - rank(b.severity) || a.sc.join().localeCompare(b.sc.join()));
}

/** Per criterion: merged rows that touch it, and whether any automated check covered it in this run. */
function conformance(rows, coverage) {
	return CRITERIA.map((c) => {
		const touching = rows.filter((r) => r.sc.includes(c.sc));
		const fails = touching.filter((r) => r.outcome === 'fail').length;
		const reviews = touching.filter((r) => r.outcome === 'review').length;
		const covered = coverage.has(c.sc);
		const status = fails ? 'Fails' : reviews ? 'Review' : covered ? 'No automated failures' : 'Not covered by automation';
		return { ...c, fails, reviews, covered, status };
	});
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function markdown({ rows, matrix, meta, states, documents, inventories, flows }) {
	const fails = rows.filter((r) => r.outcome === 'fail' && !r.bestPractice);
	const reviews = rows.filter((r) => r.outcome === 'review' && !r.bestPractice);
	const bp = rows.filter((r) => r.bestPractice);
	const bySeverity = (list) => SEVERITY_ORDER.map((s) => `${list.filter((r) => r.severity === s).length} ${s}`).join(', ');
	const failed = states.filter((s) => s.error);
	const lines = [];
	lines.push(`# Accessibility audit: ${meta.name}`, '');
	lines.push(`${states.length} states and ${meta.pages.length} pages checked on ${meta.date} against WCAG 2.2 A and AA. ${fails.length} failures (${bySeverity(fails)}), ${reviews.length} items to review, ${bp.length} best-practice notes.${failed.length ? ` ${failed.length} states did not run: see "States that did not run".` : ''}`, '');
	lines.push(`Base URL ${meta.baseUrl}; ${meta.browser}; axe-core ${meta.axeVersion}; IBM Equal Access ${meta.ibmVersion}; virtual screen reader ${meta.vsrVersion}. Raw data: findings.json, states/*.json.`, '');
	if (failed.length) {
		lines.push('## States that did not run', '', '| State | Error |', '|---|---|');
		for (const s of failed) lines.push(`| ${cell(s.id)} | ${cell(s.error)} |`);
		lines.push('');
	}
	const table = (title, list, intro) => {
		lines.push(`## ${title}`, '');
		if (intro) lines.push(intro, '');
		if (!list.length) return lines.push('None.', '');
		lines.push('| # | Severity | WCAG | Issue | Element | States | Checks | Evidence |', '|---|---|---|---|---|---|---|---|');
		list.forEach((r, i) => lines.push(`| ${i + 1} | ${r.severity} | ${r.sc.join(', ') || 'BP'} | ${cell(short(r.messages[0], 220))}${r.messages.length > 1 ? ` (+${r.messages.length - 1} more)` : ''} | ${cell(short(r.name || r.element || '', 70))} | ${cell(short(r.states.join(', '), 60))} | ${cell(r.checks.join(', '))} | ${r.shots.map((s) => `[img](shots/${s})`).join(' ')} |`));
		lines.push('');
	};
	table('Failures', fails, 'Definite failures against WCAG 2.2 A or AA. Fix these first, most severe first.');
	table('To review', reviews, 'Heuristics and partial results: each needs a person to confirm or dismiss it.');
	table('Best practice', bp, 'Beyond WCAG A and AA, but commonly raised by review teams.');

	lines.push('## WCAG 2.2 conformance worksheet', '', 'Status comes from this run: "Fails" and "Review" link to rows above; "No automated failures" still needs the manual step; "Not covered by automation" depends on it entirely. Fill the last column during the headed pass.', '');
	lines.push('| SC | Criterion | Level | Status | Fails | Review | Manual step | Result |', '|---|---|---|---|---|---|---|---|');
	for (const c of matrix.filter((m) => m.level === 'A' || m.level === 'AA')) lines.push(`| ${c.sc} | ${cell(c.name)} | ${c.level} | ${c.status} | ${c.fails || ''} | ${c.reviews || ''} | ${cell(c.manual)} | |`);
	lines.push('');

	lines.push('## States', '', '| State | Path | Viewport | Tab stops | Reached / focusable | Walk ended | Focus map | Transcript |', '|---|---|---|---|---|---|---|---|');
	for (const s of states.filter((x) => !x.error)) lines.push(`| ${cell(s.id)} | ${cell(s.path)} | ${s.viewport} | ${s.stops} | ${s.reached}/${s.inventory} | ${cell(s.end)} | ${s.map ? `[map](${s.map})` : ''} | ${s.transcript ? `[text](${s.transcript})` : ''} |`);
	lines.push('');

	if (flows.length) {
		lines.push('## Flows', '', 'Each step as a keyboard and screen-reader user meets it: where focus is after the step and what was announced.', '');
		for (const flow of flows) {
			lines.push(`### ${flow.id}`, '');
			if (flow.error) lines.push(`Stopped: ${cell(flow.error)}`, '');
			lines.push('| Step | Focus after | Announced | Page title |', '|---|---|---|---|');
			for (const row of flow.transcript) lines.push(`| ${cell(row.step)} | ${cell(row.focus)} | ${cell(row.announced.join(' · ') || '(nothing)')} | ${cell(row.title)} |`);
			lines.push('');
		}
	}

	if (documents.length) {
		lines.push('## Linked documents', '', '| Document | Tagged | Title | Language | Figures / alt | Structure errors |', '|---|---|---|---|---|---|');
		for (const d of documents) lines.push(d.kind === 'office' ? `| ${cell(d.href)} | (Office document: check in its application) | | | | |` : `| ${cell(d.href)} | ${d.tagged ? 'yes' : 'NO'} | ${cell(d.title || 'none')} | ${d.lang || 'none'} | ${d.figures} / ${d.alts} | ${d.structErrors} |`);
		lines.push('');
	}

	lines.push('## For a person to read', '', 'Automation can say an image has alt text, not whether the text is right. Read these lists in the headed pass.', '');
	for (const [state, inv] of Object.entries(inventories)) {
		lines.push(`### ${state}`, '');
		lines.push(`Title: "${cell(inv.title)}"; lang: ${inv.lang || 'none'}.`, '');
		lines.push(`Headings: ${inv.headings.map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}h${h.level} ${h.text}`).join(' · ') || 'none'}`, '');
		lines.push(`Landmarks: ${inv.landmarks.map((l) => `${l.role}${l.name ? ` "${l.name}"` : ''}`).join(', ') || 'none'}`, '');
		if (inv.images.length) lines.push(`Images (${inv.images.length}): ${inv.images.slice(0, 40).map((i) => `${i.src || i.path} → ${i.alt === null ? 'NO ALT' : `"${i.alt}"`}`).join(' · ')}`, '');
		if (inv.media.length || inv.frames.length) lines.push(`Media and frames: ${[...inv.media.map((m) => `${m.kind} (tracks: ${m.tracks.join('/') || 'none'})`), ...inv.frames.map((f) => `iframe "${f.title || 'NO TITLE'}" ${f.src}`)].join(' · ')}`, '');
		if (inv.languageParts.length) lines.push(`Language changes: ${inv.languageParts.map((p) => `${p.lang}: "${p.text}"`).join(' · ')}`, '');
	}
	return lines.join('\n');
}

/** Writes summary.md and findings.json into `outDir`. Returns the merged rows. */
function writeReport(outDir, { findings, coverage, meta, states, documents, inventories, flows }) {
	const rows = merge(findings);
	const matrix = conformance(rows, coverage);
	fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify({ meta, rows, matrix, flows, raw: findings }, null, 1));
	fs.writeFileSync(path.join(outDir, 'summary.md'), markdown({ rows, matrix, meta, states, documents, inventories, flows }));
	return { rows, matrix };
}

/**
 * Criteria with at least one automated check in this run: the engines' rules that applied to the pages, plus the
 * audit's own checks whose layer ran (`ranPrefixes`, such as 'kbd' or 'flow').
 */
function coverageFrom(engineScs, ranPrefixes) {
	const covered = new Set(engineScs);
	for (const [id, meta] of Object.entries(CHECKS)) if (ranPrefixes.has(id.split(':')[0])) for (const sc of meta.sc) covered.add(sc);
	return covered;
}

module.exports = { writeReport, merge, coverageFrom };
