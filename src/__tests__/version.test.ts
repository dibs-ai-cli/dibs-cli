import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { CLI_VERSION, isOlderThan } from '../lib/version'

describe('CLI_VERSION', () => {
  it('is a valid semver string', () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  // CLI_VERSION is sent as X-Dibs-CLI-Version and compared against the server's
  // X-Dibs-Min-Version / X-Dibs-Latest-Version. If it drifts from package.json the
  // server sees a stale version for every user and the upgrade nag never fires.
  it('matches the version in package.json', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string }
    expect(CLI_VERSION).toBe(pkg.version)
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

// Three separate hardcoded '0.0.1' literals shipped in this package — CLI_VERSION,
// commander's .version(), and the MCP handshake — each drifting silently from
// package.json for five releases. Equality tests only catch the ones you thought to
// write. This catches the next one nobody thought of, by refusing to let a bare
// semver literal exist outside version.ts at all.
describe('no stray version literals', () => {
  it('keeps CLI_VERSION the only hardcoded version in src', () => {
    const srcDir = path.join(process.cwd(), 'src')
    const offenders: string[] = []

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full)
          continue
        }
        if (!entry.name.endsWith('.ts')) continue
        if (full.endsWith(path.join('lib', 'version.ts'))) continue // the one allowed home

        fs.readFileSync(full, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) return
            if (/['"]\d+\.\d+\.\d+['"]/.test(line)) {
              offenders.push(`${path.relative(process.cwd(), full)}:${i + 1}  ${line.trim()}`)
            }
          })
      }
    }
    walk(srcDir)

    expect(offenders, `Import CLI_VERSION instead:\n${offenders.join('\n')}`).toEqual([])
  })
})
