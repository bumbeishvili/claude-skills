// Voices narration.json locally with Kokoro 82M (voice af_heart), one clip per line,
// trims the silence around each, and writes each line's file and length back into
// narration.json for tour-kit.cjs and build.cjs.
// Usage: node voice.cjs <videoDir>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

const DIR = process.argv[2];
if (!DIR) throw new Error('Usage: node voice.cjs <videoDir>');
paths.requireVoice();
const FF = paths.ffmpeg();
const SILENCE_DB = -45;                  // trim threshold around each clip
const SECONDS_PER_WORD = [0.2, 0.75];    // outside this range, lines got merged or split

const narrationFile = path.join(DIR, 'narration.json');
const lines = JSON.parse(fs.readFileSync(narrationFile, 'utf8'));
const ids = new Set();
for (const line of lines) {
  if (!line.id || !line.text) throw new Error(`Every narration line needs an id and a text: ${JSON.stringify(line)}`);
  if (ids.has(line.id)) throw new Error(`Duplicate narration id "${line.id}"`);
  ids.add(line.id);
}
// What Kokoro reads: `speak` respells what it says wrong (tickers, domains); the callout shows `text`.
const spoken = (line) => line.speak || line.text;
// One line per row: Kokoro splits its input on newlines, so each comes back as its own file.
if (lines.some(l => /\n/.test(spoken(l)))) throw new Error('A narration line contains a newline; keep each line on one row.');

// A fresh folder per run, so clips left by an earlier, longer script can't be miscounted.
const audioDir = path.join(DIR, 'audio');
const rawDir = path.join(audioDir, `kokoro-${Date.now()}`);
fs.mkdirSync(rawDir, { recursive: true });
const r = spawnSync(paths.python, [
  paths.kokoroRun, paths.espeakData, '--model', paths.MODEL, '--voice', paths.VOICE, '--lang_code', paths.VOICE[0],
  '--text', lines.map(spoken).join('\n'), '--output_path', rawDir, '--file_prefix', 'line', '--audio_format', 'wav',
], { encoding: 'utf8', env: { ...process.env, HF_HOME: paths.hfHome, HF_HUB_DISABLE_PROGRESS_BARS: '1' } });
if (r.status !== 0) throw new Error('Kokoro failed:\n' + [r.stdout, r.stderr].join('\n').split('\n').slice(-10).join('\n'));
const clips = fs.readdirSync(rawDir).filter(f => /^line_\d+\.wav$/.test(f)).sort();
if (clips.length !== lines.length) throw new Error(`Expected ${lines.length} clips, got ${clips.length} in ${rawDir}`);

const seconds = (file) => {
  const info = spawnSync('afinfo', [file], { encoding: 'utf8' }).stdout;
  const m = info && info.match(/estimated duration: ([\d.]+)/);
  if (!m) throw new Error(`Could not read the length of ${file}`);
  return +m[1];
};
const trim = `silenceremove=start_periods=1:start_threshold=${SILENCE_DB}dB,areverse,silenceremove=start_periods=1:start_threshold=${SILENCE_DB}dB,areverse`;
lines.forEach((line, i) => {
  const file = path.join(audioDir, `${line.id}.wav`);
  const t = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(rawDir, clips[i]), '-af', trim, file], { encoding: 'utf8' });
  if (t.status !== 0) throw new Error(`Trimming ${line.id} failed: ${t.stderr}`);
  const dur = seconds(file), words = line.text.split(/\s+/).length;
  if (dur / words < SECONDS_PER_WORD[0] || dur / words > SECONDS_PER_WORD[1]) {
    throw new Error(`${line.id}: ${dur.toFixed(2)}s for ${words} words looks wrong; listen to ${file}`);
  }
  Object.assign(line, { file: path.relative(DIR, file), dur, voicedText: spoken(line), voice: paths.VOICE, model: paths.MODEL });
  console.log(`${line.id.padEnd(12)} ${dur.toFixed(2)}s  ${spoken(line)}`);
});
fs.writeFileSync(narrationFile, JSON.stringify(lines, null, 1) + '\n');
console.log(`${lines.length} lines, ${lines.reduce((a, l) => a + l.dur, 0).toFixed(1)}s of speech`);
