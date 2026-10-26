"""Runs mlx-audio's TTS command with espeak reading its data from a short path.

espeak-ng truncates long data paths. A venv's own copy can sit ~200 characters deep
(it came out as '.../lib/python3.12', where there is no phontab, and espeak then exits
the whole process). misaki sets that long path when it is imported, so it is replaced
here before generating.

Usage: python kokoro_run.py <short espeak-ng-data dir> <mlx_audio.tts.generate args...>
"""
import sys

import misaki.espeak  # noqa: F401  (sets the long default data path on import)
from phonemizer.backend.espeak.wrapper import EspeakWrapper

EspeakWrapper.set_data_path(sys.argv.pop(1))

from mlx_audio.tts.generate import main  # noqa: E402

main()
