import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence } from '@langchain/core/runnables'
import { createChatModel } from '../client'
import { getCleanSystemPrompt, type CourseType } from '../prompts/courseTemplates'

export async function runTranscriptClean(
  transcript: string,
  courseType: CourseType,
  signal?: AbortSignal
): Promise<string> {
  const model = await createChatModel({ temperature: 0.1, maxTokens: 4096 })
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', getCleanSystemPrompt(courseType)],
    ['user', '文字稿（含时间戳）：\n{transcript}']
  ])
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])
  const result = await chain.invoke({ transcript }, { signal })
  const trimmed = result.trim()
  if (!trimmed) {
    throw new Error('净化阶段返回了空内容')
  }
  return trimmed
}