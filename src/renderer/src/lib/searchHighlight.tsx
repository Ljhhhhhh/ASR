import type { SearchMatch } from './transcript'

interface HighlightedTextProps {
  text: string
  segmentIndex: number
  matches: SearchMatch[]
  currentMatchIndex: number
  matchOffset: number
}

export function HighlightedText({
  text,
  segmentIndex,
  matches,
  currentMatchIndex,
  matchOffset
}: HighlightedTextProps): React.JSX.Element {
  const segmentMatches = matches
    .map((match, globalIndex) => ({ ...match, globalIndex }))
    .filter((match) => match.segmentIndex === segmentIndex)

  if (segmentMatches.length === 0) {
    return <>{text}</>
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0

  segmentMatches.forEach((match) => {
    if (cursor < match.start) {
      nodes.push(text.slice(cursor, match.start))
    }
    const isCurrent = match.globalIndex === currentMatchIndex
    nodes.push(
      <mark
        key={`${match.start}-${match.end}-${match.globalIndex}`}
        className={isCurrent ? 'search-hit current' : 'search-hit'}
        data-match-index={match.globalIndex - matchOffset}
      >
        {text.slice(match.start, match.end)}
      </mark>
    )
    cursor = match.end
  })

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return <>{nodes}</>
}
