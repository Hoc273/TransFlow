import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Frontend always proxies /api to the real Spring Boot backend
const backendUrl = process.env.VITE_BACKEND_URL || 'http://localhost:8080'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    // React.act only exists in the non-production React build. Vitest does not
    // force NODE_ENV, so a shell-level NODE_ENV=production would load the
    // production build and break @testing-library/react (its react-dom/test-utils
    // fallback calls React.act). Keep the test runtime non-production.
    env: { NODE_ENV: 'test' },
    setupFiles: ['./vitest.setup.ts'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/recharts')) {
            return 'charts'
          }
        },
      },
    },
  },
})
