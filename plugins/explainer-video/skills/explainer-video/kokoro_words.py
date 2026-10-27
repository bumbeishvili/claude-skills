"""Voices narration lines with Kokoro and keeps the moment each word starts.

mlx-audio's Kokoro pipeline already computes word timestamps (start_ts, from its
predicted phoneme durations) for English; its command-line generator drops them. This
calls the pipeline directly, trims each clip at -45 dB, shifts the timestamps by the
trimmed lead-in, and writes <id>.wav per line plus words.json:
[{ id, dur, words: [{ text, start, end }] }], times in seconds. Other languages come
back without word timings (the pipeline has none for them), and words is empty.

espeak-ng truncates long data paths, so espeak reads from the short copy (see kokoro_run.py).

Usage: python kokoro_words.py <espeak-ng-data dir> <lines.json> <out dir> <model> <voice>
       lines.json: [{ "id": ..., "speak": ..., "speed": 1 }]
"""
import json
import os
import sys
import wave

import numpy as np

import misaki.espeak  # noqa: F401  (sets the long default data path on import)
from phonemizer.backend.espeak.wrapper import EspeakWrapper

espeak_dir, lines_file, out_dir, model_id, voice = sys.argv[1:6]
EspeakWrapper.set_data_path(espeak_dir)

from mlx_audio.tts.utils import load_model  # noqa: E402

SAMPLE_RATE = 24000
THRESHOLD = 10 ** (-45 / 20)            # -45 dB trim level
WINDOW = int(0.02 * SAMPLE_RATE)        # 20 ms RMS windows, close to ffmpeg's silenceremove


def speech_bounds(audio):
    """First and last 20 ms window whose RMS clears -45 dB, in samples."""
    n = len(audio) // WINDOW
    rms = np.sqrt((audio[: n * WINDOW].reshape(n, WINDOW) ** 2).mean(axis=1))
    loud = np.nonzero(rms > THRESHOLD)[0]
    if not len(loud):
        raise ValueError("the clip is silent")
    return loud[0] * WINDOW, (loud[-1] + 1) * WINDOW


def write_wav(path, audio):
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(pcm.tobytes())


model = load_model(model_path=model_id)
pipeline = model._get_pipeline(voice[0])
results = []
for line in json.load(open(lines_file)):
    # A long line can come back in several chunks; each chunk's timestamps start at 0.
    audio_parts, words, offset = [], [], 0.0
    for chunk in pipeline(line["speak"], voice=voice, speed=line.get("speed", 1)):
        part = np.array(chunk.audio, dtype=np.float32).reshape(-1)
        for token in chunk.tokens or []:
            if token.start_ts is None or not any(ch.isalnum() for ch in token.text):
                continue
            end = token.end_ts if token.end_ts is not None else token.start_ts
            words.append({"text": token.text, "start": offset + token.start_ts, "end": offset + end})
        audio_parts.append(part)
        offset += len(part) / SAMPLE_RATE
    audio = np.concatenate(audio_parts)
    first, last = speech_bounds(audio)
    lead = first / SAMPLE_RATE
    write_wav(os.path.join(out_dir, f"{line['id']}.wav"), audio[first:last])
    results.append({
        "id": line["id"],
        "dur": round((last - first) / SAMPLE_RATE, 3),
        # A word's onset can sit a few ms under the trim level; it starts at the clip's start then.
        "words": [{**w, "start": round(max(0.0, w["start"] - lead), 3), "end": round(max(0.0, w["end"] - lead), 3)} for w in words],
    })

with open(os.path.join(out_dir, "words.json"), "w") as f:
    json.dump(results, f, indent=1)
