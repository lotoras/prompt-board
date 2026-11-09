import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'

describe('transcripts across both accounts', () => {
  let home: string

  beforeEach(async () => {
    vi.resetModules()
    home = await fs.mkdtemp(join(os.tmpdir(), 'acc-transcripts-'))
    vi.spyOn(os, 'homedir').mockReturnValue(home)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(home, { recursive: true, force: true })
  })

  async function write(config: string, name: string, cwd: string, prompt: string): Promise<string> {
    const dir = join(home, config, 'projects', 'enc')
    await fs.mkdir(dir, { recursive: true })
    const p = join(dir, name + '.jsonl')
    const rec = { type: 'user', uuid: 'u', cwd, message: { role: 'user', content: prompt } }
    await fs.writeFile(p, JSON.stringify(rec) + '\n')
    return p
  }

  it('locateTranscript finds a session of the second account', async () => {
    const p = await write('.claude-2', 'sess-2', 'C:\\work\\p1', 'hello')
    const { locateTranscript } = await import('../../src/main/sessions/transcript')
    expect(await locateTranscript('sess-2')).toBe(p)
    expect(await locateTranscript('nope')).toBeNull()
  })

  it('the session index lists both accounts and marks Claude 2 sessions', async () => {
    await write('.claude', 'one', 'C:\\work\\p1', 'first account')
    await write('.claude-2', 'two', 'C:\\work\\p1', 'second account')
    const { listProjectSessions } = await import('../../src/main/chat/sessionIndex')
    const out = await listProjectSessions('c:/work/p1')
    expect(out.map((s) => s.sessionId).sort()).toEqual(['one', 'two'])
    expect(out.find((s) => s.sessionId === 'two')?.account).toBe(2)
    expect(out.find((s) => s.sessionId === 'one')?.account).toBeUndefined()
  })

  it('reads the default settings of the chosen account', async () => {
    await fs.mkdir(join(home, '.claude'), { recursive: true })
    await fs.mkdir(join(home, '.claude-2'), { recursive: true })
    await fs.writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus' }))
    await fs.writeFile(join(home, '.claude-2', 'settings.json'), JSON.stringify({ model: 'sonnet' }))
    const { loadClaudeDefaults } = await import('../../src/main/chat/defaults')
    expect((await loadClaudeDefaults()).model).toBe('opus')
    expect((await loadClaudeDefaults(2)).model).toBe('sonnet')
  })
})
