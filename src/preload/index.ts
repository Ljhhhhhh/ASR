import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

// Custom APIs for renderer
const api = {
  asr: {
    selectMediaFiles: () => ipcRenderer.invoke('asr:select-media-files'),
    startJobs: (filePaths: string[], config: AsrConfig) =>
      ipcRenderer.invoke('asr:start-jobs', filePaths, config),
    cancelActiveJob: () => ipcRenderer.invoke('asr:cancel-active-job'),
    restartLocalService: () => ipcRenderer.invoke('asr:restart-local-service'),
    getLocalServiceStatus: () => ipcRenderer.invoke('asr:get-local-service-status'),
    getJobs: () => ipcRenderer.invoke('asr:get-jobs') as Promise<TranscriptionJob[]>,
    exportTranscript: (jobId: string, format: ExportFormat) =>
      ipcRenderer.invoke('asr:export-transcript', jobId, format),
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
