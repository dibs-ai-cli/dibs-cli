import { deleteCredentials, readCredentials } from '../lib/credentials'

export function runLogout() {
  const creds = readCredentials()
  if (!creds) {
    console.log('Not logged in.')
    return
  }
  deleteCredentials()
  console.log('Logged out.')
}
