import { readCredentials } from './credentials'
import { getApiUrl } from './config'
import { CLI_VERSION } from './version'

export { getWebUrl } from './config'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// Populated from response headers on every API call.
// Read by getVersionHints() in the MCP server after the first request.
let _latestVersion: string | null = null
let _minVersion: string | null = null

export function getVersionHints(): { latest: string | null; min: string | null } {
  return { latest: _latestVersion, min: _minVersion }
}

export async function apiCall<T = unknown>(
  method: string,
  urlPath: string,
  body?: unknown,
  options: { token?: string; agentName?: string } = {}
): Promise<T> {
  const creds = options.token ? null : readCredentials()
  const token = options.token ?? creds?.token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Dibs-CLI-Version': CLI_VERSION,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (options.agentName) {
    headers['X-Agent-Name'] = options.agentName
  }

  const res = await fetch(`${getApiUrl()}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  // Capture version hints from every response so the MCP server can warn once.
  const latest = res.headers.get('X-Dibs-Latest-Version')
  const min = res.headers.get('X-Dibs-Min-Version')
  if (latest) _latestVersion = latest
  if (min) _minVersion = min

  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      const json = JSON.parse(text) as { message?: string; error?: string }
      if (json.message) message = json.message
      else if (json.error) message = json.error
    } catch {
      // not JSON, use raw text
    }
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function createInvite(
  projectId: string,
  body: { role?: 'MEMBER' | 'OWNER'; expiresInDays?: number },
  token: string
): Promise<{ id: string; code: string; url: string; role: string; expiresAt: string; createdAt: string }> {
  return apiCall('POST', `/projects/${projectId}/invites`, body, { token })
}

/** Build a project-scoped API client for the MCP server */
export function makeProjectApi(
  projectId: string,
  token: string,
  agentName: string
) {
  const projectBase = `/projects/${projectId}`
  const opts = { token, agentName }

  return {
    registerAgent: (name: string) =>
      apiCall('POST', `${projectBase}/agents`, { name }, opts),

    getProject: () => apiCall('GET', projectBase, undefined, opts),

    getClaims: (filterPath?: string) => {
      const query = filterPath ? `?path=${encodeURIComponent(filterPath)}` : ''
      return apiCall('GET', `${projectBase}/claims${query}`, undefined, opts)
    },
    createClaim: (data: { type: 'FILE' | 'IDEA'; title: string; paths?: string[]; note?: string }) =>
      apiCall('POST', `${projectBase}/claims`, data, opts),
    updateClaim: (claimId: string, data: { status?: string; note?: string; paths?: string[] }) =>
      apiCall('PATCH', `${projectBase}/claims/${claimId}`, data, opts),
    releaseClaim: (claimId: string) =>
      apiCall('DELETE', `${projectBase}/claims/${claimId}`, undefined, opts),

    sendMessage: (data: {
      targetType: 'AGENT' | 'USER' | 'BROADCAST'
      targetId?: string
      body: string
      claimId?: string
      parentMessageId?: string
    }) => apiCall('POST', `${projectBase}/messages`, data, opts),
    getMessages: () => apiCall('GET', `${projectBase}/messages`, undefined, opts),
    getThread: (messageId: string) =>
      apiCall('GET', `${projectBase}/messages/${messageId}/thread`, undefined, opts),
    markRead: (messageIds: string[]) =>
      apiCall('POST', `${projectBase}/messages/mark-read`, { messageIds }, opts),

    getMembers: () => apiCall('GET', `${projectBase}/members`, undefined, opts),

    getSync: () => apiCall('GET', `${projectBase}/sync`, undefined, opts),
  }
}
