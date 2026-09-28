import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3400',
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
      '/health': {
        target: 'http://localhost:3400',
        changeOrigin: true,
      },
      '/downloads': {
        target: 'http://localhost:3400',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
