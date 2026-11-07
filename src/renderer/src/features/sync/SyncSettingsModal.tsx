import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../lib/api'
import { formatRelativeTime } from '../../lib/format'
import { syncDotColor } from './syncStatus'

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

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    extra: { type?: string; placeholder?: string; autoFocus?: boolean } = {}
  ): React.JSX.Element => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...extra} />
    </div>
  )

  return (
    <div className="modal-bg" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleConnect}
      >
        <div className="modal-head">
          <h2>Sync settings</h2>
          <button type="button" className="ctl icon" aria-label="Close" onClick={onClose}>
            <X className="i" strokeWidth={1.8} />
          </button>
        </div>

        <div className="modal-body">
          {configured && !reconnecting ? (
            <div className="sync-status-line">
              <span className={`ok ${syncDotColor(syncStatus)}`} />
              <span>
                {syncStatus.state}
                {syncStatus.pendingOps > 0 && ` · ${syncStatus.pendingOps} pending`}
                {syncStatus.lastSyncAt && ` · synced ${formatRelativeTime(syncStatus.lastSyncAt)}`}
              </span>
              {syncStatus.error && <span className="modal-error">{syncStatus.error}</span>}
            </div>
          ) : (
            <>
              {field('sync-url', 'Supabase URL', url, setUrl, { autoFocus: true })}
              {field('sync-key', 'Anon key', anonKey, setAnonKey)}
              {field('sync-email', 'Email', email, setEmail, { type: 'email' })}
              {field('sync-password', 'Password', password, setPassword, {
                type: 'password',
                placeholder: passwordSaved ? '•••••• (saved)' : undefined
              })}
            </>
          )}

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-foot">
          {configured && !reconnecting && (
            <button type="button" className="btn danger" onClick={handleSignOut}>
              Sign out
            </button>
          )}
          <span className="spacer" />
          {configured && !reconnecting && (
            <button
              type="button"
              className="btn outline"
              onClick={() => {
                setError(null)
                setReconnecting(true)
              }}
            >
              Reconnect
            </button>
          )}
          <button type="button" className="btn quiet" onClick={onClose}>
            Close
          </button>
          {(!configured || reconnecting) && (
            <button type="submit" className="btn primary" disabled={connecting}>
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
