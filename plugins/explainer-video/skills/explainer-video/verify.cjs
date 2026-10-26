// Checks a built video before anyone watches it: length, the smallest gap between
// narration lines (overlap means one line talks over the next), long silences, and a
// contact sheet (one frame every few seconds) to look over.
// Usage: node verify.cjs <videoDir>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

const DIR = process.argv[2];
if (!DIR) throw new Error('Usage: node verify.cjs <videoDir>');
const FF = paths.ffmpeg();
const MIN_GAP_S = 0.25, LONG_SILENCE_S = 1.5, SHEET_EVERY_S = 4;
const tl = JSON.parse(fs.readFileSync(path.join(DIR, 'timeline.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(DIR, 'narration.json'), 'utf8'));
const dur = Object.fromEntries(lines.map(l => [l.id, l.dur]));
const ff = (args) => spawnSync(FF, ['-hide_banner', ...args], { cwd: DIR, encoding: 'utf8' });

const length = (ff(['-i', 'video.mp4']).stderr.match(/Duration: ([\d:.]+)/) || [])[1];
console.log('length', length || 'unknown (is video.mp4 built?)');

const gaps = tl.says.slice(1).map((s, i) => ({ between: `${tl.says[i].id} → ${s.id}`, gap: (s.t - tl.says[i].t) / tl.time - dur[tl.says[i].id] }));
const tight = gaps.filter(g => g.gap < MIN_GAP_S);
console.log(tight.length ? `LINES TOO CLOSE (under ${MIN_GAP_S}s):\n  ` + tight.map(g => `${g.between} ${g.gap.toFixed(2)}s`).join('\n  ')
  : `every line ends at least ${MIN_GAP_S}s before the next (smallest ${Math.min(...gaps.map(g => g.gap)).toFixed(2)}s)`);

const log = ff(['-i', 'video.mp4', '-af', `silencedetect=noise=-38dB:d=${LONG_SILENCE_S}`, '-vn', '-f', 'null', '-']).stderr;
const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]), ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
console.log(`silences over ${LONG_SILENCE_S}s:`, starts.length ? starts.map((s, i) => `${s.toFixed(1)}–${(ends[i] || 0).toFixed(1)}s`).join(', ') : 'none');

const sheet = ff(['-loglevel', 'error', '-y', '-i', 'video.mp4', '-vf', `fps=1/${SHEET_EVERY_S},scale=384:-1,tile=6x6:padding=4:color=white`, '-frames:v', '1', 'contact-sheet.png']);
if (sheet.status !== 0) throw new Error('contact sheet failed: ' + sheet.stderr);
console.log('contact sheet', path.join(DIR, 'contact-sheet.png'));
