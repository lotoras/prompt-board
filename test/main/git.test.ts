import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { clearGitCache, gitInfo, listBranches, prepareWorkspace } from '../../src/main/git/git'

const run = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { cwd }
  )
  return stdout.trim()
}

function norm(p: string | undefined): string {
  return (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

describe('main/git', () => {
  let root: string
  let repo: string

  beforeEach(async () => {
    clearGitCache()
    root = await fs.realpath(await fs.mkdtemp(join(os.tmpdir(), 'pb-git-')))
    repo = join(root, 'repo')
    await fs.mkdir(repo)
    await git(repo, 'init', '-b', 'main')
    await fs.writeFile(join(repo, 'a.txt'), 'hello\n')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', 'init')
  })

  afterEach(async () => {
    clearGitCache()
    // Worktrees hold file handles on Windows only briefly; retry the removal.
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('gitInfo', () => {
    it('describes a plain repository', async () => {
      const info = await gitInfo(repo)
      expect(info.isRepo).toBe(true)
      expect(info.isWorktree).toBe(false)
      expect(info.branch).toBe('main')
      expect(norm(info.repoRoot)).toBe(norm(repo))
    })

    it('reports a non-repo directory', async () => {
      const plain = join(root, 'plain')
      await fs.mkdir(plain)
      expect(await gitInfo(plain)).toEqual({ isRepo: false, isWorktree: false })
    })

    it('reports dirty when the work tree has changes', async () => {
      await fs.writeFile(join(repo, 'a.txt'), 'changed\n')
      expect((await gitInfo(repo)).dirty).toBe(true)
    })

    it('identifies a worktree and points repoRoot at the main repo', async () => {
      const res = await prepareWorkspace(repo, {
        newWorktree: true,
        newBranch: true,
        branchName: 'pb/feature-x'
      })
      clearGitCache()
      const info = await gitInfo(res.cwd)
      expect(info.isRepo).toBe(true)
      expect(info.isWorktree).toBe(true)
      expect(norm(info.repoRoot)).toBe(norm(repo))
      expect(info.worktreeRel).toBe('.claude/worktrees/feature-x')
      expect(info.branch).toBe('pb/feature-x')
    })
  })

  describe('listBranches', () => {
    it('lists local branches with the current one first', async () => {
      await git(repo, 'branch', 'alpha')
      await git(repo, 'branch', 'zeta')
      await git(repo, 'switch', 'zeta')
      const branches = await listBranches(repo)
      expect(branches[0]).toBe('zeta')
      expect([...branches].sort()).toEqual(['alpha', 'main', 'zeta'])
    })
  })

  describe('prepareWorkspace', () => {
    it('does nothing when neither toggle is on', async () => {
      const res = await prepareWorkspace(repo, { newWorktree: false, newBranch: false })
      expect(res.cwd).toBe(repo)
      expect(res.branch).toBe('main')
      expect(res.worktreePath).toBeUndefined()
    })

    it('creates and switches to a new branch in the main checkout', async () => {
      const res = await prepareWorkspace(repo, {
        newWorktree: false,
        newBranch: true,
        branchName: 'pb/only-branch'
      })
      expect(res.cwd).toBe(repo)
      expect(res.branch).toBe('pb/only-branch')
      expect(res.worktreePath).toBeUndefined()
      expect(await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('pb/only-branch')
    })

    it('starts a new branch from the base branch when given', async () => {
      await git(repo, 'branch', 'base-x')
      await git(repo, 'switch', 'base-x')
      await fs.writeFile(join(repo, 'b.txt'), 'b\n')
      await git(repo, 'add', '.')
      await git(repo, 'commit', '-m', 'on base-x')
      await git(repo, 'switch', 'main')
      await prepareWorkspace(repo, {
        newWorktree: false,
        newBranch: true,
        branchName: 'pb/from-base',
        baseBranch: 'base-x'
      })
      expect(await git(repo, 'rev-parse', 'HEAD')).toBe(await git(repo, 'rev-parse', 'base-x'))
    })

    it('creates a worktree on a new branch under .claude/worktrees', async () => {
      const res = await prepareWorkspace(repo, {
        newWorktree: true,
        newBranch: true,
        branchName: 'pb/Context Meter'
      })
      expect(res.branch).toBe('pb/Context Meter')
      expect(res.worktreePath).toBe('.claude/worktrees/context-meter')
      expect(norm(res.cwd)).toBe(norm(join(repo, '.claude', 'worktrees', 'context-meter')))
      const stat = await fs.stat(join(res.cwd, 'a.txt'))
      expect(stat.isFile()).toBe(true)
      expect(await git(res.cwd, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('pb/Context Meter')
    })

    it('creates a detached worktree when only the worktree toggle is on', async () => {
      const res = await prepareWorkspace(repo, {
        newWorktree: true,
        newBranch: false,
        baseBranch: 'main'
      })
      expect(res.branch).toBe('main (detached)')
      expect(res.worktreePath).toMatch(/^\.claude\/worktrees\/detached-/)
      expect(norm(res.cwd)).toBe(norm(join(repo, res.worktreePath!)))
      expect(await git(res.cwd, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD')
    })

    it('throws with git stderr when the branch already exists', async () => {
      await git(repo, 'branch', 'pb/dup')
      await expect(
        prepareWorkspace(repo, { newWorktree: false, newBranch: true, branchName: 'pb/dup' })
      ).rejects.toThrow(/already exists/i)
    })

    it('throws for a directory that is not a git repository', async () => {
      const plain = join(root, 'plain')
      await fs.mkdir(plain)
      await expect(
        prepareWorkspace(plain, { newWorktree: false, newBranch: false })
      ).rejects.toThrow(/not a git repository/i)
    })
  })

  describe('worktree ignore handling', () => {
    it('adds .claude/worktrees/ to info/exclude and never edits .gitignore', async () => {
      await prepareWorkspace(repo, { newWorktree: true, newBranch: true, branchName: 'pb/ign' })
      const exclude = await fs.readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')
      expect(exclude).toContain('.claude/worktrees/')
      await expect(fs.access(join(repo, '.gitignore'))).rejects.toThrow()
    })

    it('keeps the worktree out of git status of the main repo', async () => {
      await prepareWorkspace(repo, { newWorktree: true, newBranch: true, branchName: 'pb/clean' })
      expect(await git(repo, 'status', '--porcelain')).toBe('')
    })
  })
})
