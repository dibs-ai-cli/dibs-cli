import { readCredentials } from '../lib/credentials'
import { findProject } from '../lib/project'
import { apiCall } from '../lib/api'
import { resolveAgentName } from '../lib/agent-name'

interface Message {
  id: string
  body: string
  senderAgent?: { name: string } | null
  senderUser?: { githubLogin: string } | null
}

interface MessagesResponse {
  messages: Message[]
  unread: number
}

export async function runSessionStart() {
  const creds = readCredentials()
  if (!creds) return

  const proj = findProject()
  if (!proj) return

  try {
    const { messages, unread } = await apiCall<MessagesResponse>(
      'GET',
      `/projects/${proj.projectId}/messages`,
      undefined,
      { token: creds.token, agentName: resolveAgentName() }
    )

    if (!messages || messages.length === 0) return

    process.stderr.write(`[dibs] ${unread} unread message${unread === 1 ? '' : 's'} in project ${proj.projectId}:\n`)
    for (const msg of messages) {
      const sender = msg.senderAgent?.name ?? msg.senderUser?.githubLogin ?? 'unknown'
      const preview = msg.body.length > 80 ? msg.body.slice(0, 77) + '...' : msg.body
      process.stderr.write(`  - ${sender}: "${preview}"\n`)
    }
  } catch {
    // Silently ignore errors — don't break the session
  }
}
