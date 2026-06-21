import { useEffect, useId, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import mermaid from 'mermaid'

interface MarkdownRendererProps {
  content: string
  streaming?: boolean
}

let mermaidInitialized = false

function initMermaid(): void {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    fontFamily: 'inherit'
  })
  mermaidInitialized = true
}

function isCompleteMermaidBlock(source: string): boolean {
  const matches = source.match(/```mermaid[\s\S]*?```/g)
  if (!matches) return false
  return matches.every((block) => block.trim().endsWith('```'))
}

function MermaidBlock({ code }: { code: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const renderId = useId().replace(/:/g, '')
  const [error, setError] = useState('')

  useEffect(() => {
    initMermaid()
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    const render = async (): Promise<void> => {
      try {
        const { svg } = await mermaid.render(`mermaid-${renderId}`, code.trim())
        if (cancelled) return
        container.innerHTML = svg
        setError('')
      } catch (renderError) {
        if (cancelled) return
        setError(renderError instanceof Error ? renderError.message : 'Mermaid 渲染失败')
      }
    }

    void render()
    return () => {
      cancelled = true
    }
  }, [code, renderId])

  if (error) {
    return (
      <div className="mermaid-fallback">
        <p className="mermaid-error">Mermaid 图渲染失败：{error}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  return <div className="mermaid-block" ref={containerRef} />
}

export function MarkdownRenderer({
  content,
  streaming = false
}: MarkdownRendererProps): React.JSX.Element {
  const canRenderMermaid = useMemo(() => !streaming || isCompleteMermaidBlock(content), [
    content,
    streaming
  ])

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          code(props) {
            const { className, children, ...rest } = props
            const language = /language-(\w+)/.exec(className || '')?.[1]
            const codeText = String(children).replace(/\n$/, '')

            if (language === 'mermaid') {
              if (!canRenderMermaid) {
                return (
                  <pre className="mermaid-pending">
                    <code {...rest} className={className}>
                      {children}
                    </code>
                  </pre>
                )
              }
              return <MermaidBlock code={codeText} />
            }

            const isBlock = className?.includes('language-')
            if (isBlock) {
              return (
                <pre>
                  <code {...rest} className={className}>
                    {children}
                  </code>
                </pre>
              )
            }

            return (
              <code {...rest} className={className}>
                {children}
              </code>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}