import os from 'os'

// Per-session identity: several Claude Code sessions often run against one
// clone at once. If they all register as bare user@host they collapse into one
// agent — overlap warnings self-address, targeted messages can't reach "the
// other session", and claims are misattributed. A session suffix keeps each
// session a distinct agent while the user@host prefix keeps them visibly
// grouped as one person/machine in list_members.
export function resolveAgentName(): string {
  if (process.env.DIBS_AGENT_NAME) return process.env.DIBS_AGENT_NAME
  const user = process.env.USER ?? process.env.USERNAME ?? 'agent'
  const base = `${user}@${os.hostname()}`
  const session = resolveSessionLabel()
  return session ? `${base}/${session}` : base
}

// DIBS_SESSION_NAME gives a human-readable label (chris@Velocity/sprooster).
// Otherwise fall back to the harness session id — Claude Code sets
// CLAUDE_CODE_SESSION_ID in the environment of the MCP server and hook
// processes alike, so every dibs process of one session computes the same
// name, and different sessions get different ones. With neither set the name
// stays bare user@host, identical to the pre-session behavior.
function resolveSessionLabel(): string | null {
  const label =
    process.env.DIBS_SESSION_NAME || process.env.CLAUDE_CODE_SESSION_ID?.slice(0, 8)
  if (!label) return null
  // Sanitize: the name travels in the X-Agent-Name header and the cache filename.
  return label.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 32) || null
}
