import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_COURSE_TYPE, summaryStageMessage } from '../lib/courseTypes'
import { llmApi } from '../lib/llmApi'
import { copySummaryImageToClipboard } from '../lib/summaryImageExport'

export type SummaryStatus = 'idle' | 'loading' | 'generating' | 'ready' | 'stale' | 'error'

interface UseKnowledgeSummaryResult {
  markdown: string
  status: SummaryStatus
  progress: number
  message: string
  error: string
  generatedAt?: string
  model?: string
  courseType: CourseType
  setCourseType: (courseType: CourseType) => void
  generate: () => Promise<void>
  cancel: () => Promise<void>
  reload: () => Promise<void>
  exportSummary: () => Promise<void>
  exportSummaryPdf: () => Promise<void>
  exportSummaryImage: () => Promise<void>
}

export function useKnowledgeSummary(
  jobId: string | undefined,
  enabled: boolean,
  fileName?: string
): UseKnowledgeSummaryResult {
  const [markdown, setMarkdown] = useState('')
  const [status, setStatus] = useState<SummaryStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [generatedAt, setGeneratedAt] = useState<string | undefined>()
  const [model, setModel] = useState<string | undefined>()
  const [courseType, setCourseType] = useState<CourseType>(DEFAULT_COURSE_TYPE)
  const activeJobIdRef = useRef('')

  const reload = useCallback(async () => {
    if (!jobId || !enabled) {
      setMarkdown('')
      setStatus('idle')
      setProgress(0)
      setMessage('')
      setError('')
      setGeneratedAt(undefined)
      setModel(undefined)
      return
    }

    setStatus('loading')
    setError('')
    try {
      const result = await llmApi.getSummary(jobId)
      if (!result) {
        setMarkdown('')
        setStatus('idle')
        setProgress(0)
        setMessage('')
        setGeneratedAt(undefined)
        setModel(undefined)
        return
      }

      setMarkdown(result.record.markdown)
      setGeneratedAt(result.record.generatedAt)
      setModel(result.record.model)
      if (result.record.courseType) {
        setCourseType(result.record.courseType)
      }
      setStatus(result.stale ? 'stale' : 'ready')
      setProgress(100)
      setMessage(result.stale ? '文字稿已更新，建议重新生成' : '')
    } catch (loadError) {
      setStatus('error')
      setError(loadError instanceof Error ? loadError.message : '加载知识总结失败')
    }
  }, [enabled, jobId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [reload])

  useEffect(() => {
    const offChunk = llmApi.onSummaryChunk((event) => {
      if (!jobId || event.jobId !== jobId) return
      setStatus('generating')
      setMessage(event.message || summaryStageMessage(event.stage))

      if (event.delta) {
        setMarkdown((current) => current + event.delta)
        return
      }

      if (event.progress !== undefined) {
        setProgress(event.progress)
      }
    })

    const offDone = llmApi.onSummaryDone((event) => {
      if (!jobId || event.jobId !== jobId) return
      setMarkdown(event.record.markdown)
      setGeneratedAt(event.record.generatedAt)
      setModel(event.record.model)
      if (event.record.courseType) {
        setCourseType(event.record.courseType)
      }
      setStatus('ready')
      setProgress(100)
      setMessage('')
      setError('')
      activeJobIdRef.current = ''
    })

    const offError = llmApi.onSummaryError((event) => {
      if (!jobId || event.jobId !== jobId) return
      setStatus('error')
      setError(event.message)
      activeJobIdRef.current = ''
    })

    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [jobId])

  const generate = useCallback(async () => {
    if (!jobId || !enabled) return
    activeJobIdRef.current = jobId
    setMarkdown('')
    setStatus('generating')
    setProgress(0)
    setMessage('准备生成…')
    setError('')
    setGeneratedAt(undefined)
    setModel(undefined)

    try {
      await llmApi.generateSummary(jobId, courseType)
    } catch (generateError) {
      if (activeJobIdRef.current !== jobId) return
      const nextMessage =
        generateError instanceof Error ? generateError.message : '生成知识总结失败'
      if (nextMessage !== '已取消生成') {
        setStatus('error')
        setError(nextMessage)
      } else {
        setStatus(markdown ? 'ready' : 'idle')
      }
      activeJobIdRef.current = ''
    }
  }, [courseType, enabled, jobId, markdown])

  const cancel = useCallback(async () => {
    if (!jobId) return
    await llmApi.cancelSummary(jobId)
    activeJobIdRef.current = ''
    setMessage('已取消')
    setStatus(markdown ? 'ready' : 'idle')
  }, [jobId, markdown])

  const exportSummary = useCallback(async () => {
    if (!jobId) return
    await llmApi.exportSummary(jobId)
  }, [jobId])

  const exportSummaryPdf = useCallback(async () => {
    if (!jobId) return
    await llmApi.exportSummaryPdf(jobId)
  }, [jobId])

  const exportSummaryImage = useCallback(async () => {
    if (!jobId || !markdown.trim()) return
    await copySummaryImageToClipboard(markdown, fileName || '知识总结')
    await llmApi.saveSummaryImageFromClipboard(jobId)
  }, [fileName, jobId, markdown])

  return {
    markdown,
    status,
    progress,
    message,
    error,
    generatedAt,
    model,
    courseType,
    setCourseType,
    generate,
    cancel,
    reload,
    exportSummary,
    exportSummaryPdf,
    exportSummaryImage
  }
}
