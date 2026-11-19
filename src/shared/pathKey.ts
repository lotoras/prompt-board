/**
 * Normalize a real `cwd` into a stable, cross-platform `projectKey`.
 * Pure string logic (no `path` module) so it works identically in main and
 * renderer and is trivially unit-testable.
 *
 * - backslashes -> forward slashes
 * - drive letter lowercased (Windows: `C:\foo` -> `c:/foo`)
 * - trailing slash stripped (root paths keep a single separator)
 */
export function pathKey(cwd: string): string {
  let normalized = cwd.replace(/\\/g, '/')

  normalized = normalized.replace(
    /^([a-zA-Z]):\//,
    (_match, drive: string) => `${drive.toLowerCase()}:/`
  )

  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, '')
  }

  if (normalized === '') {
    normalized = '/'
  }

  return normalized
}

const WORKTREE_MARK = '/.claude/worktrees/'

/**
 * Every folder a project covers: its base path plus its other paths (the same project
 * checked out somewhere else, e.g. in another folder on a second PC).
 */
export function projectPaths(project: { basePath: string; otherPaths?: string[] }): string[] {
  return [project.basePath, ...(project.otherPaths ?? [])].filter((p) => p.trim() !== '')
}

/**
 * The project path that `cwd` lives in — the folder itself or one of its
 * `.claude/worktrees/*` — or undefined when `cwd` is outside the project.
 */
export function projectRootOf(
  project: { basePath: string; otherPaths?: string[] },
  cwd: string
): string | undefined {
  const key = pathKey(cwd)
  return projectPaths(project).find((p) => {
    const root = pathKey(p)
    return key === root || key.startsWith(root + WORKTREE_MARK)
  })
}
