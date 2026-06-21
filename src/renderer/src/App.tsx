import { useEffect, useMemo, useState } from 'react'
import { TranscriptReader } from './components/TranscriptReader'
import { TranscriptSegmentList } from './components/TranscriptSegmentList'
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

const serviceLabels: Record<LocalServiceStatus['state'], string> = {
  unknown: '未检查',
  starting: '启动中',
  ready: '本地服务就绪',
  unavailable: '本地服务不可用'
}

function App(): React.JSX.Element {
  const [jobs, setJobs] = useState<TranscriptionJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [provider, setProvider] = useState<AsrProvider>('local-funasr')
  const [thirdPartyBaseUrl, setThirdPartyBaseUrl] = useState('')
  const [thirdPartyModel, setThirdPartyModel] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [serviceStatus, setServiceStatus] = useState<LocalServiceStatus>({
    state: 'unknown',
    url: '',
    message: '尚未检查本地服务'
  })
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerInitialIndex, setReaderInitialIndex] = useState(0)

  useEffect(() => {
    const applyJobs = (nextJobs: TranscriptionJob[]): void => {
      setJobs(nextJobs)
      setSelectedJobId((current) => {
        const running = nextJobs.find((job) => job.status === 'running')
        if (running) return running.id
        if (current && nextJobs.some((job) => job.id === current)) return current
        return nextJobs[0]?.id || ''
      })
    }

    const offJobs = window.api.asr.onJobsUpdated(applyJobs)
    const offService = window.api.asr.onServiceUpdated(setServiceStatus)
    void window.api.asr.getJobs().then(applyJobs)
    void window.api.asr.getLocalServiceStatus().then(setServiceStatus)

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

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || jobs[0],
    [jobs, selectedJobId]
  )
  const completedJobs = jobs.filter((job) => job.status === 'completed').length
  const failedJobs = jobs.filter((job) => job.status === 'failed').length
  const totalSegments = jobs.reduce((total, job) => total + job.segments.length, 0)
  const completionRate = jobs.length > 0 ? Math.round((completedJobs / jobs.length) * 100) : 0
  const runningJob = jobs.find((job) => job.status === 'running')
  const detailJob = runningJob || selectedJob
  const localServiceReady = serviceStatus.state === 'ready'
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

  const openReader = (segmentIndex = 0): void => {
    if (!selectedJob || selectedJob.segments.length === 0) return
    setReaderInitialIndex(segmentIndex)
    setReaderOpen(true)
  }

  const selectFiles = async (): Promise<void> => {
    const filePaths = await window.api.asr.selectMediaFiles()
    if (filePaths.length === 0 || !canStart) return
    await window.api.asr.startJobs(filePaths, {
      provider,
      thirdPartyBaseUrl: thirdPartyBaseUrl.trim() || undefined,
      thirdPartyModel: thirdPartyModel.trim() || undefined
    })
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

      <section className="controls" aria-label="Transcription controls">
        <div className="provider-group" role="radiogroup" aria-label="ASR provider">
          <button
            type="button"
            className={provider === 'local-funasr' ? 'segmented active' : 'segmented'}
            onClick={() => setProvider('local-funasr')}
          >
            本地 FunASR
          </button>
          <button
            type="button"
            className={provider === 'third-party' ? 'segmented active' : 'segmented'}
            onClick={() => setProvider('third-party')}
          >
            第三方服务
          </button>
        </div>

        <input
          className="service-input"
          disabled={provider !== 'third-party'}
          placeholder="https://example.com"
          value={thirdPartyBaseUrl}
          onChange={(event) => setThirdPartyBaseUrl(event.target.value)}
        />
        <input
          className="model-input"
          disabled={provider !== 'third-party'}
          placeholder="model"
          value={thirdPartyModel}
          onChange={(event) => setThirdPartyModel(event.target.value)}
        />
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
      </section>

      <section className="workspace">
        <aside className="queue-panel" aria-label="Processing queue">
          <div className="panel-title">
            <div>
              <h2>处理队列</h2>
              <span>按添加顺序逐个转写</span>
            </div>
            <span>
              {completedJobs}/{jobs.length} 完成
            </span>
          </div>

          {jobs.length === 0 ? (
            <div className="empty-state">
              <strong>暂无文件</strong>
              <span>选择音频或视频文件后会按顺序处理。</span>
            </div>
          ) : (
            <div className="job-list">
              {jobs.map((job) => (
                <button
                  type="button"
                  key={job.id}
                  className={selectedJob?.id === job.id ? 'job-row selected' : 'job-row'}
                  onClick={() => setSelectedJobId(job.id)}
                >
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
                  <div className={`job-status ${job.status}`}>
                    <span className="job-status-dot" />
                    {job.status === 'running'
                      ? `${Math.round(job.progress)}%`
                      : statusLabels[job.status]}
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${job.progress}%` }} />
                  </div>
                  {job.error ? <p className="job-error">{job.error}</p> : null}
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="transcript-panel" aria-label="Transcript preview">
          <div className="panel-title">
            <div>
              <h2>{selectedJob?.fileName || '文字稿预览'}</h2>
              <span>{selectedJob ? `${selectedJob.segments.length} 句` : '等待文件处理'}</span>
            </div>
            <div className="export-actions">
              <button
                type="button"
                className="ghost-button"
                disabled={!selectedJob || selectedJob.segments.length === 0}
                onClick={() => openReader(0)}
              >
                展开阅读
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={selectedJob?.status !== 'completed'}
                onClick={() =>
                  selectedJob && window.api.asr.exportTranscript(selectedJob.id, 'txt')
                }
              >
                导出 TXT
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={selectedJob?.status !== 'completed'}
                onClick={() =>
                  selectedJob && window.api.asr.exportTranscript(selectedJob.id, 'srt')
                }
              >
                导出 SRT
              </button>
            </div>
          </div>

          {detailJob ? (
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
                  {detailJob.stage
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
          ) : (
            <TranscriptSegmentList
              segments={selectedJob.segments}
              variant="compact"
              onSegmentDoubleClick={(index) => openReader(index)}
            />
          )}
        </section>
      </section>

      {readerOpen && selectedJob && selectedJob.segments.length > 0 ? (
        <TranscriptReader
          job={selectedJob}
          initialSegmentIndex={readerInitialIndex}
          onClose={() => setReaderOpen(false)}
          onExport={(format) => void window.api.asr.exportTranscript(selectedJob.id, format)}
        />
      ) : null}
    </main>
  )
}

export default App
