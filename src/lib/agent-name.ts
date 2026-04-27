import os from 'os'

export function resolveAgentName(): string {
  if (process.env.DIBS_AGENT_NAME) return process.env.DIBS_AGENT_NAME
  const user = process.env.USER ?? process.env.USERNAME ?? 'agent'
  return `${user}@${os.hostname()}`
}
