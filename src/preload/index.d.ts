import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type AsrProvider = 'local-funasr' | 'third-party'
  type ExportFormat = 'txt' | 'srt'

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

  interface AsrApi {
    selectMediaFiles: () => Promise<string[]>
    startJobs: (filePaths: string[], config: AsrConfig) => Promise<void>
    cancelActiveJob: () => Promise<void>
    restartLocalService: () => Promise<LocalServiceStatus>
    getLocalServiceStatus: () => Promise<LocalServiceStatus>
    getJobs: () => Promise<TranscriptionJob[]>
    exportTranscript: (jobId: string, format: ExportFormat) => Promise<void>
    onJobsUpdated: (callback: (jobs: TranscriptionJob[]) => void) => () => void
    onServiceUpdated: (callback: (status: LocalServiceStatus) => void) => () => void
  }

  interface Window {
    electron: ElectronAPI
    api: {
      asr: AsrApi
    }
  }
}
