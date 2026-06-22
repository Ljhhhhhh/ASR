import { randomUUID } from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { renderMermaid } from '@vercel/beautiful-mermaid'
import { BrowserWindow } from 'electron'
import { marked } from 'marked'

const MERMAID_BLOCK_RE = /```mermaid\s*([\s\S]*?)```/gi

const MERMAID_THEME = {
  bg: '#ffffff',
  fg: '#0a0a0a',
  line: '#0a0a0a',
  accent: '#0a0a0a',
  muted: '#737373',
  surface: '#f2f2f2',
  border: '#e5e5e5'
}

const SUMMARY_PDF_CSS = `
@page {
  size: A4;
  margin: 18mm;
}

html,
body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #0a0a0a;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

.markdown-body {
  max-width: 760px;
  margin: 0 auto;
  color: #0a0a0a;
  font-size: 14px;
  line-height: 1.7;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin: 1.4em 0 0.6em;
  font-weight: 600;
  line-height: 1.35;
  page-break-after: avoid;
}

.markdown-body h1 { font-size: 24px; }
.markdown-body h2 { font-size: 18px; }
.markdown-body h3 { font-size: 15px; }

.markdown-body p,
.markdown-body ul,
.markdown-body ol,
.markdown-body blockquote {
  margin: 0.75em 0;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 1.4em;
}

.markdown-body li + li {
  margin-top: 0.35em;
}

.markdown-body blockquote {
  padding-left: 14px;
  border-left: 3px solid #e5e5e5;
  color: #737373;
}

.markdown-body table {
  width: 100%;
  margin: 1em 0;
  border-collapse: collapse;
  font-size: 13px;
  page-break-inside: avoid;
}

.markdown-body th,
.markdown-body td {
  padding: 8px 10px;
  border: 1px solid #e5e5e5;
  text-align: left;
}

.markdown-body th {
  background: #f2f2f2;
}

.markdown-body pre {
  margin: 1em 0;
  padding: 12px 14px;
  overflow: auto;
  border-radius: 10px;
  background: #f2f2f2;
  page-break-inside: avoid;
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.markdown-body :not(pre) > code {
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background: #f2f2f2;
}

.markdown-body hr {
  margin: 1.5em 0;
  border: none;
  border-top: 1px solid #e5e5e5;
}

.mermaid-block {
  margin: 1em 0;
  page-break-inside: avoid;
  text-align: center;
}

.mermaid-block svg {
  max-width: 100%;
  height: auto;
}
`

marked.setOptions({
  gfm: true,
  breaks: false
})

let pdfWindow: BrowserWindow | null = null

async function preprocessMermaidBlocks(markdown: string): Promise<string> {
  const parts: string[] = []
  let lastIndex = 0
  const pattern = new RegExp(MERMAID_BLOCK_RE.source, MERMAID_BLOCK_RE.flags)
  let match: RegExpExecArray | null

  while ((match = pattern.exec(markdown)) !== null) {
    parts.push(markdown.slice(lastIndex, match.index))
    const code = match[1].trim()
    try {
      const svg = await renderMermaid(code, MERMAID_THEME)
      parts.push(`\n<div class="mermaid-block">${svg}</div>\n`)
    } catch {
      parts.push(match[0])
    }
    lastIndex = match.index + match[0].length
  }

  parts.push(markdown.slice(lastIndex))
  return parts.join('')
}

function buildSummaryExportHtml(bodyHtml: string, title: string): string {
  const escapedTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>${escapedTitle}</title>
    <style>${SUMMARY_PDF_CSS}</style>
  </head>
  <body>
    <div class="markdown-body">${bodyHtml}</div>
  </body>
</html>`
}

async function getPdfWindow(): Promise<BrowserWindow> {
  if (pdfWindow && !pdfWindow.isDestroyed()) return pdfWindow

  pdfWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  pdfWindow.on('closed', () => {
    pdfWindow = null
  })

  return pdfWindow
}

async function printHtmlToPdf(html: string): Promise<Buffer> {
  const tempPath = join(tmpdir(), `asr-summary-${randomUUID()}.html`)
  await writeFile(tempPath, html, 'utf8')

  try {
    const window = await getPdfWindow()
    await window.loadFile(tempPath)
    await new Promise((resolve) => setTimeout(resolve, 300))

    const buffer = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: {
        marginType: 'custom',
        top: 0.7,
        bottom: 0.7,
        left: 0.7,
        right: 0.7
      }
    })

    return Buffer.from(buffer)
  } finally {
    await unlink(tempPath).catch(() => undefined)
  }
}

export async function convertSummaryMarkdownToPdf(
  markdown: string,
  title = '知识总结'
): Promise<Buffer> {
  const prepared = await preprocessMermaidBlocks(markdown.trim())
  const bodyHtml = await marked.parse(prepared)
  const documentHtml = buildSummaryExportHtml(bodyHtml, title)
  return printHtmlToPdf(documentHtml)
}

export function closeSummaryPdfWindow(): void {
  if (pdfWindow && !pdfWindow.isDestroyed()) {
    pdfWindow.close()
  }
  pdfWindow = null
}