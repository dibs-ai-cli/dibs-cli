import fs from 'fs'
import path from 'path'

export interface ProjectConfig {
  projectId: string
}

const PROJECT_FILE = path.join('.dibs', 'project.json')

/**
 * Walk up from cwd looking for .dibs/project.json.
 * Returns the parsed config or null if not found.
 */
export function findProject(startDir: string = process.cwd()): ProjectConfig | null {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, PROJECT_FILE)
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (!parsed.projectId) return null
        return { projectId: parsed.projectId as string }
      } catch {
        return null
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function requireProject(): ProjectConfig {
  let dir = process.cwd()
  while (true) {
    const candidate = path.join(dir, PROJECT_FILE)
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (!parsed.projectId) {
          console.error('Old .dibs/project.json format detected. Please run `dibs init` again.')
          process.exit(1)
        }
        return { projectId: parsed.projectId as string }
      } catch {
        console.error('No dibs project found. Run `dibs init` in your repo first.')
        process.exit(1)
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  console.error('No dibs project found. Run `dibs init` in your repo first.')
  process.exit(1)
}
