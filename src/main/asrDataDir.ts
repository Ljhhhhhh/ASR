import { app } from 'electron'
import { join } from 'path'

export function getAsrDataDir(): string {
  const root = app.isPackaged ? app.getPath('userData') : process.cwd()
  return join(root, '.asr')
}