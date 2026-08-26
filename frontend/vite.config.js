import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API is served on 8016; in production the same process also serves this
// build, so the app runs on a single origin.
const API_TARGET = process.env.VITE_API_TARGET || 'http://127.0.0.1:8016'

// Hosts the dev server will answer for. Vite rejects unknown Host headers, so
// the published domain has to be listed to develop behind it.
const ALLOWED_HOSTS = ['localhost', '127.0.0.1', 'hospkpi.ambujaneotia.com']

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ALLOWED_HOSTS,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    port: 8016,
    allowedHosts: ALLOWED_HOSTS,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
