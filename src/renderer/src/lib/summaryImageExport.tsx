import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Md2Poster,
  Md2PosterContent,
  Md2PosterFooter,
  Md2PosterHeader
} from 'markdown-to-image'
import { llmApi } from './llmApi'

interface Md2PosterHandle {
  handleCopy: () => Promise<unknown>
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function stripExtension(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
}

export async function renderSummaryImageBlob(markdown: string, title: string): Promise<Blob> {
  const host = document.createElement('div')
  host.className = 'summary-image-export-host'
  document.body.append(host)

  const posterRef = createRef<Md2PosterHandle>()
  const root = createRoot(host)

  try {
    await import('markdown-to-image/dist/style.css')
    root.render(
      <Md2Poster ref={posterRef} theme="gray" size="desktop" aspectRatio="auto">
        <Md2PosterHeader className="summary-image-export-header">{title}</Md2PosterHeader>
        <Md2PosterContent>{markdown}</Md2PosterContent>
        <Md2PosterFooter className="summary-image-export-footer">
          知识总结
        </Md2PosterFooter>
      </Md2Poster>
    )
    await waitForPaint()
    if (!posterRef.current) throw new Error('知识总结图片渲染失败')
    const blob = await posterRef.current.handleCopy()
    if (!(blob instanceof Blob)) throw new Error('知识总结图片渲染失败')
    return blob
  } finally {
    root.unmount()
    host.remove()
  }
}

export async function copySummaryImageToClipboard(
  markdown: string,
  title: string
): Promise<void> {
  await renderSummaryImageBlob(markdown, title)
}

interface SummaryImageExportJob {
  id: string
  fileName: string
}

export async function exportSummaryImagesBatch(
  jobs: SummaryImageExportJob[]
): Promise<BatchExportResult> {
  if (jobs.length === 0) {
    throw new Error('所选任务中没有可导出的知识总结')
  }

  const directoryResult = await window.api.asr.selectExportDirectory()
  if (directoryResult.canceled || !directoryResult.directory) {
    return { exported: 0, skipped: 0, canceled: true }
  }

  const files: Array<{ fileName: string; data: Uint8Array }> = []
  let skipped = 0

  for (const job of jobs) {
    try {
      const summary = await llmApi.getSummary(job.id)
      const markdown = summary?.record.markdown.trim()
      if (!markdown) {
        skipped += 1
        continue
      }

      const blob = await renderSummaryImageBlob(markdown, job.fileName)
      const baseName = stripExtension(job.fileName)
      files.push({
        fileName: `${baseName}-知识总结.png`,
        data: new Uint8Array(await blob.arrayBuffer())
      })
    } catch {
      skipped += 1
    }
  }

  if (files.length === 0) {
    throw new Error('所选任务中没有可导出的知识总结')
  }

  const result = await llmApi.writeSummaryImageFiles(directoryResult.directory, files)
  return {
    exported: result.exported,
    skipped: skipped + result.skipped
  }
}
