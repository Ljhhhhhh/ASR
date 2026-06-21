import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence } from '@langchain/core/runnables'
import { createChatModel } from '../client'
import {
  getBusinessMigrationSystemPrompt,
  getCourseExtractionSystemPrompt,
  getLearningTrainingSystemPrompt,
  type CourseType
} from '../prompts/courseTemplates'

interface StreamCallbacks {
  onDelta: (delta: string) => void
  signal?: AbortSignal
}

async function runStreamingStage(
  systemPrompt: string,
  userPrompt: string,
  input: Record<string, string>,
  options: {
    temperature: number
    maxTokens: number
    emptyMessage: string
  },
  callbacks: StreamCallbacks
): Promise<string> {
  const model = await createChatModel({
    temperature: options.temperature,
    maxTokens: options.maxTokens
  })
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    ['user', userPrompt]
  ])
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  let markdown = ''
  const stream = await chain.stream(input, { signal: callbacks.signal })

  for await (const chunk of stream) {
    if (callbacks.signal?.aborted) {
      throw new Error('已取消生成')
    }
    const delta = typeof chunk === 'string' ? chunk : String(chunk)
    if (!delta) continue
    markdown += delta
    callbacks.onDelta(delta)
  }

  const trimmed = markdown.trim()
  if (!trimmed) {
    throw new Error(options.emptyMessage)
  }
  return trimmed
}

export function buildKnowledgeSummaryMarkdown(
  fileName: string,
  extraction: string,
  training: string,
  migration: string
): string {
  return [
    `# 知识总结：${fileName}`,
    '',
    '## 阶段一：课程清洗与核心提炼',
    '',
    extraction.trim(),
    '',
    '## 阶段二：学习训练设计',
    '',
    training.trim(),
    '',
    '## 阶段三：业务迁移与最终成品',
    '',
    migration.trim()
  ].join('\n')
}

export async function runCourseExtraction(
  transcript: string,
  courseType: CourseType,
  callbacks: StreamCallbacks
): Promise<string> {
  return runStreamingStage(
    getCourseExtractionSystemPrompt(courseType),
    '课程文字稿（含时间戳）：\n{transcript}',
    { transcript },
    {
      temperature: 0.1,
      maxTokens: 8192,
      emptyMessage: '课程清洗与核心提炼阶段返回了空内容'
    },
    callbacks
  )
}

export async function runLearningTraining(
  extractedContent: string,
  courseType: CourseType,
  callbacks: StreamCallbacks
): Promise<string> {
  return runStreamingStage(
    getLearningTrainingSystemPrompt(courseType),
    '已经清洗和提炼过的课程内容：\n{extractedContent}',
    { extractedContent },
    {
      temperature: 0.2,
      maxTokens: 8192,
      emptyMessage: '学习训练阶段返回了空内容'
    },
    callbacks
  )
}

export async function runBusinessMigration(
  extractedContent: string,
  trainingContent: string,
  courseType: CourseType,
  callbacks: StreamCallbacks
): Promise<string> {
  return runStreamingStage(
    getBusinessMigrationSystemPrompt(courseType),
    '课程清洗与核心提炼结果：\n{extractedContent}\n\n学习训练结果：\n{trainingContent}',
    { extractedContent, trainingContent },
    {
      temperature: 0.25,
      maxTokens: 8192,
      emptyMessage: '业务迁移阶段返回了空内容'
    },
    callbacks
  )
}
