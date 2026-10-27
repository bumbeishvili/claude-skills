// Builds the video from tour-kit.cjs's recording: <videoDir>/video.mp4, H.264 + AAC at
// 1920x1080 (plays everywhere, streams on a web page), with chapters inside it when the
// narration has them. Beside it, what a docs page or a video host takes: captions.vtt,
// chapters.vtt, youtube-chapters.txt, transcript.md, poster.jpg and embed.html.
// Usage: node build.cjs <videoDir>
//   CAPTIONS=off        keep the captions out of the picture (captions.vtt is written either way)
//   FRAME=1             the app in a rounded window with a shadow on a gradient, captions under it
//   FRAME_COLORS=1e1b4b,4338ca   the gradient's two colours
//   MOTION_BLUR=1       blend neighbouring frames while the camera moves
//   MUSIC=<file>        a bed under the voice, ducked while it speaks; its licence is the user's to check
//   MUSIC_DB=-18        the bed's level before ducking
//   POSTER_AT=<seconds> the poster frame (default: one second into the second segment)
//   TITLE=<text>        the title in embed.html and video.jsonld
//   BASE_URL=<url>      the page the video will sit on: also writes video.jsonld (schema.org
//                       VideoObject, chapters as key moments) with addresses under it
//   AV1=1               also video.webm, AV1 + Opus: about 17% smaller on UI footage, ~10 minutes to encode two minutes
//   H264_CRF / AV1_CRF  quality, lower = better
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

const DIR = process.argv[2];
if (!DIR) throw new Error('Usage: node build.cjs <videoDir>');
const FF = paths.ffmpeg();
const env = process.env;
const LEAD_IN_S = 0.25;   // the video starts this long before the first segment
const FPS = 30;
// Screen content has large flat areas, so these sit higher (smaller files) than camera footage allows.
const H264_CRF = +(env.H264_CRF || 28), AV1_CRF = +(env.AV1_CRF || 40);
const tl = JSON.parse(fs.readFileSync(path.join(DIR, 'timeline.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(DIR, 'narration.json'), 'utf8'));
const lineById = Object.fromEntries(lines.map(l => [l.id, l]));
const write = (file, text) => fs.writeFileSync(path.join(DIR, file), text);
const run = (args) => {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: DIR, stdio: 'inherit', timeout: 3 * 3600000 });
  if (r.status !== 0) throw new Error(`ffmpeg ${r.signal ? 'killed by ' + r.signal : 'exited ' + r.status}: ${args.join(' ')}`);
};

// --- the video's clock --------------------------------------------------------------------
// The take was recorded tl.time times slower than it plays. Stretches of it play differently:
// a cut (offCamera) is dropped, a fast-forward plays `factor` times faster.
const recorded = (t) => (t - tl.segs[0].t) / tl.time + LEAD_IN_S;
const marks = tl.cuts || [];
if (marks.length % 2 || marks.some((m, i) => m.edge !== (i % 2 ? 'end' : 'start'))) throw new Error('cut marks are not start/end pairs');
const spans = [
  ...marks.filter((m, i) => i % 2 === 0).map((m, i) => ({ kind: 'cut', a: recorded(m.t), b: recorded(marks[i * 2 + 1].t), rate: 0 })),
  ...(tl.speeds || []).map(s => ({ kind: `${s.factor}x fast-forward`, a: recorded(s.start), b: recorded(s.end), rate: 1 / s.factor })),
].sort((p, q) => p.a - q.a);
spans.slice(1).map((s, i) => { if (s.a < spans[i].b) throw new Error(`a ${s.kind} starts inside a ${spans[i].kind}; keep them apart`); });
const toVideo = (t) => { const v = recorded(t); return v - spans.reduce((sum, { a, b, rate }) => sum + Math.max(0, Math.min(v, b) - a) * (1 - rate), 0); };
// A cut or fast-forward inside a spoken line would chop or rush the picture under the voice.
tl.says.map(s => {
  const from = recorded(s.t), to = from + lineById[s.id].dur;
  const hit = spans.find(({ a, b }) => a < to && b > from);
  if (hit) throw new Error(`a ${hit.kind} (${hit.a.toFixed(2)}–${hit.b.toFixed(2)}s) falls inside the "${s.id}" line (${from.toFixed(2)}–${to.toFixed(2)}s); start the line after it`);
});
const end = toVideo(tl.segs.find(s => s.id === 'end').t);
const total = end.toFixed(3);

// --- frames ----------------------------------------------------------------------------------
// Frames can arrive a few ms out of order; each one lasts until the next.
const inCut = (v) => spans.some(({ a, b, rate }) => !rate && v > a && v < b);
const frames = [...tl.frames].sort((a, b) => a.t - b.t).filter(f => !inCut(recorded(f.t))).map(f => ({ file: f.file, t: toVideo(f.t) }));
const first = Math.max(0, frames.findIndex(f => f.t > 0) - 1);
const shown = frames.slice(first).filter(f => f.t < end);
if (!shown.length) throw new Error('No frames fall inside the video; was this a rec take?');
// A failed take leaves the previous take's timeline.json next to no (or moved) frames.
const gone = shown.find(f => !fs.existsSync(path.join(DIR, 'frames', f.file)));
if (gone) throw new Error(`timeline.json lists frames/${gone.file}, which is missing: the last take did not finish, or its frames were moved`);
write('concat.txt', shown.map((f, i) => {
  const from = Math.max(f.t, 0), to = i + 1 < shown.length ? shown[i + 1].t : end;
  return `file 'frames/${f.file}'\nduration ${(to - from).toFixed(4)}`;
}).concat(`file 'frames/${shown[shown.length - 1].file}'`).join('\n') + '\n');

// --- narration: each line where its callout appeared, mono, loudness-normalised ---------------
const says = tl.says.map(s => ({ line: lineById[s.id], at: toVideo(s.t) }));
run([...says.flatMap(s => ['-i', s.line.file]), '-filter_complex', says.map((s, n) =>
  `[${n}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.max(0, Math.round(s.at * 1000))}:all=1[say${n}]`).concat(
  `${says.map((_, n) => `[say${n}]`).join('')}amix=inputs=${says.length}:normalize=0:duration=longest,apad,atrim=0:${total},loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono[aout]`).join(';'),
'-map', '[aout]', 'narration.wav']);

// --- captions and chapters ----------------------------------------------------------------
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const vttTime = (s) => new Date(s * 1000).toISOString().slice(11, 23);
const assTime = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const centis = (s) => Math.max(0, Math.round(s * 100));
const cues = says.map((s, n) => ({ ...s, until: Math.min(n + 1 < says.length ? says[n + 1].at - 0.05 : end, s.at + s.line.dur + 0.4, end) }));
// Every word lights up as it is spoken (karaoke tags from the word timings voice.cjs kept).
const karaoke = (l) => {
  const shownWords = l.text.split(/\s+/), words = l.words || [];
  // Spoken and shown words differ (a `speak` respelling, a language without timings): no highlighting.
  if (words.length !== shownWords.length) return shownWords.join(' ');
  const lead = words[0].start > 0.02 ? `{\\k${centis(words[0].start)}}` : '';
  return lead + shownWords.map((w, i) => `{\\k${centis((i + 1 < words.length ? words[i + 1].start : l.dur) - words[i].start)}}${w}`).join(' ');
};
write('captions.vtt', 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${vttTime(c.at)} --> ${vttTime(c.until)}\n${c.line.text}\n`).join('\n'));
// Sized to the frame: 46 px text on a 1080-high landscape frame; a portrait (phone) frame
// gets larger text for its width and narrower margins.
const OUT_W = Math.round(tl.viewport.width * tl.scale), OUT_H = Math.round(tl.viewport.height * tl.scale);
const portrait = OUT_H > OUT_W;
const captionSize = Math.round(portrait ? OUT_W * 0.06 : OUT_H * 0.0426), captionSide = Math.round(OUT_W * (portrait ? 0.06 : 0.125));
write('captions.ass', [
  '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${OUT_W}`, `PlayResY: ${OUT_H}`, 'WrapStyle: 0', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  // Words already spoken in white, words still to come in grey, on a dark box (BorderStyle 3).
  // The box is opaque: libass draws it per glyph, and a see-through one shows the overlaps as stripes.
  `Style: Caption,Helvetica,${captionSize},&H00FFFFFF,&H00A8A4A0,&H004F2323,&H00000000,1,0,0,0,100,100,0,0,3,${Math.round(captionSize / 3)},0,2,${captionSide},${captionSide},${Math.round(OUT_H * 0.048)},1`,
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...cues.map(c => `Dialogue: 0,${assTime(c.at)},${assTime(c.until)},Caption,,0,0,0,,{\\fad(120,160)}${karaoke(c.line)}`),
].join('\n') + '\n');
// Chapters begin at the lines that carry a `chapter` title; the first begins at 0:00.
const chapterStarts = says.filter(s => s.line.chapter).map((s, i) => ({ title: s.line.chapter, at: i ? s.at : 0 }));
const chapters = chapterStarts.map((c, i) => ({ ...c, until: i + 1 < chapterStarts.length ? chapterStarts[i + 1].at : end }));
// Every line and chapter on the video's clock, for verify.cjs.
write('cues.json', JSON.stringify({ end, says: says.map(s => ({ id: s.line.id, at: s.at, dur: s.line.dur })), chapters }, null, 1) + '\n');
if (chapters.length) {
  write('chapters.vtt', 'WEBVTT\n\n' + chapters.map((c, i) => `${i + 1}\n${vttTime(c.at)} --> ${vttTime(c.until)}\n${c.title}\n`).join('\n'));
  write('youtube-chapters.txt', chapters.map(c => `${clock(c.at)} ${c.title}`).join('\n') + '\n');
  write('chapters.ffmeta', ';FFMETADATA1\n' + chapters.map(c => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.at * 1000)}\nEND=${Math.round(c.until * 1000)}\ntitle=${c.title.replace(/[=;#\\\n]/g, '\\$&')}\n`).join(''));
}

// --- the picture ------------------------------------------------------------------------------
// A zoomed camera frame can come back a pixel or three short: Chrome snaps the clip to whole
// pixels. Scaling every frame to one size (OUT_W x OUT_H) keeps the stream one size; with
// reinit_filter 0 the scale filter takes the odd sizes itself instead of ffmpeg rebuilding the graph.
const burnCaptions = env.CAPTIONS !== 'off';
const even = (v) => 2 * Math.round(v / 2);
// FRAME=1: the window keeps 16:9 and leaves a band below it for the captions.
const win = env.FRAME === '1' ? (() => {
  const top = even(OUT_H * 0.04), bottom = even(OUT_H * (burnCaptions ? 0.14 : 0.04)), h = OUT_H - top - bottom, w = even(h * OUT_W / OUT_H);
  return { w, h, x: even((OUT_W - w) / 2), y: top, radius: Math.round(h * 0.02) };
})() : null;
if (win) {
  const [c0, c1] = (env.FRAME_COLORS || '1e1b4b,4338ca').split(',');
  run(['-f', 'lavfi', '-i', `gradients=s=${OUT_W}x${OUT_H}:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=${OUT_W}:y1=${OUT_H}:n=2`,
    '-f', 'lavfi', '-i', `color=c=black:s=${OUT_W}x${OUT_H},format=rgba,geq=r=0:g=0:b=0:a='if(between(X\\,${win.x}\\,${win.x + win.w})*between(Y\\,${win.y + 14}\\,${win.y + win.h + 14})\\,120\\,0)',gblur=sigma=26`,
    '-filter_complex', '[0][1]overlay', '-frames:v', '1', 'frame-bg.png']);
  const r = win.radius, inside = `lte(hypot(max(0\\,max(${r}-X\\,X-${win.w - 1 - r}))\\,max(0\\,max(${r}-Y\\,Y-${win.h - 1 - r})))\\,${r})`;
  run(['-f', 'lavfi', '-i', `color=c=black:s=${win.w}x${win.h},format=gray,geq=lum='if(${inside}\\,255\\,0)',gblur=sigma=0.6`, '-frames:v', '1', 'frame-mask.png']);
}
// MOTION_BLUR=1: each frame blended with its neighbours while the camera moves.
const moving = (tl.moves || []).map(m => [toVideo(m.start), toVideo(m.end)]).filter(([a, b]) => b > a);
const blur = env.MOTION_BLUR === '1' && moving.length ? `,tmix=frames=3:weights='1 2 1':enable='${moving.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')}'` : '';
const finish = `${burnCaptions ? 'subtitles=captions.ass,' : ''}format=yuv420p[v]`;
const picture = win
  ? `[0:v]scale=${win.w}:${win.h}:flags=lanczos,fps=${FPS}${blur},format=rgba[app];[3:v]format=gray[mask];[app][mask]alphamerge[win];[2:v][win]overlay=${win.x}:${win.y}:shortest=1,${finish}`
  : `[0:v]scale=${OUT_W}:${OUT_H}:flags=lanczos,fps=${FPS}${blur},${finish}`;

// --- the sound: the voice, and a music bed ducked under it --------------------------------------
const music = env.MUSIC ? path.resolve(env.MUSIC) : null;
if (music && !fs.existsSync(music)) throw new Error(`MUSIC file not found: ${music}`);
const inputs = [
  '-f', 'concat', '-safe', '0', '-reinit_filter', '0', '-i', 'concat.txt',
  '-i', 'narration.wav',
  ...(win ? ['-loop', '1', '-framerate', String(FPS), '-i', 'frame-bg.png', '-loop', '1', '-framerate', String(FPS), '-i', 'frame-mask.png'] : []),
  ...(music ? ['-stream_loop', '-1', '-i', music] : []),
  ...(chapters.length ? ['-i', 'chapters.ffmeta'] : []),
];
const musicInput = win ? 4 : 2, chapterInput = musicInput + (music ? 1 : 0);
const sound = music
  ? `;[1:a]aformat=channel_layouts=stereo,asplit=2[voice][key];[${musicInput}:a]aformat=channel_layouts=stereo,atrim=0:${total},volume=${env.MUSIC_DB || -18}dB[bed];`
    + '[bed][key]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[ducked];'
    + '[voice][ducked]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[a]'
  : '';
const graph = ['-filter_complex', picture + sound, '-map', '[v]', '-map', music ? '[a]' : '1:a', ...(chapters.length ? ['-map_chapters', String(chapterInput)] : []), '-t', total];
run([...inputs, ...graph, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(H264_CRF), '-tune', 'stillimage', '-c:a', 'aac', '-b:a', music ? '128k' : '64k', '-movflags', '+faststart', 'video.mp4']);
// scm=1: SVT-AV1's screen-content tools; preset 8, since 6 took over 30 minutes for two minutes.
if (env.AV1 === '1') run([...inputs, ...graph, '-c:v', 'libsvtav1', '-crf', String(AV1_CRF), '-preset', '8', '-g', '300', '-svtav1-params', 'scm=1', '-c:a', 'libopus', '-b:a', music ? '96k' : '48k', 'video.webm']);

// --- for a docs page or a video host -------------------------------------------------------------
const second = tl.segs.find((s, i) => i === 1 && s.id !== 'end');
const posterAt = env.POSTER_AT !== undefined ? +env.POSTER_AT : Math.min(end - 0.1, second ? toVideo(second.t) + 1 : 1);
run(['-ss', posterAt.toFixed(2), '-i', 'video.mp4', '-frames:v', '1', '-q:v', '3', 'poster.jpg']);
const title = env.TITLE || (chapters[0] && chapters[0].title) || 'Video';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// The transcript as list items under each chapter, with the time each line starts.
const chapterAt = (at) => chapters.filter(c => c.at <= at + 1e-6).pop();
write('transcript.md', cues.map((c, i) => {
  const heading = chapters.length && (i === 0 || chapterAt(c.at) !== chapterAt(cues[i - 1].at)) ? `\n## ${chapterAt(c.at).title}\n\n` : '';
  return `${heading}- ${clock(c.at)} ${c.line.text}`;
}).join('\n').trim() + '\n');
const captionLang = env.CAPTION_LANG || 'en';
write('embed.html', `<!doctype html>
<html lang="${captionLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --text: #1b2040; --link: #3451d1; --bg: #fff; }
  @media (prefers-color-scheme: dark) { :root { --text: #e6e8f2; --link: #9db0ff; --bg: #111318; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  video { display: block; width: 100%; max-width: 960px; border-radius: 10px; }
  ol { max-width: 960px; padding-left: 1.4em; }
  button { padding: 0; border: 0; background: none; color: var(--link); font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
</style>
</head>
<body>
<video id="video" controls preload="metadata" playsinline poster="poster.jpg">
  <source src="video.mp4" type="video/mp4">
  <track kind="captions" src="captions.vtt" srclang="${captionLang}" label="Captions" default>
${chapters.length ? `  <track kind="chapters" src="chapters.vtt" srclang="${captionLang}">\n` : ''}</video>
<h2>Transcript</h2>
<ol>
${cues.map(c => `  <li><button data-at="${c.at.toFixed(2)}">${clock(c.at)}</button> ${esc(c.line.text)}</li>`).join('\n')}
</ol>
<script>
  // Each time in the transcript plays the video from that line.
  const video = document.getElementById('video');
  [...document.querySelectorAll('button[data-at]')].map((b) => b.addEventListener('click', () => { video.currentTime = +b.dataset.at; video.play(); }));
</script>
</body>
</html>
`);
if (env.BASE_URL) {
  const at = (file) => new URL(file, env.BASE_URL).href;
  const page = new URL(env.BASE_URL);
  const seconds = (s) => Math.round(s);
  write('video.jsonld', JSON.stringify({
    '@context': 'https://schema.org', '@type': 'VideoObject', name: title, description: cues.map(c => c.line.text).join(' '),
    thumbnailUrl: at('poster.jpg'), contentUrl: at('video.mp4'), uploadDate: new Date().toISOString().slice(0, 10), duration: `PT${seconds(end)}S`,
    hasPart: chapters.map(c => {
      page.searchParams.set('t', seconds(c.at));
      return { '@type': 'Clip', name: c.title, startOffset: seconds(c.at), endOffset: seconds(c.until), url: page.href };
    }),
  }, null, 1) + '\n');
}

const mb = (f) => (fs.statSync(path.join(DIR, f)).size / 1048576).toFixed(1) + ' MB';
const changed = spans.map(s => `${s.kind} ${(s.b - s.a).toFixed(2)}s`).join(', ');
console.log(`${total}s, ${shown.length} frames (${(shown.length / end).toFixed(1)} fps)${changed ? `; ${changed}` : ''}${chapters.length ? `; ${chapters.length} chapters` : ''}`);
console.log(`video.mp4 ${mb('video.mp4')}` + (env.AV1 === '1' ? `   video.webm ${mb('video.webm')}` : '')
  + `   with captions.vtt${chapters.length ? ', chapters.vtt, youtube-chapters.txt' : ''}, transcript.md, poster.jpg, embed.html${env.BASE_URL ? ', video.jsonld' : ''}`);
