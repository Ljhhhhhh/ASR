import { preFilterSegments } from '../transcriptPreprocess'
import { segmentsToPlainText, type TranscriptSegment } from '../transcript'
import { normalizeCourseType, type CourseType } from '../prompts/courseTemplates'
import {
  buildKnowledgeSummaryMarkdown,
  runBusinessMigration,
  runCourseExtraction,
  runLearningTraining
} from './courseStages'
import { repairMermaidInMarkdown } from './mermaidRepair'

export type SummaryStage = 'extract' | 'train' | 'migrate' | 'repair'

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
    message: '正在清洗课程并提炼核心…'
  })
  emitMarkdown(
    onProgress,
    jobId,
    'extract',
    `# 知识总结：${fileName}\n\n## 阶段一：课程清洗与核心提炼\n\n`
  )

  const extraction = await runCourseExtraction(rawTranscript, courseType, {
    signal,
    onDelta: (delta) => emitMarkdown(onProgress, jobId, 'extract', delta)
  })

  onProgress({
    jobId,
    stage: 'extract',
    progress: 100,
    message: '课程清洗与核心提炼完成'
  })

  throwIfAborted(signal)
  onProgress({
    jobId,
    stage: 'train',
    progress: 0,
    message: '正在生成学习训练…'
  })
  emitMarkdown(onProgress, jobId, 'train', '\n\n## 阶段二：学习训练设计\n\n')

  const training = await runLearningTraining(extraction, courseType, {
    signal,
    onDelta: (delta) => emitMarkdown(onProgress, jobId, 'train', delta)
  })

  onProgress({
    jobId,
    stage: 'train',
    progress: 100,
    message: '学习训练生成完成'
  })

  throwIfAborted(signal)
  onProgress({
    jobId,
    stage: 'migrate',
    progress: 0,
    message: '正在生成业务迁移成品…'
  })
  emitMarkdown(onProgress, jobId, 'migrate', '\n\n## 阶段三：业务迁移与最终成品\n\n')

  const migration = await runBusinessMigration(extraction, training, courseType, {
    signal,
    onDelta: (delta) => emitMarkdown(onProgress, jobId, 'migrate', delta)
  })

  onProgress({
    jobId,
    stage: 'migrate',
    progress: 100,
    message: '业务迁移成品生成完成'
  })

  let markdown = buildKnowledgeSummaryMarkdown(fileName, extraction, training, migration)

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
