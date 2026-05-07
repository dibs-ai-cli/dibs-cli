import { describe, it, expect } from 'vitest'
import { MCP_TOOLS } from '../commands/mcp'

// These are the names agents depend on. Renaming or removing a tool is a breaking change.
const EXPECTED_TOOL_NAMES = [
  'register_agent',
  'list_members',
  'get_claims',
  'create_claim',
  'update_claim',
  'release_claim',
  'send_message',
  'get_messages',
  'mark_read',
]

// Required fields agents are expected to always provide. Adding a new required field
// is a breaking change for agents on older CLI versions.
const EXPECTED_REQUIRED_FIELDS: Record<string, string[]> = {
  create_claim:  ['type', 'title'],
  update_claim:  ['claimId'],
  release_claim: ['claimId'],
  send_message:  ['targetType', 'body'],
  mark_read:     ['messageIds'],
}

describe('MCP tool surface', () => {
  it('exposes exactly the expected tools in the expected order', () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES)
  })

  it('every tool has a non-empty description', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length, `${tool.name} description must not be empty`).toBeGreaterThan(0)
    }
  })

  it('required fields match the expected contract', () => {
    for (const [toolName, expected] of Object.entries(EXPECTED_REQUIRED_FIELDS)) {
      const tool = MCP_TOOLS.find((t) => t.name === toolName)
      expect(tool, `tool "${toolName}" must exist`).toBeDefined()
      const required = (tool!.inputSchema as { required?: string[] }).required ?? []
      expect(required, `${toolName} required fields changed`).toEqual(expected)
    }
  })

  it('tools with no required fields have none listed', () => {
    const noRequiredTools = ['register_agent', 'list_members', 'get_claims', 'get_messages']
    for (const toolName of noRequiredTools) {
      const tool = MCP_TOOLS.find((t) => t.name === toolName)
      expect(tool, `tool "${toolName}" must exist`).toBeDefined()
      const required = (tool!.inputSchema as { required?: string[] }).required
      expect(required, `${toolName} should have no required fields`).toBeUndefined()
    }
  })

  it('matches the full schema snapshot', () => {
    expect(MCP_TOOLS).toMatchSnapshot()
  })
})
