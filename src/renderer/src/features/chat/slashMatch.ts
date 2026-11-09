import type { SlashCommandInfo } from '../../../../shared/types'

const byName = (a: SlashCommandInfo, b: SlashCommandInfo): number => a.name.localeCompare(b.name)

function rank(c: SlashCommandInfo, q: string): number {
  const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase())
  if (names.some((n) => n.startsWith(q))) return 0
  if (names.some((n) => n.slice(n.lastIndexOf(':') + 1).startsWith(q))) return 1
  if (names.some((n) => n.includes(q)) || c.description.toLowerCase().includes(q)) return 2
  return -1
}

export interface SlashToken {
  start: number
  end: number
  query: string
}

/** The `/command` word that ends at the cursor, at the start of the text or after whitespace. */
export function slashTokenAt(text: string, cursor: number): SlashToken | null {
  const end = Math.min(cursor, text.length)
  const match = /(?:^|\s)\/([\w:-]*)$/.exec(text.slice(0, end))
  return match ? { start: end - match[1].length - 1, end, query: match[1] } : null
}

export function matchSlashCommands(
  query: string,
  commands: SlashCommandInfo[],
  limit = 8
): SlashCommandInfo[] {
  const q = query.toLowerCase()
  if (!q) {
    const skills = commands.filter((c) => !c.builtin).sort(byName)
    const builtins = commands.filter((c) => c.builtin).sort(byName)
    return [...skills, ...builtins].slice(0, limit)
  }
  return commands
    .map((c) => ({ c, r: rank(c, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || byName(a.c, b.c))
    .map((x) => x.c)
    .slice(0, limit)
}
