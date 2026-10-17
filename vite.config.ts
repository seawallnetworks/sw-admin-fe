import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // echarts lives in the lazily loaded Dashboard chunk (~540 kB, already tree-shaken)
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
})
