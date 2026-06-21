import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { llmApi } from '../lib/llmApi'
import { LlmModelPicker } from './LlmModelPicker'
import {
  detectLlmProviderId,
  getLlmProviderPreset,
  isBuiltinLlmProvider,
  LLM_CUSTOM_PROVIDER,
  LLM_PROVIDER_PRESETS,
  type LlmProviderId,
  type LlmProviderPreset
} from '../lib/llmProviders'

interface LlmSettingsPanelProps {
  onClose: () => void
  onSaved?: (config: LlmConfigPublic) => void
}

interface LlmFormState {
  enabled: boolean
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxTokens: number
}

const DEFAULT_FORM: LlmFormState = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  temperature: 0.3,
  maxTokens: 4096
}

function toFormState(config: LlmConfigPublic): LlmFormState {
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: '',
    temperature: config.temperature,
    maxTokens: config.maxTokens
  }
}

function pickPreferredModel(models: LlmModelInfo[], preferred?: string): string {
  if (models.length === 0) return ''
  if (preferred) {
    const matched = models.find((model) => model.id === preferred)
    if (matched) return matched.id
  }
  return models[0].id
}

function getReadinessLabel(
  loading: boolean,
  configured: boolean,
  enabled: boolean
): { title: string; detail: string; ready: boolean } {
  if (loading) {
    return { title: '加载中', detail: '正在读取本地配置', ready: false }
  }
  if (configured && enabled) {
    return { title: '已启用', detail: '可用于后续文字稿处理', ready: true }
  }
  if (configured) {
    return { title: '已配置', detail: '开启后即可用于文字稿处理', ready: false }
  }
  return { title: '未配置', detail: '选择供应商并完成连接设置', ready: false }
}

export function LlmSettingsPanel({
  onClose,
  onSaved
}: LlmSettingsPanelProps): React.JSX.Element {
  const [form, setForm] = useState<LlmFormState>(DEFAULT_FORM)
  const [savedConfig, setSavedConfig] = useState<LlmConfigPublic | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState('')
  const [statusOk, setStatusOk] = useState<boolean | null>(null)
  const [activeProviderId, setActiveProviderId] = useState<LlmProviderId>('custom')
  const [availableModels, setAvailableModels] = useState<LlmModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const formRef = useRef(form)
  const savedConfigRef = useRef(savedConfig)
  const modelsFetchSeqRef = useRef(0)

  useEffect(() => {
    formRef.current = form
  }, [form])

  useEffect(() => {
    savedConfigRef.current = savedConfig
  }, [savedConfig])

  useEffect(() => {
    document.body.classList.add('llm-settings-open')
    return () => document.body.classList.remove('llm-settings-open')
  }, [])

  useEffect(() => {
    let active = true
    void llmApi.getConfig().then((config) => {
      if (!active) return
      setSavedConfig(config)
      setForm(toFormState(config))
      setActiveProviderId(detectLlmProviderId(config.baseUrl))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const activePreset = useMemo(
    () => getLlmProviderPreset(activeProviderId),
    [activeProviderId]
  )

  const buildInput = useCallback((overrides?: Partial<LlmFormState>): LlmConfigInput => {
    const next = { ...formRef.current, ...overrides }
    return {
      enabled: next.enabled,
      baseUrl: next.baseUrl.trim(),
      model: next.model.trim(),
      temperature: next.temperature,
      maxTokens: next.maxTokens,
      ...(next.apiKey.trim() ? { apiKey: next.apiKey.trim() } : {})
    }
  }, [])

  const fetchProviderModels = useCallback(
    async (options?: {
      providerId?: LlmProviderId
      baseUrl?: string
      preferredModel?: string
      apiKey?: string
      quiet?: boolean
    }): Promise<void> => {
      const providerId = options?.providerId ?? activeProviderId
      if (!isBuiltinLlmProvider(providerId)) {
        setAvailableModels([])
        setModelsError('')
        setModelsLoading(false)
        return
      }

      const preset = getLlmProviderPreset(providerId)
      const currentForm = formRef.current
      const baseUrl = (options?.baseUrl ?? currentForm.baseUrl).trim()
      const apiKey = options?.apiKey ?? currentForm.apiKey
      const hasSavedKey = Boolean(savedConfigRef.current?.hasApiKey)
      const canFetch =
        !preset?.requiresApiKey || Boolean(apiKey.trim()) || hasSavedKey

      if (!canFetch) {
        setAvailableModels([])
        setModelsError('填写 API Key 后自动获取模型列表')
        setModelsLoading(false)
        return
      }

      const fetchSeq = ++modelsFetchSeqRef.current
      setModelsLoading(true)
      setModelsError('')
      try {
        const result = await llmApi.listModels(
          buildInput({
            baseUrl,
            apiKey,
            model: options?.preferredModel ?? currentForm.model
          })
        )

        if (fetchSeq !== modelsFetchSeqRef.current) return

        if (!result.ok) {
          setAvailableModels([])
          setModelsError(result.message)
          if (!options?.quiet) {
            setStatus(result.message)
            setStatusOk(false)
          }
          return
        }

        setAvailableModels(result.models)
        const nextModel = pickPreferredModel(
          result.models,
          options?.preferredModel ?? currentForm.model ?? preset?.model
        )
        if (nextModel) {
          setForm((current) =>
            current.model === nextModel ? current : { ...current, model: nextModel }
          )
        }
        if (!options?.quiet) {
          setStatus(result.message)
          setStatusOk(true)
        }
      } catch (error) {
        if (fetchSeq !== modelsFetchSeqRef.current) return
        const message = error instanceof Error ? error.message : '获取模型列表失败'
        setAvailableModels([])
        setModelsError(message)
        if (!options?.quiet) {
          setStatus(message)
          setStatusOk(false)
        }
      } finally {
        if (fetchSeq === modelsFetchSeqRef.current) {
          setModelsLoading(false)
        }
      }
    },
    [activeProviderId, buildInput]
  )

  useEffect(() => {
    if (loading || !isBuiltinLlmProvider(activeProviderId)) return

    const preset = getLlmProviderPreset(activeProviderId)
    const needsKey = Boolean(preset?.requiresApiKey)
    const hasTypedKey = form.apiKey.trim().length > 0
    const hasSavedKey = Boolean(savedConfig?.hasApiKey)
    if (needsKey && !hasTypedKey && !hasSavedKey) {
      setAvailableModels([])
      setModelsError('填写 API Key 后自动获取模型列表')
      setModelsLoading(false)
      return
    }

    const debounceMs = needsKey && hasTypedKey ? 500 : 0
    const timer = window.setTimeout(() => {
      void fetchProviderModels({ quiet: true })
    }, debounceMs)

    return () => window.clearTimeout(timer)
  }, [
    loading,
    activeProviderId,
    form.baseUrl,
    form.apiKey,
    savedConfig?.hasApiKey,
    fetchProviderModels
  ])

  const updateField = <K extends keyof LlmFormState>(key: K, value: LlmFormState[K]): void => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'baseUrl' && typeof value === 'string') {
        setActiveProviderId(detectLlmProviderId(value))
      }
      return next
    })
    setStatus('')
    setStatusOk(null)
  }

  const selectProvider = (providerId: LlmProviderId): void => {
    if (providerId === 'custom') {
      setActiveProviderId('custom')
      setAvailableModels([])
      setModelsError('')
      setStatus('')
      setStatusOk(null)
      return
    }

    const preset = LLM_PROVIDER_PRESETS.find((entry) => entry.id === providerId)
    if (!preset) return
    applyPreset(preset)
  }

  const applyPreset = (preset: LlmProviderPreset): void => {
    modelsFetchSeqRef.current += 1
    setActiveProviderId(preset.id)
    setAvailableModels([])
    setModelsError('')
    setForm((current) => ({
      ...current,
      baseUrl: preset.baseUrl,
      model: preset.model
    }))
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setStatus('')
    setStatusOk(null)
    try {
      const saved = await llmApi.saveConfig(buildInput())
      setSavedConfig(saved)
      setForm(toFormState(saved))
      setActiveProviderId(detectLlmProviderId(saved.baseUrl))
      setStatus('配置已保存')
      setStatusOk(true)
      onSaved?.(saved)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败')
      setStatusOk(false)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setStatus('')
    setStatusOk(null)
    try {
      const result = await llmApi.testConnection(buildInput())
      setStatus(result.message)
      setStatusOk(result.ok)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '连接测试失败')
      setStatusOk(false)
    } finally {
      setTesting(false)
    }
  }

  const configured =
    Boolean(savedConfig?.hasApiKey) &&
    Boolean(savedConfig?.baseUrl.trim()) &&
    Boolean(savedConfig?.model.trim())
  const readiness = getReadinessLabel(loading, configured, Boolean(form.enabled))
  const providerTitle =
    activeProviderId === 'custom'
      ? LLM_CUSTOM_PROVIDER.label
      : activePreset?.label || '模型供应商'
  const providerDescription =
    activeProviderId === 'custom'
      ? LLM_CUSTOM_PROVIDER.description
      : activePreset?.description || '配置 OpenAI 兼容接口'

  return (
    <div className="llm-settings-overlay" role="presentation" onClick={onClose}>
      <section
        className="llm-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="llm-settings-topbar">
          <div>
            <p className="eyebrow">Model Provider</p>
            <h2 id="llm-settings-title">大模型配置</h2>
          </div>
          <button type="button" className="llm-icon-button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        {loading ? (
          <div className="llm-settings-loading">正在读取本地配置…</div>
        ) : (
          <div className="llm-settings-body">
            <aside className="llm-provider-nav" aria-label="模型供应商">
              <p className="llm-nav-title">供应商</p>
              <div className="llm-provider-list">
                {LLM_PROVIDER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={
                      activeProviderId === preset.id
                        ? 'llm-provider-item active'
                        : 'llm-provider-item'
                    }
                    onClick={() => selectProvider(preset.id)}
                  >
                    <span className="llm-provider-mark">{preset.monogram}</span>
                    <span className="llm-provider-copy">
                      <strong>{preset.label}</strong>
                      <span>{preset.shortLabel}</span>
                    </span>
                    <span className={`llm-provider-tag ${preset.kind}`}>
                      {preset.kind === 'local' ? '本地' : '云端'}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  className={
                    activeProviderId === 'custom'
                      ? 'llm-provider-item active'
                      : 'llm-provider-item'
                  }
                  onClick={() => selectProvider('custom')}
                >
                  <span className="llm-provider-mark muted">{LLM_CUSTOM_PROVIDER.monogram}</span>
                  <span className="llm-provider-copy">
                    <strong>{LLM_CUSTOM_PROVIDER.label}</strong>
                    <span>{LLM_CUSTOM_PROVIDER.description}</span>
                  </span>
                </button>
              </div>
            </aside>

            <form
              className="llm-settings-main"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSave()
              }}
            >
              <div className="llm-settings-toolbar">
                <div className="llm-provider-heading">
                  <h3>{providerTitle}</h3>
                  <p>{providerDescription}</p>
                </div>
                <label className="llm-switch" aria-label="启用大模型处理">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => updateField('enabled', event.target.checked)}
                  />
                  <span className="llm-switch-track" />
                  <span className="llm-switch-label">启用</span>
                </label>
              </div>

              <div className={`llm-readiness ${readiness.ready ? 'ready' : ''}`}>
                <div className={`status-dot ${readiness.ready ? 'ready' : 'unknown'}`} />
                <div>
                  <strong>{readiness.title}</strong>
                  <span>
                    {savedConfig?.apiKeyPreview
                      ? `${readiness.detail} · Key ${savedConfig.apiKeyPreview}`
                      : readiness.detail}
                  </span>
                </div>
              </div>

              <section className="llm-section">
                <div className="llm-section-head">
                  <h4>连接</h4>
                  {activePreset?.docsUrl ? (
                    <a
                      className="llm-text-button"
                      href={activePreset.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      获取 Key
                    </a>
                  ) : null}
                </div>

                <label className="llm-field">
                  <span className="llm-field-label">API 地址</span>
                  <input
                    className="llm-input"
                    placeholder="https://api.openai.com/v1"
                    value={form.baseUrl}
                    readOnly={isBuiltinLlmProvider(activeProviderId)}
                    onChange={(event) => updateField('baseUrl', event.target.value)}
                  />
                </label>

                <label className="llm-field">
                  <span className="llm-field-label">
                    API Key
                    {activePreset && !activePreset.requiresApiKey ? '（可选）' : ''}
                  </span>
                  <div className="llm-input-group">
                    <input
                      className="llm-input"
                      type={showApiKey ? 'text' : 'password'}
                      autoComplete="off"
                      placeholder={
                        activePreset && !activePreset.requiresApiKey
                          ? '本地服务通常无需填写'
                          : savedConfig?.hasApiKey
                            ? '留空则保留现有 Key'
                            : 'sk-...'
                      }
                      value={form.apiKey}
                      onChange={(event) => updateField('apiKey', event.target.value)}
                    />
                    <button
                      type="button"
                      className="llm-input-addon"
                      onClick={() => setShowApiKey((current) => !current)}
                    >
                      {showApiKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                  {activePreset?.apiKeyHint ? (
                    <span className="llm-field-hint">{activePreset.apiKeyHint}</span>
                  ) : null}
                </label>
              </section>

              <section className="llm-section">
                <div className="llm-section-head">
                  <h4>模型</h4>
                </div>

                <LlmModelPicker
                  mode={isBuiltinLlmProvider(activeProviderId) ? 'builtin' : 'custom'}
                  model={form.model}
                  models={availableModels}
                  loading={modelsLoading}
                  error={modelsError}
                  placeholder={activePreset?.model || 'gpt-4o-mini'}
                  hint={activePreset?.modelHint}
                  onModelChange={(value) => updateField('model', value)}
                  onRefresh={() => void fetchProviderModels({ preferredModel: form.model })}
                />
              </section>

              <section className="llm-section llm-section-collapsible">
                <button
                  type="button"
                  className="llm-section-toggle"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((current) => !current)}
                >
                  <h4>高级参数</h4>
                  <span>{advancedOpen ? '收起' : '展开'}</span>
                </button>

                {advancedOpen ? (
                  <div className="llm-advanced-grid">
                    <label className="llm-field">
                      <span className="llm-field-label">温度 {form.temperature.toFixed(1)}</span>
                      <input
                        className="llm-range"
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={form.temperature}
                        onChange={(event) =>
                          updateField('temperature', Number(event.target.value))
                        }
                      />
                      <span className="llm-field-hint">越低越稳定，越高越发散</span>
                    </label>

                    <label className="llm-field">
                      <span className="llm-field-label">最大输出 Token</span>
                      <input
                        className="llm-input"
                        type="number"
                        min={256}
                        max={128000}
                        step={256}
                        value={form.maxTokens}
                        onChange={(event) => updateField('maxTokens', Number(event.target.value))}
                      />
                    </label>
                  </div>
                ) : null}
              </section>

              {status ? (
                <p
                  className={
                    statusOk
                      ? 'llm-status-banner ok'
                      : statusOk === false
                        ? 'llm-status-banner error'
                        : 'llm-status-banner'
                  }
                >
                  {status}
                </p>
              ) : null}

              <footer className="llm-settings-footer">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={testing || saving}
                  onClick={() => void handleTest()}
                >
                  {testing ? '测试中…' : '测试连接'}
                </button>
                <button type="submit" className="primary-button" disabled={saving || testing}>
                  {saving ? '保存中…' : '保存配置'}
                </button>
              </footer>
            </form>
          </div>
        )}
      </section>
    </div>
  )
}