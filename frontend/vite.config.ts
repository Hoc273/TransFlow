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
  envDir: path.resolve(import.meta.dirname, '..'),
  plugins: [
    react(),
    tailwindcss(),
    // =========================================================================
    // [CHẾ ĐỘ 1: DÙNG MOCK API NỘI BỘ]
    // Mặc định Vite dev server chặn request /api và trả về dữ liệu mẫu (mock).
    // KHI CHUYỂN SANG DÙNG BACKEND THẬT: Hãy COMMENT dòng `mockApiPlugin()` dưới đây.
    // =========================================================================
    mockApiPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
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
