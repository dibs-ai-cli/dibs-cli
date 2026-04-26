import { requireCredentials } from '../lib/credentials'
import { apiCall } from '../lib/api'

interface MeResponse {
  id?: string
  githubLogin?: string
  email?: string
  [key: string]: unknown
}

export async function runWhoami() {
  requireCredentials()
  const me = await apiCall<MeResponse>('GET', '/auth/me')
  if (me.githubLogin) console.log(`Login: ${me.githubLogin}`)
  if (me.email) console.log(`Email: ${me.email}`)
  if (me.id) console.log(`ID:    ${me.id}`)
  if (!me.githubLogin && !me.email && !me.id) {
    console.log(JSON.stringify(me, null, 2))
  }
}
