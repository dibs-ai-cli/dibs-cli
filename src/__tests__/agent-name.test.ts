import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import { resolveAgentName } from '../lib/agent-name'

const HOST = os.hostname()
const USER = process.env.USER ?? process.env.USERNAME ?? 'agent'

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('DIBS_AGENT_NAME', '')
  vi.stubEnv('DIBS_SESSION_NAME', '')
  vi.stubEnv('CLAUDE_CODE_SESSION_ID', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveAgentName per-session identity', () => {
  it('two sessions on one machine register as distinct agents', () => {
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '1b5cdc78-40b1-4864-aae1-836ec8190a37')
    const sessionA = resolveAgentName()
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '9f0e1d2c-3b4a-5968-8776-655443322110')
    const sessionB = resolveAgentName()
    expect(sessionA).not.toBe(sessionB)
  })

  it('all processes of one session (MCP server, hooks) compute the same name', () => {
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '1b5cdc78-40b1-4864-aae1-836ec8190a37')
    expect(resolveAgentName()).toBe(resolveAgentName())
    expect(resolveAgentName()).toBe(`${USER}@${HOST}/1b5cdc78`)
  })

  it('keeps the user@host grouping prefix', () => {
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '1b5cdc78-40b1-4864-aae1-836ec8190a37')
    expect(resolveAgentName().startsWith(`${USER}@${HOST}/`)).toBe(true)
  })

  it('DIBS_SESSION_NAME gives a readable label and wins over the session id', () => {
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '1b5cdc78-40b1-4864-aae1-836ec8190a37')
    vi.stubEnv('DIBS_SESSION_NAME', 'sprooster-copy')
    expect(resolveAgentName()).toBe(`${USER}@${HOST}/sprooster-copy`)
  })

  it('sanitizes labels for the X-Agent-Name header and cache filename', () => {
    vi.stubEnv('DIBS_SESSION_NAME', 'my label\r\nX-Evil: 1')
    const name = resolveAgentName()
    expect(name).toBe(`${USER}@${HOST}/my-label--X-Evil--1`)
  })

  it('no session info → unchanged legacy identity (compat with existing agent rows)', () => {
    expect(resolveAgentName()).toBe(`${USER}@${HOST}`)
  })

  it('DIBS_AGENT_NAME overrides everything, unchanged', () => {
    vi.stubEnv('DIBS_AGENT_NAME', 'custom-agent')
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '1b5cdc78-40b1-4864-aae1-836ec8190a37')
    expect(resolveAgentName()).toBe('custom-agent')
  })
})
