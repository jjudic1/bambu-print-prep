import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 5173 is claimed by the Troubleshooting guide app, so this takes 5174 -- see
// the ports table in the shared CLAUDE.md.
//
// The /api proxy is kept although the app no longer calls anything: the hosted
// front end in src/App.jsx is retired rather than deleted, and bringing it back
// means running uvicorn on 8141 and pointing an entry at src/main.jsx again.
// Nothing in the shipped page reaches it.
export default defineConfig({
  plugins: [react()],
  // Two entry points, and there used to be a third. index.html is the product:
  // the on-device page, which does the whole job in the browser. It was
  // /local.html until the hosted app came down -- one page now, served at both
  // addresses by a rewrite rather than built twice.
  //
  // dashboard.html is not part of the product at all: it is the usage numbers,
  // for one person, behind a key. Its own entry so that none of it -- and none
  // of three.js -- lands in the app.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
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
