// Where setup.sh put the local voice and tools. One folder per machine, shared by
// every project that makes a video: EXPLAINER_VIDEO_HOME, default ~/.cache/explainer-video.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.EXPLAINER_VIDEO_HOME || path.join(os.homedir(), '.cache', 'explainer-video');
const SETUP = path.join(__dirname, 'setup.sh');

module.exports = {
  HOME,
  // The narration voice used for every video: Kokoro 82M through mlx-audio, voice af_heart.
  MODEL: 'mlx-community/Kokoro-82M-bf16',
  VOICE: 'af_heart',
  python: path.join(HOME, 'venv', 'bin', 'python'),
  hfHome: path.join(HOME, 'hf'),
  // A short copy: espeak-ng truncates long data paths (see kokoro_run.py).
  espeakData: path.join(HOME, 'espeak-ng-data'),
  kokoroRun: path.join(__dirname, 'kokoro_run.py'),
  // An ffmpeg with libx264: FF, else the one setup.sh found or installed.
  ffmpeg() {
    if (process.env.FF) return process.env.FF;
    const saved = path.join(HOME, 'ffmpeg-path');
    if (fs.existsSync(saved)) return fs.readFileSync(saved, 'utf8').trim();
    throw new Error(`No ffmpeg recorded. Run: bash ${SETUP}`);
  },
  // Stop with the fix when the voice isn't set up, instead of failing deep inside a run.
  requireVoice() {
    const ok = fs.existsSync(module.exports.python) && fs.existsSync(path.join(module.exports.espeakData, 'phontab'));
    if (!ok) throw new Error(`The local voice is not set up. Check with: bash ${SETUP} --check   Install with: bash ${SETUP}`);
  },
};
