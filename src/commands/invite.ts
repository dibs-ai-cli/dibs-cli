import { requireCredentials } from '../lib/credentials'
import { requireProject } from '../lib/project'
import { createInvite, ApiError } from '../lib/api'

export async function runInvite(opts: { role: string; expiresDays: number }) {
  const proj = requireProject()
  const creds = requireCredentials()

  const role = opts.role.toUpperCase() as 'MEMBER' | 'OWNER'

  let invite: Awaited<ReturnType<typeof createInvite>>
  try {
    invite = await createInvite(proj.projectId, { role, expiresInDays: opts.expiresDays }, creds.token)
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      console.error('Only project owners can create invites.')
      process.exit(1)
    }
    throw err
  }

  const expires = new Date(invite.expiresAt).toLocaleString()

  console.log('Invite created — share this link:')
  console.log(`  ${invite.url}`)
  console.log()
  console.log(`Role: ${invite.role.toLowerCase()}`)
  console.log(`Expires: ${expires}`)
}
