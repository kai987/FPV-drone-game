import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createBuildInfo } from './scripts/build-info.ts';

export default defineConfig(() => {
  const info = createBuildInfo(fileURLToPath(new URL('.', import.meta.url)));
  const version = JSON.stringify(info, null, 2) + '\n';
  return {
    plugins: [react(), {
      name: 'aeroflow-build-identity',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/version.json') return next();
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(version);
        });
      },
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: version }); },
    }],
    define: { __AEROFLOW_BUILD_INFO__: JSON.stringify(info) },
    base: './',
    build: { chunkSizeWarningLimit: 650, rollupOptions: { output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } } } },
  };
});
