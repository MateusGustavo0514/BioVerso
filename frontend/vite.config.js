import { defineConfig } from 'vite';

export default defineConfig({
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    // Redireciona /api para o backend durante o desenvolvimento
    proxy: { '/api': 'http://localhost:3333' },
  },
});
