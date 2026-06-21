import { useEffect, useRef } from 'react'
import { HighlightedText } from '../lib/searchHighlight'
import type { SearchMatch } from '../lib/transcript'
import { formatTimestampRange } from '../lib/transcript'

interface TranscriptSegmentListProps {
  segments: TranscriptSegment[]
  variant?: 'compact' | 'reader'
  activeIndex?: number
  searchQuery?: string
  searchMatches?: SearchMatch[]
  currentMatchIndex?: number
  fontSize?: number
  lineHeight?: number
  onSegmentClick?: (index: number) => void
  onSegmentDoubleClick?: (index: number) => void
  onTimestampClick?: (startMs: number, endMs: number) => void
}

export function TranscriptSegmentList({
  segments,
  variant = 'compact',
  activeIndex = -1,
  searchQuery = '',
  searchMatches = [],
  currentMatchIndex = -1,
  fontSize,
  lineHeight,
  onSegmentClick,
  onSegmentDoubleClick,
  onTimestampClick
}: TranscriptSegmentListProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const activeRowRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (activeIndex < 0) return
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, currentMatchIndex])

  const listClassName = variant === 'reader' ? 'transcript-list reader-variant' : 'transcript-list'
  const readerTypographyStyle =
    variant === 'reader' && fontSize && lineHeight
      ? ({
          '--reader-font-size': `${fontSize}px`,
          '--reader-line-height': String(lineHeight),
          '--reader-time-font-size': `${Math.max(11, Math.round(fontSize * 0.85))}px`
        } as React.CSSProperties)
      : undefined

  return (
    <div className={listClassName} ref={listRef} style={readerTypographyStyle}>
      {segments.map((segment, index) => {
        const isActive = index === activeIndex
        const rowClassName = isActive ? 'segment-row active' : 'segment-row'

        return (
          <article
            className={rowClassName}
            key={`${segment.startMs}-${index}`}
            ref={isActive ? activeRowRef : undefined}
            onClick={() => onSegmentClick?.(index)}
            onDoubleClick={() => onSegmentDoubleClick?.(index)}
          >
            <time
              role="button"
              tabIndex={0}
              title="点击复制时间戳"
              onClick={(event) => {
                event.stopPropagation()
                onTimestampClick?.(segment.startMs, segment.endMs)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onTimestampClick?.(segment.startMs, segment.endMs)
                }
              }}
            >
              {formatTimestampRange(segment.startMs, segment.endMs)}
            </time>
            <p>
              {searchQuery.trim() ? (
                <HighlightedText
                  text={segment.text}
                  segmentIndex={index}
                  matches={searchMatches}
                  currentMatchIndex={currentMatchIndex}
                  matchOffset={0}
                />
              ) : (
                segment.text
              )}
            </p>
          </article>
        )
      })}
    </div>
  )
}
