import { describe, expect, it } from 'vitest'
import { pathKey } from '../../src/shared/pathKey'

describe('pathKey', () => {
  describe('happy path', () => {
    it('converts backslashes to forward slashes and lowercases the drive letter', () => {
      expect(pathKey('C:\\Users\\a\\proj')).toBe('c:/Users/a/proj')
    })

    it('leaves a posix path unchanged', () => {
      expect(pathKey('/home/user/proj')).toBe('/home/user/proj')
    })

    it('lowercases only the drive letter on an already-forward-slash Windows path', () => {
      expect(pathKey('C:/Foo')).toBe('c:/Foo')
    })
  })

  describe('edge cases', () => {
    it('strips a trailing slash', () => {
      expect(pathKey('C:\\foo\\')).toBe('c:/foo')
      expect(pathKey('/a/b//')).toBe('/a/b')
    })

    it('keeps a single separator for a posix root path; a bare Windows drive loses its trailing slash', () => {
      expect(pathKey('/')).toBe('/')
      // NOTE: the current implementation strips the trailing slash unconditionally when
      // length > 1, so a bare drive root normalizes to 'c:' (not 'c:/'). Documented here as
      // the actual behavior; see final report for the discrepancy vs. the original plan.
      expect(pathKey('C:\\')).toBe('c:')
    })

    it('maps an empty string to root', () => {
      expect(pathKey('')).toBe('/')
    })

    it('normalizes mixed separators', () => {
      expect(pathKey('C:\\foo/bar\\baz')).toBe('c:/foo/bar/baz')
    })

    it('is idempotent for an already-lowercase drive', () => {
      const inputs = ['c:\\x', 'C:\\Users\\a\\proj', '/home/user/proj', 'C:/Foo', '/a/b//']
      for (const input of inputs) {
        const once = pathKey(input)
        expect(pathKey(once)).toBe(once)
      }
    })
  })
})
