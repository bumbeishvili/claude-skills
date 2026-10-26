// Builds the video from tour-kit.cjs's recording: <videoDir>/video.mp4, H.264 + AAC
// at 1920x1080 (plays everywhere, streams on a web page). AV1=1 also writes video.webm,
// AV1 + Opus: about 17% smaller on UI footage, but ~10 minutes to encode two minutes.
// Usage: node build.cjs <videoDir>      (H264_CRF / AV1_CRF tune quality, lower = better)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

const DIR = process.argv[2];
if (!DIR) throw new Error('Usage: node build.cjs <videoDir>');
const FF = paths.ffmpeg();
const LEAD_IN_S = 0.25;   // the video starts this long before the first segment
// Screen content has large flat areas, so these sit higher (smaller files) than camera footage allows.
const H264_CRF = +(process.env.H264_CRF || 28), AV1_CRF = +(process.env.AV1_CRF || 40);
const tl = JSON.parse(fs.readFileSync(path.join(DIR, 'timeline.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(DIR, 'narration.json'), 'utf8'));
const lineById = Object.fromEntries(lines.map(l => [l.id, l]));

// The take was recorded tl.time times slower than it plays; this maps it onto the video's clock.
const recorded = (t) => (t - tl.segs[0].t) / tl.time + LEAD_IN_S;
// Off-camera stretches (offCamera) are dropped and everything after them moves up.
const marks = tl.cuts || [];
if (marks.length % 2 || marks.some((m, i) => m.edge !== (i % 2 ? 'end' : 'start'))) throw new Error('cut marks are not start/end pairs');
const cuts = [];
for (let i = 0; i < marks.length; i += 2) cuts.push([recorded(marks[i].t), recorded(marks[i + 1].t)]);
const inCut = (v) => cuts.some(([a, b]) => v > a && v < b);
const toVideo = (t) => { const v = recorded(t); return v - cuts.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(v, b) - a), 0); };
// A cut inside a spoken line would chop the picture under the voice.
for (const s of tl.says) {
  const from = recorded(s.t), to = from + lineById[s.id].dur;
  const hit = cuts.find(([a, b]) => a < to && b > from);
  if (hit) throw new Error(`cut ${hit[0].toFixed(2)}–${hit[1].toFixed(2)}s falls inside the "${s.id}" line (${from.toFixed(2)}–${to.toFixed(2)}s); move the offCamera before the say()`);
}
const end = toVideo(tl.segs.find(s => s.id === 'end').t);

// Frames can arrive a few ms out of order; each one lasts until the next.
const frames = [...tl.frames].sort((a, b) => a.t - b.t).filter(f => !inCut(recorded(f.t))).map(f => ({ file: f.file, t: toVideo(f.t) }));
const first = Math.max(0, frames.findIndex(f => f.t > 0) - 1);
const shown = frames.slice(first).filter(f => f.t < end);
if (!shown.length) throw new Error('No frames fall inside the video; was this a rec take?');
// A failed take leaves the previous take's timeline.json next to no (or moved) frames.
const gone = shown.find(f => !fs.existsSync(path.join(DIR, 'frames', f.file)));
if (gone) throw new Error(`timeline.json lists frames/${gone.file}, which is missing: the last take did not finish, or its frames were moved`);
const list = shown.map((f, i) => {
  const from = Math.max(f.t, 0), to = i + 1 < shown.length ? shown[i + 1].t : end;
  return `file 'frames/${f.file}'\nduration ${(to - from).toFixed(4)}`;
});
list.push(`file 'frames/${shown[shown.length - 1].file}'`);
fs.writeFileSync(path.join(DIR, 'concat.txt'), list.join('\n') + '\n');

const run = (args) => {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: DIR, stdio: 'inherit', timeout: 3 * 3600000 });
  if (r.status !== 0) throw new Error(`ffmpeg ${r.signal ? 'killed by ' + r.signal : 'exited ' + r.status}: ${args.join(' ')}`);
};

// One narration track: each line where its callout appeared, mono, loudness-normalised.
const total = end.toFixed(3);
const audioIn = [], filters = [], mix = [];
tl.says.forEach((s, n) => {
  audioIn.push('-i', lineById[s.id].file);
  filters.push(`[${n}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.max(0, Math.round(toVideo(s.t) * 1000))}:all=1[say${n}]`);
  mix.push(`[say${n}]`);
});
filters.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=longest,apad,atrim=0:${total},loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono[aout]`);
run([...audioIn, '-filter_complex', filters.join(';'), '-map', '[aout]', 'narration.wav']);

const video = ['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-i', 'narration.wav', '-map', '0:v', '-map', '1:a', '-vf', 'fps=30,format=yuv420p', '-t', total];
run([...video, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(H264_CRF), '-tune', 'stillimage', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', 'video.mp4']);
// scm=1: SVT-AV1's screen-content tools; preset 8, since 6 took over 30 minutes for two minutes.
if (process.env.AV1 === '1') run([...video, '-c:v', 'libsvtav1', '-crf', String(AV1_CRF), '-preset', '8', '-g', '300', '-svtav1-params', 'scm=1', '-c:a', 'libopus', '-b:a', '48k', 'video.webm']);

const mb = (f) => (fs.statSync(path.join(DIR, f)).size / 1048576).toFixed(1) + ' MB';
console.log(`${total}s, ${shown.length} frames (${(shown.length / end).toFixed(1)} fps), ${cuts.length} cuts removing ${cuts.reduce((a, [x, y]) => a + y - x, 0).toFixed(2)}s`);
console.log(`video.mp4 ${mb('video.mp4')}` + (process.env.AV1 === '1' ? `   video.webm ${mb('video.webm')}` : ''));
