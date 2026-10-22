/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Server Entry Point (Express + Vite middlewares)
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import apiRouter from './src/backend/routes.js';
import { db } from './src/backend/db/database.js';
import { ensureMasterVideosExist, ensureTaylorSwiftPatientZeroRegistered, loadOptionalForensicTestSuite } from './src/backend/engine/sampleData.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 1. INCREASE EXPRESS PAYLOAD LIMITS BEFORE REGISTERING ROUTES (Support media files up to 500MB)
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

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
app.use('/data/thumbnails', express.static(thumbnailsDir));
app.use('/data/media', express.static(mediaDir));

// API routes mounted at /api
app.use('/api', apiRouter);

// Strict JSON 404 handler for any unhandled /api/* routes (NEVER return HTML for API calls)
app.all('/api/*', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(404).json({
    error: `API endpoint not found: ${_req.method} ${_req.originalUrl}`
  });
});

// 4. GUARANTEED JSON ERROR RESPONSES: Catch all exceptions and return res.status(500).json({ error: err.message })
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error('[Server Error]', err);
  res.setHeader('Content-Type', 'application/json');
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    error: err.message || 'Internal server error'
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

  try {
    ensureMasterVideosExist();
    const existingRefs = db.getReferences();
    const existingCands = db.getCandidates();
    const streamCandFps = db.getCandidateFingerprints('cand_ts_streamtape');
    const hasPersistedRefJpegs = existingRefs.length > 0 && existingRefs.every(r => {
      if (!r.thumbnail_url || !r.thumbnail_url.startsWith('/thumbnails/')) return false;
      const diskPath = path.join(thumbnailsDir, path.basename(r.thumbnail_url));
      return fs.existsSync(diskPath);
    });
    if (existingRefs.length === 0 || existingCands.length < 12 || streamCandFps.length === 0 || !hasPersistedRefJpegs) {
      console.log('[Server Startup] Initializing authentic forensic dataset with real extracted keyframes across all content types...');
      loadOptionalForensicTestSuite();
    } else {
      ensureTaylorSwiftPatientZeroRegistered();
    }
  } catch (initErr: any) {
    console.warn('[Server Startup] Initialization notice:', initErr.message);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Argus Anti-Piracy Platform server listening on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start Argus server:', err);
  process.exit(1);
});
