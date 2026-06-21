import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Md2Poster,
  Md2PosterContent,
  Md2PosterFooter,
  Md2PosterHeader
} from 'markdown-to-image'

interface Md2PosterHandle {
  handleCopy: () => Promise<unknown>
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export async function copySummaryImageToClipboard(
  markdown: string,
  title: string
): Promise<void> {
  const host = document.createElement('div')
  host.className = 'summary-image-export-host'
  document.body.append(host)

  const posterRef = createRef<Md2PosterHandle>()
  const root = createRoot(host)

  try {
    await import('markdown-to-image/dist/style.css')
    root.render(
      <Md2Poster ref={posterRef} theme="gray" size="desktop" aspectRatio="auto">
        <Md2PosterHeader className="summary-image-export-header">{title}</Md2PosterHeader>
        <Md2PosterContent>{markdown}</Md2PosterContent>
        <Md2PosterFooter className="summary-image-export-footer">
          知识总结
        </Md2PosterFooter>
      </Md2Poster>
    )
    await waitForPaint()
    if (!posterRef.current) throw new Error('知识总结图片渲染失败')
    await posterRef.current.handleCopy()
  } finally {
    root.unmount()
    host.remove()
  }
}
