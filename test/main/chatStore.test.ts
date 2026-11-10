import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { DEFAULT_TOGGLES } from '../../src/shared/chat'
import type {
  PersistedChatsState,
  PersistedTerminalsState,
  Project
} from '../../src/shared/types'

const { userDataDir } = vi.hoisted(() => ({ userDataDir: { current: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.current },
  BrowserWindow: class {}
}))

const DEFAULTS = { model: 'opus', effort: 'high', permissionMode: 'plan' } as const

function project(key: string, basePath: string): Project {
  return { projectKey: key, name: key, basePath, createdAt: 0, updatedAt: 0 }
}

describe('chat/store migrateFromTerminals', () => {
  async function load() {
    return import('../../src/main/chat/store')
  }

  it('maps each terminal of an existing project to a started chat', async () => {
    const { migrateFromTerminals } = await load()
    const t: PersistedTerminalsState = {
      terminals: [
        { projectKey: 'p1', sessionId: 's1', title: 'Fix bug' },
        { projectKey: 'p1', sessionId: 's2', title: '' }
      ],
      activeSessionByProject: { p1: 's2' }
    }
    const out = migrateFromTerminals(t, [project('p1', 'C:\\work\\p1')], 1234, DEFAULTS)
    expect(out.chats).toEqual([
      {
        chatId: 'mig-s1',
        projectKey: 'p1',
        sessionId: 's1',
        title: 'Fix bug',
        cwd: 'C:\\work\\p1',
        model: 'opus',
        effort: 'high',
        toggles: DEFAULT_TOGGLES,
        permissionMode: 'plan',
        started: true,
        createdAt: 1234,
        updatedAt: 1234
      },
      expect.objectContaining({ chatId: 'mig-s2', sessionId: 's2', title: 'Chat' })
    ])
    expect(out.activeByProject).toEqual({ p1: 'mig-s2' })
  })

  it('defaults a migrated chat permissionMode to bypassPermissions when not given', async () => {
    const { migrateFromTerminals } = await load()
    const t: PersistedTerminalsState = {
      terminals: [{ projectKey: 'p1', sessionId: 's1', title: 'x' }],
      activeSessionByProject: {}
    }
    const out = migrateFromTerminals(t, [project('p1', 'C:\\work\\p1')], 1, {
      model: 'opus',
      effort: 'high'
    } as any)
    expect(out.chats[0].permissionMode).toBe('bypassPermissions')
  })

  it('drops terminals whose project no longer exists', async () => {
    const { migrateFromTerminals } = await load()
    const t: PersistedTerminalsState = {
      terminals: [{ projectKey: 'gone', sessionId: 's1', title: 'x' }],
      activeSessionByProject: { gone: 's1' }
    }
    const out = migrateFromTerminals(t, [], 1, DEFAULTS)
    expect(out.chats).toEqual([])
    expect(out.activeByProject).toEqual({})
  })
})

describe('chat/store persistence', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'chat-store-'))
    userDataDir.current = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function load() {
    return import('../../src/main/chat/store')
  }

  it('round-trips saved state through chats.json', async () => {
    const { saveChatsState, loadChatsState } = await load()
    const state: PersistedChatsState = {
      chats: [
        {
          chatId: 'c1',
          projectKey: 'p1',
          sessionId: 's1',
          title: 'T',
          cwd: 'C:\\work\\p1',
          model: 'sonnet',
          effort: 'low',
          toggles: { codex: 'tests', fanOut: true, think: true },
          permissionMode: 'acceptEdits',
          started: false,
          createdAt: 1,
          updatedAt: 2
        }
      ],
      activeByProject: { p1: 'c1' }
    }
    await saveChatsState(state)
    expect(JSON.parse(await fs.readFile(join(tmpDir, 'chats.json'), 'utf8'))).toEqual(state)
    expect(await loadChatsState()).toEqual(state)
  })

  it('fills a missing or invalid permissionMode with bypassPermissions', async () => {
    const base = {
      projectKey: 'p1',
      sessionId: 's',
      title: 'T',
      cwd: 'C:\\work\\p1',
      model: 'opus',
      effort: 'high',
      toggles: { codex: 'off', fanOut: false, think: false },
      started: true,
      createdAt: 1,
      updatedAt: 1
    }
    await fs.writeFile(
      join(tmpDir, 'chats.json'),
      JSON.stringify({
        chats: [
          { ...base, chatId: 'missing' },
          { ...base, chatId: 'bad', permissionMode: 'nonsense' },
          { ...base, chatId: 'plan', permissionMode: 'plan' }
        ],
        activeByProject: {}
      })
    )
    const { loadChatsState } = await load()
    const { chats } = await loadChatsState()
    expect(chats.map((c) => [c.chatId, c.permissionMode])).toEqual([
      ['missing', 'bypassPermissions'],
      ['bad', 'bypassPermissions'],
      ['plan', 'plan']
    ])
  })

  it('turns an old `ultra` toggle into Fan-out and Think harder on load', async () => {
    const base = {
      projectKey: 'p1',
      sessionId: 's',
      title: 'T',
      cwd: 'C:\\work\\p1',
      model: 'opus',
      effort: 'high',
      permissionMode: 'plan',
      started: true,
      createdAt: 1,
      updatedAt: 1
    }
    await fs.writeFile(
      join(tmpDir, 'chats.json'),
      JSON.stringify({
        chats: [
          { ...base, chatId: 'old-on', toggles: { codex: 'tests', ultra: true } },
          { ...base, chatId: 'old-off', toggles: { codex: 'off', ultra: false } },
          { ...base, chatId: 'none' }
        ],
        activeByProject: {}
      })
    )
    const { loadChatsState } = await load()
    const { chats } = await loadChatsState()
    expect(chats.map((c) => [c.chatId, c.toggles])).toEqual([
      ['old-on', { codex: 'tests', fanOut: true, think: true }],
      ['old-off', { codex: 'off', fanOut: false, think: false }],
      ['none', { codex: 'off', fanOut: false, think: false }]
    ])
  })

  it('returns an empty state for a corrupt chats.json', async () => {
    await fs.writeFile(join(tmpDir, 'chats.json'), '{ not json')
    const { loadChatsState } = await load()
    expect(await loadChatsState()).toEqual({ chats: [], activeByProject: {} })
  })

  it('migrates terminals.json once when chats.json is missing, then saves it', async () => {
    await fs.writeFile(
      join(tmpDir, 'projects.json'),
      JSON.stringify([project('p1', 'C:\\work\\p1')])
    )
    await fs.writeFile(
      join(tmpDir, 'terminals.json'),
      JSON.stringify({
        terminals: [{ projectKey: 'p1', sessionId: 's1', title: 'Old terminal' }],
        activeSessionByProject: { p1: 's1' }
      })
    )
    const { loadChatsState } = await load()
    const state = await loadChatsState()
    expect(state.chats).toHaveLength(1)
    expect(state.chats[0]).toMatchObject({
      chatId: 'mig-s1',
      sessionId: 's1',
      title: 'Old terminal',
      cwd: 'C:\\work\\p1',
      permissionMode: 'bypassPermissions',
      started: true
    })
    expect(state.activeByProject).toEqual({ p1: 'mig-s1' })
    const saved = JSON.parse(await fs.readFile(join(tmpDir, 'chats.json'), 'utf8'))
    expect(saved.chats[0].chatId).toBe('mig-s1')
  })

  it('does not re-migrate once chats.json exists', async () => {
    await fs.writeFile(
      join(tmpDir, 'terminals.json'),
      JSON.stringify({
        terminals: [{ projectKey: 'p1', sessionId: 's1', title: 'x' }],
        activeSessionByProject: {}
      })
    )
    await fs.writeFile(
      join(tmpDir, 'chats.json'),
      JSON.stringify({ chats: [], activeByProject: {} })
    )
    const { loadChatsState } = await load()
    expect(await loadChatsState()).toEqual({ chats: [], activeByProject: {} })
  })
})
