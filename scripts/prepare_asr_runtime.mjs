import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  chmodSync,
  readFileSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* eslint-disable @typescript-eslint/explicit-function-return-type */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = resolve(root, '.asr-runtime')
const platform = readPlatform()
const current = resolve(runtimeRoot, 'current')
const target = current
const pythonDir = resolve(target, 'python')
const ffmpegDir = resolve(target, 'ffmpeg')
const modelsDir = resolve(target, 'models')
const isWindowsTarget = platform === 'win32-x64'
const pythonRelativePath = isWindowsTarget ? 'python/Scripts/python.exe' : 'python/bin/python'
const ffmpegRelativePath = isWindowsTarget ? 'ffmpeg/ffmpeg.exe' : 'ffmpeg/ffmpeg'
const ffprobeRelativePath = isWindowsTarget ? 'ffmpeg/ffprobe.exe' : 'ffmpeg/ffprobe'

assertCanPreparePlatform(platform)
resetCurrentIfPlatformChanged(platform)

function readPlatform() {
  const index = process.argv.indexOf('--platform')
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  if (process.platform === 'win32') return 'win32-x64'
  return 'darwin-arm64'
}

function assertCanPreparePlatform(targetPlatform) {
  const hostPlatform = `${process.platform}-${process.arch}`
  if (targetPlatform === 'darwin-arm64' && hostPlatform === 'darwin-arm64') return
  if (targetPlatform === 'win32-x64' && hostPlatform === 'win32-x64') return
  throw new Error(
    `Cannot prepare ${targetPlatform} runtime on ${hostPlatform}; build it on the matching platform`
  )
}

function resetCurrentIfPlatformChanged(targetPlatform) {
  const manifestPath = resolve(current, 'manifest.json')
  if (!existsSync(manifestPath)) return

  try {
    const manifest = JSON.parse(readText(manifestPath))
    if (manifest.platform === targetPlatform) return
  } catch {
    // Recreate unreadable runtimes.
  }
  rmSync(current, { recursive: true, force: true })
}

function run(command, args, options = {}) {
  console.log([command, ...args].join(' '))
  execFileSync(command, args, { stdio: 'inherit', cwd: root, ...options })
}

function findCommand(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (result.status === 0) return candidate
  }
  return ''
}

function commandPath(command) {
  const executable = process.platform === 'win32' ? 'where.exe' : '/usr/bin/which'
  const result = spawnSync(executable, [command], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : ''
}

function readText(path) {
  return readFileSync(path, 'utf8')
}

mkdirSync(target, { recursive: true })
mkdirSync(ffmpegDir, { recursive: true })
mkdirSync(modelsDir, { recursive: true })

const python = process.env.PYTHON || findCommand(['python3.12', 'python3', 'python'])
if (!python) throw new Error('Python 3.12 or python3 is required to prepare the local ASR runtime')

if (!existsSync(resolve(target, pythonRelativePath))) {
  run(python, ['-m', 'venv', pythonDir])
}

const runtimePython = resolve(target, pythonRelativePath)
run(runtimePython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
run(runtimePython, ['-m', 'pip', 'install', '-r', resolve(root, 'requirements.txt')])

const downloadModels = `
from modelscope import snapshot_download
models = {
    "paraformer-zh": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "fsmn-vad": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "ct-punc": "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
}
for name, model_id in models.items():
    print(f"Downloading {model_id} -> {name}", flush=True)
    snapshot_download(model_id, local_dir="${modelsDir.replaceAll('\\', '\\\\')}/" + name)
`
run(runtimePython, ['-c', downloadModels])

const ffmpegSource = process.env.FFMPEG_BIN || commandPath('ffmpeg')
const ffprobeSource = process.env.FFPROBE_BIN || commandPath('ffprobe')
if (!ffmpegSource || !ffprobeSource) {
  throw new Error('ffmpeg and ffprobe must be installed or supplied through FFMPEG_BIN/FFPROBE_BIN')
}
copyExecutable(ffmpegSource, resolve(target, ffmpegRelativePath))
copyExecutable(ffprobeSource, resolve(target, ffprobeRelativePath))

const freeze = execFileSync(runtimePython, ['-m', 'pip', 'freeze'], { encoding: 'utf8' })
writeFileSync(resolve(target, 'runtime-lock.txt'), freeze)

const manifest = {
  version: 1,
  platform,
  python: pythonRelativePath,
  ffmpeg: ffmpegRelativePath,
  ffprobe: ffprobeRelativePath,
  model: 'models/paraformer-zh',
  vadModel: 'models/fsmn-vad',
  puncModel: 'models/ct-punc',
  device: 'cpu'
}
writeFileSync(resolve(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Prepared local ASR runtime at ${target}`)

function copyExecutable(source, destination) {
  const sourceStat = statSync(source)
  if (sourceStat.isDirectory()) throw new Error(`Expected executable file: ${source}`)
  copyFileSync(source, destination)
  chmodSync(destination, sourceStat.mode | 0o755)
}
