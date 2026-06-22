import { constants } from 'fs'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { BrowserWindow, dialog } from 'electron'
import { dirname, join } from 'path'

const EXPORT_PREFS_VERSION = 1

interface ExportDirectoryPrefs {
  version: number
  directory: string
  updatedAt: string
}

let cachedDirectory: string | undefined

function getAsrDataDir(): string {
  return join(process.cwd(), '.asr')
}

function getExportDirectoryPrefsPath(): string {
  return join(getAsrDataDir(), 'export-directory.json')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function loadLastExportDirectory(): Promise<string | undefined> {
  if (cachedDirectory && (await pathExists(cachedDirectory))) {
    return cachedDirectory
  }

  try {
    const raw = await readFile(getExportDirectoryPrefsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ExportDirectoryPrefs>
    const directory = typeof parsed.directory === 'string' ? parsed.directory.trim() : ''
    if (!directory || !(await pathExists(directory))) return undefined
    cachedDirectory = directory
    return directory
  } catch {
    return undefined
  }
}

export async function rememberExportDirectory(directory: string): Promise<void> {
  const trimmed = directory.trim()
  if (!trimmed) return

  cachedDirectory = trimmed
  const prefs: ExportDirectoryPrefs = {
    version: EXPORT_PREFS_VERSION,
    directory: trimmed,
    updatedAt: new Date().toISOString()
  }
  const prefsPath = getExportDirectoryPrefsPath()
  await mkdir(dirname(prefsPath), { recursive: true })
  await writeFile(prefsPath, JSON.stringify(prefs, null, 2), 'utf8')
}

export async function rememberExportPath(filePath: string): Promise<void> {
  await rememberExportDirectory(dirname(filePath))
}

export async function buildDefaultSavePath(fileName: string): Promise<string> {
  const lastDirectory = await loadLastExportDirectory()
  return lastDirectory ? join(lastDirectory, fileName) : join(process.cwd(), fileName)
}

export async function pickExportDirectory(
  mainWindow: BrowserWindow,
  title = '选择导出目录'
): Promise<string | undefined> {
  const defaultPath = await loadLastExportDirectory()
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return undefined

  const directory = result.filePaths[0]
  await rememberExportDirectory(directory)
  return directory
}