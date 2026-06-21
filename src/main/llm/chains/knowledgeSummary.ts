import { preFilterSegments } from '../transcriptPreprocess'
import { segmentsToPlainText, type TranscriptSegment } from '../transcript'
import { normalizeCourseType, type CourseType } from '../prompts/courseTemplates'
import { runTranscriptClean } from './transcriptClean'
import { runKnowledgeCompose } from './knowledgeCompose'
import { repairMermaidInMarkdown } from './mermaidRepair'

export type SummaryStage = 'clean' | 'compose' | 'repair'

export interface SummaryProgressEvent {
  jobId: string
  stage: SummaryStage
  progress?: number
  delta?: string
  message?: string
}

export interface RunKnowledgeSummaryOptions {
  jobId: string
  fileName: string
  segments: TranscriptSegment[]
  courseType?: CourseType
  signal?: AbortSignal
  onProgress: (event: SummaryProgressEvent) => void
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('已取消生成')
  }
}

export async function runKnowledgeSummaryChain(
  options: RunKnowledgeSummaryOptions
): Promise<string> {
  const { jobId, fileName, segments, signal, onProgress } = options
  const courseType = normalizeCourseType(options.courseType)

  const filtered = preFilterSegments(segments)
  if (filtered.length === 0) {
    throw new Error('文字稿为空，无法生成知识总结')
  }

  throwIfAborted(signal)

  const rawTranscript = segmentsToPlainText(filtered, true)

  onProgress({
    jobId,
    stage: 'clean',
    progress: 0,
    message: '正在净化课堂口播…'
  })

  const cleanedText = await runTranscriptClean(rawTranscript, courseType, signal)

  onProgress({
    jobId,
    stage: 'clean',
    progress: 100,
    message: '口播净化完成'
  })

  throwIfAborted(signal)
  onProgress({
    jobId,
    stage: 'compose',
    progress: 0,
    message: '正在撰写学习笔记…'
  })

  let markdown = await runKnowledgeCompose(fileName, cleanedText, courseType, {
    signal,
    onDelta: (delta) => {
      onProgress({ jobId, stage: 'compose', delta })
    }
  })

  throwIfAborted(signal)
  onProgress({
    jobId,
    stage: 'repair',
    progress: 0,
    message: '正在检查 Mermaid 图表…'
  })

  markdown = await repairMermaidInMarkdown(markdown, signal)

  onProgress({
    jobId,
    stage: 'repair',
    progress: 100,
    message: '生成完成'
  })

  return markdown.trim()
}
