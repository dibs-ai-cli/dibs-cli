import { readCredentials } from '../lib/credentials'
import { findProject } from '../lib/project'
import { apiCall } from '../lib/api'
import { resolveAgentName } from '../lib/agent-name'

interface SyncMessage {
  id: string
  body: string
  targetType: 'AGENT' | 'USER' | 'BROADCAST'
  createdAt: string
  senderAgent?: { name: string } | null
  senderUser?: { githubLogin: string } | null
  claim?: { id: string; title: string; type: string; paths: string[] } | null
}

interface SyncClaim {
  id: string
  type: 'FILE' | 'IDEA'
  title: string
  paths: string[]
  status: string
  updatedAt: string
  agent?: { name: string } | null
}

interface SyncResponse {
  messages: SyncMessage[]
  claims: SyncClaim[]
  unread: number
  activeClaimsTotal: number
  truncated: boolean
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function formatSender(msg: SyncMessage): string {
  return msg.senderAgent?.name ?? msg.senderUser?.githubLogin ?? 'unknown'
}

export async function runSync() {
  const creds = readCredentials()
  if (!creds) return

  const proj = findProject()
  if (!proj) return

  let data: SyncResponse
  try {
    data = await apiCall<SyncResponse>(
      'GET',
      `/projects/${proj.projectId}/sync`,
      undefined,
      { token: creds.token, agentName: resolveAgentName() }
    )
  } catch {
    return
  }

  const hasMessages = data.messages.length > 0
  const hasClaims = data.claims.length > 0
  if (!hasMessages && !hasClaims) return

  const lines: string[] = []
  lines.push('<dibs-context>')

  if (hasMessages) {
    lines.push(`You have ${data.unread} unread dibs message${data.unread === 1 ? '' : 's'} — surface each one verbatim to the user before doing anything else:`)
    for (const msg of data.messages) {
      const sender = formatSender(msg)
      const when = formatRelative(msg.createdAt)
      const claimNote = msg.claim ? ` (re: claim "${msg.claim.title}")` : ''
      lines.push(`  - ${sender} (${when})${claimNote}: ${msg.body}`)
    }
    lines.push('')
  }

  if (hasClaims) {
    const noun = data.claims.length === 1 ? 'claim' : 'claims'
    lines.push(`Active ${noun} by other agents in this project. Only mention to the user if one of these conflicts with what you are about to do:`)
    for (const claim of data.claims) {
      const who = claim.agent?.name ?? 'unknown'
      const when = formatRelative(claim.updatedAt)
      const paths = claim.paths.length > 0 ? ` — ${claim.paths.join(', ')}` : ''
      lines.push(`  - ${who}: "${claim.title}" [${claim.type}, ${claim.status}, ${when}]${paths}`)
    }
    if (data.truncated) {
      const remaining = data.activeClaimsTotal - data.claims.length
      lines.push(`  (+${remaining} more — run \`dibs claims\` to see all)`)
    }
    lines.push('')
  }

  lines.push('</dibs-context>')

  process.stdout.write(lines.join('\n') + '\n')
}
