export interface TranscriptSegment {
  startMs: number
  endMs: number
  text: string
}

function formatShortTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number): string => value.toString().padStart(2, '0')
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${pad(minutes)}:${pad(seconds)}`
}

export function segmentsToPlainText(segments: TranscriptSegment[], withTimestamps = false): string {
  if (withTimestamps) {
    return segments
      .map((segment) => `[${formatShortTimestamp(segment.startMs)}] ${segment.text}`)
      .join('\n')
  }
  return segments.map((segment) => segment.text).join('\n')
}

const DEFAULT_TIME_WINDOW_MS = 10 * 60 * 1000

export function splitSegmentsByTimeWindow(
  segments: TranscriptSegment[],
  windowMs = DEFAULT_TIME_WINDOW_MS
): TranscriptSegment[][] {
  if (segments.length === 0) return []

  const groups: TranscriptSegment[][] = []
  let current: TranscriptSegment[] = []
  let windowStart = segments[0].startMs

  for (const segment of segments) {
    if (current.length > 0 && segment.startMs - windowStart >= windowMs) {
      groups.push(current)
      current = []
      windowStart = segment.startMs
    }
    current.push(segment)
  }

  if (current.length > 0) {
    groups.push(current)
  }

  return groups
}