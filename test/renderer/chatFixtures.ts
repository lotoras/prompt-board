import type { ChatAttachment, ChatItem, ChatMeta } from '../../src/shared/types'

export function makeChat(overrides: Partial<ChatMeta> = {}): ChatMeta {
  return {
    chatId: 'chat-1',
    projectKey: 'proj-1',
    sessionId: 'sess-1',
    title: 'My chat',
    cwd: 'C:\\work\\proj-1',
    branch: 'main',
    model: 'opus',
    effort: 'high',
    toggles: { codex: 'off', fanOut: false, think: false },
    permissionMode: 'bypassPermissions',
    account: 1,
    status: 'idle',
    mode: 'sdk',
    started: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

export function makeAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return { path: 'C:\\work\\a.ts', name: 'a.ts', kind: 'file', size: 10, ...overrides }
}

export const user = (id: string, text = id): ChatItem => ({
  kind: 'user',
  id,
  text,
  directives: { codex: 'off', think: false },
  attachments: []
})
export const assistant = (id: string): ChatItem => ({ kind: 'assistant', id, markdown: id })
export const thinking = (id: string): ChatItem => ({ kind: 'thinking', id, text: id })
export const tool = (id: string, extra: Record<string, unknown> = {}): ChatItem =>
  ({ kind: 'tool', id, name: 'Read', summary: id, status: 'ok', ...extra }) as ChatItem
export const agent = (id: string, status: 'running' | 'ok' | 'error' = 'ok'): ChatItem => ({
  kind: 'agent',
  id,
  agentType: 'general-purpose',
  description: id,
  status
})
export const system = (id: string): ChatItem => ({ kind: 'system', id, text: id })
export const command = (id: string): ChatItem => ({ kind: 'command', id, name: '/x', args: '' })
export const turnEnd = (id: string, durationMs = 1000): ChatItem => ({
  kind: 'turn-end',
  id,
  durationMs
})
export const diff = { file: 'a.ts', added: 1, removed: 0, lines: [] }
export const question = (id: string): ChatItem => ({
  kind: 'question',
  id,
  questions: [],
  state: 'pending'
})
export const plan = (id: string): ChatItem => ({ kind: 'plan', id, plan: 'p', state: 'pending' })
export const permission = (id: string, extra: Record<string, unknown> = {}): ChatItem =>
  ({
    kind: 'permission',
    id,
    toolName: 'Bash',
    title: 'Claude wants to run npm test',
    summary: 'npm test',
    canAlwaysAllow: true,
    state: 'pending',
    ...extra
  }) as ChatItem
