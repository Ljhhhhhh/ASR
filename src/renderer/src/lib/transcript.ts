export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 秒'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

export function formatClockTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatTimestampRange(startMs: number, endMs: number): string {
  return `${formatTime(startMs)} - ${formatTime(endMs)}`
}

export interface SearchMatch {
  segmentIndex: number
  start: number
  end: number
}

export function findSearchMatches(segments: TranscriptSegment[], query: string): SearchMatch[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const lowerQuery = trimmed.toLowerCase()
  const matches: SearchMatch[] = []

  segments.forEach((segment, segmentIndex) => {
    const lowerText = segment.text.toLowerCase()
    let offset = 0
    while (offset < lowerText.length) {
      const index = lowerText.indexOf(lowerQuery, offset)
      if (index === -1) break
      matches.push({
        segmentIndex,
        start: index,
        end: index + trimmed.length
      })
      offset = index + 1
    }
  })

  return matches
}
