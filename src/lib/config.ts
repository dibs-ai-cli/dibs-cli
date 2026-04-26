import fs from 'fs'
import path from 'path'
import os from 'os'

export interface Config {
  apiUrl?: string
  webUrl?: string
}

const CONFIG_PATH = path.join(os.homedir(), '.dibs', 'config.json')

export function readConfig(): Config {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(raw) as Config
  } catch {
    return {}
  }
}

export function writeConfig(config: Config): void {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function getApiUrl(): string {
  return process.env.DIBS_API_URL ?? readConfig().apiUrl ?? 'https://api.dibsai.dev'
}

export function getWebUrl(): string {
  return process.env.DIBS_WEB_URL ?? readConfig().webUrl ?? 'https://app.dibsai.dev'
}
