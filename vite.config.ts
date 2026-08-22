import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /db/* routes through the studio-server caching tier (7881), which proxies to
// Oxigraph (7880) with read-cache + write invalidation. /api/* is the sidecar.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/db': {
        target: 'http://localhost:7881',
      },
      '/api': {
        target: 'http://localhost:7881',
      },
    },
  },
})
