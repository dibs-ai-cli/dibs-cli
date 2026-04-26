import { readCredentials } from '../lib/credentials'
import { findProject } from '../lib/project'
import { apiCall } from '../lib/api'

interface Message {
  id: string
  senderName?: string
  senderAgent?: string
  body: string
  [key: string]: unknown
}

export async function runSessionStart() {
  const creds = readCredentials()
  if (!creds) return

  const proj = findProject()
  if (!proj) return

  try {
    const messages = await apiCall<Message[]>(
      'GET',
      `/projects/${proj.projectId}/messages`,
      undefined,
      { token: creds.token }
    )

    if (!messages || messages.length === 0) return

    process.stderr.write(`[dibs] ${messages.length} unread message${messages.length === 1 ? '' : 's'} in project ${proj.projectId}:\n`)
    for (const msg of messages) {
      const sender = msg.senderAgent ?? msg.senderName ?? 'unknown'
      const preview = msg.body.length > 80 ? msg.body.slice(0, 77) + '...' : msg.body
      process.stderr.write(`  - ${sender}: "${preview}"\n`)
    }
  } catch {
    // Silently ignore errors — don't break the session
  }
}
