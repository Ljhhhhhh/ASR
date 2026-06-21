import type { TranscriptSegment } from './transcript'

const MIN_SEGMENT_CHARS = 4

const DROP_SEGMENT_PATTERNS: RegExp[] = [
  /^\s*the\s*$/i,
  /^还有吗[？?]?$/,
  /^猜对了/,
  /^线上的同学/,
  /^认为.*举手/,
  /^没用过的可以扣个零/,
  /^用过的举手/,
  /^好，有一个同学猜对了/
]

/** 业财 / 数据分析领域 ASR 常见误识别 */
export const ASR_CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /C嘛/g, replacement: 'CIMA' },
  { pattern: /C\s*I\s*M\s*A\s*C嘛/gi, replacement: 'CIMA' },
  { pattern: /\bI\s*B\s*C\s*S\b/gi, replacement: 'IBCS' },
  { pattern: /\bPOWER\s*BI\b/gi, replacement: 'Power BI' },
  { pattern: /\bpower\s*bi\b/gi, replacement: 'Power BI' },
  { pattern: /机器人儿/g, replacement: 'RPA' },
  { pattern: /R\s*P\s*A/gi, replacement: 'RPA' }
]

export function applyAsrCorrections(text: string): string {
  let next = text
  for (const { pattern, replacement } of ASR_CORRECTIONS) {
    next = next.replace(pattern, replacement)
  }
  return next
}

export function shouldDropSegment(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < MIN_SEGMENT_CHARS) return true
  return DROP_SEGMENT_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function preFilterSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((segment) => ({
      ...segment,
      text: applyAsrCorrections(segment.text.trim())
    }))
    .filter((segment) => segment.text && !shouldDropSegment(segment.text))
}

export function detectInteractiveDensity(segments: TranscriptSegment[]): number {
  if (segments.length === 0) return 0
  const interactivePattern = /举手|猜一|扣个|回复个|线上的同学|奖品|送个/
  const hits = segments.filter((segment) => interactivePattern.test(segment.text)).length
  return hits / segments.length
}