import { useDeferredValue } from 'react'
import type { useKnowledgeSummary } from '../hooks/useKnowledgeSummary'
import { MarkdownRenderer } from './MarkdownRenderer'

type KnowledgeSummaryState = ReturnType<typeof useKnowledgeSummary>

interface KnowledgeSummaryPanelProps {
  summary: KnowledgeSummaryState
  llmReady: boolean
  onOpenLlmSettings: () => void
}

export function KnowledgeSummaryPanel({
  summary,
  llmReady,
  onOpenLlmSettings
}: KnowledgeSummaryPanelProps): React.JSX.Element {
  const deferredMarkdown = useDeferredValue(summary.markdown)
  const isGenerating = summary.status === 'generating'
  const hasContent = summary.markdown.trim().length > 0
  const showPreview = hasContent || isGenerating

  if (!llmReady && !hasContent) {
    return (
      <div className="preview-empty-state">
        <strong>大模型未就绪</strong>
        <span>配置大模型后，可在顶栏点击「生成」提炼知识总结。</span>
        <button type="button" className="ghost-button" onClick={onOpenLlmSettings}>
          打开大模型设置
        </button>
      </div>
    )
  }

  if (summary.error && !hasContent && !isGenerating) {
    return (
      <div className="preview-empty-state">
        <strong>生成失败</strong>
        <span>{summary.error}</span>
      </div>
    )
  }

  if (summary.status === 'loading' && !hasContent) {
    return (
      <div className="preview-empty-state">
        <strong>加载中</strong>
        <span>正在读取已缓存的知识总结…</span>
      </div>
    )
  }

  if (!showPreview) {
    return (
      <div className="preview-empty-state">
        <strong>暂无知识总结</strong>
        <span>在顶栏选择课程类型并点击「生成」，AI 将从文字稿提炼结构化学习笔记。</span>
      </div>
    )
  }

  return (
    <div className="summary-preview">
      {summary.error ? (
        <div className="summary-inline-error" role="status">
          {summary.error}
        </div>
      ) : null}
      {isGenerating && summary.progress > 0 && summary.progress < 100 ? (
        <div className="summary-progress-track" aria-hidden="true">
          <div className="summary-progress-fill" style={{ width: `${summary.progress}%` }} />
        </div>
      ) : null}
      <div className="summary-content">
        <MarkdownRenderer content={deferredMarkdown} streaming={isGenerating} />
      </div>
    </div>
  )
}