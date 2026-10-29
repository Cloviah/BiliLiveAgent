import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  // 渲染层最终通过自定义协议 app:// 加载，使用相对基址保证资源路径可解析
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
