import fs from 'fs'
import path from 'path'
import os from 'os'

export interface Credentials {
  token: string
  prefix: string
  createdAt: string
}

const CREDENTIALS_PATH = path.join(os.homedir(), '.dibs', 'credentials')

export function readCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8')
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

export function writeCredentials(creds: Credentials): void {
  const dir = path.dirname(CREDENTIALS_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export function deleteCredentials(): void {
  try {
    fs.unlinkSync(CREDENTIALS_PATH)
  } catch {
    // already gone
  }
}

export function requireCredentials(): Credentials {
  const creds = readCredentials()
  if (!creds) {
    console.error('Not logged in. Run `dibs login` first.')
    process.exit(1)
  }
  return creds
}
