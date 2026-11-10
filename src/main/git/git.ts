import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { dirname, join, relative } from 'path'
import { worktreeSlug } from '../../shared/chat'
import type { GitChangedFile, GitChanges, GitInfo, WorkspacePlan } from '../../shared/types'
import { diffForWrite, diffFromPatch, type PatchHunk } from '../chat/diff'

const CACHE_MS = 5000
const WORKTREES_REL = '.claude/worktrees'

const cache = new Map<string, { at: number; info: Promise<GitInfo> }>()

interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
}

function run(cwd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout).replace(/\r?\n$/, ''),
          stderr: String(stderr).trim() || (err ? err.message : '')
        })
      }
    )
  })
}

async function runOrThrow(cwd: string, args: string[]): Promise<string> {
  const res = await run(cwd, args)
  if (!res.ok) throw new Error(res.stderr || `git ${args[0]} failed`)
  return res.stdout
}

function sameDir(a: string, b: string): boolean {
  const n = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return n(a) === n(b)
}

async function inspect(cwd: string): Promise<GitInfo> {
  const paths = await run(cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-dir',
    '--git-common-dir'
  ])
  if (!paths.ok) return { isRepo: false, isWorktree: false }
  const [toplevel, gitDir, commonDir] = paths.stdout.split(/\r?\n/)
  if (!toplevel || !gitDir || !commonDir) return { isRepo: false, isWorktree: false }

  const isWorktree = !sameDir(gitDir, commonDir)
  const repoRoot = isWorktree ? dirname(commonDir) : toplevel
  const info: GitInfo = { isRepo: true, isWorktree, repoRoot }
  if (isWorktree) {
    info.worktreeRel = relative(repoRoot, toplevel).replace(/\\/g, '/')
  }

  const head = await run(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
  if (head.ok && head.stdout) {
    info.branch = head.stdout
  } else {
    info.detached = true
    const sha = await run(cwd, ['rev-parse', '--short', 'HEAD'])
    if (sha.ok && sha.stdout) info.branch = sha.stdout
  }

  const status = await run(cwd, ['status', '--porcelain'])
  if (status.ok) info.dirty = status.stdout.length > 0
  return info
}

export function gitInfo(cwd: string): Promise<GitInfo> {
  const hit = cache.get(cwd)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info
  const info = inspect(cwd)
  cache.set(cwd, { at: Date.now(), info })
  return info
}

export function clearGitCache(): void {
  cache.clear()
}

const MAX_UNTRACKED = 100
const MAX_UNTRACKED_BYTES = 512 * 1024

/** The main branch's ref: `origin/HEAD`'s branch, else `main`, else `master` (local or on origin). */
async function mainBranch(top: string): Promise<{ name: string; ref: string } | null> {
  const names: string[] = []
  const originHead = await run(top, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
  if (originHead.ok && originHead.stdout.startsWith('origin/')) names.push(originHead.stdout.slice(7))
  names.push('main', 'master')
  for (const name of names) {
    for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
      if ((await run(top, ['rev-parse', '--verify', '-q', ref])).ok) return { name, ref }
    }
  }
  return null
}

/** `HEAD`, or the merge-base with the main branch when the checkout is on another branch. */
async function changesBase(top: string): Promise<{ base: string; label: string }> {
  const head = await run(top, ['symbolic-ref', '--short', '-q', 'HEAD'])
  const main = head.ok && head.stdout ? await mainBranch(top) : null
  if (main && head.stdout !== main.name) {
    const mb = await run(top, ['merge-base', 'HEAD', main.ref])
    if (mb.ok && mb.stdout) return { base: mb.stdout, label: main.name }
  }
  return { base: 'HEAD', label: 'HEAD' }
}

function unquote(path: string): string {
  return path.length > 1 && path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path
}

/** `a/<p> b/<p>` from a `diff --git` line, when both sides are the same path. */
function headerPath(rest: string): string | undefined {
  const n = (rest.length - 5) / 2
  if (!Number.isInteger(n) || n < 1) return undefined
  const p = rest.slice(2, 2 + n)
  return rest.startsWith('a/') && rest.slice(2 + n, 5 + n) === ' b/' && rest.slice(5 + n) === p ? p : undefined
}

/** Splits `git diff` output into one changed file per `diff --git` section. */
export function parseGitDiff(out: string): GitChangedFile[] {
  const files: GitChangedFile[] = []
  for (const section of out.split(/^diff --git /m).slice(1)) {
    const lines = section.split(/\r?\n/)
    let status: GitChangedFile['status'] = 'modified'
    let oldPath: string | undefined
    let newPath: string | undefined
    let binary = false
    const hunks: PatchHunk[] = []
    let i = 1
    for (; i < lines.length && !lines[i].startsWith('@@'); i++) {
      const line = lines[i]
      if (line.startsWith('new file mode')) status = 'added'
      else if (line.startsWith('deleted file mode')) status = 'deleted'
      else if (line.startsWith('rename from ')) {
        status = 'renamed'
        oldPath = unquote(line.slice(12))
      } else if (line.startsWith('rename to ')) newPath = unquote(line.slice(10))
      else if (line.startsWith('Binary files ')) binary = true
      else if (line.startsWith('--- ') && line !== '--- /dev/null') oldPath ??= unquote(line.slice(4)).replace(/^a\//, '')
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null') newPath ??= unquote(line.slice(4)).replace(/^b\//, '')
    }
    for (; i < lines.length; i++) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i])
      if (m) {
        hunks.push({
          oldStart: Number(m[1]),
          oldLines: Number(m[2] ?? 1),
          newStart: Number(m[3]),
          newLines: Number(m[4] ?? 1),
          lines: []
        })
      } else if (hunks.length && /^[ +\-\\]/.test(lines[i])) {
        hunks[hunks.length - 1].lines.push(lines[i])
      }
    }
    const path = (status === 'deleted' ? oldPath : newPath) ?? newPath ?? oldPath ?? headerPath(lines[0])
    if (!path) continue
    const diff = diffFromPatch(path, hunks)
    files.push({
      path,
      status,
      ...(status === 'renamed' && oldPath ? { oldPath } : {}),
      added: diff.added,
      removed: diff.removed,
      ...(binary ? { binary } : {}),
      diff
    })
  }
  return files
}

async function untrackedFile(top: string, path: string): Promise<GitChangedFile> {
  const empty = { file: path, added: 0, removed: 0, lines: [] }
  try {
    const abs = join(top, ...path.split('/'))
    if ((await fs.stat(abs)).size > MAX_UNTRACKED_BYTES) {
      return { path, status: 'added', added: 0, removed: 0, binary: true, diff: empty }
    }
    const buf = await fs.readFile(abs)
    if (buf.includes(0)) return { path, status: 'added', added: 0, removed: 0, binary: true, diff: empty }
    const text = buf.toString('utf-8')
    const diff = text ? diffForWrite(path, text) : empty
    return { path, status: 'added', added: diff.added, removed: 0, diff }
  } catch {
    return { path, status: 'added', added: 0, removed: 0, diff: empty }
  }
}

/** Every change in `cwd`, whatever tool made it (see `GitChanges`). */
export async function gitChanges(cwd: string): Promise<GitChanges> {
  const top = await run(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok || !top.stdout) return { isRepo: false, files: [] }
  const root = top.stdout
  const { base, label } = await changesBase(root)
  const [tracked, others] = await Promise.all([
    run(root, ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '-M', '-U3', base, '--']),
    run(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  ])
  const files = tracked.ok ? parseGitDiff(tracked.stdout) : []
  const untracked = others.ok ? others.stdout.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED) : []
  files.push(...(await Promise.all(untracked.map((p) => untrackedFile(root, p)))))
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { isRepo: true, baseLabel: label, files }
}

export async function listBranches(repoDir: string): Promise<string[]> {
  const res = await run(repoDir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  if (!res.ok) return []
  const all = res.stdout.split(/\r?\n/).filter(Boolean)
  const current = await run(repoDir, ['symbolic-ref', '--short', '-q', 'HEAD'])
  if (current.ok && current.stdout && all.includes(current.stdout)) {
    return [current.stdout, ...all.filter((b) => b !== current.stdout)]
  }
  return all
}

async function ensureWorktreesIgnored(repoRoot: string): Promise<void> {
  const probe = `${WORKTREES_REL}/.probe/x`
  const check = await run(repoRoot, ['check-ignore', '-q', probe])
  if (check.ok) return
  const common = await runOrThrow(repoRoot, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir'
  ])
  const excludePath = join(common, 'info', 'exclude')
  await fs.mkdir(dirname(excludePath), { recursive: true })
  let existing = ''
  try {
    existing = await fs.readFile(excludePath, 'utf-8')
  } catch {
    // no exclude file yet
  }
  const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
  await fs.appendFile(excludePath, `${prefix}${WORKTREES_REL}/\n`, 'utf-8')
}

export async function prepareWorkspace(
  repoDir: string,
  plan: WorkspacePlan
): Promise<{ cwd: string; branch: string; worktreePath?: string }> {
  const info = await inspect(repoDir)
  if (!info.isRepo) throw new Error(`not a git repository: ${repoDir}`)
  const current = info.branch ?? 'HEAD'
  const base = plan.baseBranch || undefined

  try {
    if (!plan.newWorktree && !plan.newBranch) return { cwd: repoDir, branch: current }

    if (plan.newBranch && !plan.branchName) throw new Error('A branch name is required')

    if (!plan.newWorktree) {
      const name = plan.branchName as string
      await runOrThrow(repoDir, ['switch', '-c', name, ...(base ? [base] : [])])
      return { cwd: repoDir, branch: name }
    }

    const root = info.repoRoot as string
    await ensureWorktreesIgnored(root)
    const slug = worktreeSlug(
      plan.newBranch ? (plan.branchName as string) : `detached-${Date.now()}`
    )
    const worktreePath = `${WORKTREES_REL}/${slug}`
    const cwd = join(root, ...worktreePath.split('/'))
    if (plan.newBranch) {
      const name = plan.branchName as string
      await runOrThrow(root, ['worktree', 'add', '-b', name, cwd, base ?? 'HEAD'])
      return { cwd, branch: name, worktreePath }
    }
    await runOrThrow(root, ['worktree', 'add', '--detach', cwd, base ?? 'HEAD'])
    return { cwd, branch: `${base ?? current} (detached)`, worktreePath }
  } finally {
    clearGitCache()
  }
}
