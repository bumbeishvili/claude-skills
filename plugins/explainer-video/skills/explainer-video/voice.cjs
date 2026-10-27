// Voices narration.json locally with Kokoro 82M (voice af_heart), one clip per line,
// trims the silence around each, and writes each line's file, length and word timings
// back into narration.json for tour-kit.cjs and build.cjs. Only lines whose words, voice
// or speed changed are voiced again; the rest come from audio/cache.
// Usage: node voice.cjs <videoDir>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const paths = require('./paths.cjs');

const DIR = process.argv[2];
if (!DIR) throw new Error('Usage: node voice.cjs <videoDir>');
paths.requireVoice();
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
if (lines.some(l => /\n/.test(spoken(l)))) throw new Error('A narration line contains a newline; keep each line on one row.');

// A clip is reused while everything that shapes it is the same.
const cacheDir = path.join(DIR, 'audio', 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const keyOf = (line) => crypto.createHash('sha1').update(JSON.stringify([spoken(line), paths.VOICE, paths.MODEL, line.speed || 1])).digest('hex').slice(0, 16);
const cached = (line) => path.join(cacheDir, keyOf(line));
const missing = lines.filter(l => !fs.existsSync(cached(l) + '.json'));

if (missing.length) {
  // A fresh folder per run, so files from an earlier run can't be mistaken for this one's.
  const runDir = path.join(DIR, 'audio', `kokoro-${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });
  const linesFile = path.join(runDir, 'lines.json');
  fs.writeFileSync(linesFile, JSON.stringify(missing.map(l => ({ id: l.id, speak: spoken(l), speed: l.speed || 1 }))));
  const [command, args] = paths.pythonCommand([paths.kokoroWords, paths.espeakData, linesFile, runDir, paths.MODEL, paths.VOICE]);
  const r = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, HF_HOME: paths.hfHome, HF_HUB_DISABLE_PROGRESS_BARS: '1', HF_HUB_OFFLINE: '1' } });
  if (r.status !== 0) throw new Error('Kokoro failed:\n' + [r.stdout, r.stderr].join('\n').split('\n').slice(-10).join('\n'));
  const voiced = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(runDir, 'words.json'), 'utf8')).map(v => [v.id, v]));
  missing.map(l => {
    if (!voiced[l.id]) throw new Error(`Kokoro wrote no clip for ${l.id}`);
    fs.copyFileSync(path.join(runDir, `${l.id}.wav`), cached(l) + '.wav');
    fs.writeFileSync(cached(l) + '.json', JSON.stringify({ dur: voiced[l.id].dur, words: voiced[l.id].words }));
  });
}
console.log(`${missing.length} of ${lines.length} lines voiced, the rest unchanged`);

lines.map((line) => {
  const { dur, words } = JSON.parse(fs.readFileSync(cached(line) + '.json', 'utf8'));
  const file = path.join(DIR, 'audio', `${line.id}.wav`);
  fs.copyFileSync(cached(line) + '.wav', file);
  const count = spoken(line).split(/\s+/).length;
  if (dur / count < SECONDS_PER_WORD[0] || dur / count > SECONDS_PER_WORD[1]) {
    throw new Error(`${line.id}: ${dur.toFixed(2)}s for ${count} words looks wrong; listen to ${file}`);
  }
  Object.assign(line, { file: path.relative(DIR, file), dur, words, voicedText: spoken(line), voice: paths.VOICE, model: paths.MODEL });
  console.log(`${line.id.padEnd(12)} ${dur.toFixed(2)}s  ${words.length ? words.map(w => `${w.text}@${w.start.toFixed(2)}`).join(' ') : spoken(line)}`);
});
fs.writeFileSync(narrationFile, JSON.stringify(lines, null, 1) + '\n');
console.log(`${lines.length} lines, ${lines.reduce((a, l) => a + l.dur, 0).toFixed(1)}s of speech`);
