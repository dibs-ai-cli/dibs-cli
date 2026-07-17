import os from 'os'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Basename of the git working copy we're running in.
 *
 * This is what separates two agents on one machine. Worktrees are the normal way
 * to run several agents at once, and every worktree has its own toplevel, so the
 * basename is naturally distinct per worktree ("mantelin-calendar" vs
 * "design-elevation") while staying stable across restarts.
 *
 * Returns null outside a git repo, or when git isn't on PATH.
 */
function worktreeLabel(): string | null {
  try {
    const top = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return top ? path.basename(top) : null
  } catch {
    return null
  }
}

/**
 * Identity this session presents as, sent as X-Agent-Name on every request.
 *
 * The API upserts agents on (projectId, name), so the name *is* the identity —
 * two sessions sharing a name are literally one agent: they can't warn each
 * other about overlap, can't message each other, and either can release the
 * other's claims. `user@host` alone collided for every session on a machine,
 * which broke the one thing dibs exists to do the moment you ran two agents.
 *
 * Deliberately stable rather than random-per-process. A random suffix would give
 * each session a fresh identity, but claims are owned by agent id and the API
 * 403s anyone else's claim — so restarting an agent would strand every claim it
 * still held, with no way to release them. Keying on the working copy keeps an
 * agent's claims across restarts and still tells worktrees apart.
 *
 * DIBS_AGENT_NAME overrides everything, for running two agents in one directory
 * or giving an agent a memorable name.
 */
export function resolveAgentName(): string {
  if (process.env.DIBS_AGENT_NAME) return process.env.DIBS_AGENT_NAME
  const user = process.env.USER ?? process.env.USERNAME ?? 'agent'
  const host = os.hostname()
  const label = worktreeLabel()
  return label ? `${user}@${host}:${label}` : `${user}@${host}`
}
