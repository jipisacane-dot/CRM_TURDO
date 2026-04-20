import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/tokko-api': {
        target: 'https://www.tokkobroker.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tokko-api/, '/api/v1'),
        secure: false,
      },
    },
  },
})
