import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: resolve('electron/main.ts') },
    },
  },
  renderer: {
    root: '.',
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve('index.html') },
    },
    server: { host: '127.0.0.1' },
  },
})
