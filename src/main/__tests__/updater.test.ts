import { describe, it, expect } from 'vitest'
import { isNewerVersion } from '../updater'

describe('isNewerVersion', () => {
  it('detects patch version increments', () => {
    expect(isNewerVersion('0.0.1', '0.0.2')).toBe(true)
    expect(isNewerVersion('0.1.0', '0.1.1')).toBe(true)
    expect(isNewerVersion('0.0.2', '0.0.1')).toBe(false)
  })

  it('detects minor version increments', () => {
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(true)
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(false)
  })

  it('detects major version increments', () => {
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false)
  })

  it('returns false for equal versions', () => {
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false)
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
  })

  it('handles v prefix cleanly', () => {
    expect(isNewerVersion('0.1.0', 'v0.2.0')).toBe(true)
    expect(isNewerVersion('v0.1.0', '0.2.0')).toBe(true)
    expect(isNewerVersion('v0.1.0', 'v0.1.0')).toBe(false)
    expect(isNewerVersion('V0.0.1', 'V0.0.2')).toBe(true)
  })

  it('handles prerelease versions and invalid inputs', () => {
    expect(isNewerVersion('1.0.0-alpha', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0-alpha')).toBe(false)
    expect(isNewerVersion('invalid', '0.1.0')).toBe(false)
    expect(isNewerVersion('0.1.0', 'invalid')).toBe(false)
  })
})
