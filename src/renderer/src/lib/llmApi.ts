async function invokeLlm<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.electron?.ipcRenderer?.invoke) {
    throw new Error('Electron IPC 不可用，请重启应用后重试')
  }
  return window.electron.ipcRenderer.invoke(channel, ...args) as Promise<T>
}

export const llmApi = {
  getConfig: (): Promise<LlmConfigPublic> => invokeLlm('llm:get-config'),
  saveConfig: (input: LlmConfigInput): Promise<LlmConfigPublic> =>
    invokeLlm('llm:save-config', input),
  testConnection: (override?: Partial<LlmConfigInput>): Promise<LlmTestResult> =>
    invokeLlm('llm:test-connection', override),
  listModels: (override?: Partial<LlmConfigInput>): Promise<LlmListModelsResult> =>
    invokeLlm('llm:list-models', override),
  getSummary: (jobId: string): Promise<KnowledgeSummaryResult | null> =>
    invokeLlm('llm:get-summary', jobId),
  generateSummary: (jobId: string, courseType?: CourseType): Promise<KnowledgeSummaryRecord> =>
    invokeLlm('llm:generate-summary', jobId, courseType),
  cancelSummary: (jobId: string): Promise<boolean> => invokeLlm('llm:cancel-summary', jobId),
  exportSummary: (jobId: string): Promise<void> => invokeLlm('llm:export-summary', jobId),
  saveSummaryImageFromClipboard: (jobId: string): Promise<void> =>
    invokeLlm('llm:save-summary-image-from-clipboard', jobId),
  onSummaryChunk: (callback: (event: SummaryProgressEvent) => void): (() => void) =>
    window.api.llm.onSummaryChunk(callback),
  onSummaryDone: (callback: (event: SummaryDoneEvent) => void): (() => void) =>
    window.api.llm.onSummaryDone(callback),
  onSummaryError: (callback: (event: SummaryErrorEvent) => void): (() => void) =>
    window.api.llm.onSummaryError(callback)
}
