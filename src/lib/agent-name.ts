import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { randomUUID } from 'crypto'

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
 * Human-readable display *label* for this session, sent as X-Agent-Name.
 *
 * This used to be the identity — the API upserted agents on (projectId, name),
 * so two sessions sharing a name were literally one agent. That collapsed every
 * concurrent session in one worktree into a single identity: they couldn't warn
 * each other, couldn't message each other, and a directed message could land on
 * the wrong session. Identity now lives in a per-session id (see newSessionId),
 * and this name is just a label — non-unique, for legibility.
 *
 * DIBS_AGENT_NAME overrides it, to give an agent a memorable name.
 */
export function resolveAgentName(): string {
  if (process.env.DIBS_AGENT_NAME) return process.env.DIBS_AGENT_NAME
  const user = process.env.USER ?? process.env.USERNAME ?? 'agent'
  const host = os.hostname()
  const label = worktreeLabel()
  return label ? `${user}@${host}:${label}` : `${user}@${host}`
}

/**
 * Uniqueness key for a live MCP session, sent as X-Agent-Session.
 *
 * Minted fresh per process and held in memory — the MCP server is 1:1 with a
 * running agent session, so a new id per process makes concurrent sessions
 * distinct with zero naming discipline, even in the same worktree. Not
 * persisted: a restart is a new session, which strands the previous session's
 * claims (they auto-expire to STALE after 4h). DIBS_SESSION_ID overrides it,
 * for tests or pinning an identity across restarts.
 */
export function newSessionId(): string {
  return process.env.DIBS_SESSION_ID || randomUUID()
}
