import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: { build: { externalizeDeps: true, rollupOptions: { external: ['electron'] } } },
  preload: {
    build: { externalizeDeps: true, rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@fonts': resolve('node_modules/@eraserlabs/diagrams/fonts') } },
    // The layout router reads process.env unguarded (upstream playground does the same).
    define: { 'process.env': '{}' },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
});
