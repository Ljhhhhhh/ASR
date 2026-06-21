import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename, extname, join } from 'path'
import { writeFile } from 'fs/promises'
import { getJobById, getTranscriptFingerprint } from '../asr'
import { loadLlmConfig } from '../llm'
import { runKnowledgeSummaryChain } from './chains/knowledgeSummary'
import { normalizeCourseType, type CourseType } from './prompts/courseTemplates'
import {
  isSummaryStale,
  loadKnowledgeSummary,
  saveKnowledgeSummary,
  type KnowledgeSummaryRecord
} from './summaryStore'

const activeSummaryJobs = new Map<string, AbortController>()

function emitSummaryChunk(mainWindow: BrowserWindow, payload: unknown): void {
  mainWindow.webContents.send('llm:summary-chunk', payload)
}

function emitSummaryDone(mainWindow: BrowserWindow, payload: unknown): void {
  mainWindow.webContents.send('llm:summary-done', payload)
}

function emitSummaryError(mainWindow: BrowserWindow, payload: unknown): void {
  mainWindow.webContents.send('llm:summary-error', payload)
}

export function registerSummaryHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('llm:get-summary', async (_event, jobId: string) => {
    if (!jobId) return null
    const record = await loadKnowledgeSummary(jobId)
    if (!record) return null

    const job = getJobById(jobId)
    if (!job) return { record, stale: true }

    const fingerprint = await getTranscriptFingerprint(job)
    return {
      record,
      stale: isSummaryStale(record, fingerprint)
    }
  })

  ipcMain.handle(
    'llm:generate-summary',
    async (_event, jobId: string, courseTypeInput?: CourseType) => {
      if (!jobId) throw new Error('缺少任务 ID')
      const courseType = normalizeCourseType(courseTypeInput)

      const job = getJobById(jobId)
      if (!job || job.status !== 'completed') {
        throw new Error('没有可用的已完成文字稿')
      }
      if (job.segments.length === 0) {
        throw new Error('文字稿为空')
      }

      if (activeSummaryJobs.has(jobId)) {
        throw new Error('该任务正在生成知识总结')
      }

      const config = await loadLlmConfig()
      const controller = new AbortController()
      activeSummaryJobs.set(jobId, controller)

      try {
        const fingerprint = await getTranscriptFingerprint(job)
        const markdown = await runKnowledgeSummaryChain({
          jobId,
          fileName: job.fileName,
          segments: job.segments,
          courseType,
          signal: controller.signal,
          onProgress: (event) => emitSummaryChunk(mainWindow, event)
        })

        const record: KnowledgeSummaryRecord = {
          jobId,
          fileName: job.fileName,
          transcriptFingerprint: fingerprint,
          markdown,
          model: config.model,
          courseType,
          generatedAt: new Date().toISOString()
        }

        await saveKnowledgeSummary(record)
        emitSummaryDone(mainWindow, { jobId, record })
        return record
      } catch (error) {
        const message = error instanceof Error ? error.message : '生成知识总结失败'
        emitSummaryError(mainWindow, { jobId, message })
        throw error
      } finally {
        activeSummaryJobs.delete(jobId)
      }
    }
  )

  ipcMain.handle('llm:cancel-summary', async (_event, jobId: string) => {
    const controller = activeSummaryJobs.get(jobId)
    if (!controller) return false
    controller.abort()
    activeSummaryJobs.delete(jobId)
    return true
  })

  ipcMain.handle('llm:export-summary', async (_event, jobId: string) => {
    const record = await loadKnowledgeSummary(jobId)
    if (!record) throw new Error('没有可导出的知识总结')

    const defaultPath = join(
      process.cwd(),
      `${basename(record.fileName, extname(record.fileName))}-知识总结.md`
    )
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })

    if (result.canceled || !result.filePath) return
    await writeFile(result.filePath, record.markdown, 'utf8')
  })
}