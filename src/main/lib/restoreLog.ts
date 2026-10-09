import { app } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'

// TEMP diagnostics for the terminal-restore bug — remove once the cause is confirmed.
// Sync append so quit-time lines land before the process exits.
export function restoreLog(event: string, data: Record<string, unknown> = {}): void {
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`
  console.info(`[restore] ${line.trimEnd()}`)
  try {
    appendFileSync(join(app.getPath('userData'), 'restore-debug.log'), line)
  } catch {
    // diagnostics must never break the app
  }
}
