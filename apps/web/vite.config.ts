import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://localhost:3040';
const USE_API_PROXY = process.env.VITE_USE_API_PROXY !== 'false';
const envDir = path.resolve(__dirname, '..');

export default defineConfig({
  envDir,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'discover-root-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/') {
            res.statusCode = 302;
            res.setHeader('Location', '/api/discover');
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: Number(process.env.FRONTEND_PORT ?? 3041),
    host: true,
    proxy: USE_API_PROXY
      ? {
          '/api': {
            target: API_BASE_URL,
            changeOrigin: true,
            withCredentials: true,
          },
        }
      : undefined,
  },
  build: {
    outDir: 'dist',
  },
});
