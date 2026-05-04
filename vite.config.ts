import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      external: [],
      output: {
        manualChunks: {
          'react-vendor':    ['react', 'react-dom', 'react-router-dom'],
          'recharts-vendor': ['recharts', 'react-is'],
          'supabase-vendor': ['@supabase/supabase-js'],
          'date-vendor':     ['date-fns', 'date-fns/locale'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react-is'],
  },
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
