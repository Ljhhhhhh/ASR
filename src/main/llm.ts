import { BrowserWindow, ipcMain } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getAsrDataDir } from './asrDataDir'

const LLM_CONFIG_VERSION = 1
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_TEMPERATURE = 0.3
const DEFAULT_MAX_TOKENS = 8192
const REQUEST_TIMEOUT_MS = 30_000

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmConfig {
  version: number
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  updatedAt: string
}

export interface LlmConfigPublic {
  enabled: boolean
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  hasApiKey: boolean
  apiKeyPreview?: string
  updatedAt?: string
}

export interface LlmConfigInput {
  enabled: boolean
  baseUrl: string
  model: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

export interface LlmTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

export interface LlmModelInfo {
  id: string
  label?: string
}

export interface LlmListModelsResult {
  ok: boolean
  message: string
  models: LlmModelInfo[]
}

let cachedConfig: LlmConfig | undefined

function getLlmConfigPath(): string {
  return join(getAsrDataDir(), 'llm-config.json')
}

function defaultConfig(): LlmConfig {
  const now = new Date().toISOString()
  return {
    version: LLM_CONFIG_VERSION,
    enabled: false,
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: DEFAULT_MODEL,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    updatedAt: now
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '')
}

function isLocalLlmBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(normalizeBaseUrl(baseUrl))
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  } catch {
    return false
  }
}

function buildLlmHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

function requiresLlmApiKey(baseUrl: string): boolean {
  return !isLocalLlmBaseUrl(baseUrl)
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function maskApiKey(apiKey: string): { hasApiKey: boolean; apiKeyPreview?: string } {
  const trimmed = apiKey.trim()
  if (!trimmed) return { hasApiKey: false }
  const preview = trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`
  return { hasApiKey: true, apiKeyPreview: preview }
}

function toPublicConfig(config: LlmConfig): LlmConfigPublic {
  const masked = maskApiKey(config.apiKey)
  const local = isLocalLlmBaseUrl(config.baseUrl)
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    updatedAt: config.updatedAt,
    hasApiKey: local || masked.hasApiKey,
    apiKeyPreview: masked.apiKeyPreview
  }
}

function normalizeStoredConfig(raw: Partial<LlmConfig>): LlmConfig {
  const defaults = defaultConfig()
  return {
    version: LLM_CONFIG_VERSION,
    enabled: Boolean(raw.enabled),
    baseUrl: normalizeBaseUrl(raw.baseUrl || defaults.baseUrl) || defaults.baseUrl,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    model: (raw.model || defaults.model).trim() || defaults.model,
    temperature: clampNumber(Number(raw.temperature), 0, 2, defaults.temperature),
    maxTokens: clampNumber(Number(raw.maxTokens), 256, 128_000, defaults.maxTokens),
    updatedAt: raw.updatedAt || defaults.updatedAt
  }
}

export async function loadLlmConfig(): Promise<LlmConfig> {
  if (cachedConfig) return cachedConfig

  try {
    const raw = await readFile(getLlmConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LlmConfig>
    cachedConfig = normalizeStoredConfig(parsed)
    return cachedConfig
  } catch {
    cachedConfig = defaultConfig()
    return cachedConfig
  }
}

async function persistLlmConfig(config: LlmConfig): Promise<void> {
  cachedConfig = config
  const configPath = getLlmConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`
}

function buildModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  return normalized.endsWith('/models') ? normalized : `${normalized}/models`
}

function isLikelyChatModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  const excluded = [
    'embed',
    'rerank',
    'image',
    'flux',
    'kolors',
    'speech',
    'whisper',
    'tts',
    'ocr',
    'video',
    'audio',
    'sdxl',
    'stable-diffusion'
  ]
  return !excluded.some((term) => lower.includes(term))
}

function normalizeModelList(payload: unknown): LlmModelInfo[] {
  if (!payload || typeof payload !== 'object') return []

  const record = payload as {
    data?: unknown
    models?: unknown
  }
  const rawList = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : []

  const models: LlmModelInfo[] = []
  const seen = new Set<string>()

  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as { id?: unknown; name?: unknown; model?: unknown }
    const idSource = candidate.id ?? candidate.model ?? candidate.name
    if (typeof idSource !== 'string') continue
    const id = idSource.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      label: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : id
    })
  }

  const chatModels = models.filter((model) => isLikelyChatModel(model.id))
  const nextModels = chatModels.length > 0 ? chatModels : models
  return nextModels.sort((left, right) => left.id.localeCompare(right.id))
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function getLlmConfigPublic(): Promise<LlmConfigPublic> {
  const config = await loadLlmConfig()
  return toPublicConfig(config)
}

export async function saveLlmConfig(input: LlmConfigInput): Promise<LlmConfigPublic> {
  const current = await loadLlmConfig()
  const nextApiKey =
    typeof input.apiKey === 'string' && input.apiKey.trim().length > 0
      ? input.apiKey.trim()
      : current.apiKey

  const next: LlmConfig = {
    version: LLM_CONFIG_VERSION,
    enabled: Boolean(input.enabled),
    baseUrl:
      normalizeBaseUrl(input.baseUrl || current.baseUrl) || defaultConfig().baseUrl,
    apiKey: nextApiKey,
    model: (input.model || current.model).trim() || defaultConfig().model,
    temperature: clampNumber(
      input.temperature ?? current.temperature,
      0,
      2,
      DEFAULT_TEMPERATURE
    ),
    maxTokens: clampNumber(
      input.maxTokens ?? current.maxTokens,
      256,
      128_000,
      DEFAULT_MAX_TOKENS
    ),
    updatedAt: new Date().toISOString()
  }

  await persistLlmConfig(next)
  return toPublicConfig(next)
}

export async function listLlmModels(
  override?: Partial<LlmConfigInput>
): Promise<LlmListModelsResult> {
  const stored = await loadLlmConfig()
  const baseUrl = normalizeBaseUrl(override?.baseUrl || stored.baseUrl)
  const apiKey =
    typeof override?.apiKey === 'string' && override.apiKey.trim().length > 0
      ? override.apiKey.trim()
      : stored.apiKey

  if (!baseUrl) {
    return { ok: false, message: '请填写 API 地址', models: [] }
  }
  if (!apiKey && requiresLlmApiKey(baseUrl)) {
    return { ok: false, message: '请先填写 API Key 以获取模型列表', models: [] }
  }

  try {
    const response = await fetchWithTimeout(buildModelsUrl(baseUrl), {
      method: 'GET',
      headers: buildLlmHeaders(apiKey)
    })

    if (!response.ok) {
      const detail = await readErrorDetail(response)
      return {
        ok: false,
        message: `获取模型失败（${response.status}）${detail ? `：${detail}` : ''}`,
        models: []
      }
    }

    const payload = await response.json()
    const models = normalizeModelList(payload)
    if (models.length === 0) {
      return { ok: false, message: '供应商未返回可用模型', models: [] }
    }

    return {
      ok: true,
      message: `已获取 ${models.length} 个模型`,
      models
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '获取模型列表失败',
      models: []
    }
  }
}

export async function testLlmConnection(
  override?: Partial<LlmConfigInput>
): Promise<LlmTestResult> {
  const stored = await loadLlmConfig()
  const baseUrl = normalizeBaseUrl(override?.baseUrl || stored.baseUrl)
  const model = (override?.model || stored.model).trim()
  const apiKey =
    typeof override?.apiKey === 'string' && override.apiKey.trim().length > 0
      ? override.apiKey.trim()
      : stored.apiKey

  if (!baseUrl) {
    return { ok: false, message: '请填写 API 地址' }
  }
  if (!apiKey && requiresLlmApiKey(baseUrl)) {
    return { ok: false, message: '请填写 API Key' }
  }
  if (!model) {
    return { ok: false, message: '请填写模型名称' }
  }

  const startedAt = Date.now()
  try {
    const response = await fetchWithTimeout(buildChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: buildLlmHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 8,
        temperature: 0
      })
    })

    const latencyMs = Date.now() - startedAt
    if (!response.ok) {
      const detail = await readErrorDetail(response)
      return {
        ok: false,
        message: `连接失败（${response.status}）${detail ? `：${detail}` : ''}`,
        latencyMs
      }
    }

    return {
      ok: true,
      message: `连接成功，延迟 ${latencyMs} ms`,
      latencyMs
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '连接测试失败'
    }
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string }
      message?: string
    }
    return payload.error?.message || payload.message || ''
  } catch {
    try {
      const text = await response.text()
      return text.slice(0, 180)
    } catch {
      return ''
    }
  }
}

export async function callLlmChat(
  messages: LlmMessage[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
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
  if (messages.length === 0) {
    throw new Error('消息不能为空')
  }

  const response = await fetchWithTimeout(buildChatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers: buildLlmHeaders(config.apiKey),
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options?.temperature ?? config.temperature,
      max_tokens: options?.maxTokens ?? config.maxTokens
    })
  })

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new Error(detail || `大模型请求失败（${response.status}）`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('大模型返回了空内容')
  }
  return content
}

export async function registerLlmHandlers(mainWindow: BrowserWindow): Promise<void> {
  const { registerSummaryHandlers } = await import('./llm/summaryHandlers')
  registerSummaryHandlers(mainWindow)
  ipcMain.handle('llm:get-config', async () => getLlmConfigPublic())

  ipcMain.handle('llm:save-config', async (_event, input: LlmConfigInput) =>
    saveLlmConfig(input)
  )

  ipcMain.handle('llm:test-connection', async (_event, override?: Partial<LlmConfigInput>) =>
    testLlmConnection(override)
  )

  ipcMain.handle('llm:list-models', async (_event, override?: Partial<LlmConfigInput>) =>
    listLlmModels(override)
  )
}
