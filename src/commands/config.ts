import { readConfig, writeConfig, getConfigPath, getApiUrl, getWebUrl } from '../lib/config'

type ConfigKey = 'apiUrl' | 'webUrl'

const VALID_KEYS: ConfigKey[] = ['apiUrl', 'webUrl']

function assertValidKey(key: string): asserts key is ConfigKey {
  if (!VALID_KEYS.includes(key as ConfigKey)) {
    console.error(`Unknown config key: ${key}. Valid keys: ${VALID_KEYS.join(', ')}`)
    process.exit(1)
  }
}

function getSource(key: ConfigKey): string {
  const envVar = key === 'apiUrl' ? 'DIBS_API_URL' : 'DIBS_WEB_URL'
  if (process.env[envVar]) return 'env'
  const config = readConfig()
  if (config[key] !== undefined) return 'file'
  return 'default'
}

export function runConfigGet(key?: string) {
  if (key !== undefined) {
    assertValidKey(key)
    const value = key === 'apiUrl' ? getApiUrl() : getWebUrl()
    console.log(value)
    return
  }

  const apiUrlSource = getSource('apiUrl')
  const webUrlSource = getSource('webUrl')
  console.log(`apiUrl: ${getApiUrl()} (${apiUrlSource})`)
  console.log(`webUrl: ${getWebUrl()} (${webUrlSource})`)
}

export function runConfigSet(key: string, value: string) {
  assertValidKey(key)

  try {
    new URL(value)
  } catch {
    console.error(`Invalid URL: ${value}`)
    process.exit(1)
  }

  const normalized = value.replace(/\/+$/, '')
  const config = readConfig()
  config[key] = normalized
  writeConfig(config)
  console.log(`Set ${key} = ${normalized}`)
}

export function runConfigUnset(key: string) {
  assertValidKey(key)
  const config = readConfig()
  delete config[key]
  writeConfig(config)
  console.log(`Unset ${key}`)
}

export function runConfigPath() {
  console.log(getConfigPath())
}
