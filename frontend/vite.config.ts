import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { createMockMiddleware } from './mock/index.cjs'

function mockApiPlugin(): Plugin {
  const mw = createMockMiddleware()
  return {
    name: 'transflow-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => {
        mw(req as any, res, next)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // =========================================================================
    // [CHẾ ĐỘ 1: DÙNG MOCK API NỘI BỘ]
    // Mặc định Vite dev server chặn request /api và trả về dữ liệu mẫu (mock).
    // KHI CHUYỂN SANG DÙNG BACKEND THẬT: Hãy COMMENT dòng `mockApiPlugin()` dưới đây.
    // =========================================================================
    // mockApiPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // =========================================================================
    // [CHẾ ĐỘ 2: DÙNG BACKEND API THẬT QUA VITE PROXY]
    // =========================================================================
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    testTimeout: 15000,
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
