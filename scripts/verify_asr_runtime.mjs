import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/* eslint-disable @typescript-eslint/explicit-function-return-type */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = resolve(root, '.asr-runtime/current')
const manifestPath = resolve(runtimeRoot, 'manifest.json')
const serviceScript = resolve(root, 'scripts/funasr_service.py')
const port = Number(process.env.ASR_VERIFY_PORT || 17699)

if (!existsSync(manifestPath)) {
  throw new Error(`Missing runtime manifest: ${manifestPath}`)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

function runtimePath(value) {
  if (!value) return undefined
  return resolve(runtimeRoot, value)
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

function writeSampleWav(filePath) {
  const sampleRate = 16000
  const seconds = 1
  const samples = sampleRate * seconds
  const dataBytes = samples * 2
  const buffer = Buffer.alloc(44 + dataBytes)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)

  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 2000)
    buffer.writeInt16LE(value, 44 + i * 2)
  }

  writeFileSync(filePath, buffer)
}

const python = runtimePath(manifest.python)
const ffmpeg = runtimePath(manifest.ffmpeg)
if (!python || !ffmpeg) throw new Error('Runtime manifest must include python and ffmpeg paths')
const cacheDir = resolve(runtimeRoot, '.verify-cache')
const env = {
  ...process.env,
  ASR_FUNASR_MODEL: runtimePath(manifest.model),
  ASR_FUNASR_VAD_MODEL: runtimePath(manifest.vadModel),
  ASR_FUNASR_PUNC_MODEL: runtimePath(manifest.puncModel),
  ASR_FUNASR_DEVICE: manifest.device || 'auto',
  ASR_FUNASR_CACHE_DIR: cacheDir,
  MODELSCOPE_CACHE: cacheDir,
  HF_HOME: cacheDir,
  PATH: [dirname(ffmpeg), process.env.PATH].filter(Boolean).join(delimiter),
  PYTHONNOUSERSITE: '1'
}

const service = spawn(python, [serviceScript, '--host', '127.0.0.1', '--port', String(port)], {
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})

service.stdout.on('data', (data) => process.stdout.write(data))
service.stderr.on('data', (data) => process.stderr.write(data))

const workDir = mkdtempSync(resolve(tmpdir(), 'asr-runtime-verify-'))

try {
  const healthUrl = `http://127.0.0.1:${port}/health`
  const deadline = Date.now() + 180_000
  let health
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl)
      health = await response.json()
      if (health.status === 'ready') break
      if (health.status === 'error') throw new Error(health.message || 'service error')
    } catch (error) {
      if (Date.now() + 1000 >= deadline) throw error
    }
    await wait(1500)
  }

  if (!health || health.status !== 'ready') {
    throw new Error(`Local FunASR service did not become ready: ${JSON.stringify(health)}`)
  }

  const audioPath = resolve(workDir, 'sample.wav')
  writeSampleWav(audioPath)
  const response = await fetch(`http://127.0.0.1:${port}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio_path: audioPath })
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(payload))
  if (!Array.isArray(payload.segments)) {
    throw new Error(`Unexpected transcription payload: ${JSON.stringify(payload).slice(0, 500)}`)
  }

  console.log('Local ASR runtime verification passed')
} finally {
  service.kill()
  rmSync(workDir, { recursive: true, force: true })
}
