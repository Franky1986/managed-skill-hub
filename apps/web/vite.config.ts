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
      name: 'discover-root-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== '/') {
            next();
            return;
          }
          // Serve /api/discover inline at root so agents can bootstrap with
          // a single request to the frontend dev port, saving one redirect hop.
          const target = USE_API_PROXY
            ? '/api/discover'
            : `${API_BASE_URL}/discover`;
          try {
            const url = new URL(target, `http://${req.headers.host ?? 'localhost'}`);
            const response = await fetch(url.toString());
            const body = await response.text();
            res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              if (key.toLowerCase() !== 'content-encoding') {
                res.setHeader(key, value);
              }
            });
            res.end(body);
          } catch (error) {
            server.config.logger.error(`Failed to proxy root to discovery: ${error}`);
            res.statusCode = 502;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'Discovery proxy failed', message: String(error) }));
          }
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
