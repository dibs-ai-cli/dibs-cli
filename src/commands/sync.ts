import { readCredentials } from '../lib/credentials'
import { findProject } from '../lib/project'
import { apiCall } from '../lib/api'
import { resolveAgentName } from '../lib/agent-name'
import { readCache, isFresh, type SyncData } from '../lib/cache'

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

function formatSender(msg: SyncData['messages'][number]): string {
  return msg.senderAgent?.name ?? msg.senderUser?.githubLogin ?? 'unknown'
}

export async function runSync() {
  const creds = readCredentials()
  if (!creds) return

  const proj = findProject()
  if (!proj) return

  const agentName = resolveAgentName()

  let data: SyncData
  const cached = readCache(proj.projectId, agentName)
  if (cached && isFresh(cached)) {
    data = cached.data
  } else {
    try {
      data = await apiCall<SyncData>(
        'GET',
        `/projects/${proj.projectId}/sync`,
        undefined,
        { token: creds.token, agentName }
      )
    } catch {
      return
    }
  }

  // Only USER-targeted messages are meant for the human. AGENT-targeted and
  // BROADCAST messages are coordination between agents — this agent handles them
  // itself via dibs and must not relay them to the user. (The API already
  // escalates an agent message to a USER message when its target agent has been
  // offline too long, so anything a human genuinely needs shows up as USER.)
  const forUser = data.messages.filter((m) => m.targetType === 'USER')
  const forAgent = data.messages.filter((m) => m.targetType !== 'USER')
  const hasClaims = data.claims.length > 0
  if (forUser.length === 0 && forAgent.length === 0 && !hasClaims) return

  const lines: string[] = []
  lines.push('<dibs-context>')

  if (forUser.length > 0) {
    const s = forUser.length === 1
    lines.push(`${forUser.length} dibs message${s ? '' : 's'} ${s ? 'is' : 'are'} addressed to your user — surface ${s ? 'it' : 'each one'} to them verbatim before doing anything else:`)
    for (const msg of forUser) {
      const claimNote = msg.claim ? ` (re: claim "${msg.claim.title}")` : ''
      lines.push(`  - ${formatSender(msg)} (${formatRelative(msg.createdAt)})${claimNote}: ${msg.body}`)
    }
    lines.push('')
  }

  if (forAgent.length > 0) {
    const s = forAgent.length === 1
    lines.push(`${forAgent.length} coordination message${s ? '' : 's'} from other agents ${s ? 'is' : 'are'} addressed to you (this agent), not your user. Handle ${s ? 'it' : 'them'} yourself with dibs — reply or negotiate with send_message, adjust your claims, and resolve overlaps directly. Do NOT relay ${s ? 'it' : 'these'} to the user; only involve them if you are blocked and need a human decision. Call mark_read once handled:`)
    for (const msg of forAgent) {
      const scope = msg.targetType === 'BROADCAST' ? ' [broadcast]' : ''
      const claimNote = msg.claim ? ` (re: claim "${msg.claim.title}")` : ''
      lines.push(`  - ${formatSender(msg)} (${formatRelative(msg.createdAt)})${scope}${claimNote}: ${msg.body}`)
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
