import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 代理 Cloud Functions 請求以避免 CORS 問題
      '/__/': {
        target: 'https://us-central1-mybazaar-c4881.cloudfunctions.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__\//, '/')
      }
    }
  }
})
