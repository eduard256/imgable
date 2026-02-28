import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:9812',
      '/photos': 'http://localhost:9812',
      '/s/': {
        target: 'http://localhost:9812',
        // Bypass proxy for browser navigation (HTML requests) so Vite serves the SPA.
        // Proxy all other requests (fetch/XHR for JSON data, image/video files) to the API.
        bypass(req) {
          const accept = req.headers.accept || ''
          if (accept.includes('text/html')) {
            return '/index.html'
          }
        },
      },
      '/k/': {
        target: 'http://localhost:9812',
        // Kiosk mode: same bypass logic as /s/ — serve SPA for HTML, proxy data/images.
        bypass(req) {
          const accept = req.headers.accept || ''
          if (accept.includes('text/html')) {
            return '/index.html'
          }
        },
      },
    },
  },
})
