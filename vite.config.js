import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), svgr()],
  
  // ✅ 解决 Firebase Functions 构建错误
  build: {
    rollupOptions: {
      // 不要将这些模块标记为外部依赖
      external: [],
      output: {
        // 分割大型第三方套件到獨立 chunk 以減少主要 bundle 體積
        manualChunks(id) {
          if (!id) return;
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) return 'vendor-firebase';
            if (id.includes('react')) return 'vendor-react';
            if (id.includes('chart.js') || id.includes('chartjs')) return 'vendor-charts';
            // 其餘第三方依賴
            return 'vendor';
          }
        }
      }
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