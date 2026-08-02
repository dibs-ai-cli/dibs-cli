import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveAgentName, newSessionId } from '../lib/agent-name'

const originalEnv = { ...process.env }
const originalCwd = process.cwd()

afterEach(() => {
  process.env = { ...originalEnv }
  process.chdir(originalCwd)
})

describe('resolveAgentName', () => {
  beforeEach(() => {
    delete process.env.DIBS_AGENT_NAME
  })

  it('lets DIBS_AGENT_NAME override everything', () => {
    process.env.DIBS_AGENT_NAME = 'reviewer-bot'
    expect(resolveAgentName()).toBe('reviewer-bot')
  })

  it('identifies the working copy, not just the machine', () => {
    // The display label still names the worktree so it reads usefully; uniqueness
    // between concurrent sessions is the session id's job (see newSessionId).
    expect(resolveAgentName()).toMatch(/^.+@.+:.+$/)
  })

  // The regression that matters: two worktrees of one repo, both on this machine,
  // as the same OS user. This is the normal way to run several agents at once, and
  // it has to produce two identities or they cannot coordinate at all.
  it('gives two worktrees of the same repo distinct identities', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dibs-agent-name-'))
    const run = (cmd: string, cwd: string) =>
      execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })

    try {
      const main = path.join(tmp, 'main-checkout')
      fs.mkdirSync(main)
      run('git init -q', main)
      run('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', main)

      const linked = path.join(tmp, 'feature-worktree')
      run(`git worktree add -q --detach "${linked}"`, main)

      process.chdir(main)
      const mainAgent = resolveAgentName()
      process.chdir(linked)
      const linkedAgent = resolveAgentName()

      expect(mainAgent).not.toBe(linkedAgent)
      expect(mainAgent).toContain('main-checkout')
      expect(linkedAgent).toContain('feature-worktree')
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('still returns a usable name outside a git repo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dibs-no-git-'))
    try {
      process.chdir(tmp)
      expect(resolveAgentName()).toMatch(/^.+@.+$/)
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('newSessionId', () => {
  beforeEach(() => {
    delete process.env.DIBS_SESSION_ID
  })

  // The core of the fix: two sessions in the *same* worktree share a display name
  // but must be distinct agents. resolveAgentName() can't tell them apart; the
  // session id must.
  it('mints a distinct id on every call', () => {
    const a = newSessionId()
    const b = newSessionId()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('lets DIBS_SESSION_ID pin the id (e.g. for tests)', () => {
    process.env.DIBS_SESSION_ID = 'fixed-session-123'
    expect(newSessionId()).toBe('fixed-session-123')
    expect(newSessionId()).toBe('fixed-session-123')
  })
})
