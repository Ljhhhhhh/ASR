import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { basename, extname, join } from 'path'
import { writeFile } from 'fs/promises'
import {
  getAllJobs,
  getJobById,
  getTranscriptFingerprint,
  resolveUniqueFileName,
  type BatchExportResult
} from '../asr'
import {
  buildDefaultSavePath,
  pickExportDirectory,
  rememberExportDirectory,
  rememberExportPath
} from '../exportDirectory'
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

  ipcMain.handle(
    'llm:export-summaries-batch',
    async (_event, jobIds: string[]): Promise<BatchExportResult> => {
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        throw new Error('请先勾选要导出的任务')
      }

      const selectedIds = new Set(jobIds)
      const selectedJobs = getAllJobs().filter((job) => selectedIds.has(job.id))
      if (selectedJobs.length === 0) {
        throw new Error('所选任务不存在或已被删除')
      }

      const records = (
        await Promise.all(
          selectedJobs.map(async (job) => ({
            job,
            record: await loadKnowledgeSummary(job.id)
          }))
        )
      ).filter(
        (
          entry
        ): entry is { job: (typeof selectedJobs)[number]; record: KnowledgeSummaryRecord } =>
          Boolean(entry.record)
      )

      if (records.length === 0) {
        throw new Error('所选任务中没有可导出的知识总结')
      }

    const directory = await pickExportDirectory(mainWindow)
    if (!directory) {
      return { exported: 0, skipped: 0, canceled: true }
    }
    const usedNames = new Set<string>()
    let exported = 0
    let skipped = 0

    for (const { record } of records) {
      const baseName = basename(record.fileName, extname(record.fileName))
      const fileName = resolveUniqueFileName(usedNames, `${baseName}-知识总结.md`)
      try {
        await writeFile(join(directory, fileName), record.markdown, 'utf8')
        exported += 1
      } catch {
        skipped += 1
      }
    }

    return { exported, skipped }
    }
  )

  ipcMain.handle('llm:export-summary', async (_event, jobId: string) => {
    const record = await loadKnowledgeSummary(jobId)
    if (!record) throw new Error('没有可导出的知识总结')

    const defaultPath = await buildDefaultSavePath(
      `${basename(record.fileName, extname(record.fileName))}-知识总结.md`
    )
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })

    if (result.canceled || !result.filePath) return
    await writeFile(result.filePath, record.markdown, 'utf8')
    await rememberExportPath(result.filePath)
  })

  ipcMain.handle(
    'llm:write-summary-image-files',
    async (
      _event,
      directory: string,
      files: Array<{ fileName: string; data: Uint8Array }>
    ): Promise<BatchExportResult> => {
      if (!directory?.trim()) throw new Error('导出目录无效')
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('没有可写入的知识总结图片')
      }

      const usedNames = new Set<string>()
      let exported = 0
      let skipped = 0

      for (const file of files) {
        const fileName = resolveUniqueFileName(usedNames, file.fileName)
        try {
          await writeFile(join(directory, fileName), Buffer.from(file.data))
          exported += 1
        } catch {
          skipped += 1
        }
      }

      await rememberExportDirectory(directory)
      return { exported, skipped }
    }
  )

  ipcMain.handle('llm:save-summary-image-from-clipboard', async (_event, jobId: string) => {
    const record = await loadKnowledgeSummary(jobId)
    if (!record) throw new Error('没有可导出的知识总结')

    const image = clipboard.readImage()
    if (image.isEmpty()) throw new Error('没有可保存的知识总结图片')

    const defaultPath = await buildDefaultSavePath(
      `${basename(record.fileName, extname(record.fileName))}-知识总结.png`
    )
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })

    if (result.canceled || !result.filePath) return
    await writeFile(result.filePath, image.toPNG())
    await rememberExportPath(result.filePath)
  })
}
