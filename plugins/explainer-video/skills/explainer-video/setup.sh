#!/usr/bin/env bash
# Sets up what the explainer-video skill needs on this Mac: the local narration voice
# (Kokoro 82M through mlx-audio, voice af_heart), an ffmpeg with H.264, and Playwright.
# Everything goes in one folder per machine, shared by every project:
# EXPLAINER_VIDEO_HOME, default ~/.cache/explainer-video.
#
#   bash setup.sh --check   report what is missing, change nothing; exits 1 if anything is
#   bash setup.sh           install only what is missing, then voice a test line
#
# Only its own temp file is ever removed. Re-running is safe: finished steps are skipped.
set -euo pipefail

HOME_DIR="${EXPLAINER_VIDEO_HOME:-$HOME/.cache/explainer-video}"
VENV="$HOME_DIR/venv"
PY="$VENV/bin/python"
HF="$HOME_DIR/hf"
ESPEAK="$HOME_DIR/espeak-ng-data"
MODEL="mlx-community/Kokoro-82M-bf16"
VOICE="af_heart"
MODEL_DIR="$HF/hub/models--${MODEL//\//--}"
# Kokoro's English text processing needs spaCy's small English model. It is published on
# GitHub, not PyPI, and must match spaCy 3.8.
SPACY_MODEL="en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-install}"
missing=0

say() { printf '%-11s %s\n' "$1" "$2"; }
need() { say "MISSING" "$1"; missing=1; }

# An ffmpeg that runs and has libx264. A broken install can hang in a state no signal
# ends (Homebrew's, when a dylib it links is gone), so this polls for 15 seconds instead
# of waiting on it, and counts a binary that is still running as unusable.
ffmpeg_ok() {
  local tmp pid i ok=1
  tmp="$(mktemp)"
  "$1" -hide_banner -encoders >"$tmp" 2>/dev/null &
  pid=$!
  for i in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$tmp"
    return 1
  fi
  if grep -q libx264 "$tmp"; then ok=0; fi
  rm -f "$tmp"
  return "$ok"
}
find_ffmpeg() {
  local c
  for c in "${FF:-}" "$(cat "$HOME_DIR/ffmpeg-path" 2>/dev/null || true)" "$(command -v ffmpeg || true)" "$HOME_DIR/ffmpeg/node_modules/ffmpeg-static/ffmpeg"; do
    [ -n "$c" ] && [ -x "$c" ] && ffmpeg_ok "$c" && { echo "$c"; return 0; }
  done
  return 1
}
playwright_ok() { NODE_PATH="$(npm root -g 2>/dev/null)" node -e "require.resolve('playwright')" >/dev/null 2>&1; }
voice_ok() { [ -x "$PY" ] && "$PY" -c "import mlx_audio, misaki, en_core_web_sm" >/dev/null 2>&1; }
model_ok() { ls "$MODEL_DIR"/snapshots/*/config.json >/dev/null 2>&1; }

# --- platform -----------------------------------------------------------------
if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  say "UNSUPPORTED" "mlx-audio needs an Apple Silicon Mac (this is $(uname -s) $(uname -m))."
  exit 1
fi

if [ "$MODE" = "--check" ]; then
  command -v uv >/dev/null && say "ok" "uv" || need "uv (brew install uv)"
  voice_ok && say "ok" "voice runtime in $VENV" || need "voice runtime (mlx-audio, misaki, en_core_web_sm)"
  [ -f "$ESPEAK/phontab" ] && say "ok" "espeak data at $ESPEAK" || need "espeak data short copy"
  model_ok && say "ok" "$MODEL" || need "voice model $MODEL"
  ff="$(find_ffmpeg || true)"; [ -n "$ff" ] && say "ok" "ffmpeg $ff" || need "ffmpeg with libx264"
  playwright_ok && say "ok" "playwright" || need "playwright (global npm package)"
  [ "$missing" = 0 ] && echo "Ready." || echo "Install what is missing with: bash $HERE/setup.sh"
  exit "$missing"
fi

mkdir -p "$HOME_DIR"
command -v uv >/dev/null || { echo "uv is required: brew install uv   (or see https://docs.astral.sh/uv/)"; exit 1; }

# --- voice runtime ----------------------------------------------------------------
if ! voice_ok; then
  echo "Installing the voice runtime into $VENV"
  [ -x "$PY" ] || uv venv --python 3.12 "$VENV"
  # A uv built for Intel and running under Rosetta resolves Intel wheels, and mlx has
  # none; name the platform and this macOS version so the Apple Silicon wheels match.
  MACOSX_DEPLOYMENT_TARGET="$(sw_vers -productVersion | cut -d. -f1).0" \
    uv pip install --python "$PY" --python-platform aarch64-apple-darwin "mlx-audio[tts]" "misaki[en]" "$SPACY_MODEL"
fi
say "ok" "voice runtime"

# --- espeak data at a short path -------------------------------------------------
if [ ! -f "$ESPEAK/phontab" ]; then
  src="$("$PY" -c 'import espeakng_loader; print(espeakng_loader.get_data_path())')"
  cp -R "$src" "$ESPEAK"
fi
say "ok" "espeak data at $ESPEAK"

# --- the voice model ---------------------------------------------------------------
if ! model_ok; then
  echo "Downloading $MODEL (about 0.4 GB)"
  HF_HOME="$HF" "$PY" -c "from huggingface_hub import snapshot_download; snapshot_download('$MODEL')"
fi
say "ok" "$MODEL"

# --- ffmpeg ------------------------------------------------------------------------------
if ! ff="$(find_ffmpeg)"; then
  echo "No working ffmpeg with libx264; installing ffmpeg-static into $HOME_DIR/ffmpeg"
  npm install --prefix "$HOME_DIR/ffmpeg" --no-save ffmpeg-static@5.2.0 >/dev/null
  ff="$HOME_DIR/ffmpeg/node_modules/ffmpeg-static/ffmpeg"
  ffmpeg_ok "$ff" || { echo "ffmpeg-static did not produce a working ffmpeg at $ff"; exit 1; }
fi
echo "$ff" > "$HOME_DIR/ffmpeg-path"
say "ok" "ffmpeg $ff"

# --- playwright ----------------------------------------------------------------------
if ! playwright_ok; then
  echo "Installing Playwright globally (npm i -g playwright) and its Chromium"
  npm i -g playwright >/dev/null
  npx --yes playwright install chromium
fi
say "ok" "playwright"

# --- proof: voice a line ------------------------------------------------------------
out="$HOME_DIR/setup-check"
mkdir -p "$out"
HF_HOME="$HF" HF_HUB_DISABLE_PROGRESS_BARS=1 "$PY" "$HERE/kokoro_run.py" "$ESPEAK" \
  --model "$MODEL" --voice "$VOICE" --lang_code a --text "The local voice is ready." \
  --output_path "$out" --file_prefix check --audio_format wav >/dev/null
ls "$out"/check*.wav >/dev/null 2>&1 || { echo "The test line was not written; see the output above."; exit 1; }
say "ok" "test line written to $out (play it to hear the voice)"
echo "Ready."
