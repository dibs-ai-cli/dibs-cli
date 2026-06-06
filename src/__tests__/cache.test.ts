import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Redirect the cache dir into an isolated temp folder so the test never touches
// the real ~/.dibs/cache. CACHE_DIR is computed from os.homedir() at import time,
// so the mock must be in place before cache.ts is imported. vi.mock and
// vi.hoisted are both hoisted above the regular imports, so TEST_HOME must be
// defined via vi.hoisted to be available inside the mock factory.
const { TEST_HOME } = vi.hoisted(() => {
  const osMod = require('os') as typeof import('os')
  const pathMod = require('path') as typeof import('path')
  return {
    TEST_HOME: pathMod.join(osMod.tmpdir(), `dibs-cache-test-${process.pid}`),
  }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const patched = { ...actual, homedir: () => TEST_HOME }
  return { ...patched, default: patched }
})

import { getCachePath, readCache, writeCache, type CacheEntry } from '../lib/cache'

function makeEntry(projectId: string, agentName: string, body: string): CacheEntry {
  return {
    projectId,
    agentName,
    fetchedAt: Date.now(),
    data: {
      messages: [
        {
          id: `msg-${agentName}`,
          body,
          targetType: 'AGENT',
          createdAt: new Date().toISOString(),
        },
      ],
      claims: [],
      unread: 1,
      activeClaimsTotal: 0,
      truncated: false,
    },
  }
}

describe('cache keying by (project, agent)', () => {
  beforeEach(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true })
  })
  afterEach(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true })
  })

  it('derives a distinct path per agent within the same project', () => {
    const a = getCachePath('proj-1', 'chris-A')
    const b = getCachePath('proj-1', 'chris-B')
    expect(a).not.toBe(b)
  })

  it('sanitizes characters that are illegal in filenames', () => {
    // The default identity is `user@host`; a hostile DIBS_AGENT_NAME must not
    // be able to escape the cache dir or break the path.
    const p = getCachePath('proj-1', 'chris@Velocity/../../etc')
    expect(path.basename(p)).not.toContain('/')
    expect(path.basename(p)).not.toContain('\\')
    expect(p.startsWith(path.join(TEST_HOME, '.dibs', 'cache'))).toBe(true)
  })

  it('does not let sibling agents read each other\'s cached view', () => {
    writeCache(makeEntry('proj-1', 'chris-A', 'hello from A'))
    writeCache(makeEntry('proj-1', 'chris-B', 'hello from B'))

    const a = readCache('proj-1', 'chris-A')
    const b = readCache('proj-1', 'chris-B')

    expect(a?.data.messages[0].body).toBe('hello from A')
    expect(b?.data.messages[0].body).toBe('hello from B')
  })

  it('returns null when no cache exists for that agent', () => {
    writeCache(makeEntry('proj-1', 'chris-A', 'hello from A'))
    expect(readCache('proj-1', 'chris-B')).toBeNull()
  })

  it('round-trips an entry for the same identity', () => {
    const entry = makeEntry('proj-1', 'chris-A', 'persisted')
    writeCache(entry)
    const got = readCache('proj-1', 'chris-A')
    expect(got?.agentName).toBe('chris-A')
    expect(got?.data.unread).toBe(1)
  })
})
