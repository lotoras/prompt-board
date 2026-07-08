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
