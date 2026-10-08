import { defineConfig } from 'vitest/config'

// Only tests/unit is Vitest's. The tests/*.test.mjs files use node:test and run
// through the second half of `npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
  },
})
