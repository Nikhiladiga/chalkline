import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { 'process.env': '{}' },
  test: { include: ['src/**/*.test.ts'], passWithNoTests: true },
});
