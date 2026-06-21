import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence } from '@langchain/core/runnables'
import { createChatModel } from '../client'
import { getComposeSystemPrompt, type CourseType } from '../prompts/courseTemplates'

export interface ComposeStreamCallbacks {
  onDelta: (delta: string) => void
  signal?: AbortSignal
}

export async function runKnowledgeCompose(
  fileName: string,
  notes: string,
  courseType: CourseType,
  callbacks: ComposeStreamCallbacks
): Promise<string> {
  const model = await createChatModel({ temperature: 0.25, maxTokens: 8192 })
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', getComposeSystemPrompt(courseType)],
    ['user', '来源文件：{fileName}\n\n课程精华稿：\n{notes}']
  ])
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  let markdown = ''
  const stream = await chain.stream({ fileName, notes }, { signal: callbacks.signal })

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
    throw new Error('成稿阶段返回了空内容')
  }
  return trimmed
}
