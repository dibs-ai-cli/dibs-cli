export function getApiUrl(): string {
  return process.env.DIBS_API_URL ?? 'https://api.dibsai.dev'
}

export function getWebUrl(): string {
  return process.env.DIBS_WEB_URL ?? 'https://app.dibsai.dev'
}
