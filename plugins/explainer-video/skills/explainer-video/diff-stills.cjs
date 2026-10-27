// After the app's UI changes: which segments look different from the stills last approved?
// Compares each dry still with approved/ (ffmpeg's SSIM, 1 = identical) and lists the
// segments that changed, so only their lines and tour code need a look before the re-shoot.
// Usage: node diff-stills.cjs <videoDir>             compare dry/*.png with approved/*.png
//        node diff-stills.cjs <videoDir> --approve   keep the current dry stills as approved/
//   SSIM_MIN=0.985   below this a still counts as changed
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

const DIR = process.argv[2];
if (!DIR) throw new Error('Usage: node diff-stills.cjs <videoDir> [--approve]');
const FF = paths.ffmpeg();
const SSIM_MIN = +(process.env.SSIM_MIN || 0.985);
const dryDir = path.join(DIR, 'dry'), approvedDir = path.join(DIR, 'approved');
const stills = fs.readdirSync(dryDir).filter(f => /^\d+-.+\.png$/.test(f)).sort();
if (!stills.length) throw new Error(`No stills in ${dryDir}: run the tour in dry mode first`);

if (process.argv[3] === '--approve') {
  fs.mkdirSync(approvedDir, { recursive: true });
  stills.map(f => fs.copyFileSync(path.join(dryDir, f), path.join(approvedDir, f)));
  console.log(`${stills.length} stills approved in ${approvedDir}`);
} else {
  if (!fs.existsSync(approvedDir)) throw new Error(`No ${approvedDir}: approve a set first with --approve`);
  // SSIM over the whole picture; a still whose size differs, or that has no approved twin, counts as changed.
  const ssim = (f) => {
    const approved = path.join(approvedDir, f);
    if (!fs.existsSync(approved)) return null;
    const r = spawnSync(FF, ['-hide_banner', '-i', path.join(dryDir, f), '-i', approved, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = r.stderr.match(/All:([\d.]+)/);
    return m ? +m[1] : null;
  };
  const results = stills.map(f => ({ f, score: ssim(f) }));
  const changed = results.filter(r => r.score === null || r.score < SSIM_MIN);
  results.map(({ f, score }) => console.log(`${score === null ? '  new    ' : score < SSIM_MIN ? 'CHANGED  ' : '  same   '}${score === null ? '' : score.toFixed(4) + '  '}${f}`));
  console.log(changed.length ? `${changed.length} of ${stills.length} segments changed: check their lines and tour code, then re-record` : `all ${stills.length} segments match the approved stills`);
}
