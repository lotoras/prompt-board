import { join } from 'path'

/**
 * Isolated data profile: when `PROMPT_BOARD_PROFILE` is set (e.g. `t3`), the
 * app keeps its userData — boards, projects, chats, the single-instance lock —
 * in `<appData>/prompt-board-<profile>` instead of `<appData>/prompt-board`,
 * so a dev build can run next to the everyday app without touching its data.
 * Returns null when no (valid) profile is requested.
 */
export function profileUserDataPath(
  appDataDir: string,
  profile: string | undefined
): string | null {
  const name = profile?.trim().toLowerCase()
  if (!name || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name) || name === 'default') return null
  return join(appDataDir, `prompt-board-${name}`)
}
