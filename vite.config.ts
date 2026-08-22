import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    allowedHosts: ['.onamp.dev'],
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
