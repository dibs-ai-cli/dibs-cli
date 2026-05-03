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
  if (status === 403 && message.includes('not a member')) {
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
      'Start a coordination session at the beginning of every work session — call this once before doing anything else. ' +
      'Returns the project name, your agent identity, all currently active claims in the project, and any unread messages addressed to you. ' +
      'Use the returned active claims to understand what other agents are working on before you start, and check unread messages for any coordination requests waiting for you. ' +
      'This call is idempotent: re-running it updates your presence timestamp and returns fresh state without creating duplicates.',
    annotations: { readOnlyHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_claims',
    description:
      'Fetch active, blocked, and recently-finished claims across the project, optionally filtered to a specific file path. ' +
      'Call this before editing a file to check whether another agent has claimed it — pass the relative file path in `path` to narrow results. ' +
      'Returns claims in states ACTIVE, BLOCKED, and WRAPPING_UP (meaning the other agent is almost done and you may proceed soon), plus ABANDONED and STALE claims from the last 24 hours for context. ' +
      'Claims older than 4 hours with no updates are automatically marked STALE on this call — treat STALE claims as low-risk but still worth a quick message if paths overlap. ' +
      'Does not modify any claim state beyond the automatic stale-marking.',
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
      'Register intent to work on a set of files or a conceptual area — call this before starting work, not after. ' +
      'Use FILE for tightly-scoped changes to specific files; use IDEA for larger efforts where the full file set is not yet known. ' +
      'Always provide `paths` when you know which files you will touch: path-based claims trigger automatic conflict warnings to any other agent already claiming those files, and the response includes a `conflicts` array with details. ' +
      'If `conflicts` is non-empty, read those claims, then use send_message to coordinate with the conflicting agents before proceeding — do not silently proceed over an active conflict. ' +
      'Claims without paths do not trigger conflict detection. Only you (this agent) can update or release a claim you create.',
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
      'Update the status, file paths, or progress note on a claim you own. ' +
      'Status transitions signal your progress to other agents: set BLOCKED when you are waiting on something and others should know not to expect completion soon; set WRAPPING_UP when you are finishing and others can begin planning their work on overlapping paths; set ABANDONED to cancel a claim you will not complete (or use release_claim as a convenience). ' +
      'Valid status values are ACTIVE (default), BLOCKED, WRAPPING_UP, and ABANDONED. ' +
      'You can only update claims created by this agent — attempting to update another agent\'s claim will return a 403 error.',
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
      'Mark a claim as complete and release it when you have finished the work. ' +
      'This sets the claim status to ABANDONED, which signals to other agents that the files are free. ' +
      'Call this as soon as your work on the claimed files is done — do not leave claims open indefinitely. ' +
      'You can only release claims created by this agent. Equivalent to calling update_claim with status ABANDONED.',
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
      'Send a coordination message to another agent, to the human user, or broadcast to everyone in the project. ' +
      'Use AGENT when you need to coordinate directly with a specific agent (e.g. you detected a conflict and want to negotiate scope); if that agent has been inactive for 30+ minutes the message is automatically escalated to their human user as well. ' +
      'Use USER to ask the human a question or flag something that requires human judgment. ' +
      'Use BROADCAST for project-wide announcements (e.g. "I am refactoring the auth module, expect widespread changes"). ' +
      'Set `claimId` to link the message to a specific claim for context. Set `parentMessageId` to reply within an existing thread.',
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
      'Fetch unread messages addressed to this agent, to your user, or broadcast to the project — or retrieve a full conversation thread. ' +
      'Call this periodically during long-running work to catch coordination requests from other agents. ' +
      'Without `threadId`, returns all unread messages plus the total unread count; mark messages as read with mark_read once you have acted on them. ' +
      'Pass `threadId` (any message ID in the thread) to fetch the full conversation thread in chronological order — useful when you receive a reply and need the prior context.',
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
      'Mark one or more messages as read so they no longer appear in future get_messages calls. ' +
      'Call this after you have read and acted on messages returned by get_messages. ' +
      'You can only mark messages addressed to you or broadcast to the project. ' +
      'Accepts a list of message IDs — batch all messages from a single get_messages response into one call.',
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
      writeCache({ projectId: proj.projectId, fetchedAt: Date.now(), data })

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

  // Seed from disk if a fresh cache already exists (e.g. another session wrote it)
  const existing = readCache(proj.projectId)
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
          const [agent, project, sync] = await Promise.all([
            api.registerAgent(agentName),
            api.getProject(),
            api.getSync(),
          ])
          const syncData = sync as SyncData
          memCache = syncData
          writeCache({ projectId: proj.projectId, fetchedAt: Date.now(), data: syncData })
          result = {
            agent,
            project,
            activeClaims: syncData.claims,
            unreadMessages: syncData.messages,
          }
          break
        }
        case 'get_claims': {
          const filterPath = args.path as string | undefined
          if (memCache && !filterPath) {
            // Serve all other-agent claims from cache — no network call.
            result = memCache.claims
          } else if (memCache && filterPath) {
            // Filter in-memory — the cache holds up to 20 other-agent claims.
            result = memCache.claims.filter(c => c.paths.includes(filterPath))
          } else {
            result = await api.getClaims(filterPath)
          }
          break
        }
        case 'create_claim': {
          result = await api.createClaim(
            args as { type: 'FILE' | 'IDEA'; title: string; paths?: string[]; note?: string }
          )
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
          result = await api.updateClaim(claimId, rest)
          void pollSync()
          break
        }
        case 'release_claim': {
          result = await api.releaseClaim((args as { claimId: string }).claimId)
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
            result = await api.getThread(threadId)
          } else if (memCache) {
            result = { messages: memCache.messages, unread: memCache.unread }
          } else {
            result = await api.getMessages()
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
            writeCache({ projectId: proj.projectId, fetchedAt: Date.now(), data: memCache })
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
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
