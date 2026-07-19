// Must match the version in package.json — enforced by src/__tests__/version.test.ts.
export const CLI_VERSION = '0.0.9'

export function isOlderThan(a: string, b: string): boolean {
  const parse = (v: string): [number, number, number] => {
    const [ma = 0, mi = 0, pa = 0] = v.split('.').map(Number)
    return [ma, mi, pa]
  }
  const [ma, mia, pa] = parse(a)
  const [mb, mib, pb] = parse(b)
  if (ma !== mb) return ma < mb
  if (mia !== mib) return mia < mib
  return pa < pb
}
