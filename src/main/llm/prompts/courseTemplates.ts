import { withNoThink } from '../promptUtils'

export type CourseType = 'training' | 'interview' | 'lecture'

export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  training: '培训讲座',
  interview: '访谈对话',
  lecture: '系统讲课'
}

const CLEAN_BASE = `你是培训课程文字稿整理员。输入是 ASR 转写的口播文本（含时间戳）。

任务：输出「净化后的讲义正文」，不是总结。

必须删除：
- 开场互动、猜谜、举手、奖品、订衣服、猎头等无关内容
- 重复口癖（就是、那个、然后呢、其实）
- 与知识无关的玩笑、影视梗、广告插播

必须保留：
- 概念定义、论点、逻辑链条、框架与模型名称
- 人物与书籍引用
- 每段开头的 [MM:SS] 或 [HH:MM:SS] 时间戳

输出：按主题分段的干净中文讲义，不要 Markdown 标题，不要 JSON。`

const CLEAN_BY_TYPE: Record<CourseType, string> = {
  training: `${CLEAN_BASE}\n\n本课为培训讲座：优先保留课程定位、逻辑链条、框架模型、职业建议，删除所有课堂互动。`,
  interview: `${CLEAN_BASE}\n\n本课为访谈对话：保留问答中的观点与论据，删除寒暄；用「问：」「答：」标注主体。`,
  lecture: `${CLEAN_BASE}\n\n本课为系统讲课：保留完整知识递进结构，仅删除口癖与明显跑题。`
}

const MERMAID_FLOWCHART_TEMPLATE = `\`\`\`mermaid
flowchart LR
  nodeA["核心概念A"] --> nodeB["核心概念B"]
  nodeB --> nodeC["核心概念C"]
  nodeC --> nodeA
\`\`\``

const COMPOSE_BASE = `你是面向学习者的知识笔记编辑。根据净化后的课程精华稿生成 Markdown 学习笔记。

输出要求：
- 仅输出 Markdown，不要代码围栏外的解释
- 不要编造笔记中未出现的内容
- Mermaid 只用 flowchart LR 或 flowchart TD，节点 ID 用 camelCase，中文标签用双引号
- 不要使用 mindmap
- 知识脉络图必须基于以下模板填空（保留结构，替换节点标签文字；若逻辑链不足 3 节点可删减）：
${MERMAID_FLOWCHART_TEMPLATE}

建议结构（可省略无内容的章节）：

# 课程标题

> 来源：文件名

## 本节一句话

## 核心逻辑链
（填入模板化 flowchart）

## 必记概念
### 1. 概念名
- **含义**：
- **讲师位置**：MM:SS

## 框架卡片
| 框架 | 要点 | 时间 |

## 术语速查
| 术语 | 一句话 |

## 课后自测
- [ ] ...`

const COMPOSE_BY_TYPE: Record<CourseType, string> = {
  training: `${COMPOSE_BASE}\n\n培训讲座笔记：突出逻辑链条、框架卡片、职业/组织洞察；语气简洁。`,
  interview: `${COMPOSE_BASE}\n\n访谈笔记：增加「观点对照」小节，列出不同嘉宾/角色的核心观点。`,
  lecture: `${COMPOSE_BASE}\n\n系统讲课笔记：按知识递进排列章节，概念定义要完整。`
}

const MERMAID_REPAIR = `你是 Mermaid 语法修复器。输入可能错误的 mermaid 代码块，输出可渲染的版本。

要求：
- 仅输出 mermaid 代码，不要围栏，不要解释
- 只使用 flowchart LR 或 flowchart TD
- 不要使用 mindmap
- 节点 ID 用 camelCase，中文标签用双引号
- 保持原图语义，节点数不超过 8 个`

export function getCleanSystemPrompt(courseType: CourseType): string {
  return withNoThink(CLEAN_BY_TYPE[courseType])
}

export function getComposeSystemPrompt(courseType: CourseType): string {
  return withNoThink(COMPOSE_BY_TYPE[courseType])
}

export function getMermaidRepairSystemPrompt(): string {
  return withNoThink(MERMAID_REPAIR)
}

export function normalizeCourseType(value: unknown): CourseType {
  if (value === 'interview' || value === 'lecture') return value
  return 'training'
}
