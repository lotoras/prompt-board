import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { api } from '../../lib/api'
import { formatRelativeTime } from '../../lib/format'
import { syncDotColor } from './syncStatus'
import './sync.css'

interface SyncSettingsFormProps {
  onClose: () => void
}

function SyncSettingsForm({ onClose }: SyncSettingsFormProps): React.JSX.Element {
  const syncStatus = useStore((s) => s.syncStatus)
  const setSyncStatus = useStore((s) => s.setSyncStatus)
  const configured = syncStatus.state !== 'disabled'

  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    let active = true
    api.sync.getConfig().then((config) => {
      if (!active || !config) return
      setUrl(config.url)
      setAnonKey(config.anonKey)
      setEmail(config.email)
      setPasswordSaved(config.hasPassword)
    })
    return () => {
      active = false
    }
  }, [])

  const handleConnect = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setConnecting(true)
    setError(null)
    try {
      const status = await api.sync.configure({ url, anonKey, email, password })
      setSyncStatus(status)
      if (status.state === 'error') setError(status.error ?? 'Failed to connect')
      else setReconnecting(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setConnecting(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    await api.sync.signOut()
    setSyncStatus({ state: 'disabled', pendingOps: 0 })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleConnect}>
        <h2>Sync settings</h2>

        {configured && !reconnecting ? (
          <div className="sync-modal__status">
            <span className={`sync-dot sync-dot--${syncDotColor(syncStatus)}`} />
            <span>
              {syncStatus.state}
              {syncStatus.pendingOps > 0 && ` · ${syncStatus.pendingOps} pending`}
              {syncStatus.lastSyncAt && ` · synced ${formatRelativeTime(syncStatus.lastSyncAt)}`}
            </span>
            {syncStatus.error && <span className="sync-modal__error">{syncStatus.error}</span>}
          </div>
        ) : (
          <>
            <label className="modal__field">
              Supabase URL
              <input value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
            </label>

            <label className="modal__field">
              Anon key
              <input value={anonKey} onChange={(e) => setAnonKey(e.target.value)} />
            </label>

            <label className="modal__field">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>

            <label className="modal__field">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={passwordSaved ? '•••••• (saved)' : undefined}
              />
            </label>
          </>
        )}

        {error && <div className="sync-modal__error">{error}</div>}

        <div className="modal__actions">
          {configured && !reconnecting && (
            <button type="button" className="modal__delete" onClick={handleSignOut}>
              Sign out
            </button>
          )}
          {configured && !reconnecting && (
            <button
              type="button"
              onClick={() => {
                setError(null)
                setReconnecting(true)
              }}
            >
              Reconnect
            </button>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
          {(!configured || reconnecting) && (
            <button type="submit" disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

export function SyncSettingsModal(): React.JSX.Element | null {
  const open = useStore((s) => s.syncModalOpen)
  const setSyncModalOpen = useStore((s) => s.setSyncModalOpen)

  if (!open) return null

  return <SyncSettingsForm onClose={() => setSyncModalOpen(false)} />
}
