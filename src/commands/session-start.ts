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

  let messages: SyncData['messages']
  let unread: number

  const cached = readCache(proj.projectId)
  if (cached && isFresh(cached)) {
    messages = cached.data.messages
    unread = cached.data.unread
  } else {
    try {
      const result = await apiCall<{ messages: SyncData['messages']; unread: number }>(
        'GET',
        `/projects/${proj.projectId}/messages`,
        undefined,
        { token: creds.token, agentName: resolveAgentName() }
      )
      messages = result.messages
      unread = result.unread
    } catch {
      return
    }
  }

  if (!messages || messages.length === 0) return

  process.stderr.write(`[dibs] ${unread} unread message${unread === 1 ? '' : 's'} in project ${proj.projectId}:\n`)
  for (const msg of messages) {
    const sender = msg.senderAgent?.name ?? msg.senderUser?.githubLogin ?? 'unknown'
    const preview = msg.body.length > 80 ? msg.body.slice(0, 77) + '...' : msg.body
    process.stderr.write(`  - ${sender}: "${preview}"\n`)
  }
}
