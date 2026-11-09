// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { chat } = vi.hoisted(() => ({ chat: { listCommands: vi.fn() } }))
vi.mock('../../src/renderer/src/lib/api', () => ({ api: { chat } }))

import { useStore } from '../../src/renderer/src/store'

beforeEach(() => {
  chat.listCommands.mockReset()
  useStore.setState({ slashCommands: {} })
})

describe('loadSlashCommands', () => {
  it('does not store an empty list, so a retry asks again', async () => {
    chat.listCommands.mockResolvedValueOnce([])
    await useStore.getState().loadSlashCommands('c1')
    expect(useStore.getState().slashCommands['c1']).toBeUndefined()
    chat.listCommands.mockResolvedValueOnce([{ name: 'compact', description: '', argumentHint: '' }])
    await useStore.getState().loadSlashCommands('c1')
    expect(chat.listCommands).toHaveBeenCalledTimes(2)
    expect(useStore.getState().slashCommands['c1']).toHaveLength(1)
  })
})
