import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type AsrProvider = 'local-funasr' | 'third-party'
type ExportFormat = 'txt' | 'srt'

interface BatchExportResult {
  exported: number
  skipped: number
  canceled?: boolean
}

interface SelectExportDirectoryResult {
  canceled?: boolean
  directory?: string
}

interface SummaryImageFilePayload {
  fileName: string
  data: Uint8Array
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

interface JobLogEntry {
  time: string
  message: string
}

interface TranscriptionJob {
  id: string
  filePath: string
  fileName: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  stage?: 'probing' | 'extracting' | 'transcribing' | 'normalizing'
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
  state: 'unknown' | 'starting' | 'ready' | 'unavailable'
  url: string
  message?: string
}

interface LlmConfigPublic {
  enabled: boolean
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  hasApiKey: boolean
  apiKeyPreview?: string
  updatedAt?: string
}

interface LlmConfigInput {
  enabled: boolean
  baseUrl: string
  model: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

interface LlmTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

interface LlmModelInfo {
  id: string
  label?: string
}

interface LlmListModelsResult {
  ok: boolean
  message: string
  models: LlmModelInfo[]
}

interface TranscriptFingerprint {
  cacheKey: string
  size: number
  mtimeMs: number
  segmentCount: number
  jobUpdatedAt: string
}

interface KnowledgeSummaryRecord {
  jobId: string
  fileName: string
  transcriptFingerprint: TranscriptFingerprint
  markdown: string
  model: string
  generatedAt: string
  courseType?: CourseType
  chunkCount?: number
}

interface KnowledgeSummaryResult {
  record: KnowledgeSummaryRecord
  stale: boolean
}

type CourseType = 'training' | 'interview' | 'lecture'

type SummaryStage = 'extract' | 'migrate' | 'repair'

interface SummaryProgressEvent {
  jobId: string
  stage: SummaryStage
  progress?: number
  delta?: string
  message?: string
}

interface SummaryDoneEvent {
  jobId: string
  record: KnowledgeSummaryRecord
}

interface SummaryErrorEvent {
  jobId: string
  message: string
}

// Custom APIs for renderer
const api = {
  asr: {
    selectMediaFiles: () => ipcRenderer.invoke('asr:select-media-files'),
    startJobs: (filePaths: string[], config: AsrConfig) =>
      ipcRenderer.invoke('asr:start-jobs', filePaths, config),
    cancelActiveJob: () => ipcRenderer.invoke('asr:cancel-active-job'),
    deleteJob: (jobId: string) => ipcRenderer.invoke('asr:delete-job', jobId),
    restartLocalService: () => ipcRenderer.invoke('asr:restart-local-service'),
    getLocalServiceStatus: () => ipcRenderer.invoke('asr:get-local-service-status'),
    getJobs: () => ipcRenderer.invoke('asr:get-jobs') as Promise<TranscriptionJob[]>,
    selectExportDirectory: () =>
      ipcRenderer.invoke('asr:select-export-directory') as Promise<SelectExportDirectoryResult>,
    exportTranscript: (jobId: string, format: ExportFormat) =>
      ipcRenderer.invoke('asr:export-transcript', jobId, format),
    exportTranscriptsBatch: (jobIds: string[], format: ExportFormat = 'txt') =>
      ipcRenderer.invoke('asr:export-transcripts-batch', jobIds, format) as Promise<BatchExportResult>,
    onJobsUpdated: (callback: (jobs: TranscriptionJob[]) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, jobs: TranscriptionJob[]): void =>
        callback(jobs)
      ipcRenderer.on('asr:jobs-updated', listener)
      return () => ipcRenderer.removeListener('asr:jobs-updated', listener)
    },
    onServiceUpdated: (callback: (status: LocalServiceStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: LocalServiceStatus): void =>
        callback(status)
      ipcRenderer.on('asr:service-updated', listener)
      return () => ipcRenderer.removeListener('asr:service-updated', listener)
    }
  },
  llm: {
    getConfig: (): Promise<LlmConfigPublic> => ipcRenderer.invoke('llm:get-config'),
    saveConfig: (input: LlmConfigInput): Promise<LlmConfigPublic> =>
      ipcRenderer.invoke('llm:save-config', input),
    testConnection: (override?: Partial<LlmConfigInput>): Promise<LlmTestResult> =>
      ipcRenderer.invoke('llm:test-connection', override),
    listModels: (override?: Partial<LlmConfigInput>): Promise<LlmListModelsResult> =>
      ipcRenderer.invoke('llm:list-models', override),
    getSummary: (jobId: string): Promise<KnowledgeSummaryResult | null> =>
      ipcRenderer.invoke('llm:get-summary', jobId),
    generateSummary: (jobId: string, courseType?: CourseType): Promise<KnowledgeSummaryRecord> =>
      ipcRenderer.invoke('llm:generate-summary', jobId, courseType),
    cancelSummary: (jobId: string): Promise<boolean> =>
      ipcRenderer.invoke('llm:cancel-summary', jobId),
    exportSummary: (jobId: string): Promise<void> =>
      ipcRenderer.invoke('llm:export-summary', jobId),
    exportSummariesBatch: (jobIds: string[]): Promise<BatchExportResult> =>
      ipcRenderer.invoke('llm:export-summaries-batch', jobIds),
    writeSummaryImageFiles: (
      directory: string,
      files: SummaryImageFilePayload[]
    ): Promise<BatchExportResult> =>
      ipcRenderer.invoke('llm:write-summary-image-files', directory, files),
    saveSummaryImageFromClipboard: (jobId: string): Promise<void> =>
      ipcRenderer.invoke('llm:save-summary-image-from-clipboard', jobId),
    onSummaryChunk: (callback: (event: SummaryProgressEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SummaryProgressEvent): void =>
        callback(payload)
      ipcRenderer.on('llm:summary-chunk', listener)
      return () => ipcRenderer.removeListener('llm:summary-chunk', listener)
    },
    onSummaryDone: (callback: (event: SummaryDoneEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SummaryDoneEvent): void =>
        callback(payload)
      ipcRenderer.on('llm:summary-done', listener)
      return () => ipcRenderer.removeListener('llm:summary-done', listener)
    },
    onSummaryError: (callback: (event: SummaryErrorEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SummaryErrorEvent): void =>
        callback(payload)
      ipcRenderer.on('llm:summary-error', listener)
      return () => ipcRenderer.removeListener('llm:summary-error', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
