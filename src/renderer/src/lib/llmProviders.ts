export type LlmProviderId = 'siliconflow' | 'deepseek' | 'openrouter' | 'lmstudio' | 'custom'
export type LlmProviderKind = 'cloud' | 'local'

export interface LlmProviderPreset {
  id: Exclude<LlmProviderId, 'custom'>
  label: string
  shortLabel: string
  monogram: string
  kind: LlmProviderKind
  description: string
  baseUrl: string
  model: string
  requiresApiKey: boolean
  apiKeyHint?: string
  modelHint?: string
  docsUrl?: string
}

export const LLM_CUSTOM_PROVIDER = {
  id: 'custom' as const,
  label: '自定义',
  shortLabel: '自定义',
  monogram: '···',
  kind: 'cloud' as const,
  description: '任意 OpenAI 兼容端点'
}

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    id: 'siliconflow',
    label: '硅基流动',
    shortLabel: 'SiliconFlow',
    monogram: 'SF',
    kind: 'cloud',
    description: 'SiliconFlow 云端 API',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    requiresApiKey: true,
    apiKeyHint: '在 cloud.siliconflow.cn 控制台创建 API Key',
    docsUrl: 'https://cloud.siliconflow.cn'
  },
  {
    id: 'deepseek',
    label: '深度求索',
    shortLabel: 'DeepSeek',
    monogram: 'DS',
    kind: 'cloud',
    description: 'DeepSeek 官方 API',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    requiresApiKey: true,
    apiKeyHint: '在 platform.deepseek.com 获取 API Key',
    docsUrl: 'https://platform.deepseek.com'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    monogram: 'OR',
    kind: 'cloud',
    description: '多模型聚合 API',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    requiresApiKey: true,
    apiKeyHint: '在 openrouter.ai/keys 获取 API Key',
    docsUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    shortLabel: 'LM Studio',
    monogram: 'LM',
    kind: 'local',
    description: '本地 OpenAI 兼容服务',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: '',
    requiresApiKey: false,
    modelHint: '使用 LM Studio 本地服务中已加载的模型 ID',
    apiKeyHint: '本地服务通常无需 API Key',
    docsUrl: 'https://lmstudio.ai/docs'
  }
]

export function isLocalLlmBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim().replace(/\/$/, ''))
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  } catch {
    return false
  }
}

export function detectLlmProviderId(baseUrl: string): LlmProviderId {
  const normalized = baseUrl.trim().replace(/\/$/, '')
  const matched = LLM_PROVIDER_PRESETS.find((preset) => preset.baseUrl === normalized)
  return matched?.id || 'custom'
}

export function getLlmProviderPreset(id: LlmProviderId): LlmProviderPreset | undefined {
  if (id === 'custom') return undefined
  return LLM_PROVIDER_PRESETS.find((preset) => preset.id === id)
}

export function isBuiltinLlmProvider(id: LlmProviderId): boolean {
  return id !== 'custom'
}