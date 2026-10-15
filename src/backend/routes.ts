/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Express API Router
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

// 1. CONFIGURE MULTER FOR 500MB FILE UPLOADS IN ./uploads/
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const safeName = `${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { 
    fileSize: 500 * 1024 * 1024, // 500MB payload limit
    fieldSize: 500 * 1024 * 1024
  }
});

// Resilient middleware to safely handle multipart file uploads or pass through JSON/urlencoded requests
// Catches Multer limits or parsing errors and guarantees strict JSON responses (Never HTML)
const handleUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  upload.any()(req, res, (err: any) => {
    res.setHeader('Content-Type', 'application/json');
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: 'File size exceeds maximum allowable limit of 500MB'
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message || 'Multipart file upload parsing error'
      });
    }

    // Populate req.file from req.files if any file was uploaded
    if (!req.file && Array.isArray(req.files) && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
};

// -------------------------------------------------------------
// System Statistics
// -------------------------------------------------------------
router.get('/stats', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const stats = db.getSystemStats();
    return res.json({ success: true, data: stats });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to compute system stats' });
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
    return res.status(500).json({ success: false, error: err.message || 'Failed to retrieve references' });
  }
});

router.get('/references/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const ref = db.getReferenceById(req.params.id);
    if (!ref) {
      return res.status(404).json({ success: false, error: 'Reference not found' });
    }
    const fingerprints = db.getReferenceFingerprints(ref.id);
    return res.json({ success: true, data: { ...ref, fingerprints } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to retrieve reference details' });
  }
});

/**
 * Robust Reference Content Registration Handler:
 * Strictly guarantees JSON output under all circumstances.
 * Supports direct file uploads (up to 500MB in ./uploads/) and direct media URLs.
 */
async function processReferenceRegistration(req: Request, res: Response) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { title, rights_holder, asset_type, source_url, notes, sample_interval_sec } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, error: 'Title is required for reference registration' });
    }
    if (!rights_holder || !String(rights_holder).trim()) {
      return res.status(400).json({ success: false, error: 'Rights holder is required for legal chain of custody' });
    }

    const intervalSec = parseFloat(sample_interval_sec) || 2.0;
    const refId = `ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    let filePath: string | undefined;
    let effectiveSourceUrl: string | undefined;
    let sourceType: 'UPLOAD' | 'DIRECT_URL' = 'UPLOAD';
    let provenanceHash = '';

    if (req.file) {
      // Multipart File Upload Mode
      filePath = req.file.path;
      sourceType = 'UPLOAD';
      try {
        const fileBuffer = fs.readFileSync(filePath);
        provenanceHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      } catch {
        provenanceHash = crypto.createHash('sha256').update(`${req.file.originalname}_${Date.now()}`).digest('hex');
      }
    } else if (source_url && String(source_url).trim()) {
      // Direct Stream URL Mode
      effectiveSourceUrl = String(source_url).trim();
      sourceType = 'DIRECT_URL';
      provenanceHash = crypto.createHash('sha256').update(effectiveSourceUrl).digest('hex');
    } else {
      return res.status(400).json({
        success: false,
        error: 'Either a video file (mediaFile) or a valid media source URL (source_url) must be provided'
      });
    }

    const mediaTarget = filePath || effectiveSourceUrl!;
    const probe = await FingerprintEngine.probeVideo(mediaTarget);

    const refItem: ReferenceItem = {
      id: refId,
      title: String(title).trim(),
      rights_holder: String(rights_holder).trim(),
      asset_type: asset_type || (sourceType === 'DIRECT_URL' ? 'LIVE_SPORTS' : 'VOD_FEATURE'),
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
      notes: notes ? String(notes) : undefined
    };

    db.insertReference(refItem);

    // Extract keyframes and generate 64-bit dHash perceptual hashes
    // Uses FFmpeg when available, with automatic pure-JS fallback across 5 sample timestamps (0s, 5s, 10s, 15s, 20s)
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
      success: false,
      error: err.message || 'Reference content registration and fingerprinting failed'
    });
  }
}

// Canonical endpoint: POST /api/references (Supports both multipart upload & JSON stream URL)
router.post('/references', handleUploadMiddleware, processReferenceRegistration);

// Endpoint aliases for backward compatibility
router.post('/references/upload', handleUploadMiddleware, processReferenceRegistration);
router.post('/references/url', handleUploadMiddleware, processReferenceRegistration);

router.delete('/references/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const success = db.deleteReference(req.params.id);
    return res.json({ success });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to delete reference' });
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
    return res.status(500).json({ success: false, error: err.message || 'Failed to retrieve discovery jobs' });
  }
});

router.post('/discovery/jobs', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { job_name, provider, target_reference_id, query_keywords, filter_domain, max_candidates, auto_verify } = req.body || {};
    if (!job_name || !provider || !query_keywords) {
      return res.status(400).json({
        success: false,
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
    return res.status(500).json({ success: false, error: err.message || 'Failed to launch discovery sweep' });
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
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch candidates' });
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
    return res.status(500).json({ success: false, error: err.message || 'Candidate verification failed' });
  }
});

router.post('/candidates/quick-inspect', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { url, title, target_reference_id } = req.body || {};
    if (!url) {
      return res.status(400).json({ success: false, error: 'Source URL is required for inspection' });
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
    return res.status(500).json({ success: false, error: err.message || 'Quick inspection failed' });
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
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch evidence records' });
  }
});

router.get('/evidence/:id', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const record = db.getEvidenceById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Evidence record not found' });
    }
    return res.json({ success: true, data: record });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to fetch evidence details' });
  }
});

router.post('/evidence/:id/review', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { decision, reviewed_by, notes } = req.body || {};
    if (!decision || !reviewed_by) {
      return res.status(400).json({
        success: false,
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
    return res.status(500).json({ success: false, error: err.message || 'Failed to submit review decision' });
  }
});

router.post('/evidence/:id/takedown', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const evidence = db.getEvidenceById(req.params.id);
    if (!evidence) {
      return res.status(404).json({ success: false, error: 'Evidence record not found' });
    }

    const noticeText = VerifierEngine.generateTakedownNotice(evidence);
    db.updateEvidenceTakedown(evidence.id, noticeText);

    return res.json({ success: true, data: { notice: noticeText, evidenceId: evidence.id } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to generate takedown notice' });
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
    return res.status(500).json({ success: false, error: err.message || 'Failed to load test suite' });
  }
});

router.post('/fixtures/clear', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    db.clearAll();
    return res.json({ success: true, message: 'Database reset to empty state' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to clear database' });
  }
});

// Router-level error handler guarantee: Always returns JSON
router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.setHeader('Content-Type', 'application/json');
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: err.message || 'Internal API router exception'
  });
});

export default router;
