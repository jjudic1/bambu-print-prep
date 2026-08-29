import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 5173 is claimed by the Troubleshooting guide app, so this takes 5174 and the
// API takes 8141 -- see the ports table in the shared CLAUDE.md. The proxy means
// the app calls /api/... in both dev and production, with no base-URL switch.
export default defineConfig({
  plugins: [react()],
  // Three entry points. /local.html is the no-server build -- it shares the
  // viewer and the writer but talks to no API at all, so it can be reasoned
  // about (and broken) independently of the hosted app. /dashboard.html is not
  // part of the product at all: it is the usage numbers, for one person, behind
  // a key, and it ships as its own bundle so none of it lands in either app.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        local: resolve(__dirname, 'local.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8141', changeOrigin: true } },
  },
})
