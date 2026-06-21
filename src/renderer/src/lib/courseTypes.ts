export const COURSE_TYPE_OPTIONS: Array<{ id: CourseType; label: string }> = [
  { id: 'training', label: '培训讲座' },
  { id: 'interview', label: '访谈对话' },
  { id: 'lecture', label: '系统讲课' }
]

export const DEFAULT_COURSE_TYPE: CourseType = 'training'

const STAGE_MESSAGES: Record<SummaryStage, string> = {
  extract: '正在清洗课程并提炼核心…',
  train: '正在生成学习训练…',
  migrate: '正在生成业务迁移成品…',
  repair: '正在检查 Mermaid 图表…'
}

export function summaryStageMessage(stage: SummaryStage, fallback?: string): string {
  return fallback || STAGE_MESSAGES[stage]
}
