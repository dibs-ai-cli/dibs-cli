import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    // The default `threads` pool throws at collection on Node 26
    // ("Cannot read properties of undefined (reading 'config')").
    // `forks` is unaffected — use it so `npm test` works out of the box.
    pool: 'forks',
  },
})
