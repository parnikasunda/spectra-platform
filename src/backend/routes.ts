/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Express API Router with Scalable Large-Video Chunked Upload Architecture
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db } from './db/database.js';
import { FingerprintEngine } from './engine/fingerprint.js';
import { DiscoveryEngine } from './engine/discovery.js';
import { SearchCoverageEngine } from './engine/searchCoverage.js';
import { VerifierEngine } from './engine/verifier.js';
import { SuspectedPiracyAdapter } from './engine/adapters/index.js';
import { loadOptionalForensicTestSuite } from './engine/sampleData.js';
import { ReferenceItem, FrameFingerprint, CandidateItem, DiscoveryPresetMode } from './types.js';

const router = Router();

// Ensure upload and staging directories exist
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const chunksStagingDir = path.resolve(uploadsDir, 'chunks_staging');
if (!fs.existsSync(chunksStagingDir)) {
  fs.mkdirSync(chunksStagingDir, { recursive: true });
}

// Configurable upload limits (from environment variables or standard defaults)
const getMaxUploadSizeMB = () => process.env.MAX_UPLOAD_SIZE_MB ? parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) : 500;
const getChunkSizeMB = () => process.env.UPLOAD_CHUNK_SIZE_MB ? parseInt(process.env.UPLOAD_CHUNK_SIZE_MB, 10) : 5;

// Standard Multer diskStorage for direct /api/references file uploads (fallback)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${cleanName}`);
  }
});

const upload = multer({ 
  storage, 
  limits: { fileSize: getMaxUploadSizeMB() * 1024 * 1024 } 
});

// Multer for chunk uploads (each chunk is ~5MB, limit set to 20MB)
const chunkStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, chunksStagingDir);
  },
  filename: (_req, _file, cb) => {
    cb(null, `chunk_${Date.now()}_${Math.random().toString(36).substring(7)}`);
  }
});

const chunkUpload = multer({
  storage: chunkStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Middleware to safely handle multipart upload using upload.single('file') or pass through JSON
const handleUpload = (req: Request, res: Response, next: NextFunction) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  upload.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      console.warn('[Multer Notice]', err.message);
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    if (!req.file) {
      upload.any()(req as any, res as any, (err2: any) => {
        if (err2) {
          res.setHeader('Content-Type', 'application/json');
          return res.status(500).json({ error: err2.message || 'File upload failed' });
        }
        if (!req.file && Array.isArray(req.files) && req.files.length > 0) {
          req.file = req.files[0];
        }
        next();
      });
      return;
    }
    next();
  });
};

// -------------------------------------------------------------
// Large-File Resumable Chunked Upload In-Memory State
// -------------------------------------------------------------
interface UploadSession {
  uploadId: string;
  allocatedRefId?: string;
  replaceReferenceId?: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  title: string;
  rightsHolder: string;
  assetType: string;
  platform?: string;
  seasonEpisodeInfo?: string;
  sourceUrl?: string;
  sampleInterval: number;
  auditNotes?: string;
  tempDir: string;
  receivedChunks: Set<number>;
  createdAt: number;
}

const activeUploadSessions = new Map<string, UploadSession>();
const uploadSessionsRegistryPath = path.resolve(uploadsDir, 'upload_sessions_registry.json');

function persistUploadSessionsRegistry(): void {
  try {
    const serialized = Array.from(activeUploadSessions.values()).map(s => ({
      ...s,
      receivedChunks: Array.from(s.receivedChunks)
    }));
    const tmpPath = `${uploadSessionsRegistryPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ updatedAt: new Date().toISOString(), sessions: serialized }, null, 2), 'utf8');
    fs.renameSync(tmpPath, uploadSessionsRegistryPath);
  } catch (err: any) {
    console.warn('[Upload Session Registry Persist Notice]', err?.message || err);
  }
}

function loadUploadSessionsRegistry(): void {
  try {
    if (!fs.existsSync(uploadSessionsRegistryPath)) return;
    const raw = JSON.parse(fs.readFileSync(uploadSessionsRegistryPath, 'utf8'));
    const sessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
    const now = Date.now();
    for (const item of sessions) {
      if (!item?.uploadId) continue;
      if (now - (Number(item.createdAt) || 0) > 6 * 60 * 60 * 1000) continue;
      activeUploadSessions.set(String(item.uploadId), {
        ...item,
        receivedChunks: new Set<number>(Array.isArray(item.receivedChunks) ? item.receivedChunks : [])
      });
    }
  } catch (err: any) {
    console.warn('[Upload Session Registry Load Notice]', err?.message || err);
  }
}

loadUploadSessionsRegistry();

// Periodic session cleanup (sessions older than 6 hours)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [uploadId, session] of activeUploadSessions.entries()) {
    if (now - session.createdAt > 6 * 60 * 60 * 1000) {
      try {
        if (fs.existsSync(session.tempDir)) {
          fs.rmSync(session.tempDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.warn(`Failed to clean up stale upload session ${uploadId}:`, e);
      }
      activeUploadSessions.delete(uploadId);
      changed = true;
    }
  }
  if (changed) {
    persistUploadSessionsRegistry();
  }
}, 30 * 60 * 1000).unref();

// -------------------------------------------------------------
// Upload & Provider Integration Configuration Endpoints
// -------------------------------------------------------------
router.get('/config/upload', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  const maxMb = getMaxUploadSizeMB();
  const chunkMb = getChunkSizeMB();
  return res.json({
    success: true,
    data: {
      maxUploadSizeMB: maxMb,
      maxUploadSizeBytes: maxMb * 1024 * 1024,
      uploadChunkSizeMB: chunkMb,
      chunkSizeBytes: chunkMb * 1024 * 1024,
      allowedExtensions: ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.ts', '.m4v'],
      mode: 'chunked'
    }
  });
});

router.get('/config/providers', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  const providers = [
    {
      id: 'DIRECT_MASTER_UPLOAD',
      name: 'Authorized Reference Master File Upload (.mp4 / .mkv / .mov)',
      platform: 'All Platforms (Local / Broadcast Master)',
      status: 'IMPLEMENTED_ACTIVE',
      requiresCredentials: false,
      credentialsConfigured: true,
      description: 'Chunked resumable upload (up to 500MB) for authorized reference master files. Decodes real video keyframes via FFmpeg and computes 64-bit dHash fingerprints.'
    },
    {
      id: 'AUTHORIZED_MEZZANINE_URL',
      name: 'Approved Mezzanine / Clean-Feed Stream URL (.mp4 / .m3u8)',
      platform: 'S3 / GCS Pre-Signed URL / Unencrypted Broadcast HLS',
      status: 'IMPLEMENTED_ACTIVE',
      requiresCredentials: false,
      credentialsConfigured: true,
      description: 'Direct ingestion of authorized unencrypted mezzanine files or HLS (.m3u8) transport streams supplied by the rights holder.'
    },
    {
      id: 'PUBLIC_YOUTUBE_DAILYMOTION_ARCHIVE',
      name: 'Public Video Reference Extraction (YouTube / Dailymotion / Archive.org)',
      platform: 'YouTube, Dailymotion, Internet Archive',
      status: 'IMPLEMENTED_ACTIVE',
      requiresCredentials: false,
      credentialsConfigured: true,
      description: 'Extracts published reference keyframes or direct unencrypted MP4 masters from public rights-holder channels.'
    },
    {
      id: 'SONYLIV_PARTNER_SYNDICATION',
      name: 'SonyLIV Partner Mezzanine Syndication Feed',
      platform: 'SonyLIV',
      status: process.env.SONYLIV_PARTNER_API_KEY ? 'IMPLEMENTED_ACTIVE' : 'AWAITING_CREDENTIALS_OR_MASTER',
      requiresCredentials: true,
      envVar: 'SONYLIV_PARTNER_API_KEY',
      credentialsConfigured: Boolean(process.env.SONYLIV_PARTNER_API_KEY),
      description: 'Accepts SonyLIV watch URLs for metadata registration and discovery; requires SONYLIV_PARTNER_API_KEY or manual attachment of an authorized reference master file for frame fingerprinting.'
    },
    {
      id: 'HOTSTAR_NOVI_SYNDICATION',
      name: 'Disney+ Hotstar / JioStar Partner Mezzanine API',
      platform: 'Disney+ Hotstar',
      status: process.env.HOTSTAR_SYNDICATION_TOKEN ? 'IMPLEMENTED_ACTIVE' : 'AWAITING_CREDENTIALS_OR_MASTER',
      requiresCredentials: true,
      envVar: 'HOTSTAR_SYNDICATION_TOKEN',
      credentialsConfigured: Boolean(process.env.HOTSTAR_SYNDICATION_TOKEN),
      description: 'Accepts Hotstar watch URLs for metadata registration and discovery; requires HOTSTAR_SYNDICATION_TOKEN or manual attachment of an authorized reference master file for frame fingerprinting.'
    },
    {
      id: 'NETFLIX_BACKLOT_DELIVERY',
      name: 'Netflix Backlot Partner Reference Feed',
      platform: 'Netflix',
      status: process.env.NETFLIX_BACKLOT_API_KEY ? 'IMPLEMENTED_ACTIVE' : 'AWAITING_CREDENTIALS_OR_MASTER',
      requiresCredentials: true,
      envVar: 'NETFLIX_BACKLOT_API_KEY',
      credentialsConfigured: Boolean(process.env.NETFLIX_BACKLOT_API_KEY),
      description: 'Accepts Netflix title URLs for metadata registration and discovery; requires NETFLIX_BACKLOT_API_KEY or manual attachment of an authorized reference master file for frame fingerprinting.'
    },
    {
      id: 'JIOCINEMA_VIACOM18_FEED',
      name: 'JioCinema / Viacom18 Broadcast Clean-Feed API',
      platform: 'JioCinema',
      status: process.env.JIOCINEMA_PARTNER_TOKEN ? 'IMPLEMENTED_ACTIVE' : 'AWAITING_CREDENTIALS_OR_MASTER',
      requiresCredentials: true,
      envVar: 'JIOCINEMA_PARTNER_TOKEN',
      credentialsConfigured: Boolean(process.env.JIOCINEMA_PARTNER_TOKEN),
      description: 'Accepts JioCinema watch URLs for metadata registration and discovery; requires JIOCINEMA_PARTNER_TOKEN or manual attachment of an authorized reference master file for frame fingerprinting.'
    },
    {
      id: 'PRIME_VIDEO_DIRECT_FEED',
      name: 'Amazon Prime Video Direct Partner Ingest',
      platform: 'Amazon Prime Video',
      status: process.env.PRIME_VIDEO_DIRECT_KEY ? 'IMPLEMENTED_ACTIVE' : 'AWAITING_CREDENTIALS_OR_MASTER',
      requiresCredentials: true,
      envVar: 'PRIME_VIDEO_DIRECT_KEY',
      credentialsConfigured: Boolean(process.env.PRIME_VIDEO_DIRECT_KEY),
      description: 'Accepts Prime Video URLs for metadata registration and discovery; requires PRIME_VIDEO_DIRECT_KEY or manual attachment of an authorized reference master file for frame fingerprinting.'
    }
  ];

  return res.json({
    success: true,
    data: providers
  });
});

router.get(['/source-adapters', '/config/source-adapters'], (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  return res.json({
    success: true,
    data: FingerprintEngine.getSourceAdapters()
  });
});

router.patch(['/source-adapters/:id', '/config/source-adapters/:id'], (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  const updated = FingerprintEngine.updateSourceAdapterConfig(req.params.id, {
    enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
    supportsResumableDownload:
      typeof req.body?.supportsResumableDownload === 'boolean' ? req.body.supportsResumableDownload : undefined
  });
  if (!updated) {
    return res.status(404).json({ error: `Source adapter "${req.params.id}" not found` });
  }
  return res.json({
    success: true,
    data: updated
  });
});

// -------------------------------------------------------------
// Chunked Upload Endpoints (Bypasses 32MB Serverless/Proxy Limits)
// -------------------------------------------------------------

/**
 * 1. Initialize Large Video Upload
 */
router.post('/uploads/init', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { 
      fileName, 
      fileSize, 
      title, 
      rightsHolder, 
      assetType,
      platform,
      seasonEpisodeInfo,
      sourceUrl,
      sampleInterval, 
      auditNotes,
      replaceReferenceId
    } = req.body || {};

    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ error: 'Valid fileName is required' });
    }
    if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
      return res.status(400).json({ error: 'Valid positive fileSize in bytes is required' });
    }
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Title is required for reference registration' });
    }
    if (!rightsHolder || !String(rightsHolder).trim()) {
      return res.status(400).json({ error: 'Rights holder is required for legal chain of custody' });
    }

    const maxSizeBytes = getMaxUploadSizeMB() * 1024 * 1024;
    if (fileSize > maxSizeBytes) {
      return res.status(400).json({
        error: `File size (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${getMaxUploadSizeMB()} MB`
      });
    }

    const chunkSize = getChunkSizeMB() * 1024 * 1024;
    const totalChunks = Math.ceil(fileSize / chunkSize);
    const uploadId = `upl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const tempDir = path.resolve(chunksStagingDir, uploadId);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const allocatedRefId = replaceReferenceId
      ? String(replaceReferenceId).trim()
      : `ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const session: UploadSession = {
      uploadId,
      allocatedRefId,
      replaceReferenceId: replaceReferenceId ? String(replaceReferenceId).trim() : undefined,
      fileName,
      fileSize,
      totalChunks,
      chunkSize,
      title: String(title).trim(),
      rightsHolder: String(rightsHolder).trim(),
      assetType: assetType || 'VOD_FEATURE',
      platform: platform ? String(platform).trim() : undefined,
      seasonEpisodeInfo: seasonEpisodeInfo ? String(seasonEpisodeInfo).trim() : undefined,
      sourceUrl: sourceUrl ? String(sourceUrl).trim() : undefined,
      sampleInterval: parseFloat(sampleInterval) || 2.0,
      auditNotes: auditNotes ? String(auditNotes) : undefined,
      tempDir,
      receivedChunks: new Set<number>(),
      createdAt: Date.now()
    };

    activeUploadSessions.set(uploadId, session);
    persistUploadSessionsRegistry();

    return res.json({
      success: true,
      uploadId,
      chunkSize,
      totalChunks,
      maxUploadSizeBytes: maxSizeBytes,
      data: {
        uploadId,
        chunkSize,
        totalChunks,
        maxUploadSizeBytes: maxSizeBytes
      }
    });
  } catch (err: any) {
    console.warn('[Upload Init Notice]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to initialize upload session' });
  }
});

/**
 * 2. Upload Single Chunk (~5MB, safe for Cloud Run & all proxies)
 */
router.post('/uploads/chunk', chunkUpload.single('chunk') as any, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const uploadId = req.body?.uploadId;
    const chunkIndexStr = req.body?.chunkIndex;

    if (!uploadId || !activeUploadSessions.has(uploadId)) {
      return res.status(404).json({ error: 'Upload session not found or expired. Please re-initiate.' });
    }

    const session = activeUploadSessions.get(uploadId)!;
    const chunkIndex = parseInt(chunkIndexStr, 10);

    if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      return res.status(400).json({ error: `Invalid chunk index: ${chunkIndexStr}` });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Missing chunk binary payload' });
    }

    // Move uploaded chunk from staging to session directory
    const targetChunkPath = path.resolve(session.tempDir, `chunk_${chunkIndex}`);
    fs.renameSync(req.file.path, targetChunkPath);

    session.receivedChunks.add(chunkIndex);
    if (session.receivedChunks.size === session.totalChunks || session.receivedChunks.size % 10 === 0) {
      persistUploadSessionsRegistry();
    }

    return res.json({
      success: true,
      uploadId,
      chunkIndex,
      receivedChunks: session.receivedChunks.size,
      totalChunks: session.totalChunks
    });
  } catch (err: any) {
    console.warn('[Upload Chunk Notice]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to process chunk' });
  }
});

/**
 * 3. Complete Upload & Trigger Processing Pipeline
 */
router.post('/uploads/complete', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { uploadId } = req.body || {};
    if (!uploadId || !activeUploadSessions.has(uploadId)) {
      return res.status(404).json({ error: 'Upload session not found or expired' });
    }

    const session = activeUploadSessions.get(uploadId)!;

    // Verify all chunks are accounted for
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.resolve(session.tempDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        return res.status(400).json({ 
          error: `Missing chunk ${i} of ${session.totalChunks}. Please resume or retry upload.` 
        });
      }
    }

    // Assemble file into final location in ./uploads/
    const cleanFileName = session.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalFilePath = path.resolve(uploadsDir, `${session.uploadId}-${cleanFileName}`);
    const writeStream = fs.createWriteStream(finalFilePath);

    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.resolve(session.tempDir, `chunk_${i}`);
      const chunkBuffer = fs.readFileSync(chunkPath);
      writeStream.write(chunkBuffer);
    }
    writeStream.end();

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', (err) => reject(err));
    });

    // Verify assembled file size strictly against original file size (Never truncate!)
    const fileStats = fs.statSync(finalFilePath);
    if (fileStats.size !== session.fileSize) {
      try { fs.unlinkSync(finalFilePath); } catch {}
      return res.status(400).json({
        error: `Integrity check failed: expected ${session.fileSize} bytes, got ${fileStats.size} bytes.`
      });
    }

    // Clean up temporary chunk files
    try {
      fs.rmSync(session.tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to clean up chunk temp dir:', e);
    }

    // Probe media attributes FIRST before creating or updating any database record
    const probe = await FingerprintEngine.probeVideo(finalFilePath);
    if (!probe || !probe.duration_sec || probe.duration_sec <= 0 || probe.codec === 'unknown') {
      try { if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath); } catch {}
      activeUploadSessions.delete(uploadId);
      return res.status(422).json({
        success: false,
        error: 'Uploaded file is not a valid decodable video stream or container (0s duration). No reference record was created or modified.',
        acquisitionStatus: 'INVALID_MEDIA_CONTAINER',
        mediaAcquired: false
      });
    }

    // Compute cryptographic SHA-256 provenance hash using streaming
    const provenanceHash = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(finalFilePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });

    const existingTarget = findMatchingExistingReference({
      replaceReferenceId: session.replaceReferenceId,
      title: session.title,
      rightsHolder: session.rightsHolder,
      seasonEpisodeInfo: session.seasonEpisodeInfo,
      sourceUrl: session.sourceUrl,
      provenanceSha256: provenanceHash,
      isDirectFileUpload: true
    });
    const refId = existingTarget
      ? existingTarget.id
      : session.allocatedRefId || `ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    const intervalSec = session.sampleInterval && session.sampleInterval > 0 ? Number(session.sampleInterval) : 2.0;
    const samplingPlan = FingerprintEngine.calculateSamplingPlan(probe.duration_sec, intervalSec);

    const preservedSourceUrl = session.sourceUrl || existingTarget?.source_url;
    const preservedPlatform = session.platform || existingTarget?.platform;
    const preservedSeasonEpisode = session.seasonEpisodeInfo || existingTarget?.season_episode_info;

    const existingFpsBeforeUpload = existingTarget ? db.getReferenceFingerprints(existingTarget.id) : [];
    const intervalMatchesExisting =
      existingTarget && Math.abs((existingTarget.sample_interval_sec || 2) - intervalSec) < 0.01;

    const refItem: ReferenceItem = {
      id: refId,
      title: session.title || existingTarget?.title || 'Reference Master',
      rights_holder: session.rightsHolder || existingTarget?.rights_holder || 'Rights Holder',
      asset_type: (session.assetType as any) || existingTarget?.asset_type || 'VOD_FEATURE',
      duration_sec: probe.duration_sec,
      resolution: `${probe.width}x${probe.height}`,
      fps: probe.fps,
      codec: probe.codec,
      source_type: preservedSourceUrl ? 'OTT_PAGE' : 'UPLOAD',
      source_url: preservedSourceUrl,
      platform: preservedPlatform,
      season_episode_info: preservedSeasonEpisode,
      provider_integration_status: 'AUTHORIZED_MASTER_ATTACHED',
      acquisition_status: 'LOCAL_MASTER_UPLOADED',
      authorization_provenance: 'LOCAL_FILE_UPLOAD',
      last_acquisition_at: now,
      file_path: finalFilePath,
      created_at: existingTarget ? existingTarget.created_at : now,
      status: existingFpsBeforeUpload.length > 0 && existingTarget ? existingTarget.status : 'PROCESSING',
      provenance_sha256: provenanceHash,
      fingerprint_count: existingFpsBeforeUpload.length,
      sample_interval_sec: intervalSec,
      expected_frame_count: samplingPlan.expectedFrameCount,
      extracted_frame_count: existingFpsBeforeUpload.length,
      extraction_status: 'EXTRACTING',
      extraction_progress_pct: existingTarget?.extraction_progress_pct ?? 0,
      notes: session.auditNotes || existingTarget?.notes
    };

    // CRITICAL DURABILITY GUARANTEE:
    // Commit the reference record to SQLite IMMEDIATELY before starting FFmpeg keyframe extraction,
    // so even if a multi-hour video extraction takes 100+ seconds or the server restarts mid-extraction,
    // the reference record and its uploaded file path are already permanently persisted in SQLite!
    if (!(existingTarget && existingFpsBeforeUpload.length > 0)) {
      db.upsertReference(refItem);
    }

    const simulateInterruptAfterFrames =
      req.body?.simulateInterruptAfterFrames !== undefined
        ? Number(req.body.simulateInterruptAfterFrames)
        : undefined;

    try {
      // If re-uploading source video for an existing reference that already has indexed fingerprints at the same interval,
      // first repair all missing JPEGs in-place at their recorded timestamps without changing existing frame IDs, timestamps, or fingerprints!
      let reusableExistingFps: FrameFingerprint[] = [];
      if (existingTarget && existingFpsBeforeUpload.length > 0 && intervalMatchesExisting) {
        // Validate that the uploaded source is genuine video (not synthetic FFmpeg colour bars) before repairing in-place
        await FingerprintEngine.extractVideoFingerprints(finalFilePath, {
          referenceId: `${refId}_probe`,
          thumbnailsDir: db.getThumbnailsDir(),
          intervalSec: Math.max(intervalSec, Math.max(2, Math.floor(probe.duration_sec / 4))),
          maxFrames: 4,
          durationSec: probe.duration_sec,
          generateThumbnails: false,
          title: refItem.title,
          isCandidate: false
        });

        db.upsertReference({
          ...existingTarget,
          file_path: finalFilePath,
          provenance_sha256: provenanceHash
        });

        const repairAudit = db.auditAndRepairReferenceFrameImages(refId)[0];
        const repairedFps = db.getReferenceFingerprints(refId, true);
        if (
          repairAudit &&
          repairAudit.missing_frame_image_count === 0 &&
          repairedFps.length >= samplingPlan.expectedFrameCount
        ) {
          const syncedRef =
            db.syncReferenceExtractionCompleteness(refId, {
              sampleIntervalSec: intervalSec,
              durationSec: probe.duration_sec,
              extractionError: null
            }) || db.getReferenceById(refId)!;
          activeUploadSessions.delete(uploadId);
          persistUploadSessionsRegistry();
          return res.status(201).json({
            success: true,
            repairedInPlace: true,
            audit: repairAudit,
            data: { ...syncedRef, fingerprints: repairedFps },
            fingerprintsExtracted: repairedFps.length,
            expectedFrameCount: syncedRef.expected_frame_count,
            extractionStatus: syncedRef.extraction_status
          });
        }
        reusableExistingFps = db.getReferenceFingerprints(refId).filter(f => f.image_available);
      }

      // Extract real decoded keyframes across the ENTIRE video duration and compute multi-feature 64-bit dHashes,
      // committing every batch of 50 frames incrementally to SQLite so progress is never lost!
      const extractedFrames = await FingerprintEngine.extractVideoFingerprints(finalFilePath, {
        referenceId: refId,
        thumbnailsDir: db.getThumbnailsDir(),
        intervalSec,
        durationSec: probe.duration_sec,
        generateThumbnails: true,
        title: refItem.title,
        isCandidate: false,
        existingFrames: reusableExistingFps.length > 0 ? reusableExistingFps : undefined,
        simulateInterruptAfterFrames,
        onProgress: info => {
          const batchFps: FrameFingerprint[] = info.newFramesBatch.map(f => ({
            id: `fp_ref_${refId}_${f.frame_index}`,
            reference_id: refId,
            timestamp_sec: f.timestamp_sec,
            frame_index: f.frame_index,
            phash_hex: f.phash_hex,
            vhash_hex: f.vhash_hex,
            crop_phash_hex: f.crop_phash_hex,
            avg_luminance: f.avg_luminance,
            thumbnail_data: f.thumbnail_data,
            thumbnail_path: f.thumbnail_path,
            thumbnail_url: f.thumbnail_url,
            created_at: now
          }));
          if (batchFps.length > 0) {
            db.insertReferenceFingerprints(batchFps);
          }
          const pct =
            info.expectedCount > 0
              ? Math.min(99, Number(((info.extractedCount / info.expectedCount) * 100).toFixed(1)))
              : 0;
          db.updateReferenceExtractionState(refId, {
            extracted_frame_count: info.extractedCount,
            first_extracted_timestamp_sec: info.firstTimestampSec,
            last_extracted_timestamp_sec: info.lastTimestampSec,
            extraction_status: 'EXTRACTING',
            extraction_progress_pct: pct,
            status: 'PROCESSING'
          });
        }
      });

      if (!extractedFrames || extractedFrames.length === 0) {
        try { if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath); } catch {}
        if (!existingTarget) {
          db.deleteReference(refId);
        }
        activeUploadSessions.delete(uploadId);
        persistUploadSessionsRegistry();
        return res.status(422).json({
          success: false,
          error: 'No decodable video keyframes could be extracted from the uploaded file. No reference record was created or modified.',
          acquisitionStatus: 'INVALID_MEDIA_CONTAINER',
          mediaAcquired: false
        });
      }

      if (preservedPlatform || preservedSourceUrl) {
        refItem.notes = `Authorized reference master file attached for ${preservedPlatform || 'OTT Reference'} (${extractedFrames.length}/${samplingPlan.expectedFrameCount} keyframes decoded across ${probe.duration_sec}s via FFmpeg). ${session.auditNotes || ''}`.trim();
      }

      const persisted = db.persistAndVerifyReferenceExtraction({
        reference: refItem,
        extractedFrames,
        sampleIntervalSec: intervalSec,
        durationSec: probe.duration_sec,
        sourceVideoPath: finalFilePath,
        replaceExistingFingerprints: reusableExistingFps.length === 0
      });

      activeUploadSessions.delete(uploadId);
      persistUploadSessionsRegistry();

      return res.status(201).json({
        success: true,
        data: { ...persisted.reference, fingerprints: persisted.fingerprints },
        fingerprintsExtracted: persisted.fingerprints.length,
        expectedFrameCount: persisted.reference.expected_frame_count,
        extractionStatus: persisted.reference.extraction_status
      });
    } catch (extractErr: any) {
      activeUploadSessions.delete(uploadId);
      persistUploadSessionsRegistry();

      if (extractErr?.code === 'EXTRACTION_INTERRUPTED' && Array.isArray(extractErr.partialFrames)) {
        const persistedPartial = db.persistAndVerifyReferenceExtraction({
          reference: {
            ...refItem,
            status: 'PROCESSING'
          },
          extractedFrames: extractErr.partialFrames,
          sampleIntervalSec: intervalSec,
          durationSec: probe.duration_sec,
          sourceVideoPath: finalFilePath,
          replaceExistingFingerprints: true,
          extractionError: extractErr.message
        });

        return res.status(201).json({
          success: true,
          warning: extractErr.message,
          extractionStatus: persistedPartial.reference.extraction_status || 'PARTIAL',
          data: { ...persistedPartial.reference, fingerprints: persistedPartial.fingerprints },
          fingerprintsExtracted: persistedPartial.fingerprints.length,
          expectedFrameCount: persistedPartial.reference.expected_frame_count
        });
      }

      if (extractErr?.code === 'INVALID_TEST_PATTERN_SOURCE') {
        if (existingTarget && existingFpsBeforeUpload.length > 0) {
          const preservedExisting = db.getReferenceById(refId);
          return res.status(201).json({
            success: true,
            duplicatePreserved: true,
            warning: extractErr.message,
            data: preservedExisting ? { ...preservedExisting, fingerprints: existingFpsBeforeUpload } : null,
            fingerprintsExtracted: existingFpsBeforeUpload.length
          });
        }
        refItem.status = 'INVALID';
        refItem.thumbnail_url = undefined;
        refItem.first_thumbnail = undefined;
        refItem.fingerprint_count = 0;
        refItem.extracted_frame_count = 0;
        refItem.extraction_status = 'FAILED';
        refItem.extraction_error = extractErr.message;
        refItem.notes = extractErr.message;
        db.clearReferenceFingerprints(refId);
        db.upsertReference(refItem);
        const invalidRef = db.getReferenceById(refId);
        return res.status(201).json({
          success: true,
          warning: extractErr.message,
          data: invalidRef ? { ...invalidRef, fingerprints: [] } : null,
          fingerprintsExtracted: 0
        });
      }

      // Preserve any incrementally committed partial frames if an unexpected error occurs mid-extraction
      const existingPartialFps = db.getReferenceFingerprints(refId);
      if (existingPartialFps.length > 0) {
        db.syncReferenceExtractionCompleteness(refId, {
          sampleIntervalSec: intervalSec,
          durationSec: probe.duration_sec,
          extractionError: extractErr.message || 'Frame extraction interrupted'
        });
      }
      throw extractErr;
    }
  } catch (err: any) {
    console.warn('[Upload Complete Notice]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to complete upload and process fingerprints' });
  }
});

/**
 * 4. Cancel / Abort Upload Session
 */
router.delete('/uploads/:uploadId', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  const { uploadId } = req.params;
  const session = activeUploadSessions.get(uploadId);
  if (session) {
    try {
      if (fs.existsSync(session.tempDir)) {
        fs.rmSync(session.tempDir, { recursive: true, force: true });
      }
    } catch {}
    activeUploadSessions.delete(uploadId);
    persistUploadSessionsRegistry();
  }
  return res.json({ success: true, message: 'Upload session aborted and temporary chunks cleaned' });
});

// -------------------------------------------------------------
// System Statistics
// -------------------------------------------------------------
router.get('/stats', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const stats = db.getSystemStats();
    return res.json({ success: true, data: stats });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to compute system stats' });
  }
});

// -------------------------------------------------------------
// Reference Content Registration & OTT Ingestion (Stage A)
// -------------------------------------------------------------
router.get('/references', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const refs = db.getReferences();
    return res.json({ success: true, data: refs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve references' });
  }
});

router.get('/references/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const ref = db.getReferenceById(req.params.id);
    if (!ref) {
      return res.status(404).json({ error: 'Reference not found' });
    }
    const fingerprints = db.getReferenceFingerprints(ref.id, true);
    return res.json({ success: true, data: { ...ref, fingerprints } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve reference details' });
  }
});

/**
 * Paginated / Time-Filtered Reference Frames Endpoint:
 * Returns extracted frames across the entire video timeline along with explicit extraction completeness
 * and verified image availability telemetry.
 */
router.get('/references/:id/frames', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const ref = db.getReferenceById(req.params.id);
    if (!ref) {
      return res.status(404).json({ error: 'Reference not found' });
    }
    const offset = req.query.offset !== undefined ? Math.max(0, parseInt(String(req.query.offset), 10) || 0) : 0;
    const limit = req.query.limit !== undefined ? Math.max(1, parseInt(String(req.query.limit), 10) || 500) : 2000;
    const minTime = req.query.minTime !== undefined ? parseFloat(String(req.query.minTime)) : undefined;
    const maxTime = req.query.maxTime !== undefined ? parseFloat(String(req.query.maxTime)) : undefined;

    const { frames, totalMatching } = db.getReferenceFingerprintsPaginated(ref.id, {
      offset,
      limit,
      minTime: Number.isFinite(minTime) ? minTime : undefined,
      maxTime: Number.isFinite(maxTime) ? maxTime : undefined
    });

    return res.json({
      success: true,
      data: {
        frames,
        totalFrames: totalMatching,
        expectedFrames: ref.expected_frame_count ?? totalMatching,
        extractedFrames: ref.extracted_frame_count ?? ref.fingerprint_count ?? totalMatching,
        retrievableFrameImages: ref.retrievable_frame_image_count ?? frames.filter(f => f.image_available).length,
        missingFrameImages: ref.missing_frame_image_count ?? 0,
        imageAvailabilityStatus: ref.image_availability_status || 'COMPLETE',
        durationSec: ref.duration_sec,
        sampleIntervalSec: ref.sample_interval_sec ?? 2,
        extractionStatus: ref.extraction_status || 'COMPLETE',
        firstTimestampSec: ref.first_extracted_timestamp_sec ?? (frames[0]?.timestamp_sec ?? null),
        lastTimestampSec: ref.last_extracted_timestamp_sec ?? (frames[frames.length - 1]?.timestamp_sec ?? null),
        offset,
        limit
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve reference frames' });
  }
});

/**
 * Direct Reference Frame Image Endpoint:
 * Serves the binary JPEG image for a specific reference frame index, automatically self-healing
 * from SQLite thumbnail_data or regenerating from the source video if the disk file is missing.
 */
router.get('/references/:id/frames/:frameIndex/image', (req: Request, res: Response) => {
  try {
    const frameIndex = parseInt(String(req.params.frameIndex), 10);
    if (!Number.isFinite(frameIndex) || frameIndex < 0) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'Invalid frame index' });
    }
    const img = db.getReferenceFrameImageBuffer(req.params.id, frameIndex);
    if (!img) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(404).json({
        error: `Frame image unavailable for reference ${req.params.id} frame #${frameIndex}`
      });
    }
    res.setHeader('Content-Type', img.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(img.buffer);
  } catch (err: any) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: err.message || 'Failed to serve reference frame image' });
  }
});

/**
 * Global Frame Image Integrity Audit & Repair Endpoint:
 * Audits all references, repairs missing disk thumbnails from SQLite base64 or hash-verified sibling batches,
 * and selectively regenerates missing frames when the original source video is available.
 */
router.post('/references/audit-frames', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const audits = db.auditAndRepairReferenceFrameImages();
    const references = db.getReferences();
    return res.json({
      success: true,
      data: {
        audits,
        references
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to audit and repair reference frames' });
  }
});

/**
 * Durable Reference Recovery Endpoint:
 * Restores any missing user-registered references from the durable journal and
 * recovers any orphaned uploaded video files + extracted thumbnail batches on disk.
 */
router.post('/references/recover', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const restoredFromJournal = db.restoreMissingUserReferencesFromJournal();
    const recoveredOrphans = db.recoverOrphanedUploadedReferences();
    const references = db.getReferences();
    return res.json({
      success: true,
      data: {
        restoredFromJournal,
        recoveredOrphans,
        references
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to recover references' });
  }
});

/**
 * Per-Reference Frame Image Integrity Audit & Repair Endpoint:
 * Repairs broken paths, restores base64 thumbnails, or selectively regenerates missing frame JPEGs
 * using the original source video and recorded timestamps WITHOUT changing existing frame IDs, timestamps, or fingerprints.
 * Optionally accepts an uploaded video file (`file`) or `{ sourceVideoPath, filePath }` in the request body.
 */
router.post('/references/:id/repair-frames', handleUpload, async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const existing = db.getReferenceById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Reference not found' });
    }

    const suppliedPathRaw = req.file
      ? path.resolve(process.cwd(), req.file.path)
      : req.body?.sourceVideoPath || req.body?.filePath || req.body?.file_path;

    if (suppliedPathRaw && typeof suppliedPathRaw === 'string') {
      const resolvedSupplied = FingerprintEngine.resolveMediaSourcePath(suppliedPathRaw);
      if (fs.existsSync(resolvedSupplied)) {
        // Validate that the supplied video is not synthetic colour bars before attaching
        await FingerprintEngine.extractVideoFingerprints(resolvedSupplied, {
          referenceId: `${existing.id}_repair_probe`,
          thumbnailsDir: db.getThumbnailsDir(),
          intervalSec: Math.max(2, Math.floor((existing.duration_sec || 10) / 4)),
          maxFrames: 4,
          generateThumbnails: false,
          title: existing.title,
          isCandidate: false
        });
        db.upsertReference({
          ...existing,
          file_path: resolvedSupplied,
          last_acquisition_at: new Date().toISOString()
        });
      }
    }

    const audits = db.auditAndRepairReferenceFrameImages(existing.id);
    const updatedRef = db.getReferenceById(existing.id);
    const fingerprints = db.getReferenceFingerprints(existing.id, true);
    return res.json({
      success: true,
      audit: audits[0] || null,
      data: updatedRef ? { ...updatedRef, fingerprints } : null
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to repair reference frame images' });
  }
});

/**
 * Full-Video Frame Extraction & Resumption Endpoint:
 * Supports changing the sampling interval (1s, 2s, 5s, or custom seconds) OR resuming
 * a PARTIAL / interrupted extraction without losing already-extracted frames.
 */
router.post('/references/:id/extract-frames', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const existing = db.getReferenceById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Reference not found' });
    }

    const resolvedLocalVideo = db.resolveExistingReferenceVideoPath(existing);
    const httpMediaUrl =
      existing.media_url && String(existing.media_url).startsWith('http') ? existing.media_url : null;
    const mediaSource = resolvedLocalVideo || httpMediaUrl;

    if (!mediaSource) {
      const synced = db.syncReferenceExtractionCompleteness(existing.id) || existing;
      const missingPathNote = existing.file_path
        ? `Original source video file (${path.basename(existing.file_path)}) is no longer present on disk.`
        : 'Reference has no attached video file or accessible media stream.';
      return res.status(422).json({
        error: `${missingPathNote} Re-attach or upload the source video file to extract frames or regenerate missing JPEG images.`,
        sourceVideoAvailable: false,
        data: { ...synced, fingerprints: db.getReferenceFingerprints(existing.id, true) }
      });
    }

    const resume = Boolean(req.body?.resume);
    const requestedInterval = parseFloat(String(req.body?.sampleInterval ?? req.body?.sample_interval_sec ?? existing.sample_interval_sec ?? '2'));
    const intervalSec = Number.isFinite(requestedInterval) && requestedInterval > 0 ? requestedInterval : (existing.sample_interval_sec || 2.0);
    const simulateInterruptAfterFrames =
      req.body?.simulateInterruptAfterFrames !== undefined
        ? parseInt(String(req.body.simulateInterruptAfterFrames), 10)
        : undefined;

    const probe = await FingerprintEngine.probeVideo(mediaSource);
    const durationSec = probe.duration_sec > 0 ? probe.duration_sec : existing.duration_sec;
    const samplingPlan = FingerprintEngine.calculateSamplingPlan(durationSec, intervalSec);

    const intervalUnchanged = Math.abs((existing.sample_interval_sec || 2) - intervalSec) < 0.01;
    if (resume && intervalUnchanged) {
      // Repair any missing JPEGs on already-indexed frames in-place first so their IDs, timestamps, and fingerprints are preserved
      db.auditAndRepairReferenceFrameImages(existing.id);
    }
    const existingFps = db.getReferenceFingerprints(existing.id);
    const reuseFrames = resume && intervalUnchanged ? existingFps.filter(f => f.image_available) : [];

    db.updateReferenceExtractionState(existing.id, {
      duration_sec: durationSec,
      sample_interval_sec: intervalSec,
      expected_frame_count: samplingPlan.expectedFrameCount,
      extraction_status: 'EXTRACTING',
      extraction_error: null
    });

    const now = new Date().toISOString();
    try {
      const extracted = await FingerprintEngine.extractVideoFingerprints(mediaSource, {
        referenceId: existing.id,
        thumbnailsDir: db.getThumbnailsDir(),
        intervalSec,
        durationSec,
        generateThumbnails: true,
        title: existing.title,
        isCandidate: false,
        existingFrames: reuseFrames,
        simulateInterruptAfterFrames,
        onProgress: info => {
          const batchFps: FrameFingerprint[] = info.newFramesBatch.map(f => ({
            id: `fp_ref_${existing.id}_${f.frame_index}`,
            reference_id: existing.id,
            timestamp_sec: f.timestamp_sec,
            frame_index: f.frame_index,
            phash_hex: f.phash_hex,
            vhash_hex: f.vhash_hex,
            crop_phash_hex: f.crop_phash_hex,
            avg_luminance: f.avg_luminance,
            thumbnail_data: f.thumbnail_data,
            thumbnail_path: f.thumbnail_path,
            thumbnail_url: f.thumbnail_url,
            created_at: now
          }));
          if (batchFps.length > 0) {
            db.insertReferenceFingerprints(batchFps);
          }
          const pct = info.expectedCount > 0 ? Math.min(99, Number(((info.extractedCount / info.expectedCount) * 100).toFixed(1))) : 0;
          db.updateReferenceExtractionState(existing.id, {
            extracted_frame_count: info.extractedCount,
            first_extracted_timestamp_sec: info.firstTimestampSec,
            last_extracted_timestamp_sec: info.lastTimestampSec,
            extraction_status: 'EXTRACTING',
            extraction_progress_pct: pct,
            status: 'PROCESSING'
          });
        }
      });

      const persisted = db.persistAndVerifyReferenceExtraction({
        reference: {
          ...existing,
          duration_sec: durationSec,
          sample_interval_sec: intervalSec
        },
        extractedFrames: extracted,
        sampleIntervalSec: intervalSec,
        durationSec,
        sourceVideoPath: resolvedLocalVideo || existing.file_path,
        replaceExistingFingerprints: !(resume && intervalUnchanged)
      });

      return res.json({
        success: true,
        data: { ...persisted.reference, fingerprints: persisted.fingerprints },
        fingerprintsExtracted: persisted.fingerprints.length,
        expectedFrameCount: persisted.reference.expected_frame_count ?? samplingPlan.expectedFrameCount,
        extractionStatus: persisted.reference.extraction_status || (persisted.isComplete ? 'COMPLETE' : 'PARTIAL')
      });
    } catch (extractErr: any) {
      if (extractErr?.code === 'EXTRACTION_INTERRUPTED' && Array.isArray(extractErr.partialFrames)) {
        const persistedPartial = db.persistAndVerifyReferenceExtraction({
          reference: {
            ...existing,
            duration_sec: durationSec,
            sample_interval_sec: intervalSec,
            status: 'PROCESSING'
          },
          extractedFrames: extractErr.partialFrames,
          sampleIntervalSec: intervalSec,
          durationSec,
          sourceVideoPath: resolvedLocalVideo || existing.file_path,
          replaceExistingFingerprints: true,
          extractionError: extractErr.message
        });

        return res.status(200).json({
          success: true,
          warning: extractErr.message,
          data: { ...persistedPartial.reference, fingerprints: persistedPartial.fingerprints },
          fingerprintsExtracted: persistedPartial.fingerprints.length,
          expectedFrameCount: persistedPartial.reference.expected_frame_count ?? samplingPlan.expectedFrameCount,
          extractionStatus: persistedPartial.reference.extraction_status || 'PARTIAL'
        });
      }

      db.syncReferenceExtractionCompleteness(existing.id, {
        durationSec: existing.duration_sec,
        sampleIntervalSec: existing.sample_interval_sec || intervalSec,
        extractionError: extractErr.message || 'Frame extraction failed'
      });
      return res.status(422).json({
        error: extractErr.message || 'Frame extraction failed',
        data: db.getReferenceById(existing.id)
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to extract reference frames' });
  }
});

/**
 * Direct / Stream URL / OTT Webpage Reference Registration Handler:
 * Strictly guarantees JSON output under all circumstances.
 * Accepts direct multipart form uploads ('file'), direct stream URLs, or OTT platform webpage URLs
 * (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video, etc.).
 *
 * When an OTT webpage URL cannot be decoded directly due to DRM or login boundaries,
 * registers the reference as METADATA_REGISTERED or AWAITING_AUTHORIZED_MEDIA (never INVALID)
 * while preserving the OTT URL, platform, title, season/episode or event details, and rights holder.
 */
function normalizeUrlForReferenceMatch(url?: string): string {
  if (!url || !String(url).trim()) return '';
  try {
    const parsed = new URL(String(url).trim());
    parsed.hash = '';
    const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${cleanPath}${parsed.search}`;
  } catch {
    return String(url).trim().toLowerCase().replace(/\/+$/, '');
  }
}

function findMatchingExistingReference(params: {
  replaceReferenceId?: string;
  title: string;
  rightsHolder: string;
  seasonEpisodeInfo?: string;
  sourceUrl?: string;
  provenanceSha256?: string;
  isDirectFileUpload?: boolean;
}): ReferenceItem | undefined {
  if (params.replaceReferenceId && String(params.replaceReferenceId).trim()) {
    const byId = db.getReferenceById(String(params.replaceReferenceId).trim());
    if (byId) return byId;
  }

  const normTitle = String(params.title || '').trim().toLowerCase();
  const normRights = String(params.rightsHolder || '').trim().toLowerCase();
  const normSeasonEp = String(params.seasonEpisodeInfo || '').trim().toLowerCase();
  const normUrl = normalizeUrlForReferenceMatch(params.sourceUrl);

  const allRefs = db.getReferences();
  for (const ref of allRefs) {
    if (ref.source_type === 'FORENSIC_SAMPLE') continue;
    const refUrl = normalizeUrlForReferenceMatch(ref.source_url);
    const refTitle = String(ref.title || '').trim().toLowerCase();
    const refRights = String(ref.rights_holder || '').trim().toLowerCase();
    const refSeasonEp = String(ref.season_episode_info || '').trim().toLowerCase();
    const refHasFingerprints = (ref.fingerprint_count || 0) > 0 || (ref.extracted_frame_count || 0) > 0;

    // Never overwrite an already-fingerprinted reference with a DIFFERENT uploaded video file unless replaceReferenceId was explicitly provided
    if (
      params.isDirectFileUpload &&
      refHasFingerprints &&
      params.provenanceSha256 &&
      ref.provenance_sha256 &&
      params.provenanceSha256 !== ref.provenance_sha256 &&
      !normUrl
    ) {
      continue;
    }

    // Match 1: Same normalized source_url and same normalized title
    if (normUrl && refUrl && normUrl === refUrl && normTitle === refTitle) {
      return ref;
    }

    // Match 2: Same normalized title + rights_holder + season_episode_info when source_url also matches or one side has no source_url
    if (
      normTitle &&
      refTitle === normTitle &&
      normRights &&
      refRights === normRights &&
      normSeasonEp === refSeasonEp &&
      (!normUrl || !refUrl || normUrl === refUrl)
    ) {
      return ref;
    }
  }
  return undefined;
}

async function handleRegisterReference(req: Request, res: Response) {
  res.setHeader('Content-Type', 'application/json');
  try {
    let title = req.body?.title;
    let rightsHolder = req.body?.rightsHolder || req.body?.rights_holder;
    const assetType = req.body?.assetType || req.body?.asset_type;
    const auditNotes = req.body?.auditNotes || req.body?.notes;
    const sampleInterval = req.body?.sampleInterval || req.body?.sample_interval_sec;
    const sourceUrl = req.body?.sourceUrl || req.body?.source_url;
    const platformInput = req.body?.platform;
    const seasonEpisodeInput =
      req.body?.seasonEpisodeInfo ||
      req.body?.season_episode_info ||
      req.body?.eventDetails ||
      req.body?.event_details;
    const requestedInitialStatus = req.body?.initialStatus || req.body?.initial_status;
    const authorizedMasterUrl = req.body?.authorizedMasterUrl || req.body?.authorized_master_url;

    const candidateUrlForAutoMeta =
      (sourceUrl && String(sourceUrl).trim()) ||
      (authorizedMasterUrl && String(authorizedMasterUrl).trim()) ||
      '';
    let earlyUrlInspection: any = null;
    if (
      candidateUrlForAutoMeta &&
      (/^https?:\/\//i.test(candidateUrlForAutoMeta)) &&
      (!title || !String(title).trim() || !rightsHolder || !String(rightsHolder).trim())
    ) {
      try {
        const maxBytes = getMaxUploadSizeMB() * 1024 * 1024;
        earlyUrlInspection = await FingerprintEngine.inspectReferenceUrlAvailability(candidateUrlForAutoMeta, {
          maxBytes,
          allowLocalhostTestOrigin: process.env.SPECTRA_TEST_ALLOWED_ORIGIN || undefined
        });
        if (!title || !String(title).trim()) {
          title =
            earlyUrlInspection?.videoIdentity?.title ||
            earlyUrlInspection?.pageTitle ||
            (earlyUrlInspection?.platform
              ? `${earlyUrlInspection.platform} Video ${earlyUrlInspection.videoIdentity?.platformVideoId || ''}`.trim()
              : undefined) ||
            path.basename(new URL(candidateUrlForAutoMeta).pathname) ||
            'Reference Video';
        }
        if (!rightsHolder || !String(rightsHolder).trim()) {
          rightsHolder =
            earlyUrlInspection?.videoIdentity?.authorOrRightsHolder ||
            earlyUrlInspection?.platform ||
            earlyUrlInspection?.sourceAdapter?.name ||
            'Rights Holder';
        }
      } catch {}
    }

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Title is required for reference registration' });
    }
    if (!rightsHolder || !String(rightsHolder).trim()) {
      return res.status(400).json({ error: 'Rights holder is required for legal chain of custody' });
    }

    const replaceReferenceId = req.body?.replaceReferenceId || req.body?.replace_reference_id;
    const existingTarget = findMatchingExistingReference({
      replaceReferenceId: replaceReferenceId ? String(replaceReferenceId).trim() : undefined,
      title: String(title),
      rightsHolder: String(rightsHolder),
      seasonEpisodeInfo: seasonEpisodeInput ? String(seasonEpisodeInput) : undefined,
      sourceUrl: sourceUrl ? String(sourceUrl) : undefined
    });
    const existingFps = existingTarget ? db.getReferenceFingerprints(existingTarget.id) : [];
    const isExistingFingerprinted = Boolean(
      existingTarget &&
        existingFps.length > 0 &&
        (existingTarget.status === 'FINGERPRINTED' ||
          existingTarget.status === 'REGISTERED' ||
          existingTarget.status === 'PROCESSING')
    );

    const intervalSec = parseFloat(sampleInterval) || 2.0;
    const refId = existingTarget ? existingTarget.id : `ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    let filePath: string | undefined;
    let effectiveSourceUrl: string | undefined = existingTarget?.source_url;
    let sourceType: ReferenceItem['source_type'] = 'UPLOAD';
    let provenanceHash = existingTarget?.provenance_sha256 || '';

    if (req.file) {
      // Direct Multipart File Upload Mode
      filePath = path.resolve(process.cwd(), req.file.path);
      if (sourceUrl && String(sourceUrl).trim()) {
        effectiveSourceUrl = String(sourceUrl).trim();
      }
      sourceType = effectiveSourceUrl ? 'OTT_PAGE' : 'UPLOAD';
      try {
        provenanceHash = await new Promise<string>((resolve, reject) => {
          const hash = crypto.createHash('sha256');
          const stream = fs.createReadStream(filePath!);
          stream.on('data', chunk => hash.update(chunk));
          stream.on('end', () => resolve(hash.digest('hex')));
          stream.on('error', err => reject(err));
        });
      } catch {
        provenanceHash = crypto.createHash('sha256').update(`${req.file.originalname}_${req.file.size}_${Date.now()}`).digest('hex');
      }
    } else if (sourceUrl && String(sourceUrl).trim()) {
      effectiveSourceUrl = String(sourceUrl).trim();
      sourceType = 'DIRECT_URL';
      provenanceHash = existingTarget?.provenance_sha256 || crypto.createHash('sha256').update(effectiveSourceUrl).digest('hex');
    } else if (requestedInitialStatus === 'METADATA_REGISTERED' || requestedInitialStatus === 'AWAITING_AUTHORIZED_MEDIA') {
      // Pure catalog metadata registration without a file or URL yet
      sourceType = 'OTT_PAGE';
      provenanceHash = existingTarget?.provenance_sha256 || crypto.createHash('sha256').update(`${title}_${rightsHolder}_${now}`).digest('hex');
    } else {
      return res.status(400).json({
        error: 'Either a video file (file) or a valid media/OTT source URL (sourceUrl / source_url) must be provided'
      });
    }

    const registrationMode = req.body?.registrationMode || req.body?.registration_mode;
    const requireDirectMedia = Boolean(req.body?.requireDirectMedia ?? req.body?.require_direct_media);
    const allowMetadataFallback = req.body?.allowMetadataFallback ?? req.body?.allow_metadata_fallback;

    // Check if the provided URL is an OTT platform watch page (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video, etc.)
    const ottCheck = effectiveSourceUrl
      ? FingerprintEngine.isDrmOrProtectedWebPlatform(effectiveSourceUrl)
      : { isProtected: false, hostname: '' };

    // If this is an OTT platform webpage AND no local file or authorizedMasterUrl was supplied alongside it,
    // inspect the webpage first: if an authorized, directly accessible media stream is available (and user did not
    // explicitly force METADATA_REGISTERED), automatically proceed to acquire and process the full video!
    let preInspectedNonOtt: any = earlyUrlInspection;
    if (
      !preInspectedNonOtt &&
      !filePath &&
      !authorizedMasterUrl &&
      effectiveSourceUrl &&
      !ottCheck.isProtected &&
      (registrationMode === 'ott' ||
        requestedInitialStatus === 'METADATA_REGISTERED' ||
        requestedInitialStatus === 'AWAITING_AUTHORIZED_MEDIA')
    ) {
      const maxBytes = getMaxUploadSizeMB() * 1024 * 1024;
      preInspectedNonOtt = await FingerprintEngine.inspectReferenceUrlAvailability(effectiveSourceUrl, {
        maxBytes,
        allowLocalhostTestOrigin: process.env.SPECTRA_TEST_ALLOWED_ORIGIN || undefined
      });
    }
    if (
      preInspectedNonOtt &&
      registrationMode === 'ott' &&
      allowMetadataFallback !== true &&
      (preInspectedNonOtt.urlClassification === 'UNREACHABLE' ||
        preInspectedNonOtt.urlClassification === 'SSRF_REJECTED' ||
        preInspectedNonOtt.urlClassification === 'TORRENT_OR_UNSUPPORTED')
    ) {
      return res.status(422).json({
        error: preInspectedNonOtt.reason || 'Submitted webpage URL is unreachable or invalid.',
        acquisitionStatus: preInspectedNonOtt.acquisitionStatus || 'SOURCE_UNREACHABLE',
        inspection: preInspectedNonOtt,
        attemptedMethods: preInspectedNonOtt.attemptedMethods || [],
        workflow: preInspectedNonOtt.workflow,
        mediaAcquired: false
      });
    }

    const canAutoAcquireFromInspectedPage = Boolean(
      preInspectedNonOtt &&
        preInspectedNonOtt.canAcquireAuthorized &&
        preInspectedNonOtt.directMediaAvailable &&
        preInspectedNonOtt.resolvedMediaUrl &&
        requestedInitialStatus !== 'METADATA_REGISTERED' &&
        req.body?.autoAcquireMedia !== false
    );

    if (
      !filePath &&
      !authorizedMasterUrl &&
      !canAutoAcquireFromInspectedPage &&
      (ottCheck.isProtected ||
        requestedInitialStatus === 'METADATA_REGISTERED' ||
        requestedInitialStatus === 'AWAITING_AUTHORIZED_MEDIA')
    ) {
      const nonOttInspection = preInspectedNonOtt;

      const ottProbe = effectiveSourceUrl
        ? await FingerprintEngine.probeOttWebpageMetadata(effectiveSourceUrl)
        : null;

      const resolvedPlatform =
        (platformInput && String(platformInput).trim()) ||
        nonOttInspection?.platform ||
        nonOttInspection?.detectedPlayerProvider ||
        ottProbe?.platformName ||
        existingTarget?.platform ||
        'OTT Streaming Platform';

      const resolvedSeasonEpisode =
        (seasonEpisodeInput && String(seasonEpisodeInput).trim()) ||
        nonOttInspection?.seasonEpisodeInfo ||
        ottProbe?.seasonEpisodeInfo ||
        existingTarget?.season_episode_info ||
        undefined;

      const metadataWorkflow = FingerprintEngine.buildAcquisitionWorkflowReport({
        inspection: nonOttInspection,
        submittedUrl: effectiveSourceUrl,
        mediaAcquired: false,
        inspectionOnly: false,
        attemptedMethods: nonOttInspection?.attemptedMethods
      });

      // Never overwrite an already-fingerprinted or partially extracted reference with a metadata-only registration
      if (isExistingFingerprinted && existingTarget) {
        const preservedFingerprinted: ReferenceItem = {
          ...existingTarget,
          source_url: existingTarget.source_url || effectiveSourceUrl,
          platform: existingTarget.platform || resolvedPlatform,
          season_episode_info: existingTarget.season_episode_info || resolvedSeasonEpisode,
          status: existingTarget.status,
          fingerprint_count: existingFps.length
        };
        db.upsertReference(preservedFingerprinted);
        const savedPreserved = db.syncReferenceExtractionCompleteness(refId) || db.getReferenceById(refId);
        return res.status(201).json({
          success: true,
          duplicatePreserved: true,
          inspection: nonOttInspection || undefined,
          attemptedMethods: nonOttInspection?.attemptedMethods || [],
          workflow: metadataWorkflow,
          message: `Existing reference (${refId}) preserved with ${existingFps.length} indexed frames.`,
          data: savedPreserved ? { ...savedPreserved, fingerprints: existingFps } : null,
          fingerprintsExtracted: existingFps.length
        });
      }

      const targetStatus: ReferenceItem['status'] =
        requestedInitialStatus === 'METADATA_REGISTERED'
          ? 'METADATA_REGISTERED'
          : 'AWAITING_AUTHORIZED_MEDIA';

      const providerConfigured = Boolean(ottProbe?.providerKey && process.env[ottProbe.providerKey]);
      const providerStatus = providerConfigured
        ? 'PARTNER_CREDENTIALS_CONFIGURED_AWAITING_INGEST'
        : nonOttInspection?.acquisitionStatus || 'AWAITING_AUTHORIZED_MEDIA';

      const defaultNote = ottCheck.isProtected
        ? `OTT reference registered from ${resolvedPlatform} watch page${resolvedSeasonEpisode ? ` (${resolvedSeasonEpisode})` : ''}. Direct webpage decoding is protected by ${ottProbe?.drmScheme || 'DRM'} and login session boundaries (backend never shares browser sessions or bypasses DRM). Metadata is active for Discovery Sweeps. Attach an authorized reference master file or supply an approved provider feed to extract keyframes and transition to FINGERPRINTED.`
        : nonOttInspection?.reason
        ? nonOttInspection.reason
        : `Catalog reference metadata registered (${targetStatus}). Attach an authorized reference master video file or approved mezzanine stream to compute 64-bit dHash fingerprints.`;

      const refItem: ReferenceItem = {
        id: refId,
        title: String(title).trim(),
        rights_holder: String(rightsHolder).trim(),
        asset_type: assetType || existingTarget?.asset_type || (effectiveSourceUrl?.includes('live') || effectiveSourceUrl?.includes('sport') ? 'LIVE_SPORTS' : 'VOD_FEATURE'),
        duration_sec: nonOttInspection?.durationSec || existingTarget?.duration_sec || 0,
        resolution: existingTarget?.resolution || 'OTT / Web Catalog',
        fps: existingTarget?.fps || 0,
        codec: ottCheck.isProtected ? 'ott-drm-protected' : 'metadata-only',
        source_type: 'OTT_PAGE',
        source_url: effectiveSourceUrl,
        final_url: nonOttInspection?.finalUrl || existingTarget?.final_url || effectiveSourceUrl,
        media_url: nonOttInspection?.resolvedMediaUrl || existingTarget?.media_url,
        platform: resolvedPlatform,
        season_episode_info: resolvedSeasonEpisode,
        provider_integration_status: providerStatus,
        acquisition_status: existingTarget?.acquisition_status || providerStatus,
        authorization_provenance: existingTarget?.authorization_provenance,
        last_acquisition_at: nonOttInspection?.checkedAt || existingTarget?.last_acquisition_at || now,
        acquisition_error: nonOttInspection && !nonOttInspection.canAcquireAuthorized ? nonOttInspection.reason : existingTarget?.acquisition_error,
        detected_player_provider: nonOttInspection?.detectedPlayerProvider || existingTarget?.detected_player_provider,
        embedded_player_metadata_json: nonOttInspection?.accessibleMediaMetadata
          ? JSON.stringify({
              embeddedPlayers: nonOttInspection.embeddedPlayers || [],
              accessibleMediaMetadata: nonOttInspection.accessibleMediaMetadata,
              diagnosticErrors: nonOttInspection.diagnosticErrors || [],
              attemptedMethods: nonOttInspection.attemptedMethods || [],
              videoIdentity: nonOttInspection.videoIdentity
            })
          : existingTarget?.embedded_player_metadata_json,
        inspection_status:
          nonOttInspection?.inspectionStatus ||
          nonOttInspection?.urlClassification ||
          existingTarget?.inspection_status,
        file_path: undefined,
        thumbnail_url: undefined,
        first_thumbnail: undefined,
        created_at: existingTarget ? existingTarget.created_at : now,
        status: targetStatus,
        provenance_sha256: provenanceHash,
        fingerprint_count: 0,
        notes: auditNotes ? `${String(auditNotes).trim()} — ${defaultNote}` : defaultNote
      };

      db.clearReferenceFingerprints(refId);
      db.upsertReference(refItem);

      const savedRef = db.getReferenceById(refId);
      return res.status(201).json({
        success: true,
        ottMetadataRegistered: true,
        mediaAcquired: false,
        inspection: nonOttInspection || undefined,
        attemptedMethods: nonOttInspection?.attemptedMethods || [],
        workflow: metadataWorkflow,
        duplicateUpdated: Boolean(existingTarget),
        message: `OTT reference registered as ${targetStatus}. Metadata is ready for Discovery Sweeps; attach an authorized master video file to compute frame fingerprints.`,
        data: savedRef ? { ...savedRef, fingerprints: [] } : null,
        fingerprintsExtracted: 0
      });
    }

    const rawTargetUrl = authorizedMasterUrl ? String(authorizedMasterUrl).trim() : effectiveSourceUrl!;
    let mediaTarget = filePath || rawTargetUrl;
    let preProbed: { duration_sec: number; width: number; height: number; fps: number; codec: string } | undefined;
    let finalUrl: string | undefined = existingTarget?.final_url;
    let resolvedMediaUrl: string | undefined = existingTarget?.media_url;
    let acquisitionStatus: string | undefined = filePath ? 'LOCAL_MASTER_UPLOADED' : undefined;
    let authorizationProvenance: string | undefined =
      req.body?.authorizationProvenance ||
      req.body?.authorization_provenance ||
      (filePath ? 'LOCAL_FILE_UPLOAD' : existingTarget?.authorization_provenance);
    let detectedPlayerProvider: string | undefined = existingTarget?.detected_player_provider;
    let inspectionStatus: string | undefined = existingTarget?.inspection_status;
    let embeddedPlayerMetadataJson: string | undefined = existingTarget?.embedded_player_metadata_json;
    let acquiredInspectionObj: any = preInspectedNonOtt || undefined;
    let acquiredResumedFromBytes: number | undefined;

    const resolvedPlatform =
      (platformInput && String(platformInput).trim()) ||
      preInspectedNonOtt?.platform ||
      ottCheck.platformName ||
      existingTarget?.platform ||
      (effectiveSourceUrl?.includes('youtube.com') || effectiveSourceUrl?.includes('youtu.be') ? 'YouTube' : undefined);

    const resolvedSeasonEpisode =
      (seasonEpisodeInput && String(seasonEpisodeInput).trim()) ||
      preInspectedNonOtt?.seasonEpisodeInfo ||
      ottCheck.suggestedSeasonEpisode ||
      existingTarget?.season_episode_info ||
      undefined;

    const persistFailedUrlAcquisitionAsMetadata = (
      failStatus: string,
      failReason: string,
      urlInspection?: any
    ) => {
      const failWorkflow = FingerprintEngine.buildAcquisitionWorkflowReport({
        inspection: urlInspection,
        submittedUrl: effectiveSourceUrl || rawTargetUrl,
        mediaAcquired: false,
        inspectionOnly: false,
        errorReason: failReason,
        attemptedMethods: urlInspection?.attemptedMethods
      });

      // Never create incomplete records or corrupt existing references when requireDirectMedia is set (or SSRF/torrent rejected)
      const isPolicyRejected =
        urlInspection?.urlClassification === 'SSRF_REJECTED' ||
        urlInspection?.urlClassification === 'TORRENT_OR_UNSUPPORTED' ||
        failStatus === 'INVALID_MEDIA_CONTAINER' ||
        failStatus === 'FILE_SIZE_LIMIT_EXCEEDED' ||
        failStatus === 'MEDIA_DURATION_LIMIT_EXCEEDED';

      if ((requireDirectMedia || isPolicyRejected) && allowMetadataFallback !== true) {
        return res.status(422).json({
          error: failReason,
          acquisitionStatus: failStatus,
          inspection: urlInspection,
          attemptedMethods: urlInspection?.attemptedMethods || [],
          workflow: failWorkflow,
          mediaAcquired: false,
          existingReferencePreserved: Boolean(existingTarget)
        });
      }

      // Never overwrite an already-fingerprinted or partially extracted reference with a failed acquisition
      if (isExistingFingerprinted && existingTarget) {
        const preservedItem: ReferenceItem = {
          ...existingTarget,
          source_url: existingTarget.source_url || effectiveSourceUrl || rawTargetUrl,
          final_url: existingTarget.final_url || urlInspection?.finalUrl,
          platform: existingTarget.platform || resolvedPlatform || urlInspection?.platform,
          season_episode_info: existingTarget.season_episode_info || resolvedSeasonEpisode || urlInspection?.seasonEpisodeInfo,
          last_acquisition_at: urlInspection?.checkedAt || now,
          acquisition_error: failReason,
          detected_player_provider: existingTarget.detected_player_provider || urlInspection?.detectedPlayerProvider,
          inspection_status: existingTarget.inspection_status || urlInspection?.inspectionStatus || urlInspection?.urlClassification,
          status: existingTarget.status,
          fingerprint_count: existingFps.length
        };
        db.upsertReference(preservedItem);
        const savedPreserved = db.syncReferenceExtractionCompleteness(refId) || db.getReferenceById(refId);
        return res.status(201).json({
          success: true,
          duplicatePreserved: true,
          mediaAcquired: false,
          inspection: urlInspection,
          attemptedMethods: urlInspection?.attemptedMethods || [],
          workflow: failWorkflow,
          acquisitionStatus: failStatus,
          acquisitionError: failReason,
          message: `Existing reference (${refId}) preserved; new media acquisition failed (${failReason}).`,
          data: savedPreserved ? { ...savedPreserved, fingerprints: existingFps } : null,
          fingerprintsExtracted: existingFps.length
        });
      }

      const targetStatus: ReferenceItem['status'] =
        requestedInitialStatus === 'METADATA_REGISTERED'
          ? 'METADATA_REGISTERED'
          : existingTarget?.status === 'METADATA_REGISTERED' && !requestedInitialStatus
          ? 'METADATA_REGISTERED'
          : 'AWAITING_AUTHORIZED_MEDIA';

      const webpageRef: ReferenceItem = {
        id: refId,
        title: String(title).trim(),
        rights_holder: String(rightsHolder).trim(),
        asset_type: assetType || existingTarget?.asset_type || 'VOD_FEATURE',
        duration_sec: urlInspection?.durationSec || existingTarget?.duration_sec || 0,
        resolution: existingTarget?.resolution || 'OTT / Web Catalog',
        fps: existingTarget?.fps || 0,
        codec: 'metadata-only',
        source_type: 'OTT_PAGE',
        source_url: effectiveSourceUrl || rawTargetUrl,
        final_url: urlInspection?.finalUrl || existingTarget?.final_url || rawTargetUrl,
        media_url: urlInspection?.resolvedMediaUrl || existingTarget?.media_url,
        platform:
          resolvedPlatform ||
          urlInspection?.platform ||
          urlInspection?.detectedPlayerProvider ||
          existingTarget?.platform ||
          'Web Player Page',
        season_episode_info: resolvedSeasonEpisode || urlInspection?.seasonEpisodeInfo || existingTarget?.season_episode_info,
        provider_integration_status: failStatus,
        acquisition_status: failStatus,
        authorization_provenance: authorizationProvenance || existingTarget?.authorization_provenance,
        last_acquisition_at: urlInspection?.checkedAt || now,
        acquisition_error: failReason,
        detected_player_provider: urlInspection?.detectedPlayerProvider || existingTarget?.detected_player_provider,
        embedded_player_metadata_json: urlInspection?.accessibleMediaMetadata
          ? JSON.stringify({
              embeddedPlayers: urlInspection.embeddedPlayers || [],
              accessibleMediaMetadata: urlInspection.accessibleMediaMetadata,
              diagnosticErrors: urlInspection.diagnosticErrors || [],
              attemptedMethods: urlInspection.attemptedMethods || [],
              videoIdentity: urlInspection.videoIdentity
            })
          : existingTarget?.embedded_player_metadata_json,
        inspection_status:
          urlInspection?.inspectionStatus ||
          urlInspection?.urlClassification ||
          existingTarget?.inspection_status ||
          failStatus,
        file_path: undefined,
        thumbnail_url: undefined,
        first_thumbnail: undefined,
        created_at: existingTarget ? existingTarget.created_at : now,
        status: targetStatus,
        provenance_sha256: provenanceHash,
        fingerprint_count: 0,
        notes: auditNotes ? `${String(auditNotes).trim()} — ${failReason}` : failReason
      };
      db.clearReferenceFingerprints(refId);
      db.upsertReference(webpageRef);
      const savedWebpageRef = db.getReferenceById(refId);
      return res.status(201).json({
        success: true,
        ottMetadataRegistered: true,
        mediaAcquired: false,
        duplicateUpdated: Boolean(existingTarget),
        inspection: urlInspection,
        attemptedMethods: urlInspection?.attemptedMethods || [],
        workflow: failWorkflow,
        acquisitionStatus: failStatus,
        acquisitionError: failReason,
        message: failReason,
        data: savedWebpageRef ? { ...savedWebpageRef, fingerprints: [] } : null,
        fingerprintsExtracted: 0
      });
    };

    if (!filePath && rawTargetUrl && /^https?:\/\//i.test(rawTargetUrl)) {
      const resolvedLocalCandidate = FingerprintEngine.resolveMediaSourcePath(rawTargetUrl);
      const isLocalExisting = fs.existsSync(resolvedLocalCandidate);

      if (isLocalExisting) {
        filePath = resolvedLocalCandidate;
        mediaTarget = resolvedLocalCandidate;
        finalUrl = rawTargetUrl;
        resolvedMediaUrl = rawTargetUrl;
        acquisitionStatus = 'AUTHORIZED_MEDIA_ACQUIRED';
      } else {
        try {
          const maxBytes = getMaxUploadSizeMB() * 1024 * 1024;
          const acquired = await FingerprintEngine.acquireAuthorizedReferenceMediaFromUrl(rawTargetUrl, {
            maxBytes,
            maxDurationSec: 14400,
            authorizationProvenance: authorizationProvenance || 'RIGHTS_HOLDER_AUTHORIZED_URL_INGEST',
            allowLocalhostTestOrigin: process.env.SPECTRA_TEST_ALLOWED_ORIGIN || undefined,
            preInspected: preInspectedNonOtt || undefined
          });
          filePath = acquired.filePath || filePath;
          mediaTarget = acquired.mediaTarget;
          finalUrl = acquired.finalUrl;
          resolvedMediaUrl = acquired.resolvedMediaUrl;
          provenanceHash = acquired.provenanceSha256;
          preProbed = acquired.probe;
          acquiredInspectionObj = acquired.inspection;
          acquiredResumedFromBytes = acquired.resumedFromBytes;
          acquisitionStatus = 'AUTHORIZED_MEDIA_ACQUIRED';
          authorizationProvenance =
            authorizationProvenance ||
            (acquired.inspection.isWebpage
              ? 'RIGHTS_HOLDER_ATTESTED_WEBPAGE_MEDIA'
              : 'RIGHTS_HOLDER_AUTHORIZED_URL_INGEST');
          detectedPlayerProvider = acquired.inspection.detectedPlayerProvider || detectedPlayerProvider;
          inspectionStatus = acquired.inspection.inspectionStatus || acquired.inspection.urlClassification;
          if (acquired.inspection.accessibleMediaMetadata) {
            embeddedPlayerMetadataJson = JSON.stringify({
              embeddedPlayers: acquired.inspection.embeddedPlayers || [],
              accessibleMediaMetadata: acquired.inspection.accessibleMediaMetadata,
              diagnosticErrors: acquired.inspection.diagnosticErrors || [],
              attemptedMethods: acquired.inspection.attemptedMethods || [],
              videoIdentity: acquired.inspection.videoIdentity
            });
          }
        } catch (acqErr: any) {
          const urlInspection = acqErr?.inspection;
          const failStatus = acqErr?.acquisitionStatus || urlInspection?.acquisitionStatus || 'ACQUISITION_FAILED';
          const failReason = acqErr?.message || urlInspection?.reason || 'Unable to acquire authorized reference video from the submitted URL.';
          return persistFailedUrlAcquisitionAsMetadata(failStatus, failReason, urlInspection);
        }
      }
    }

    const refItem: ReferenceItem = {
      id: refId,
      title: String(title).trim(),
      rights_holder: String(rightsHolder).trim(),
      asset_type: assetType || existingTarget?.asset_type || (sourceType === 'DIRECT_URL' ? 'LIVE_SPORTS' : 'VOD_FEATURE'),
      duration_sec: preProbed?.duration_sec ?? existingTarget?.duration_sec ?? 0,
      resolution: preProbed ? `${preProbed.width}x${preProbed.height}` : (existingTarget?.resolution || '1920x1080'),
      fps: preProbed?.fps ?? existingTarget?.fps ?? 25,
      codec: preProbed?.codec ?? existingTarget?.codec ?? 'h264',
      source_type: ottCheck.isProtected ? 'OTT_PAGE' : sourceType,
      source_url: effectiveSourceUrl,
      final_url: finalUrl || effectiveSourceUrl,
      media_url: resolvedMediaUrl || (filePath ? undefined : mediaTarget),
      platform: resolvedPlatform || acquiredInspectionObj?.platform || detectedPlayerProvider,
      season_episode_info: resolvedSeasonEpisode || acquiredInspectionObj?.seasonEpisodeInfo,
      provider_integration_status:
        acquisitionStatus === 'AUTHORIZED_MEDIA_ACQUIRED'
          ? 'AUTHORIZED_URL_MEDIA_INGESTED'
          : filePath || authorizedMasterUrl
          ? 'AUTHORIZED_MASTER_ATTACHED'
          : 'DIRECT_STREAM_DECODED',
      acquisition_status: acquisitionStatus || 'DIRECT_STREAM_DECODED',
      authorization_provenance: authorizationProvenance,
      last_acquisition_at: now,
      acquisition_error: undefined,
      detected_player_provider: detectedPlayerProvider,
      embedded_player_metadata_json: embeddedPlayerMetadataJson,
      inspection_status: inspectionStatus,
      file_path: filePath,
      created_at: existingTarget ? existingTarget.created_at : now,
      status: 'PROCESSING',
      provenance_sha256: provenanceHash,
      fingerprint_count: 0,
      notes: auditNotes ? String(auditNotes) : existingTarget?.notes
    };

    try {
      const probe = preProbed || (await FingerprintEngine.probeVideo(mediaTarget));
      refItem.duration_sec = probe.duration_sec;
      refItem.resolution = `${probe.width}x${probe.height}`;
      refItem.fps = probe.fps;
      refItem.codec = probe.codec;

      const samplingPlan = FingerprintEngine.calculateSamplingPlan(probe.duration_sec, intervalSec);
      refItem.sample_interval_sec = samplingPlan.intervalSec;
      refItem.expected_frame_count = samplingPlan.expectedFrameCount;
      refItem.extraction_status = 'EXTRACTING';

      // Commit the reference record to SQLite before starting FFmpeg keyframe extraction,
      // while preserving any existing fingerprinted record until new frames are verified.
      if (!isExistingFingerprinted) {
        db.upsertReference(refItem);
      }

      const simulateInterruptAfterFrames =
        req.body?.simulateInterruptAfterFrames !== undefined
          ? Number(req.body.simulateInterruptAfterFrames)
          : undefined;

      // Extract real decoded keyframes across the ENTIRE video duration (0s to end of video),
      // persisting batches incrementally to SQLite when not replacing an already-fingerprinted reference.
      const extractedFrames = await FingerprintEngine.extractVideoFingerprints(mediaTarget, {
        referenceId: refId,
        thumbnailsDir: db.getThumbnailsDir(),
        intervalSec: samplingPlan.intervalSec,
        durationSec: probe.duration_sec,
        generateThumbnails: true,
        title: String(title).trim(),
        isCandidate: false,
        simulateInterruptAfterFrames,
        onProgress: !isExistingFingerprinted
          ? info => {
              const batchFps: FrameFingerprint[] = info.newFramesBatch.map(f => ({
                id: `fp_ref_${refId}_${f.frame_index}`,
                reference_id: refId,
                timestamp_sec: f.timestamp_sec,
                frame_index: f.frame_index,
                phash_hex: f.phash_hex,
                vhash_hex: f.vhash_hex,
                crop_phash_hex: f.crop_phash_hex,
                avg_luminance: f.avg_luminance,
                thumbnail_data: f.thumbnail_data,
                thumbnail_path: f.thumbnail_path,
                thumbnail_url: f.thumbnail_url,
                created_at: now
              }));
              if (batchFps.length > 0) {
                db.insertReferenceFingerprints(batchFps);
              }
              const pct =
                info.expectedCount > 0
                  ? Math.min(99, Number(((info.extractedCount / info.expectedCount) * 100).toFixed(1)))
                  : 0;
              db.updateReferenceExtractionState(refId, {
                extracted_frame_count: info.extractedCount,
                first_extracted_timestamp_sec: info.firstTimestampSec,
                last_extracted_timestamp_sec: info.lastTimestampSec,
                extraction_status: 'EXTRACTING',
                extraction_progress_pct: pct,
                status: 'PROCESSING'
              });
            }
          : undefined
      });

      const persisted = db.persistAndVerifyReferenceExtraction({
        reference: refItem,
        extractedFrames,
        sampleIntervalSec: samplingPlan.intervalSec,
        durationSec: probe.duration_sec,
        sourceVideoPath: filePath || (fs.existsSync(mediaTarget) ? mediaTarget : undefined),
        replaceExistingFingerprints: true
      });

      const completedWorkflow = FingerprintEngine.buildAcquisitionWorkflowReport({
        inspection: acquiredInspectionObj,
        localFileUpload: Boolean(req.file),
        submittedUrl: effectiveSourceUrl || rawTargetUrl,
        mediaAcquired: true,
        mediaValidated: true,
        probe,
        extractedFrames: persisted.fingerprints.length,
        expectedFrames: persisted.reference.expected_frame_count ?? samplingPlan.expectedFrameCount,
        verifiedImages: persisted.reference.retrievable_frame_image_count ?? persisted.fingerprints.length,
        isComplete: persisted.isComplete,
        resumedFromBytes: acquiredResumedFromBytes,
        attemptedMethods: acquiredInspectionObj?.attemptedMethods
      });

      return res.status(201).json({
        success: true,
        mediaAcquired: true,
        resumedFromBytes: acquiredResumedFromBytes,
        inspection: acquiredInspectionObj,
        attemptedMethods: acquiredInspectionObj?.attemptedMethods || [],
        workflow: completedWorkflow,
        data: { ...persisted.reference, fingerprints: persisted.fingerprints },
        fingerprintsExtracted: persisted.fingerprints.length,
        expectedFrameCount: persisted.reference.expected_frame_count ?? samplingPlan.expectedFrameCount,
        extractionStatus: persisted.reference.extraction_status || (persisted.isComplete ? 'COMPLETE' : 'PARTIAL')
      });
    } catch (extractErr: any) {
      if (extractErr?.code === 'EXTRACTION_INTERRUPTED' && Array.isArray(extractErr.partialFrames)) {
        const persistedPartial = db.persistAndVerifyReferenceExtraction({
          reference: {
            ...refItem,
            status: 'PROCESSING'
          },
          extractedFrames: extractErr.partialFrames,
          sampleIntervalSec: refItem.sample_interval_sec || intervalSec,
          durationSec: refItem.duration_sec || 0,
          sourceVideoPath: filePath || (fs.existsSync(mediaTarget) ? mediaTarget : undefined),
          replaceExistingFingerprints: true,
          extractionError: extractErr.message
        });

        const partialWorkflow = FingerprintEngine.buildAcquisitionWorkflowReport({
          inspection: acquiredInspectionObj,
          localFileUpload: Boolean(req.file),
          submittedUrl: effectiveSourceUrl || rawTargetUrl,
          mediaAcquired: true,
          mediaValidated: true,
          extractedFrames: persistedPartial.fingerprints.length,
          expectedFrames: persistedPartial.reference.expected_frame_count ?? 0,
          verifiedImages: persistedPartial.reference.retrievable_frame_image_count ?? 0,
          isComplete: false,
          errorReason: extractErr.message
        });

        return res.status(201).json({
          success: true,
          warning: extractErr.message,
          extractionStatus: persistedPartial.reference.extraction_status || 'PARTIAL',
          inspection: acquiredInspectionObj,
          workflow: partialWorkflow,
          data: { ...persistedPartial.reference, fingerprints: persistedPartial.fingerprints },
          fingerprintsExtracted: persistedPartial.fingerprints.length,
          expectedFrameCount: persistedPartial.reference.expected_frame_count
        });
      }
      if (extractErr?.code === 'OTT_PROTECTED_WEBPAGE') {
        return persistFailedUrlAcquisitionAsMetadata(
          'AWAITING_AUTHORIZED_MEDIA',
          `OTT reference registered from ${resolvedPlatform || extractErr.platformName || 'OTT Streaming Platform'}. Direct webpage decoding is restricted by DRM/login boundaries; metadata is active for Discovery Sweeps. Attach an authorized reference master file to compute perceptual fingerprints.`
        );
      }
      if (extractErr?.code === 'INVALID_TEST_PATTERN_SOURCE') {
        if (isExistingFingerprinted && existingTarget) {
          const savedPreserved = db.getReferenceById(refId);
          return res.status(201).json({
            success: true,
            duplicatePreserved: true,
            warning: extractErr.message,
            data: savedPreserved ? { ...savedPreserved, fingerprints: existingFps } : null,
            fingerprintsExtracted: existingFps.length
          });
        }
        refItem.status = 'INVALID';
        refItem.thumbnail_url = undefined;
        refItem.first_thumbnail = undefined;
        refItem.fingerprint_count = 0;
        refItem.notes = extractErr.message;
        db.clearReferenceFingerprints(refId);
        db.upsertReference(refItem);
        const invalidRef = db.getReferenceById(refId);
        return res.status(201).json({
          success: true,
          warning: extractErr.message,
          data: invalidRef ? { ...invalidRef, fingerprints: [] } : null,
          fingerprintsExtracted: 0
        });
      }

      // If the user submitted an HTTP/HTTPS URL and probing or frame extraction failed,
      // inspect the URL (when possible) and persist or report failure cleanly
      if (!filePath && effectiveSourceUrl && /^https?:\/\//i.test(effectiveSourceUrl)) {
        let urlInspection: any;
        try {
          urlInspection = await FingerprintEngine.inspectReferenceUrlAvailability(effectiveSourceUrl, {
            allowLocalhostTestOrigin: process.env.SPECTRA_TEST_ALLOWED_ORIGIN || undefined
          });
        } catch {}
        const failStatus = urlInspection?.acquisitionStatus || 'ACQUISITION_FAILED';
        const failReason = urlInspection?.reason || extractErr.message || 'Unable to decode video frames from the submitted URL.';
        return persistFailedUrlAcquisitionAsMetadata(failStatus, failReason, urlInspection);
      }

      throw extractErr;
    }
  } catch (err: any) {
    console.warn('[Reference Registration Notice]', err.message);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({
      error: err.message || 'Reference registration failed'
    });
  }
}

// Canonical endpoint: POST /api/references
router.post('/references', handleUpload, handleRegisterReference);

// Backward-compatibility aliases
router.post('/references/upload', handleUpload, handleRegisterReference);
router.post('/references/url', handleUpload, handleRegisterReference);

/**
 * Inspect a Reference Webpage URL or Direct Media URL for Media Availability:
 * Distinguishes a webpage URL from an actual media asset URL, validates SSRF/redirects,
 * inspects accessible page metadata, and reports whether a directly accessible unencrypted
 * video asset is available for authorized server-side acquisition.
 * - Never creates incomplete records when no referenceId is supplied.
 * - Never corrupts existing references when an inspection fails or returns unreachable/invalid.
 */
async function handleInspectReferenceUrl(req: Request, res: Response) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const rawUrl =
      req.body?.url ||
      req.body?.sourceUrl ||
      req.body?.referenceWebpageUrl ||
      req.body?.authorizedMediaUrl;
    const referenceId = req.params.id || req.body?.referenceId || req.body?.reference_id;

    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return res.status(400).json({ error: 'A reference webpage URL or media URL (url) is required for inspection.' });
    }

    const maxBytes = getMaxUploadSizeMB() * 1024 * 1024;
    const inspection = await FingerprintEngine.inspectReferenceUrlAvailability(rawUrl.trim(), {
      maxBytes,
      allowLocalhostTestOrigin: process.env.SPECTRA_TEST_ALLOWED_ORIGIN || undefined
    });

    let updatedRef: (ReferenceItem & { fingerprints?: FrameFingerprint[] }) | null = null;
    if (referenceId) {
      const existing = db.getReferenceById(String(referenceId).trim());
      if (existing) {
        const existingFps = db.getReferenceFingerprints(existing.id);
        const isExistingAlreadyFingerprinted =
          existingFps.length > 0 &&
          (existing.status === 'FINGERPRINTED' || existing.status === 'REGISTERED' || existing.status === 'PROCESSING');
        const isFailedInspection =
          inspection.urlClassification === 'UNREACHABLE' ||
          inspection.urlClassification === 'SSRF_REJECTED' ||
          inspection.urlClassification === 'TORRENT_OR_UNSUPPORTED';

        // If the reference is already fingerprinted or if the inspection failed (unreachable/SSRF/invalid),
        // do NOT overwrite the existing reference's valid final_url, media_url, platform, or status!
        if (isExistingAlreadyFingerprinted || isFailedInspection) {
          const preservedRecord: ReferenceItem = {
            ...existing,
            last_acquisition_at: inspection.checkedAt,
            acquisition_error: inspection.canAcquireAuthorized ? existing.acquisition_error : inspection.reason
          };
          db.upsertReference(preservedRecord);
          const saved = db.getReferenceById(existing.id);
          updatedRef = saved ? { ...saved, fingerprints: existingFps } : null;
        } else {
          const preservedRecord: ReferenceItem = {
            ...existing,
            source_url: existing.source_url || inspection.submittedUrl,
            final_url: inspection.finalUrl || existing.final_url,
            media_url: inspection.resolvedMediaUrl || existing.media_url,
            platform: existing.platform || inspection.platform,
            season_episode_info: existing.season_episode_info || inspection.seasonEpisodeInfo,
            detected_player_provider: inspection.detectedPlayerProvider || existing.detected_player_provider,
            embedded_player_metadata_json: inspection.accessibleMediaMetadata
              ? JSON.stringify({
                  embeddedPlayers: inspection.embeddedPlayers || [],
                  accessibleMediaMetadata: inspection.accessibleMediaMetadata,
                  diagnosticErrors: inspection.diagnosticErrors || [],
                  attemptedMethods: inspection.attemptedMethods || [],
                  videoIdentity: inspection.videoIdentity
                })
              : existing.embedded_player_metadata_json,
            inspection_status: inspection.inspectionStatus || inspection.urlClassification,
            acquisition_status: inspection.acquisitionStatus,
            last_acquisition_at: inspection.checkedAt,
            acquisition_error: inspection.canAcquireAuthorized ? undefined : inspection.reason
          };
          db.upsertReference(preservedRecord);
          const saved = db.getReferenceById(existing.id);
          updatedRef = saved ? { ...saved, fingerprints: existingFps } : null;
        }
      }
    }

    return res.json({
      success: true,
      data: inspection,
      attemptedMethods: inspection.attemptedMethods || [],
      workflow: inspection.workflow,
      reference: updatedRef
    });
  } catch (err: any) {
    console.warn('[Inspect Reference URL Notice]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to inspect reference URL' });
  }
}

router.post('/references/inspect-url', handleInspectReferenceUrl);
router.post('/references/:id/inspect-url', handleInspectReferenceUrl);

/**
 * Attach an Authorized Reference Master File, Approved Mezzanine Stream URL, or
 * Reference Webpage URL with Accessible Media to an existing reference record (or retry automatic acquisition).
 * - Preserves the existing reference record if acquisition is unavailable, restricted, or fails.
 * - Never marks a reference as FINGERPRINTED when no actual video was acquired.
 * - Enforces SSRF protection, redirect validation, file-size and duration limits, and container validation.
 * - Preserves source_url, final_url, media_url, acquisition_status, authorization_provenance, timestamps, and error details.
 */
async function handleAttachOrAcquireReferenceMedia(req: Request, res: Response) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const existing = db.getReferenceById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: `Reference ${req.params.id} not found` });
    }

    const existingFps = db.getReferenceFingerprints(existing.id);
    const now = new Date().toISOString();

    const isAutoAcquireRoute = req.path.endsWith('/acquire-media');
    const submittedUrlRaw =
      req.body?.authorizedMediaUrl ||
      req.body?.authorized_media_url ||
      req.body?.referenceWebpageUrl ||
      req.body?.reference_webpage_url ||
      req.body?.mezzanineUrl ||
      req.body?.sourceUrl ||
      req.body?.url ||
      ((isAutoAcquireRoute || req.body?.autoAcquireFromSourceUrl === true) ? existing.source_url : undefined);
    const providerId = req.body?.providerId || req.body?.provider_id;
    const sampleInterval = parseFloat(req.body?.sampleInterval || req.body?.sample_interval_sec) || existing.sample_interval_sec || 2.0;
    const updatedPlatform = req.body?.platform ? String(req.body.platform).trim() : existing.platform;
    const updatedSeasonEpisode = req.body?.seasonEpisodeInfo || req.body?.season_episode_info
      ? String(req.body.seasonEpisodeInfo || req.body.season_episode_info).trim()
      : existing.season_episode_info;
    const updatedNotes = req.body?.notes || req.body?.auditNotes;
    const maxBytes = req.body?.maxBytes ? Number(req.body.maxBytes) : getMaxUploadSizeMB() * 1024 * 1024;
    const maxDurationSec = req.body?.maxDurationSec ? Number(req.body.maxDurationSec) : 14400;

    // Authorization check: never acquire remote URL media if user explicitly declined authorization attestation
    if (!req.file && submittedUrlRaw && req.body?.authorizationConfirmed === false) {
      const authNote = 'Media acquisition declined: Rights-holder authorization attestation is required before server-side video acquisition.';
      const preserved: ReferenceItem = {
        ...existing,
        platform: updatedPlatform,
        season_episode_info: updatedSeasonEpisode,
        acquisition_status: 'AUTHORIZATION_NOT_ATTESTED',
        last_acquisition_at: now,
        acquisition_error: authNote,
        notes: `${existing.notes ? `${existing.notes} | ` : ''}[${now}] ${authNote}`
      };
      db.upsertReference(preserved);
      const saved = db.getReferenceById(existing.id);
      return res.status(403).json({
        error: authNote,
        acquisitionStatus: 'AUTHORIZATION_NOT_ATTESTED',
        data: saved ? { ...saved, fingerprints: existingFps } : null
      });
    }

    let mediaTarget: string | undefined;
    let filePath: string | undefined = existing.file_path;
    let provenanceHash = existing.provenance_sha256;
    let finalUrl: string | undefined = existing.final_url;
    let resolvedMediaUrl: string | undefined = existing.media_url;
    let acquisitionStatus = 'LOCAL_MASTER_UPLOADED';
    let authorizationProvenance =
      req.body?.authorizationProvenance ||
      req.body?.authorization_provenance ||
      (req.file ? 'LOCAL_FILE_UPLOAD' : 'RIGHTS_HOLDER_AUTHORIZED_URL_INGEST');
    let preProbed: { duration_sec: number; width: number; height: number; fps: number; codec: string } | undefined;
    let acquiredInspectionResult: any = undefined;
    let acquiredResumedFromBytes: number | undefined;

    if (req.file) {
      filePath = path.resolve(process.cwd(), req.file.path);
      mediaTarget = filePath;
      acquisitionStatus = 'LOCAL_MASTER_UPLOADED';
      authorizationProvenance = 'LOCAL_FILE_UPLOAD';
      try {
        provenanceHash = await new Promise<string>((resolve, reject) => {
          const hash = crypto.createHash('sha256');
          const stream = fs.createReadStream(filePath!);
          stream.on('data', chunk => hash.update(chunk));
          stream.on('end', () => resolve(hash.digest('hex')));
          stream.on('error', err => reject(err));
        });
      } catch {
        provenanceHash = crypto.createHash('sha256').update(`${req.file.originalname}_${req.file.size}_${Date.now()}`).digest('hex');
      }
    } else if (submittedUrlRaw && String(submittedUrlRaw).trim()) {
      const candidateUrl = String(submittedUrlRaw).trim();
      const resolvedLocal = FingerprintEngine.resolveMediaSourcePath(candidateUrl);
      const isLocalExistingFile = fs.existsSync(resolvedLocal);

      if (isLocalExistingFile) {
        filePath = resolvedLocal;
        mediaTarget = resolvedLocal;
        finalUrl = candidateUrl;
        resolvedMediaUrl = candidateUrl;
        acquisitionStatus = 'AUTHORIZED_MEDIA_ACQUIRED';
        provenanceHash = crypto.createHash('sha256').update(`${existing.source_url || ''}|${resolvedLocal}`).digest('hex');
      } else {
        let acquiredInspection = existing.embedded_player_metadata_json;
        let acquiredPlayerProvider = existing.detected_player_provider;
        let acquiredInspectionStatus = existing.inspection_status;
        try {
          const acquired = await FingerprintEngine.acquireAuthorizedReferenceMediaFromUrl(candidateUrl, {
            maxBytes,
            maxDurationSec,
            authorizationProvenance,
            allowLocalhostTestOrigin: process.env.SPECTRA_TEST_ALLOWED_ORIGIN || undefined
          });
          filePath = acquired.filePath || existing.file_path;
          mediaTarget = acquired.mediaTarget;
          finalUrl = acquired.finalUrl;
          resolvedMediaUrl = acquired.resolvedMediaUrl;
          provenanceHash = acquired.provenanceSha256;
          preProbed = acquired.probe;
          acquiredInspectionResult = acquired.inspection;
          acquiredResumedFromBytes = acquired.resumedFromBytes;
          acquisitionStatus = 'AUTHORIZED_MEDIA_ACQUIRED';
          if (acquired.inspection.detectedPlayerProvider) {
            acquiredPlayerProvider = acquired.inspection.detectedPlayerProvider;
          }
          if (acquired.inspection.accessibleMediaMetadata) {
            acquiredInspection = JSON.stringify({
              embeddedPlayers: acquired.inspection.embeddedPlayers || [],
              accessibleMediaMetadata: acquired.inspection.accessibleMediaMetadata,
              diagnosticErrors: acquired.inspection.diagnosticErrors || [],
              attemptedMethods: acquired.inspection.attemptedMethods || [],
              videoIdentity: acquired.inspection.videoIdentity
            });
          }
          acquiredInspectionStatus = acquired.inspection.inspectionStatus || acquired.inspection.urlClassification;
          existing.detected_player_provider = acquiredPlayerProvider;
          existing.embedded_player_metadata_json = acquiredInspection;
          existing.inspection_status = acquiredInspectionStatus;
          if (acquired.inspection.isWebpage) {
            authorizationProvenance =
              req.body?.authorizationProvenance || 'RIGHTS_HOLDER_ATTESTED_WEBPAGE_MEDIA';
          }
        } catch (acqErr: any) {
          const inspection = acqErr?.inspection;
          const failStatus = acqErr?.acquisitionStatus || inspection?.acquisitionStatus || 'ACQUISITION_FAILED';
          const failReason = acqErr?.message || 'Unable to acquire authorized reference video from the submitted URL.';

          // Preserve existing reference record, status (never mark as FINGERPRINTED if not already fingerprinted), and audit trail
          const preservedStatus: ReferenceItem['status'] =
            existingFps.length > 0 && (existing.status === 'FINGERPRINTED' || existing.status === 'REGISTERED')
              ? existing.status
              : existing.status === 'METADATA_REGISTERED'
              ? 'METADATA_REGISTERED'
              : existing.status === 'INVALID'
              ? 'INVALID'
              : 'AWAITING_AUTHORIZED_MEDIA';

          const preservedItem: ReferenceItem = {
            ...existing,
            title: existing.title || inspection?.videoIdentity?.title || inspection?.pageTitle || 'Reference Video',
            rights_holder: existing.rights_holder || inspection?.videoIdentity?.authorOrRightsHolder || inspection?.platform || 'Rights Holder',
            duration_sec: existing.duration_sec || inspection?.durationSec || 0,
            source_type: existing.source_type === 'FORENSIC_SAMPLE' ? 'OTT_PAGE' : existing.source_type,
            source_url: existing.source_url || candidateUrl,
            final_url: inspection?.finalUrl || candidateUrl,
            media_url: inspection?.resolvedMediaUrl || existing.media_url,
            platform: updatedPlatform || inspection?.platform || existing.platform,
            season_episode_info: updatedSeasonEpisode || inspection?.seasonEpisodeInfo || existing.season_episode_info,
            provider_integration_status: `URL_INGEST_${failStatus}`,
            acquisition_status: failStatus,
            authorization_provenance: authorizationProvenance,
            last_acquisition_at: now,
            acquisition_error: failReason,
            detected_player_provider: inspection?.detectedPlayerProvider || existing.detected_player_provider,
            embedded_player_metadata_json: inspection?.accessibleMediaMetadata
              ? JSON.stringify({
                  embeddedPlayers: inspection.embeddedPlayers || [],
                  accessibleMediaMetadata: inspection.accessibleMediaMetadata,
                  diagnosticErrors: inspection.diagnosticErrors || [],
                  attemptedMethods: inspection.attemptedMethods || [],
                  videoIdentity: inspection.videoIdentity
                })
              : existing.embedded_player_metadata_json,
            inspection_status: inspection?.inspectionStatus || inspection?.urlClassification || existing.inspection_status,
            status: preservedStatus,
            notes: `URL media acquisition status [${failStatus}]: ${failReason}`
          };
          db.upsertReference(preservedItem);
          const savedRef = db.getReferenceById(existing.id);
          const failWorkflow = FingerprintEngine.buildAcquisitionWorkflowReport({
            inspection,
            submittedUrl: candidateUrl,
            mediaAcquired: false,
            inspectionOnly: false,
            errorReason: failReason,
            attemptedMethods: inspection?.attemptedMethods
          });

          return res.status(422).json({
            error: failReason,
            acquisitionStatus: failStatus,
            inspection,
            attemptedMethods: inspection?.attemptedMethods || [],
            workflow: failWorkflow,
            data: savedRef ? { ...savedRef, fingerprints: existingFps } : null
          });
        }
      }
    } else if (providerId) {
      // Check if partner provider credentials are configured
      const envMap: Record<string, string> = {
        SONYLIV_PARTNER_SYNDICATION: 'SONYLIV_PARTNER_API_KEY',
        HOTSTAR_NOVI_SYNDICATION: 'HOTSTAR_NOVI_SYNDICATION_TOKEN',
        NETFLIX_BACKLOT_DELIVERY: 'NETFLIX_BACKLOT_API_KEY',
        JIOCINEMA_VIACOM18_FEED: 'JIOCINEMA_PARTNER_TOKEN',
        PRIME_VIDEO_DIRECT_FEED: 'PRIME_VIDEO_DIRECT_KEY'
      };
      const requiredEnv = envMap[providerId];
      if (requiredEnv && !process.env[requiredEnv]) {
        const updatedRef: ReferenceItem = {
          ...existing,
          platform: updatedPlatform,
          season_episode_info: updatedSeasonEpisode,
          status: existingFps.length > 0 ? existing.status : 'AWAITING_AUTHORIZED_MEDIA',
          provider_integration_status: `AWAITING_CREDENTIALS (${requiredEnv})`,
          acquisition_status: 'AWAITING_PROVIDER_CREDENTIALS',
          last_acquisition_at: now,
          acquisition_error: `Partner API credential ${requiredEnv} is not configured.`,
          notes: `Provider integration "${providerId}" requested, but partner credential ${requiredEnv} is not configured in the environment. Upload an authorized reference master file (.mp4/.mkv/.mov) or provide a pre-signed mezzanine stream URL.`
        };
        db.upsertReference(updatedRef);
        return res.status(422).json({
          error: `Partner API credential ${requiredEnv} is not configured. Please upload an authorized reference master file (.mp4/.mkv/.mov) or provide a pre-signed mezzanine stream URL.`,
          requiresCredentials: requiredEnv,
          acquisitionStatus: 'AWAITING_PROVIDER_CREDENTIALS',
          data: db.getReferenceById(existing.id)
        });
      }
      return res.status(400).json({
        error: 'Please provide an authorized mezzanine stream URL or upload a reference master video file.'
      });
    } else {
      return res.status(400).json({
        error: 'Please upload an authorized reference master file (file), submit a reference webpage URL (referenceWebpageUrl), or provide a decodable mezzanine stream URL (authorizedMediaUrl).'
      });
    }

    const probe = preProbed || (await FingerprintEngine.probeVideo(mediaTarget!));
    const samplingPlan = FingerprintEngine.calculateSamplingPlan(probe.duration_sec, sampleInterval);

    // If existing reference already has indexed fingerprints at the same interval with missing JPEGs,
    // repair missing JPEGs in-place at recorded timestamps first so existing frame IDs, timestamps, and fingerprints are preserved!
    const intervalMatchesExisting = Math.abs((existing.sample_interval_sec || 2) - samplingPlan.intervalSec) < 0.01;
    let reusableExistingFps: FrameFingerprint[] = [];
    if (existingFps.length > 0 && intervalMatchesExisting && filePath && fs.existsSync(filePath)) {
      try {
        await FingerprintEngine.extractVideoFingerprints(mediaTarget!, {
          referenceId: `${existing.id}_attach_probe`,
          thumbnailsDir: db.getThumbnailsDir(),
          intervalSec: Math.max(samplingPlan.intervalSec, Math.max(2, Math.floor(probe.duration_sec / 4))),
          maxFrames: 4,
          durationSec: probe.duration_sec,
          generateThumbnails: false,
          title: existing.title,
          isCandidate: false
        });
        db.upsertReference({
          ...existing,
          file_path: filePath,
          last_acquisition_at: now
        });
        const repairAudit = db.auditAndRepairReferenceFrameImages(existing.id)[0];
        const repairedFps = db.getReferenceFingerprints(existing.id, true);
        if (
          repairAudit &&
          repairAudit.missing_frame_image_count === 0 &&
          repairedFps.length >= samplingPlan.expectedFrameCount
        ) {
          const syncedRef =
            db.syncReferenceExtractionCompleteness(existing.id, {
              sampleIntervalSec: samplingPlan.intervalSec,
              durationSec: probe.duration_sec,
              extractionError: null
            }) || db.getReferenceById(existing.id)!;
          const repairedWorkflow = FingerprintEngine.buildAcquisitionWorkflowReport({
            inspection: acquiredInspectionResult,
            localFileUpload: Boolean(req.file),
            submittedUrl: submittedUrlRaw ? String(submittedUrlRaw).trim() : existing.source_url,
            mediaAcquired: true,
            mediaValidated: true,
            probe,
            extractedFrames: repairedFps.length,
            expectedFrames: samplingPlan.expectedFrameCount,
            verifiedImages: repairedFps.length,
            isComplete: true,
            resumedFromBytes: acquiredResumedFromBytes
          });
          return res.status(200).json({
            success: true,
            repairedInPlace: true,
            audit: repairAudit,
            inspection: acquiredInspectionResult,
            workflow: repairedWorkflow,
            message: `Missing frame JPEGs regenerated in-place from original source video (${repairedFps.length}/${samplingPlan.expectedFrameCount} verified JPEGs). Existing frame IDs, timestamps, and fingerprints preserved.`,
            data: { ...syncedRef, fingerprints: repairedFps },
            fingerprintsExtracted: repairedFps.length,
            expectedFrameCount: syncedRef.expected_frame_count,
            extractionStatus: syncedRef.extraction_status
          });
        }
        reusableExistingFps = db.getReferenceFingerprints(existing.id).filter(f => f.image_available);
      } catch (probeErr: any) {
        if (probeErr?.code === 'INVALID_TEST_PATTERN_SOURCE') {
          if (filePath && filePath !== existing.file_path && filePath.includes('url_ref_') && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch {}
          }
          const savedPreserved = db.getReferenceById(existing.id);
          return res.status(422).json({
            error: probeErr.message,
            acquisitionStatus: 'INVALID_TEST_PATTERN_REJECTED',
            data: savedPreserved ? { ...savedPreserved, fingerprints: existingFps } : null
          });
        }
      }
    }

    let extractedFrames;
    try {
      extractedFrames = await FingerprintEngine.extractVideoFingerprints(mediaTarget!, {
        referenceId: existing.id,
        thumbnailsDir: db.getThumbnailsDir(),
        intervalSec: samplingPlan.intervalSec,
        durationSec: probe.duration_sec,
        generateThumbnails: true,
        title: existing.title,
        isCandidate: false,
        existingFrames: reusableExistingFps.length > 0 ? reusableExistingFps : undefined
      });
    } catch (extractErr: any) {
      // If downloaded file was created specifically for this attempt and failed frame extraction, clean up file and preserve existing record
      if (filePath && filePath !== existing.file_path && filePath.includes('url_ref_') && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
      if (extractErr?.code === 'INVALID_TEST_PATTERN_SOURCE' && req.file) {
        if (existingFps.length > 0 && (existing.status === 'FINGERPRINTED' || existing.status === 'REGISTERED' || existing.status === 'PROCESSING')) {
          const savedPreserved = db.getReferenceById(existing.id);
          return res.status(422).json({
            error: extractErr.message,
            acquisitionStatus: 'INVALID_TEST_PATTERN_REJECTED',
            data: savedPreserved ? { ...savedPreserved, fingerprints: existingFps } : null
          });
        }
        const invalidPreserved: ReferenceItem = {
          ...existing,
          source_type: existing.source_type === 'FORENSIC_SAMPLE' ? 'UPLOAD' : existing.source_type,
          status: 'INVALID',
          thumbnail_url: undefined,
          first_thumbnail: undefined,
          fingerprint_count: 0,
          notes: extractErr.message
        };
        db.upsertReference(invalidPreserved);
        const invalidRef = db.getReferenceById(req.params.id);
        return res.status(422).json({
          error: extractErr.message,
          acquisitionStatus: 'INVALID_TEST_PATTERN_REJECTED',
          data: invalidRef ? { ...invalidRef, fingerprints: [] } : null
        });
      }
      const preservedStatus: ReferenceItem['status'] =
        existingFps.length > 0 && (existing.status === 'FINGERPRINTED' || existing.status === 'REGISTERED' || existing.status === 'PROCESSING')
          ? existing.status
          : existing.status === 'METADATA_REGISTERED'
          ? 'METADATA_REGISTERED'
          : 'AWAITING_AUTHORIZED_MEDIA';
      const failNote = extractErr?.message || 'Frame extraction failed for acquired media.';
      const preservedOnExtractFail: ReferenceItem = {
        ...existing,
        source_type: existing.source_type === 'FORENSIC_SAMPLE' ? (req.file ? 'UPLOAD' : 'OTT_PAGE') : existing.source_type,
        source_url: existing.source_url || (submittedUrlRaw ? String(submittedUrlRaw).trim() : undefined),
        final_url: finalUrl,
        media_url: resolvedMediaUrl,
        platform: updatedPlatform,
        season_episode_info: updatedSeasonEpisode,
        acquisition_status: 'FRAME_EXTRACTION_FAILED',
        authorization_provenance: authorizationProvenance,
        last_acquisition_at: now,
        acquisition_error: failNote,
        status: preservedStatus,
        notes: `Frame extraction failed [${ failNote }]. Existing reference record preserved.`
      };
      db.upsertReference(preservedOnExtractFail);
      const savedAfterFail = db.getReferenceById(existing.id);
      return res.status(422).json({
        error: failNote,
        acquisitionStatus: 'FRAME_EXTRACTION_FAILED',
        data: savedAfterFail ? { ...savedAfterFail, fingerprints: existingFps } : null
      });
    }

    const preservedSourceUrl =
      existing.source_url ||
      (req.body?.sourceUrl ? String(req.body.sourceUrl).trim() : undefined) ||
      (req.body?.referenceWebpageUrl ? String(req.body.referenceWebpageUrl).trim() : undefined) ||
      (submittedUrlRaw ? String(submittedUrlRaw).trim() : undefined);

    const updatedSourceType: ReferenceItem['source_type'] = req.file
      ? preservedSourceUrl
        ? 'OTT_PAGE'
        : 'UPLOAD'
      : existing.source_type === 'FORENSIC_SAMPLE'
      ? preservedSourceUrl
        ? 'OTT_PAGE'
        : 'DIRECT_URL'
      : existing.source_type;

    const updatedItem: ReferenceItem = {
      ...existing,
      source_type: updatedSourceType,
      duration_sec: probe.duration_sec,
      resolution: `${probe.width}x${probe.height}`,
      fps: probe.fps,
      codec: probe.codec,
      source_url: preservedSourceUrl,
      final_url: finalUrl || preservedSourceUrl,
      media_url: resolvedMediaUrl || (req.file ? undefined : mediaTarget),
      platform: updatedPlatform || acquiredInspectionResult?.platform || existing.platform,
      season_episode_info: updatedSeasonEpisode || acquiredInspectionResult?.seasonEpisodeInfo || existing.season_episode_info,
      provider_integration_status: req.file ? 'AUTHORIZED_MASTER_ATTACHED' : 'AUTHORIZED_URL_MEDIA_INGESTED',
      acquisition_status: acquisitionStatus,
      authorization_provenance: authorizationProvenance,
      last_acquisition_at: now,
      acquisition_error: undefined,
      file_path: filePath,
      status: 'PROCESSING',
      provenance_sha256: provenanceHash,
      fingerprint_count: extractedFrames.length,
      sample_interval_sec: samplingPlan.intervalSec,
      expected_frame_count: samplingPlan.expectedFrameCount,
      extracted_frame_count: extractedFrames.length,
      notes: updatedNotes
        ? String(updatedNotes).trim()
        : `Authorized reference media attached and verified for ${updatedPlatform || existing.title}${updatedSeasonEpisode ? ` (${updatedSeasonEpisode})` : ''}. Decoded ${extractedFrames.length} of ${samplingPlan.expectedFrameCount} genuine keyframes across entire ${probe.duration_sec.toFixed(2)}s duration.`
    };

    const persisted = db.persistAndVerifyReferenceExtraction({
      reference: updatedItem,
      extractedFrames,
      sampleIntervalSec: samplingPlan.intervalSec,
      durationSec: probe.duration_sec,
      sourceVideoPath: filePath || (mediaTarget && fs.existsSync(mediaTarget) ? mediaTarget : undefined),
      replaceExistingFingerprints: reusableExistingFps.length === 0
    });

    // Re-evaluate any previously discovered candidates linked to this reference now that reference fingerprints exist
    const linkedCandidates = db.getCandidates({ referenceId: existing.id });
    for (const cand of linkedCandidates) {
      try {
        await VerifierEngine.verifyCandidate(cand.id, { targetReferenceId: existing.id });
      } catch {}
    }

    const completedWorkflow = FingerprintEngine.buildAcquisitionWorkflowReport({
      inspection: acquiredInspectionResult,
      localFileUpload: Boolean(req.file),
      submittedUrl: preservedSourceUrl,
      mediaAcquired: true,
      mediaValidated: true,
      probe,
      extractedFrames: persisted.fingerprints.length,
      expectedFrames: persisted.reference.expected_frame_count ?? samplingPlan.expectedFrameCount,
      verifiedImages: persisted.reference.retrievable_frame_image_count ?? persisted.fingerprints.length,
      isComplete: persisted.isComplete,
      resumedFromBytes: acquiredResumedFromBytes,
      attemptedMethods: acquiredInspectionResult?.attemptedMethods
    });

    return res.status(200).json({
      success: true,
      mediaAcquired: true,
      resumedFromBytes: acquiredResumedFromBytes,
      inspection: acquiredInspectionResult,
      attemptedMethods: acquiredInspectionResult?.attemptedMethods || [],
      workflow: completedWorkflow,
      message: persisted.isComplete
        ? `Authorized reference media decoded (${persisted.fingerprints.length} keyframes). Status transitioned to FINGERPRINTED.`
        : `Authorized reference media partially processed (${persisted.fingerprints.length}/${persisted.reference.expected_frame_count} keyframes). Status is ${persisted.reference.status}.`,
      data: { ...persisted.reference, fingerprints: persisted.fingerprints },
      fingerprintsExtracted: persisted.fingerprints.length,
      expectedFrameCount: persisted.reference.expected_frame_count,
      extractionStatus: persisted.reference.extraction_status
    });
  } catch (err: any) {
    console.warn('[Attach Reference Media Notice]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to attach authorized reference media' });
  }
}

router.post('/references/:id/attach-media', handleUpload, handleAttachOrAcquireReferenceMedia);
router.post('/references/:id/acquire-media', handleUpload, handleAttachOrAcquireReferenceMedia);


/**
 * Update metadata or transition status between METADATA_REGISTERED and AWAITING_AUTHORIZED_MEDIA.
 * Strictly forbids marking a reference as FINGERPRINTED or REGISTERED without valid extracted fingerprints.
 */
router.post('/references/:id/transition-status', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const existing = db.getReferenceById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: `Reference ${req.params.id} not found` });
    }

    const { status, platform, seasonEpisodeInfo, title, rightsHolder, notes } = req.body || {};
    const existingFps = db.getReferenceFingerprints(existing.id);

    if ((status === 'FINGERPRINTED' || status === 'REGISTERED') && existingFps.length === 0) {
      return res.status(400).json({
        error: 'Compliance violation prevented: Cannot mark a metadata-only reference as FINGERPRINTED without genuine decoded video keyframes.'
      });
    }

    const allowedMetadataStatuses = ['METADATA_REGISTERED', 'AWAITING_AUTHORIZED_MEDIA'];
    const nextStatus = status && allowedMetadataStatuses.includes(status) ? status : existing.status;

    const updated: ReferenceItem = {
      ...existing,
      title: title ? String(title).trim() : existing.title,
      rights_holder: rightsHolder ? String(rightsHolder).trim() : existing.rights_holder,
      platform: platform !== undefined ? String(platform).trim() : existing.platform,
      season_episode_info: seasonEpisodeInfo !== undefined ? String(seasonEpisodeInfo).trim() : existing.season_episode_info,
      status: nextStatus,
      notes: notes !== undefined ? String(notes).trim() : existing.notes
    };

    db.upsertReference(updated);
    const saved = db.getReferenceById(existing.id);
    return res.json({
      success: true,
      data: saved ? { ...saved, fingerprints: existingFps } : null
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update reference status' });
  }
});

router.delete('/references/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const success = db.deleteReference(req.params.id);
    return res.json({ success });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete reference' });
  }
});

// -------------------------------------------------------------
// Candidate Discovery (Stage B) & Persistent Discovery Sources
// -------------------------------------------------------------
router.get('/discovery/sources', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const sources = db.getDiscoverySources();
    return res.json({ success: true, data: sources });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve discovery sources' });
  }
});

router.post('/discovery/sources', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { id, name, url, source_type, enabled } = req.body || {};
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return res.status(400).json({ error: 'Valid http/https URL is required' });
    }
    const domainName = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return url;
      }
    })();
    const record = db.upsertDiscoverySource({
      id,
      name: name ? String(name).trim() : `${domainName} Discovery Source`,
      url: String(url).trim(),
      source_type: source_type || 'configured_website',
      enabled: enabled !== undefined ? Boolean(enabled) : true
    });
    return res.status(201).json({ success: true, data: record });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to register discovery source' });
  }
});

router.patch('/discovery/sources/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled boolean is required' });
    }
    const updated = db.toggleDiscoverySource(req.params.id, enabled);
    if (!updated) {
      return res.status(404).json({ error: 'Discovery source not found' });
    }
    return res.json({ success: true, data: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update discovery source' });
  }
});

router.post('/discovery/sources/:id/scan', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { target_reference_id, query_keywords, auto_verify } = req.body || {};
    const result = await DiscoveryEngine.scanConfiguredSource(req.params.id, {
      targetReferenceId: target_reference_id,
      queryKeywords: query_keywords,
      autoVerify: auto_verify !== false
    });
    return res.json({
      success: true,
      data: result
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to scan discovery source' });
  }
});

router.get('/discovery/config', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const title = req.query.title ? String(req.query.title) : '';
    const seasonEpisodeInfo = req.query.seasonEpisodeInfo ? String(req.query.seasonEpisodeInfo) : undefined;
    const assetType = req.query.assetType ? String(req.query.assetType) : undefined;
    const previewCombinations = title
      ? DiscoveryEngine.generateKeywordCombinations({ title, seasonEpisodeInfo, assetType })
      : [];

    return res.json({
      success: true,
      data: {
        defaultSeedSources: SuspectedPiracyAdapter.DEFAULT_SEED_SOURCES,
        configuredSeedSources: SuspectedPiracyAdapter.getConfiguredSeedSources(),
        discoverySources: db.getDiscoverySources(),
        standardKeywordVariations: DiscoveryEngine.STANDARD_KEYWORD_VARIATIONS,
        lastSeedProbes: SuspectedPiracyAdapter.getLastSeedProbeResults(),
        previewCombinations
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve discovery configuration' });
  }
});

router.post('/discovery/seeds/probe', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { seed_sources } = req.body || {};
    if (Array.isArray(seed_sources)) {
      SuspectedPiracyAdapter.setCustomSeedSources(seed_sources);
    }
    const configured = SuspectedPiracyAdapter.getConfiguredSeedSources();
    const probes = await Promise.all(
      configured.map(seed => SuspectedPiracyAdapter.probeSeedSource(seed, 4500))
    );
    const sanitized = probes.map(({ html: _h, ...rest }) => rest);
    return res.json({
      success: true,
      data: {
        configuredSeedSources: configured,
        seedProbes: sanitized,
        discoverySources: db.getDiscoverySources()
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to probe discovery seed sources' });
  }
});

router.get('/discovery/coverage', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const referenceId = req.query.referenceId ? String(req.query.referenceId) : undefined;
    const jobId = req.query.jobId ? String(req.query.jobId) : undefined;
    const presetMode = req.query.presetMode ? (String(req.query.presetMode) as DiscoveryPresetMode) : undefined;
    const maxUniqueCandidates = req.query.maxUniqueCandidates ? Number(req.query.maxUniqueCandidates) : undefined;
    const deepResearchLimit = req.query.deepResearchLimit ? Number(req.query.deepResearchLimit) : undefined;
    const forensicComparisonLimit = req.query.forensicComparisonLimit ? Number(req.query.forensicComparisonLimit) : undefined;

    const limitsOverride =
      presetMode !== undefined ||
      maxUniqueCandidates !== undefined ||
      deepResearchLimit !== undefined ||
      forensicComparisonLimit !== undefined
        ? SearchCoverageEngine.resolveDiscoveryLimits({
            presetMode,
            maxUniqueCandidates,
            deepResearchLimit,
            forensicComparisonLimit
          })
        : undefined;

    const report = SearchCoverageEngine.generateCoverageReport({
      referenceId,
      jobId,
      limitsOverride
    });
    return res.json({ success: true, data: report });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to compute search coverage report' });
  }
});

router.patch('/discovery/ecosystems/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled boolean is required' });
    }
    SearchCoverageEngine.setEcosystemOrAdapterEnabled(req.params.id, enabled);
    const report = SearchCoverageEngine.generateCoverageReport({
      referenceId: req.body?.referenceId ? String(req.body.referenceId) : undefined
    });
    return res.json({ success: true, data: report });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to toggle discovery ecosystem' });
  }
});

router.get('/discovery/jobs', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const jobs = db.getDiscoveryJobs();
    return res.json({ success: true, data: jobs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve discovery jobs' });
  }
});

router.post('/discovery/jobs', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const {
      job_name,
      provider,
      target_reference_id,
      query_keywords,
      filter_domain,
      preset_mode,
      max_candidates,
      max_unique_candidates,
      deep_research_limit,
      forensic_comparison_limit,
      auto_verify,
      keyword_variations,
      seed_sources
    } = req.body || {};
    if (!job_name || !provider || !query_keywords) {
      return res.status(400).json({
        error: 'Job name, provider, and search keywords are required'
      });
    }

    const parsedMax =
      max_unique_candidates !== undefined
        ? parseInt(String(max_unique_candidates), 10)
        : max_candidates !== undefined
        ? parseInt(String(max_candidates), 10)
        : undefined;

    const job = await DiscoveryEngine.executeDiscoverySweep({
      jobName: job_name,
      provider,
      targetReferenceId: target_reference_id,
      queryKeywords: query_keywords,
      filterDomain: filter_domain,
      presetMode: preset_mode,
      maxCandidates: parsedMax,
      maxUniqueCandidates: parsedMax,
      deepResearchLimit: deep_research_limit !== undefined ? parseInt(String(deep_research_limit), 10) : undefined,
      forensicComparisonLimit:
        forensic_comparison_limit !== undefined ? parseInt(String(forensic_comparison_limit), 10) : undefined,
      autoVerify: auto_verify !== false,
      keywordVariations: Array.isArray(keyword_variations) ? keyword_variations : undefined,
      seedSources: Array.isArray(seed_sources) ? seed_sources : undefined
    });

    return res.json({ success: true, data: job });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to launch discovery sweep' });
  }
});

async function handleExpandInvestigation(req: Request, res: Response) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const jobId = req.params.id || req.body?.job_id || req.body?.jobId;
    const referenceId = req.body?.reference_id || req.body?.referenceId;
    const presetMode = req.body?.preset_mode || req.body?.presetMode;
    const maxUniqueCandidates =
      req.body?.max_unique_candidates ?? req.body?.maxUniqueCandidates ?? req.body?.max_candidates;
    const deepResearchLimit = req.body?.deep_research_limit ?? req.body?.deepResearchLimit;
    const forensicComparisonLimit = req.body?.forensic_comparison_limit ?? req.body?.forensicComparisonLimit;
    const runAdditionalDiscovery = Boolean(req.body?.run_additional_discovery ?? req.body?.runAdditionalDiscovery);
    const autoVerify = req.body?.auto_verify !== false && req.body?.autoVerify !== false;

    const expanded = await DiscoveryEngine.expandInvestigation({
      jobId: jobId ? String(jobId) : undefined,
      referenceId: referenceId ? String(referenceId) : undefined,
      presetMode,
      maxUniqueCandidates: maxUniqueCandidates !== undefined ? Number(maxUniqueCandidates) : undefined,
      deepResearchLimit: deepResearchLimit !== undefined ? Number(deepResearchLimit) : undefined,
      forensicComparisonLimit: forensicComparisonLimit !== undefined ? Number(forensicComparisonLimit) : undefined,
      runAdditionalDiscovery,
      autoVerify
    });

    return res.json({
      success: true,
      data: expanded
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to expand investigation' });
  }
}

router.post('/discovery/jobs/:id/expand', handleExpandInvestigation);
router.post('/discovery/expand', handleExpandInvestigation);

// -------------------------------------------------------------
// Candidates Matrix & Verification (Stage C & D)
// -------------------------------------------------------------
router.get('/candidates', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { referenceId, status } = req.query as { referenceId?: string; status?: string };
    const candidates = db.getCandidates({ referenceId, status });
    return res.json({ success: true, data: candidates });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch candidates' });
  }
});

router.get('/candidates/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const cand = db.getCandidateById(req.params.id);
    if (!cand) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    const fingerprints = db.getCandidateFingerprints(cand.id);
    return res.json({ success: true, data: { ...cand, fingerprints } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve candidate details' });
  }
});

router.post('/candidates/verify/:id', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { target_reference_id } = req.body || {};
    const result = await VerifierEngine.verifyCandidate(req.params.id, {
      targetReferenceId: target_reference_id
    });
    db.updateCandidateVerification(req.params.id, {
      comparison_stage: 'COMPARED'
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Candidate verification failed' });
  }
});

router.post('/candidates/research-batch', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const {
      candidate_ids,
      candidateIds,
      reference_id,
      referenceId,
      deep_research_limit,
      deepResearchLimit,
      forensic_comparison_limit,
      forensicComparisonLimit,
      run_deep_research,
      runDeepResearch,
      run_forensic_comparison,
      runForensicComparison
    } = req.body || {};

    const ids = Array.isArray(candidate_ids)
      ? candidate_ids
      : Array.isArray(candidateIds)
      ? candidateIds
      : undefined;
    const refId = reference_id || referenceId;

    const result = await DiscoveryEngine.researchAndCompareCandidates({
      candidateIds: ids,
      referenceId: refId ? String(refId) : undefined,
      deepResearchLimit:
        deep_research_limit !== undefined || deepResearchLimit !== undefined
          ? Number(deep_research_limit ?? deepResearchLimit)
          : undefined,
      forensicComparisonLimit:
        forensic_comparison_limit !== undefined || forensicComparisonLimit !== undefined
          ? Number(forensic_comparison_limit ?? forensicComparisonLimit)
          : undefined,
      runDeepResearch: (run_deep_research ?? runDeepResearch) !== false,
      runForensicComparison: Boolean(run_forensic_comparison ?? runForensicComparison)
    });

    const coverageReport = SearchCoverageEngine.generateCoverageReport({
      referenceId: refId ? String(refId) : undefined
    });

    return res.json({
      success: true,
      data: {
        ...result,
        coverageReport
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Batch candidate research failed' });
  }
});

router.post('/candidates/quick-inspect', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { url, title, target_reference_id } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Source URL is required for inspection' });
    }

    const { normalizedUrl, domain } = DiscoveryEngine.normalizeUrl(url);
    const candId = `cand_adhoc_${Date.now()}`;

    const cand: CandidateItem = {
      id: candId,
      reference_id: target_reference_id || undefined,
      source_url: normalizedUrl,
      domain,
      discovered_title: title || `Ad-hoc candidate: ${domain}`,
      discovery_provider: 'SEARCH_CRAWLER',
      discovered_at: new Date().toISOString(),
      pipeline_status: 'DISCOVERED',
      reachability_code: 0,
      reachability_latency_ms: 0,
      media_type: normalizedUrl.includes('.m3u8') ? 'HLS_M3U8' : 'UNKNOWN',
      is_live_stream: normalizedUrl.includes('.m3u8'),
      verification_logs: '[Manual Inspection] Candidate entered via Quick Inspect console.'
    };

    db.upsertCandidate(cand);
    const result = await VerifierEngine.verifyCandidate(candId, {
      targetReferenceId: target_reference_id
    });

    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Quick inspection failed' });
  }
});

// -------------------------------------------------------------
// Digital Evidence & Forensics (Stage E)
// -------------------------------------------------------------
router.get('/evidence', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { referenceId, matchStatus } = req.query as { referenceId?: string; matchStatus?: string };
    const records = db.getEvidenceRecords({ referenceId, matchStatus });
    return res.json({ success: true, data: records });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch evidence records' });
  }
});

router.get('/evidence/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const record = db.getEvidenceById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Evidence record not found' });
    }
    return res.json({ success: true, data: record });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch evidence details' });
  }
});

router.post('/evidence/:id/review', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { decision, reviewed_by, notes } = req.body || {};
    if (!decision || !reviewed_by) {
      return res.status(400).json({
        error: 'Review decision and investigator name are required'
      });
    }

    let matchStatus: string | undefined;
    if (decision === 'CONFIRMED') matchStatus = 'CONFIRMED_INFRINGEMENT';
    if (decision === 'FALSE_POSITIVE') matchStatus = 'FALSE_POSITIVE';
    if (decision === 'AUTHORIZED_LICENSEE') matchStatus = 'AUTHORIZED_LICENSEE';

    db.updateEvidenceReview(req.params.id, decision, reviewed_by, notes || '', matchStatus);
    const updated = db.getEvidenceById(req.params.id);
    return res.json({ success: true, data: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to submit review decision' });
  }
});

router.post('/evidence/:id/takedown', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const evidence = db.getEvidenceById(req.params.id);
    if (!evidence) {
      return res.status(404).json({ error: 'Evidence record not found' });
    }

    const noticeText = VerifierEngine.generateTakedownNotice(evidence);
    db.updateEvidenceTakedown(evidence.id, noticeText);

    return res.json({ success: true, data: { notice: noticeText, evidenceId: evidence.id } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to generate takedown notice' });
  }
});

// -------------------------------------------------------------
// Optional Curated Forensic Test Suite (Strictly Optional & Labeled)
// -------------------------------------------------------------
router.post('/fixtures/load', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const result = loadOptionalForensicTestSuite();
    return res.json({ success: true, message: 'Optional forensic test suite loaded successfully', ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load test suite' });
  }
});

router.post('/fixtures/clear', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.body?.confirmDeleteUserReferences === true) {
      db.clearAll({ forceDeleteUserReferences: true });
      return res.json({ success: true, message: 'Full database reset completed' });
    }
    const report = db.purgeConfirmedSyntheticForensicSamples();
    return res.json({
      success: true,
      message: 'Synthetic forensic sample fixtures removed; user-registered references preserved',
      ...report
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to clear synthetic fixtures' });
  }
});

// Router-level error handler guarantee: Always returns { error: err.message }
router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(500).json({
    error: err.message || 'Internal API router exception'
  });
});

export default router;
