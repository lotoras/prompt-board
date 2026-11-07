import { EFFORT_LEVELS, contextTokens, parseDirectives } from '../../shared/chat'
import type { ChatItem, EffortLevel } from '../../shared/types'
import { diffForWrite, diffFromPatch, diffFromStrings, type PatchHunk } from './diff'

export interface TranscriptMeta {
  aiTitle?: string
  model?: string
  effort?: EffortLevel
  gitBranch?: string
  contextTokens?: number
  totalTokens: number
  cwd?: string
}

export interface TranscriptRecord {
  type: string
  subtype?: string
  uuid?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: { id?: string; role?: string; model?: string; content?: unknown; usage?: unknown }
  toolUseResult?: unknown
  aiTitle?: string
  effort?: string
  gitBranch?: string
  cwd?: string
  durationMs?: number
  timestamp?: string
}

export interface ParserState {
  items: Map<string, ChatItem>
  meta: TranscriptMeta
  runningAgents: string[]
  seq: number
}

const RESULT_MAX = 120
const SUMMARY_MAX = 100
const IGNORED_USER_PREFIXES = ['<local-command-caveat>', '<local-command-stdout>', '<system-reminder>']
const DIFF_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
const PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null
}

export function createParserState(cwd?: string): ParserState {
  return {
    items: new Map(),
    meta: { totalTokens: 0, ...(cwd ? { cwd } : {}) },
    runningAgents: [],
    seq: 0
  }
}

export function getItems(state: ParserState): ChatItem[] {
  return [...state.items.values()]
}

export function getMeta(state: ParserState): TranscriptMeta {
  return { ...state.meta }
}

function firstLine(text: string, max: number): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? ''
  return line.trim().slice(0, max)
}

function relativePath(path: string, cwd?: string): string {
  if (!cwd) return path
  const p = path.replace(/\\/g, '/')
  const base = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (p.toLowerCase().startsWith(base.toLowerCase() + '/')) return p.slice(base.length + 1)
  return path
}

export function toolSummary(name: string, input: unknown, cwd?: string): string {
  const i: Obj = isObj(input) ? input : {}
  const str = (k: string): string => (typeof i[k] === 'string' ? (i[k] as string) : '')
  if (PATH_TOOLS.has(name)) {
    const path = str('file_path') || str('notebook_path')
    return path ? relativePath(path, cwd) : ''
  }
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return firstLine(str('command'), SUMMARY_MAX)
    case 'Grep':
      return `"${str('pattern')}" in ${str('path') || '.'}`
    case 'Glob':
      return str('pattern')
    case 'WebFetch':
      return str('url')
    case 'WebSearch':
      return str('query')
    case 'Skill':
      return str('skill')
    case 'TodoWrite':
      return `${Array.isArray(i.todos) ? i.todos.length : 0} todos`
  }
  for (const v of Object.values(i)) {
    if (typeof v === 'string') return firstLine(v, SUMMARY_MAX)
  }
  return ''
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (isObj(b) && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function userItem(
  state: ParserState,
  record: TranscriptRecord,
  text: string,
  imageCount: number
): ChatItem {
  const parsed = parseDirectives(text)
  const attachments: { name: string; kind: 'image' | 'file' }[] = parsed.files.map((f) => ({
    name: basename(f),
    kind: 'file'
  }))
  for (let n = 0; n < imageCount; n++) attachments.push({ name: 'image', kind: 'image' })
  const ts = record.timestamp ? Date.parse(record.timestamp) : NaN
  return {
    kind: 'user',
    id: record.uuid ?? `rec-${++state.seq}`,
    text: parsed.text,
    directives: parsed.directives,
    attachments,
    ...(Number.isFinite(ts) ? { ts } : {})
  }
}

function put(state: ParserState, item: ChatItem, out: Map<string, ChatItem>): void {
  state.items.set(item.id, item)
  out.set(item.id, item)
}

function applyToolResult(
  state: ParserState,
  record: TranscriptRecord,
  block: Obj,
  out: Map<string, ChatItem>
): void {
  const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
  const item = state.items.get(id)
  if (!item) return
  const isError = block.is_error === true
  const text = resultText(block.content)
  if (item.kind === 'tool' || item.kind === 'agent') {
    const status = isError ? 'error' : 'ok'
    const result = firstLine(text, RESULT_MAX)
    let next: ChatItem = { ...item, status, result }
    if (item.kind === 'agent') {
      state.runningAgents = state.runningAgents.filter((a) => a !== id)
    } else if (DIFF_TOOLS.has(item.name) && isObj(record.toolUseResult)) {
      const patch = record.toolUseResult.structuredPatch
      if (Array.isArray(patch)) {
        const file =
          item.diff?.file ??
          (typeof record.toolUseResult.filePath === 'string'
            ? record.toolUseResult.filePath
            : item.summary)
        next = { ...next, diff: diffFromPatch(file, patch as PatchHunk[]) } as ChatItem
      }
    }
    put(state, next, out)
  } else if (item.kind === 'question') {
    const answers: Record<string, string> = {}
    for (const m of text.matchAll(/"([^"]+)"="([^"]*)"/g)) answers[m[1]] = m[2]
    if (isError || Object.keys(answers).length === 0) put(state, { ...item, state: 'skipped' }, out)
    else put(state, { ...item, state: 'answered', answers }, out)
  } else if (item.kind === 'plan') {
    put(
      state,
      { ...item, state: text.startsWith('User has approved') ? 'approved' : 'rejected' },
      out
    )
  }
}

function applyUser(state: ParserState, record: TranscriptRecord, out: Map<string, ChatItem>): void {
  if (record.isMeta) return
  const content = record.message?.content
  if (typeof content === 'string') {
    if (IGNORED_USER_PREFIXES.some((p) => content.trimStart().startsWith(p))) return
    const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(content)
    if (name) {
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(content)
      put(
        state,
        {
          kind: 'command',
          id: record.uuid ?? `rec-${++state.seq}`,
          name: name[1].trim(),
          args: (args?.[1] ?? '').trim()
        },
        out
      )
      return
    }
    put(state, userItem(state, record, content, 0), out)
    return
  }
  if (!Array.isArray(content)) return
  const texts: string[] = []
  let images = 0
  for (const raw of content) {
    if (!isObj(raw)) continue
    if (raw.type === 'text' && typeof raw.text === 'string') texts.push(raw.text)
    else if (raw.type === 'image') images++
    else if (raw.type === 'tool_result') applyToolResult(state, record, raw, out)
  }
  const text = texts.join('\n')
  if (!text && images === 0) return
  if (IGNORED_USER_PREFIXES.some((p) => text.trimStart().startsWith(p))) return
  put(state, userItem(state, record, text, images), out)
}

function applyToolUse(
  state: ParserState,
  id: string,
  name: string,
  input: Obj,
  out: Map<string, ChatItem>
): void {
  if (name === 'Agent' || name === 'Task') {
    state.runningAgents.push(id)
    put(
      state,
      {
        kind: 'agent',
        id,
        agentType: typeof input.subagent_type === 'string' ? input.subagent_type : 'general-purpose',
        description: typeof input.description === 'string' ? input.description : '',
        status: 'running'
      },
      out
    )
    return
  }
  if (name === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? (input.questions as never[]) : []
    put(state, { kind: 'question', id, questions, state: 'pending' }, out)
    return
  }
  if (name === 'ExitPlanMode') {
    put(
      state,
      { kind: 'plan', id, plan: typeof input.plan === 'string' ? input.plan : '', state: 'pending' },
      out
    )
    return
  }
  const summary = toolSummary(name, input, state.meta.cwd)
  const tool: Extract<ChatItem, { kind: 'tool' }> = {
    kind: 'tool',
    id,
    name,
    summary,
    status: 'running'
  }
  if (name === 'Edit') {
    tool.diff = diffFromStrings(summary, String(input.old_string ?? ''), String(input.new_string ?? ''))
  } else if (name === 'MultiEdit') {
    const edits = (Array.isArray(input.edits) ? input.edits : []).filter(isObj)
    tool.diff = diffFromStrings(
      summary,
      edits.map((e) => String(e.old_string ?? '')).join('\n'),
      edits.map((e) => String(e.new_string ?? '')).join('\n')
    )
  } else if (name === 'Write') {
    tool.diff = diffForWrite(summary, String(input.content ?? ''))
  }
  put(state, tool, out)
}

function applyAssistant(
  state: ParserState,
  record: TranscriptRecord,
  out: Map<string, ChatItem>
): void {
  const message = record.message
  const sidechain = record.isSidechain === true
  if (isObj(message?.usage)) {
    const u = message.usage
    for (const k of [
      'input_tokens',
      'output_tokens',
      'cache_creation_input_tokens',
      'cache_read_input_tokens'
    ]) {
      if (typeof u[k] === 'number') state.meta.totalTokens += u[k] as number
    }
    if (!sidechain) state.meta.contextTokens = contextTokens(u)
  }
  if (!sidechain) {
    if (typeof message?.model === 'string') state.meta.model = message.model
    if (record.effort && (EFFORT_LEVELS as string[]).includes(record.effort)) {
      state.meta.effort = record.effort as EffortLevel
    }
  }
  const content = message?.content
  if (!Array.isArray(content)) return
  const uuid = record.uuid ?? `rec-${++state.seq}`

  content.forEach((raw, i) => {
    if (!isObj(raw)) return
    if (sidechain) {
      if (raw.type === 'tool_use') {
        const agentId = state.runningAgents[state.runningAgents.length - 1]
        const agent = agentId ? state.items.get(agentId) : undefined
        if (agent?.kind === 'agent') {
          put(state, { ...agent, toolCount: (agent.toolCount ?? 0) + 1 }, out)
        }
      }
      return
    }
    if (raw.type === 'text') {
      if (typeof raw.text === 'string' && raw.text) {
        put(state, { kind: 'assistant', id: `${uuid}:${i}`, markdown: raw.text }, out)
      }
    } else if (raw.type === 'thinking') {
      if (typeof raw.thinking === 'string' && raw.thinking) {
        put(state, { kind: 'thinking', id: `${uuid}:${i}`, text: raw.thinking }, out)
      }
    } else if (raw.type === 'tool_use' && typeof raw.id === 'string') {
      applyToolUse(
        state,
        raw.id,
        typeof raw.name === 'string' ? raw.name : '',
        isObj(raw.input) ? raw.input : {},
        out
      )
    }
  })
}

export function applyRecord(state: ParserState, record: TranscriptRecord): ChatItem[] {
  const out = new Map<string, ChatItem>()
  if (typeof record.gitBranch === 'string') state.meta.gitBranch = record.gitBranch
  if (typeof record.cwd === 'string') state.meta.cwd = record.cwd
  if (typeof record.aiTitle === 'string') state.meta.aiTitle = record.aiTitle

  if (record.type === 'user') {
    if (record.isSidechain !== true) applyUser(state, record, out)
  } else if (record.type === 'assistant') {
    applyAssistant(state, record, out)
  } else if (record.type === 'system') {
    const id = record.uuid ?? `rec-${++state.seq}`
    if (record.subtype === 'turn_duration') {
      put(state, { kind: 'turn-end', id, durationMs: record.durationMs ?? 0 }, out)
    } else if (record.subtype === 'compact_boundary') {
      put(state, { kind: 'system', id, text: 'Context compacted' }, out)
    }
  }
  return [...out.values()]
}

export function parseLines(state: ParserState, lines: string[]): ChatItem[] {
  const out = new Map<string, ChatItem>()
  for (const line of lines) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(record) || typeof record.type !== 'string') continue
    for (const item of applyRecord(state, record as unknown as TranscriptRecord)) {
      out.set(item.id, item)
    }
  }
  return [...out.values()]
}
