import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import readline from 'readline'
import { requireCredentials } from '../lib/credentials'
import { apiCall } from '../lib/api'

interface Project {
  id: string
  name: string
  repoOwner: string | null
  repoName: string | null
  repoUrl: string | null
  ownerId: string
  createdAt: string
  updatedAt: string
  role?: 'OWNER' | 'MEMBER'
}

function parseGitRemote(remote: string): { owner: string; repo: string } | null {
  const sshMatch = remote.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }

  const httpsMatch = remote.match(/https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/)
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }

  return null
}

let sharedRl: readline.Interface | null = null
const lineBuffer: string[] = []
const lineWaiters: Array<(line: string) => void> = []

function ensureRl(): void {
  if (sharedRl) return
  sharedRl = readline.createInterface({ input: process.stdin, output: process.stdout })
  sharedRl.on('line', (line) => {
    const waiter = lineWaiters.shift()
    if (waiter) waiter(line)
    else lineBuffer.push(line)
  })
}

function closeRl(): void {
  sharedRl?.close()
  sharedRl = null
}

function prompt(question: string): Promise<string> {
  ensureRl()
  process.stdout.write(question)
  return new Promise((resolve) => {
    const buffered = lineBuffer.shift()
    if (buffered !== undefined) {
      resolve(buffered.trim())
    } else {
      lineWaiters.push((line) => resolve(line.trim()))
    }
  })
}

function simpleDiff(label: string, oldContent: string | null, newContent: string): string {
  const lines: string[] = []
  if (oldContent === null) {
    lines.push(`--- /dev/null`)
    lines.push(`+++ ${label} (new file)`)
    for (const line of newContent.split('\n')) {
      lines.push(`+ ${line}`)
    }
  } else {
    lines.push(`--- ${label} (existing)`)
    lines.push(`+++ ${label} (updated)`)
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')
    const maxLen = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxLen; i++) {
      const o = oldLines[i]
      const n = newLines[i]
      if (o !== n) {
        if (o !== undefined) lines.push(`- ${o}`)
        if (n !== undefined) lines.push(`+ ${n}`)
      }
    }
    if (lines.length === 2) {
      return ''
    }
  }
  return lines.join('\n')
}

export async function runInit() {
  try {
    await runInitInner()
  } finally {
    closeRl()
  }
}

async function runInitInner() {
  const creds = requireCredentials()
  const cwd = process.cwd()

  // 1. Detect git remote
  let detectedOwner: string | null = null
  let detectedRepo: string | null = null

  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf8' }).trim()
    const parsed = parseGitRemote(remoteUrl)
    if (parsed) {
      detectedOwner = parsed.owner
      detectedRepo = parsed.repo
      console.log(`Detected repository: ${detectedOwner}/${detectedRepo}`)
    }
  } catch {
    // no git remote — handled below
  }

  // 2. GET /projects — list user's memberships
  const projects = await apiCall<Project[]>('GET', '/projects', undefined, { token: creds.token })

  // 3. Filter by detected remote (if any)
  const matches = (detectedOwner && detectedRepo)
    ? projects.filter(
        (p) =>
          p.repoOwner?.toLowerCase() === detectedOwner!.toLowerCase() &&
          p.repoName?.toLowerCase() === detectedRepo!.toLowerCase()
      )
    : []

  // 4. Show picker
  let selectedProject: Project | null = null

  if (matches.length > 0) {
    console.log('\nExisting projects for this repo:')
    matches.forEach((p, i) => {
      const role = (p.role ?? 'member').toLowerCase()
      console.log(`  ${i + 1}) ${p.name} (id: ${p.id.slice(0, 8)}…, role: ${role})`)
    })
    console.log(`  ${matches.length + 1}) Create a new project for ${detectedOwner}/${detectedRepo}`)
    console.log()

    const raw = await prompt(`Select [1-${matches.length + 1}]: `)
    const choice = parseInt(raw, 10)
    if (isNaN(choice) || choice < 1 || choice > matches.length + 1) {
      console.error('Invalid selection.')
      process.exit(1)
    }
    if (choice <= matches.length) {
      selectedProject = matches[choice - 1]
      console.log(`Using project: ${selectedProject.name} (id: ${selectedProject.id})`)
    }
    // else: fall through to create
  }

  if (!selectedProject) {
    // Create flow
    const defaultName = (detectedOwner && detectedRepo)
      ? `${detectedOwner}/${detectedRepo}`
      : ''

    const namePrompt = defaultName
      ? `Project name [${defaultName}]: `
      : 'Project name: '
    const nameInput = await prompt(namePrompt)
    const name = nameInput || defaultName

    if (!name) {
      console.error('Project name is required.')
      process.exit(1)
    }

    const createBody: { name: string; repoOwner?: string; repoName?: string } = { name }
    if (detectedOwner && detectedRepo) {
      createBody.repoOwner = detectedOwner
      createBody.repoName = detectedRepo
    }

    selectedProject = await apiCall<Project>('POST', '/projects', createBody, { token: creds.token })
    console.log(`Project created (id: ${selectedProject.id})`)
  }

  const projectId = selectedProject.id

  // 3. Compute pending writes

  // .dibs/project.json
  const dibsDir = path.join(cwd, '.dibs')
  const projectJsonPath = path.join(dibsDir, 'project.json')
  const projectJsonContent = JSON.stringify({ projectId }, null, 2) + '\n'
  const existingProjectJson = fs.existsSync(projectJsonPath)
    ? fs.readFileSync(projectJsonPath, 'utf8')
    : null

  // .claude/settings.local.json
  const claudeDir = path.join(cwd, '.claude')
  const settingsPath = path.join(claudeDir, 'settings.local.json')
  let existingSettings: Record<string, unknown> = {}
  const existingSettingsRaw = fs.existsSync(settingsPath)
    ? fs.readFileSync(settingsPath, 'utf8')
    : null
  if (existingSettingsRaw) {
    try {
      existingSettings = JSON.parse(existingSettingsRaw) as Record<string, unknown>
    } catch {
      // ignore malformed JSON
    }
  }

  const mcpServers = ((existingSettings.mcpServers ?? {}) as Record<string, unknown>)
  mcpServers['dibs'] = { command: 'dibs', args: ['mcp'] }

  const hooks = ((existingSettings.hooks ?? {}) as Record<string, unknown>)
  const sessionStartHooks = (Array.isArray(hooks['SessionStart']) ? hooks['SessionStart'] : []) as Array<Record<string, unknown>>
  const dibsHookIndex = sessionStartHooks.findIndex((h) => h['_dibs'] === true)
  const dibsHook = { command: 'dibs session-start', _dibs: true }
  if (dibsHookIndex >= 0) {
    sessionStartHooks[dibsHookIndex] = dibsHook
  } else {
    sessionStartHooks.push(dibsHook)
  }
  hooks['SessionStart'] = sessionStartHooks

  const mergedSettings = {
    ...existingSettings,
    mcpServers,
    hooks,
  }
  const settingsContent = JSON.stringify(mergedSettings, null, 2) + '\n'

  // .gitignore — ensure .claude/settings.local.json is listed
  const gitignorePath = path.join(cwd, '.gitignore')
  const existingGitignore = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : ''
  const gitignoreEntry = '.claude/settings.local.json'
  const needsGitignoreUpdate = !existingGitignore
    .split(/\r?\n/)
    .some((line) => line.trim() === gitignoreEntry)
  const newGitignore = needsGitignoreUpdate
    ? (existingGitignore.endsWith('\n') || existingGitignore === ''
        ? existingGitignore + gitignoreEntry + '\n'
        : existingGitignore + '\n' + gitignoreEntry + '\n')
    : existingGitignore

  // 4. Show diff and prompt
  const diffs: string[] = []

  const projectJsonDiff = simpleDiff('.dibs/project.json', existingProjectJson, projectJsonContent)
  if (projectJsonDiff) diffs.push(projectJsonDiff)

  const settingsDiff = simpleDiff('.claude/settings.local.json', existingSettingsRaw, settingsContent)
  if (settingsDiff) diffs.push(settingsDiff)

  if (needsGitignoreUpdate) {
    const gitignoreDiff = simpleDiff('.gitignore', existingGitignore || null, newGitignore)
    if (gitignoreDiff) diffs.push(gitignoreDiff)
  }

  if (diffs.length === 0) {
    console.log('Nothing to change — already up to date.')
    return
  }

  console.log('\nPending changes:')
  console.log(diffs.join('\n\n'))
  console.log()

  const answer = await prompt('Apply? [y/N] ')
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted. No changes written.')
    return
  }

  // 5. Write files
  if (!fs.existsSync(dibsDir)) fs.mkdirSync(dibsDir, { recursive: true })
  fs.writeFileSync(projectJsonPath, projectJsonContent, 'utf8')

  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(settingsPath, settingsContent, 'utf8')

  if (needsGitignoreUpdate) {
    fs.writeFileSync(gitignorePath, newGitignore, 'utf8')
  }

  console.log('Done. Open Claude Code in this repo and the dibs MCP will be available.')
}
