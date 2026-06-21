/** Qwen3 系列在 LM Studio 下建议关闭思考模式，避免吞 token */
export function withNoThink(systemPrompt: string): string {
  return `/no_think\n${systemPrompt}`
}