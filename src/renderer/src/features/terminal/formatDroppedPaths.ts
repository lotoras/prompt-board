export function formatDroppedPaths(paths: string[]): string {
  const parts = paths.filter((p) => p.length > 0).map((p) => (/\s/.test(p) ? `"${p}"` : p))
  return parts.length ? parts.join(' ') + ' ' : ''
}
