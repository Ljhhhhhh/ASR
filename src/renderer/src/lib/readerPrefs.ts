export type ReaderFontSize = 14 | 16 | 18
export type ReaderLineHeight = 1.5 | 1.65 | 1.8

export interface ReaderPrefs {
  fontSize: ReaderFontSize
  lineHeight: ReaderLineHeight
}

const STORAGE_KEY = 'asr.reader.prefs'
const FONT_SIZES: ReaderFontSize[] = [14, 16, 18]
const LINE_HEIGHTS: ReaderLineHeight[] = [1.5, 1.65, 1.8]

const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 16,
  lineHeight: 1.65
}

function isFontSize(value: number): value is ReaderFontSize {
  return FONT_SIZES.includes(value as ReaderFontSize)
}

function isLineHeight(value: number): value is ReaderLineHeight {
  return LINE_HEIGHTS.includes(value as ReaderLineHeight)
}

export function loadReaderPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>
    const fontSize = parsed.fontSize
    const lineHeight = parsed.lineHeight
    return {
      fontSize: fontSize !== undefined && isFontSize(fontSize) ? fontSize : DEFAULT_PREFS.fontSize,
      lineHeight:
        lineHeight !== undefined && isLineHeight(lineHeight) ? lineHeight : DEFAULT_PREFS.lineHeight
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

export function stepFontSize(current: ReaderFontSize, direction: -1 | 1): ReaderFontSize {
  const index = FONT_SIZES.indexOf(current)
  const next = Math.min(FONT_SIZES.length - 1, Math.max(0, index + direction))
  return FONT_SIZES[next]
}

export function cycleLineHeight(current: ReaderLineHeight): ReaderLineHeight {
  const index = LINE_HEIGHTS.indexOf(current)
  return LINE_HEIGHTS[(index + 1) % LINE_HEIGHTS.length]
}

export function lineHeightLabel(lineHeight: ReaderLineHeight): string {
  if (lineHeight === 1.5) return '紧凑'
  if (lineHeight === 1.8) return '宽松'
  return '标准'
}
