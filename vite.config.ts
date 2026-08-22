import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /db/* proxies to the local studio Oxigraph (port 7880) to avoid CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/db': {
        target: 'http://localhost:7880',
        rewrite: (path) => path.replace(/^\/db/, ''),
      },
    },
  },
})
