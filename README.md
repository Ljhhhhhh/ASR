# ASR

Local-first desktop tool for converting audio and video files into timestamped transcripts.

The app uses `ffmpeg` to extract audio and prefers a local FunASR service managed by the Electron main process. Third-party ASR is used only when selected in the UI and configured with a service URL.

## Development Requirements

- Node.js and pnpm
- `ffmpeg` and `ffprobe`
- Python 3.10+
- Local Python virtual environment at `.venv`

On macOS:

```bash
brew install ffmpeg
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
pnpm install
```

Python 3.12 is recommended for the local FunASR environment on macOS.

Packaged local builds do not require the end user to install Python, FunASR, ffmpeg, or models.
Those artifacts are generated into `.asr-runtime/current` by the local runtime build step and are
bundled into the installer.

## Development

```bash
pnpm dev
```

When local FunASR is selected, the app starts:

```bash
.venv/bin/python scripts/funasr_service.py --host 127.0.0.1 --port 17698
```

The service exposes:

- `GET /health`
- `POST /transcribe` with JSON body `{ "audio_path": "/absolute/path/audio.wav" }`

## ASR Providers

Local FunASR is the default provider. It is intended to stay running so the model loads once and can process multiple queue items.

The development default local model is:

```text
FunAudioLLM/Fun-ASR-Nano-2512
```

It starts reliably from the local ModelScope cache and returns token-level timestamps that the app normalizes into transcript segment timestamps.

Packaged local builds use the bundled runtime manifest at `resources/asr-runtime/manifest.json`.
The supported packaged runtimes target macOS Apple Silicon by default and Windows x64. They bundle
`paraformer-zh`, `fsmn-vad`, `ct-punc`, Python, ffmpeg, and ffprobe for offline use.
Packaged runtimes default to CPU for compatibility; `ASR_FUNASR_DEVICE=mps` can be used for
manual macOS acceleration experiments.

Long files are chunked inside the local service before transcription. The default chunk size is 30 seconds, which keeps local FunASR stable on course and meeting recordings instead of sending a whole long recording to the model at once.

You can override the model before starting the app:

```bash
ASR_FUNASR_MODEL=paraformer-zh pnpm dev
```

`paraformer-zh` can provide native FunASR sentence timing with VAD/punctuation, but its first startup may download a large model. Optional local service variables:

```bash
ASR_FUNASR_MODEL=FunAudioLLM/Fun-ASR-Nano-2512
ASR_FUNASR_DEVICE=mps
ASR_FUNASR_CHUNK_SECONDS=30
ASR_FUNASR_SILENCE_RMS=0.0005
ASR_FUNASR_VAD_MODEL=fsmn-vad
ASR_FUNASR_PUNC_MODEL=ct-punc
```

Third-party ASR is opt-in. Select `第三方服务` in the app and provide the base URL. The app calls:

```text
POST {baseUrl}/v1/audio/transcriptions
```

Third-party failures are shown as job errors and do not silently fall back to local FunASR.

## Build

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Platform packages:

```bash
pnpm build:mac
pnpm build:win
pnpm build:linux
```

Local offline macOS package, defaulting to Apple Silicon / M-series:

```bash
pnpm build:mac:local
```

Local offline Windows x64 package:

```bash
pnpm build:win:local
```

These commands prepare `.asr-runtime/current`, verify it by starting the local FunASR service, then
build the platform package. The runtime is intentionally ignored by git because it contains Python
dependencies, model files, and ffmpeg binaries.

To prepare only the local runtime:

```bash
pnpm asr:runtime:prepare:mac
pnpm asr:runtime:prepare:windows
```

To verify an existing local runtime without rebuilding it:

```bash
pnpm asr:runtime:verify
```

Offline release acceptance check:

1. Run `pnpm build:mac:local` on a macOS Apple Silicon build machine, or `pnpm build:win:local` on a Windows x64 build machine, with network access.
2. Install the generated package on a clean matching machine.
3. Disconnect the machine from the network.
4. Open the app and wait for the local FunASR service to become ready.
5. Transcribe a small WAV or MP4 file and export SRT/TXT.

## Output

Completed jobs can export:

- `TXT`: one sentence per line with `[start - end]` timestamps.
- `SRT`: standard subtitle numbering and `HH:MM:SS,mmm` timestamps.

Completed jobs also save an SRT file automatically in the project data directory:

```text
.asr/transcripts/<source-file-name>.srt
```

## Transcript Cache

Completed local or third-party transcripts are saved automatically in the project data directory:

```text
.asr/transcript-cache.json
```

The cache key uses the absolute file path and file name. The app also records file size and modified time; if the file changes, it will be parsed again. Selecting an unchanged file that was already completed restores the transcript immediately and shows `已缓存` in the queue.
