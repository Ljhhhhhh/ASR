import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { TranscriptFingerprint } from '../asr'
import { getAsrDataDir } from '../asrDataDir'

export interface KnowledgeSummaryRecord {
  jobId: string
  fileName: string
  transcriptFingerprint: TranscriptFingerprint
  markdown: string
  model: string
  generatedAt: string
  courseType?: 'training' | 'interview' | 'lecture'
  chunkCount?: number
}

function getSummariesDir(): string {
  return join(getAsrDataDir(), 'summaries')
}

function getSummaryJsonPath(jobId: string): string {
  return join(getSummariesDir(), `${jobId}.json`)
}

function getSummaryMarkdownPath(jobId: string): string {
  return join(getSummariesDir(), `${jobId}.md`)
}

export function isSummaryStale(
  record: KnowledgeSummaryRecord,
  current: TranscriptFingerprint
): boolean {
  const stored = record.transcriptFingerprint
  return (
    stored.cacheKey !== current.cacheKey ||
    stored.size !== current.size ||
    stored.mtimeMs !== current.mtimeMs ||
    stored.segmentCount !== current.segmentCount ||
    stored.jobUpdatedAt !== current.jobUpdatedAt
  )
}

export async function loadKnowledgeSummary(
  jobId: string
): Promise<KnowledgeSummaryRecord | null> {
  try {
    const raw = await readFile(getSummaryJsonPath(jobId), 'utf8')
    const parsed = JSON.parse(raw) as KnowledgeSummaryRecord
    if (!parsed.jobId || typeof parsed.markdown !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export async function saveKnowledgeSummary(record: KnowledgeSummaryRecord): Promise<void> {
  const jsonPath = getSummaryJsonPath(record.jobId)
  const mdPath = getSummaryMarkdownPath(record.jobId)
  await mkdir(dirname(jsonPath), { recursive: true })
  await writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf8')
  await writeFile(mdPath, record.markdown, 'utf8')
}