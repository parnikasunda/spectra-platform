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
import { SearchCoverageEngine } from './src/backend/engine/searchCoverage.js';

const app = express();
const PORT =
  process.env.APP_PORT ||
  (process.env.PORT && process.env.PORT !== '8080' ? process.env.PORT : 3000);

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

// Resilient fallback for /thumbnails/:filename — restores from SQLite thumbnail_data or source video if disk file is missing, and never falls through to SPA HTML
app.get(['/thumbnails/:filename', '/data/thumbnails/:filename'], (req: Request, res: Response) => {
  try {
    const restored = db.getThumbnailByFilenameOrRestore(req.params.filename);
    if (restored) {
      res.setHeader('Content-Type', restored.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(restored.buffer);
    }
    return res.status(404).json({ error: `Thumbnail image unavailable: ${req.params.filename}` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to resolve thumbnail image' });
  }
});

// API routes mounted at /api (also normalize accidental /api/api/* prefix if a caller includes /api twice)
app.use('/api/api', apiRouter);
app.use('/api', apiRouter);

// Strict JSON 404 handler for any unhandled /api or /api/* routes (NEVER return HTML for API calls)
app.all(['/api', '/api/*'], (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(404).json({
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// 4. GUARANTEED JSON ERROR RESPONSES: Catch all exceptions and return structured JSON
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error(`[Server Error] ${req.method} ${req.originalUrl}:`, err);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    error: err.message || 'Internal server error',
    endpoint: `${req.method} ${req.originalUrl}`
  });
});

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (isProduction && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(404).json({
          error: `API endpoint not found: ${req.method} ${req.originalUrl}`
        });
      }
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(404).json({
          error: `API endpoint not found: ${req.method} ${req.originalUrl}`
        });
      }
      return vite.middlewares(req, res, next);
    });
  }

  try {
    ensureMasterVideosExist();
    const frameAudits = db.auditAndRepairReferenceFrameImages();
    for (const audit of frameAudits) {
      console.log(
        `[Frame Integrity Audit] "${audit.title}" (${audit.reference_id}): ${audit.retrievable_frame_image_count}/${audit.indexed_frame_count} retrievable images (${audit.image_availability_status}) | repaired(b64=${audit.repaired_from_base64_count}, sibling=${audit.repaired_from_sibling_batch_count}, regen=${audit.regenerated_from_source_video_count}, backfilled_b64=${audit.backfilled_base64_count})`
      );
    }
    if (process.env.SPECTRA_LOAD_DEMO_FIXTURES === 'true') {
      console.log('[Server Startup] SPECTRA_LOAD_DEMO_FIXTURES=true — loading optional forensic demo fixtures...');
      loadOptionalForensicTestSuite();
    } else {
      const existingRefs = db.getReferences();
      console.log(
        `[Server Startup] Loaded ${existingRefs.length} persisted user reference record(s) from ${db.getDbFilePath()} (demo fixture auto-seeding disabled)`
      );
      for (const ref of existingRefs) {
        const snaps = db.getCoverageSnapshots({ referenceId: ref.id, limit: 1 });
        if (snaps.length === 0) {
          const jobsForRef = db.getDiscoveryJobs().filter(j => j.target_reference_id === ref.id);
          SearchCoverageEngine.recordCoverageSnapshot({
            referenceId: ref.id,
            jobId: jobsForRef[0]?.id
          });
        }
      }
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
