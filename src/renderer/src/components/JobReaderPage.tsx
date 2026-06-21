import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { useKnowledgeSummary } from '../hooks/useKnowledgeSummary'
import { COURSE_TYPE_OPTIONS } from '../lib/courseTypes'
import {
  cycleLineHeight,
  lineHeightLabel,
  loadReaderPrefs,
  saveReaderPrefs,
  stepFontSize,
  type ReaderPrefs
} from '../lib/readerPrefs'
import { findSearchMatches, formatTimestampRange } from '../lib/transcript'
import { MarkdownRenderer } from './MarkdownRenderer'
import { TranscriptSegmentList } from './TranscriptSegmentList'

type KnowledgeSummaryState = ReturnType<typeof useKnowledgeSummary>
type ReaderTab = 'transcript' | 'summary'

interface JobReaderPageProps {
  job: TranscriptionJob
  summary: KnowledgeSummaryState
  initialTab?: ReaderTab
  initialSegmentIndex?: number
  llmReady: boolean
  onClose: () => void
  onOpenLlmSettings: () => void
  onExportTranscript: (format: 'txt' | 'srt') => void
}

export function JobReaderPage({
  job,
  summary,
  initialTab = 'transcript',
  initialSegmentIndex = 0,
  llmReady,
  onClose,
  onOpenLlmSettings,
  onExportTranscript
}: JobReaderPageProps): React.JSX.Element {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [readerTab, setReaderTab] = useState<ReaderTab>(initialTab)
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadReaderPrefs())
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(() =>
    Math.min(Math.max(initialSegmentIndex, 0), Math.max(job.segments.length - 1, 0))
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1)
  const [toast, setToast] = useState('')

  const deferredMarkdown = useDeferredValue(summary.markdown)
  const hasSummaryContent = summary.markdown.trim().length > 0
  const isSummaryGenerating = summary.status === 'generating'

  const searchMatches = useMemo(
    () => findSearchMatches(job.segments, searchQuery),
    [job.segments, searchQuery]
  )

  const totalDurationMs = useMemo(() => {
    const last = job.segments[job.segments.length - 1]
    return last?.endMs || job.durationMs || 0
  }, [job.durationMs, job.segments])

  const summaryMetaParts = [
    summary.generatedAt ? `生成于 ${new Date(summary.generatedAt).toLocaleString()}` : '',
    summary.model || ''
  ].filter(Boolean)

  const subtitle =
    readerTab === 'transcript'
      ? `${job.segments.length} 句`
      : isSummaryGenerating
        ? summary.message || '正在生成知识总结…'
        : summaryMetaParts.length > 0
          ? summaryMetaParts.join(' · ')
          : '知识总结'

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1500)
  }, [])

  const persistPrefs = useCallback((next: ReaderPrefs) => {
    setPrefs(next)
    saveReaderPrefs(next)
  }, [])

  const goToSegment = useCallback(
    (index: number) => {
      if (job.segments.length === 0) return
      const clamped = Math.min(Math.max(index, 0), job.segments.length - 1)
      setActiveSegmentIndex(clamped)
    },
    [job.segments.length]
  )

  const goToMatch = useCallback(
    (direction: 1 | -1) => {
      if (searchMatches.length === 0) return
      setCurrentMatchIndex((current) => {
        const base = current < 0 ? (direction === 1 ? -1 : 0) : current
        const next = (base + direction + searchMatches.length) % searchMatches.length
        const match = searchMatches[next]
        setActiveSegmentIndex(match.segmentIndex)
        return next
      })
    },
    [searchMatches]
  )

  const handleTimestampClick = useCallback(
    async (startMs: number, endMs: number) => {
      const value = formatTimestampRange(startMs, endMs)
      try {
        await navigator.clipboard.writeText(value)
        showToast('已复制时间戳')
      } catch {
        showToast('复制失败')
      }
    },
    [showToast]
  )

  const handleSearchChange = (value: string): void => {
    setSearchQuery(value)
    const matches = findSearchMatches(job.segments, value)
    if (matches.length === 0) {
      setCurrentMatchIndex(-1)
      return
    }
    setCurrentMatchIndex(0)
    setActiveSegmentIndex(matches[0].segmentIndex)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)

      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (readerTab !== 'transcript') return

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }

      if (isTyping) {
        if (event.key === 'Enter' && searchMatches.length > 0) {
          event.preventDefault()
          goToMatch(event.shiftKey ? -1 : 1)
        }
        return
      }

      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        goToSegment(activeSegmentIndex - 1)
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        goToSegment(activeSegmentIndex + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeSegmentIndex,
    goToMatch,
    goToSegment,
    onClose,
    readerTab,
    searchMatches.length
  ])

  const matchCounter =
    searchMatches.length > 0 && currentMatchIndex >= 0
      ? `${currentMatchIndex + 1}/${searchMatches.length}`
      : searchMatches.length > 0
        ? `0/${searchMatches.length}`
        : '0/0'

  const renderSummaryBody = (): React.JSX.Element => {
    if (!llmReady && !hasSummaryContent && !isSummaryGenerating) {
      return (
        <div className="empty-state large">
          <strong>大模型未就绪</strong>
          <span>请先在右上角配置并启用大模型，再生成知识总结。</span>
          <button type="button" className="ghost-button" onClick={onOpenLlmSettings}>
            打开大模型设置
          </button>
        </div>
      )
    }

    if (summary.error && !hasSummaryContent && !isSummaryGenerating) {
      return (
        <div className="empty-state large">
          <strong>生成失败</strong>
          <span>{summary.error}</span>
          <button type="button" className="ghost-button" onClick={() => void summary.generate()}>
            重试
          </button>
        </div>
      )
    }

    if (summary.status === 'loading' && !hasSummaryContent && !isSummaryGenerating) {
      return (
        <div className="empty-state large">
          <strong>加载中</strong>
          <span>正在读取已缓存的知识总结…</span>
        </div>
      )
    }

    if (!hasSummaryContent && !isSummaryGenerating) {
      return (
        <div className="empty-state large">
          <strong>知识总结</strong>
          <span>该任务尚未生成知识总结，可在上方选择课程类型后一键生成。</span>
          <label className="summary-course-type">
            <span>课程类型</span>
            <select
              value={summary.courseType}
              disabled={!llmReady}
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
          <button
            type="button"
            className="primary-button"
            disabled={!llmReady}
            onClick={() => void summary.generate()}
          >
            生成知识总结
          </button>
        </div>
      )
    }

    return (
      <article
        className="job-reader-summary-body"
        style={
          {
            '--reader-font-size': `${prefs.fontSize}px`,
            '--reader-line-height': String(prefs.lineHeight)
          } as React.CSSProperties
        }
      >
        {summary.error ? (
          <div className="summary-inline-error" role="status">
            {summary.error}
          </div>
        ) : null}
        {isSummaryGenerating && summary.progress > 0 && summary.progress < 100 ? (
          <div className="summary-progress-track" aria-hidden="true">
            <div className="summary-progress-fill" style={{ width: `${summary.progress}%` }} />
          </div>
        ) : null}
        <MarkdownRenderer content={deferredMarkdown} streaming={isSummaryGenerating} />
      </article>
    )
  }

  return (
    <section className="job-reader-page" aria-label={`阅读详情：${job.fileName}`}>
      <header className="job-reader-header">
        <div className="job-reader-header-main">
          <button type="button" className="ghost-button" onClick={onClose}>
            返回工作台
          </button>
          <div className="reader-title">
            <strong>{job.fileName}</strong>
            <span>{subtitle}</span>
          </div>
          <div className="panel-tabs" role="tablist" aria-label="阅读视图">
            <button
              type="button"
              role="tab"
              aria-selected={readerTab === 'transcript'}
              className={readerTab === 'transcript' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setReaderTab('transcript')}
            >
              文字稿
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={readerTab === 'summary'}
              className={readerTab === 'summary' ? 'panel-tab active' : 'panel-tab'}
              onClick={() => setReaderTab('summary')}
            >
              知识总结
            </button>
          </div>
        </div>
        <div className="export-actions">
          {readerTab === 'transcript' ? (
            <>
              <button
                type="button"
                className="ghost-button"
                disabled={job.status !== 'completed'}
                onClick={() => onExportTranscript('txt')}
              >
                导出 TXT
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={job.status !== 'completed'}
                onClick={() => onExportTranscript('srt')}
              >
                导出 SRT
              </button>
            </>
          ) : (
            <>
              {!isSummaryGenerating ? (
                <label className="summary-course-type">
                  <span>课程类型</span>
                  <select
                    value={summary.courseType}
                    disabled={!llmReady}
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
                  className="ghost-button"
                  onClick={() => void summary.cancel()}
                >
                  取消生成
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!llmReady}
                  onClick={() => void summary.generate()}
                >
                  {hasSummaryContent ? '重新生成' : '生成知识总结'}
                </button>
              )}
              <button
                type="button"
                className="ghost-button"
                disabled={!hasSummaryContent}
                onClick={() => void summary.exportSummary()}
              >
                导出 Markdown
              </button>
            </>
          )}
        </div>
      </header>

      <div className="job-reader-toolbar">
        {readerTab === 'transcript' ? (
          <>
            <div className="reader-search-group">
              <input
                ref={searchInputRef}
                className="reader-search"
                type="search"
                placeholder="搜索文字稿 (⌘F)"
                value={searchQuery}
                onChange={(event) => handleSearchChange(event.target.value)}
              />
              <span className="reader-match-count">{matchCounter}</span>
              <button
                type="button"
                className="ghost-button reader-icon-button"
                disabled={searchMatches.length === 0}
                title="上一个匹配"
                onClick={() => goToMatch(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="ghost-button reader-icon-button"
                disabled={searchMatches.length === 0}
                title="下一个匹配"
                onClick={() => goToMatch(1)}
              >
                ↓
              </button>
            </div>

            <div className="reader-nav-buttons">
              <button
                type="button"
                className="ghost-button"
                disabled={activeSegmentIndex <= 0}
                onClick={() => goToSegment(activeSegmentIndex - 1)}
              >
                上句
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={activeSegmentIndex >= job.segments.length - 1}
                onClick={() => goToSegment(activeSegmentIndex + 1)}
              >
                下句
              </button>
            </div>
          </>
        ) : null}

        <div className="reader-font-controls">
          <button
            type="button"
            className="ghost-button reader-icon-button"
            title="减小字号"
            onClick={() => persistPrefs({ ...prefs, fontSize: stepFontSize(prefs.fontSize, -1) })}
          >
            A-
          </button>
          <button
            type="button"
            className="ghost-button reader-icon-button"
            title="增大字号"
            onClick={() => persistPrefs({ ...prefs, fontSize: stepFontSize(prefs.fontSize, 1) })}
          >
            A+
          </button>
          <button
            type="button"
            className="ghost-button"
            title="切换行距"
            onClick={() =>
              persistPrefs({
                ...prefs,
                lineHeight: cycleLineHeight(prefs.lineHeight)
              })
            }
          >
            行距 {lineHeightLabel(prefs.lineHeight)}
          </button>
        </div>
      </div>

      <div className="job-reader-body">
        {readerTab === 'transcript' ? (
          <div className="reader-body">
            <TranscriptSegmentList
              segments={job.segments}
              variant="reader"
              activeIndex={activeSegmentIndex}
              searchQuery={searchQuery}
              searchMatches={searchMatches}
              currentMatchIndex={currentMatchIndex}
              fontSize={prefs.fontSize}
              lineHeight={prefs.lineHeight}
              onSegmentClick={goToSegment}
              onTimestampClick={(startMs, endMs) => void handleTimestampClick(startMs, endMs)}
            />

            {totalDurationMs > 0 ? (
              <aside className="reader-timeline" aria-label="分句时间轴">
                {job.segments.map((segment, index) => {
                  const topPercent = (segment.startMs / totalDurationMs) * 100
                  const isActive = index === activeSegmentIndex
                  return (
                    <button
                      key={`${segment.startMs}-${index}`}
                      type="button"
                      className={isActive ? 'reader-timeline-tick active' : 'reader-timeline-tick'}
                      style={{ top: `${Math.min(topPercent, 98)}%` }}
                      title={formatTimestampRange(segment.startMs, segment.endMs)}
                      onClick={() => goToSegment(index)}
                    />
                  )
                })}
              </aside>
            ) : null}
          </div>
        ) : (
          renderSummaryBody()
        )}
      </div>

      {toast ? <div className="reader-toast">{toast}</div> : null}
    </section>
  )
}