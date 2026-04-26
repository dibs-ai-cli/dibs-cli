import http from 'http'
import net from 'net'
import os from 'os'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { writeCredentials } from '../lib/credentials'
import { apiCall, getWebUrl, ApiError } from '../lib/api'

interface TokenFields {
  token: string
  prefix: string
  name?: string
}

interface DeviceCodeResponse {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

interface PollResponse {
  status: 'pending' | 'approved'
  token?: string
  prefix?: string
  name?: string
}

function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo
      srv.close(() => resolve(addr.port))
    })
    srv.on('error', reject)
  })
}

function openBrowser(url: string): void {
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'cmd'
    : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', (err) => {
    console.error(`(could not auto-open browser: ${err.message})`)
  })
  child.unref()
}

async function browserLogin(): Promise<TokenFields> {
  const state = randomBytes(32).toString('hex')
  const port = await getRandomPort()
  const hostname = os.hostname()

  return new Promise((resolve, reject) => {
    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout>

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      fn()
    }

    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/callback') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as { state?: string; token?: string; prefix?: string }
            if (data.state !== state) {
              res.writeHead(400)
              res.end('Invalid state')
              return
            }
            if (!data.token || !data.prefix) {
              res.writeHead(400)
              res.end('Missing token or prefix')
              return
            }
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end('You can close this tab.')
            server.close()
            finish(() => resolve({ token: data.token!, prefix: data.prefix! }))
          } catch (err) {
            res.writeHead(400)
            res.end('Bad request')
          }
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    server.listen(port, '127.0.0.1', async () => {
      const url = `${getWebUrl()}/cli/authorize?state=${state}&port=${port}&host=${encodeURIComponent(hostname)}`
      console.log(`Opening browser to authenticate...`)
      console.log(`If the browser does not open, visit: ${url}`)

      try {
        openBrowser(url)
      } catch (err) {
        console.error(`(could not auto-open browser: ${err instanceof Error ? err.message : String(err)})`)
      }
    })

    server.on('error', (err) => {
      finish(() => reject(err))
    })

    // unref() ensures the timeout won't block process exit if cleared late
    timeoutHandle = setTimeout(() => {
      finish(() => {
        server.close()
        reject(new Error('Login timed out after 5 minutes.'))
      })
    }, 5 * 60 * 1000)
    timeoutHandle.unref()
  })
}

async function deviceLogin(): Promise<TokenFields> {
  const res = await apiCall<DeviceCodeResponse>('POST', '/auth/device/code')
  console.log(`Open ${res.verificationUrl} and enter code: ${res.userCode}`)

  const intervalMs = (res.interval ?? 5) * 1000
  const expiresAt = Date.now() + res.expiresIn * 1000

  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, intervalMs))
    try {
      const poll = await apiCall<PollResponse>('POST', '/auth/device/poll', {
        deviceCode: res.deviceCode,
      })
      if (poll.status === 'approved' && poll.token && poll.prefix) {
        return { token: poll.token, prefix: poll.prefix, name: poll.name }
      }
      // status === 'pending', keep looping
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        throw new Error('Device code expired. Please run `dibs login` again.')
      }
      throw err
    }
  }

  throw new Error('Device code expired. Please run `dibs login` again.')
}

export async function runLogin(opts: { device?: boolean }) {
  let creds: TokenFields

  if (opts.device) {
    creds = await deviceLogin()
  } else {
    try {
      creds = await browserLogin()
    } catch (err) {
      // Auto-fallback to device if browser failed to open or timed out
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('timed out') || msg.includes('browser')) {
        console.log('Browser login failed, falling back to device code...')
        creds = await deviceLogin()
      } else {
        throw err
      }
    }
  }

  writeCredentials({
    token: creds.token,
    prefix: creds.prefix,
    createdAt: new Date().toISOString(),
  })

  console.log('Logged in.')
}
