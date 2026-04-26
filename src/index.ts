#!/usr/bin/env node
import { Command } from 'commander'

const program = new Command()

program
  .name('dibs')
  .description('Coordinate work between AI agents in a shared codebase')
  .version('0.0.1')

program
  .command('login')
  .description('Authenticate and store credentials in ~/.dibs/credentials')
  .option('--device', 'Use device-code flow instead of browser')
  .action(async (opts: { device?: boolean }) => {
    const { runLogin } = await import('./commands/login')
    await runLogin(opts)
  })

program
  .command('logout')
  .description('Remove stored credentials')
  .action(async () => {
    const { runLogout } = await import('./commands/logout')
    runLogout()
  })

program
  .command('whoami')
  .description('Print the currently authenticated user')
  .action(async () => {
    const { runWhoami } = await import('./commands/whoami')
    await runWhoami()
  })

program
  .command('init')
  .description('Bind the current repo to a dibs project and configure Claude Code')
  .action(async () => {
    const { runInit } = await import('./commands/init')
    await runInit()
  })

program
  .command('invite')
  .description('Create an invite link for this project')
  .option('--role <role>', 'Role to grant (member or owner)', 'member')
  .option('--expires-days <days>', 'Days until the invite expires', '7')
  .action(async (opts: { role: string; expiresDays: string }) => {
    const { runInvite } = await import('./commands/invite')
    await runInvite({ role: opts.role, expiresDays: parseInt(opts.expiresDays, 10) })
  })

program
  .command('mcp')
  .description('Start the dibs MCP server (used by Claude Code via mcpServers config)')
  .action(async () => {
    const { runMcp } = await import('./commands/mcp')
    runMcp()
  })

program
  .command('session-start')
  .description('Print unread dibs messages (run as a Claude Code SessionStart hook)')
  .action(async () => {
    const { runSessionStart } = await import('./commands/session-start')
    await runSessionStart()
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
