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
    port: 3000,
    open: false
  }
});
