# ASR Tool Product Design

## Product Shape

This is a local-first desktop workbench for turning audio and video files into timestamped transcripts. It is built for repeated processing of course recordings, meetings, interviews, and screen recordings.

The app should open directly into the working surface. It should not have a landing page, marketing copy, or decorative hero section.

## Primary Workflow

1. The user selects one or more audio/video files.
2. The app shows the files in a processing queue.
3. The app verifies the local FunASR service and starts it when needed.
4. Each queued file is converted to a standard WAV file through ffmpeg.
5. The selected ASR provider transcribes the WAV file.
6. The app normalizes the returned segments into sentence-level transcript rows with timestamps.
7. The user reviews the transcript and exports TXT or SRT.

## Provider Model

Local FunASR is the default and preferred provider. The app should manage it as a stable background service so the model is loaded once and reused across jobs.

Third-party ASR is opt-in only. The app should call it only when the user explicitly selects the third-party provider and provides a service URL.

If third-party ASR fails, the app should not silently fall back to local FunASR. Silent fallback would make transcript provenance unclear.

## Interaction Model

The main screen has four regions:

- Header: product name, local service status, provider selection.
- Queue: selected files, status, current stage, duration, and errors.
- Transcript panel: the active or selected job's sentence rows with timestamps.
- Action bar: select files, start queue, cancel active job, export TXT, export SRT.

The queue is sequential in v1. One file is processed at a time to avoid competing ffmpeg and ASR workloads.

## States

Local service states:

- `unknown`: the app has not checked service health yet.
- `starting`: the app is launching or waiting for the service.
- `ready`: the local service is healthy.
- `unavailable`: the service could not start or failed health checks.

Job states:

- `queued`: waiting for processing.
- `running`: currently being processed.
- `completed`: transcript is available.
- `failed`: processing stopped with a visible error.
- `cancelled`: the user cancelled processing.

Job stages:

- `probing`: reading media metadata.
- `extracting`: converting media to WAV through ffmpeg.
- `transcribing`: sending audio to ASR.
- `normalizing`: splitting and formatting transcript segments.

## Visual Direction

The interface should be quiet, dense, and utility-focused. It should use a restrained dark-neutral surface, compact panels, clear status chips, and a table-like queue. Avoid oversized cards, decorative gradients, illustration, and marketing-style copy.

## Success Criteria

- A first-time user can understand what to do from the visible controls without reading documentation.
- The app makes the local FunASR service status obvious.
- Queue progress and failures are visible per file.
- Completed transcripts can be inspected before export.
- TXT and SRT exports preserve sentence timestamps.
