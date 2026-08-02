import { requireCredentials } from '../lib/credentials'
import { requireProject } from '../lib/project'
import { apiCall, ApiError } from '../lib/api'

export async function runApprove(login: string) {
  const proj = requireProject()
  const creds = requireCredentials()

  try {
    await apiCall(
      'POST',
      `/projects/${proj.projectId}/approve`,
      { githubLogin: login },
      { token: creds.token }
    )
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      console.error('Only the project owner can approve join requests.')
      process.exit(1)
    }
    if (err instanceof ApiError && err.status === 404) {
      console.error(`No pending join request from "${login}".`)
      process.exit(1)
    }
    throw err
  }

  console.log(`Approved ${login}.`)
}
