import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Stable chunk names so CloudFront cache invalidation is predictable
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    port: 3000,
    // Proxy API calls to local FastAPI during development
    proxy: {
      '/v1': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
