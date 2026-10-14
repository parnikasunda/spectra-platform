/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Express API Router
 */

import { Router, Request, Response } from 'express';
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

// Configure multer for file uploads
const uploadDir = path.resolve(process.cwd(), 'data', 'media', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// -------------------------------------------------------------
// System Statistics
// -------------------------------------------------------------
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = db.getSystemStats();
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Reference Content Registration (Stage A)
// -------------------------------------------------------------
router.get('/references', (_req: Request, res: Response) => {
  try {
    const refs = db.getReferences();
    res.json({ success: true, data: refs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/references/:id', (req: Request, res: Response) => {
  try {
    const ref = db.getReferenceById(req.params.id);
    if (!ref) {
      return res.status(404).json({ success: false, error: 'Reference not found' });
    }
    const fingerprints = db.getReferenceFingerprints(ref.id);
    res.json({ success: true, data: { ...ref, fingerprints } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/references/upload', upload.single('mediaFile'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No media file uploaded' });
    }

    const { title, rights_holder, asset_type, notes, sample_interval_sec } = req.body;
    if (!title || !rights_holder) {
      return res.status(400).json({ success: false, error: 'Title and rights holder are required' });
    }

    const filePath = req.file.path;
    const intervalSec = parseFloat(sample_interval_sec) || 2.0;

    // 1. Calculate file SHA-256 provenance hash
    const fileBuffer = fs.readFileSync(filePath);
    const provenanceHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 2. Probe media characteristics using FFmpeg
    const probe = await FingerprintEngine.probeVideo(filePath);

    const refId = `ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    const refItem: ReferenceItem = {
      id: refId,
      title: title.trim(),
      rights_holder: rights_holder.trim(),
      asset_type: asset_type || 'VOD_FEATURE',
      duration_sec: probe.duration_sec,
      resolution: `${probe.width}x${probe.height}`,
      fps: probe.fps,
      codec: probe.codec,
      source_type: 'UPLOAD',
      file_path: filePath,
      created_at: now,
      status: 'PROCESSING',
      provenance_sha256: provenanceHash,
      fingerprint_count: 0,
      notes: notes || undefined
    };

    db.insertReference(refItem);

    // 3. Extract frames & perceptual hashes via FFmpeg
    const extractedFrames = await FingerprintEngine.extractVideoFingerprints(filePath, {
      intervalSec,
      maxFrames: 60,
      generateThumbnails: true
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
      db.updateReferenceFingerprintCount(refId, fps.length);
    } else {
      db.updateReferenceFingerprintCount(refId, 0);
    }

    const createdRef = db.getReferenceById(refId);
    res.json({ success: true, data: createdRef, fingerprintsExtracted: fps.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/references/url', async (req: Request, res: Response) => {
  try {
    const { title, rights_holder, asset_type, source_url, notes, sample_interval_sec } = req.body;
    if (!title || !rights_holder || !source_url) {
      return res.status(400).json({ success: false, error: 'Title, rights holder, and source URL are required' });
    }

    const refId = `ref_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();
    const intervalSec = parseFloat(sample_interval_sec) || 2.0;

    const probe = await FingerprintEngine.probeVideo(source_url);
    const provenanceHash = crypto.createHash('sha256').update(source_url).digest('hex');

    const refItem: ReferenceItem = {
      id: refId,
      title: title.trim(),
      rights_holder: rights_holder.trim(),
      asset_type: asset_type || 'LIVE_SPORTS',
      duration_sec: probe.duration_sec,
      resolution: `${probe.width}x${probe.height}`,
      fps: probe.fps,
      codec: probe.codec,
      source_type: 'DIRECT_URL',
      source_url: source_url.trim(),
      created_at: now,
      status: 'PROCESSING',
      provenance_sha256: provenanceHash,
      fingerprint_count: 0,
      notes: notes || undefined
    };

    db.insertReference(refItem);

    // Extract frames from stream
    const extractedFrames = await FingerprintEngine.extractVideoFingerprints(source_url, {
      intervalSec,
      maxFrames: 30,
      generateThumbnails: true
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
      db.updateReferenceFingerprintCount(refId, fps.length);
    } else {
      db.updateReferenceFingerprintCount(refId, 0);
    }

    const createdRef = db.getReferenceById(refId);
    res.json({ success: true, data: createdRef, fingerprintsExtracted: fps.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/references/:id', (req: Request, res: Response) => {
  try {
    const success = db.deleteReference(req.params.id);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Candidate Discovery (Stage B)
// -------------------------------------------------------------
router.get('/discovery/jobs', (_req: Request, res: Response) => {
  try {
    const jobs = db.getDiscoveryJobs();
    res.json({ success: true, data: jobs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/discovery/jobs', async (req: Request, res: Response) => {
  try {
    const { job_name, provider, target_reference_id, query_keywords, filter_domain, max_candidates } = req.body;
    if (!job_name || !provider || !query_keywords) {
      return res.status(400).json({ success: false, error: 'Job name, provider, and search keywords are required' });
    }

    const job = await DiscoveryEngine.executeDiscoverySweep({
      jobName: job_name,
      provider,
      targetReferenceId: target_reference_id,
      queryKeywords: query_keywords,
      filterDomain: filter_domain,
      maxCandidates: max_candidates ? parseInt(max_candidates, 10) : 10
    });

    res.json({ success: true, data: job });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Candidates Matrix & Verification (Stage C & D)
// -------------------------------------------------------------
router.get('/candidates', (req: Request, res: Response) => {
  try {
    const { referenceId, status } = req.query as { referenceId?: string; status?: string };
    const candidates = db.getCandidates({ referenceId, status });
    res.json({ success: true, data: candidates });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/candidates/verify/:id', async (req: Request, res: Response) => {
  try {
    const { target_reference_id } = req.body;
    const result = await VerifierEngine.verifyCandidate(req.params.id, {
      targetReferenceId: target_reference_id
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/candidates/quick-inspect', async (req: Request, res: Response) => {
  try {
    const { url, title, target_reference_id } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
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

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Digital Evidence & Forensics (Stage E)
// -------------------------------------------------------------
router.get('/evidence', (req: Request, res: Response) => {
  try {
    const { referenceId, matchStatus } = req.query as { referenceId?: string; matchStatus?: string };
    const records = db.getEvidenceRecords({ referenceId, matchStatus });
    res.json({ success: true, data: records });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/evidence/:id', (req: Request, res: Response) => {
  try {
    const record = db.getEvidenceById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Evidence record not found' });
    }
    res.json({ success: true, data: record });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/evidence/:id/review', (req: Request, res: Response) => {
  try {
    const { decision, reviewed_by, notes } = req.body;
    if (!decision || !reviewed_by) {
      return res.status(400).json({ success: false, error: 'Review decision and reviewer name are required' });
    }

    let matchStatus: string | undefined;
    if (decision === 'CONFIRMED') matchStatus = 'CONFIRMED_INFRINGEMENT';
    if (decision === 'FALSE_POSITIVE') matchStatus = 'FALSE_POSITIVE';
    if (decision === 'AUTHORIZED_LICENSEE') matchStatus = 'AUTHORIZED_LICENSEE';

    db.updateEvidenceReview(req.params.id, decision, reviewed_by, notes || '', matchStatus);
    const updated = db.getEvidenceById(req.params.id);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/evidence/:id/takedown', (req: Request, res: Response) => {
  try {
    const evidence = db.getEvidenceById(req.params.id);
    if (!evidence) {
      return res.status(404).json({ success: false, error: 'Evidence record not found' });
    }

    const noticeText = VerifierEngine.generateTakedownNotice(evidence);
    db.updateEvidenceTakedown(evidence.id, noticeText);

    res.json({ success: true, data: { notice: noticeText, evidenceId: evidence.id } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Optional Curated Forensic Test Suite (Strictly Optional & Labeled)
// -------------------------------------------------------------
router.post('/fixtures/load', (_req: Request, res: Response) => {
  try {
    const result = loadOptionalForensicTestSuite();
    res.json({ success: true, message: 'Optional forensic test suite loaded successfully', ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/fixtures/clear', (_req: Request, res: Response) => {
  try {
    db.clearAll();
    res.json({ success: true, message: 'Database reset to empty state' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
