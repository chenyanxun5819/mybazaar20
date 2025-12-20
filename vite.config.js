import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // ✅ 解决 Firebase Functions 构建错误
  build: {
    rollupOptions: {
      // 不要将这些模块标记为外部依赖
      external: [],
    },
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true
    }
  },
  
  // ✅ 预构建优化 - 包含所有 Firebase 模块
  optimizeDeps: {
    include: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/functions',
      'firebase/storage'
    ],
    // 强制预构建这些依赖
    force: true
  },
  
  // 开发服务器配置
  server: {
    port: 5173,
    open: true
  }
});