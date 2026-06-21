import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cycleLineHeight,
  lineHeightLabel,
  loadReaderPrefs,
  saveReaderPrefs,
  stepFontSize,
  type ReaderPrefs
} from '../lib/readerPrefs'
import { findSearchMatches, formatTimestampRange } from '../lib/transcript'
import { TranscriptSegmentList } from './TranscriptSegmentList'

interface TranscriptReaderProps {
  job: TranscriptionJob
  initialSegmentIndex?: number
  onClose: () => void
  onExport: (format: 'txt' | 'srt') => void
}

export function TranscriptReader({
  job,
  initialSegmentIndex = 0,
  onClose,
  onExport
}: TranscriptReaderProps): React.JSX.Element {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadReaderPrefs())
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(() =>
    Math.min(Math.max(initialSegmentIndex, 0), Math.max(job.segments.length - 1, 0))
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1)
  const [toast, setToast] = useState('')

  const searchMatches = useMemo(
    () => findSearchMatches(job.segments, searchQuery),
    [job.segments, searchQuery]
  )

  const totalDurationMs = useMemo(() => {
    const last = job.segments[job.segments.length - 1]
    return last?.endMs || job.durationMs || 0
  }, [job.durationMs, job.segments])

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

  useEffect(() => {
    document.body.classList.add('reader-open')
    return () => document.body.classList.remove('reader-open')
  }, [])

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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
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
  }, [activeSegmentIndex, goToMatch, goToSegment, onClose, searchMatches.length])

  const matchCounter =
    searchMatches.length > 0 && currentMatchIndex >= 0
      ? `${currentMatchIndex + 1}/${searchMatches.length}`
      : searchMatches.length > 0
        ? `0/${searchMatches.length}`
        : '0/0'

  return (
    <div
      className="reader-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`阅读文字稿：${job.fileName}`}
      onClick={onClose}
    >
      <div className="reader-panel" onClick={(event) => event.stopPropagation()}>
        <header className="reader-header">
          <div className="reader-header-main">
            <button type="button" className="ghost-button" onClick={onClose}>
              返回
            </button>
            <div className="reader-title">
              <strong>{job.fileName}</strong>
              <span>{job.segments.length} 句</span>
            </div>
          </div>
          <div className="export-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={job.status !== 'completed'}
              onClick={() => onExport('txt')}
            >
              导出 TXT
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={job.status !== 'completed'}
              onClick={() => onExport('srt')}
            >
              导出 SRT
            </button>
          </div>
        </header>

        <div className="reader-toolbar">
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
        </div>

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

        {toast ? <div className="reader-toast">{toast}</div> : null}
      </div>
    </div>
  )
}
