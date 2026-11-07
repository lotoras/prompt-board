/** Copy of `record` without `key` (records used as immutable store maps). */
export function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}
