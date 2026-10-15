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
import { VerifierEngine } from './engine/verifier.js';
import { loadOptionalForensicTestSuite } from './engine/sampleData.js';
import { ReferenceItem, FrameFingerprint, CandidateItem } from './types.js';

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

  upload.single('file')(req, res, (err: any) => {
    if (err) {
      console.error('[Multer Error]', err);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: err.message || 'File upload failed' });
    }
    if (!req.file) {
      upload.any()(req, res, (err2: any) => {
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
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  title: string;
  rightsHolder: string;
  assetType: string;
  sampleInterval: number;
  auditNotes?: string;
  tempDir: string;
  receivedChunks: Set<number>;
  createdAt: number;
}

const activeUploadSessions = new Map<string, UploadSession>();

// Periodic session cleanup (sessions older than 2 hours)
setInterval(() => {
  const now = Date.now();
  for (const [uploadId, session] of activeUploadSessions.entries()) {
    if (now - session.createdAt > 2 * 60 * 60 * 1000) {
      try {
        if (fs.existsSync(session.tempDir)) {
          fs.rmSync(session.tempDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.warn(`Failed to clean up stale upload session ${uploadId}:`, e);
      }
      activeUploadSessions.delete(uploadId);
    }
  }
}, 30 * 60 * 1000);

// -------------------------------------------------------------
// Upload Configuration Endpoint (Stage A Configuration)
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
      sampleInterval, 
      auditNotes 
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

    const session: UploadSession = {
      uploadId,
      fileName,
      fileSize,
      totalChunks,
      chunkSize,
      title: String(title).trim(),
      rightsHolder: String(rightsHolder).trim(),
      assetType: assetType || 'VOD_FEATURE',
      sampleInterval: parseFloat(sampleInterval) || 2.0,
      auditNotes: auditNotes ? String(auditNotes) : undefined,
      tempDir,
      receivedChunks: new Set<number>(),
      createdAt: Date.now()
    };

    activeUploadSessions.set(uploadId, session);

    return res.json({
      success: true,
      uploadId,
      chunkSize,
      totalChunks,
      maxUploadSizeBytes: maxSizeBytes
    });
  } catch (err: any) {
    console.error('[Upload Init Error]', err);
    return res.status(500).json({ error: err.message || 'Failed to initialize upload session' });
  }
});

/**
 * 2. Upload Single Chunk (~5MB, safe for Cloud Run & all proxies)
 */
router.post('/uploads/chunk', chunkUpload.single('chunk'), (req: Request, res: Response) => {
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

    return res.json({
      success: true,
      uploadId,
      chunkIndex,
      receivedChunks: session.receivedChunks.size,
      totalChunks: session.totalChunks
    });
  } catch (err: any) {
    console.error('[Upload Chunk Error]', err);
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
      // Incomplete or corrupted assembly
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

    // Compute cryptographic SHA-256 provenance hash using streaming
    const provenanceHash = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(finalFilePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });

    const refId = `ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    // Probe media attributes
    const probe = await FingerprintEngine.probeVideo(finalFilePath);

    const refItem: ReferenceItem = {
      id: refId,
      title: session.title,
      rights_holder: session.rightsHolder,
      asset_type: (session.assetType as any) || 'VOD_FEATURE',
      duration_sec: probe.duration_sec,
      resolution: `${probe.width}x${probe.height}`,
      fps: probe.fps,
      codec: probe.codec,
      source_type: 'UPLOAD',
      file_path: finalFilePath,
      created_at: now,
      status: 'PROCESSING',
      provenance_sha256: provenanceHash,
      fingerprint_count: 0,
      notes: session.auditNotes
    };

    db.insertReference(refItem);

    // Extract keyframes and compute perceptual dHash fingerprints
    const extractedFrames = await FingerprintEngine.extractVideoFingerprints(finalFilePath, {
      intervalSec: session.sampleInterval,
      maxFrames: 30,
      generateThumbnails: true,
      title: session.title
    });

    const fps: FrameFingerprint[] = extractedFrames.map((f, idx) => ({
      id: `rfp_${refId}_${idx}`,
      reference_id: refId,
      timestamp_sec: f.timestamp_sec,
      frame_index: f.frame_index,
      phash_hex: f.phash_hex,
      avg_luminance: f.avg_luminance,
      thumbnail_data: f.thumbnail_data,
      created_at: now
    }));

    if (fps.length > 0) {
      db.insertReferenceFingerprints(fps);
      db.updateReferenceFingerprintCount(refId, fps.length, fps[0]?.thumbnail_data);
    } else {
      db.updateReferenceFingerprintCount(refId, 0);
    }

    // Clean up active session
    activeUploadSessions.delete(uploadId);

    const createdRef = db.getReferenceById(refId);
    return res.status(201).json({
      success: true,
      data: createdRef,
      fingerprintsExtracted: fps.length
    });
  } catch (err: any) {
    console.error('[Upload Complete Error]', err);
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
// Reference Content Registration (Stage A)
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
    const fingerprints = db.getReferenceFingerprints(ref.id);
    return res.json({ success: true, data: { ...ref, fingerprints } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve reference details' });
  }
});

/**
 * Direct / Stream URL Reference Registration Handler:
 * Strictly guarantees JSON output under all circumstances.
 * Accepts direct multipart form uploads ('file') or JSON stream URLs.
 */
async function handleRegisterReference(req: Request, res: Response) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const title = req.body?.title;
    const rightsHolder = req.body?.rightsHolder || req.body?.rights_holder;
    const assetType = req.body?.assetType || req.body?.asset_type;
    const auditNotes = req.body?.auditNotes || req.body?.notes;
    const sampleInterval = req.body?.sampleInterval || req.body?.sample_interval_sec;
    const sourceUrl = req.body?.sourceUrl || req.body?.source_url;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Title is required for reference registration' });
    }
    if (!rightsHolder || !String(rightsHolder).trim()) {
      return res.status(400).json({ error: 'Rights holder is required for legal chain of custody' });
    }

    const intervalSec = parseFloat(sampleInterval) || 2.0;
    const refId = `ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    let filePath: string | undefined;
    let effectiveSourceUrl: string | undefined;
    let sourceType: 'UPLOAD' | 'DIRECT_URL' = 'UPLOAD';
    let provenanceHash = '';

    if (req.file) {
      // Direct Multipart File Upload Mode
      filePath = path.resolve(process.cwd(), req.file.path);
      sourceType = 'UPLOAD';
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
      // Direct Stream URL Mode (HLS .m3u8, MP4 link, web video)
      effectiveSourceUrl = String(sourceUrl).trim();
      sourceType = 'DIRECT_URL';
      provenanceHash = crypto.createHash('sha256').update(effectiveSourceUrl).digest('hex');
    } else {
      return res.status(400).json({
        error: 'Either a video file (file) or a valid media source URL (sourceUrl / source_url) must be provided'
      });
    }

    const mediaTarget = filePath || effectiveSourceUrl!;
    const probe = await FingerprintEngine.probeVideo(mediaTarget);

    const refItem: ReferenceItem = {
      id: refId,
      title: String(title).trim(),
      rights_holder: String(rightsHolder).trim(),
      asset_type: assetType || (sourceType === 'DIRECT_URL' ? 'LIVE_SPORTS' : 'VOD_FEATURE'),
      duration_sec: probe.duration_sec,
      resolution: `${probe.width}x${probe.height}`,
      fps: probe.fps,
      codec: probe.codec,
      source_type: sourceType,
      source_url: effectiveSourceUrl,
      file_path: filePath,
      created_at: now,
      status: 'PROCESSING',
      provenance_sha256: provenanceHash,
      fingerprint_count: 0,
      notes: auditNotes ? String(auditNotes) : undefined
    };

    db.insertReference(refItem);

    // Extract keyframes and generate 64-bit dHash perceptual hashes
    const extractedFrames = await FingerprintEngine.extractVideoFingerprints(mediaTarget, {
      intervalSec,
      maxFrames: 30,
      generateThumbnails: true,
      title: String(title).trim()
    });

    const fps: FrameFingerprint[] = extractedFrames.map((f, idx) => ({
      id: `rfp_${refId}_${idx}`,
      reference_id: refId,
      timestamp_sec: f.timestamp_sec,
      frame_index: f.frame_index,
      phash_hex: f.phash_hex,
      avg_luminance: f.avg_luminance,
      thumbnail_data: f.thumbnail_data,
      created_at: now
    }));

    if (fps.length > 0) {
      db.insertReferenceFingerprints(fps);
      db.updateReferenceFingerprintCount(refId, fps.length, fps[0]?.thumbnail_data);
    } else {
      db.updateReferenceFingerprintCount(refId, 0);
    }

    const createdRef = db.getReferenceById(refId);
    return res.status(201).json({
      success: true,
      data: createdRef,
      fingerprintsExtracted: fps.length
    });
  } catch (err: any) {
    console.error('[Reference Registration Error]', err);
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
// Candidate Discovery (Stage B)
// -------------------------------------------------------------
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
    const { job_name, provider, target_reference_id, query_keywords, filter_domain, max_candidates, auto_verify } = req.body || {};
    if (!job_name || !provider || !query_keywords) {
      return res.status(400).json({
        error: 'Job name, provider, and search keywords are required'
      });
    }

    const job = await DiscoveryEngine.executeDiscoverySweep({
      jobName: job_name,
      provider,
      targetReferenceId: target_reference_id,
      queryKeywords: query_keywords,
      filterDomain: filter_domain,
      maxCandidates: max_candidates ? parseInt(max_candidates, 10) : 10,
      autoVerify: auto_verify !== false
    });

    return res.json({ success: true, data: job });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to launch discovery sweep' });
  }
});

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

router.post('/candidates/verify/:id', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { target_reference_id } = req.body || {};
    const result = await VerifierEngine.verifyCandidate(req.params.id, {
      targetReferenceId: target_reference_id
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Candidate verification failed' });
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

router.post('/fixtures/clear', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    db.clearAll();
    return res.json({ success: true, message: 'Database reset to empty state' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to clear database' });
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
