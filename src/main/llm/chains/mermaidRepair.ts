import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence } from '@langchain/core/runnables'
import { createChatModel } from '../client'
import { getMermaidRepairSystemPrompt } from '../prompts/courseTemplates'

const MERMAID_BLOCK_RE = /```mermaid\s*([\s\S]*?)```/gi

function looksBrokenMermaid(code: string): boolean {
  const trimmed = code.trim()
  if (!trimmed) return true
  if (/mindmap/i.test(trimmed)) return true
  if (!/flowchart\s+(LR|TD|TB|RL)/i.test(trimmed)) return true
  if ((trimmed.match(/-->/g) || []).length > 12) return true
  return false
}

export function extractMermaidBlocks(markdown: string): Array<{ full: string; code: string }> {
  const blocks: Array<{ full: string; code: string }> = []
  for (const match of markdown.matchAll(MERMAID_BLOCK_RE)) {
    const full = match[0]
    const code = match[1]?.trim() || ''
    if (full) blocks.push({ full, code })
  }
  return blocks
}

async function repairMermaidBlock(code: string, signal?: AbortSignal): Promise<string> {
  const model = await createChatModel({ temperature: 0.1, maxTokens: 1024 })
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', getMermaidRepairSystemPrompt()],
    ['user', '修复以下 mermaid 代码：\n{code}']
  ])
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])
  const result = await chain.invoke({ code }, { signal })
  return result.trim()
}

export async function repairMermaidInMarkdown(
  markdown: string,
  signal?: AbortSignal
): Promise<string> {
  const blocks = extractMermaidBlocks(markdown)
  if (blocks.length === 0) return markdown

  let next = markdown
  for (const block of blocks) {
    if (!looksBrokenMermaid(block.code)) continue
    try {
      const fixed = await repairMermaidBlock(block.code, signal)
      if (!fixed) continue
      const replacement = `\`\`\`mermaid\n${fixed}\n\`\`\``
      next = next.replace(block.full, replacement)
    } catch {
      // keep original block on repair failure
    }
  }
  return next
}