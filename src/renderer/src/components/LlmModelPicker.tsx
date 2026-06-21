import { useMemo, useState } from 'react'

interface LlmModelPickerProps {
  mode: 'builtin' | 'custom'
  model: string
  models: LlmModelInfo[]
  loading: boolean
  error: string
  placeholder?: string
  hint?: string
  onModelChange: (model: string) => void
  onRefresh: () => void
}

export function LlmModelPicker({
  mode,
  model,
  models,
  loading,
  error,
  placeholder,
  hint,
  onModelChange,
  onRefresh
}: LlmModelPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')

  const filteredModels = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return models
    return models.filter((entry) => {
      const label = (entry.label || entry.id).toLowerCase()
      return label.includes(keyword) || entry.id.toLowerCase().includes(keyword)
    })
  }, [models, query])

  if (mode === 'custom') {
    return (
      <label className="llm-field">
        <span className="llm-field-label">模型 ID</span>
        <input
          className="llm-input"
          placeholder={placeholder || 'gpt-4o-mini'}
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
        />
        {hint ? <span className="llm-field-hint">{hint}</span> : null}
      </label>
    )
  }

  return (
    <div className="llm-model-picker">
      <div className="llm-field-header">
        <span className="llm-field-label">模型</span>
        <div className="llm-field-actions">
          <span className="llm-model-count">
            {loading ? '加载中…' : models.length > 0 ? `共 ${models.length} 个` : '暂无列表'}
          </span>
          <button type="button" className="llm-text-button" disabled={loading} onClick={onRefresh}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      <input
        className="llm-input"
        placeholder="搜索模型名称或 ID"
        value={query}
        disabled={loading || models.length === 0}
        onChange={(event) => setQuery(event.target.value)}
      />

      <select
        className="llm-input llm-select"
        value={model}
        disabled={loading || filteredModels.length === 0}
        onChange={(event) => onModelChange(event.target.value)}
      >
        {loading ? (
          <option value="">正在从供应商获取模型…</option>
        ) : filteredModels.length === 0 ? (
          <option value="">{error || '填写 API Key 后刷新模型列表'}</option>
        ) : (
          filteredModels.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label || entry.id}
            </option>
          ))
        )}
      </select>

      {error ? <span className="llm-field-hint error">{error}</span> : null}
      {!error && hint ? <span className="llm-field-hint">{hint}</span> : null}
    </div>
  )
}