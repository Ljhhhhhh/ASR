import { preFilterSegments } from '../transcriptPreprocess'
import { segmentsToPlainText, type TranscriptSegment } from '../transcript'
import { normalizeCourseType, type CourseType } from '../prompts/courseTemplates'
import {
  buildKnowledgeSummaryMarkdown,
  runCourseFinalProduct,
  runCourseExtraction
} from './courseStages'
import { repairMermaidInMarkdown } from './mermaidRepair'

export type SummaryStage = 'extract' | 'migrate' | 'repair'

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

function emitMarkdown(
  onProgress: RunKnowledgeSummaryOptions['onProgress'],
  jobId: string,
  stage: SummaryStage,
  delta: string
): void {
  onProgress({ jobId, stage, delta })
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
    stage: 'extract',
    progress: 0,
    message: '正在生成课程知识总结…'
  })
  emitMarkdown(
    onProgress,
    jobId,
    'extract',
    `# 知识总结：${fileName}\n\n## 阶段一：课程知识总结\n\n`
  )

  const extraction = await runCourseExtraction(rawTranscript, courseType, {
    signal,
    onDelta: (delta) => emitMarkdown(onProgress, jobId, 'extract', delta)
  })

  onProgress({
    jobId,
    stage: 'extract',
    progress: 100,
    message: '课程知识总结生成完成'
  })

  throwIfAborted(signal)
  onProgress({
    jobId,
    stage: 'migrate',
    progress: 0,
    message: '正在生成课程知识成品…'
  })
  emitMarkdown(onProgress, jobId, 'migrate', '\n\n## 阶段二：课程知识成品生成\n\n')

  const finalProduct = await runCourseFinalProduct(extraction, courseType, {
    signal,
    onDelta: (delta) => emitMarkdown(onProgress, jobId, 'migrate', delta)
  })

  onProgress({
    jobId,
    stage: 'migrate',
    progress: 100,
    message: '课程知识成品生成完成'
  })

  let markdown = buildKnowledgeSummaryMarkdown(fileName, extraction, finalProduct)

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
