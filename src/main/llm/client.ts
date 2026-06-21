import { ChatOpenAI } from '@langchain/openai'
import { loadLlmConfig, type LlmConfig } from '../llm'

function isLocalLlmBaseUrl(baseUrl: string): boolean {
  try {
    const normalized = baseUrl.trim().replace(/\/$/, '')
    const url = new URL(normalized)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  } catch {
    return false
  }
}

function requiresLlmApiKey(baseUrl: string): boolean {
  return !isLocalLlmBaseUrl(baseUrl)
}

export async function assertLlmReady(): Promise<LlmConfig> {
  const config = await loadLlmConfig()
  if (!config.enabled) {
    throw new Error('大模型处理未启用，请先在设置中开启')
  }
  if (!config.apiKey && requiresLlmApiKey(config.baseUrl)) {
    throw new Error('未配置 API Key')
  }
  if (!config.baseUrl || !config.model) {
    throw new Error('大模型配置不完整')
  }
  return config
}

export async function createChatModel(options?: {
  temperature?: number
  maxTokens?: number
}): Promise<ChatOpenAI> {
  const config = await assertLlmReady()
  return new ChatOpenAI({
    model: config.model,
    temperature: options?.temperature ?? config.temperature,
    maxTokens: options?.maxTokens ?? config.maxTokens,
    apiKey: config.apiKey || 'not-needed',
    configuration: {
      baseURL: config.baseUrl
    },
    timeout: 120_000
  })
}