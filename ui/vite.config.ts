import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) },
  },
  server: {
    port: 3040,
    host: true,
    // The SPA calls a RELATIVE /api base; Vite forwards it to the API process.
    // No CORS in dev, and a phone on the LAN only needs the Vite port.
    proxy: { '/api': { target: 'http://127.0.0.1:8900', changeOrigin: true } },
  },
  build: { outDir: '../dist/web', emptyOutDir: true },
})
