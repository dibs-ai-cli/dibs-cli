import { requireCredentials } from '../lib/credentials'
import { apiCall } from '../lib/api'

interface MeResponse {
  id?: string
  email?: string
  name?: string
  [key: string]: unknown
}

export async function runWhoami() {
  requireCredentials()
  const me = await apiCall<MeResponse>('GET', '/auth/me')
  if (me.name) console.log(`Name:  ${me.name}`)
  if (me.email) console.log(`Email: ${me.email}`)
  if (me.id) console.log(`ID:    ${me.id}`)
  if (!me.name && !me.email && !me.id) {
    console.log(JSON.stringify(me, null, 2))
  }
}
