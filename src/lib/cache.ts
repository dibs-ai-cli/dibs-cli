import fs from 'fs'
import path from 'path'
import os from 'os'

export interface SyncMessage {
  id: string
  body: string
  targetType: 'AGENT' | 'USER' | 'BROADCAST'
  createdAt: string
  senderAgent?: { name: string } | null
  senderUser?: { githubLogin: string } | null
  claim?: { id: string; title: string; type: string; paths: string[] } | null
}

export interface SyncClaim {
  id: string
  type: 'FILE' | 'IDEA'
  title: string
  paths: string[]
  status: string
  updatedAt: string
  agent?: { name: string } | null
}

export interface SyncData {
  messages: SyncMessage[]
  claims: SyncClaim[]
  unread: number
  activeClaimsTotal: number
  truncated: boolean
}

export interface CacheEntry {
  projectId: string
  fetchedAt: number
  data: SyncData
}

// How old a cache file can be before hooks fall back to the API.
// Chosen to be longer than the MCP poll interval (30s) but short enough
// that a crashed MCP server doesn't serve stale data indefinitely.
export const CACHE_MAX_AGE_MS = 90_000

const CACHE_DIR = path.join(os.homedir(), '.dibs', 'cache')

export function getCachePath(projectId: string): string {
  return path.join(CACHE_DIR, `${projectId}.json`)
}

export function readCache(projectId: string): CacheEntry | null {
  try {
    const raw = fs.readFileSync(getCachePath(projectId), 'utf8')
    return JSON.parse(raw) as CacheEntry
  } catch {
    return null
  }
}

export function writeCache(entry: CacheEntry): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  // Atomic write: write to a temp file then rename so readers never see a partial file.
  const tmp = path.join(os.tmpdir(), `dibs-${entry.projectId}-${Date.now()}.json`)
  fs.writeFileSync(tmp, JSON.stringify(entry))
  fs.renameSync(tmp, getCachePath(entry.projectId))
}

export function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CACHE_MAX_AGE_MS
}
