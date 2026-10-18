import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  // the device (or VM) whose API the dev server proxies to: SW_DEVICE=https://<host>:8443 npm run dev
  const device = loadEnv(mode, '.', '').SW_DEVICE || 'https://192.0.2.10:8443'

  return {
    plugins: [vue()],
    // echarts lives in the lazily loaded Dashboard chunk (~540 kB, already tree-shaken)
    // assetsInlineLimit 0: no data: URIs, which the device's CSP refuses
    build: { target: 'es2022', chunkSizeWarningLimit: 700, assetsInlineLimit: 0 },
    server: {
      proxy: {
        // secure: false for the device's self-signed certificate
        '/api': { target: device, changeOrigin: true, secure: false },
      },
    },
  }
})
