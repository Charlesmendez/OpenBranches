import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['team-service/tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
