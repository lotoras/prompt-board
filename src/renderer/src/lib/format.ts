export function formatTokens(total: number | undefined): string {
  if (!total) return '0'
  if (total < 1000) return String(total)
  if (total < 1_000_000) return `${(total / 1000).toFixed(1)}k`
  return `${(total / 1_000_000).toFixed(1)}m`
}

export function formatRelativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.round(diffHour / 24)
  return `${diffDay}d ago`
}
