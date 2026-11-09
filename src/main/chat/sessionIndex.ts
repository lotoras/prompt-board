import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { parseDirectives } from '../../shared/chat'
import { pathKey } from '../../shared/pathKey'
import type { PastSession } from '../../shared/types'

const CHUNK = 64 * 1024
/** Large startup hooks can push the first prompt far into the file; look this far before giving up. */
const WIDE_HEAD = 1024 * 1024
const PROMPT_MAX = 120
const SKIP_PREFIXES = [
  '<command-name>',
  '<command-message>',
  '<local-command-',
  '<system-reminder>',
  '[Request interrupted'
]
const WORKTREE_MARK = '/.claude/worktrees/'

type Obj = Record<string, unknown>
type Summary = { cwd?: string; firstPrompt: string; title?: string; model?: string }
type Indexed = Omit<PastSession, 'openChatId'>

function parseRecords(text: string): Obj[] {
  const out: Obj[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (typeof rec === 'object' && rec !== null) out.push(rec as Obj)
    } catch {
      // partial first/last line of a cut chunk
    }
  }
  return out
}

function userText(rec: Obj): string {
  if (rec.type !== 'user' || rec.isMeta === true) return ''
  const content = (rec.message as Obj | undefined)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (typeof b === 'object' && b !== null && (b as Obj).type === 'text' ? String((b as Obj).text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

/** `/name args` for a slash command run with arguments; commands without any say nothing about the topic. */
function commandPrompt(rec: Obj): string {
  const text = userText(rec)
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1].trim()
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1].trim()
  return name && args ? `${name} ${args}` : ''
}

function promptText(rec: Obj): string {
  const text = userText(rec)
  const trimmed = text.trimStart()
  if (!trimmed || SKIP_PREFIXES.some((p) => trimmed.startsWith(p))) return ''
  return text
}

function lastOf(recs: Obj[], pick: (r: Obj) => string | undefined): string | undefined {
  for (let i = recs.length - 1; i >= 0; i--) {
    const v = pick(recs[i])
    if (v) return v
  }
  return undefined
}

const aiTitleOf = (r: Obj): string | undefined =>
  r.type === 'ai-title' && typeof r.aiTitle === 'string' ? r.aiTitle : undefined
const modelOf = (r: Obj): string | undefined => {
  const m = (r.message as Obj | undefined)?.model
  return typeof m === 'string' && m ? m : undefined
}

export function summarizeTranscript(head: string, tail: string): Summary {
  const headRecs = parseRecords(head)
  const tailRecs = parseRecords(tail)
  const cwd = headRecs.find((r) => typeof r.cwd === 'string')?.cwd as string | undefined
  let firstPrompt = ''
  for (const rec of headRecs) {
    const text = promptText(rec) || commandPrompt(rec)
    if (!text) continue
    const line = parseDirectives(text).text.split(/\r?\n/).find((l) => l.trim()) ?? ''
    firstPrompt = line.trim().slice(0, PROMPT_MAX)
    if (firstPrompt) break
  }
  const title = lastOf(tailRecs, aiTitleOf) ?? lastOf(headRecs, aiTitleOf) ?? (firstPrompt || undefined)
  const model = lastOf(tailRecs, modelOf) ?? lastOf(headRecs, modelOf)
  return {
    ...(cwd ? { cwd } : {}),
    firstPrompt,
    ...(title ? { title } : {}),
    ...(model ? { model } : {})
  }
}

async function readChunks(
  path: string,
  size: number,
  headBytes = CHUNK
): Promise<{ head: string; tail: string }> {
  const fh = await fs.open(path, 'r')
  try {
    const read = async (pos: number, len: number): Promise<string> => {
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, pos)
      return buf.toString('utf8', 0, bytesRead)
    }
    const head = await read(0, Math.min(headBytes, size))
    const tail = size <= CHUNK ? head : await read(size - CHUNK, CHUNK)
    return { head, tail }
  } finally {
    await fh.close()
  }
}

const cache = new Map<string, { mtimeMs: number; size: number; summary: Summary }>()

async function summarizeFile(path: string, mtimeMs: number, size: number): Promise<Summary | null> {
  const hit = cache.get(path)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.summary
  try {
    const { head, tail } = await readChunks(path, size)
    let summary = summarizeTranscript(head, tail)
    if (!summary.firstPrompt && size > CHUNK) {
      const wide = await readChunks(path, size, WIDE_HEAD)
      summary = summarizeTranscript(wide.head, tail)
    }
    cache.set(path, { mtimeMs, size, summary })
    return summary
  } catch {
    return null
  }
}

function worktreeOf(key: string, projectKey: string): string | undefined {
  if (!key.startsWith(projectKey + WORKTREE_MARK)) return undefined
  const slug = key.slice(projectKey.length + WORKTREE_MARK.length).split('/')[0]
  return slug ? `.claude/worktrees/${slug}` : undefined
}

export async function listProjectSessions(
  projectKey: string,
  opts: { projectsDir?: string; limit?: number; offset?: number } = {}
): Promise<Indexed[]> {
  const root = opts.projectsDir ?? join(os.homedir(), '.claude', 'projects')
  const limit = opts.limit ?? 50
  let toSkip = opts.offset ?? 0
  let dirs: string[]
  try {
    dirs = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  const files: { path: string; sessionId: string; mtimeMs: number; size: number }[] = []
  for (const dir of dirs) {
    let names: string[]
    try {
      names = await fs.readdir(join(root, dir))
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl') || name.startsWith('agent-')) continue
      const path = join(root, dir, name)
      try {
        const st = await fs.stat(path)
        if (st.isFile()) files.push({ path, sessionId: name.slice(0, -6), mtimeMs: st.mtimeMs, size: st.size })
      } catch {
        // vanished
      }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const out: Indexed[] = []
  for (const f of files) {
    if (out.length >= limit) break
    const s = await summarizeFile(f.path, f.mtimeMs, f.size)
    if (!s?.cwd || !s.title) continue
    const key = pathKey(s.cwd)
    const worktreeRel = worktreeOf(key, projectKey)
    if (key !== projectKey && !worktreeRel) continue
    if (toSkip > 0) {
      toSkip--
      continue
    }
    out.push({
      sessionId: f.sessionId,
      title: s.title ?? s.firstPrompt,
      firstPrompt: s.firstPrompt,
      lastActivity: f.mtimeMs,
      cwd: s.cwd,
      ...(worktreeRel ? { worktreeRel } : {}),
      ...(s.model ? { model: s.model } : {})
    })
  }
  return out
}
