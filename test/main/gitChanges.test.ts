import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { clearGitCache, gitChanges } from '../../src/main/git/git'

const run = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { cwd }
  )
  return stdout.trim()
}

describe('main/git gitChanges', { timeout: 30000 }, () => {
  let root: string
  let repo: string

  const commitAll = async (message: string): Promise<void> => {
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', message)
  }

  beforeEach(async () => {
    clearGitCache()
    root = await fs.realpath(await fs.mkdtemp(join(os.tmpdir(), 'pb-gitchanges-')))
    repo = join(root, 'repo')
    await fs.mkdir(repo)
    await git(repo, 'init', '-b', 'main')
    await fs.writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
    await fs.writeFile(join(repo, 'gone.txt'), 'bye\n')
    await fs.mkdir(join(repo, 'src'))
    await fs.writeFile(join(repo, 'src', 'old-name.txt'), 'line 1\nline 2\nline 3\nline 4\n')
    await commitAll('init')
  })

  afterEach(async () => {
    clearGitCache()
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('lists a file modified with plain fs, with counts and lines', async () => {
    await fs.writeFile(join(repo, 'a.txt'), 'one\nTWO\nthree\nfour\n')
    const res = await gitChanges(repo)
    expect(res.isRepo).toBe(true)
    expect(res.files).toHaveLength(1)
    const file = res.files[0]
    expect(file.path).toBe('a.txt')
    expect(file.status).toBe('modified')
    expect(file.added).toBe(2)
    expect(file.removed).toBe(1)
    const added = file.diff.lines.filter((l) => l.type === 'add').map((l) => l.text)
    expect(added).toContain('TWO')
    expect(added).toContain('four')
  })

  it('lists an untracked new file as added with every line added', async () => {
    await fs.writeFile(join(repo, 'fresh.txt'), 'x\ny\nz\n')
    const res = await gitChanges(repo)
    const file = res.files.find((f) => f.path === 'fresh.txt')
    expect(file).toBeDefined()
    expect(file!.status).toBe('added')
    expect(file!.added).toBe(3)
    expect(file!.removed).toBe(0)
    expect(file!.diff.lines.every((l) => l.type === 'add')).toBe(true)
  })

  it('lists a deleted file', async () => {
    await fs.rm(join(repo, 'gone.txt'))
    const res = await gitChanges(repo)
    const file = res.files.find((f) => f.path === 'gone.txt')
    expect(file).toBeDefined()
    expect(file!.status).toBe('deleted')
    expect(file!.removed).toBe(1)
    expect(file!.added).toBe(0)
  })

  it('lists a rename with its old path', async () => {
    await git(repo, 'mv', 'src/old-name.txt', 'src/new-name.txt')
    const res = await gitChanges(repo)
    const file = res.files.find((f) => f.path === 'src/new-name.txt')
    expect(file).toBeDefined()
    expect(file!.status).toBe('renamed')
    expect(file!.oldPath).toBe('src/old-name.txt')
    expect(res.files.find((f) => f.path === 'src/old-name.txt')).toBeUndefined()
  })

  it('marks a binary file as binary', async () => {
    await fs.writeFile(join(repo, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]))
    const res = await gitChanges(repo)
    const file = res.files.find((f) => f.path === 'blob.bin')
    expect(file).toBeDefined()
    expect(file!.binary).toBe(true)
    expect(file!.diff.lines).toEqual([])
  })

  it('still lists changes committed on a feature branch (base = merge-base with main)', async () => {
    await git(repo, 'switch', '-c', 'feat')
    await fs.writeFile(join(repo, 'feature.txt'), 'f1\nf2\n')
    await commitAll('feature work')
    const res = await gitChanges(repo)
    expect(res.baseLabel).toBe('main')
    const file = res.files.find((f) => f.path === 'feature.txt')
    expect(file).toBeDefined()
    expect(file!.status).toBe('added')
    expect(file!.added).toBe(2)
  })

  it('on main lists only uncommitted changes', async () => {
    await fs.writeFile(join(repo, 'committed.txt'), 'c\n')
    await commitAll('already committed')
    await fs.writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\nextra\n')
    const res = await gitChanges(repo)
    expect(res.files.map((f) => f.path)).toEqual(['a.txt'])
  })

  it('reports a non-repo directory', async () => {
    const plain = join(root, 'plain')
    await fs.mkdir(plain)
    expect(await gitChanges(plain)).toEqual({ isRepo: false, files: [] })
  })
})
