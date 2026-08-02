import { readCredentials } from '../lib/credentials'
import { findProject } from '../lib/project'
import { apiCall } from '../lib/api'
import { resolveAgentName } from '../lib/agent-name'
import { readCache, isFresh, type SyncData } from '../lib/cache'

export async function runSessionStart() {
  const creds = readCredentials()
  if (!creds) return

  const proj = findProject()
  if (!proj) return

  const agentName = resolveAgentName()

  let messages: SyncData['messages']

  const cached = readCache(proj.projectId, agentName)
  if (cached && isFresh(cached)) {
    messages = cached.data.messages
  } else {
    try {
      const result = await apiCall<{ messages: SyncData['messages']; unread: number }>(
        'GET',
        `/projects/${proj.projectId}/messages`,
        undefined,
        { token: creds.token, agentName }
      )
      messages = result.messages
    } catch {
      return
    }
  }

  if (!messages || messages.length === 0) return

  // Only messages addressed to the human belong in the human's terminal.
  // Agent-to-agent coordination (AGENT/BROADCAST) is handled by the agents
  // themselves — surfacing it here is exactly the noise we want to avoid.
  const forUser = messages.filter((m) => m.targetType === 'USER')
  if (forUser.length === 0) return

  process.stderr.write(`[dibs] ${forUser.length} message${forUser.length === 1 ? '' : 's'} for you in project ${proj.projectId}:\n`)
  for (const msg of forUser) {
    const sender = msg.senderAgent?.name ?? msg.senderUser?.githubLogin ?? 'unknown'
    const preview = msg.body.length > 80 ? msg.body.slice(0, 77) + '...' : msg.body
    process.stderr.write(`  - ${sender}: "${preview}"\n`)
  }
}
