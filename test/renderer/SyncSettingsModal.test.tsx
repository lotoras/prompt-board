// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { SyncConfigView } from '../../src/shared/types'

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: {
    sync: {
      getConfig,
      configure: vi.fn(),
      signOut: vi.fn()
    }
  }
}))

import { useStore } from '../../src/renderer/src/store'
import { SyncSettingsModal } from '../../src/renderer/src/features/sync/SyncSettingsModal'

const SAVED_CONFIG: SyncConfigView = {
  url: 'https://x.supabase.co',
  anonKey: 'anon123',
  email: 'a@b.com',
  hasPassword: true
}

function openModal(): void {
  useStore.setState((state) => ({
    ...state,
    syncModalOpen: true,
    syncStatus: { state: 'disabled', pendingOps: 0 }
  }))
}

describe('SyncSettingsModal', () => {
  beforeEach(() => {
    getConfig.mockReset()
    getConfig.mockResolvedValue(SAVED_CONFIG)
  })

  afterEach(() => {
    cleanup()
    useStore.setState((state) => ({ ...state, syncModalOpen: false, syncStatus: { state: 'disabled', pendingOps: 0 } }))
  })

  it('renders nothing when the sync modal is closed', () => {
    useStore.setState((state) => ({ ...state, syncModalOpen: false }))
    render(<SyncSettingsModal />)
    expect(screen.queryByText('Sync settings')).toBeNull()
  })

  it('prefills url/anon-key/email and shows the saved-password placeholder', async () => {
    openModal()
    render(<SyncSettingsModal />)

    await waitFor(() => expect(getConfig).toHaveBeenCalledTimes(1))

    await waitFor(() =>
      expect((screen.getByLabelText('Supabase URL') as HTMLInputElement).value).toBe('https://x.supabase.co')
    )
    expect((screen.getByLabelText('Anon key') as HTMLInputElement).value).toBe('anon123')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('a@b.com')

    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement
    expect(passwordInput.value).toBe('')
    expect(passwordInput.placeholder).toBe('•••••• (saved)')
  })

  it('leaves the password placeholder empty when no password is saved', async () => {
    getConfig.mockResolvedValue({ ...SAVED_CONFIG, hasPassword: false })
    openModal()
    render(<SyncSettingsModal />)

    await waitFor(() => expect(getConfig).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect((screen.getByLabelText('Supabase URL') as HTMLInputElement).value).toBe('https://x.supabase.co')
    )

    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement
    expect(passwordInput.placeholder).toBe('')
  })
})
