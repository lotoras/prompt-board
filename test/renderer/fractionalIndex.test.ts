import { describe, expect, it } from 'vitest'
import { between } from '../../src/renderer/src/lib/fractionalIndex'

describe('between', () => {
  describe('happy path', () => {
    it('returns the default midpoint when both bounds are missing', () => {
      expect(between(undefined, undefined)).toBe('m')
    })

    it('returns a key strictly between two bounds', () => {
      const r = between('a', 'c')
      expect(r > 'a').toBe(true)
      expect(r < 'c').toBe(true)
    })

    it('returns a key less than the bound when inserting before the first', () => {
      const r = between(undefined, 'm')
      expect(r < 'm').toBe(true)
    })

    it('returns a key greater than the bound when inserting after the last', () => {
      const r = between('m', undefined)
      expect(r > 'm').toBe(true)
    })
  })

  describe('edge cases / invariants', () => {
    it('produces a strictly-between key for adjacent bounds', () => {
      const r = between('a', 'b')
      expect(r > 'a').toBe(true)
      expect(r < 'b').toBe(true)
    })

    it('keeps repeated midpoint insertions strictly ordered and unique', () => {
      let last = between('a', 'b')
      const seen = new Set<string>([last])
      for (let i = 0; i < 20; i++) {
        const next = between('a', last)
        expect(next > 'a').toBe(true)
        expect(next < last).toBe(true)
        expect(seen.has(next)).toBe(false)
        seen.add(next)
        last = next
      }
    })

    it('returns a key strictly less than the minimum digit bound', () => {
      const r = between(undefined, '0')
      expect(r < '0').toBe(true)
    })

    it('returns a key strictly greater than a max-digit bound', () => {
      const r = between('z', undefined)
      expect(r > 'z').toBe(true)
    })

    it('keeps 100 repeated before-head insertions strictly ordered', () => {
      let last = '0'
      const seen = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const next = between(undefined, last)
        expect(next < last).toBe(true)
        expect(seen.has(next)).toBe(false)
        seen.add(next)
        expect(next.length).toBeLessThan(200)
        last = next
      }
    })

    it('keeps 100 repeated after-tail insertions strictly ordered', () => {
      let last = 'z'
      const seen = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const next = between(last, undefined)
        expect(next > last).toBe(true)
        expect(seen.has(next)).toBe(false)
        seen.add(next)
        expect(next.length).toBeLessThan(200)
        last = next
      }
    })

    it('keeps 100 repeated inserts between adjacent keys strictly ordered', () => {
      let lo = 'a'
      let hi = 'b'
      const seen = new Set<string>([lo, hi])
      for (let i = 0; i < 100; i++) {
        const mid = between(lo, hi)
        expect(mid > lo).toBe(true)
        expect(mid < hi).toBe(true)
        expect(seen.has(mid)).toBe(false)
        seen.add(mid)
        expect(mid.length).toBeLessThan(200)
        hi = mid
      }
    })

    it('preserves intended logical order when sorted lexicographically', () => {
      const keys: string[] = []
      keys.push(between(undefined, undefined)) // m
      keys.push(between(keys[0], undefined)) // after m
      keys.push(between(undefined, keys[0])) // before m
      keys.push(between(keys[2], keys[0])) // between "before m" and m

      const sorted = [...keys].sort()
      expect(sorted).toEqual([keys[2], keys[3], keys[0], keys[1]])
    })
  })
})
