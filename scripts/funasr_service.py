#!/usr/bin/env python3
"""Small local FunASR HTTP service for the Electron ASR app."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf


STATE = {
    "status": "loading",
    "message": "Loading FunASR model",
    "model": None,
    "model_name": os.environ.get("ASR_FUNASR_MODEL", "FunAudioLLM/Fun-ASR-Nano-2512"),
}


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


MAX_CHUNK_SECONDS = float(os.environ.get("ASR_FUNASR_CHUNK_SECONDS", "30"))
SILENCE_RMS_THRESHOLD = float(os.environ.get("ASR_FUNASR_SILENCE_RMS", "0.0005"))


def load_model() -> None:
    try:
        from funasr import AutoModel

        model_name = str(STATE["model_name"])
        vad_model = os.environ.get("ASR_FUNASR_VAD_MODEL", "")
        punc_model = os.environ.get("ASR_FUNASR_PUNC_MODEL", "")
        device = os.environ.get("ASR_FUNASR_DEVICE", "cpu")
        STATE["message"] = f"Loading FunASR model: {model_name}"
        model_kwargs = {
            "model": model_name,
            "device": device,
            "disable_update": True,
        }
        if "Fun-ASR-Nano" in model_name:
            model_kwargs["trust_remote_code"] = True
        if vad_model:
            model_kwargs["vad_model"] = vad_model
            model_kwargs["vad_kwargs"] = {"max_single_segment_time": 30000}
        if punc_model:
            model_kwargs["punc_model"] = punc_model
        STATE["model"] = AutoModel(**model_kwargs)
        STATE["status"] = "ready"
        STATE["message"] = f"Local FunASR service is ready: {model_name}"
    except Exception as exc:  # pragma: no cover - surfaced to Electron
        STATE["status"] = "error"
        STATE["message"] = f"Failed to load FunASR: {exc}"
        print(STATE["message"], file=sys.stderr, flush=True)


def normalize_funasr_result(result: Any, offset_ms: int = 0) -> list[dict[str, Any]]:
    if isinstance(result, list) and result:
        item = result[0] if isinstance(result[0], dict) else {}
    elif isinstance(result, dict):
        item = result
    else:
        item = {}

    sentence_info = item.get("sentence_info")
    if isinstance(sentence_info, list):
        return [
            {
                "start_ms": offset_ms
                + int(sentence.get("start", sentence.get("start_ms", 0)) or 0),
                "end_ms": offset_ms + int(sentence.get("end", sentence.get("end_ms", 0)) or 0),
                "text": str(sentence.get("text", "")).strip(),
            }
            for sentence in sentence_info
            if str(sentence.get("text", "")).strip()
        ]

    timestamps = item.get("timestamps") or item.get("ctc_timestamps") or item.get("timestamp")
    text = str(item.get("text", "")).strip()
    if isinstance(timestamps, list) and timestamps and text:
        first = timestamps[0]
        last = timestamps[-1]
        if isinstance(first, dict) and isinstance(last, dict):
            start = float(first.get("start_time", 0) or 0)
            end = float(last.get("end_time", 0) or 0)
            return [
                {
                    "start_ms": offset_ms + int(start * 1000),
                    "end_ms": offset_ms + int(end * 1000),
                    "text": text,
                }
            ]
        if isinstance(first, list) and isinstance(last, list):
            start = first[0] if first else 0
            end = last[-1] if last else 0
            return [
                {
                    "start_ms": offset_ms + int(start or 0),
                    "end_ms": offset_ms + int(end or 0),
                    "text": text,
                }
            ]

    return [{"start_ms": offset_ms, "end_ms": offset_ms, "text": text}] if text else []


def transcribe_audio(audio_path: Path) -> dict[str, Any]:
    try:
        audio, sample_rate = sf.read(str(audio_path), always_2d=False)
    except Exception:
        result = STATE["model"].generate(input=str(audio_path), batch_size=1, language="中文", itn=True)
        return {"segments": normalize_funasr_result(result), "raw": result}

    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    chunk_samples = max(1, int(sample_rate * MAX_CHUNK_SECONDS))
    if len(audio) <= chunk_samples:
        result = STATE["model"].generate(input=str(audio_path), batch_size=1, language="中文", itn=True)
        return {"segments": normalize_funasr_result(result), "raw": result}

    segments: list[dict[str, Any]] = []
    raw_results: list[Any] = []

    with tempfile.TemporaryDirectory(prefix="funasr-chunks-") as chunk_dir:
        for index, start in enumerate(range(0, len(audio), chunk_samples)):
            chunk = audio[start : start + chunk_samples]
            if chunk.size == 0:
                continue

            rms = float(np.sqrt(np.mean(np.square(chunk.astype(np.float32)))))
            if rms < SILENCE_RMS_THRESHOLD:
                continue

            chunk_path = Path(chunk_dir) / f"chunk-{index:04d}.wav"
            sf.write(str(chunk_path), chunk, sample_rate)
            offset_ms = int((start / sample_rate) * 1000)
            result = STATE["model"].generate(
                input=str(chunk_path),
                batch_size=1,
                language="中文",
                itn=True,
            )
            raw_results.append(result)
            segments.extend(normalize_funasr_result(result, offset_ms=offset_ms))

    return {"segments": segments, "raw": raw_results}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_error(404)
            return
        self.write_json(
            {
                "status": STATE["status"],
                "message": STATE["message"],
                "model": STATE["model_name"],
            }
        )

    def do_POST(self) -> None:
        if self.path != "/transcribe":
            self.send_error(404)
            return

        if STATE["status"] != "ready":
            self.write_json({"error": STATE["message"]}, status=503)
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            audio_path = Path(payload["audio_path"]).expanduser().resolve()
            if not audio_path.exists():
                self.write_json({"error": f"Audio file not found: {audio_path}"}, status=400)
                return

            self.write_json(transcribe_audio(audio_path))
        except Exception as exc:  # pragma: no cover - surfaced to Electron
            self.write_json({"error": str(exc)}, status=500)

    def log_message(self, format: str, *args: Any) -> None:
        print(format % args, file=sys.stderr, flush=True)

    def write_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17698)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    threading.Thread(target=load_model, daemon=True).start()
    server = ReusableThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Local FunASR service listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
