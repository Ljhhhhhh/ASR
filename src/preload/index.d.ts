import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
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

  interface AsrApi {
    selectMediaFiles: () => Promise<string[]>
    startJobs: (filePaths: string[], config: AsrConfig) => Promise<void>
    cancelActiveJob: () => Promise<void>
    deleteJob: (jobId: string) => Promise<boolean>
    restartLocalService: () => Promise<LocalServiceStatus>
    getLocalServiceStatus: () => Promise<LocalServiceStatus>
    getJobs: () => Promise<TranscriptionJob[]>
    selectExportDirectory: () => Promise<SelectExportDirectoryResult>
    exportTranscript: (jobId: string, format: ExportFormat) => Promise<void>
    exportTranscriptsBatch: (jobIds: string[], format?: ExportFormat) => Promise<BatchExportResult>
    onJobsUpdated: (callback: (jobs: TranscriptionJob[]) => void) => () => void
    onServiceUpdated: (callback: (status: LocalServiceStatus) => void) => () => void
  }

  interface LlmApi {
    getConfig: () => Promise<LlmConfigPublic>
    saveConfig: (input: LlmConfigInput) => Promise<LlmConfigPublic>
    testConnection: (override?: Partial<LlmConfigInput>) => Promise<LlmTestResult>
    listModels: (override?: Partial<LlmConfigInput>) => Promise<LlmListModelsResult>
    getSummary: (jobId: string) => Promise<KnowledgeSummaryResult | null>
    generateSummary: (jobId: string, courseType?: CourseType) => Promise<KnowledgeSummaryRecord>
    cancelSummary: (jobId: string) => Promise<boolean>
    exportSummary: (jobId: string) => Promise<void>
    exportSummaryPdf: (jobId: string) => Promise<void>
    exportSummariesBatch: (jobIds: string[]) => Promise<BatchExportResult>
    exportSummariesPdfBatch: (jobIds: string[]) => Promise<BatchExportResult>
    writeSummaryImageFiles: (
      directory: string,
      files: SummaryImageFilePayload[]
    ) => Promise<BatchExportResult>
    saveSummaryImageFromClipboard: (jobId: string) => Promise<void>
    onSummaryChunk: (callback: (event: SummaryProgressEvent) => void) => () => void
    onSummaryDone: (callback: (event: SummaryDoneEvent) => void) => () => void
    onSummaryError: (callback: (event: SummaryErrorEvent) => void) => () => void
  }

  interface Window {
    electron: ElectronAPI
    api: {
      asr: AsrApi
      llm: LlmApi
    }
  }
}
