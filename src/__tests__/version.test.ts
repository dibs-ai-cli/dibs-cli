import { describe, it, expect } from 'vitest'
import { CLI_VERSION, isOlderThan } from '../lib/version'

describe('CLI_VERSION', () => {
  it('is a valid semver string', () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('isOlderThan', () => {
  it('returns true when patch is lower', () => {
    expect(isOlderThan('0.0.1', '0.0.2')).toBe(true)
  })
  it('returns true when minor is lower', () => {
    expect(isOlderThan('0.1.0', '0.2.0')).toBe(true)
  })
  it('returns true when major is lower', () => {
    expect(isOlderThan('1.0.0', '2.0.0')).toBe(true)
  })
  it('returns false when equal', () => {
    expect(isOlderThan('0.0.1', '0.0.1')).toBe(false)
  })
  it('returns false when newer', () => {
    expect(isOlderThan('0.0.2', '0.0.1')).toBe(false)
  })
  it('minor beats patch', () => {
    expect(isOlderThan('0.9.9', '0.10.0')).toBe(true)
    expect(isOlderThan('0.10.0', '0.9.9')).toBe(false)
  })
  it('major beats minor', () => {
    expect(isOlderThan('1.9.9', '2.0.0')).toBe(true)
    expect(isOlderThan('2.0.0', '1.9.9')).toBe(false)
  })
})
