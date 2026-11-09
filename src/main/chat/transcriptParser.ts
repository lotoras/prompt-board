import { EFFORT_LEVELS, SYNTHETIC_MODEL, contextTokens, parseDirectives } from '../../shared/chat'
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
  parentUuid?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  message?: { id?: string; role?: string; model?: string; content?: unknown; usage?: unknown }
  toolUseResult?: unknown
  aiTitle?: string
  effort?: string
  gitBranch?: string
  cwd?: string
  durationMs?: number
  timestamp?: string
  /** Text of a system record. */
  content?: unknown
  level?: string
  status?: string
  summary?: string
  attachment?: { type?: string; prompt?: unknown; [key: string]: unknown }
}

export interface ParserState {
  items: Map<string, ChatItem>
  meta: TranscriptMeta
  runningAgents: string[]
  seq: number
  chain: { uuid: string; created: string[] }[]
  fresh: string[]
}

const RESULT_MAX = 120
const SUMMARY_MAX = 100
const IGNORED_USER_PREFIXES = ['<local-command-caveat>', '<local-command-stdout>', '<system-reminder>']
/** Claude Code records a stopped turn as a plain user line; it is not something the user typed. */
const INTERRUPT_MARKER = /^\[Request interrupted by user/

const LOCAL_OUTPUT = /^<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>$/
const ANSI_CODES = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[ -/]*[@-~]', 'g')
const NO_RESPONSE = 'No response requested.'

function plainUserText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content) || content.length !== 1) return ''
  const block = content[0]
  return isObj(block) && block.type === 'text' && typeof block.text === 'string' ? block.text.trim() : ''
}
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
    seq: 0,
    chain: [],
    fresh: []
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

/** Claude Code appends "Shell cwd was reset to …" to Bash/PowerShell results; it is not the output. */
function stripShellNotice(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^Shell cwd was reset to /.test(l.trim()))
    .join('\n')
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
    parentUuid: record.parentUuid ?? null,
    ...(Number.isFinite(ts) ? { ts } : {})
  }
}

/** Output of a local slash command, or undefined when `text` is something else. */
function localOutput(text: string): string | undefined {
  const match = LOCAL_OUTPUT.exec(text.trim())
  return match ? match[2].replace(ANSI_CODES, '').trim() : undefined
}

function tagText(text: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1].trim()
}

function taskNote(id: string, summary: string | undefined, status: string | undefined): ChatItem {
  return {
    kind: 'system',
    id,
    tone: status === 'failed' ? 'error' : 'info',
    text: summary || 'A background task finished'
  }
}

function put(state: ParserState, item: ChatItem, out: Map<string, ChatItem>): void {
  if (!state.items.has(item.id)) state.fresh.push(item.id)
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
    const result = firstLine(stripShellNotice(text), RESULT_MAX)
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

/** Same id as the live view, so a command's output looks the same before and after a reload. */
function putLocalOutput(
  state: ParserState,
  record: TranscriptRecord,
  output: string,
  out: Map<string, ChatItem>
): void {
  // "Compacted" only repeats the compaction note.
  if (!output || output === 'Compacted') return
  put(state, { kind: 'assistant', id: `${record.uuid ?? `rec-${++state.seq}`}:0`, markdown: output }, out)
}

function applyUser(state: ParserState, record: TranscriptRecord, out: Map<string, ChatItem>): void {
  if (record.isMeta || record.isCompactSummary || record.isVisibleInTranscriptOnly) return
  const content = record.message?.content
  const plain = plainUserText(content)
  if (INTERRUPT_MARKER.test(plain)) {
    put(state, { kind: 'system', id: record.uuid ?? `rec-${++state.seq}`, tone: 'info', text: 'Stopped' }, out)
    return
  }
  const output = localOutput(plain)
  if (output !== undefined) {
    putLocalOutput(state, record, output, out)
    return
  }
  if (plain.startsWith('<task-notification>')) {
    const id = record.uuid ?? `rec-${++state.seq}`
    put(state, taskNote(id, tagText(plain, 'summary'), tagText(plain, 'status')), out)
    return
  }
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
          args: parseDirectives((args?.[1] ?? '').trim()).text.trim()
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
  const synthetic = message?.model === SYNTHETIC_MODEL
  if (isObj(message?.usage) && !synthetic) {
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
  if (!sidechain && !synthetic) {
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
      if (typeof raw.text === 'string' && raw.text && !(synthetic && raw.text === NO_RESPONSE)) {
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

function isPromptRecord(record: TranscriptRecord): boolean {
  if (record.type !== 'user' || record.isSidechain === true || record.isMeta) return false
  if (INTERRUPT_MARKER.test(plainUserText(record.message?.content))) return false
  const content = record.message?.content
  if (typeof content === 'string') return true
  return (
    Array.isArray(content) &&
    content.some((b) => isObj(b) && (b.type === 'text' || b.type === 'image')) &&
    !content.some((b) => isObj(b) && b.type === 'tool_result')
  )
}

function truncateBranch(state: ParserState, record: TranscriptRecord): void {
  const parent = record.parentUuid
  if (!parent || !isPromptRecord(record)) return
  const tip = state.chain[state.chain.length - 1]
  if (!tip || tip.uuid === parent) return
  const at = state.chain.findIndex((c) => c.uuid === parent)
  if (at < 0) return
  for (const dropped of state.chain.splice(at + 1)) {
    for (const id of dropped.created) {
      state.items.delete(id)
      state.runningAgents = state.runningAgents.filter((a) => a !== id)
    }
  }
}

/**
 * Last real main-chain uuid (the parent a new prompt attaches to). Skips the synthetic
 * `turn-…` records the runner adds for live turn ends; null when the chain is empty.
 */
export function chainTip(state: ParserState): string | null {
  for (let i = state.chain.length - 1; i >= 0; i--) {
    if (!state.chain[i].uuid.startsWith('turn-')) return state.chain[i].uuid
  }
  return null
}

/** Drops `itemId` and every item after it (insertion order), plus the chain entries that created them. */
export function dropItemsFrom(state: ParserState, itemId: string): void {
  const ids = [...state.items.keys()]
  const at = ids.indexOf(itemId)
  if (at < 0) return
  const dropped = new Set(ids.slice(at))
  for (const id of dropped) state.items.delete(id)
  state.runningAgents = state.runningAgents.filter((a) => !dropped.has(a))
  const cut = state.chain.findIndex((c) => c.created.some((id) => dropped.has(id)))
  if (cut >= 0) state.chain.splice(cut)
}

function applySystem(state: ParserState, record: TranscriptRecord, out: Map<string, ChatItem>): void {
  const id = record.uuid ?? `rec-${++state.seq}`
  const content = typeof record.content === 'string' ? record.content : ''
  switch (record.subtype) {
    case 'turn_duration':
      put(state, { kind: 'turn-end', id, durationMs: record.durationMs ?? 0 }, out)
      return
    case 'compact_boundary':
      put(state, { kind: 'system', id, text: 'Context compacted' }, out)
      return
    case 'local_command': {
      const output = localOutput(content)
      if (output !== undefined) putLocalOutput(state, { ...record, uuid: id }, output, out)
      return
    }
    case 'informational':
      // Level info is for the terminal's transcript mode only.
      if (content && record.level !== 'info') put(state, { kind: 'system', id, tone: 'info', text: content }, out)
      return
    case 'task_notification':
      put(state, taskNote(id, record.summary, record.status), out)
      return
    case 'model_refusal_fallback':
      if (content) put(state, { kind: 'system', id, tone: 'info', text: content }, out)
      return
    case 'model_refusal_no_fallback':
      if (content) put(state, { kind: 'system', id, tone: 'error', text: content }, out)
      return
  }
}

export function applyRecord(state: ParserState, record: TranscriptRecord): ChatItem[] {
  const out = new Map<string, ChatItem>()
  truncateBranch(state, record)
  state.fresh = []
  if (typeof record.gitBranch === 'string') state.meta.gitBranch = record.gitBranch
  if (typeof record.cwd === 'string') state.meta.cwd = record.cwd
  if (typeof record.aiTitle === 'string') state.meta.aiTitle = record.aiTitle

  if (record.type === 'user') {
    if (record.isSidechain !== true) applyUser(state, record, out)
  } else if (record.type === 'assistant') {
    applyAssistant(state, record, out)
  } else if (record.type === 'system') {
    applySystem(state, record, out)
  } else if (record.type === 'attachment') {
    // A prompt sent while Claude was working is saved only as this attachment.
    if (record.attachment?.type === 'queued_command' && record.isSidechain !== true) {
      applyUser(state, { ...record, message: { content: record.attachment.prompt } }, out)
    }
  }
  if (record.uuid && record.isSidechain !== true && ['user', 'assistant', 'system', 'attachment'].includes(record.type)) {
    state.chain.push({ uuid: record.uuid, created: state.fresh })
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
