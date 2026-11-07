import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { dirname, join, relative } from 'path'
import { worktreeSlug } from '../../shared/chat'
import type { GitInfo, WorkspacePlan } from '../../shared/types'

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
