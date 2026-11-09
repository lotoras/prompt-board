import os from 'os'
import { join } from 'path'
import type { ClaudeAccountId } from '../shared/types'

export function accountConfigDir(account: ClaudeAccountId): string {
  return join(os.homedir(), account === 2 ? '.claude-2' : '.claude')
}

export function accountLauncher(account: ClaudeAccountId): string {
  return account === 2 ? 'clauded2' : 'clauded'
}
