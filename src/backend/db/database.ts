/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * SQLite Database Layer using native node:sqlite DatabaseSync
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { 
  ReferenceItem, 
  FrameFingerprint, 
  DiscoveryJob, 
  CandidateItem, 
  EvidenceRecord, 
  SystemStats 
} from '../types.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'argus.db');

export class ArgusDatabase {
  private db: DatabaseSync;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const mediaDir = path.join(DATA_DIR, 'media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    this.db = new DatabaseSync(DB_FILE);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS reference_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        rights_holder TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        duration_sec REAL NOT NULL,
        resolution TEXT NOT NULL,
        fps REAL NOT NULL,
        codec TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        file_path TEXT,
        thumbnail_url TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        provenance_sha256 TEXT NOT NULL,
        fingerprint_count INTEGER DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS reference_fingerprints (
        id TEXT PRIMARY KEY,
        reference_id TEXT NOT NULL,
        timestamp_sec REAL NOT NULL,
        frame_index INTEGER NOT NULL,
        phash_hex TEXT NOT NULL,
        avg_luminance REAL NOT NULL,
        thumbnail_data TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (reference_id) REFERENCES reference_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ref_fp_ref_id ON reference_fingerprints(reference_id);

      CREATE TABLE IF NOT EXISTS discovery_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_reference_id TEXT,
        provider TEXT NOT NULL,
        query_params TEXT NOT NULL,
        status TEXT NOT NULL,
        candidates_found INTEGER DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT,
        FOREIGN KEY (target_reference_id) REFERENCES reference_items(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        reference_id TEXT,
        source_url TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL,
        discovered_title TEXT NOT NULL,
        discovery_provider TEXT NOT NULL,
        source_category TEXT,
        asset_kind TEXT,
        discovered_at TEXT NOT NULL,
        pipeline_status TEXT NOT NULL,
        reachability_code INTEGER DEFAULT 0,
        reachability_latency_ms REAL DEFAULT 0,
        media_type TEXT NOT NULL,
        media_resolution TEXT,
        media_duration_sec REAL,
        is_live_stream INTEGER DEFAULT 0,
        drm_scheme TEXT,
        raw_headers_json TEXT,
        verification_logs TEXT,
        last_inspected_at TEXT,
        FOREIGN KEY (job_id) REFERENCES discovery_jobs(id) ON DELETE SET NULL,
        FOREIGN KEY (reference_id) REFERENCES reference_items(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_candidate_ref ON candidates(reference_id);
      CREATE INDEX IF NOT EXISTS idx_candidate_domain ON candidates(domain);

      CREATE TABLE IF NOT EXISTS candidate_fingerprints (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        timestamp_sec REAL NOT NULL,
        frame_index INTEGER NOT NULL,
        phash_hex TEXT NOT NULL,
        thumbnail_data TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_cand_fp_cand_id ON candidate_fingerprints(candidate_id);

      CREATE TABLE IF NOT EXISTS evidence_records (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        candidate_url TEXT NOT NULL,
        candidate_domain TEXT NOT NULL,
        reference_title TEXT NOT NULL,
        rights_holder TEXT NOT NULL,
        match_status TEXT NOT NULL,
        match_classification TEXT,
        confidence_score REAL NOT NULL,
        min_hamming_dist INTEGER NOT NULL,
        avg_hamming_dist REAL NOT NULL,
        matched_frames_count INTEGER NOT NULL,
        total_compared_frames INTEGER NOT NULL,
        temporal_offset_sec REAL NOT NULL,
        sample_pairs_json TEXT NOT NULL,
        audio_match_json TEXT,
        chain_of_custody_sha256 TEXT NOT NULL,
        reviewed_by TEXT,
        review_decision TEXT NOT NULL,
        review_notes TEXT,
        reviewed_at TEXT,
        takedown_generated_at TEXT,
        takedown_notice_text TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
        FOREIGN KEY (reference_id) REFERENCES reference_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_evidence_cand ON evidence_records(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_ref ON evidence_records(reference_id);
    `);

    // Safe schema migrations for existing databases
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN source_category TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN asset_kind TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN drm_scheme TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN match_classification TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN audio_match_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN media_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN canonical_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN platform TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN acquisition_status TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN frame_evidence TEXT`); } catch {}

    // Strictly purge any legacy synthetic SVG thumbnails or placeholder graphics from existing databases
    try {
      this.db.exec(`UPDATE reference_items SET thumbnail_url = NULL WHERE thumbnail_url LIKE 'data:image/svg%' OR thumbnail_url LIKE '%<svg%' OR thumbnail_url LIKE '%.svg'`);
      this.db.exec(`UPDATE reference_fingerprints SET thumbnail_data = NULL WHERE thumbnail_data LIKE 'data:image/svg%' OR thumbnail_data LIKE '%<svg%' OR thumbnail_data LIKE '%.svg'`);
      this.db.exec(`UPDATE candidate_fingerprints SET thumbnail_data = NULL WHERE thumbnail_data LIKE 'data:image/svg%' OR thumbnail_data LIKE '%<svg%' OR thumbnail_data LIKE '%.svg'`);
      
      const evRows = this.db.prepare(`SELECT id, sample_pairs_json FROM evidence_records`).all() as any[];
      for (const ev of evRows) {
        if (!ev.sample_pairs_json) continue;
        try {
          const pairs = JSON.parse(ev.sample_pairs_json);
          let modified = false;
          for (const p of pairs) {
            if (typeof p.reference_thumbnail === 'string' && (p.reference_thumbnail.startsWith('data:image/svg') || p.reference_thumbnail.includes('<svg') || p.reference_thumbnail.includes('Pitch Cam') || p.reference_thumbnail.includes('Center Circle') || p.reference_thumbnail.includes('Title Card'))) {
              p.reference_thumbnail = undefined;
              modified = true;
            }
            if (typeof p.candidate_thumbnail === 'string' && (p.candidate_thumbnail.startsWith('data:image/svg') || p.candidate_thumbnail.includes('<svg') || p.candidate_thumbnail.includes('Pitch Cam') || p.candidate_thumbnail.includes('Center Circle') || p.candidate_thumbnail.includes('Title Card'))) {
              p.candidate_thumbnail = undefined;
              modified = true;
            }
          }
          if (modified) {
            this.db.prepare(`UPDATE evidence_records SET sample_pairs_json = ? WHERE id = ?`).run(JSON.stringify(pairs), ev.id);
          }
        } catch {}
      }
    } catch (err: any) {
      console.warn('[DB Migration] SVG cleanup notice:', err.message);
    }
  }

  private sanitizeSamplePairs(raw: any[]): MatchedKeyframePair[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(p => {
      let refThumb = p.reference_thumbnail;
      let candThumb = p.candidate_thumbnail;
      if (typeof refThumb === 'string') {
        const lower = refThumb.toLowerCase();
        if (lower.startsWith('data:image/svg') || lower.includes('<svg') || lower.endsWith('.svg') || lower.includes('pitch cam') || lower.includes('center circle') || lower.includes('title card')) {
          refThumb = undefined;
        }
      }
      if (typeof candThumb === 'string') {
        const lower = candThumb.toLowerCase();
        if (lower.startsWith('data:image/svg') || lower.includes('<svg') || lower.endsWith('.svg') || lower.includes('pitch cam') || lower.includes('center circle') || lower.includes('title card')) {
          candThumb = undefined;
        }
      }
      return {
        ...p,
        reference_thumbnail: refThumb,
        candidate_thumbnail: candThumb
      };
    });
  }

  // --- Reference Items ---
  public insertReference(item: ReferenceItem): void {
    const stmt = this.db.prepare(`
      INSERT INTO reference_items (
        id, title, rights_holder, asset_type, duration_sec, resolution,
        fps, codec, source_type, source_url, file_path, thumbnail_url,
        created_at, status, provenance_sha256, fingerprint_count, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      item.id,
      item.title,
      item.rights_holder,
      item.asset_type,
      item.duration_sec,
      item.resolution,
      item.fps,
      item.codec,
      item.source_type,
      item.source_url || null,
      item.file_path || null,
      item.thumbnail_url || null,
      item.created_at,
      item.status,
      item.provenance_sha256,
      item.fingerprint_count,
      item.notes || null
    );
  }

  public updateReferenceFingerprintCount(id: string, count: number, thumbnailUrl?: string): void {
    if (thumbnailUrl) {
      const stmt = this.db.prepare(`
        UPDATE reference_items SET fingerprint_count = ?, status = 'REGISTERED', thumbnail_url = ? WHERE id = ?
      `);
      stmt.run(count, thumbnailUrl, id);
    } else {
      const stmt = this.db.prepare(`
        UPDATE reference_items SET fingerprint_count = ?, status = 'REGISTERED' WHERE id = ?
      `);
      stmt.run(count, id);
    }
  }

  public getReferences(): ReferenceItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM reference_items ORDER BY created_at DESC
    `);
    return stmt.all() as unknown as ReferenceItem[];
  }

  public getReferenceById(id: string): ReferenceItem | null {
    const stmt = this.db.prepare(`SELECT * FROM reference_items WHERE id = ?`);
    const row = stmt.get(id);
    return (row as unknown as ReferenceItem) || null;
  }

  public deleteReference(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM reference_items WHERE id = ?`);
    stmt.run(id);
    return true;
  }

  // --- Fingerprints ---
  public insertReferenceFingerprints(fps: FrameFingerprint[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO reference_fingerprints (
        id, reference_id, timestamp_sec, frame_index, phash_hex, avg_luminance, thumbnail_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const fp of fps) {
      stmt.run(
        fp.id,
        fp.reference_id!,
        fp.timestamp_sec,
        fp.frame_index,
        fp.phash_hex,
        fp.avg_luminance ?? 0,
        fp.thumbnail_data || null,
        fp.created_at
      );
    }
  }

  public getReferenceFingerprints(refId: string): FrameFingerprint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM reference_fingerprints WHERE reference_id = ? ORDER BY timestamp_sec ASC
    `);
    return stmt.all(refId) as unknown as FrameFingerprint[];
  }

  public insertCandidateFingerprints(fps: FrameFingerprint[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO candidate_fingerprints (
        id, candidate_id, timestamp_sec, frame_index, phash_hex, thumbnail_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const fp of fps) {
      stmt.run(
        fp.id,
        fp.candidate_id!,
        fp.timestamp_sec,
        fp.frame_index,
        fp.phash_hex,
        fp.thumbnail_data || null,
        fp.created_at
      );
    }
  }

  public getCandidateFingerprints(candId: string): FrameFingerprint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM candidate_fingerprints WHERE candidate_id = ? ORDER BY timestamp_sec ASC
    `);
    return stmt.all(candId) as unknown as FrameFingerprint[];
  }

  // --- Discovery Jobs ---
  public insertDiscoveryJob(job: DiscoveryJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO discovery_jobs (
        id, name, target_reference_id, provider, query_params, status, candidates_found, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.name,
      job.target_reference_id || null,
      job.provider,
      job.query_params,
      job.status,
      job.candidates_found,
      job.started_at
    );
  }

  public updateDiscoveryJob(id: string, updates: Partial<DiscoveryJob>): void {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.candidates_found !== undefined) {
      fields.push('candidates_found = ?');
      values.push(updates.candidates_found);
    }
    if (updates.completed_at !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completed_at);
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }

    if (fields.length === 0) return;
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE discovery_jobs SET ${fields.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);
  }

  public getDiscoveryJobs(): DiscoveryJob[] {
    const stmt = this.db.prepare(`SELECT * FROM discovery_jobs ORDER BY started_at DESC`);
    return stmt.all() as unknown as DiscoveryJob[];
  }

  // --- Candidates ---
  public upsertCandidate(cand: CandidateItem): boolean {
    const checkStmt = this.db.prepare(`SELECT id FROM candidates WHERE source_url = ?`);
    const existing = checkStmt.get(cand.source_url);
    if (existing) {
      return false; // deduplicated
    }

    const stmt = this.db.prepare(`
      INSERT INTO candidates (
        id, job_id, reference_id, source_url, domain, discovered_title,
        discovery_provider, source_category, asset_kind, discovered_at, pipeline_status, reachability_code,
        reachability_latency_ms, media_type, media_resolution, media_duration_sec,
        is_live_stream, drm_scheme, raw_headers_json, verification_logs, last_inspected_at,
        media_url, canonical_url, platform, acquisition_status, frame_evidence
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      cand.id,
      cand.job_id || null,
      cand.reference_id || null,
      cand.source_url,
      cand.domain,
      cand.discovered_title,
      cand.discovery_provider,
      cand.source_category || null,
      cand.asset_kind || null,
      cand.discovered_at,
      cand.pipeline_status,
      cand.reachability_code,
      cand.reachability_latency_ms,
      cand.media_type,
      cand.media_resolution || null,
      cand.media_duration_sec || null,
      cand.is_live_stream ? 1 : 0,
      cand.drm_scheme || null,
      cand.raw_headers_json || null,
      cand.verification_logs || null,
      cand.last_inspected_at || null,
      cand.media_url || null,
      cand.canonical_url || null,
      cand.platform || null,
      cand.acquisition_status || null,
      cand.frame_evidence || null
    );
    return true;
  }

  public updateCandidateVerification(
    id: string,
    updates: Partial<CandidateItem>
  ): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.pipeline_status !== undefined) {
      fields.push('pipeline_status = ?');
      values.push(updates.pipeline_status);
    }
    if (updates.reachability_code !== undefined) {
      fields.push('reachability_code = ?');
      values.push(updates.reachability_code);
    }
    if (updates.reachability_latency_ms !== undefined) {
      fields.push('reachability_latency_ms = ?');
      values.push(updates.reachability_latency_ms);
    }
    if (updates.media_type !== undefined) {
      fields.push('media_type = ?');
      values.push(updates.media_type);
    }
    if (updates.media_resolution !== undefined) {
      fields.push('media_resolution = ?');
      values.push(updates.media_resolution);
    }
    if (updates.media_duration_sec !== undefined) {
      fields.push('media_duration_sec = ?');
      values.push(updates.media_duration_sec);
    }
    if (updates.is_live_stream !== undefined) {
      fields.push('is_live_stream = ?');
      values.push(updates.is_live_stream ? 1 : 0);
    }
    if (updates.source_category !== undefined) {
      fields.push('source_category = ?');
      values.push(updates.source_category);
    }
    if (updates.asset_kind !== undefined) {
      fields.push('asset_kind = ?');
      values.push(updates.asset_kind);
    }
    if (updates.drm_scheme !== undefined) {
      fields.push('drm_scheme = ?');
      values.push(updates.drm_scheme);
    }
    if (updates.raw_headers_json !== undefined) {
      fields.push('raw_headers_json = ?');
      values.push(updates.raw_headers_json);
    }
    if (updates.verification_logs !== undefined) {
      fields.push('verification_logs = ?');
      values.push(updates.verification_logs);
    }
    if (updates.last_inspected_at !== undefined) {
      fields.push('last_inspected_at = ?');
      values.push(updates.last_inspected_at);
    }
    if (updates.media_url !== undefined) {
      fields.push('media_url = ?');
      values.push(updates.media_url);
    }
    if (updates.canonical_url !== undefined) {
      fields.push('canonical_url = ?');
      values.push(updates.canonical_url);
    }
    if (updates.platform !== undefined) {
      fields.push('platform = ?');
      values.push(updates.platform);
    }
    if (updates.acquisition_status !== undefined) {
      fields.push('acquisition_status = ?');
      values.push(updates.acquisition_status);
    }
    if (updates.frame_evidence !== undefined) {
      fields.push('frame_evidence = ?');
      values.push(updates.frame_evidence);
    }

    if (fields.length === 0) return;
    values.push(id);

    const stmt = this.db.prepare(`UPDATE candidates SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  public getCandidates(filter?: { referenceId?: string; status?: string }): CandidateItem[] {
    let sql = `SELECT * FROM candidates WHERE 1=1`;
    const params: string[] = [];
    if (filter?.referenceId) {
      sql += ` AND reference_id = ?`;
      params.push(filter.referenceId);
    }
    if (filter?.status) {
      sql += ` AND pipeline_status = ?`;
      params.push(filter.status);
    }
    sql += ` ORDER BY discovered_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = (params.length ? stmt.all(...params) : stmt.all()) as any[];
    return rows.map(r => ({
      ...r,
      is_live_stream: Boolean(r.is_live_stream)
    }));
  }

  public getCandidateById(id: string): CandidateItem | null {
    const stmt = this.db.prepare(`SELECT * FROM candidates WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      ...row,
      is_live_stream: Boolean(row.is_live_stream)
    };
  }

  // --- Evidence Records ---
  public insertEvidenceRecord(record: EvidenceRecord): void {
    // Delete existing evidence for same candidate to avoid duplicates upon re-verification
    const del = this.db.prepare(`DELETE FROM evidence_records WHERE candidate_id = ?`);
    del.run(record.candidate_id);

    const stmt = this.db.prepare(`
      INSERT INTO evidence_records (
        id, candidate_id, reference_id, candidate_url, candidate_domain,
        reference_title, rights_holder, match_status, match_classification, confidence_score,
        min_hamming_dist, avg_hamming_dist, matched_frames_count, total_compared_frames,
        temporal_offset_sec, sample_pairs_json, audio_match_json, chain_of_custody_sha256,
        reviewed_by, review_decision, review_notes, reviewed_at, takedown_generated_at,
        takedown_notice_text, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      record.id,
      record.candidate_id,
      record.reference_id,
      record.candidate_url,
      record.candidate_domain,
      record.reference_title,
      record.rights_holder,
      record.match_status,
      record.match_classification || null,
      record.confidence_score ?? 0,
      record.min_hamming_dist ?? 0,
      record.avg_hamming_dist ?? 0,
      record.matched_frames_count ?? 0,
      record.total_compared_frames ?? 0,
      record.temporal_offset_sec ?? (record as any).temporalOffsetSec ?? 0,
      JSON.stringify(record.sample_pairs ?? (record as any).samplePairs ?? []),
      record.audio_match ? JSON.stringify(record.audio_match) : ((record as any).audioMatch ? JSON.stringify((record as any).audioMatch) : null),
      record.chain_of_custody_sha256 || '',
      record.reviewed_by || null,
      record.review_decision || 'PENDING',
      record.review_notes || null,
      record.reviewed_at || null,
      record.takedown_generated_at || null,
      record.takedown_notice_text || null,
      record.created_at || new Date().toISOString()
    );
  }

  public updateEvidenceReview(
    id: string,
    decision: string,
    reviewedBy: string,
    notes: string,
    matchStatus?: string
  ): void {
    const now = new Date().toISOString();
    let sql = `
      UPDATE evidence_records 
      SET review_decision = ?, reviewed_by = ?, review_notes = ?, reviewed_at = ?
    `;
    const params: any[] = [decision, reviewedBy, notes, now];
    if (matchStatus) {
      sql += `, match_status = ?`;
      params.push(matchStatus);
    }
    sql += ` WHERE id = ?`;
    params.push(id);

    const stmt = this.db.prepare(sql);
    stmt.run(...params);
  }

  public updateEvidenceTakedown(id: string, noticeText: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE evidence_records
      SET takedown_notice_text = ?, takedown_generated_at = ?
      WHERE id = ?
    `);
    stmt.run(noticeText, now, id);
  }

  public getEvidenceRecords(filter?: { referenceId?: string; matchStatus?: string }): EvidenceRecord[] {
    let sql = `SELECT * FROM evidence_records WHERE 1=1`;
    const params: string[] = [];
    if (filter?.referenceId) {
      sql += ` AND reference_id = ?`;
      params.push(filter.referenceId);
    }
    if (filter?.matchStatus) {
      sql += ` AND match_status = ?`;
      params.push(filter.matchStatus);
    }
    sql += ` ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = (params.length ? stmt.all(...params) : stmt.all()) as any[];
    return rows.map(r => ({
      ...r,
      sample_pairs: this.sanitizeSamplePairs(JSON.parse(r.sample_pairs_json || '[]')),
      audio_match: r.audio_match_json ? JSON.parse(r.audio_match_json) : undefined
    }));
  }

  public getEvidenceById(id: string): EvidenceRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM evidence_records WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      ...row,
      sample_pairs: this.sanitizeSamplePairs(JSON.parse(row.sample_pairs_json || '[]')),
      audio_match: row.audio_match_json ? JSON.parse(row.audio_match_json) : undefined
    };
  }

  // --- Statistics Calculation ---
  public getSystemStats(): SystemStats {
    const totalRefRow = this.db.prepare(`SELECT COUNT(*) as count FROM reference_items`).get() as any;
    const activeJobsRow = this.db.prepare(`SELECT COUNT(*) as count FROM discovery_jobs WHERE status = 'RUNNING'`).get() as any;
    const totalCandRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates`).get() as any;
    const reachableRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates WHERE pipeline_status IN ('REACHABLE', 'MEDIA_DETECTED', 'ACQUIRED', 'ANALYZED')`).get() as any;
    const mediaDetectedRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates WHERE pipeline_status IN ('MEDIA_DETECTED', 'ACQUIRED', 'ANALYZED')`).get() as any;
    const analyzedRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates WHERE pipeline_status = 'ANALYZED'`).get() as any;
    const potentialMatchesRow = this.db.prepare(`SELECT COUNT(*) as count FROM evidence_records WHERE match_status IN ('POTENTIAL_MATCH', 'CONFIRMED_INFRINGEMENT')`).get() as any;
    const confirmedRow = this.db.prepare(`SELECT COUNT(*) as count FROM evidence_records WHERE review_decision = 'CONFIRMED' OR match_status = 'CONFIRMED_INFRINGEMENT'`).get() as any;
    const pendingReviewsRow = this.db.prepare(`SELECT COUNT(*) as count FROM evidence_records WHERE review_decision = 'PENDING' AND match_status = 'POTENTIAL_MATCH'`).get() as any;

    const assetRows = this.db.prepare(`SELECT asset_type, COUNT(*) as count FROM reference_items GROUP BY asset_type`).all() as any[];
    const assetBreakdown: Record<string, number> = {};
    for (const r of assetRows) {
      assetBreakdown[r.asset_type] = Number(r.count);
    }

    const providerRows = this.db.prepare(`SELECT discovery_provider, COUNT(*) as count FROM candidates GROUP BY discovery_provider`).all() as any[];
    const providerBreakdown: Record<string, number> = {};
    for (const r of providerRows) {
      providerBreakdown[r.discovery_provider] = Number(r.count);
    }

    return {
      total_references: Number(totalRefRow.count || 0),
      active_jobs: Number(activeJobsRow.count || 0),
      total_candidates: Number(totalCandRow.count || 0),
      reachable_candidates: Number(reachableRow.count || 0),
      media_detected_candidates: Number(mediaDetectedRow.count || 0),
      analyzed_candidates: Number(analyzedRow.count || 0),
      potential_matches: Number(potentialMatchesRow.count || 0),
      confirmed_infringements: Number(confirmedRow.count || 0),
      pending_reviews: Number(pendingReviewsRow.count || 0),
      asset_type_breakdown: assetBreakdown,
      provider_breakdown: providerBreakdown
    };
  }

  // --- Reset/Clear DB ---
  public clearAll(): void {
    this.db.exec(`
      DELETE FROM evidence_records;
      DELETE FROM candidate_fingerprints;
      DELETE FROM candidates;
      DELETE FROM discovery_jobs;
      DELETE FROM reference_fingerprints;
      DELETE FROM reference_items;
    `);
  }
}

// Singleton database instance
export const db = new ArgusDatabase();
