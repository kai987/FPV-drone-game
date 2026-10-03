import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './', build: { chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } } } } });
