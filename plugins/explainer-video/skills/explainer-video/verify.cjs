// Checks a built video before anyone watches it: length, the smallest gap between
// narration lines (overlap means one line talks over the next), long silences, whether
// YouTube will show its chapters, and a contact sheet (one frame every few seconds).
// Usage: node verify.cjs <videoDir>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

const DIR = process.argv[2];
if (!DIR) throw new Error('Usage: node verify.cjs <videoDir>');
const FF = paths.ffmpeg();
const MIN_GAP_S = 0.25, LONG_SILENCE_S = 1.5, SHEET_EVERY_S = 4;
// YouTube shows chapters only when the first starts at 0:00, there are at least three, and each lasts 10 s or more.
const YOUTUBE_MIN_CHAPTERS = 3, YOUTUBE_MIN_CHAPTER_S = 10;
const cues = JSON.parse(fs.readFileSync(path.join(DIR, 'cues.json'), 'utf8'));
const ff = (args) => spawnSync(FF, ['-hide_banner', ...args], { cwd: DIR, encoding: 'utf8' });

const length = (ff(['-i', 'video.mp4']).stderr.match(/Duration: ([\d:.]+)/) || [])[1];
console.log('length', length || 'unknown (is video.mp4 built?)');

const gaps = cues.says.slice(1).map((s, i) => ({ between: `${cues.says[i].id} → ${s.id}`, gap: s.at - cues.says[i].at - cues.says[i].dur }));
const tight = gaps.filter(g => g.gap < MIN_GAP_S);
console.log(tight.length ? `LINES TOO CLOSE (under ${MIN_GAP_S}s):\n  ` + tight.map(g => `${g.between} ${g.gap.toFixed(2)}s`).join('\n  ')
  : `every line ends at least ${MIN_GAP_S}s before the next (smallest ${Math.min(...gaps.map(g => g.gap)).toFixed(2)}s)`);

const log = ff(['-i', 'video.mp4', '-af', `silencedetect=noise=-38dB:d=${LONG_SILENCE_S}`, '-vn', '-f', 'null', '-']).stderr;
const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]), ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
console.log(`silences over ${LONG_SILENCE_S}s:`, starts.length ? starts.map((s, i) => `${s.toFixed(1)}–${(ends[i] || 0).toFixed(1)}s`).join(', ') : 'none');

if (cues.chapters.length) {
  const short = cues.chapters.filter(c => c.until - c.at < YOUTUBE_MIN_CHAPTER_S);
  const problems = [
    cues.chapters.length < YOUTUBE_MIN_CHAPTERS && `${cues.chapters.length} chapters (needs ${YOUTUBE_MIN_CHAPTERS})`,
    short.length && `under ${YOUTUBE_MIN_CHAPTER_S}s: ${short.map(c => `"${c.title}" ${(c.until - c.at).toFixed(1)}s`).join(', ')}`,
  ].filter(Boolean);
  console.log(problems.length ? `chapters: YouTube will not show them: ${problems.join('; ')} (the MP4 and chapters.vtt keep them)`
    : `chapters: ${cues.chapters.length}, each ${YOUTUBE_MIN_CHAPTER_S}s or longer`);
}

const sheet = ff(['-loglevel', 'error', '-y', '-i', 'video.mp4', '-vf', `fps=1/${SHEET_EVERY_S},scale=384:-1,tile=6x6:padding=4:color=white`, '-frames:v', '1', 'contact-sheet.png']);
if (sheet.status !== 0) throw new Error('contact sheet failed: ' + sheet.stderr);
console.log('contact sheet', path.join(DIR, 'contact-sheet.png'));
