// Turns a dry run into two more ways to follow the tour, beside the video:
//  - guide.md: a written step-by-step guide, each step's line above its still;
//  - walkthrough.html: a click-through demo in one file. Each step shows its still with the
//    thing it acts on ringed; a click on it, the arrow keys or the buttons move between steps.
// Usage: node guide.cjs <videoDir>     after a dry run (tour.cjs <videoDir> dry)
//   TITLE=<text>   the guide's title (default: the first chapter, else "Guide")
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

const DIR = process.argv[2];
if (!DIR) throw new Error('Usage: node guide.cjs <videoDir>');
const FF = paths.ffmpeg();
const STILL_WIDTH = 1280, JPEG_QUALITY = 4;   // ffmpeg's -q:v, 2 (best) to 31
const stepsFile = path.join(DIR, 'dry', 'steps.json');
if (!fs.existsSync(stepsFile)) throw new Error(`No ${stepsFile}: run the tour in dry mode first`);
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
const title = process.env.TITLE || (steps.find(s => s.chapter) || {}).chapter || 'Guide';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// The written guide: numbered steps, a new heading where a chapter starts.
fs.writeFileSync(path.join(DIR, 'guide.md'), `# ${title}\n\n` + steps.map((s, i) =>
  `${s.chapter && i ? `\n## ${s.chapter}\n\n` : ''}${i + 1}. ${s.text}\n\n   ![Step ${i + 1}](dry/${s.still})\n`).join('\n'));

// The click-through: the stills as JPEG inside the page, so it is one file to share.
const jpeg = (file) => {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', path.join(DIR, 'dry', file), '-vf', `scale=${STILL_WIDTH}:-2`, '-q:v', String(JPEG_QUALITY), '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { maxBuffer: 64 * 1048576 });
  if (r.status !== 0) throw new Error(`Could not convert ${file}: ${r.stderr}`);
  return 'data:image/jpeg;base64,' + r.stdout.toString('base64');
};
const data = steps.map(s => ({ src: jpeg(s.still), text: s.text, label: s.label, hotspot: s.hotspot }));
fs.writeFileSync(path.join(DIR, 'walkthrough.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --text: #1b2040; --muted: #5d6285; --bg: #f4f5fa; --card: #fff; --accent: #ff5c39; --button: #23234f; }
  @media (prefers-color-scheme: dark) { :root { --text: #e6e8f2; --muted: #a3a8c3; --bg: #111318; --card: #1b1e27; --button: #8676ff; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { margin: 0 0 12px; font-size: 22px; }
  .stage { position: relative; border-radius: 12px; overflow: hidden; background: var(--card); box-shadow: 0 10px 30px rgba(20, 16, 60, .15); }
  .stage img { display: block; width: 100%; height: auto; }
  .hot { position: absolute; border: 3px solid var(--accent); border-radius: 10px; cursor: pointer; animation: ring 1.4s ease-out infinite; }
  .hot.point { width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; }
  @keyframes ring { 0% { box-shadow: 0 0 0 0 rgba(255, 92, 57, .55); } 100% { box-shadow: 0 0 0 14px rgba(255, 92, 57, 0); } }
  @media (prefers-reduced-motion: reduce) { .hot { animation: none; } }
  .bar { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
  .text { flex: 1 1 280px; margin: 0; font-size: 18px; }
  .count { color: var(--muted); font-variant-numeric: tabular-nums; }
  button { padding: 8px 14px; border: 0; border-radius: 8px; background: var(--button); color: #fff; font: 600 15px system-ui, sans-serif; cursor: pointer; }
  button:disabled { opacity: .4; cursor: default; }
</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <div class="stage"><img id="still" alt=""><div id="hot" class="hot" role="button" aria-label="Next step"></div></div>
  <div class="bar">
    <p class="text" id="text"></p>
    <span class="count" id="count"></span>
    <button id="prev">Back</button><button id="next">Next</button>
  </div>
</main>
<script>
  const steps = ${JSON.stringify(data)};
  const $ = (id) => document.getElementById(id);
  let at = 0;
  // Shows step i: its still, its line, and a ring on what it acts on (a box, or a point for a click).
  const show = (i) => {
    at = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[at], hot = $('hot');
    $('still').src = s.src;
    $('still').alt = s.text;
    $('text').textContent = s.text;
    $('count').textContent = (at + 1) + ' / ' + steps.length;
    $('prev').disabled = at === 0;
    $('next').disabled = at === steps.length - 1;
    hot.hidden = !s.hotspot;
    if (s.hotspot) {
      hot.className = 'hot' + (s.hotspot.w ? '' : ' point');
      Object.assign(hot.style, { left: s.hotspot.x * 100 + '%', top: s.hotspot.y * 100 + '%',
        width: s.hotspot.w ? s.hotspot.w * 100 + '%' : '', height: s.hotspot.h ? s.hotspot.h * 100 + '%' : '' });
    }
  };
  $('hot').addEventListener('click', () => show(at + 1));
  $('next').addEventListener('click', () => show(at + 1));
  $('prev').addEventListener('click', () => show(at - 1));
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') show(at + 1); if (e.key === 'ArrowLeft') show(at - 1); });
  show(0);
</script>
</body>
</html>
`);
console.log(`guide.md and walkthrough.html: ${steps.length} steps, ${(fs.statSync(path.join(DIR, 'walkthrough.html')).size / 1048576).toFixed(1)} MB`);
