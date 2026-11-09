import { existsSync } from 'fs'
import os from 'os'
import { isAbsolute, join, relative } from 'path'
import { CLAUDE_ACCOUNTS, type AccountInfo, type ClaudeAccountId } from '../shared/types'

export function accountConfigDir(account: ClaudeAccountId): string {
  return join(os.homedir(), account === 2 ? '.claude-2' : '.claude')
}

export function accountLauncher(account: ClaudeAccountId): string {
  return account === 2 ? 'clauded2' : 'clauded'
}

/** A copy of `env` for a process of `account`. Claude 1 must never inherit a config dir. */
export function withAccountEnv(
  env: Record<string, string | undefined>,
  account: ClaudeAccountId
): Record<string, string | undefined> {
  const next = { ...env }
  if (account === 2) next.CLAUDE_CONFIG_DIR = accountConfigDir(2)
  else delete next.CLAUDE_CONFIG_DIR
  return next
}

export function accountOfPath(path: string): ClaudeAccountId {
  const rel = relative(accountConfigDir(2), path)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? 2 : 1
}

export function listAccounts(): AccountInfo[] {
  return CLAUDE_ACCOUNTS.map((a) => ({
    ...a,
    available: a.id === 1 || existsSync(accountConfigDir(a.id))
  }))
}
