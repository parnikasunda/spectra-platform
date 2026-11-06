import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Guard plugin ensuring Vite's SPA HTML fallback never intercepts unhandled /api/* requests
 * and returns <!doctype html> with HTTP 200.
 */
function apiJsonFallbackGuard(): Plugin {
  const guardMiddleware = (req: any, res: any, next: any) => {
    const url = req.url || '';
    if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: `API endpoint not found: ${req.method || 'GET'} ${url}`
        })
      );
      return;
    }
    next();
  };

  return {
    name: 'spectra-api-json-fallback-guard',
    configureServer(server) {
      server.middlewares.use(guardMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(guardMiddleware);
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [apiJsonFallbackGuard(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

