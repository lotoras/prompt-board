/**
 * Pure chat helpers shared by main and renderer. No Node, no DOM.
 * Spec: .claude/plans/t3-contracts.md (§ shared/chat.ts).
 */
import type {
  ChatAttachment,
  ChatToggles,
  EffortLevel,
  ModelOption,
  ParsedDirectives
} from './types'

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'opus', name: 'Opus 5.5', description: 'Most capable for hard, long work' },
  { id: 'fable', name: 'Fable 5.1', description: 'Deep reasoning and design passes' },
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

/**
 * Build the prompt text actually sent to Claude:
 *   <text trimmed>
 *   [blank line, `Attached files:`, one `- <path>` line per NON-image attachment]
 *   [blank line, directive lines: ultra first, then the codex line]
 * Image attachments are sent as image blocks by main, so they are not listed.
 * With no files and no directives the result is the trimmed text.
 */
export function composePrompt(
  text: string,
  toggles: ChatToggles,
  attachments: Pick<ChatAttachment, 'path' | 'kind'>[]
): string {
  void text
  void toggles
  void attachments
  throw new Error('composePrompt: not implemented')
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
  void prompt
  throw new Error('parseDirectives: not implemented')
}

/** input + cache_creation_input + cache_read_input tokens of one usage record. */
export function contextTokens(usage: unknown): number {
  void usage
  throw new Error('contextTokens: not implemented')
}

/**
 * Context window for a model alias or id: 1,000,000 for the Claude 5 family
 * (aliases opus/fable/sonnet/haiku/default, ids like `claude-opus-5-5`,
 * `claude-fable-5-1`) and for any id ending in `[1m]`; 200,000 otherwise.
 */
export function contextWindowFor(model: string | undefined): number {
  void model
  throw new Error('contextWindowFor: not implemented')
}

/**
 * Display name for a model alias or id: `opus` / `claude-opus-5-5` → `Opus 5.5`,
 * `claude-sonnet-5-5` → `Sonnet 5.5`, `claude-fable-5-1` → `Fable 5.1`.
 * Unknown ids are returned unchanged.
 */
export function modelLabel(model: string | undefined): string {
  void model
  throw new Error('modelLabel: not implemented')
}

/** Folder name for a worktree: the part after the last `/`, slugged (a-z0-9-, max 40). */
export function worktreeSlug(nameOrBranch: string): string {
  void nameOrBranch
  throw new Error('worktreeSlug: not implemented')
}

/** Suggested branch name for a draft: `pb/<slug of the first line>` (slug max 40). */
export function suggestBranchName(text: string): string {
  void text
  throw new Error('suggestBranchName: not implemented')
}
