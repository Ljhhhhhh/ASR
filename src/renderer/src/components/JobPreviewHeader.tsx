import type { useKnowledgeSummary } from '../hooks/useKnowledgeSummary'
import { COURSE_TYPE_OPTIONS } from '../lib/courseTypes'

type KnowledgeSummaryState = ReturnType<typeof useKnowledgeSummary>
type PreviewTab = 'transcript' | 'summary'

interface JobPreviewHeaderProps {
  job: TranscriptionJob
  tab: PreviewTab
  summary: KnowledgeSummaryState
  llmReady: boolean
  onTabChange: (tab: PreviewTab) => void
  onOpenReader: () => void
  onExportTxt: () => void
  onExportSrt: () => void
  onExportMarkdown: () => void
}

function buildSummaryMeta(summary: KnowledgeSummaryState): string {
  const hasContent = summary.markdown.trim().length > 0

  if (summary.status === 'generating') {
    const progress =
      summary.progress > 0 && summary.progress < 100 ? ` ${summary.progress}%` : ''
    return `生成中${progress} · ${summary.message || '正在处理…'}`
  }
  if (summary.status === 'stale') {
    return '文字稿已更新，建议重新生成'
  }
  if (hasContent && summary.generatedAt) {
    const time = new Date(summary.generatedAt).toLocaleString()
    return summary.model ? `生成于 ${time} · ${summary.model}` : `生成于 ${time}`
  }
  if (summary.status === 'loading') {
    return '正在加载知识总结…'
  }
  return '尚未生成知识总结'
}

export function JobPreviewHeader({
  job,
  tab,
  summary,
  llmReady,
  onTabChange,
  onOpenReader,
  onExportTxt,
  onExportSrt,
  onExportMarkdown
}: JobPreviewHeaderProps): React.JSX.Element {
  const hasSummaryContent = summary.markdown.trim().length > 0
  const isSummaryGenerating = summary.status === 'generating'
  const canExportTranscript = job.status === 'completed'
  const meta =
    tab === 'transcript' ? `${job.segments.length} 句` : buildSummaryMeta(summary)

  return (
    <header className="preview-panel-header">
      <div className="preview-panel-leading">
        <h2 title={job.fileName}>{job.fileName}</h2>
        <p className={`preview-panel-meta${summary.status === 'stale' ? ' is-warning' : ''}`}>
          {meta}
        </p>
      </div>

      <div className="preview-panel-tabs" role="tablist" aria-label="预览视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'transcript'}
          className={tab === 'transcript' ? 'panel-tab active' : 'panel-tab'}
          onClick={() => onTabChange('transcript')}
        >
          文字稿
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'summary'}
          className={tab === 'summary' ? 'panel-tab active' : 'panel-tab'}
          onClick={() => onTabChange('summary')}
        >
          知识总结
        </button>
      </div>

      <div className="preview-panel-actions">
        {tab === 'transcript' ? (
          <>
            <button
              type="button"
              className="ghost-button compact-button"
              disabled={!canExportTranscript}
              onClick={onExportTxt}
            >
              TXT
            </button>
            <button
              type="button"
              className="ghost-button compact-button"
              disabled={!canExportTranscript}
              onClick={onExportSrt}
            >
              SRT
            </button>
          </>
        ) : (
          <>
            {!isSummaryGenerating ? (
              <label className="summary-course-type compact-course-type">
                <select
                  value={summary.courseType}
                  disabled={!llmReady}
                  aria-label="课程类型"
                  onChange={(event) =>
                    summary.setCourseType(event.target.value as CourseType)
                  }
                >
                  {COURSE_TYPE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {isSummaryGenerating ? (
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => void summary.cancel()}
              >
                取消
              </button>
            ) : (
              <button
                type="button"
                className="ghost-button compact-button"
                disabled={!llmReady}
                onClick={() => void summary.generate()}
              >
                {hasSummaryContent ? '重新生成' : '生成'}
              </button>
            )}
            <button
              type="button"
              className="ghost-button compact-button"
              disabled={!hasSummaryContent}
              onClick={onExportMarkdown}
            >
              MD
            </button>
          </>
        )}
        <button type="button" className="primary-button compact-button" onClick={onOpenReader}>
          展开阅读
        </button>
      </div>
    </header>
  )
}