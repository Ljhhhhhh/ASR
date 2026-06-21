import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { JobPreviewHeader } from './components/JobPreviewHeader'
import { JobReaderPage } from './components/JobReaderPage'
import { KnowledgeSummaryPanel } from './components/KnowledgeSummaryPanel'
import { LlmSettingsPanel } from './components/LlmSettingsPanel'
import { TranscriptSegmentList } from './components/TranscriptSegmentList'
import { useKnowledgeSummary, type SummaryStatus } from './hooks/useKnowledgeSummary'
import { llmApi } from './lib/llmApi'
import { getLlmProviderPreset, detectLlmProviderId } from './lib/llmProviders'
import { formatClockTime, formatDuration } from './lib/transcript'

const stageLabels: Record<NonNullable<TranscriptionJob['stage']>, string> = {
  probing: '读取媒体',
  extracting: '提取音频',
  transcribing: '转写中',
  normalizing: '整理分句'
}

const stageDescriptions: Record<NonNullable<TranscriptionJob['stage']>, string> = {
  probing: '正在读取文件时长、编码等媒体信息',
  extracting: '正在从音视频中提取 16kHz 单声道音频',
  transcribing: 'ASR 模型正在识别语音内容，这一步通常耗时最长',
  normalizing: '正在整理时间戳、分句并写入缓存'
}

const statusLabels: Record<TranscriptionJob['status'], string> = {
  queued: '排队中',
  running: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

const summaryStatusLabels: Record<SummaryStatus, string> = {
  idle: '未生成',
  loading: '核查中',
  generating: '生成中',
  ready: '已生成',
  stale: '需更新',
  error: '失败'
}

const serviceLabels: Record<LocalServiceStatus['state'], string> = {
  unknown: '未检查',
  starting: '启动中',
  ready: '本地服务就绪',
  unavailable: '本地服务不可用'
}

function buildTranscriptStatusLabel(job: TranscriptionJob): string {
  if (job.status === 'running') return `${Math.round(job.progress)}%`
  if (job.source === 'cache' && job.status === 'completed') return '已缓存'
  return statusLabels[job.status]
}

function buildSummaryStatusLabel(job: TranscriptionJob, status: SummaryStatus | undefined): string {
  if (job.status !== 'completed') return '待文字稿'
  if (job.segments.length === 0) return '文字稿为空'
  return summaryStatusLabels[status || 'loading']
}

function buildSummaryStatusClass(
  job: TranscriptionJob,
  status: SummaryStatus | undefined
): SummaryStatus | 'blocked' {
  if (job.status !== 'completed' || job.segments.length === 0) return 'blocked'
  return status || 'loading'
}

function hasExportableSummary(status: SummaryStatus | undefined): boolean {
  return status === 'ready' || status === 'stale'
}

function buildBatchExportMessage(result: BatchExportResult, label: string): string {
  if (result.canceled) return ''
  const parts = [`已导出 ${result.exported} 个${label}`]
  if (result.skipped > 0) parts.push(`${result.skipped} 个失败`)
  return parts.join('，')
}

function App(): React.JSX.Element {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([])
  const [summaryStatuses, setSummaryStatuses] = useState<Record<string, SummaryStatus>>({})
  const [selectedJobId, setSelectedJobId] = useState('')
  const [exportSelectedJobIds, setExportSelectedJobIds] = useState<Set<string>>(() => new Set())
  const [provider, setProvider] = useState<AsrProvider>('local-funasr')
  const [thirdPartyBaseUrl, setThirdPartyBaseUrl] = useState('')
  const [thirdPartyModel, setThirdPartyModel] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [serviceStatus, setServiceStatus] = useState<LocalServiceStatus>({
    state: 'unknown',
    url: '',
    message: '尚未检查本地服务'
  })
  const [readerInitialIndex, setReaderInitialIndex] = useState(0)
  const [readerInitialTab, setReaderInitialTab] = useState<'transcript' | 'summary'>('transcript')
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)
  const [llmStatus, setLlmStatus] = useState<LlmConfigPublic | null>(null)
  const [transcriptTab, setTranscriptTab] = useState<'transcript' | 'summary'>('transcript')
  const [appView, setAppView] = useState<'workbench' | 'reader'>('workbench')

  useEffect(() => {
    const applyJobs = (nextJobs: TranscriptionJob[]): void => {
      setJobs(nextJobs)
      setSelectedJobId((current) => {
        if (current && nextJobs.some((job) => job.id === current)) return current
        const running = nextJobs.find((job) => job.status === 'running')
        if (running) return running.id
        return nextJobs[0]?.id || ''
      })
      setExportSelectedJobIds((current) => {
        const validIds = new Set(nextJobs.map((job) => job.id))
        const next = new Set<string>()
        for (const jobId of current) {
          if (validIds.has(jobId)) next.add(jobId)
        }
        return next.size === current.size ? current : next
      })
    }

    const offJobs = window.api.asr.onJobsUpdated(applyJobs)
    const offService = window.api.asr.onServiceUpdated(setServiceStatus)
    void window.api.asr.getJobs().then(applyJobs)
    void window.api.asr.getLocalServiceStatus().then(setServiceStatus)
    void llmApi.getConfig().then(setLlmStatus)

    return () => {
      offJobs()
      offService()
    }
  }, [])

  useEffect(() => {
    if (!jobs.some((job) => job.status === 'running')) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [jobs])

  useEffect(() => {
    const completedJobsWithTranscript = jobs.filter(
      (job) => job.status === 'completed' && job.segments.length > 0
    )
    let cancelled = false

    for (const job of completedJobsWithTranscript) {
      void llmApi
        .getSummary(job.id)
        .then((result) => {
          if (cancelled) return
          setSummaryStatuses((current) => {
            if (current[job.id] === 'generating') return current
            return {
              ...current,
              [job.id]: result ? (result.stale ? 'stale' : 'ready') : 'idle'
            }
          })
        })
        .catch(() => {
          if (cancelled) return
          setSummaryStatuses((current) => {
            if (current[job.id] === 'generating') return current
            return { ...current, [job.id]: 'error' }
          })
        })
    }

    return () => {
      cancelled = true
    }
  }, [jobs])

  useEffect(() => {
    const offChunk = llmApi.onSummaryChunk((event) => {
      setSummaryStatuses((current) => ({ ...current, [event.jobId]: 'generating' }))
    })
    const offDone = llmApi.onSummaryDone((event) => {
      setSummaryStatuses((current) => ({ ...current, [event.jobId]: 'ready' }))
    })
    const offError = llmApi.onSummaryError((event) => {
      setSummaryStatuses((current) => ({ ...current, [event.jobId]: 'error' }))
    })

    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || jobs[0],
    [jobs, selectedJobId]
  )
  const selectedJobCompleted = selectedJob?.status === 'completed'
  const knowledgeSummary = useKnowledgeSummary(
    selectedJob?.id,
    selectedJobCompleted,
    selectedJob?.fileName
  )
  const completedJobs = jobs.filter((job) => job.status === 'completed').length
  const selectedExportJobIds = useMemo(
    () => Array.from(exportSelectedJobIds),
    [exportSelectedJobIds]
  )
  const selectedExportableTranscriptJobs = jobs.filter(
    (job) =>
      exportSelectedJobIds.has(job.id) && job.status === 'completed' && job.segments.length > 0
  ).length
  const selectedExportableSummaryJobs = jobs.filter(
    (job) => exportSelectedJobIds.has(job.id) && hasExportableSummary(summaryStatuses[job.id])
  ).length
  const allJobsSelectedForExport = jobs.length > 0 && exportSelectedJobIds.size === jobs.length
  const failedJobs = jobs.filter((job) => job.status === 'failed').length
  const totalSegments = jobs.reduce((total, job) => total + job.segments.length, 0)
  const completionRate = jobs.length > 0 ? Math.round((completedJobs / jobs.length) * 100) : 0
  const runningJob = jobs.find((job) => job.status === 'running')
  const detailJob = selectedJob
  const localServiceReady = serviceStatus.state === 'ready'
  const llmProviderLabel = llmStatus
    ? getLlmProviderPreset(detectLlmProviderId(llmStatus.baseUrl))?.label
    : undefined
  const llmReady =
    Boolean(llmStatus?.enabled) &&
    Boolean(llmStatus?.hasApiKey) &&
    Boolean(llmStatus?.baseUrl.trim()) &&
    Boolean(llmStatus?.model.trim())
  const canStartThirdParty = provider === 'third-party' && thirdPartyBaseUrl.trim().length > 0
  const canStartLocal = provider === 'local-funasr' && localServiceReady
  const canStart = canStartLocal || canStartThirdParty
  const selectButtonLabel =
    provider === 'local-funasr' && !localServiceReady
      ? serviceStatus.state === 'starting'
        ? '等待服务启动'
        : '服务不可用'
      : '选择文件'
  const detailJobElapsedMs = detailJob?.startedAt
    ? (detailJob.completedAt ? Date.parse(detailJob.completedAt) : nowMs) -
      Date.parse(detailJob.startedAt)
    : 0
  const detailJobRemainingMs =
    detailJob &&
    detailJob.status === 'running' &&
    detailJob.progress > 5 &&
    detailJob.progress < 100
      ? Math.max(0, (detailJobElapsedMs / detailJob.progress) * (100 - detailJob.progress))
      : 0
  const showJobDetail = Boolean(
    detailJob && transcriptTab === 'transcript' && detailJob.status !== 'completed'
  )

  const openJobReader = (tab: 'transcript' | 'summary' = transcriptTab, segmentIndex = 0): void => {
    if (!selectedJob || selectedJob.segments.length === 0) return
    setReaderInitialTab(tab)
    setReaderInitialIndex(segmentIndex)
    setAppView('reader')
  }

  const closeJobReader = (): void => {
    setAppView('workbench')
  }

  useEffect(() => {
    if (appView === 'reader' && (!selectedJob || selectedJob.segments.length === 0)) {
      setAppView('workbench')
    }
  }, [appView, selectedJob])

  const selectFiles = async (): Promise<void> => {
    const filePaths = await window.api.asr.selectMediaFiles()
    if (filePaths.length === 0 || !canStart) return
    await window.api.asr.startJobs(filePaths, {
      provider,
      thirdPartyBaseUrl: thirdPartyBaseUrl.trim() || undefined,
      thirdPartyModel: thirdPartyModel.trim() || undefined
    })
  }

  const toggleExportSelection = (jobId: string): void => {
    setExportSelectedJobIds((current) => {
      const next = new Set(current)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  const toggleSelectAllForExport = (): void => {
    setExportSelectedJobIds((current) => {
      if (jobs.length === 0) return current
      if (current.size === jobs.length) return new Set()
      return new Set(jobs.map((job) => job.id))
    })
  }

  const exportTranscriptsBatch = async (): Promise<void> => {
    if (selectedExportJobIds.length === 0) {
      window.alert('请先勾选要导出的任务')
      return
    }
    try {
      const result = await window.api.asr.exportTranscriptsBatch(selectedExportJobIds, 'txt')
      const message = buildBatchExportMessage(result, '文字稿')
      if (message) window.alert(message)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '批量导出文字稿失败')
    }
  }

  const exportSummariesBatch = async (): Promise<void> => {
    if (selectedExportJobIds.length === 0) {
      window.alert('请先勾选要导出的任务')
      return
    }
    try {
      const result = await llmApi.exportSummariesBatch(selectedExportJobIds)
      const message = buildBatchExportMessage(result, '知识总结')
      if (message) window.alert(message)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '批量导出知识总结失败')
    }
  }

  const deleteJob = async (event: MouseEvent<HTMLButtonElement>, jobId: string): Promise<void> => {
    event.stopPropagation()
    const job = jobs.find((candidate) => candidate.id === jobId)
    const confirmed = window.confirm(`确认删除${job ? `「${job.fileName}」` : '该任务'}？`)
    if (!confirmed) return
    await window.api.asr.deleteJob(jobId)
    setExportSelectedJobIds((current) => {
      if (!current.has(jobId)) return current
      const next = new Set(current)
      next.delete(jobId)
      return next
    })
  }

  const selectJobWithKeyboard = (event: KeyboardEvent<HTMLDivElement>, jobId: string): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setSelectedJobId(jobId)
  }

  if (appView === 'reader' && selectedJob && selectedJob.segments.length > 0) {
    return (
      <main className="app-shell app-shell-reader">
        <JobReaderPage
          job={selectedJob}
          summary={knowledgeSummary}
          initialTab={readerInitialTab}
          initialSegmentIndex={readerInitialIndex}
          llmReady={llmReady}
          onClose={closeJobReader}
          onOpenLlmSettings={() => setLlmSettingsOpen(true)}
          onExportTranscript={(format) =>
            void window.api.asr.exportTranscript(selectedJob.id, format)
          }
        />

        {llmSettingsOpen ? (
          <LlmSettingsPanel onClose={() => setLlmSettingsOpen(false)} onSaved={setLlmStatus} />
        ) : null}
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">ASR</span>
          <div>
            <p className="eyebrow">Local ASR Workbench</p>
            <h1>音视频文字稿</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="service-panel">
            <div className={`status-dot ${serviceStatus.state}`} />
            <div>
              <strong>{serviceLabels[serviceStatus.state]}</strong>
              <span>{serviceStatus.message || serviceStatus.url || '本地 FunASR 默认优先'}</span>
            </div>
            <button
              type="button"
              className="ghost-button"
              disabled={serviceStatus.state === 'starting'}
              onClick={() => window.api.asr.restartLocalService()}
            >
              {serviceStatus.state === 'starting' ? '启动中' : '重启服务'}
            </button>
          </div>
          <button
            type="button"
            className="llm-settings-button"
            onClick={() => setLlmSettingsOpen(true)}
          >
            <div className={`status-dot ${llmReady ? 'ready' : 'unknown'}`} />
            <div>
              <strong>{llmReady ? '大模型已就绪' : '大模型配置'}</strong>
              <span>
                {llmStatus?.enabled
                  ? [llmProviderLabel, llmStatus.model].filter(Boolean).join(' · ') ||
                    '已启用，待补全模型信息'
                  : '硅基流动 / 深度求索 / OpenRouter / LM Studio 一键配置'}
              </span>
            </div>
          </button>
        </div>
      </header>

      <section className="summary-grid" aria-label="Processing summary">
        <div className="summary-card">
          <span>任务总数</span>
          <strong>{jobs.length}</strong>
        </div>
        <div className="summary-card">
          <span>完成率</span>
          <strong>{completionRate}%</strong>
        </div>
        <div className="summary-card">
          <span>分句数量</span>
          <strong>{totalSegments}</strong>
        </div>
        <div className="summary-card">
          <span>失败任务</span>
          <strong>{failedJobs}</strong>
        </div>
      </section>

      <section
        className={provider === 'third-party' ? 'controls controls-third-party' : 'controls'}
        aria-label="Transcription controls"
      >
        <div className="source-strip">
          <span className="controls-label">识别来源</span>
          <div className="provider-group" role="radiogroup" aria-label="ASR provider">
            <button
              type="button"
              className={provider === 'local-funasr' ? 'segmented active' : 'segmented'}
              onClick={() => setProvider('local-funasr')}
            >
              本地
            </button>
            <button
              type="button"
              className={provider === 'third-party' ? 'segmented active' : 'segmented'}
              onClick={() => setProvider('third-party')}
            >
              第三方
            </button>
          </div>
          {provider === 'local-funasr' ? (
            <span className="source-note">
              {localServiceReady
                ? '使用本地 FunASR，文件不会发往第三方服务'
                : serviceLabels[serviceStatus.state]}
            </span>
          ) : null}
        </div>

        {provider === 'third-party' ? (
          <div className="third-party-fields">
            <input
              className="service-input"
              placeholder="服务地址 https://example.com"
              value={thirdPartyBaseUrl}
              onChange={(event) => setThirdPartyBaseUrl(event.target.value)}
            />
            <input
              className="model-input"
              placeholder="模型名，可选"
              value={thirdPartyModel}
              onChange={(event) => setThirdPartyModel(event.target.value)}
            />
          </div>
        ) : null}

        <div className="intake-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!canStart}
            title={
              provider === 'local-funasr' && !localServiceReady
                ? '本地 FunASR 启动完成后可选择文件'
                : undefined
            }
            onClick={selectFiles}
          >
            {selectButtonLabel}
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={!runningJob}
            onClick={() => window.api.asr.cancelActiveJob()}
          >
            取消当前
          </button>
        </div>
      </section>

      <section className="workspace">
        <aside className="queue-panel" aria-label="Processing queue">
          <div className="panel-title">
            <div>
              <h2>处理队列</h2>
              <span>按添加顺序逐个转写</span>
            </div>
            <div className="panel-title-actions">
              {jobs.length > 0 ? (
                <div className="queue-export-actions">
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={toggleSelectAllForExport}
                  >
                    {allJobsSelectedForExport ? '取消全选' : '全选'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={selectedExportableTranscriptJobs === 0}
                    title={
                      exportSelectedJobIds.size === 0
                        ? '请先勾选要导出的任务'
                        : selectedExportableTranscriptJobs === 0
                          ? '所选任务中没有可导出的文字稿'
                          : `导出已选 ${selectedExportableTranscriptJobs} 个 TXT 文字稿`
                    }
                    onClick={() => void exportTranscriptsBatch()}
                  >
                    导出文字稿
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={selectedExportableSummaryJobs === 0}
                    title={
                      exportSelectedJobIds.size === 0
                        ? '请先勾选要导出的任务'
                        : selectedExportableSummaryJobs === 0
                          ? '所选任务中没有可导出的知识总结'
                          : `导出已选 ${selectedExportableSummaryJobs} 个 Markdown 总结`
                    }
                    onClick={() => void exportSummariesBatch()}
                  >
                    导出总结
                  </button>
                </div>
              ) : null}
              <span className="panel-title-count">
                {completedJobs}/{jobs.length} 完成
              </span>
            </div>
          </div>

          {jobs.length === 0 ? (
            <div className="empty-state">
              <strong>暂无文件</strong>
              <span>选择音频或视频文件后会按顺序处理。</span>
            </div>
          ) : (
            <div className="job-list">
              {jobs.map((job) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={job.id}
                  className={
                    selectedJob?.id === job.id
                      ? exportSelectedJobIds.has(job.id)
                        ? 'job-row selected export-selected'
                        : 'job-row selected'
                      : exportSelectedJobIds.has(job.id)
                        ? 'job-row export-selected'
                        : 'job-row'
                  }
                  onClick={() => setSelectedJobId(job.id)}
                  onKeyDown={(event) => selectJobWithKeyboard(event, job.id)}
                >
                  <label
                    className="job-export-checkbox"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={exportSelectedJobIds.has(job.id)}
                      aria-label={`选择导出 ${job.fileName}`}
                      onChange={() => toggleExportSelection(job.id)}
                    />
                  </label>
                  <div className="job-main">
                    <strong>{job.fileName}</strong>
                    <span>
                      {job.source === 'cache'
                        ? '已缓存'
                        : job.stage
                          ? stageLabels[job.stage]
                          : statusLabels[job.status]}
                    </span>
                  </div>
                  <div className="job-status-list" aria-label={`${job.fileName} 状态`}>
                    <div className={`job-status ${job.status}`}>
                      <span className="job-status-dot" />
                      <span className="job-status-label">文字稿</span>
                      <strong>{buildTranscriptStatusLabel(job)}</strong>
                    </div>
                    <div
                      className={`job-status summary-status ${buildSummaryStatusClass(
                        job,
                        summaryStatuses[job.id]
                      )}`}
                    >
                      <span className="job-status-dot" />
                      <span className="job-status-label">总结</span>
                      <strong>{buildSummaryStatusLabel(job, summaryStatuses[job.id])}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="job-delete-button"
                    aria-label={`删除 ${job.fileName}`}
                    onClick={(event) => void deleteJob(event, job.id)}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    删除
                  </button>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${job.progress}%` }} />
                  </div>
                  {job.error ? <p className="job-error">{job.error}</p> : null}
                </div>
              ))}
            </div>
          )}
        </aside>

        <section
          className={showJobDetail ? 'transcript-panel' : 'transcript-panel content-expanded'}
          aria-label="Transcript preview"
        >
          {selectedJob && selectedJob.segments.length > 0 ? (
            <JobPreviewHeader
              job={selectedJob}
              tab={transcriptTab}
              summary={knowledgeSummary}
              llmReady={llmReady}
              onTabChange={setTranscriptTab}
              onOpenReader={() => openJobReader(transcriptTab, 0)}
              onExportTxt={() => void window.api.asr.exportTranscript(selectedJob.id, 'txt')}
              onExportSrt={() => void window.api.asr.exportTranscript(selectedJob.id, 'srt')}
              onExportMarkdown={() => void knowledgeSummary.exportSummary()}
              onExportImage={() => void knowledgeSummary.exportSummaryImage()}
            />
          ) : (
            <div className="preview-panel-header preview-panel-header-fallback">
              <div className="preview-panel-leading">
                <h2>{selectedJob?.fileName || '文字稿预览'}</h2>
                <p className="preview-panel-meta">
                  {selectedJob ? statusLabels[selectedJob.status] : '等待文件处理'}
                </p>
              </div>
            </div>
          )}

          {showJobDetail && detailJob ? (
            <section className="job-detail" aria-label="Selected job progress">
              <div className="job-detail-header">
                <div>
                  <span className="detail-label">当前进度</span>
                  <strong>{Math.round(detailJob.progress)}%</strong>
                </div>
                <div>
                  <span className="detail-label">已用时间</span>
                  <strong>{formatDuration(detailJobElapsedMs)}</strong>
                </div>
                <div>
                  <span className="detail-label">预计剩余</span>
                  <strong>
                    {detailJob.status === 'running' && detailJobRemainingMs > 0
                      ? formatDuration(detailJobRemainingMs)
                      : '—'}
                  </strong>
                </div>
              </div>
              <div className="stage-detail">
                <span>
                  {detailJob.stage ? stageLabels[detailJob.stage] : statusLabels[detailJob.status]}
                </span>
                <p>
                  {detailJob.status === 'failed'
                    ? detailJob.error || '任务失败，但没有返回具体原因'
                    : detailJob.stage
                      ? stageDescriptions[detailJob.stage]
                      : detailJob.error || '等待任务状态更新'}
                </p>
              </div>
              <div className="log-list" aria-label="Processing log">
                {(detailJob.logs || []).slice(-6).map((entry, index) => (
                  <div className="log-row" key={`${entry.time}-${index}`}>
                    <time>{formatClockTime(entry.time)}</time>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {!selectedJob ? (
            <div className="empty-state large">
              <strong>批量转写工作台</strong>
              <span>本地 FunASR 是默认来源。第三方服务只会在显式选择并配置地址后使用。</span>
            </div>
          ) : selectedJob.segments.length === 0 ? (
            <div className="empty-state large">
              <strong>{statusLabels[selectedJob.status]}</strong>
              <span>{selectedJob.error || '转写完成后会在这里显示带时间戳的分句。'}</span>
            </div>
          ) : transcriptTab === 'summary' ? (
            <KnowledgeSummaryPanel
              summary={knowledgeSummary}
              llmReady={llmReady}
              onOpenLlmSettings={() => setLlmSettingsOpen(true)}
            />
          ) : (
            <TranscriptSegmentList
              segments={selectedJob.segments}
              variant="compact"
              onSegmentDoubleClick={(index) => openJobReader('transcript', index)}
            />
          )}
        </section>
      </section>

      {llmSettingsOpen ? (
        <LlmSettingsPanel onClose={() => setLlmSettingsOpen(false)} onSaved={setLlmStatus} />
      ) : null}
    </main>
  )
}

export default App
