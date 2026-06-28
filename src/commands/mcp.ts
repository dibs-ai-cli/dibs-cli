#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { requireCredentials } from '../lib/credentials'
import { requireProject } from '../lib/project'
import { makeProjectApi, ApiError, getVersionHints } from '../lib/api'
import { resolveAgentName } from '../lib/agent-name'
import { readCache, writeCache, isFresh, type SyncData } from '../lib/cache'
import { CLI_VERSION, isOlderThan } from '../lib/version'

function describeError(tool: string, err: unknown): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : String(err)
  }

  const { status, message } = err

  if (status === 426) {
    return (
      'Your dibs CLI is too old to work with this server. ' +
      'Tell the user to run: npm install -g @dibsai/cli && dibs init'
    )
  }

  // Auth errors apply to every tool
  if (status === 401) {
    return (
      'Your dibs credentials are missing or expired. ' +
      'Run `dibs login` in your terminal to re-authenticate, then restart this Claude Code session.'
    )
  }
  if (status === 403 && /not a member/i.test(message)) {
    return (
      'You are not a member of this project. ' +
      'Ask the project owner to invite you, or run `dibs init` to connect to a project you own.'
    )
  }

  switch (tool) {
    case 'update_claim':
      if (status === 404) {
        return (
          'Claim not found. ' +
          'Use get_claims to see your active claims and confirm the claimId, then retry.'
        )
      }
      if (status === 403) {
        return (
          'You cannot update this claim — it was created by a different agent. ' +
          'To coordinate, use send_message targeting that agent. ' +
          'Only the agent that created a claim can change its status or paths.'
        )
      }
      if (status === 400) {
        return `update_claim requires at least one of: status, note, or paths. ${message}`
      }
      break

    case 'release_claim':
      if (status === 404) {
        return (
          'Claim not found — it may have already been released. ' +
          'Use get_claims to verify. If the claim is gone, no further action is needed.'
        )
      }
      if (status === 403) {
        return (
          'You cannot release this claim — it was created by a different agent. ' +
          'Only the agent that created a claim can release it.'
        )
      }
      break

    case 'send_message':
      if (status === 400 && message.includes('targetId required')) {
        const forType = message.includes('AGENT') ? 'AGENT' : 'USER'
        const hint =
          forType === 'AGENT'
            ? 'Set targetId to the agent name (visible in get_claims or register_agent results).'
            : 'Set targetId to the GitHub login of the user you want to reach.'
        return `targetId is required when targetType is ${forType}. ${hint}`
      }
      if (status === 404 && message.includes('agent')) {
        return (
          'No agent with that name exists in this project. ' +
          'Use get_claims to see active agents and their names, then retry with the correct targetId.'
        )
      }
      if (status === 404 && message.includes('user')) {
        return (
          'No user with that GitHub login is a member of this project. ' +
          'Use get_claims to see active agents; the agent object includes the associated user login.'
        )
      }
      break

    case 'get_messages':
      if (status === 404) {
        return (
          'Thread not found, or you are not a participant in that thread. ' +
          'Verify the threadId comes from a message in your get_messages results.'
        )
      }
      break
  }

  // Fallback: include the raw API message so nothing is silently swallowed
  return `dibs API error (${status}): ${message}`
}

// Exported so contract tests can snapshot and assert the tool surface without
// spinning up the full MCP server.
export const MCP_TOOLS = [
  {
    name: 'register_agent',
    description:
      'Call once at the start of a work session, before anything else. ' +
      'Returns the project, your agent identity, all active claims, and unread messages addressed to you — ' +
      'review the claims to see what others are working on, and check messages for coordination requests. ' +
      'Idempotent: re-running refreshes your presence and returns current state without creating duplicates.',
    annotations: { readOnlyHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_members',
    description:
      'List everyone with access to this project and their running agent sessions — each member\'s GitHub login, ' +
      'role (OWNER or MEMBER), and registered agents (name + lastSeenAt). ' +
      'Use it to find an agent name before messaging, or to see who is online. ' +
      'A member with status PENDING has requested to auto-join and is awaiting owner approval (the owner approves with `dibs approve <login>`). ' +
      'No agents means the member never ran the dibs CLI here; a lastSeenAt older than a few minutes means they are likely not in an active session.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_claims',
    description:
      'Check who is working on what before editing — pass a relative `path` to filter to claims touching that file. ' +
      'Returns ACTIVE, BLOCKED, and WRAPPING_UP claims (WRAPPING_UP = nearly done, you may proceed soon), ' +
      'plus ABANDONED and STALE ones from the last 24 hours. ' +
      'Claims untouched for 4 hours are auto-marked STALE on this call (low-risk, but message the owner if paths overlap). Modifies no other state.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative file path to filter claims by (e.g. "src/auth/login.ts"). Omit to get all active claims in the project.',
        },
      },
    },
  },
  {
    name: 'create_claim',
    description:
      'Register intent to work on files or an area before you start, not after. ' +
      'Use FILE for specific paths, IDEA for broader work where the file set is not yet known. ' +
      'Always pass `paths` when known — path claims trigger conflict warnings and the response\'s `conflicts` array lists any overlapping claims. ' +
      'If `conflicts` is non-empty, read them and use send_message to coordinate before proceeding — do not silently proceed over a conflict. ' +
      'Claims without paths skip conflict detection. Only you can update or release a claim you create.',
    annotations: { destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['FILE', 'IDEA'],
          description:
            'FILE for specific path-scoped work; IDEA for broader efforts where paths are partially known',
        },
        title: {
          type: 'string',
          description: 'Short human-readable description of what you are working on',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Relative file paths involved (e.g. ["src/auth/login.ts", "src/auth/session.ts"]). Strongly recommended — omitting paths disables conflict detection.',
        },
        note: {
          type: 'string',
          description: 'Optional progress note visible to other agents',
        },
      },
      required: ['type', 'title'],
    },
  },
  {
    name: 'update_claim',
    description:
      'Update the status, paths, or note on a claim you own. ' +
      'Status signals progress to others: BLOCKED (waiting on something), WRAPPING_UP (finishing — others can start planning overlapping work), ABANDONED (cancel; or use release_claim). ' +
      'Values: ACTIVE, BLOCKED, WRAPPING_UP, ABANDONED. ' +
      'Updating another agent\'s claim returns a 403 error.',
    annotations: { destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        claimId: {
          type: 'string',
          description: 'ID of the claim to update, from create_claim or get_claims',
        },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'BLOCKED', 'WRAPPING_UP', 'ABANDONED'],
          description: 'New status for the claim',
        },
        note: {
          type: 'string',
          description: 'Updated progress note visible to other agents',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Revised set of file paths for this claim',
        },
      },
      required: ['claimId'],
    },
  },
  {
    name: 'release_claim',
    description:
      'Mark a claim complete and free its files when you are done — sets status to ABANDONED. ' +
      'Release as soon as the work is finished; do not leave claims open. ' +
      'You can only release your own claims. Same as update_claim with status ABANDONED.',
    annotations: { destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        claimId: {
          type: 'string',
          description: 'ID of the claim to release, from create_claim or get_claims',
        },
      },
      required: ['claimId'],
    },
  },
  {
    name: 'send_message',
    description:
      'Send a coordination message to an agent, the human user, or everyone. ' +
      'AGENT: coordinate with a specific agent (e.g. negotiate scope on a conflict); auto-escalated to their human if they have been inactive 30+ minutes. ' +
      'USER: ask the human or flag something needing their judgment. ' +
      'BROADCAST: project-wide announcements (e.g. "refactoring auth, expect widespread changes"). ' +
      'Set `claimId` to link a claim for context, `parentMessageId` to reply in a thread.',
    annotations: { destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        targetType: {
          type: 'string',
          enum: ['AGENT', 'USER', 'BROADCAST'],
          description: 'Who to send the message to',
        },
        targetId: {
          type: 'string',
          description:
            'For AGENT: the agent\'s name (from get_claims or register_agent results). For USER: the GitHub login of the human. Omit for BROADCAST.',
        },
        body: {
          type: 'string',
          description: 'Message content',
        },
        claimId: {
          type: 'string',
          description: 'Optional claim ID to link this message to a specific claim',
        },
        parentMessageId: {
          type: 'string',
          description: 'Optional message ID to reply within an existing thread',
        },
      },
      required: ['targetType', 'body'],
    },
  },
  {
    name: 'get_messages',
    description:
      'Fetch unread messages addressed to you, your user, or broadcast — or a full conversation thread. ' +
      'Call periodically during long work to catch coordination requests. ' +
      'Without `threadId`: returns unread messages and the unread count (use mark_read once handled). ' +
      'With `threadId` (any message ID in the thread): returns the full conversation in order — useful for prior context on a reply.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description:
            'Optional: any message ID whose thread you want to fetch in full. Omit to get all unread messages.',
        },
      },
    },
  },
  {
    name: 'mark_read',
    description:
      'Mark messages as read so they stop appearing in get_messages. ' +
      'Call after acting on messages from get_messages. ' +
      'You can only mark messages addressed to you or broadcast. ' +
      'Batch all IDs from one get_messages response into a single call.',
    annotations: { readOnlyHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        messageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of message IDs to mark as read',
        },
      },
      required: ['messageIds'],
    },
  },
] as const

// --- Result slimming ---
// The API returns fat ORM rows (projectId, userId, agentId, nested *.id,
// createdAt, expiresAt, …). MCP tool results stay in the model's context for the
// rest of the session, so every redundant field is paid for on every later turn.
// Project results down to the fields the model actually uses before returning.

function slimClaim(c: any): unknown {
  if (!c || typeof c !== 'object') return c
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    paths: c.paths,
    status: c.status,
    ...(c.note != null ? { note: c.note } : {}),
    updatedAt: c.updatedAt,
    ...(c.agent ? { agent: { name: c.agent.name } } : {}),
    ...(c.user ? { user: { githubLogin: c.user.githubLogin } } : {}),
  }
}

function slimMessage(m: any): unknown {
  if (!m || typeof m !== 'object') return m
  return {
    id: m.id,
    body: m.body,
    targetType: m.targetType,
    createdAt: m.createdAt,
    ...(m.senderAgent ? { senderAgent: { name: m.senderAgent.name } } : {}),
    ...(m.senderUser ? { senderUser: { githubLogin: m.senderUser.githubLogin } } : {}),
    ...(m.claim
      ? { claim: { id: m.claim.id, title: m.claim.title, type: m.claim.type, paths: m.claim.paths } }
      : {}),
  }
}

const slimClaimList = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(slimClaim) : x
const slimMessageList = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(slimMessage) : x

function slimAgent(a: any): unknown {
  if (!a || typeof a !== 'object') return a
  return { name: a.name, lastSeenAt: a.lastSeenAt }
}

function slimProject(p: any): unknown {
  if (!p || typeof p !== 'object') return p
  // Drop id/ownerId/timestamps and the embedded member roster (emails included)
  // — the model only needs the project's identity, and list_members covers members.
  return { name: p.name, repoOwner: p.repoOwner, repoName: p.repoName }
}

function slimMember(m: any): unknown {
  if (!m || typeof m !== 'object') return m
  return {
    githubLogin: m.githubLogin,
    role: m.role,
    // Only surface non-default status (PENDING) — ACTIVE is the common case.
    ...(m.status && m.status !== 'ACTIVE' ? { status: m.status } : {}),
    ...(Array.isArray(m.agents) ? { agents: m.agents.map(slimAgent) } : {}),
  }
}

type RegisterApi = {
  registerAgent: (name: string) => Promise<unknown>
  getProject: () => Promise<unknown>
  getSync: () => Promise<unknown>
  join: (code: string) => Promise<{ status?: string }>
}

/**
 * Fetch the register_agent bundle, auto-joining on first contact.
 * A contributor lands here via the repo's committed .dibs/project.json without
 * being a member yet — on "not a member" we redeem the committed joinCode. If the
 * project auto-approves, we're in immediately and retry; otherwise a join request
 * is filed and we report that the owner must approve before they're active.
 */
export async function registerWithAutoJoin(
  api: RegisterApi,
  agentName: string,
  joinCode?: string
): Promise<[unknown, unknown, unknown]> {
  const fetchBundle = (): Promise<[unknown, unknown, unknown]> =>
    Promise.all([api.registerAgent(agentName), api.getProject(), api.getSync()])

  try {
    return await fetchBundle()
  } catch (err) {
    if (err instanceof ApiError && err.status === 403 && /not a member/i.test(err.message)) {
      if (!joinCode) throw err
      const res = await api.join(joinCode)
      if (res?.status === 'pending') {
        // Plain Error: describeError returns its message verbatim (not "API error").
        throw new Error(
          'Join request submitted — waiting for the project owner to approve. ' +
            'You are not active in this project yet; retry register_agent once approved.'
        )
      }
      return await fetchBundle()
    }
    throw err
  }
}

export function runMcp() {
  const creds = requireCredentials()
  const proj = requireProject()

  const agentName = resolveAgentName()

  const api = makeProjectApi(proj.projectId, creds.token, agentName)

  // --- In-memory cache ---
  // Seeded by register_agent and kept fresh by the background poll.
  // get_messages and get_claims read from here; writes trigger a background re-poll.
  let memCache: SyncData | null = null
  let versionChecked = false

  const pollIntervalMs = Math.max(
    10_000,
    parseInt(process.env.DIBS_POLL_INTERVAL ?? '30', 10) * 1000
  )

  async function pollSync(): Promise<void> {
    try {
      const data = await api.getSync() as SyncData
      memCache = data
      writeCache({ projectId: proj.projectId, agentName, fetchedAt: Date.now(), data })

      if (!versionChecked) {
        versionChecked = true
        const { latest } = getVersionHints()
        if (latest && isOlderThan(CLI_VERSION, latest)) {
          console.error(
            `[dibs] Update available (${CLI_VERSION} → ${latest}). Run: npm install -g @dibsai/cli && dibs init`
          )
        }
      }
    } catch {
      // Keep using stale cache on transient failures — don't crash the server
    }
  }

  // Seed from disk if a fresh cache already exists for this same identity
  // (e.g. a hook or a prior run of this agent wrote it).
  const existing = readCache(proj.projectId, agentName)
  if (existing && isFresh(existing)) memCache = existing.data

  // Start background polling; .unref() so the interval doesn't prevent clean exit
  const poller = setInterval(() => { void pollSync() }, pollIntervalMs)
  poller.unref()

  const server = new Server(
    { name: 'dibs', version: '0.0.1' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params

    try {
      let result: unknown

      switch (name) {
        case 'register_agent': {
          // Always authoritative — hits the API and seeds the cache with fresh data.
          // Auto-joins the project on first contact (see registerWithAutoJoin).
          const [agent, project, sync] = await registerWithAutoJoin(api, agentName, proj.joinCode)
          const syncData = sync as SyncData
          memCache = syncData
          writeCache({ projectId: proj.projectId, agentName, fetchedAt: Date.now(), data: syncData })
          result = {
            agent: slimAgent(agent),
            project: slimProject(project),
            activeClaims: syncData.claims.map(slimClaim),
            unreadMessages: syncData.messages.map(slimMessage),
          }
          break
        }
        case 'list_members': {
          const members = await api.getMembers()
          result = Array.isArray(members) ? members.map(slimMember) : members
          break
        }
        case 'get_claims': {
          const filterPath = args.path as string | undefined
          if (memCache && !filterPath) {
            // Serve all other-agent claims from cache — no network call.
            result = memCache.claims.map(slimClaim)
          } else if (memCache && filterPath) {
            // Filter in-memory — the cache holds up to 20 other-agent claims.
            result = memCache.claims.filter(c => c.paths.includes(filterPath)).map(slimClaim)
          } else {
            result = slimClaimList(await api.getClaims(filterPath))
          }
          break
        }
        case 'create_claim': {
          const created = await api.createClaim(
            args as { type: 'FILE' | 'IDEA'; title: string; paths?: string[]; note?: string }
          ) as { claim?: unknown; conflicts?: unknown[] }
          result = {
            ...created,
            claim: slimClaim(created.claim),
            conflicts: (created.conflicts ?? []).map(slimClaim),
          }
          void pollSync()
          break
        }
        case 'update_claim': {
          const { claimId, ...rest } = args as {
            claimId: string
            status?: string
            note?: string
            paths?: string[]
          }
          result = slimClaim(await api.updateClaim(claimId, rest))
          void pollSync()
          break
        }
        case 'release_claim': {
          result = slimClaim(await api.releaseClaim((args as { claimId: string }).claimId))
          void pollSync()
          break
        }
        case 'send_message': {
          result = await api.sendMessage(
            args as {
              targetType: 'AGENT' | 'USER' | 'BROADCAST'
              targetId?: string
              body: string
              claimId?: string
              parentMessageId?: string
            }
          )
          break
        }
        case 'get_messages': {
          const threadId = (args as { threadId?: string }).threadId
          if (threadId) {
            // Thread fetches always need fresh data from the API.
            const thread = await api.getThread(threadId) as
              | unknown[]
              | { messages?: unknown[] }
            result = Array.isArray(thread)
              ? thread.map(slimMessage)
              : thread && Array.isArray(thread.messages)
                ? { ...thread, messages: thread.messages.map(slimMessage) }
                : thread
          } else if (memCache) {
            result = { messages: memCache.messages.map(slimMessage), unread: memCache.unread }
          } else {
            const fetched = await api.getMessages() as unknown
            result = Array.isArray(fetched)
              ? fetched.map(slimMessage)
              : fetched && Array.isArray((fetched as { messages?: unknown[] }).messages)
                ? { ...(fetched as object), messages: (fetched as { messages: unknown[] }).messages.map(slimMessage) }
                : fetched
          }
          break
        }
        case 'mark_read': {
          const { messageIds } = args as { messageIds: string[] }
          result = await api.markRead(messageIds)
          // Remove the marked messages from the in-memory cache immediately so they
          // don't reappear in the next get_messages before the next poll fires.
          if (memCache) {
            const readSet = new Set(messageIds)
            const remaining = memCache.messages.filter(m => !readSet.has(m.id))
            memCache = {
              ...memCache,
              messages: remaining,
              unread: Math.max(0, memCache.unread - (memCache.messages.length - remaining.length)),
            }
            writeCache({ projectId: proj.projectId, agentName, fetchedAt: Date.now(), data: memCache })
          }
          break
        }
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: describeError(name, err) }],
        isError: true,
      }
    }
  })

  async function start() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error(
      `dibs MCP server connected (project=${proj.projectId}, agent=${agentName})`
    )
  }

  start().catch((err) => {
    console.error('dibs MCP server failed:', err)
    process.exit(1)
  })
}
