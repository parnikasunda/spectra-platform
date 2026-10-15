/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Server Entry Point (Express + Vite middlewares)
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import apiRouter from './src/backend/routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 1. INCREASE BODY & MULTIPART PAYLOAD LIMITS (Support media files up to 500MB)
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Ensure required upload and media directories exist
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const mediaDir = path.resolve(process.cwd(), 'data', 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

const thumbnailsDir = path.resolve(process.cwd(), 'data', 'thumbnails');
if (!fs.existsSync(thumbnailsDir)) {
  fs.mkdirSync(thumbnailsDir, { recursive: true });
}

// Static directories
app.use('/uploads', express.static(uploadsDir));
app.use('/media', express.static(mediaDir));
app.use('/thumbnails', express.static(thumbnailsDir));

// API routes mounted at /api
app.use('/api', apiRouter);

// Strict JSON 404 handler for any unhandled /api/* routes (NEVER return HTML for API calls)
app.all('/api/*', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(404).json({
    success: false,
    error: `API endpoint not found: ${_req.method} ${_req.originalUrl}`
  });
});

// Strict JSON global error handler for any uncaught errors in API routing (e.g. 413 Payload Too Large)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error('[Server Error]', err);
  res.setHeader('Content-Type', 'application/json');
  const status = err.status || err.statusCode || (err.type === 'entity.too.large' ? 413 : 500);
  const errorMsg = err.type === 'entity.too.large'
    ? 'Payload too large: media file exceeds maximum allowable limit of 500MB'
    : (err.message || 'Internal server error');

  return res.status(status).json({
    success: false,
    error: errorMsg,
    code: err.code || (err.type === 'entity.too.large' ? 'LIMIT_FILE_SIZE' : 'SERVER_ERROR')
  });
});

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
