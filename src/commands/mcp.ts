#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { requireCredentials } from '../lib/credentials'
import { requireProject } from '../lib/project'
import { makeProjectApi, ApiError } from '../lib/api'
import { resolveAgentName } from '../lib/agent-name'

export function runMcp() {
  const creds = requireCredentials()
  const proj = requireProject()

  const agentName = resolveAgentName()

  const api = makeProjectApi(proj.projectId, creds.token, agentName)

  const server = new Server(
    { name: 'dibs', version: '0.0.1' },
    { capabilities: { tools: {} } }
  )

  const tools = [
    {
      name: 'register_agent',
      description:
        'Start a coordination session. Returns the project info, your active claims, and any unread messages. Call this once at the start of work.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_claims',
      description:
        'Get active and recent claims in this project. Use the path filter to check who is working on a specific file before you edit it.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional file path to filter claims by' },
        },
      },
    },
    {
      name: 'create_claim',
      description:
        'Claim a file or idea to signal ownership. Use FILE for tightly-scoped path work; use IDEA for larger efforts and list the paths you expect to touch. Conflicting claims are warned, not blocked — overlap will trigger an automatic message to the other agent.',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['FILE', 'IDEA'],
            description: 'FILE for specific path work, IDEA for a larger effort',
          },
          title: { type: 'string', description: 'Short description of what you are working on' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths involved in this claim',
          },
          note: { type: 'string', description: 'Optional progress note' },
        },
        required: ['type', 'title'],
      },
    },
    {
      name: 'update_claim',
      description:
        'Update the status, paths, or progress note on an existing claim. Use status changes to signal progress (BLOCKED, WRAPPING_UP) so other agents know whether to wait or proceed.',
      inputSchema: {
        type: 'object',
        properties: {
          claimId: { type: 'string' },
          status: {
            type: 'string',
            enum: ['ACTIVE', 'BLOCKED', 'WRAPPING_UP', 'ABANDONED'],
          },
          note: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
        },
        required: ['claimId'],
      },
    },
    {
      name: 'release_claim',
      description: 'Release a claim when work is complete. This marks the claim as abandoned.',
      inputSchema: {
        type: 'object',
        properties: { claimId: { type: 'string' } },
        required: ['claimId'],
      },
    },
    {
      name: 'send_message',
      description:
        'Send a message to another agent, a user, or broadcast to all agents in the project. Use AGENT for direct agent-to-agent coordination, USER for asking a human, BROADCAST for project-wide announcements.',
      inputSchema: {
        type: 'object',
        properties: {
          targetType: { type: 'string', enum: ['AGENT', 'USER', 'BROADCAST'] },
          targetId: {
            type: 'string',
            description: 'Agent name (for AGENT) or GitHub login (for USER). Omit for BROADCAST.',
          },
          body: { type: 'string' },
          claimId: { type: 'string', description: 'Optional claim this message is about' },
          parentMessageId: {
            type: 'string',
            description: 'Optional parent message ID — set this to reply within a thread',
          },
        },
        required: ['targetType', 'body'],
      },
    },
    {
      name: 'get_messages',
      description:
        'Get unread messages addressed to you (this agent), to your user, or broadcast to the project. Pass threadId to fetch a full conversation thread instead.',
      inputSchema: {
        type: 'object',
        properties: {
          threadId: {
            type: 'string',
            description: 'Optional message ID to fetch the full thread containing it',
          },
        },
      },
    },
    {
      name: 'mark_read',
      description: 'Mark messages as read so they do not appear in future unread queries.',
      inputSchema: {
        type: 'object',
        properties: {
          messageIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['messageIds'],
      },
    },
  ]

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params

    try {
      let result: unknown

      switch (name) {
        case 'register_agent': {
          const [agent, project, claims, messages] = await Promise.all([
            api.registerAgent(agentName),
            api.getProject(),
            api.getClaims(),
            api.getMessages(),
          ])
          result = {
            agent,
            project,
            activeClaims: claims,
            unreadMessages: messages,
          }
          break
        }
        case 'get_claims':
          result = await api.getClaims(args.path as string | undefined)
          break
        case 'create_claim':
          result = await api.createClaim(
            args as { type: 'FILE' | 'IDEA'; title: string; paths?: string[]; note?: string }
          )
          break
        case 'update_claim': {
          const { claimId, ...rest } = args as {
            claimId: string
            status?: string
            note?: string
            paths?: string[]
          }
          result = await api.updateClaim(claimId, rest)
          break
        }
        case 'release_claim':
          result = await api.releaseClaim((args as { claimId: string }).claimId)
          break
        case 'send_message':
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
        case 'get_messages': {
          const threadId = (args as { threadId?: string }).threadId
          result = threadId ? await api.getThread(threadId) : await api.getMessages()
          break
        }
        case 'mark_read':
          result = await api.markRead((args as { messageIds: string[] }).messageIds)
          break
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
      const message =
        err instanceof ApiError
          ? `API error (${err.status}): ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err)
      return {
        content: [{ type: 'text', text: message }],
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
