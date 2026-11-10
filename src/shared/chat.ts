/**
 * Pure chat helpers shared by main and renderer. No Node, no DOM.
 * Spec: .claude/plans/t3-contracts.md (§ shared/chat.ts).
 */
import type {
  ChatAttachment,
  ChatToggles,
  EffortLevel,
  ModelOption,
  PermissionModeId,
  ParsedDirectives
} from './types'

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'opus', name: 'Opus 5.5', description: 'Most capable for hard, long work' },
  { id: 'fable', name: 'Fable 5.2', description: 'Deep reasoning and design passes' },
  { id: 'sonnet', name: 'Sonnet 5.5', description: 'Fast and strong for everyday coding' },
  { id: 'haiku', name: 'Haiku 5.5', description: 'Quickest, for small edits and sweeps' }
]

/** Exact directive lines composePrompt appends; parseDirectives strips them again. */
export const DIRECTIVE_LINES = {
  ultra: 'ultrathink',
  codexTests: 'use codex',
  codexFull:
    'use codex, and after the tests pass have Codex review the change and address its findings'
} as const

/** Header line of the attached-files block composePrompt appends for non-image files. */
export const ATTACHED_FILES_HEADER = 'Attached files:'

export const DEFAULT_TOGGLES: ChatToggles = { codex: 'off', ultra: false }

/** Composer mode options, in Shift+Tab cycle order (as in the Claude Code TUI). */
export const PERMISSION_MODES: { id: PermissionModeId; label: string; description: string }[] = [
  { id: 'default', label: 'Ask', description: 'Asks before edits and commands' },
  { id: 'acceptEdits', label: 'Accept edits', description: 'Edits files freely, asks before commands' },
  { id: 'plan', label: 'Plan', description: 'Plans first and never asks for access; you approve the plan' },
  { id: 'bypassPermissions', label: 'Full access', description: 'Never asks (like clauded)' }
]

export const DEFAULT_PERMISSION_MODE: PermissionModeId = 'bypassPermissions'

/** The next mode in the Shift+Tab cycle (wraps around). */
export function nextPermissionMode(mode: PermissionModeId): PermissionModeId {
  const i = PERMISSION_MODES.findIndex((m) => m.id === mode)
  return PERMISSION_MODES[(i + 1) % PERMISSION_MODES.length].id
}

/** Short label for a mode id; unknown ids fall back to "Full access". */
export function permissionModeLabel(mode: string | undefined): string {
  return PERMISSION_MODES.find((m) => m.id === mode)?.label ?? 'Full access'
}

/** Normalise an unknown value to a mode id the composer offers (e.g. from settings / old files). */
export function toPermissionMode(value: unknown): PermissionModeId {
  return PERMISSION_MODES.some((m) => m.id === value)
    ? (value as PermissionModeId)
    : DEFAULT_PERMISSION_MODE
}

/** "Resets in 2h 14m" / "Resets in 3d 4h" / "Resets in 12m"; past or missing → "". */
export function formatResetIn(resetsAt: number | undefined, now: number): string {
  if (!resetsAt || resetsAt <= now) return ''
  const totalMin = Math.max(1, Math.round((resetsAt - now) / 60000))
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `Resets in ${d}d ${h}h`
  if (h > 0) return `Resets in ${h}h ${m}m`
  return `Resets in ${m}m`
}

const NL = '\n'
const BLOCK_SEP = '\n\n'
const DIRECTIVE_SET = new Set<string>(Object.values(DIRECTIVE_LINES))
const FAMILY_ALIASES = new Set(['opus', 'fable', 'sonnet', 'haiku', 'default'])
const MODEL_ID = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/

function slug(text: string, max = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

/**
 * Build the prompt text actually sent to Claude:
 *   <text trimmed>
 *   [blank line, `Attached files:`, one `- <path>` line per NON-image attachment]
 *   [blank line, directive lines: ultra first, then the codex line]
 * Image attachments are sent as image blocks by main, so they are not listed.
 * With no files and no directives the result is the trimmed text.
 */
/** `message.model` of records Claude Code writes itself (command output, placeholders). */
export const SYNTHETIC_MODEL = '<synthetic>'

export function composePrompt(
  text: string,
  toggles: ChatToggles,
  attachments: Pick<ChatAttachment, 'path' | 'kind'>[]
): string {
  const parts: string[] = []
  const body = text.trim()
  if (body) parts.push(body)
  const files = attachments.filter((a) => a.kind !== 'image').map((a) => a.path)
  if (files.length) parts.push([ATTACHED_FILES_HEADER, ...files.map((f) => `- ${f}`)].join(NL))
  const directives: string[] = []
  if (toggles.ultra) directives.push(DIRECTIVE_LINES.ultra)
  if (toggles.codex === 'tests') directives.push(DIRECTIVE_LINES.codexTests)
  else if (toggles.codex === 'full') directives.push(DIRECTIVE_LINES.codexFull)
  if (directives.length) parts.push(directives.join(NL))
  return parts.join(BLOCK_SEP)
}

/** Split off the last blank-line-separated block (or the whole text when there is none). */
function lastBlock(text: string): { head: string; tail: string } {
  const at = text.lastIndexOf(BLOCK_SEP)
  return at >= 0
    ? { head: text.slice(0, at), tail: text.slice(at + BLOCK_SEP.length) }
    : { head: '', tail: text }
}

/**
 * Inverse of composePrompt: strips a trailing directive block and a trailing
 * attached-files block and reports them. Text that was not built by
 * composePrompt comes back unchanged with `{ codex: 'off', ultra: false }` and
 * no files.
 */
export function parseDirectives(prompt: string): {
  text: string
  directives: ParsedDirectives
  files: string[]
} {
  let rest = prompt.replace(/\r\n/g, NL)
  const directives: ParsedDirectives = { codex: 'off', ultra: false }
  let files: string[] = []

  const d = lastBlock(rest)
  const dLines = d.tail.split(NL)
  if (d.tail && dLines.every((l) => DIRECTIVE_SET.has(l))) {
    directives.ultra = dLines.includes(DIRECTIVE_LINES.ultra)
    directives.codex = dLines.includes(DIRECTIVE_LINES.codexFull)
      ? 'full'
      : dLines.includes(DIRECTIVE_LINES.codexTests)
        ? 'tests'
        : 'off'
    rest = d.head
  }

  const f = lastBlock(rest)
  const fLines = f.tail.split(NL)
  if (
    fLines[0] === ATTACHED_FILES_HEADER &&
    fLines.length > 1 &&
    fLines.slice(1).every((l) => l.startsWith('- '))
  ) {
    files = fLines.slice(1).map((l) => l.slice(2))
    rest = f.head
  }

  return { text: rest, directives, files }
}

/** input + cache_creation_input + cache_read_input tokens of one usage record. */
export function contextTokens(usage: unknown): number {
  if (typeof usage !== 'object' || usage === null) return 0
  const u = usage as Record<string, unknown>
  let sum = 0
  for (const key of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    const v = u[key]
    if (typeof v === 'number' && Number.isFinite(v)) sum += v
  }
  return sum
}

/**
 * Context window for a model alias or id: 1,000,000 for the Claude 5 family
 * (aliases opus/fable/sonnet/haiku/default, ids like `claude-opus-5-5`,
 * `claude-fable-5-1`) and for any id ending in `[1m]`; 200,000 otherwise.
 */
export function contextWindowFor(model: string | undefined): number {
  if (!model) return 200_000
  const m = model.trim().toLowerCase()
  if (m.endsWith('[1m]') || FAMILY_ALIASES.has(m)) return 1_000_000
  const id = MODEL_ID.exec(m)
  return id && Number(id[2]) >= 5 ? 1_000_000 : 200_000
}

/**
 * Display name for a model alias or id: `opus` / `claude-opus-5-5` → `Opus 5.5`,
 * `claude-sonnet-5-5` → `Sonnet 5.5`, `claude-fable-5-1` → `Fable 5.1`.
 * Unknown ids are returned unchanged.
 */
export function modelLabel(model: string | undefined): string {
  if (!model) return ''
  const option = MODEL_OPTIONS.find((o) => o.id === model)
  if (option) return option.name
  const id = MODEL_ID.exec(model.toLowerCase())
  if (!id) return model
  const family = id[1].charAt(0).toUpperCase() + id[1].slice(1)
  return `${family} ${id[2]}${id[3] ? '.' + id[3] : ''}`
}

/** Folder name for a worktree: the part after the last `/`, slugged (a-z0-9-, max 40). */
export function worktreeSlug(nameOrBranch: string): string {
  return slug(nameOrBranch.split('/').pop() ?? '') || 'worktree'
}

/** Suggested branch name for a draft: `pb/<slug of the first line>` (slug max 40). */
export function suggestBranchName(text: string): string {
  return `pb/${slug(text.trim().split(NL)[0] ?? '') || 'chat'}`
}
