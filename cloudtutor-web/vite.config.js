import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // amazon-cognito-identity-js requires 'global' which is not defined in Vite browser runtime
    global: 'globalThis',
  },
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': {
        target: 'https://k2ur8947qi.execute-api.ap-southeast-1.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  }
});
