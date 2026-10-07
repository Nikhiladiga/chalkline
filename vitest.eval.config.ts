import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { 'process.env': 'process.env' },
  test: { include: ['eval/**/*.eval.ts'], testTimeout: 1_800_000, hookTimeout: 60_000 },
});
