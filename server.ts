/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Server Entry Point (Express + Vite middlewares)
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import apiRouter from './src/backend/routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static media directory
const mediaDir = path.resolve(process.cwd(), 'data', 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}
app.use('/media', express.static(mediaDir));

// API routes mounted at /api
app.use('/api', apiRouter);

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (isProduction && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Argus Anti-Piracy Platform server listening on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start Argus server:', err);
  process.exit(1);
});
