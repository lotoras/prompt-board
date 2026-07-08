import type { IPty } from 'node-pty'

const QUIESCENCE_MS = 700
const MIN_DELAY_MS = 1500
const FALLBACK_MS = 10000

/**
 * Inject `query` into `ptyProcess`'s input once the shell/CLI output goes
 * quiet after startup: first output seen AND no data for `QUIESCENCE_MS` AND
 * at least `MIN_DELAY_MS` since spawn, with a `FALLBACK_MS` hard timeout.
 * Injected as a bracketed paste (no trailing `\r`) so it sits pre-typed and
 * unsubmitted in Claude's input box.
 */
export function scheduleQueryInjection(ptyProcess: IPty, query: string, spawnedAt: number): void {
  let injected = false
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null
  let dataDisposable: { dispose(): void } | null = null

  const inject = (): void => {
    if (injected) return
    injected = true
    if (quietTimer) clearTimeout(quietTimer)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    dataDisposable?.dispose()

    const normalized = query.replace(/\r\n/g, '\n')
    ptyProcess.write(`\x1b[200~${normalized}\x1b[201~`)
  }

  const armQuietTimer = (): void => {
    if (quietTimer) clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      const elapsed = Date.now() - spawnedAt
      if (elapsed >= MIN_DELAY_MS) {
        inject()
      } else {
        quietTimer = setTimeout(() => inject(), MIN_DELAY_MS - elapsed)
      }
    }, QUIESCENCE_MS)
  }

  dataDisposable = ptyProcess.onData(() => {
    armQuietTimer()
  })

  fallbackTimer = setTimeout(() => {
    inject()
  }, FALLBACK_MS)
}
