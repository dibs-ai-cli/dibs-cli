import { describe, it, expect, vi } from 'vitest'
import { registerWithAutoJoin } from '../commands/mcp'
import { ApiError } from '../lib/api'

function makeApi(over: Partial<Record<'registerAgent' | 'getProject' | 'getSync' | 'join', any>> = {}) {
  return {
    registerAgent: vi.fn().mockResolvedValue('agent'),
    getProject: vi.fn().mockResolvedValue('project'),
    getSync: vi.fn().mockResolvedValue('sync'),
    join: vi.fn().mockResolvedValue({ status: 'active' }),
    ...over,
  }
}

// Server message is capitalized; the match must be case-insensitive.
const notMember = new ApiError(403, 'Not a member of this project')
const CODE = 'join-code-123'

describe('registerWithAutoJoin', () => {
  it('existing member: returns bundle, never calls join', async () => {
    const api = makeApi()
    const result = await registerWithAutoJoin(api, 'a1', CODE)
    expect(result).toEqual(['agent', 'project', 'sync'])
    expect(api.join).not.toHaveBeenCalled()
  })

  it('auto-approve newcomer: redeems code then retries successfully', async () => {
    const registerAgent = vi
      .fn()
      .mockRejectedValueOnce(notMember)
      .mockResolvedValueOnce('agent')
    const api = makeApi({ registerAgent })
    const result = await registerWithAutoJoin(api, 'a1', CODE)
    expect(api.join).toHaveBeenCalledWith(CODE)
    expect(result).toEqual(['agent', 'project', 'sync'])
  })

  it('approval-required newcomer: pending status throws a wait-for-approval message', async () => {
    const registerAgent = vi.fn().mockRejectedValue(notMember)
    const api = makeApi({ registerAgent, join: vi.fn().mockResolvedValue({ status: 'pending' }) })
    await expect(registerWithAutoJoin(api, 'a1', CODE)).rejects.toThrow(/waiting for the project owner/i)
  })

  it('no join code: re-throws the not-member error (nothing to redeem)', async () => {
    const registerAgent = vi.fn().mockRejectedValue(notMember)
    const api = makeApi({ registerAgent })
    await expect(registerWithAutoJoin(api, 'a1', undefined)).rejects.toThrow(/not a member/i)
    expect(api.join).not.toHaveBeenCalled()
  })

  it('non-membership errors are not retried', async () => {
    const registerAgent = vi.fn().mockRejectedValue(new ApiError(500, 'boom'))
    const api = makeApi({ registerAgent })
    await expect(registerWithAutoJoin(api, 'a1', CODE)).rejects.toThrow(/boom/)
    expect(api.join).not.toHaveBeenCalled()
  })
})
