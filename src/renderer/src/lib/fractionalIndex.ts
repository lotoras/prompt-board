/**
 * Fractional-index ordering for kanban cards. Orders are lexicographically
 * comparable base-36 strings; `between` produces a midpoint key so a card can
 * be reordered without renumbering the rest of the column.
 *
 * Internally we extend the visible base-36 alphabet ('0'-'9a-z') with a
 * leading sentinel character ('/') that sorts below '0'. This lets the single
 * midpoint loop below treat a missing lower bound as "always below every real
 * digit" and a missing upper bound as "always above every real digit" without
 * special-casing — closing the boundary cases (insert before the lowest key,
 * insert after an all-'z' key, and repeated insertion at either extreme) that
 * previously recursed without a base case.
 */

const DIGITS = '/0123456789abcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

function digitValue(ch: string): number {
  return DIGITS.indexOf(ch)
}

/**
 * Return an order key strictly between `a` and `b` (either bound may be
 * omitted for "before first" / "after last"). Falls back to a reasonable
 * default when both bounds are missing.
 */
export function between(a: string | undefined, b: string | undefined): string {
  if (!a && !b) return 'm'
  return midpoint(a ?? '', b ?? '')
}

function midpoint(a: string, b: string): string {
  let i = 0
  let result = ''
  while (true) {
    const da = i < a.length ? digitValue(a[i]) : 0
    const db = i < b.length ? digitValue(b[i]) : BASE

    if (da === db) {
      result += DIGITS[da]
      i++
      continue
    }

    if (db - da > 1) {
      const mid = Math.floor((da + db) / 2)
      result += DIGITS[mid]
      return result
    }

    // Adjacent digits: keep a's digit and recurse into the next position.
    result += DIGITS[da]
    i++
  }
}
