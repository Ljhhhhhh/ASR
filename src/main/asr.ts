import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import { tmpdir } from 'os'

type AsrProvider = 'local-funasr' | 'third-party'
type ServiceState = 'unknown' | 'starting' | 'ready' | 'unavailable'
type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
type JobStage = 'probing' | 'extracting' | 'transcribing' | 'normalizing'
type ExportFormat = 'txt' | 'srt'

interface JobLogEntry {
  time: string
  message: string
}

interface AsrConfig {
  provider: AsrProvider
  thirdPartyBaseUrl?: string
  thirdPartyModel?: string
}

interface TranscriptSegment {
  startMs: number
  endMs: number
  text: string
}

interface TranscriptionJob {
  id: string
  filePath: string
  fileName: string
  status: JobStatus
  progress: number
  stage?: JobStage
  durationMs?: number
  segments: TranscriptSegment[]
  logs: JobLogEntry[]
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  source?: 'cache' | 'transcription'
}

interface LocalServiceStatus {
  state: ServiceState
  url: string
  message?: string
}

interface CachedTranscript {
  cacheKey: string
  filePath: string
  fileName: string
  size: number
  mtimeMs: number
  durationMs?: number
  segments: TranscriptSegment[]
  updatedAt: string
}

const LOCAL_SERVICE_URL = process.env['ASR_LOCAL_FUNASR_URL'] || 'http://127.0.0.1:17698'
const APP_ROOT = app.isPackaged ? process.resourcesPath : process.cwd()
const PYTHON_BIN = process.env['ASR_FUNASR_PYTHON'] || resolve(APP_ROOT, '.venv/bin/python')
const SERVICE_SCRIPT = resolve(APP_ROOT, 'scripts/funasr_service.py')
const SERVICE_PID_PATH = join(process.cwd(), '.asr', 'funasr-service.pid')

const jobs = new Map<string, TranscriptionJob>()
const transcriptCache = new Map<string, CachedTranscript>()
let activeProcess: ChildProcessWithoutNullStreams | undefined
let queueRunning = false
let cancelRequested = false
let serviceProcess: ChildProcessWithoutNullStreams | undefined
let serviceState: ServiceState = 'unknown'
let serviceMessage = ''

export function registerAsrHandlers(mainWindow: BrowserWindow): void {
  const emitJobs = (): void => {
    mainWindow.webContents.send('asr:jobs-updated', Array.from(jobs.values()))
  }

  const emitService = (): void => {
    mainWindow.webContents.send('asr:service-updated', getServiceStatus())
  }

  ipcMain.handle('asr:select-media-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Audio and video',
          extensions: [
            'mp3',
            'wav',
            'm4a',
            'aac',
            'flac',
            'ogg',
            'mp4',
            'mov',
            'mkv',
            'avi',
            'webm'
          ]
        }
      ]
    })

    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('asr:start-jobs', async (_event, filePaths: string[], config: AsrConfig) => {
    await loadTranscriptCache()

    for (const filePath of filePaths) {
      const normalizedPath = resolve(filePath)
      const exists = Array.from(jobs.values()).some(
        (job) => job.filePath === normalizedPath && job.status !== 'failed'
      )
      if (exists) continue

      const cached = await findCachedTranscript(normalizedPath)
      const id = randomUUID()
      const now = new Date().toISOString()
      jobs.set(id, {
        id,
        filePath: normalizedPath,
        fileName: basename(normalizedPath),
        status: cached ? 'completed' : 'queued',
        progress: cached ? 100 : 0,
        stage: cached ? 'normalizing' : undefined,
        durationMs: cached?.durationMs,
        segments: cached?.segments || [],
        logs: [
          {
            time: now,
            message: cached ? '命中本地缓存，已直接载入文字稿' : '已加入处理队列，等待开始'
          }
        ],
        createdAt: now,
        updatedAt: now,
        completedAt: cached ? now : undefined,
        source: cached ? 'cache' : 'transcription'
      })
    }

    emitJobs()
    const hasQueuedJobs = Array.from(jobs.values()).some((job) => job.status === 'queued')
    if (hasQueuedJobs && !queueRunning) void runQueue(config, emitJobs, emitService)
  })

  ipcMain.handle('asr:cancel-active-job', async () => {
    cancelRequested = true
    activeProcess?.kill()
  })

  ipcMain.handle('asr:restart-local-service', async () => {
    await stopLocalService()
    await stopStaleLocalService()
    serviceState = 'starting'
    serviceMessage = 'Restarting local FunASR service'
    emitService()
    await ensureLocalService(emitService)
    return getServiceStatus()
  })

  ipcMain.handle('asr:get-local-service-status', async () => {
    await refreshServiceStatus()
    return getServiceStatus()
  })

  ipcMain.handle('asr:export-transcript', async (_event, jobId: string, format: ExportFormat) => {
    const job = jobs.get(jobId)
    if (!job || job.status !== 'completed') throw new Error('No completed transcript is available')

    const defaultPath = join(
      process.cwd(),
      `${basename(job.fileName, extname(job.fileName))}.${format}`
    )
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })

    if (result.canceled || !result.filePath) return
    const content = format === 'txt' ? formatTxt(job.segments) : formatSrt(job.segments)
    await writeFile(result.filePath, content, 'utf8')
  })

  void startLocalServiceOnLaunch(emitService)
}

function getServiceStatus(): LocalServiceStatus {
  return {
    state: serviceState,
    url: LOCAL_SERVICE_URL,
    message: serviceMessage || undefined
  }
}

async function runQueue(
  config: AsrConfig,
  emitJobs: () => void,
  emitService: () => void
): Promise<void> {
  queueRunning = true
  cancelRequested = false

  try {
    if (config.provider !== 'third-party') {
      try {
        await ensureLocalService(emitService)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failQueuedJobs(message, emitJobs)
        return
      }
    }

    while (true) {
      const job = Array.from(jobs.values()).find((candidate) => candidate.status === 'queued')
      if (!job) break

      try {
        await processJob(job, config, emitJobs)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        job.status = cancelRequested ? 'cancelled' : 'failed'
        job.error = message
        job.progress = cancelRequested ? job.progress : 0
        addJobLog(job, cancelRequested ? '用户取消了当前任务' : `任务失败：${message}`)
        emitJobs()
      } finally {
        cancelRequested = false
      }
    }
  } finally {
    queueRunning = false
  }
}

function failQueuedJobs(message: string, emitJobs: () => void): void {
  for (const job of jobs.values()) {
    if (job.status !== 'queued') continue
    job.status = 'failed'
    job.error = message
    job.progress = 0
    addJobLog(job, `任务失败：${message}`)
  }
  emitJobs()
}

async function processJob(
  job: TranscriptionJob,
  config: AsrConfig,
  emitJobs: () => void
): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'asr-job-'))
  const wavPath = join(workDir, 'audio.wav')

  try {
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    updateJobProgress(job, 'probing', 5, '开始读取媒体信息')
    emitJobs()

    job.durationMs = await probeDuration(job.filePath)
    addJobLog(job, `媒体时长 ${formatDuration(job.durationMs)}`)
    emitJobs()

    updateJobProgress(job, 'extracting', 15, '正在提取并标准化音频')
    emitJobs()
    await extractWav(job.filePath, wavPath, job.durationMs, (progress) => {
      job.progress = Math.max(job.progress, Math.min(50, 15 + progress * 35))
      job.updatedAt = new Date().toISOString()
      emitJobs()
    })
    addJobLog(job, '音频提取完成，已转换为 16kHz 单声道 WAV')

    updateJobProgress(
      job,
      'transcribing',
      58,
      config.provider === 'third-party' ? '正在发送到第三方 ASR' : '正在调用本地 FunASR 转写'
    )
    emitJobs()
    const rawSegments = await runTranscriptionWithProgress(job, wavPath, config, emitJobs)
    addJobLog(job, `ASR 返回 ${rawSegments.length} 个原始分句`)

    updateJobProgress(job, 'normalizing', 92, '正在整理时间轴和分句')
    emitJobs()
    job.segments = normalizeSegments(rawSegments, job.durationMs)
    job.status = 'completed'
    job.progress = 100
    job.completedAt = new Date().toISOString()
    addJobLog(job, `转写完成，共 ${job.segments.length} 句`)
    job.source = 'transcription'
    await saveCompletedJob(job)
    emitJobs()
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

function updateJobProgress(
  job: TranscriptionJob,
  stage: JobStage,
  progress: number,
  message: string
): void {
  job.stage = stage
  job.progress = progress
  addJobLog(job, message)
}

function addJobLog(job: TranscriptionJob, message: string): void {
  job.updatedAt = new Date().toISOString()
  job.logs = [...job.logs, { time: job.updatedAt, message }].slice(-20)
}

async function runTranscriptionWithProgress(
  job: TranscriptionJob,
  wavPath: string,
  config: AsrConfig,
  emitJobs: () => void
): Promise<TranscriptSegment[]> {
  const startedAt = Date.now()
  let heartbeatCount = 0
  const timer = setInterval(() => {
    heartbeatCount += 1
    const elapsedMs = Date.now() - startedAt
    job.progress = Math.max(job.progress, Math.min(88, 58 + heartbeatCount * 3))
    addJobLog(job, `ASR 转写仍在进行，已等待 ${formatDuration(elapsedMs)}`)
    emitJobs()
  }, 15_000)

  try {
    return config.provider === 'third-party'
      ? await transcribeWithThirdParty(wavPath, config)
      : await transcribeWithLocalService(wavPath)
  } finally {
    clearInterval(timer)
  }
}

async function loadTranscriptCache(): Promise<void> {
  if (transcriptCache.size > 0) return

  try {
    const raw = await readFile(getTranscriptCachePath(), 'utf8')
    const payload = JSON.parse(raw) as { transcripts?: CachedTranscript[] }
    if (!Array.isArray(payload.transcripts)) return

    for (const transcript of payload.transcripts) {
      if (!transcript.cacheKey || !Array.isArray(transcript.segments)) continue
      transcriptCache.set(transcript.cacheKey, transcript)
    }
  } catch {
    // Missing or unreadable cache should not block transcription.
  }
}

async function findCachedTranscript(filePath: string): Promise<CachedTranscript | undefined> {
  const fileName = basename(filePath)
  const cacheKey = getCacheKey(filePath, fileName)
  const cached = transcriptCache.get(cacheKey)
  if (!cached) return undefined

  try {
    const fileStat = await stat(filePath)
    if (cached.size !== fileStat.size || cached.mtimeMs !== fileStat.mtimeMs) {
      transcriptCache.delete(cacheKey)
      await persistTranscriptCache()
      return undefined
    }
    return cached
  } catch {
    transcriptCache.delete(cacheKey)
    await persistTranscriptCache()
    return undefined
  }
}

async function saveCompletedJob(job: TranscriptionJob): Promise<void> {
  const fileStat = await stat(job.filePath)
  const fileName = basename(job.filePath)
  const cacheKey = getCacheKey(job.filePath, fileName)
  transcriptCache.set(cacheKey, {
    cacheKey,
    filePath: job.filePath,
    fileName,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    durationMs: job.durationMs,
    segments: job.segments,
    updatedAt: new Date().toISOString()
  })
  await persistTranscriptCache()
  await persistProjectSrt(job)
}

async function persistTranscriptCache(): Promise<void> {
  const cachePath = getTranscriptCachePath()
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(
    cachePath,
    JSON.stringify({ transcripts: Array.from(transcriptCache.values()) }, null, 2),
    'utf8'
  )
}

async function persistProjectSrt(job: TranscriptionJob): Promise<void> {
  const outputPath = join(
    getProjectTranscriptsPath(),
    `${basename(job.fileName, extname(job.fileName))}.srt`
  )
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, formatSrt(job.segments), 'utf8')
}

function getCacheKey(filePath: string, fileName: string): string {
  return `${resolve(filePath)}::${fileName}`
}

function getTranscriptCachePath(): string {
  return join(process.cwd(), '.asr', 'transcript-cache.json')
}

function getProjectTranscriptsPath(): string {
  return join(process.cwd(), '.asr', 'transcripts')
}

async function probeDuration(filePath: string): Promise<number> {
  const output = await runProcess('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath
  ])
  const seconds = Number.parseFloat(output.trim())
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0
}

async function extractWav(
  inputPath: string,
  outputPath: string,
  durationMs: number | undefined,
  onProgress: (progress: number) => void
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  await runProcess(
    'ffmpeg',
    ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outputPath],
    (chunk) => {
      if (!durationMs) return
      const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(chunk)
      if (!match) return
      const [, hours, minutes, seconds] = match
      const currentMs =
        Number(hours) * 60 * 60 * 1000 + Number(minutes) * 60 * 1000 + Number(seconds) * 1000
      onProgress(Math.min(1, currentMs / durationMs))
    }
  )
}

async function transcribeWithLocalService(wavPath: string): Promise<TranscriptSegment[]> {
  const response = await fetch(`${LOCAL_SERVICE_URL}/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio_path: wavPath })
  })

  if (!response.ok) {
    throw new Error(`Local FunASR failed: ${response.status} ${await response.text()}`)
  }

  const payload = await response.json()
  return readSegments(payload)
}

async function transcribeWithThirdParty(
  wavPath: string,
  config: AsrConfig
): Promise<TranscriptSegment[]> {
  if (!config.thirdPartyBaseUrl) throw new Error('Third-party ASR URL is required')

  const audio = await readFile(wavPath)
  const form = new FormData()
  form.set('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav')
  if (config.thirdPartyModel) form.set('model', config.thirdPartyModel)
  form.set('response_format', 'verbose_json')

  const baseUrl = config.thirdPartyBaseUrl.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form
  })

  if (!response.ok) {
    throw new Error(`Third-party ASR failed: ${response.status} ${await response.text()}`)
  }

  const payload = await response.json()
  return readSegments(payload)
}

async function ensureLocalService(emitService: () => void): Promise<void> {
  await refreshServiceStatus()
  if (serviceState === 'ready') {
    emitService()
    return
  }

  serviceState = 'starting'
  serviceMessage = 'Starting local FunASR service'
  emitService()

  if (!serviceProcess) {
    await stopStaleLocalService()
    const spawnedService = spawn(PYTHON_BIN, [
      SERVICE_SCRIPT,
      '--host',
      '127.0.0.1',
      '--port',
      '17698'
    ])
    serviceProcess = spawnedService
    if (spawnedService.pid) void writeLocalServicePid(spawnedService.pid)
    spawnedService.on('error', (error) => {
      if (serviceProcess === spawnedService) serviceProcess = undefined
      serviceState = 'unavailable'
      serviceMessage = `Failed to start local FunASR service: ${error.message}`
      emitService()
    })
    spawnedService.stderr.on('data', (data) => {
      if (serviceState === 'ready') return
      const message = String(data).trim()
      if (!message) return
      serviceMessage = message
      emitService()
    })
    spawnedService.on('exit', (code) => {
      const wasCurrentService = serviceProcess === spawnedService
      if (wasCurrentService) serviceProcess = undefined
      const exitedPid = spawnedService.pid
      if (exitedPid) void clearLocalServicePid(exitedPid)
      if (!wasCurrentService || serviceState !== 'ready') return
      serviceState = 'unavailable'
      serviceMessage = `Local FunASR service exited with code ${code ?? 'unknown'}`
      emitService()
    })
  }

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await wait(1500)
    await refreshServiceStatus()
    emitService()
    if (getServiceStatus().state === 'ready') return
    if (getServiceStatus().state === 'unavailable') {
      throw new Error(getServiceStatus().message || 'Local FunASR service is unavailable')
    }
  }

  serviceState = 'unavailable'
  serviceMessage = 'Local FunASR service did not become ready within 120 seconds'
  emitService()
  throw new Error(serviceMessage)
}

async function startLocalServiceOnLaunch(emitService: () => void): Promise<void> {
  serviceState = 'starting'
  serviceMessage = '正在启动本地 FunASR 服务，模型加载完成前请稍候'
  emitService()

  try {
    await ensureLocalService(emitService)
  } catch (error) {
    serviceState = 'unavailable'
    serviceMessage = error instanceof Error ? error.message : String(error)
    emitService()
  }
}

async function refreshServiceStatus(): Promise<void> {
  try {
    const response = await fetch(`${LOCAL_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(1500)
    })
    const payload = await response.json()
    serviceState =
      payload.status === 'ready' ? 'ready' : payload.status === 'error' ? 'unavailable' : 'starting'
    serviceMessage = payload.message || payload.status || ''
  } catch {
    serviceState = serviceProcess ? 'starting' : 'unavailable'
    serviceMessage = serviceProcess
      ? 'Waiting for local FunASR service'
      : 'Local FunASR service is not running'
  }
}

async function stopLocalService(): Promise<void> {
  const processToStop = serviceProcess
  if (!processToStop) return

  serviceProcess = undefined
  if (processToStop.exitCode !== null) return

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5000)
    processToStop.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    if (!processToStop.killed) processToStop.kill()
  })

  if (processToStop.pid) await clearLocalServicePid(processToStop.pid)
}

async function stopStaleLocalService(): Promise<void> {
  const pids = new Set(await findLocalServicePids())
  const pid = await readLocalServicePid()
  if (pid) pids.add(pid)

  for (const stalePid of pids) {
    if (stalePid === serviceProcess?.pid) continue

    if (!isProcessRunning(stalePid)) {
      await clearLocalServicePid(stalePid)
      continue
    }

    const command = await readProcessCommand(stalePid)
    if (!command.includes(SERVICE_SCRIPT)) {
      await clearLocalServicePid(stalePid)
      continue
    }

    process.kill(stalePid)
    await waitForProcessExit(stalePid, 5000)
    await clearLocalServicePid(stalePid)
  }
}

async function writeLocalServicePid(pid: number): Promise<void> {
  await mkdir(dirname(SERVICE_PID_PATH), { recursive: true })
  await writeFile(SERVICE_PID_PATH, String(pid), 'utf8')
}

async function readLocalServicePid(): Promise<number | undefined> {
  try {
    const raw = await readFile(SERVICE_PID_PATH, 'utf8')
    const pid = Number(raw.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

async function clearLocalServicePid(pid: number): Promise<void> {
  const currentPid = await readLocalServicePid()
  if (currentPid === pid) await rm(SERVICE_PID_PATH, { force: true })
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readProcessCommand(pid: number): Promise<string> {
  return new Promise((resolveCommand) => {
    const ps = spawn('/bin/ps', ['-p', String(pid), '-o', 'command='])
    let stdout = ''
    ps.stdout.on('data', (data) => {
      stdout += String(data)
    })
    ps.on('error', () => resolveCommand(''))
    ps.on('close', () => resolveCommand(stdout.trim()))
  })
}

function findLocalServicePids(): Promise<number[]> {
  return new Promise((resolvePids) => {
    const ps = spawn('/bin/ps', ['-axo', 'pid=,command='])
    let stdout = ''
    ps.stdout.on('data', (data) => {
      stdout += String(data)
    })
    ps.on('error', () => resolvePids([]))
    ps.on('close', () => {
      const pids = stdout.split('\n').flatMap((line) => {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line)
        if (!match) return []
        const [, rawPid, command] = match
        const pid = Number(rawPid)
        return pid !== process.pid && command.includes(SERVICE_SCRIPT) ? [pid] : []
      })
      resolvePids(pids)
    })
  })
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return
    await wait(100)
  }
}

function readSegments(payload: unknown): TranscriptSegment[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const segments = Array.isArray(record.segments)
    ? record.segments
    : Array.isArray(record.sentence_info)
      ? record.sentence_info
      : []

  if (segments.length > 0) {
    return segments
      .map((segment) => {
        const item = segment as Record<string, unknown>
        return {
          startMs: readTimeMs(item, ['start_ms', 'startMs'], ['start', 'start_time']),
          endMs: readTimeMs(item, ['end_ms', 'endMs'], ['end', 'end_time']),
          text: String(item.text ?? '').trim()
        }
      })
      .filter((segment) => segment.text)
  }

  const text = String(record.text ?? '').trim()
  return text ? [{ startMs: 0, endMs: 0, text }] : []
}

function normalizeSegments(segments: TranscriptSegment[], durationMs = 0): TranscriptSegment[] {
  return segments
    .flatMap((segment) => splitSegment(segment, durationMs))
    .filter((segment) => segment.text)
}

function splitSegment(segment: TranscriptSegment, durationMs: number): TranscriptSegment[] {
  const text = segment.text.replace(/\s+/g, ' ').trim()
  if (!text) return []

  const parts = text.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((part) => part.trim()) || [text]
  const cleanParts = parts.filter(Boolean)
  if (cleanParts.length <= 1) {
    return [{ ...segment, endMs: segment.endMs || durationMs, text }]
  }

  const start = segment.startMs
  const end = segment.endMs || durationMs
  const span = Math.max(0, end - start)
  const totalChars = cleanParts.reduce((sum, part) => sum + part.length, 0)
  let cursor = start

  return cleanParts.map((part, index) => {
    const isLast = index === cleanParts.length - 1
    const partSpan = isLast ? end - cursor : Math.round((span * part.length) / totalChars)
    const next = isLast ? end : cursor + partSpan
    const output = { startMs: cursor, endMs: next, text: part }
    cursor = next
    return output
  })
}

function readTimeMs(
  item: Record<string, unknown>,
  millisecondKeys: string[],
  secondKeys: string[]
): number {
  for (const key of millisecondKeys) {
    if (item[key] !== undefined) return toNumber(item[key])
  }
  for (const key of secondKeys) {
    if (item[key] !== undefined) return toSecondsAsMs(item[key])
  }
  return 0
}

function toNumber(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return 0
  return Math.round(numberValue)
}

function toSecondsAsMs(value: unknown): number {
  return Math.round(toNumber(value) * 1000)
}

function formatTxt(segments: TranscriptSegment[]): string {
  return `${segments
    .map(
      (segment) =>
        `[${formatReadableTime(segment.startMs)} - ${formatReadableTime(segment.endMs)}] ${segment.text}`
    )
    .join('\n')}\n`
}

function formatSrt(segments: TranscriptSegment[]): string {
  return `${segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTime(segment.startMs)} --> ${formatSrtTime(segment.endMs)}\n${segment.text}\n`
    )
    .join('\n')}\n`
}

function formatReadableTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const millis = Math.floor(ms % 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${String(millis).padStart(3, '0')}`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes} 分 ${seconds} 秒`
}

function formatSrtTime(ms: number): string {
  return formatReadableTime(ms).replace('.', ',')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function runProcess(
  command: string,
  args: string[],
  onStderr?: (chunk: string) => void
): Promise<string> {
  return new Promise((resolveProcess, reject) => {
    activeProcess = spawn(command, args)
    let stdout = ''
    let stderr = ''

    activeProcess.stdout.on('data', (data) => {
      stdout += String(data)
    })

    activeProcess.stderr.on('data', (data) => {
      const chunk = String(data)
      stderr += chunk
      onStderr?.(chunk)
    })

    activeProcess.on('error', reject)
    activeProcess.on('close', (code) => {
      activeProcess = undefined
      if (cancelRequested) {
        reject(new Error('Job cancelled'))
        return
      }
      if (code === 0) {
        resolveProcess(stdout || stderr)
        return
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`))
    })
  })
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms))
}
