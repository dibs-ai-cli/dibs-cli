import fs from 'fs'
import path from 'path'

export interface ProjectConfig {
  projectId: string
  // Standing join secret (optional) — present once the project has auto-join set up.
  joinCode?: string
}

// A gitignored local override wins over the committed repo default, so a
// contributor can point at their own project without touching the shared file.
const PROJECT_FILES = [
  path.join('.dibs', 'project.local.json'),
  path.join('.dibs', 'project.json'),
]

function readProjectAt(dir: string): ProjectConfig | null {
  for (const rel of PROJECT_FILES) {
    const candidate = path.join(dir, rel)
    if (!fs.existsSync(candidate)) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Record<string, unknown>
      if (parsed.projectId) {
        return {
          projectId: parsed.projectId as string,
          ...(typeof parsed.joinCode === 'string' ? { joinCode: parsed.joinCode } : {}),
        }
      }
    } catch {
      // malformed — fall through to the next candidate / parent dir
    }
  }
  return null
}

/**
 * Walk up from cwd looking for a dibs project pointer.
 * Local override (project.local.json) beats the committed project.json.
 * Returns the parsed config or null if not found.
 */
export function findProject(startDir: string = process.cwd()): ProjectConfig | null {
  let dir = startDir
  while (true) {
    const found = readProjectAt(dir)
    if (found) return found
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function requireProject(): ProjectConfig {
  const proj = findProject()
  if (!proj) {
    console.error('No dibs project found. Run `dibs init` in your repo first.')
    process.exit(1)
  }
  return proj
}
