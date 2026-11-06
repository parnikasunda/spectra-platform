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
  SystemStats,
  MatchedKeyframePair,
  DiscoverySourceRecord,
  CandidateDiscoveryProvenance,
  CandidateResearchEvaluation,
  ImageAvailabilityStatus,
  ReferenceFrameAuditItem,
  SearchCoverageSnapshot,
  DiscoveryPresetMode
} from '../types.js';
import { CandidateResearchEngine } from '../engine/candidateResearch.js';
import { FingerprintEngine } from '../engine/fingerprint.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'argus.db');

export class ArgusDatabase {
  private db: DatabaseSync;
  private dbFilePath: string;
  private thumbnailsDir: string;

  constructor(customDbFile?: string) {
    const envDbPath =
      process.env.SPECTRA_DB_PATH ||
      process.env.ARGUS_DB_PATH ||
      process.env.TEST_DB_PATH;
    this.dbFilePath = customDbFile
      ? path.resolve(customDbFile)
      : envDbPath
      ? path.resolve(envDbPath)
      : DB_FILE;

    const targetDir = path.dirname(this.dbFilePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const mediaDir = path.join(DATA_DIR, 'media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }
    const defaultThumbnailsDir = path.join(DATA_DIR, 'thumbnails');
    if (!fs.existsSync(defaultThumbnailsDir)) {
      fs.mkdirSync(defaultThumbnailsDir, { recursive: true });
    }

    const envThumbDir =
      process.env.SPECTRA_THUMBNAILS_DIR ||
      process.env.ARGUS_THUMBNAILS_DIR ||
      process.env.TEST_THUMBNAILS_DIR;
    this.thumbnailsDir = envThumbDir
      ? path.resolve(envThumbDir)
      : targetDir !== DATA_DIR
      ? path.join(targetDir, 'thumbnails')
      : defaultThumbnailsDir;
    if (!fs.existsSync(this.thumbnailsDir)) {
      fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbFilePath);
    this.initSchema();
  }

  public getDbFilePath(): string {
    return this.dbFilePath;
  }

  public getThumbnailsDir(): string {
    return this.thumbnailsDir;
  }

  public close(): void {
    try {
      this.db.close();
    } catch {}
  }

  private initSchema() {
    try {
      this.db.exec(`PRAGMA busy_timeout = 5000;`);
      this.db.exec(`PRAGMA synchronous = FULL;`);
    } catch {}

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
        platform TEXT,
        season_episode_info TEXT,
        provider_integration_status TEXT,
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
        thumbnail_path TEXT,
        thumbnail_url TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (reference_id) REFERENCES reference_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ref_fp_ref_id ON reference_fingerprints(reference_id);

      CREATE TABLE IF NOT EXISTS discovery_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL DEFAULT 'configured_website',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_scan_at TEXT,
        last_scan_status TEXT DEFAULT 'IDLE',
        last_scan_outcome TEXT,
        pages_inspected INTEGER DEFAULT 0,
        inspected_urls_json TEXT,
        candidates_discovered INTEGER DEFAULT 0,
        direct_media_found INTEGER DEFAULT 0,
        duplicates_merged INTEGER DEFAULT 0,
        acquisitions_succeeded INTEGER DEFAULT 0,
        acquisitions_restricted INTEGER DEFAULT 0,
        frames_extracted INTEGER DEFAULT 0,
        fingerprinted_count INTEGER DEFAULT 0,
        failure_reasons_json TEXT,
        created_at TEXT NOT NULL
      );

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
        matched_content_id TEXT,
        source_type TEXT,
        match_method TEXT,
        discovery_provenance_json TEXT,
        source_url TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_candidate_source_url ON candidates(source_url);

      CREATE TABLE IF NOT EXISTS candidate_fingerprints (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        timestamp_sec REAL NOT NULL,
        frame_index INTEGER NOT NULL,
        phash_hex TEXT NOT NULL,
        avg_luminance REAL DEFAULT 0,
        thumbnail_data TEXT,
        thumbnail_path TEXT,
        thumbnail_url TEXT,
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
        candidate_platform TEXT,
        candidate_title TEXT,
        reference_title TEXT NOT NULL,
        rights_holder TEXT NOT NULL,
        match_status TEXT NOT NULL,
        match_classification TEXT,
        confidence_score REAL NOT NULL,
        visual_similarity_score REAL,
        metadata_relevance_score REAL,
        overall_assessment TEXT,
        metadata_signals_json TEXT,
        captured_frames_json TEXT,
        uncertainty_reasons_json TEXT,
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

      CREATE TABLE IF NOT EXISTS coverage_snapshots (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        reference_id TEXT,
        reference_title TEXT,
        preset_mode TEXT NOT NULL DEFAULT 'STANDARD',
        max_unique_candidates INTEGER NOT NULL DEFAULT 250,
        deep_research_limit INTEGER NOT NULL DEFAULT 200,
        forensic_comparison_limit INTEGER NOT NULL DEFAULT 100,
        overall_estimated_coverage_pct REAL NOT NULL DEFAULT 0,
        measured_source_inspection_pct REAL NOT NULL DEFAULT 0,
        candidate_research_coverage_pct REAL NOT NULL DEFAULT 0,
        forensic_comparison_coverage_pct REAL NOT NULL DEFAULT 0,
        sources_configured INTEGER NOT NULL DEFAULT 0,
        sources_checked INTEGER NOT NULL DEFAULT 0,
        queries_executed INTEGER NOT NULL DEFAULT 0,
        pages_discovered INTEGER NOT NULL DEFAULT 0,
        pages_inspected INTEGER NOT NULL DEFAULT 0,
        raw_discovered_count INTEGER NOT NULL DEFAULT 0,
        unique_candidates_count INTEGER NOT NULL DEFAULT 0,
        relevant_candidates_count INTEGER NOT NULL DEFAULT 0,
        researched_candidates_count INTEGER NOT NULL DEFAULT 0,
        awaiting_research_count INTEGER NOT NULL DEFAULT 0,
        queued_for_comparison_count INTEGER NOT NULL DEFAULT 0,
        compared_candidates_count INTEGER NOT NULL DEFAULT 0,
        rejected_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_coverage_snap_ref ON coverage_snapshots(reference_id);
      CREATE INDEX IF NOT EXISTS idx_coverage_snap_job ON coverage_snapshots(job_id);
    `);

    // Safe schema migrations for existing databases
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN platform TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN season_episode_info TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN provider_integration_status TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN final_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN media_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN acquisition_status TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN authorization_provenance TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN last_acquisition_at TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN acquisition_error TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN detected_player_provider TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN embedded_player_metadata_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN inspection_status TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN sample_interval_sec REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN expected_frame_count INTEGER`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN extracted_frame_count INTEGER`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN first_extracted_timestamp_sec REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN last_extracted_timestamp_sec REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN extraction_status TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN extraction_error TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_items ADD COLUMN extraction_progress_pct REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN source_category TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN asset_kind TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN drm_scheme TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN media_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN canonical_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN platform TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN acquisition_status TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN frame_evidence TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN thumbnail_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN visual_similarity_score REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN metadata_relevance_score REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN overall_assessment TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN original_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN final_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN final_domain TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN referring_page TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN matched_keywords TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN crawl_status TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN duplicate_count INTEGER DEFAULT 0`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN candidate_classification TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN matched_content_id TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN source_type TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN match_method TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN discovery_provenance_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN research_relevance_score REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN identity_relationship TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN detected_identity_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN research_stage TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidates ADD COLUMN comparison_stage TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN match_classification TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN audio_match_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN candidate_platform TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN candidate_title TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN visual_similarity_score REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN metadata_relevance_score REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN overall_assessment TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN metadata_signals_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN captured_frames_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN uncertainty_reasons_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN reference_duration_sec REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN candidate_duration_sec REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN total_reference_frames INTEGER`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN total_candidate_frames INTEGER`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN unique_reference_frames_matched INTEGER`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN unique_candidate_frames_matched INTEGER`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN reference_coverage_pct REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN candidate_coverage_pct REAL`); } catch {}
    try { this.db.exec(`ALTER TABLE evidence_records ADD COLUMN coverage_metrics_json TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_fingerprints ADD COLUMN thumbnail_path TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_fingerprints ADD COLUMN thumbnail_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_fingerprints ADD COLUMN vhash_hex TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE reference_fingerprints ADD COLUMN crop_phash_hex TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidate_fingerprints ADD COLUMN avg_luminance REAL DEFAULT 0`); } catch {}
    try { this.db.exec(`ALTER TABLE candidate_fingerprints ADD COLUMN thumbnail_path TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidate_fingerprints ADD COLUMN thumbnail_url TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidate_fingerprints ADD COLUMN vhash_hex TEXT`); } catch {}
    try { this.db.exec(`ALTER TABLE candidate_fingerprints ADD COLUMN crop_phash_hex TEXT`); } catch {}

    // Safely migrate legacy candidates table if source_url has a UNIQUE constraint so distinct video assets on the same webpage remain separate
    try {
      const tableMeta = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='candidates'`).get() as { sql?: string } | undefined;
      if (tableMeta?.sql && /source_url\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableMeta.sql)) {
        this.db.exec(`
          PRAGMA foreign_keys = OFF;
          BEGIN TRANSACTION;
          CREATE TABLE candidates_migrated (
            id TEXT PRIMARY KEY,
            job_id TEXT,
            reference_id TEXT,
            matched_content_id TEXT,
            source_type TEXT,
            match_method TEXT,
            discovery_provenance_json TEXT,
            source_url TEXT NOT NULL,
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
            media_url TEXT,
            canonical_url TEXT,
            platform TEXT,
            acquisition_status TEXT,
            frame_evidence TEXT,
            thumbnail_url TEXT,
            visual_similarity_score REAL,
            metadata_relevance_score REAL,
            overall_assessment TEXT,
            original_url TEXT,
            final_url TEXT,
            final_domain TEXT,
            referring_page TEXT,
            matched_keywords TEXT,
            crawl_status TEXT,
            duplicate_count INTEGER DEFAULT 0,
            candidate_classification TEXT,
            FOREIGN KEY (job_id) REFERENCES discovery_jobs(id) ON DELETE SET NULL,
            FOREIGN KEY (reference_id) REFERENCES reference_items(id) ON DELETE SET NULL
          );
          INSERT INTO candidates_migrated (
            id, job_id, reference_id, matched_content_id, source_type, match_method, discovery_provenance_json,
            source_url, domain, discovered_title, discovery_provider, source_category, asset_kind,
            discovered_at, pipeline_status, reachability_code, reachability_latency_ms, media_type,
            media_resolution, media_duration_sec, is_live_stream, drm_scheme, raw_headers_json,
            verification_logs, last_inspected_at, media_url, canonical_url, platform, acquisition_status,
            frame_evidence, thumbnail_url, visual_similarity_score, metadata_relevance_score,
            overall_assessment, original_url, final_url, final_domain, referring_page, matched_keywords,
            crawl_status, duplicate_count, candidate_classification
          )
          SELECT
            id, job_id, reference_id, matched_content_id, source_type, match_method, discovery_provenance_json,
            source_url, domain, discovered_title, discovery_provider, source_category, asset_kind,
            discovered_at, pipeline_status, reachability_code, reachability_latency_ms, media_type,
            media_resolution, media_duration_sec, is_live_stream, drm_scheme, raw_headers_json,
            verification_logs, last_inspected_at, media_url, canonical_url, platform, acquisition_status,
            frame_evidence, thumbnail_url, visual_similarity_score, metadata_relevance_score,
            overall_assessment, original_url, final_url, final_domain, referring_page, matched_keywords,
            crawl_status, duplicate_count, candidate_classification
          FROM candidates;
          DROP TABLE candidates;
          ALTER TABLE candidates_migrated RENAME TO candidates;
          CREATE INDEX IF NOT EXISTS idx_candidate_ref ON candidates(reference_id);
          CREATE INDEX IF NOT EXISTS idx_candidate_domain ON candidates(domain);
          CREATE INDEX IF NOT EXISTS idx_candidate_source_url ON candidates(source_url);
          COMMIT;
          PRAGMA foreign_keys = ON;
        `);
      }
    } catch (migErr: any) {
      try { this.db.exec(`ROLLBACK; PRAGMA foreign_keys = ON;`); } catch {}
      console.warn('[DB Migration] Candidates table constraint migration warning:', migErr.message);
    }

    // Seed persistent configurable discovery sources (including https://o2tvseries4u.com/)
    try {
      const nowIso = new Date().toISOString();
      const seedSourcesStmt = this.db.prepare(`
        INSERT OR IGNORE INTO discovery_sources (
          id, name, url, source_type, enabled, last_scan_status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'IDLE', ?)
      `);
      seedSourcesStmt.run('src_o2tvseries4u', 'O2TvSeries4u Episodic Index', 'https://o2tvseries4u.com/', 'configured_website', 1, nowIso);
      seedSourcesStmt.run('src_kickasstorrents', 'KickassTorrents Mirror Index', 'https://kickasstorrents.io/', 'configured_website', 1, nowIso);
      seedSourcesStmt.run('src_unblockit', 'UnblockIt Portal Directory', 'https://unblockit.li/', 'configured_website', 1, nowIso);
    } catch (seedErr: any) {
      console.warn('[DB Migration] Seed discovery_sources notice:', seedErr.message);
    }

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

      // Purge legacy lavfi testsrc / testsrc2 colour bars only on curated FORENSIC_SAMPLE fixtures; never invalidate user-registered references on startup
      const refRows = this.db.prepare(`SELECT id, source_type, source_url, file_path, status FROM reference_items`).all() as { id: string; source_type?: string; source_url?: string; file_path?: string; status: string }[];
      for (const ref of refRows) {
        if (ref.source_type === 'FORENSIC_SAMPLE' && ref.file_path && ref.file_path.includes('/uploads/')) {
          this.db.prepare(`UPDATE reference_items SET source_type = 'UPLOAD' WHERE id = ?`).run(ref.id);
          ref.source_type = 'UPLOAD';
        }
        if (ref.source_type === 'FORENSIC_SAMPLE') {
          const fps = this.db.prepare(`SELECT phash_hex FROM reference_fingerprints WHERE reference_id = ?`).all(ref.id) as { phash_hex: string }[];
          const hasTestPattern = fps.some(f => {
            const h = (f.phash_hex || '').toLowerCase();
            return h === '1818181818181818' || h.startsWith('2424666');
          });
          if (hasTestPattern) {
            this.db.prepare(`DELETE FROM reference_fingerprints WHERE reference_id = ?`).run(ref.id);
            this.db.prepare(`
              UPDATE reference_items
              SET status = 'INVALID',
                  thumbnail_url = NULL,
                  fingerprint_count = 0,
                  notes = 'INVALID SOURCE: Source file contains synthetic FFmpeg colour-bar test patterns (lavfi testsrc/testsrc2) rather than genuine reference video frames. Provide a valid source video to extract ground-truth keyframes.'
              WHERE id = ?
            `).run(ref.id);
          }
        } else if (ref.status === 'INVALID' && ref.source_url && !ref.file_path) {
          // Migrate OTT webpage references that were previously marked INVALID solely because their URL is a protected OTT player page
          const urlLower = ref.source_url.toLowerCase();
          let detectedPlatform: string | null = null;
          if (urlLower.includes('sonyliv.com')) detectedPlatform = 'SonyLIV';
          else if (urlLower.includes('hotstar.com')) detectedPlatform = 'Disney+ Hotstar';
          else if (urlLower.includes('netflix.com')) detectedPlatform = 'Netflix';
          else if (urlLower.includes('jiocinema.com')) detectedPlatform = 'JioCinema';
          else if (urlLower.includes('primevideo.com') || urlLower.includes('amazon.')) detectedPlatform = 'Amazon Prime Video';
          else if (urlLower.includes('disneyplus.com')) detectedPlatform = 'Disney+';
          else if (urlLower.includes('zee5.com')) detectedPlatform = 'ZEE5';
          else if (urlLower.includes('tv.apple.com')) detectedPlatform = 'Apple TV+';
          else if (urlLower.includes('hulu.com')) detectedPlatform = 'Hulu';
          else if (urlLower.includes('max.com')) detectedPlatform = 'Max';

          if (detectedPlatform) {
            this.db.prepare(`
              UPDATE reference_items
              SET status = 'AWAITING_AUTHORIZED_MEDIA',
                  source_type = 'OTT_PAGE',
                  platform = COALESCE(platform, ?),
                  provider_integration_status = 'AWAITING_AUTHORIZED_MEDIA',
                  fingerprint_count = 0,
                  thumbnail_url = NULL,
                  notes = ?
              WHERE id = ?
            `).run(
              detectedPlatform,
              `OTT reference metadata registered for ${detectedPlatform} (${ref.source_url}). Direct stream decoding is protected by DRM/authentication; metadata is active for Discovery Sweeps. Attach an authorized reference master video or configure approved provider feed to enable perceptual frame matching.`,
              ref.id
            );
          }
        }
        // Backfill extraction completeness telemetry on existing reference rows
        this.syncReferenceExtractionCompleteness(ref.id);
      }

      // Automatically purge any accidental CLI adapter test fixtures or synthetic FORENSIC_SAMPLE records on startup
      // unless SPECTRA_LOAD_DEMO_FIXTURES is explicitly enabled
      if (process.env.SPECTRA_LOAD_DEMO_FIXTURES !== 'true') {
        this.purgeConfirmedSyntheticForensicSamples();
      }

      // Restore any user-owned references from the durable journal that are missing from SQLite (and not explicitly deleted)
      this.restoreMissingUserReferencesFromJournal();

      // When running against the canonical live database, automatically recover any orphaned user-uploaded master videos
      // and their extracted thumbnail sets (e.g., interrupted or uncommitted multi-hour uploads)
      if (this.dbFilePath === DB_FILE) {
        this.recoverOrphanedUploadedReferences();
      }

      // Ensure the durable user-reference journal is synchronized with all active user references
      this.syncUserReferencesJournal();
    } catch (err: any) {
      console.warn('[DB Migration] Cleanup notice:', err.message);
    }
  }

  public static computeExpectedFrameCount(durationSec: number, intervalSec: number): number {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
    const safeInterval = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 2.0;
    const gridCount = Math.floor(durationSec / safeInterval) + 1;
    const lastGridTs = (gridCount - 1) * safeInterval;
    const tailGap = durationSec - lastGridTs;
    // Include final partial interval frame when tail gap > 0.35s so end of video is never omitted
    const hasTailFrame = tailGap > 0.35 && durationSec - 0.1 > lastGridTs + 0.15;
    return gridCount + (hasTailFrame ? 1 : 0);
  }

  public syncReferenceExtractionCompleteness(
    refId: string,
    options?: {
      sampleIntervalSec?: number;
      durationSec?: number;
      extractionError?: string | null;
      keepExtractingStatus?: boolean;
    }
  ): ReferenceItem | null {
    try {
      const ref = this.db.prepare(`SELECT * FROM reference_items WHERE id = ?`).get(refId) as any;
      if (!ref) return null;

      const fpStats = this.db.prepare(`
        SELECT COUNT(*) as cnt,
               MIN(timestamp_sec) as min_ts,
               MAX(timestamp_sec) as max_ts
        FROM reference_fingerprints
        WHERE reference_id = ?
      `).get(refId) as { cnt: number; min_ts: number | null; max_ts: number | null };

      const extractedCount = Number(fpStats?.cnt || 0);
      const firstTs = fpStats?.min_ts !== null && fpStats?.min_ts !== undefined ? Number(fpStats.min_ts) : null;
      const lastTs = fpStats?.max_ts !== null && fpStats?.max_ts !== undefined ? Number(fpStats.max_ts) : null;

      // Determine sampling interval from explicit override, stored value, or actual frame spacing
      let intervalSec = Number(options?.sampleIntervalSec || ref.sample_interval_sec || 0);
      if (extractedCount >= 2 && firstTs !== null && !options?.sampleIntervalSec) {
        const secondRow = this.db.prepare(`
          SELECT timestamp_sec FROM reference_fingerprints
          WHERE reference_id = ? AND timestamp_sec > ?
          ORDER BY timestamp_sec ASC LIMIT 1
        `).get(refId, firstTs) as { timestamp_sec?: number } | undefined;
        const diff = secondRow?.timestamp_sec ? Number((secondRow.timestamp_sec - firstTs).toFixed(2)) : 0;
        if (diff > 0 && (!intervalSec || intervalSec <= 0)) {
          intervalSec = diff;
        }
      }
      if (!intervalSec || intervalSec <= 0) {
        intervalSec = 2.0;
      }

      const sourceVideoPath = this.resolveExistingReferenceVideoPath(ref);
      const sourceVideoAvailable = Boolean(sourceVideoPath || (ref.media_url && String(ref.media_url).startsWith('http')));

      let durationSec = Number(options?.durationSec || ref.duration_sec || 0);
      // Guard against legacy 7200s / 5400s probe fallback values when local source video was missing
      if (
        !options?.durationSec &&
        !sourceVideoAvailable &&
        (durationSec === 7200 || durationSec === 5400) &&
        extractedCount > 0 &&
        lastTs !== null &&
        lastTs > 0 &&
        lastTs < 1800
      ) {
        durationSec = Math.max(lastTs, Number(((extractedCount - 1) * intervalSec).toFixed(2)));
      }

      const expectedCount = ArgusDatabase.computeExpectedFrameCount(durationSec, intervalSec);
      const imgAvailability = this.computeReferenceImageAvailability(refId, extractedCount);
      const retrievableCount = imgAvailability.retrievable_frame_image_count;
      const missingImageCount = imgAvailability.missing_frame_image_count;
      const requiredFrameCount = Math.max(expectedCount, extractedCount);

      // STRICT COMPLETION GATE:
      // A reference may ONLY be marked FINGERPRINTED and extraction_status COMPLETE when:
      // 1) All expected frames across the full video duration have been extracted (extractedCount >= expectedCount)
      // 2) Every extracted frame has a verified, retrievable JPEG image (retrievableCount >= requiredFrameCount && missingImageCount === 0)
      const isFullyVerified =
        extractedCount > 0 &&
        (expectedCount > 0 ? extractedCount >= expectedCount : true) &&
        retrievableCount >= requiredFrameCount &&
        missingImageCount === 0;

      let extractionStatus = ref.extraction_status as string | undefined;
      let nextRefStatus = ref.status as string;

      if (ref.status === 'FAILED' || ref.status === 'INVALID') {
        extractionStatus = 'FAILED';
      } else if (options?.keepExtractingStatus) {
        extractionStatus = 'EXTRACTING';
        nextRefStatus = 'PROCESSING';
      } else if (extractedCount === 0) {
        extractionStatus = ref.file_path ? 'QUEUED' : (extractionStatus || 'QUEUED');
        if (nextRefStatus === 'FINGERPRINTED') {
          nextRefStatus = 'PROCESSING';
        }
      } else if (isFullyVerified) {
        extractionStatus = 'COMPLETE';
        nextRefStatus = 'FINGERPRINTED';
      } else {
        // Either extractedCount < expectedCount OR missingImageCount > 0
        extractionStatus = 'PARTIAL';
        if (nextRefStatus === 'FINGERPRINTED' || nextRefStatus === 'PROCESSING') {
          nextRefStatus = 'PROCESSING';
        }
      }

      const verifiedCompleteFrames = Math.min(extractedCount, retrievableCount);
      const denom = Math.max(expectedCount, extractedCount, 1);
      const progressPct = isFullyVerified
        ? 100
        : extractedCount === 0
        ? 0
        : Math.min(99.9, Number(((verifiedCompleteFrames / denom) * 100).toFixed(1)));

      let nextError: string | null = null;
      if (isFullyVerified) {
        nextError = null;
      } else if (options?.extractionError !== undefined && options.extractionError !== null) {
        nextError = options.extractionError;
      } else if (extractedCount > 0 && missingImageCount > 0 && expectedCount > 0 && extractedCount < expectedCount) {
        nextError = `Incomplete frame & image extraction: ${extractedCount}/${expectedCount} frames indexed and ${missingImageCount} frame JPEG image(s) missing (${retrievableCount}/${extractedCount} images retrievable).`;
      } else if (extractedCount > 0 && missingImageCount > 0) {
        nextError = `Incomplete image persistence: ${extractedCount}/${expectedCount || extractedCount} frame fingerprints indexed, but ${missingImageCount} frame JPEG image(s) are missing (${retrievableCount}/${extractedCount} images retrievable). Re-supply source video to regenerate missing frame images.`;
      } else if (extractedCount > 0 && expectedCount > 0 && extractedCount < expectedCount) {
        nextError =
          ref.extraction_error ||
          `Partial frame extraction: ${extractedCount} of ${expectedCount} expected frames extracted (${progressPct}%). Resume extraction to complete full video coverage.`;
      } else {
        nextError = ref.extraction_error ?? null;
      }

      this.db.prepare(`
        UPDATE reference_items
        SET status = ?,
            duration_sec = ?,
            fingerprint_count = ?,
            sample_interval_sec = ?,
            expected_frame_count = ?,
            extracted_frame_count = ?,
            first_extracted_timestamp_sec = ?,
            last_extracted_timestamp_sec = ?,
            extraction_status = ?,
            extraction_error = ?,
            extraction_progress_pct = ?
        WHERE id = ?
      `).run(
        nextRefStatus,
        durationSec,
        extractedCount,
        intervalSec,
        expectedCount,
        extractedCount,
        firstTs,
        lastTs,
        extractionStatus || 'QUEUED',
        nextError,
        progressPct,
        refId
      );
      this.syncUserReferencesJournal();
      return this.getReferenceById(refId);
    } catch {
      return null;
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
        fps, codec, source_type, source_url, final_url, media_url,
        platform, season_episode_info, provider_integration_status,
        acquisition_status, authorization_provenance, last_acquisition_at, acquisition_error,
        detected_player_provider, embedded_player_metadata_json, inspection_status,
        file_path, thumbnail_url, created_at, status, provenance_sha256, fingerprint_count,
        sample_interval_sec, expected_frame_count, extracted_frame_count,
        first_extracted_timestamp_sec, last_extracted_timestamp_sec,
        extraction_status, extraction_error, extraction_progress_pct, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      item.final_url || null,
      item.media_url || null,
      item.platform || null,
      item.season_episode_info || null,
      item.provider_integration_status || null,
      item.acquisition_status || null,
      item.authorization_provenance || null,
      item.last_acquisition_at || null,
      item.acquisition_error || null,
      item.detected_player_provider || null,
      item.embedded_player_metadata_json || null,
      item.inspection_status || null,
      item.file_path || null,
      item.thumbnail_url || null,
      item.created_at,
      item.status,
      item.provenance_sha256,
      item.fingerprint_count,
      item.sample_interval_sec ?? 2.0,
      item.expected_frame_count ?? ArgusDatabase.computeExpectedFrameCount(item.duration_sec, item.sample_interval_sec ?? 2.0),
      item.extracted_frame_count ?? item.fingerprint_count ?? 0,
      item.first_extracted_timestamp_sec ?? null,
      item.last_extracted_timestamp_sec ?? null,
      item.extraction_status || (item.fingerprint_count > 0 ? 'COMPLETE' : 'QUEUED'),
      item.extraction_error || null,
      item.extraction_progress_pct ?? (item.fingerprint_count > 0 ? 100 : 0),
      item.notes || null
    );
    this.clearTombstonedReferenceId(item.id);
    this.syncUserReferencesJournal();
  }

  public upsertReference(item: ReferenceItem): void {
    const stmt = this.db.prepare(`
      INSERT INTO reference_items (
        id, title, rights_holder, asset_type, duration_sec, resolution,
        fps, codec, source_type, source_url, final_url, media_url,
        platform, season_episode_info, provider_integration_status,
        acquisition_status, authorization_provenance, last_acquisition_at, acquisition_error,
        detected_player_provider, embedded_player_metadata_json, inspection_status,
        file_path, thumbnail_url, created_at, status, provenance_sha256, fingerprint_count,
        sample_interval_sec, expected_frame_count, extracted_frame_count,
        first_extracted_timestamp_sec, last_extracted_timestamp_sec,
        extraction_status, extraction_error, extraction_progress_pct, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        rights_holder = excluded.rights_holder,
        asset_type = excluded.asset_type,
        duration_sec = excluded.duration_sec,
        resolution = excluded.resolution,
        fps = excluded.fps,
        codec = excluded.codec,
        source_type = excluded.source_type,
        source_url = COALESCE(excluded.source_url, reference_items.source_url),
        final_url = COALESCE(excluded.final_url, reference_items.final_url),
        media_url = COALESCE(excluded.media_url, reference_items.media_url),
        platform = COALESCE(excluded.platform, reference_items.platform),
        season_episode_info = COALESCE(excluded.season_episode_info, reference_items.season_episode_info),
        provider_integration_status = COALESCE(excluded.provider_integration_status, reference_items.provider_integration_status),
        acquisition_status = COALESCE(excluded.acquisition_status, reference_items.acquisition_status),
        authorization_provenance = COALESCE(excluded.authorization_provenance, reference_items.authorization_provenance),
        last_acquisition_at = COALESCE(excluded.last_acquisition_at, reference_items.last_acquisition_at),
        acquisition_error = excluded.acquisition_error,
        detected_player_provider = COALESCE(excluded.detected_player_provider, reference_items.detected_player_provider),
        embedded_player_metadata_json = COALESCE(excluded.embedded_player_metadata_json, reference_items.embedded_player_metadata_json),
        inspection_status = COALESCE(excluded.inspection_status, reference_items.inspection_status),
        file_path = COALESCE(excluded.file_path, reference_items.file_path),
        thumbnail_url = excluded.thumbnail_url,
        status = excluded.status,
        provenance_sha256 = excluded.provenance_sha256,
        fingerprint_count = excluded.fingerprint_count,
        sample_interval_sec = COALESCE(excluded.sample_interval_sec, reference_items.sample_interval_sec),
        expected_frame_count = COALESCE(excluded.expected_frame_count, reference_items.expected_frame_count),
        extracted_frame_count = COALESCE(excluded.extracted_frame_count, reference_items.extracted_frame_count),
        first_extracted_timestamp_sec = COALESCE(excluded.first_extracted_timestamp_sec, reference_items.first_extracted_timestamp_sec),
        last_extracted_timestamp_sec = COALESCE(excluded.last_extracted_timestamp_sec, reference_items.last_extracted_timestamp_sec),
        extraction_status = COALESCE(excluded.extraction_status, reference_items.extraction_status),
        extraction_error = excluded.extraction_error,
        extraction_progress_pct = COALESCE(excluded.extraction_progress_pct, reference_items.extraction_progress_pct),
        notes = excluded.notes
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
      item.final_url || null,
      item.media_url || null,
      item.platform || null,
      item.season_episode_info || null,
      item.provider_integration_status || null,
      item.acquisition_status || null,
      item.authorization_provenance || null,
      item.last_acquisition_at || null,
      item.acquisition_error || null,
      item.detected_player_provider || null,
      item.embedded_player_metadata_json || null,
      item.inspection_status || null,
      item.file_path || null,
      item.thumbnail_url || null,
      item.created_at,
      item.status,
      item.provenance_sha256,
      item.fingerprint_count,
      item.sample_interval_sec ?? null,
      item.expected_frame_count ?? null,
      item.extracted_frame_count ?? null,
      item.first_extracted_timestamp_sec ?? null,
      item.last_extracted_timestamp_sec ?? null,
      item.extraction_status || null,
      item.extraction_error ?? null,
      item.extraction_progress_pct ?? null,
      item.notes || null
    );
    this.clearTombstonedReferenceId(item.id);
    this.syncUserReferencesJournal();
  }

  public updateReferenceExtractionState(
    id: string,
    updates: {
      duration_sec?: number;
      sample_interval_sec?: number;
      expected_frame_count?: number;
      extracted_frame_count?: number;
      first_extracted_timestamp_sec?: number | null;
      last_extracted_timestamp_sec?: number | null;
      extraction_status?: string;
      extraction_error?: string | null;
      extraction_progress_pct?: number;
      status?: string;
      thumbnail_url?: string;
      notes?: string;
    }
  ): void {
    const fields: string[] = [];
    const values: any[] = [];
    if (updates.duration_sec !== undefined) { fields.push('duration_sec = ?'); values.push(updates.duration_sec); }
    if (updates.sample_interval_sec !== undefined) { fields.push('sample_interval_sec = ?'); values.push(updates.sample_interval_sec); }
    if (updates.expected_frame_count !== undefined) { fields.push('expected_frame_count = ?'); values.push(updates.expected_frame_count); }
    if (updates.extracted_frame_count !== undefined) {
      fields.push('extracted_frame_count = ?');
      values.push(updates.extracted_frame_count);
      fields.push('fingerprint_count = ?');
      values.push(updates.extracted_frame_count);
    }
    if (updates.first_extracted_timestamp_sec !== undefined) { fields.push('first_extracted_timestamp_sec = ?'); values.push(updates.first_extracted_timestamp_sec); }
    if (updates.last_extracted_timestamp_sec !== undefined) { fields.push('last_extracted_timestamp_sec = ?'); values.push(updates.last_extracted_timestamp_sec); }
    if (updates.extraction_status !== undefined) { fields.push('extraction_status = ?'); values.push(updates.extraction_status); }
    if (updates.extraction_error !== undefined) { fields.push('extraction_error = ?'); values.push(updates.extraction_error); }
    if (updates.extraction_progress_pct !== undefined) { fields.push('extraction_progress_pct = ?'); values.push(updates.extraction_progress_pct); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.thumbnail_url !== undefined) { fields.push('thumbnail_url = ?'); values.push(updates.thumbnail_url); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE reference_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  public markReferenceInvalid(id: string, reason: string): void {
    this.db.prepare(`DELETE FROM reference_fingerprints WHERE reference_id = ?`).run(id);
    this.db.prepare(`
      UPDATE reference_items
      SET status = 'INVALID',
          fingerprint_count = 0,
          extracted_frame_count = 0,
          extraction_status = 'FAILED',
          extraction_error = ?,
          thumbnail_url = NULL,
          notes = ?
      WHERE id = ?
    `).run(reason, reason, id);
  }

  public clearReferenceFingerprints(refId: string): void {
    this.db.prepare(`DELETE FROM reference_fingerprints WHERE reference_id = ?`).run(refId);
  }

  public updateReferenceFingerprintCount(
    id: string,
    count: number,
    thumbnailUrl?: string,
    status: string = 'FINGERPRINTED'
  ): void {
    if (thumbnailUrl) {
      const stmt = this.db.prepare(`
        UPDATE reference_items SET fingerprint_count = ?, extracted_frame_count = ?, status = ?, thumbnail_url = ? WHERE id = ?
      `);
      stmt.run(count, count, status, thumbnailUrl, id);
    } else {
      const stmt = this.db.prepare(`
        UPDATE reference_items SET fingerprint_count = ?, extracted_frame_count = ?, status = ? WHERE id = ?
      `);
      stmt.run(count, count, status, id);
    }
    this.syncReferenceExtractionCompleteness(id);
  }

  private normalizeThumbnailRoute(rawRoute?: string | null): string | undefined {
    if (!rawRoute || typeof rawRoute !== 'string') return undefined;
    const trimmed = rawRoute.trim();
    if (!trimmed) return undefined;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('data:image/svg') || lower.includes('<svg') || lower.endsWith('.svg')) {
      return undefined;
    }
    if (trimmed.includes('data/thumbnails/')) {
      const fname = path.basename(trimmed);
      return fname ? `/thumbnails/${fname}` : undefined;
    }
    if (trimmed.startsWith('/thumbnails/') || trimmed.startsWith('/data/thumbnails/')) {
      return `/thumbnails/${path.basename(trimmed)}`;
    }
    if (lower.startsWith('thumb_') && (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png'))) {
      return `/thumbnails/${ path.basename(trimmed) }`;
    }
    return trimmed;
  }

  private isValidJpegFileOnDisk(diskPath: string): boolean {
    try {
      if (!fs.existsSync(diskPath)) return false;
      const stat = fs.statSync(diskPath);
      if (stat.size < 64) return false;
      const fd = fs.openSync(diskPath, 'r');
      const header = Buffer.alloc(2);
      fs.readSync(fd, header, 0, 2, 0);
      fs.closeSync(fd);
      return header[0] === 0xff && header[1] === 0xd8;
    } catch {
      return false;
    }
  }

  private resolveAndRestoreThumbnail(
    thumbUrl?: string | null,
    thumbPath?: string | null,
    thumbData?: string | null,
    fpId?: string
  ): string | undefined {
    const candidateRoute = this.normalizeThumbnailRoute(thumbUrl) || this.normalizeThumbnailRoute(thumbPath) || undefined;
    const hasValidBase64 = Boolean(thumbData && thumbData.startsWith('data:image/jpeg;base64,'));

    if (candidateRoute && candidateRoute.startsWith('/thumbnails/')) {
      const filename = path.basename(candidateRoute);
      const diskPath = path.join(this.thumbnailsDir, filename);
      if (this.isValidJpegFileOnDisk(diskPath)) {
        return candidateRoute;
      }
      // Self-heal missing thumbnail file on disk from SQLite base64 thumbnail_data when available
      if (hasValidBase64 && thumbData) {
        try {
          const b64 = thumbData.slice('data:image/jpeg;base64,'.length);
          const buf = Buffer.from(b64, 'base64');
          if (buf.length >= 64 && buf[0] === 0xff && buf[1] === 0xd8) {
            if (!fs.existsSync(this.thumbnailsDir)) {
              fs.mkdirSync(this.thumbnailsDir, { recursive: true });
            }
            fs.writeFileSync(diskPath, buf);
            return candidateRoute;
          }
        } catch {}
        return thumbData;
      }
      // CRITICAL: Never return a non-existent /thumbnails/... route when both disk file and base64 data are missing!
      return undefined;
    }

    if (hasValidBase64 && thumbData) {
      // If we have base64 data but no /thumbnails/ route yet, materialize a deterministic thumbnail file if fpId is known
      if (fpId) {
        try {
          const safeFile = `thumb_restored_${fpId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
          const diskPath = path.join(this.thumbnailsDir, safeFile);
          const webRoute = `/thumbnails/${safeFile}`;
          if (!this.isValidJpegFileOnDisk(diskPath)) {
            const b64 = thumbData.slice('data:image/jpeg;base64,'.length);
            const buf = Buffer.from(b64, 'base64');
            if (buf.length >= 64 && buf[0] === 0xff && buf[1] === 0xd8) {
              if (!fs.existsSync(this.thumbnailsDir)) {
                fs.mkdirSync(this.thumbnailsDir, { recursive: true });
              }
              fs.writeFileSync(diskPath, buf);
              this.db
                .prepare(`UPDATE reference_fingerprints SET thumbnail_url = ?, thumbnail_path = ? WHERE id = ?`)
                .run(webRoute, webRoute, fpId);
              return webRoute;
            }
          } else {
            return webRoute;
          }
        } catch {}
      }
      return thumbData;
    }

    if (candidateRoute && (candidateRoute.startsWith('http://') || candidateRoute.startsWith('https://'))) {
      return candidateRoute;
    }

    return undefined;
  }

  public computeReferenceImageAvailability(
    refId: string,
    extractedFrameCount?: number
  ): {
    retrievable_frame_image_count: number;
    missing_frame_image_count: number;
    image_availability_status: ImageAvailabilityStatus;
  } {
    const rows = this.db
      .prepare(
        `SELECT id, thumbnail_url, thumbnail_path,
                CASE WHEN thumbnail_data LIKE 'data:image/jpeg;base64,%' THEN 1 ELSE 0 END AS has_base64
         FROM reference_fingerprints
         WHERE reference_id = ?`
      )
      .all(refId) as Array<{
      id: string;
      thumbnail_url?: string | null;
      thumbnail_path?: string | null;
      has_base64?: number;
    }>;

    const totalIndexed = extractedFrameCount !== undefined && extractedFrameCount > 0 ? extractedFrameCount : rows.length;
    if (totalIndexed === 0 || rows.length === 0) {
      return {
        retrievable_frame_image_count: 0,
        missing_frame_image_count: 0,
        image_availability_status: 'NOT_EXTRACTED'
      };
    }

    let retrievable = 0;
    for (const r of rows) {
      if (r.has_base64 === 1) {
        retrievable++;
        continue;
      }
      const route = this.normalizeThumbnailRoute(r.thumbnail_url) || this.normalizeThumbnailRoute(r.thumbnail_path);
      if (route && route.startsWith('/thumbnails/')) {
        const diskPath = path.join(this.thumbnailsDir, path.basename(route));
        if (this.isValidJpegFileOnDisk(diskPath)) {
          retrievable++;
          continue;
        }
      }
    }

    const missing = Math.max(0, totalIndexed - retrievable);
    const status: ImageAvailabilityStatus =
      retrievable >= totalIndexed
        ? 'COMPLETE'
        : retrievable > 0
        ? 'PARTIAL_IMAGES_MISSING'
        : 'IMAGES_UNAVAILABLE';

    return {
      retrievable_frame_image_count: retrievable,
      missing_frame_image_count: missing,
      image_availability_status: status
    };
  }

  /**
   * Resolves a local video file path for a reference if the source video exists on disk.
   */
  public resolveExistingReferenceVideoPath(ref: {
    id?: string;
    file_path?: string | null;
    media_url?: string | null;
    provenance_sha256?: string | null;
  }): string | null {
    const candidates: string[] = [];
    if (ref.file_path && typeof ref.file_path === 'string') {
      candidates.push(ref.file_path);
      if (!path.isAbsolute(ref.file_path)) {
        candidates.push(path.resolve(process.cwd(), ref.file_path.replace(/^\/+/, '')));
      }
      if (ref.file_path.includes('uploads/')) {
        candidates.push(path.join(process.cwd(), 'uploads', path.basename(ref.file_path)));
      }
      if (ref.file_path.includes('data/media/') || ref.file_path.startsWith('/media/')) {
        candidates.push(path.join(DATA_DIR, 'media', path.basename(ref.file_path)));
      }
    }
    if (ref.media_url && typeof ref.media_url === 'string' && !ref.media_url.startsWith('http')) {
      candidates.push(ref.media_url);
      if (ref.media_url.startsWith('/uploads/')) {
        candidates.push(path.join(process.cwd(), 'uploads', path.basename(ref.media_url)));
      }
      if (ref.media_url.startsWith('/media/') || ref.media_url.includes('data/media/')) {
        candidates.push(path.join(DATA_DIR, 'media', path.basename(ref.media_url)));
      }
    }
    for (const c of candidates) {
      try {
        if (c && fs.existsSync(c) && fs.statSync(c).isFile() && fs.statSync(c).size > 100) {
          return c;
        }
      } catch {}
    }

    // Fallback: if the original uploaded video was re-uploaded under a new upload prefix in uploads/,
    // match by original filename suffix (after upl_<ts>_<hex>-) or provenance_sha256
    if (ref.file_path && typeof ref.file_path === 'string') {
      try {
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (fs.existsSync(uploadsDir)) {
          const origBase = path.basename(ref.file_path);
          const origSuffix = origBase.replace(/^upl_\d+_[a-f0-9]+-/i, '').replace(/^\d+[-_]/, '').toLowerCase();
          if (origSuffix && origSuffix.length >= 6) {
            const entries = fs.readdirSync(uploadsDir);
            for (const entry of entries) {
              const fullEntry = path.join(uploadsDir, entry);
              try {
                const st = fs.statSync(fullEntry);
                if (!st.isFile() || st.size <= 1000) continue;
                const candSuffix = entry.replace(/^upl_\d+_[a-f0-9]+-/i, '').replace(/^\d+[-_]/, '').toLowerCase();
                if (candSuffix === origSuffix) {
                  if (ref.id) {
                    try {
                      this.db.prepare(`UPDATE reference_items SET file_path = ? WHERE id = ?`).run(fullEntry, ref.id);
                    } catch {}
                  }
                  return fullEntry;
                }
              } catch {}
            }
          }
        }
      } catch {}
    }

    return null;
  }

  /**
   * Shared, atomic reference frame & image persistence pipeline with strict verification.
   * Used by all registration, upload, attach-media, and re-extraction workflows so that:
   * 1) Every sampled frame is saved as a verified JPEG on disk AND base64 backup in SQLite alongside its timestamp and perceptual hash.
   * 2) Fingerprints are NEVER saved independently while silently skipping JPEG image persistence.
   * 3) Missing or corrupted frame images are repaired/regenerated from the source video before completion.
   * 4) References are ONLY marked FINGERPRINTED and COMPLETE when all expected frames, fingerprints, and JPEG images are verified.
   */
  public persistAndVerifyReferenceExtraction(params: {
    reference: ReferenceItem;
    extractedFrames?: Array<{
      timestamp_sec: number;
      frame_index: number;
      phash_hex: string;
      vhash_hex?: string;
      crop_phash_hex?: string;
      avg_luminance?: number;
      thumbnail_data?: string;
      thumbnail_path?: string;
      thumbnail_url?: string;
    }>;
    fingerprints?: Array<{
      timestamp_sec: number;
      frame_index: number;
      phash_hex: string;
      vhash_hex?: string;
      crop_phash_hex?: string;
      avg_luminance?: number;
      thumbnail_data?: string;
      thumbnail_path?: string;
      thumbnail_url?: string;
    }>;
    expectedFrameCount?: number;
    sampleIntervalSec: number;
    durationSec: number;
    sourceVideoPath?: string | null;
    replaceExistingFingerprints?: boolean;
    extractionError?: string | null;
  }): {
    reference: ReferenceItem;
    fingerprints: FrameFingerprint[];
    audit: ReferenceFrameAuditItem | null;
    isComplete: boolean;
  } {
    const {
      reference,
      extractedFrames,
      fingerprints,
      sampleIntervalSec,
      durationSec,
      sourceVideoPath,
      replaceExistingFingerprints = true,
      extractionError
    } = params;
    const rawFrames = extractedFrames ?? fingerprints ?? [];

    if (!fs.existsSync(this.thumbnailsDir)) {
      fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    }

    const safeRefPrefix = reference.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const nowIso = new Date().toISOString();
    const sortedFrames = [...rawFrames].sort((a, b) => a.frame_index - b.frame_index || a.timestamp_sec - b.timestamp_sec);

    const fpRecords: FrameFingerprint[] = [];
    const skippedUnverifiedFrameIndices: number[] = [];
    const embedAllBase64 = sortedFrames.length <= 500;

    for (const kf of sortedFrames) {
      const canonicalFile = `thumb_${safeRefPrefix}_${kf.frame_index}.jpg`;
      const existingRoute = this.normalizeThumbnailRoute(kf.thumbnail_url) || this.normalizeThumbnailRoute(kf.thumbnail_path);
      const targetFilename = existingRoute ? path.basename(existingRoute) : canonicalFile;
      const targetDiskPath = path.join(this.thumbnailsDir, targetFilename);
      const webRoute = `/thumbnails/${targetFilename}`;

      let thumbData = kf.thumbnail_data;
      let hasDisk = this.isValidJpegFileOnDisk(targetDiskPath);
      const shouldKeepBase64 = embedAllBase64 || kf.frame_index < 120;

      // Ensure disk file is always populated, and base64 backup is populated when shouldKeepBase64 is true
      if (hasDisk && shouldKeepBase64 && (!thumbData || !thumbData.startsWith('data:image/jpeg;base64,'))) {
        try {
          const buf = fs.readFileSync(targetDiskPath);
          thumbData = `data:image/jpeg;base64,${buf.toString('base64')}`;
        } catch {}
      } else if (!hasDisk && thumbData && thumbData.startsWith('data:image/jpeg;base64,')) {
        try {
          const b64 = thumbData.slice('data:image/jpeg;base64,'.length);
          const buf = Buffer.from(b64, 'base64');
          if (buf.length >= 64 && buf[0] === 0xff && buf[1] === 0xd8) {
            fs.writeFileSync(targetDiskPath, buf);
            hasDisk = this.isValidJpegFileOnDisk(targetDiskPath);
          }
        } catch {}
      }

      if (!hasDisk || (shouldKeepBase64 && (!thumbData || !thumbData.startsWith('data:image/jpeg;base64,')))) {
        // Attempt immediate single-frame regeneration if sourceVideoPath is available
        const resolvedSource = sourceVideoPath || this.resolveExistingReferenceVideoPath(reference);
        if (resolvedSource) {
          const regen = FingerprintEngine.extractSingleTimestampJpegSync(
            resolvedSource,
            kf.timestamp_sec,
            kf.frame_index,
            targetFilename,
            this.thumbnailsDir
          );
          if (regen) {
            thumbData = shouldKeepBase64 ? regen.thumbnailData : undefined;
            hasDisk = this.isValidJpegFileOnDisk(targetDiskPath);
          }
        }
      }

      const hasVerifiedBase64 = Boolean(thumbData && thumbData.startsWith('data:image/jpeg;base64,'));
      if (!hasDisk || (shouldKeepBase64 && !hasVerifiedBase64)) {
        // STRICT INVARIANT: Never save a newly extracted fingerprint independently while skipping JPEG image persistence!
        skippedUnverifiedFrameIndices.push(kf.frame_index);
        continue;
      }
      if (!shouldKeepBase64) {
        thumbData = undefined;
      }

      fpRecords.push({
        id: `fp_ref_${reference.id}_${kf.frame_index}`,
        reference_id: reference.id,
        timestamp_sec: kf.timestamp_sec,
        frame_index: kf.frame_index,
        phash_hex: kf.phash_hex,
        vhash_hex: kf.vhash_hex,
        crop_phash_hex: kf.crop_phash_hex,
        avg_luminance: kf.avg_luminance ?? 0,
        thumbnail_data: thumbData,
        thumbnail_path: webRoute,
        thumbnail_url: webRoute,
        created_at: nowIso
      });
    }

    const effectiveError =
      extractionError ||
      (skippedUnverifiedFrameIndices.length > 0
        ? `Skipped ${skippedUnverifiedFrameIndices.length} frame(s) without verified JPEG persistence (frame indices: ${skippedUnverifiedFrameIndices.slice(0, 10).join(', ')}).`
        : null);

    const firstValidThumb = fpRecords.find(f => f.thumbnail_url)?.thumbnail_url || reference.thumbnail_url;
    const initialRefToSave: ReferenceItem = {
      ...reference,
      duration_sec: durationSec,
      sample_interval_sec: sampleIntervalSec,
      thumbnail_url: firstValidThumb,
      fingerprint_count: fpRecords.length,
      extracted_frame_count: fpRecords.length
    };

    try {
      this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
      this.upsertReference(initialRefToSave);
      if (replaceExistingFingerprints) {
        this.clearReferenceFingerprints(reference.id);
      }
      this.insertReferenceFingerprints(fpRecords);
      this.db.exec('COMMIT;');
    } catch (txErr) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {}
      throw txErr;
    }

    // Run full image integrity audit & repair on this reference and enforce the strict completion gate
    const auditArr = this.auditAndRepairReferenceFrameImages(reference.id);
    const verifiedRef =
      this.syncReferenceExtractionCompleteness(reference.id, {
        sampleIntervalSec,
        durationSec,
        extractionError: effectiveError
      }) ||
      this.getReferenceById(reference.id) ||
      initialRefToSave;
    const savedFps = this.getReferenceFingerprints(reference.id, true);
    const isComplete =
      verifiedRef.status === 'FINGERPRINTED' &&
      verifiedRef.extraction_status === 'COMPLETE' &&
      (verifiedRef.missing_frame_image_count ?? 0) === 0;

    return {
      reference: verifiedRef,
      fingerprints: savedFps,
      audit: auditArr[0] || null,
      isComplete
    };
  }

  /**
   * Comprehensive integrity audit and non-destructive repair for reference frame images across all references.
   * - Preserves reference IDs, timestamps, fingerprints, metadata, and evidence.
   * - Never fabricates replacement frames or recreates entire references.
   * - Repairs broken paths from SQLite base64 data or hash-verified sibling thumbnail batches in data/thumbnails/.
   * - Regenerates ONLY missing frame timestamps when the original source video is available on disk.
   * - Backfills SQLite thumbnail_data for any disk JPEG that previously lacked base64 backup.
   * - Enforces the strict completion gate so references with missing images or incomplete frames are never marked FINGERPRINTED / COMPLETE.
   */
  public auditAndRepairReferenceFrameImages(targetRefId?: string): ReferenceFrameAuditItem[] {
    const thumbnailsDir = this.thumbnailsDir;
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    const refRows = (
      targetRefId
        ? this.db.prepare(`SELECT * FROM reference_items WHERE id = ?`).all(targetRefId)
        : this.db.prepare(`SELECT * FROM reference_items ORDER BY created_at DESC`).all()
    ) as unknown as ReferenceItem[];

    // Index existing batch prefixes in thumbnailsDir (thumb_<ts>_<hex>_<frameIndex>.jpg)
    const batchPrefixes = new Set<string>();
    try {
      const allThumbFiles = fs.readdirSync(thumbnailsDir).filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'));
      for (const fname of allThumbFiles) {
        const m = fname.match(/^(thumb_\d+_[a-f0-9]+)_\d+\.jpg$/i);
        if (m) {
          batchPrefixes.add(m[1]);
        }
      }
    } catch {}

    const dhashCache = new Map<string, string | null>();
    const getCachedJpegDHash = (fullPath: string): string | null => {
      if (dhashCache.has(fullPath)) return dhashCache.get(fullPath) ?? null;
      const computed = FingerprintEngine.computeJpegDHashSync(fullPath);
      dhashCache.set(fullPath, computed);
      return computed;
    };

    const updateFpStmt = this.db.prepare(`
      UPDATE reference_fingerprints
      SET thumbnail_data = ?, thumbnail_path = ?, thumbnail_url = ?
      WHERE id = ?
    `);

    const auditResults: ReferenceFrameAuditItem[] = [];

    for (const ref of refRows) {
      const fps = this.db
        .prepare(
          `SELECT id, reference_id, timestamp_sec, frame_index, phash_hex, vhash_hex, crop_phash_hex, avg_luminance,
                  thumbnail_path, thumbnail_url, created_at,
                  CASE WHEN thumbnail_data LIKE 'data:image/jpeg;base64,%' THEN 1 ELSE 0 END AS has_base64
           FROM reference_fingerprints
           WHERE reference_id = ?
           ORDER BY frame_index ASC, timestamp_sec ASC`
        )
        .all(ref.id) as unknown as Array<FrameFingerprint & { has_base64?: number }>;

      const sourceVideoPath = this.resolveExistingReferenceVideoPath(ref);
      const sourceVideoAvailable = Boolean(sourceVideoPath);
      const shouldBackfillAllBase64 = fps.length <= 500;

      let matchingSiblingPrefixes: string[] | null = null;
      const fp0Hash = fps[0]?.phash_hex?.toLowerCase();
      const resolveMatchingSiblingPrefixes = (sampleMissingFrameIndex: number): string[] => {
        if (matchingSiblingPrefixes !== null) return matchingSiblingPrefixes;
        matchingSiblingPrefixes = [];
        if (!fp0Hash) return matchingSiblingPrefixes;
        for (const prefix of batchPrefixes) {
          // Only inspect batches that actually contain the missing frame index on disk
          const neededFramePath = path.join(thumbnailsDir, `${prefix}_${sampleMissingFrameIndex}.jpg`);
          if (!this.isValidJpegFileOnDisk(neededFramePath)) continue;
          const f0Path = path.join(thumbnailsDir, `${prefix}_0.jpg`);
          if (this.isValidJpegFileOnDisk(f0Path)) {
            const h0 = getCachedJpegDHash(f0Path);
            if (h0 && h0.toLowerCase() === fp0Hash) {
              matchingSiblingPrefixes.push(prefix);
            }
          }
        }
        return matchingSiblingPrefixes;
      };

      let retrievableCount = 0;
      let repairedFromBase64Count = 0;
      let repairedFromSiblingBatchCount = 0;
      let regeneratedFromSourceVideoCount = 0;
      let backfilledBase64Count = 0;
      let firstValidRoute: string | undefined = undefined;

      for (const fp of fps) {
        const normalizedRoute =
          this.normalizeThumbnailRoute(fp.thumbnail_url) ||
          this.normalizeThumbnailRoute(fp.thumbnail_path) ||
          `/thumbnails/thumb_${ref.id.replace(/[^a-zA-Z0-9_-]/g, '_')}_${fp.frame_index}.jpg`;
        const targetFilename = path.basename(normalizedRoute);
        const targetDiskPath = path.join(thumbnailsDir, targetFilename);
        const canonicalWebRoute = `/thumbnails/${targetFilename}`;

        const diskExistsBefore = this.isValidJpegFileOnDisk(targetDiskPath);
        const hasBase64Before = fp.has_base64 === 1;
        const shouldBackfillThisFrame = shouldBackfillAllBase64 || fp.frame_index < 120;

        // Case 1: Valid JPEG exists on disk at targetDiskPath
        if (diskExistsBefore) {
          retrievableCount++;
          if (!firstValidRoute) firstValidRoute = canonicalWebRoute;
          if ((shouldBackfillThisFrame && !hasBase64Before) || fp.thumbnail_url !== canonicalWebRoute || fp.thumbnail_path !== canonicalWebRoute) {
            try {
              if (shouldBackfillThisFrame && !hasBase64Before) {
                const buf = fs.readFileSync(targetDiskPath);
                const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
                updateFpStmt.run(dataUri, canonicalWebRoute, canonicalWebRoute, fp.id);
                backfilledBase64Count++;
              } else {
                this.db
                  .prepare(`UPDATE reference_fingerprints SET thumbnail_path = ?, thumbnail_url = ? WHERE id = ?`)
                  .run(canonicalWebRoute, canonicalWebRoute, fp.id);
              }
            } catch {}
          }
          continue;
        }

        // Case 2: Disk file is missing, but valid base64 thumbnail_data exists in SQLite
        if (hasBase64Before) {
          try {
            const b64Row = this.db
              .prepare(`SELECT thumbnail_data FROM reference_fingerprints WHERE id = ?`)
              .get(fp.id) as { thumbnail_data?: string } | undefined;
            const rawB64Data = b64Row?.thumbnail_data;
            if (rawB64Data && rawB64Data.startsWith('data:image/jpeg;base64,')) {
              const b64 = rawB64Data.slice('data:image/jpeg;base64,'.length);
              const buf = Buffer.from(b64, 'base64');
              if (buf.length >= 64 && buf[0] === 0xff && buf[1] === 0xd8) {
                fs.writeFileSync(targetDiskPath, buf);
                updateFpStmt.run(rawB64Data, canonicalWebRoute, canonicalWebRoute, fp.id);
                retrievableCount++;
                repairedFromBase64Count++;
                if (!firstValidRoute) firstValidRoute = canonicalWebRoute;
                continue;
              }
            }
          } catch {}
        }

        // Case 3: Both target disk file and SQLite base64 are missing -> check sibling thumbnail batches in thumbnailsDir with matching 64-bit dHash
        let matchedSiblingPath: string | null = null;
        for (const prefix of resolveMatchingSiblingPrefixes(fp.frame_index)) {
          const candPath = path.join(thumbnailsDir, `${prefix}_${fp.frame_index}.jpg`);
          if (!this.isValidJpegFileOnDisk(candPath)) continue;
          const candHash = getCachedJpegDHash(candPath);
          if (candHash && fp.phash_hex && candHash.toLowerCase() === fp.phash_hex.toLowerCase()) {
            matchedSiblingPath = candPath;
            break;
          }
        }

        if (matchedSiblingPath) {
          try {
            const buf = fs.readFileSync(matchedSiblingPath);
            fs.writeFileSync(targetDiskPath, buf);
            const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;
            updateFpStmt.run(dataUri, canonicalWebRoute, canonicalWebRoute, fp.id);
            retrievableCount++;
            repairedFromSiblingBatchCount++;
            backfilledBase64Count++;
            if (!firstValidRoute) firstValidRoute = canonicalWebRoute;
            continue;
          } catch {}
        }

        // Case 4: Regenerate ONLY this missing frame from original source video if available on disk
        if (sourceVideoPath) {
          const regen = FingerprintEngine.extractSingleTimestampJpegSync(
            sourceVideoPath,
            fp.timestamp_sec,
            fp.frame_index,
            targetFilename,
            thumbnailsDir
          );
          if (regen) {
            updateFpStmt.run(regen.thumbnailData, regen.thumbnailPath, regen.thumbnailUrl, fp.id);
            retrievableCount++;
            regeneratedFromSourceVideoCount++;
            backfilledBase64Count++;
            if (!firstValidRoute) firstValidRoute = regen.thumbnailUrl;
            continue;
          }
        }
      }

      if (firstValidRoute && ref.thumbnail_url !== firstValidRoute) {
        try {
          this.db.prepare(`UPDATE reference_items SET thumbnail_url = ? WHERE id = ?`).run(firstValidRoute, ref.id);
        } catch {}
      }

      // Synchronize extraction status, progress percentage, and reference status with the audited frame & image completeness
      const syncedRef = this.syncReferenceExtractionCompleteness(ref.id);

      const indexedCount = fps.length;
      const missingCount = Math.max(0, indexedCount - retrievableCount);
      const availabilityStatus: ImageAvailabilityStatus =
        indexedCount === 0
          ? 'NOT_EXTRACTED'
          : retrievableCount >= indexedCount
          ? 'COMPLETE'
          : retrievableCount > 0
          ? 'PARTIAL_IMAGES_MISSING'
          : 'IMAGES_UNAVAILABLE';

      auditResults.push({
        reference_id: ref.id,
        title: ref.title,
        status: syncedRef?.status || ref.status,
        indexed_frame_count: indexedCount,
        retrievable_frame_image_count: retrievableCount,
        missing_frame_image_count: missingCount,
        repaired_from_base64_count: repairedFromBase64Count,
        repaired_from_sibling_batch_count: repairedFromSiblingBatchCount,
        regenerated_from_source_video_count: regeneratedFromSourceVideoCount,
        backfilled_base64_count: backfilledBase64Count,
        image_availability_status: availabilityStatus,
        source_video_available: sourceVideoAvailable
      });
    }

    return auditResults;
  }

  /**
   * Retrieves a frame's binary JPEG image by (reference_id, frame_index), automatically self-healing
   * from SQLite thumbnail_data or regenerating from the source video if the disk file is missing.
   */
  public getReferenceFrameImageBuffer(
    refId: string,
    frameIndex: number
  ): { buffer: Buffer; mimeType: string; filename: string } | null {
    const fp = this.db
      .prepare(
        `SELECT * FROM reference_fingerprints WHERE reference_id = ? AND frame_index = ? ORDER BY timestamp_sec ASC LIMIT 1`
      )
      .get(refId, frameIndex) as unknown as FrameFingerprint | undefined;
    if (!fp) return null;

    const resolved = this.resolveAndRestoreThumbnail(fp.thumbnail_url, fp.thumbnail_path, fp.thumbnail_data, fp.id);
    if (resolved && resolved.startsWith('/thumbnails/')) {
      const fname = path.basename(resolved);
      const diskPath = path.join(this.thumbnailsDir, fname);
      if (this.isValidJpegFileOnDisk(diskPath)) {
        return {
          buffer: fs.readFileSync(diskPath),
          mimeType: 'image/jpeg',
          filename: fname
        };
      }
    }

    if (fp.thumbnail_data && fp.thumbnail_data.startsWith('data:image/jpeg;base64,')) {
      const b64 = fp.thumbnail_data.slice('data:image/jpeg;base64,'.length);
      const buf = Buffer.from(b64, 'base64');
      if (buf.length >= 64 && buf[0] === 0xff && buf[1] === 0xd8) {
        return {
          buffer: buf,
          mimeType: 'image/jpeg',
          filename: `frame_${refId}_${frameIndex}.jpg`
        };
      }
    }

    // Attempt single-frame repair/regeneration for this reference
    this.auditAndRepairReferenceFrameImages(refId);
    const refreshedFp = this.db
      .prepare(`SELECT * FROM reference_fingerprints WHERE id = ?`)
      .get(fp.id) as unknown as FrameFingerprint | undefined;
    if (refreshedFp) {
      const retryRoute = this.normalizeThumbnailRoute(refreshedFp.thumbnail_url || refreshedFp.thumbnail_path);
      if (retryRoute && retryRoute.startsWith('/thumbnails/')) {
        const fname = path.basename(retryRoute);
        const diskPath = path.join(this.thumbnailsDir, fname);
        if (this.isValidJpegFileOnDisk(diskPath)) {
          return {
            buffer: fs.readFileSync(diskPath),
            mimeType: 'image/jpeg',
            filename: fname
          };
        }
      }
    }

    return null;
  }

  /**
   * Fallback resolver when a request to `/thumbnails/:filename` misses static disk serving.
   * Looks up any reference or candidate fingerprint matching `:filename` and restores it on-the-fly.
   */
  public getThumbnailByFilenameOrRestore(filename: string): { buffer: Buffer; mimeType: string } | null {
    const safeName = path.basename(filename);
    const diskPath = path.join(this.thumbnailsDir, safeName);
    if (this.isValidJpegFileOnDisk(diskPath)) {
      return { buffer: fs.readFileSync(diskPath), mimeType: 'image/jpeg' };
    }

    const webRoute = `/thumbnails/${safeName}`;
    const refFp = this.db
      .prepare(
        `SELECT id, reference_id, frame_index, thumbnail_url, thumbnail_path, thumbnail_data FROM reference_fingerprints WHERE thumbnail_url = ? OR thumbnail_path = ? LIMIT 1`
      )
      .get(webRoute, webRoute) as
      | {
          id: string;
          reference_id: string;
          frame_index: number;
          thumbnail_url?: string;
          thumbnail_path?: string;
          thumbnail_data?: string;
        }
      | undefined;

    if (refFp) {
      const fromRef = this.getReferenceFrameImageBuffer(refFp.reference_id, refFp.frame_index);
      if (fromRef) {
        return { buffer: fromRef.buffer, mimeType: fromRef.mimeType };
      }
    }

    const candFp = this.db
      .prepare(
        `SELECT id, thumbnail_url, thumbnail_path, thumbnail_data FROM candidate_fingerprints WHERE thumbnail_url = ? OR thumbnail_path = ? LIMIT 1`
      )
      .get(webRoute, webRoute) as
      | { id: string; thumbnail_url?: string; thumbnail_path?: string; thumbnail_data?: string }
      | undefined;

    if (candFp?.thumbnail_data && candFp.thumbnail_data.startsWith('data:image/jpeg;base64,')) {
      const b64 = candFp.thumbnail_data.slice('data:image/jpeg;base64,'.length);
      const buf = Buffer.from(b64, 'base64');
      if (buf.length >= 64 && buf[0] === 0xff && buf[1] === 0xd8) {
        try {
          fs.writeFileSync(diskPath, buf);
        } catch {}
        return { buffer: buf, mimeType: 'image/jpeg' };
      }
    }

    return null;
  }

  public getReferences(): ReferenceItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM reference_items ORDER BY created_at DESC
    `);
    const rows = stmt.all() as unknown as ReferenceItem[];
    const fpStmt = this.db.prepare(`
      SELECT id, thumbnail_url, thumbnail_path, thumbnail_data
      FROM reference_fingerprints
      WHERE reference_id = ?
      ORDER BY frame_index ASC, timestamp_sec ASC
      LIMIT 1
    `);
    return rows.map(row => {
      const sourceVideoAvailable = Boolean(
        this.resolveExistingReferenceVideoPath(row) || (row.media_url && String(row.media_url).startsWith('http'))
      );
      if (
        row.status === 'INVALID' ||
        row.status === 'METADATA_REGISTERED' ||
        row.status === 'AWAITING_AUTHORIZED_MEDIA' ||
        (row.fingerprint_count || 0) === 0
      ) {
        return {
          ...row,
          thumbnail_url: undefined,
          first_thumbnail: undefined,
          fingerprint_count: 0,
          extracted_frame_count: 0,
          retrievable_frame_image_count: 0,
          missing_frame_image_count: 0,
          image_availability_status: 'NOT_EXTRACTED',
          source_video_available: sourceVideoAvailable
        };
      }
      const fp0 = fpStmt.get(row.id) as { id: string; thumbnail_url?: string; thumbnail_path?: string; thumbnail_data?: string } | undefined;
      const persistedThumb = this.resolveAndRestoreThumbnail(
        fp0?.thumbnail_url || row.thumbnail_url,
        fp0?.thumbnail_path,
        fp0?.thumbnail_data,
        fp0?.id
      );
      const extractedCount = row.extracted_frame_count ?? row.fingerprint_count;
      const imgTelemetry = this.computeReferenceImageAvailability(row.id, extractedCount);
      return {
        ...row,
        extracted_frame_count: extractedCount,
        retrievable_frame_image_count: imgTelemetry.retrievable_frame_image_count,
        missing_frame_image_count: imgTelemetry.missing_frame_image_count,
        image_availability_status: imgTelemetry.image_availability_status,
        source_video_available: sourceVideoAvailable,
        thumbnail_url: persistedThumb,
        first_thumbnail: persistedThumb
      };
    });
  }

  public getReferenceById(id: string): ReferenceItem | null {
    const stmt = this.db.prepare(`SELECT * FROM reference_items WHERE id = ?`);
    const row = stmt.get(id) as unknown as ReferenceItem | undefined;
    if (!row) return null;
    const sourceVideoAvailable = Boolean(
      this.resolveExistingReferenceVideoPath(row) || (row.media_url && String(row.media_url).startsWith('http'))
    );
    if (
      row.status === 'INVALID' ||
      row.status === 'METADATA_REGISTERED' ||
      row.status === 'AWAITING_AUTHORIZED_MEDIA' ||
      (row.fingerprint_count || 0) === 0
    ) {
      return {
        ...row,
        thumbnail_url: undefined,
        first_thumbnail: undefined,
        fingerprint_count: 0,
        extracted_frame_count: 0,
        retrievable_frame_image_count: 0,
        missing_frame_image_count: 0,
        image_availability_status: 'NOT_EXTRACTED',
        source_video_available: sourceVideoAvailable
      };
    }
    const fpStmt = this.db.prepare(`
      SELECT id, thumbnail_url, thumbnail_path, thumbnail_data
      FROM reference_fingerprints
      WHERE reference_id = ?
      ORDER BY frame_index ASC, timestamp_sec ASC
      LIMIT 1
    `);
    const fp0 = fpStmt.get(row.id) as { id: string; thumbnail_url?: string; thumbnail_path?: string; thumbnail_data?: string } | undefined;
    const persistedThumb = this.resolveAndRestoreThumbnail(
      fp0?.thumbnail_url || row.thumbnail_url,
      fp0?.thumbnail_path,
      fp0?.thumbnail_data,
      fp0?.id
    );
    const extractedCount = row.extracted_frame_count ?? row.fingerprint_count;
    const imgTelemetry = this.computeReferenceImageAvailability(row.id, extractedCount);
    return {
      ...row,
      extracted_frame_count: extractedCount,
      retrievable_frame_image_count: imgTelemetry.retrievable_frame_image_count,
      missing_frame_image_count: imgTelemetry.missing_frame_image_count,
      image_availability_status: imgTelemetry.image_availability_status,
      source_video_available: sourceVideoAvailable,
      thumbnail_url: persistedThumb,
      first_thumbnail: persistedThumb
    };
  }

  public deleteReference(id: string): boolean {
    this.recordTombstonedReferenceId(id);
    const stmt = this.db.prepare(`DELETE FROM reference_items WHERE id = ?`);
    stmt.run(id);
    this.syncUserReferencesJournal();
    return true;
  }

  // --- Fingerprints ---
  public insertReferenceFingerprints(fps: FrameFingerprint[]): void {
    if (!fs.existsSync(this.thumbnailsDir)) {
      fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    }
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO reference_fingerprints (
        id, reference_id, timestamp_sec, frame_index, phash_hex, vhash_hex, crop_phash_hex, avg_luminance, thumbnail_data, thumbnail_path, thumbnail_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const embedAllBase64 = fps.length <= 500;
    for (const fp of fps) {
      let thumbData = fp.thumbnail_data || null;
      const safeRefPrefix = (fp.reference_id || 'ref').replace(/[^a-zA-Z0-9_-]/g, '_');
      const fallbackCanonicalRoute = `/thumbnails/thumb_${safeRefPrefix}_${fp.frame_index}.jpg`;
      const normalizedRoute =
        this.normalizeThumbnailRoute(fp.thumbnail_url) ||
        this.normalizeThumbnailRoute(fp.thumbnail_path) ||
        (thumbData && thumbData.startsWith('data:image/jpeg;base64,') ? fallbackCanonicalRoute : null);

      const shouldKeepBase64 = embedAllBase64 || fp.frame_index < 120;
      if (normalizedRoute && normalizedRoute.startsWith('/thumbnails/')) {
        const diskPath = path.join(this.thumbnailsDir, path.basename(normalizedRoute));
        const hasDisk = this.isValidJpegFileOnDisk(diskPath);
        if (hasDisk && shouldKeepBase64 && (!thumbData || !thumbData.startsWith('data:image/jpeg;base64,'))) {
          try {
            const buf = fs.readFileSync(diskPath);
            thumbData = `data:image/jpeg;base64,${buf.toString('base64')}`;
          } catch {}
        } else if (!hasDisk && thumbData && thumbData.startsWith('data:image/jpeg;base64,')) {
          try {
            const b64 = thumbData.slice('data:image/jpeg;base64,'.length);
            const buf = Buffer.from(b64, 'base64');
            if (buf.length >= 64 && buf[0] === 0xff && buf[1] === 0xd8) {
              fs.writeFileSync(diskPath, buf);
            }
          } catch {}
        }
        if (hasDisk && !shouldKeepBase64) {
          thumbData = null;
        }
      }

      stmt.run(
        fp.id,
        fp.reference_id!,
        fp.timestamp_sec,
        fp.frame_index,
        fp.phash_hex,
        fp.vhash_hex || null,
        fp.crop_phash_hex || null,
        fp.avg_luminance ?? 0,
        thumbData,
        normalizedRoute || fp.thumbnail_path || fp.thumbnail_url || null,
        normalizedRoute || fp.thumbnail_url || fp.thumbnail_path || null,
        fp.created_at
      );
    }
  }

  public getReferenceFingerprints(refId: string, omitBase64IfDiskThumbnailExists: boolean = false): FrameFingerprint[] {
    if (omitBase64IfDiskThumbnailExists) {
      const rows = this.db
        .prepare(
          `SELECT id, reference_id, timestamp_sec, frame_index, phash_hex, vhash_hex, crop_phash_hex, avg_luminance,
                  thumbnail_path, thumbnail_url, created_at,
                  CASE WHEN thumbnail_data LIKE 'data:image/%' THEN 1 ELSE 0 END AS has_base64
           FROM reference_fingerprints
           WHERE reference_id = ?
           ORDER BY frame_index ASC, timestamp_sec ASC`
        )
        .all(refId) as unknown as Array<FrameFingerprint & { has_base64?: number }>;

      return rows.map(fp => {
        const candidateRoute = this.normalizeThumbnailRoute(fp.thumbnail_url) || this.normalizeThumbnailRoute(fp.thumbnail_path);
        if (candidateRoute && candidateRoute.startsWith('/thumbnails/')) {
          const diskPath = path.join(this.thumbnailsDir, path.basename(candidateRoute));
          if (this.isValidJpegFileOnDisk(diskPath)) {
            return {
              ...fp,
              image_available: true,
              thumbnail_data: undefined,
              thumbnail_url: candidateRoute,
              thumbnail_path: candidateRoute
            };
          }
        }
        if (fp.has_base64 === 1) {
          const b64Row = this.db
            .prepare(`SELECT thumbnail_data FROM reference_fingerprints WHERE id = ?`)
            .get(fp.id) as { thumbnail_data?: string } | undefined;
          const resolvedUrl = this.resolveAndRestoreThumbnail(fp.thumbnail_url, fp.thumbnail_path, b64Row?.thumbnail_data, fp.id);
          const hasDiskThumb = Boolean(resolvedUrl && resolvedUrl.startsWith('/thumbnails/'));
          return {
            ...fp,
            image_available: Boolean(resolvedUrl),
            thumbnail_data: hasDiskThumb ? undefined : b64Row?.thumbnail_data,
            thumbnail_url: resolvedUrl,
            thumbnail_path: hasDiskThumb ? resolvedUrl : undefined
          };
        }
        return {
          ...fp,
          image_available: false,
          thumbnail_data: undefined,
          thumbnail_url: undefined,
          thumbnail_path: undefined
        };
      });
    }

    const stmt = this.db.prepare(`
      SELECT * FROM reference_fingerprints WHERE reference_id = ? ORDER BY frame_index ASC, timestamp_sec ASC
    `);
    const rows = stmt.all(refId) as unknown as FrameFingerprint[];
    return rows.map(fp => {
      const resolvedUrl = this.resolveAndRestoreThumbnail(fp.thumbnail_url, fp.thumbnail_path, fp.thumbnail_data, fp.id);
      const hasDiskThumb = Boolean(resolvedUrl && resolvedUrl.startsWith('/thumbnails/'));
      const hasBase64Thumb = Boolean(fp.thumbnail_data && fp.thumbnail_data.startsWith('data:image/'));
      const imageAvailable = Boolean(hasDiskThumb || hasBase64Thumb);
      return {
        ...fp,
        image_available: imageAvailable,
        thumbnail_data: !imageAvailable
          ? undefined
          : omitBase64IfDiskThumbnailExists && hasDiskThumb
          ? undefined
          : fp.thumbnail_data,
        thumbnail_url: imageAvailable ? resolvedUrl : undefined,
        thumbnail_path: hasDiskThumb ? resolvedUrl : undefined
      };
    });
  }

  public getReferenceFingerprintsPaginated(
    refId: string,
    options?: { offset?: number; limit?: number; minTime?: number; maxTime?: number }
  ): { frames: FrameFingerprint[]; totalMatching: number } {
    const conditions = ['reference_id = ?'];
    const params: any[] = [refId];
    if (options?.minTime !== undefined && Number.isFinite(options.minTime)) {
      conditions.push('timestamp_sec >= ?');
      params.push(options.minTime);
    }
    if (options?.maxTime !== undefined && Number.isFinite(options.maxTime)) {
      conditions.push('timestamp_sec <= ?');
      params.push(options.maxTime);
    }
    const whereClause = conditions.join(' AND ');
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM reference_fingerprints WHERE ${whereClause}`)
      .get(...params) as { cnt: number };
    const totalMatching = Number(countRow?.cnt || 0);

    const limit = options?.limit !== undefined && options.limit > 0 ? Math.min(5000, options.limit) : 5000;
    const offset = options?.offset !== undefined && options.offset >= 0 ? options.offset : 0;

    const rows = this.db
      .prepare(
        `SELECT id, reference_id, timestamp_sec, frame_index, phash_hex, vhash_hex, crop_phash_hex, avg_luminance,
                thumbnail_path, thumbnail_url, created_at,
                CASE WHEN thumbnail_data LIKE 'data:image/%' THEN 1 ELSE 0 END AS has_base64
         FROM reference_fingerprints
         WHERE ${whereClause}
         ORDER BY frame_index ASC, timestamp_sec ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as unknown as Array<FrameFingerprint & { has_base64?: number }>;

    const frames = rows.map(fp => {
      const candidateRoute = this.normalizeThumbnailRoute(fp.thumbnail_url) || this.normalizeThumbnailRoute(fp.thumbnail_path);
      if (candidateRoute && candidateRoute.startsWith('/thumbnails/')) {
        const diskPath = path.join(this.thumbnailsDir, path.basename(candidateRoute));
        if (this.isValidJpegFileOnDisk(diskPath)) {
          return {
            ...fp,
            image_available: true,
            thumbnail_data: undefined,
            thumbnail_url: candidateRoute,
            thumbnail_path: candidateRoute
          };
        }
      }
      if (fp.has_base64 === 1) {
        const b64Row = this.db
          .prepare(`SELECT thumbnail_data FROM reference_fingerprints WHERE id = ?`)
          .get(fp.id) as { thumbnail_data?: string } | undefined;
        const resolvedUrl = this.resolveAndRestoreThumbnail(fp.thumbnail_url, fp.thumbnail_path, b64Row?.thumbnail_data, fp.id);
        const hasDiskThumb = Boolean(resolvedUrl && resolvedUrl.startsWith('/thumbnails/'));
        return {
          ...fp,
          image_available: Boolean(resolvedUrl),
          thumbnail_data: !resolvedUrl || hasDiskThumb ? undefined : b64Row?.thumbnail_data,
          thumbnail_url: resolvedUrl,
          thumbnail_path: hasDiskThumb ? resolvedUrl : undefined
        };
      }
      return {
        ...fp,
        image_available: false,
        thumbnail_data: undefined,
        thumbnail_url: undefined,
        thumbnail_path: undefined
      };
    });

    return { frames, totalMatching };
  }

  public clearCandidateFingerprints(candId: string): void {
    this.db.prepare(`DELETE FROM candidate_fingerprints WHERE candidate_id = ?`).run(candId);
  }

  public insertCandidateFingerprints(fps: FrameFingerprint[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO candidate_fingerprints (
        id, candidate_id, timestamp_sec, frame_index, phash_hex, vhash_hex, crop_phash_hex, avg_luminance, thumbnail_data, thumbnail_path, thumbnail_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const fp of fps) {
      stmt.run(
        fp.id,
        fp.candidate_id!,
        fp.timestamp_sec,
        fp.frame_index,
        fp.phash_hex,
        fp.vhash_hex || null,
        fp.crop_phash_hex || null,
        fp.avg_luminance ?? 0,
        fp.thumbnail_data || null,
        fp.thumbnail_path || fp.thumbnail_url || null,
        fp.thumbnail_url || fp.thumbnail_path || null,
        fp.created_at
      );
    }
  }

  public getCandidateFingerprints(candId: string): FrameFingerprint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM candidate_fingerprints WHERE candidate_id = ? ORDER BY frame_index ASC, timestamp_sec ASC
    `);
    return stmt.all(candId) as unknown as FrameFingerprint[];
  }

  // --- Persistent Discovery Sources Registry ---
  private hydrateDiscoverySource(row: any): DiscoverySourceRecord {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      source_type: row.source_type || 'configured_website',
      enabled: Boolean(row.enabled),
      last_scan_at: row.last_scan_at || undefined,
      last_scan_status: (row.last_scan_status as DiscoverySourceRecord['last_scan_status']) || 'IDLE',
      last_scan_outcome: row.last_scan_outcome || undefined,
      pages_inspected: Number(row.pages_inspected || 0),
      inspected_urls_json: row.inspected_urls_json || undefined,
      candidates_discovered: Number(row.candidates_discovered || 0),
      direct_media_found: Number(row.direct_media_found || 0),
      duplicates_merged: Number(row.duplicates_merged || 0),
      acquisitions_succeeded: Number(row.acquisitions_succeeded || 0),
      acquisitions_restricted: Number(row.acquisitions_restricted || 0),
      frames_extracted: Number(row.frames_extracted || 0),
      fingerprinted_count: Number(row.fingerprinted_count || 0),
      failure_reasons_json: row.failure_reasons_json || undefined,
      created_at: row.created_at
    };
  }

  public getDiscoverySources(): DiscoverySourceRecord[] {
    const rows = this.db.prepare(`SELECT * FROM discovery_sources ORDER BY created_at ASC`).all() as any[];
    return rows.map(r => this.hydrateDiscoverySource(r));
  }

  public getDiscoverySourceById(id: string): DiscoverySourceRecord | null {
    const row = this.db.prepare(`SELECT * FROM discovery_sources WHERE id = ?`).get(id) as any;
    return row ? this.hydrateDiscoverySource(row) : null;
  }

  public getDiscoverySourceByUrl(url: string): DiscoverySourceRecord | null {
    const normalized = url.trim().replace(/\/+$/, '') + '/';
    const row = this.db.prepare(`
      SELECT * FROM discovery_sources
      WHERE LOWER(url) = LOWER(?) OR LOWER(TRIM(url, '/')) = LOWER(TRIM(?, '/'))
      LIMIT 1
    `).get(url.trim(), normalized) as any;
    return row ? this.hydrateDiscoverySource(row) : null;
  }

  public upsertDiscoverySource(source: {
    id?: string;
    name: string;
    url: string;
    source_type?: string;
    enabled?: boolean;
  }): DiscoverySourceRecord {
    const existing = this.getDiscoverySourceByUrl(source.url) || (source.id ? this.getDiscoverySourceById(source.id) : null);
    if (existing) {
      this.db.prepare(`
        UPDATE discovery_sources
        SET name = COALESCE(?, name),
            source_type = COALESCE(?, source_type),
            enabled = COALESCE(?, enabled)
        WHERE id = ?
      `).run(
        source.name || null,
        source.source_type || null,
        source.enabled !== undefined ? (source.enabled ? 1 : 0) : null,
        existing.id
      );
      return this.getDiscoverySourceById(existing.id)!;
    }

    const id = source.id || `src_${crypto.randomBytes(4).toString('hex')}`;
    const nowIso = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO discovery_sources (
        id, name, url, source_type, enabled, last_scan_status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'IDLE', ?)
    `).run(
      id,
      source.name,
      source.url.trim(),
      source.source_type || 'configured_website',
      source.enabled !== false ? 1 : 0,
      nowIso
    );
    return this.getDiscoverySourceById(id)!;
  }

  public toggleDiscoverySource(id: string, enabled: boolean): DiscoverySourceRecord | null {
    this.db.prepare(`UPDATE discovery_sources SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
    return this.getDiscoverySourceById(id);
  }

  public updateDiscoverySourceTelemetry(
    id: string,
    telemetry: Partial<Omit<DiscoverySourceRecord, 'id' | 'name' | 'url' | 'source_type' | 'enabled' | 'created_at'>>
  ): DiscoverySourceRecord | null {
    const fields: string[] = [];
    const values: any[] = [];

    if (telemetry.last_scan_at !== undefined) { fields.push('last_scan_at = ?'); values.push(telemetry.last_scan_at); }
    if (telemetry.last_scan_status !== undefined) { fields.push('last_scan_status = ?'); values.push(telemetry.last_scan_status); }
    if (telemetry.last_scan_outcome !== undefined) { fields.push('last_scan_outcome = ?'); values.push(telemetry.last_scan_outcome); }
    if (telemetry.pages_inspected !== undefined) { fields.push('pages_inspected = ?'); values.push(telemetry.pages_inspected); }
    if (telemetry.inspected_urls_json !== undefined) { fields.push('inspected_urls_json = ?'); values.push(telemetry.inspected_urls_json); }
    if (telemetry.candidates_discovered !== undefined) { fields.push('candidates_discovered = ?'); values.push(telemetry.candidates_discovered); }
    if (telemetry.direct_media_found !== undefined) { fields.push('direct_media_found = ?'); values.push(telemetry.direct_media_found); }
    if (telemetry.duplicates_merged !== undefined) { fields.push('duplicates_merged = ?'); values.push(telemetry.duplicates_merged); }
    if (telemetry.acquisitions_succeeded !== undefined) { fields.push('acquisitions_succeeded = ?'); values.push(telemetry.acquisitions_succeeded); }
    if (telemetry.acquisitions_restricted !== undefined) { fields.push('acquisitions_restricted = ?'); values.push(telemetry.acquisitions_restricted); }
    if (telemetry.frames_extracted !== undefined) { fields.push('frames_extracted = ?'); values.push(telemetry.frames_extracted); }
    if (telemetry.fingerprinted_count !== undefined) { fields.push('fingerprinted_count = ?'); values.push(telemetry.fingerprinted_count); }
    if (telemetry.failure_reasons_json !== undefined) { fields.push('failure_reasons_json = ?'); values.push(telemetry.failure_reasons_json); }

    if (fields.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE discovery_sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    return this.getDiscoverySourceById(id);
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
    if (updates.query_params !== undefined) {
      fields.push('query_params = ?');
      values.push(updates.query_params);
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

  public getDiscoveryJobById(id: string): DiscoveryJob | null {
    const stmt = this.db.prepare(`SELECT * FROM discovery_jobs WHERE id = ?`);
    const row = stmt.get(id) as unknown as DiscoveryJob | undefined;
    return row || null;
  }

  // --- Coverage Snapshots ---
  public insertCoverageSnapshot(snap: SearchCoverageSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO coverage_snapshots (
        id, job_id, reference_id, reference_title, preset_mode,
        max_unique_candidates, deep_research_limit, forensic_comparison_limit,
        overall_estimated_coverage_pct, measured_source_inspection_pct,
        candidate_research_coverage_pct, forensic_comparison_coverage_pct,
        sources_configured, sources_checked, queries_executed, pages_discovered, pages_inspected,
        raw_discovered_count, unique_candidates_count, relevant_candidates_count,
        researched_candidates_count, awaiting_research_count, queued_for_comparison_count,
        compared_candidates_count, rejected_count, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      snap.id,
      snap.job_id || null,
      snap.reference_id || null,
      snap.reference_title || null,
      snap.preset_mode,
      snap.max_unique_candidates,
      snap.deep_research_limit,
      snap.forensic_comparison_limit,
      snap.overall_estimated_coverage_pct,
      snap.measured_source_inspection_pct,
      snap.candidate_research_coverage_pct,
      snap.forensic_comparison_coverage_pct,
      snap.sources_configured,
      snap.sources_checked,
      snap.queries_executed,
      snap.pages_discovered,
      snap.pages_inspected,
      snap.raw_discovered_count,
      snap.unique_candidates_count,
      snap.relevant_candidates_count,
      snap.researched_candidates_count,
      snap.awaiting_research_count,
      snap.queued_for_comparison_count,
      snap.compared_candidates_count,
      snap.rejected_count,
      snap.created_at
    );
  }

  public getCoverageSnapshots(filter?: { referenceId?: string; jobId?: string; limit?: number }): SearchCoverageSnapshot[] {
    let sql = `SELECT * FROM coverage_snapshots WHERE 1=1`;
    const params: any[] = [];
    if (filter?.referenceId) {
      sql += ` AND reference_id = ?`;
      params.push(filter.referenceId);
    }
    if (filter?.jobId) {
      sql += ` AND job_id = ?`;
      params.push(filter.jobId);
    }
    sql += ` ORDER BY created_at DESC`;
    const limit = filter?.limit && filter.limit > 0 ? Math.min(200, filter.limit) : 50;
    sql += ` LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      job_id: r.job_id || undefined,
      reference_id: r.reference_id || undefined,
      reference_title: r.reference_title || undefined,
      preset_mode: (r.preset_mode as DiscoveryPresetMode) || 'STANDARD',
      max_unique_candidates: Number(r.max_unique_candidates || 250),
      deep_research_limit: Number(r.deep_research_limit || 200),
      forensic_comparison_limit: Number(r.forensic_comparison_limit || 100),
      overall_estimated_coverage_pct: Number(r.overall_estimated_coverage_pct || 0),
      measured_source_inspection_pct: Number(r.measured_source_inspection_pct || 0),
      candidate_research_coverage_pct: Number(r.candidate_research_coverage_pct || 0),
      forensic_comparison_coverage_pct: Number(r.forensic_comparison_coverage_pct || 0),
      sources_configured: Number(r.sources_configured || 0),
      sources_checked: Number(r.sources_checked || 0),
      queries_executed: Number(r.queries_executed || 0),
      pages_discovered: Number(r.pages_discovered || 0),
      pages_inspected: Number(r.pages_inspected || 0),
      raw_discovered_count: Number(r.raw_discovered_count || 0),
      unique_candidates_count: Number(r.unique_candidates_count || 0),
      relevant_candidates_count: Number(r.relevant_candidates_count || 0),
      researched_candidates_count: Number(r.researched_candidates_count || 0),
      awaiting_research_count: Number(r.awaiting_research_count || 0),
      queued_for_comparison_count: Number(r.queued_for_comparison_count || 0),
      compared_candidates_count: Number(r.compared_candidates_count || 0),
      rejected_count: Number(r.rejected_count || 0),
      created_at: r.created_at
    }));
  }

  // --- Candidates ---
  private buildInitialProvenance(cand: CandidateItem): CandidateDiscoveryProvenance {
    if (cand.discovery_provenance) {
      return cand.discovery_provenance;
    }
    if (cand.discovery_provenance_json) {
      try {
        return JSON.parse(cand.discovery_provenance_json);
      } catch {}
    }
    const sourceTypes = (cand.source_type || 'title_search')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const matchMethods = (cand.match_method || 'title_match')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const referringPages = (cand.referring_page || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const matchedContentIds = [cand.matched_content_id, cand.reference_id]
      .filter((v): v is string => Boolean(v && v.trim()));

    return {
      source_types: Array.from(new Set(sourceTypes.length ? sourceTypes : ['title_search'])),
      source_urls: Array.from(new Set([cand.source_url, cand.original_url].filter((v): v is string => Boolean(v && v.trim())))),
      media_urls: Array.from(new Set([cand.media_url].filter((v): v is string => Boolean(v && v.trim())))),
      match_methods: Array.from(new Set(matchMethods.length ? matchMethods : ['title_match'])),
      matched_content_ids: Array.from(new Set(matchedContentIds)),
      referring_pages: Array.from(new Set(referringPages)),
      discovered_timestamps: [cand.discovered_at]
    };
  }

  public upsertCandidateWithResult(cand: CandidateItem): { inserted: boolean; merged: boolean; candidateId: string } {
    // Intelligent Deduplication & Merging:
    // 1. Keep distinct video assets (different non-empty media_url) separate even if they originate from the same webpage (source_url).
    // 2. Merge duplicate discoveries across configured websites, frame searches, and title searches when they point to the same media_url or same candidate webpage.
    const candMediaUrl = cand.media_url ? cand.media_url.trim() : '';
    const candSourceUrl = cand.source_url.trim();

    let existing: any = undefined;
    if (candMediaUrl) {
      // Match by identical media_url, OR where source_url matches an existing candidate that has no media_url yet (or the same media_url), OR where existing source_url equals this media_url
      existing = this.db.prepare(`
        SELECT *
        FROM candidates
        WHERE LOWER(media_url) = LOWER(?)
           OR LOWER(source_url) = LOWER(?)
           OR (LOWER(source_url) = LOWER(?) AND (media_url IS NULL OR media_url = '' OR LOWER(media_url) = LOWER(?)))
        ORDER BY discovered_at ASC
        LIMIT 1
      `).get(candMediaUrl, candMediaUrl, candSourceUrl, candMediaUrl) as any;
    } else {
      existing = this.db.prepare(`
        SELECT *
        FROM candidates
        WHERE LOWER(source_url) = LOWER(?)
           OR LOWER(media_url) = LOWER(?)
        ORDER BY discovered_at ASC
        LIMIT 1
      `).get(candSourceUrl, candSourceUrl) as any;
    }

    if (existing) {
      const prevKeywords = existing.matched_keywords ? String(existing.matched_keywords).split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      const newKeywords = cand.matched_keywords ? String(cand.matched_keywords).split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      const mergedKeywords = Array.from(new Set([...prevKeywords, ...newKeywords])).join(', ');

      const prevRefs = existing.referring_page ? String(existing.referring_page).split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      const newRefs = cand.referring_page ? String(cand.referring_page).split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      const mergedReferring = Array.from(new Set([...prevRefs, ...newRefs])).join(', ');

      const existingProv = this.buildInitialProvenance(existing as CandidateItem);
      const incomingProv = this.buildInitialProvenance(cand);

      const mergedProv: CandidateDiscoveryProvenance = {
        source_types: Array.from(new Set([...existingProv.source_types, ...incomingProv.source_types])),
        source_urls: Array.from(new Set([...existingProv.source_urls, ...incomingProv.source_urls])),
        media_urls: Array.from(new Set([...existingProv.media_urls, ...incomingProv.media_urls])),
        match_methods: Array.from(new Set([...existingProv.match_methods, ...incomingProv.match_methods])),
        matched_content_ids: Array.from(new Set([...existingProv.matched_content_ids, ...incomingProv.matched_content_ids])),
        referring_pages: Array.from(new Set([...existingProv.referring_pages, ...incomingProv.referring_pages])),
        discovered_timestamps: Array.from(new Set([...existingProv.discovered_timestamps, ...incomingProv.discovered_timestamps]))
      };

      const mergedOriginalUrl = existing.original_url || cand.original_url || cand.source_url;
      const nextDupCount = Number(existing.duplicate_count || 0) + 1;
      const mergedSourceType = mergedProv.source_types.join(', ');
      const mergedMatchMethod = mergedProv.match_methods.join(', ');
      const mergedMatchedContentId = existing.matched_content_id || existing.reference_id || cand.matched_content_id || cand.reference_id || null;
      const mergedReferenceId = existing.reference_id || cand.reference_id || cand.matched_content_id || null;
      const mergedMediaUrl = existing.media_url || cand.media_url || null;

      this.db.prepare(`
        UPDATE candidates
        SET duplicate_count = ?,
            matched_keywords = COALESCE(NULLIF(?, ''), matched_keywords),
            referring_page = COALESCE(NULLIF(?, ''), referring_page),
            original_url = COALESCE(original_url, ?),
            reference_id = COALESCE(reference_id, ?),
            matched_content_id = COALESCE(matched_content_id, ?),
            media_url = COALESCE(media_url, ?),
            source_type = ?,
            match_method = ?,
            discovery_provenance_json = ?,
            research_relevance_score = COALESCE(?, research_relevance_score),
            identity_relationship = COALESCE(?, identity_relationship),
            detected_identity_json = COALESCE(?, detected_identity_json),
            research_stage = COALESCE(?, research_stage),
            comparison_stage = COALESCE(?, comparison_stage)
        WHERE id = ?
      `).run(
        nextDupCount,
        mergedKeywords,
        mergedReferring,
        mergedOriginalUrl,
        mergedReferenceId,
        mergedMatchedContentId,
        mergedMediaUrl,
        mergedSourceType,
        mergedMatchMethod,
        JSON.stringify(mergedProv),
        cand.research_relevance_score ?? null,
        cand.identity_relationship ?? null,
        cand.detected_identity_json ?? (cand.candidate_research ? JSON.stringify(cand.candidate_research) : null),
        cand.research_stage ?? null,
        cand.comparison_stage ?? null,
        existing.id
      );
      return { inserted: false, merged: true, candidateId: existing.id };
    }

    const initialProv = this.buildInitialProvenance(cand);
    const sourceTypeVal = initialProv.source_types.join(', ');
    const matchMethodVal = initialProv.match_methods.join(', ');
    const matchedContentIdVal = cand.matched_content_id || cand.reference_id || null;

    const stmt = this.db.prepare(`
      INSERT INTO candidates (
        id, job_id, reference_id, matched_content_id, source_type, match_method, discovery_provenance_json,
        source_url, domain, discovered_title,
        discovery_provider, source_category, asset_kind, discovered_at, pipeline_status, reachability_code,
        reachability_latency_ms, media_type, media_resolution, media_duration_sec,
        is_live_stream, drm_scheme, raw_headers_json, verification_logs, last_inspected_at,
        media_url, canonical_url, platform, acquisition_status, frame_evidence,
        original_url, final_url, final_domain, referring_page, matched_keywords, crawl_status, duplicate_count, candidate_classification,
        research_relevance_score, identity_relationship, detected_identity_json, research_stage, comparison_stage
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      cand.id,
      cand.job_id || null,
      cand.reference_id || null,
      matchedContentIdVal,
      sourceTypeVal,
      matchMethodVal,
      JSON.stringify(initialProv),
      cand.source_url,
      cand.domain || 'unknown',
      cand.discovered_title || cand.source_url,
      cand.discovery_provider || 'SUSPECTED_PIRACY',
      cand.source_category || null,
      cand.asset_kind || null,
      cand.discovered_at || new Date().toISOString(),
      cand.pipeline_status || 'DISCOVERED',
      cand.reachability_code ?? 0,
      cand.reachability_latency_ms ?? 0,
      cand.media_type || 'MP4',
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
      cand.frame_evidence || null,
      cand.original_url || cand.source_url,
      cand.final_url || null,
      cand.final_domain || cand.domain || 'unknown',
      cand.referring_page || null,
      cand.matched_keywords || null,
      cand.crawl_status || 'DISCOVERED',
      cand.duplicate_count ?? 0,
      cand.candidate_classification || null,
      cand.research_relevance_score ?? null,
      cand.identity_relationship ?? null,
      cand.detected_identity_json ?? (cand.candidate_research ? JSON.stringify(cand.candidate_research) : null),
      cand.research_stage || null,
      cand.comparison_stage || null
    );
    return { inserted: true, merged: false, candidateId: cand.id };
  }

  public upsertCandidate(cand: CandidateItem): boolean {
    return this.upsertCandidateWithResult(cand).inserted;
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
    if (updates.thumbnail_url !== undefined) {
      fields.push('thumbnail_url = ?');
      values.push(updates.thumbnail_url);
    }
    if (updates.visual_similarity_score !== undefined) {
      fields.push('visual_similarity_score = ?');
      values.push(updates.visual_similarity_score);
    }
    if (updates.metadata_relevance_score !== undefined) {
      fields.push('metadata_relevance_score = ?');
      values.push(updates.metadata_relevance_score);
    }
    if (updates.overall_assessment !== undefined) {
      fields.push('overall_assessment = ?');
      values.push(updates.overall_assessment);
    }
    if (updates.original_url !== undefined) {
      fields.push('original_url = ?');
      values.push(updates.original_url);
    }
    if (updates.final_url !== undefined) {
      fields.push('final_url = ?');
      values.push(updates.final_url);
    }
    if (updates.final_domain !== undefined) {
      fields.push('final_domain = ?');
      values.push(updates.final_domain);
    }
    if (updates.referring_page !== undefined) {
      fields.push('referring_page = ?');
      values.push(updates.referring_page);
    }
    if (updates.matched_keywords !== undefined) {
      fields.push('matched_keywords = ?');
      values.push(updates.matched_keywords);
    }
    if (updates.crawl_status !== undefined) {
      fields.push('crawl_status = ?');
      values.push(updates.crawl_status);
    }
    if (updates.duplicate_count !== undefined) {
      fields.push('duplicate_count = ?');
      values.push(updates.duplicate_count);
    }
    if (updates.candidate_classification !== undefined) {
      fields.push('candidate_classification = ?');
      values.push(updates.candidate_classification);
    }
    if (updates.matched_content_id !== undefined) {
      fields.push('matched_content_id = ?');
      values.push(updates.matched_content_id);
    }
    if (updates.source_type !== undefined) {
      fields.push('source_type = ?');
      values.push(updates.source_type);
    }
    if (updates.match_method !== undefined) {
      fields.push('match_method = ?');
      values.push(updates.match_method);
    }
    if (updates.discovery_provenance_json !== undefined) {
      fields.push('discovery_provenance_json = ?');
      values.push(updates.discovery_provenance_json);
    }
    if (updates.research_relevance_score !== undefined) {
      fields.push('research_relevance_score = ?');
      values.push(updates.research_relevance_score);
    }
    if (updates.identity_relationship !== undefined) {
      fields.push('identity_relationship = ?');
      values.push(updates.identity_relationship);
    }
    if (updates.detected_identity_json !== undefined) {
      fields.push('detected_identity_json = ?');
      values.push(updates.detected_identity_json);
    } else if (updates.candidate_research !== undefined) {
      fields.push('detected_identity_json = ?');
      values.push(JSON.stringify(updates.candidate_research));
    }
    if (updates.research_stage !== undefined) {
      fields.push('research_stage = ?');
      values.push(updates.research_stage);
    }
    if (updates.comparison_stage !== undefined) {
      fields.push('comparison_stage = ?');
      values.push(updates.comparison_stage);
    }

    if (fields.length === 0) return;
    values.push(id);

    const stmt = this.db.prepare(`UPDATE candidates SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  private hydrateCandidateFrames(row: any): CandidateItem {
    let capturedFrames: any[] = [];
    if (row.frame_evidence) {
      try {
        const parsed = JSON.parse(row.frame_evidence);
        if (Array.isArray(parsed)) {
          capturedFrames = parsed;
        }
      } catch {}
    }

    const fps = this.getCandidateFingerprints(row.id);
    if (capturedFrames.length === 0 && fps.length > 0) {
      capturedFrames = fps.map(fp => {
        const thumb = fp.thumbnail_url || fp.thumbnail_path || fp.thumbnail_data || undefined;
        const prov = crypto
          .createHash('sha256')
          .update(`${row.source_url}|${fp.timestamp_sec}|${fp.phash_hex}|${fp.created_at}`)
          .digest('hex');
        return {
          frame_index: fp.frame_index,
          timestamp_sec: fp.timestamp_sec,
          phash_hex: fp.phash_hex,
          avg_luminance: fp.avg_luminance,
          thumbnail_url: thumb,
          captured_at: fp.created_at || row.last_inspected_at || row.discovered_at,
          source_url: row.source_url,
          platform: row.platform || row.domain,
          provenance_sha256: prov
        };
      });
    } else if (capturedFrames.length > 0 && fps.length > 0) {
      capturedFrames = capturedFrames.map((cf, idx) => {
        const matchingFp = fps.find(f => f.frame_index === cf.frame_index) || fps[idx];
        const thumb = cf.thumbnail_url || matchingFp?.thumbnail_url || matchingFp?.thumbnail_path || matchingFp?.thumbnail_data || undefined;
        return {
          ...cf,
          thumbnail_url: thumb
        };
      });
    }

    const firstThumb =
      row.thumbnail_url ||
      capturedFrames.find((f: any) => f.thumbnail_url)?.thumbnail_url ||
      fps.find(f => f.thumbnail_url || f.thumbnail_path || f.thumbnail_data)?.thumbnail_url ||
      fps.find(f => f.thumbnail_url || f.thumbnail_path || f.thumbnail_data)?.thumbnail_path ||
      fps.find(f => f.thumbnail_url || f.thumbnail_path || f.thumbnail_data)?.thumbnail_data ||
      undefined;

    const derivedClassification =
      row.candidate_classification ||
      (capturedFrames.length > 0 || row.asset_kind === 'VERIFIED_VIDEO_ASSET'
        ? 'VERIFIED_VIDEO_ASSET'
        : row.media_type === 'HLS_M3U8' || row.media_type === 'MP4' || row.media_type === 'WEBM' || row.pipeline_status === 'MEDIA_DETECTED' || row.pipeline_status === 'DRM_PROTECTED'
        ? 'VIDEO_ASSET'
        : row.asset_kind === 'ARTICLE'
        ? 'ARTICLE'
        : row.asset_kind === 'IMAGE'
        ? 'IMAGE'
        : 'GENERAL_WEBPAGE');

    const derivedCrawlStatus =
      row.crawl_status ||
      (row.pipeline_status === 'UNREACHABLE'
        ? 'UNREACHABLE'
        : row.pipeline_status === 'BLOCKED'
        ? 'BLOCKED'
        : row.pipeline_status === 'DRM_PROTECTED' || row.pipeline_status === 'REQUIRES_AUTHENTICATION'
        ? 'ACCESS_RESTRICTED'
        : row.reachability_code === 200
        ? 'CRAWLED_OK'
        : 'DISCOVERED');

    let parsedProvenance: CandidateDiscoveryProvenance | undefined = undefined;
    if (row.discovery_provenance_json) {
      try {
        parsedProvenance = JSON.parse(row.discovery_provenance_json);
      } catch {}
    }
    if (!parsedProvenance) {
      parsedProvenance = this.buildInitialProvenance(row as CandidateItem);
    }

    let parsedResearch: CandidateResearchEvaluation | undefined = undefined;
    if (row.detected_identity_json) {
      try {
        parsedResearch = JSON.parse(row.detected_identity_json);
      } catch {}
    }

    const baseHydrated: CandidateItem = {
      ...row,
      matched_content_id: row.matched_content_id || row.reference_id || undefined,
      source_type: row.source_type || (parsedProvenance?.source_types?.join(', ')) || 'title_search',
      match_method: row.match_method || (parsedProvenance?.match_methods?.join(', ')) || 'title_match',
      discovery_provenance: parsedProvenance,
      original_url: row.original_url || row.source_url,
      final_url: row.final_url || row.canonical_url || row.source_url,
      final_domain: row.final_domain || row.domain,
      crawl_status: derivedCrawlStatus,
      duplicate_count: Number(row.duplicate_count || 0),
      candidate_classification: derivedClassification,
      is_live_stream: Boolean(row.is_live_stream),
      thumbnail_url: firstThumb,
      captured_frames: capturedFrames,
      visual_similarity_score: row.visual_similarity_score !== null && row.visual_similarity_score !== undefined ? Number(row.visual_similarity_score) : undefined,
      metadata_relevance_score: row.metadata_relevance_score !== null && row.metadata_relevance_score !== undefined ? Number(row.metadata_relevance_score) : undefined,
      overall_assessment: row.overall_assessment || undefined,
      research_relevance_score: row.research_relevance_score !== null && row.research_relevance_score !== undefined ? Number(row.research_relevance_score) : undefined,
      identity_relationship: row.identity_relationship || undefined,
      detected_identity_json: row.detected_identity_json || undefined,
      candidate_research: parsedResearch,
      research_stage: row.research_stage || (parsedResearch ? 'RESEARCHED' : 'AWAITING_RESEARCH'),
      comparison_stage:
        row.comparison_stage ||
        (row.pipeline_status === 'ANALYZED' || Boolean(row.last_inspected_at)
          ? 'COMPARED'
          : 'QUEUED_FOR_COMPARISON')
    };

    if (!baseHydrated.candidate_research) {
      const refId = baseHydrated.reference_id || baseHydrated.matched_content_id;
      const targetRef = refId ? this.getReferenceById(refId) : null;
      const evalRes = CandidateResearchEngine.evaluateCandidateAgainstTarget({
        candidate: baseHydrated,
        reference: targetRef
      });
      baseHydrated.candidate_research = evalRes;
      baseHydrated.research_relevance_score = evalRes.research_relevance_score;
      baseHydrated.identity_relationship = evalRes.identity_relationship;
    }

    return baseHydrated;
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
    const hydrated = rows.map(r => this.hydrateCandidateFrames(r));
    return CandidateResearchEngine.rankCandidates(hydrated);
  }

  public getCandidateById(id: string): CandidateItem | null {
    const stmt = this.db.prepare(`SELECT * FROM candidates WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.hydrateCandidateFrames(row);
  }

  // --- Evidence Records ---
  public insertEvidenceRecord(record: EvidenceRecord): void {
    // Delete existing evidence for same candidate to avoid duplicates upon re-verification
    const del = this.db.prepare(`DELETE FROM evidence_records WHERE candidate_id = ?`);
    del.run(record.candidate_id);

    const cov = record.coverage_metrics;
    const stmt = this.db.prepare(`
      INSERT INTO evidence_records (
        id, candidate_id, reference_id, candidate_url, candidate_domain,
        candidate_platform, candidate_title,
        reference_title, rights_holder, match_status, match_classification, confidence_score,
        visual_similarity_score, metadata_relevance_score, overall_assessment,
        metadata_signals_json, captured_frames_json, uncertainty_reasons_json,
        min_hamming_dist, avg_hamming_dist, matched_frames_count, total_compared_frames,
        reference_duration_sec, candidate_duration_sec,
        total_reference_frames, total_candidate_frames,
        unique_reference_frames_matched, unique_candidate_frames_matched,
        reference_coverage_pct, candidate_coverage_pct, coverage_metrics_json,
        temporal_offset_sec, sample_pairs_json, audio_match_json, chain_of_custody_sha256,
        reviewed_by, review_decision, review_notes, reviewed_at, takedown_generated_at,
        takedown_notice_text, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    stmt.run(
      record.id,
      record.candidate_id,
      record.reference_id,
      record.candidate_url,
      record.candidate_domain,
      record.candidate_platform || null,
      record.candidate_title || null,
      record.reference_title,
      record.rights_holder,
      record.match_status,
      record.match_classification || null,
      record.confidence_score ?? 0,
      record.visual_similarity_score ?? null,
      record.metadata_relevance_score ?? null,
      record.overall_assessment || null,
      record.metadata_signals ? JSON.stringify(record.metadata_signals) : null,
      record.captured_frames ? JSON.stringify(record.captured_frames) : null,
      record.uncertainty_reasons ? JSON.stringify(record.uncertainty_reasons) : null,
      record.min_hamming_dist ?? 0,
      record.avg_hamming_dist ?? 0,
      record.matched_frames_count ?? 0,
      record.total_compared_frames ?? 0,
      record.reference_duration_sec ?? cov?.reference_duration_sec ?? null,
      record.candidate_duration_sec ?? cov?.candidate_duration_sec ?? null,
      record.total_reference_frames ?? cov?.total_reference_frames ?? null,
      record.total_candidate_frames ?? cov?.total_candidate_frames ?? record.total_compared_frames ?? null,
      record.unique_reference_frames_matched ?? cov?.unique_reference_frames_matched ?? null,
      record.unique_candidate_frames_matched ?? cov?.unique_candidate_frames_matched ?? null,
      record.reference_coverage_pct ?? cov?.reference_coverage_pct ?? null,
      record.candidate_coverage_pct ?? cov?.candidate_coverage_pct ?? null,
      cov ? JSON.stringify(cov) : null,
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

  private hydrateEvidenceRecord(r: any): EvidenceRecord {
    const samplePairs = this.sanitizeSamplePairs(JSON.parse(r.sample_pairs_json || '[]'));
    let capturedFrames: any[] = [];
    if (r.captured_frames_json) {
      try {
        const parsed = JSON.parse(r.captured_frames_json);
        if (Array.isArray(parsed)) capturedFrames = parsed;
      } catch {}
    }

    const cand = r.candidate_id ? this.getCandidateById(r.candidate_id) : null;
    if (capturedFrames.length === 0 && cand?.captured_frames && cand.captured_frames.length > 0) {
      capturedFrames = cand.captured_frames;
    } else if (capturedFrames.length > 0 && cand?.captured_frames && cand.captured_frames.length > 0) {
      capturedFrames = capturedFrames.map((cf, idx) => ({
        ...cf,
        thumbnail_url: cf.thumbnail_url || cand.captured_frames?.[idx]?.thumbnail_url
      }));
    }

    const metadataSignals = r.metadata_signals_json ? JSON.parse(r.metadata_signals_json) : undefined;
    const uncertaintyReasons = r.uncertainty_reasons_json ? JSON.parse(r.uncertainty_reasons_json) : undefined;
    let coverageMetrics = undefined;
    if (r.coverage_metrics_json) {
      try {
        coverageMetrics = JSON.parse(r.coverage_metrics_json);
      } catch {}
    }

    let visualSimScore: number | undefined =
      r.visual_similarity_score !== null && r.visual_similarity_score !== undefined
        ? Number(r.visual_similarity_score)
        : cand?.visual_similarity_score;

    if (visualSimScore === undefined && samplePairs.length > 0) {
      const sims = samplePairs.map((p: any) =>
        typeof p.similarity_pct === 'number'
          ? p.similarity_pct / 100
          : Math.max(0, (64 - (p.hamming_dist ?? 64)) / 64)
      );
      const bestSim = Math.max(...sims);
      const avgSim = sims.reduce((acc: number, v: number) => acc + v, 0) / sims.length;
      visualSimScore = Number((bestSim * 0.6 + avgSim * 0.4).toFixed(4));
    }

    const overallAssessment =
      r.overall_assessment ||
      cand?.overall_assessment ||
      (r.match_status === 'POTENTIAL_MATCH' || r.match_status === 'CONFIRMED_INFRINGEMENT'
        ? 'MATCH_FOUND'
        : r.match_status === 'INSUFFICIENT_EVIDENCE'
        ? 'INSUFFICIENT_EVIDENCE'
        : 'NO_MATCH_FOUND');

    return {
      ...r,
      candidate_platform: r.candidate_platform || cand?.platform || cand?.domain,
      candidate_title: r.candidate_title || cand?.discovered_title,
      visual_similarity_score: visualSimScore,
      metadata_relevance_score:
        r.metadata_relevance_score !== null && r.metadata_relevance_score !== undefined
          ? Number(r.metadata_relevance_score)
          : cand?.metadata_relevance_score,
      overall_assessment: overallAssessment,
      metadata_signals: metadataSignals,
      captured_frames: capturedFrames,
      uncertainty_reasons: uncertaintyReasons,
      reference_duration_sec:
        r.reference_duration_sec !== null && r.reference_duration_sec !== undefined
          ? Number(r.reference_duration_sec)
          : coverageMetrics?.reference_duration_sec,
      candidate_duration_sec:
        r.candidate_duration_sec !== null && r.candidate_duration_sec !== undefined
          ? Number(r.candidate_duration_sec)
          : coverageMetrics?.candidate_duration_sec,
      total_reference_frames:
        r.total_reference_frames !== null && r.total_reference_frames !== undefined
          ? Number(r.total_reference_frames)
          : coverageMetrics?.total_reference_frames,
      total_candidate_frames:
        r.total_candidate_frames !== null && r.total_candidate_frames !== undefined
          ? Number(r.total_candidate_frames)
          : coverageMetrics?.total_candidate_frames,
      unique_reference_frames_matched:
        r.unique_reference_frames_matched !== null && r.unique_reference_frames_matched !== undefined
          ? Number(r.unique_reference_frames_matched)
          : coverageMetrics?.unique_reference_frames_matched,
      unique_candidate_frames_matched:
        r.unique_candidate_frames_matched !== null && r.unique_candidate_frames_matched !== undefined
          ? Number(r.unique_candidate_frames_matched)
          : coverageMetrics?.unique_candidate_frames_matched,
      reference_coverage_pct:
        r.reference_coverage_pct !== null && r.reference_coverage_pct !== undefined
          ? Number(r.reference_coverage_pct)
          : coverageMetrics?.reference_coverage_pct,
      candidate_coverage_pct:
        r.candidate_coverage_pct !== null && r.candidate_coverage_pct !== undefined
          ? Number(r.candidate_coverage_pct)
          : coverageMetrics?.candidate_coverage_pct,
      coverage_metrics: coverageMetrics,
      sample_pairs: samplePairs,
      audio_match: (() => {
        if (!r.audio_match_json) return undefined;
        try {
          return typeof r.audio_match_json === 'string' ? JSON.parse(r.audio_match_json) : r.audio_match_json;
        } catch {
          return undefined;
        }
      })()
    };
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
    return rows.map(r => this.hydrateEvidenceRecord(r));
  }

  public getEvidenceById(id: string): EvidenceRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM evidence_records WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.hydrateEvidenceRecord(row);
  }

  // --- Statistics Calculation ---
  public getSystemStats(): SystemStats {
    const totalRefRow = this.db.prepare(`SELECT COUNT(*) as count FROM reference_items`).get() as any;
    const activeJobsRow = this.db.prepare(`SELECT COUNT(*) as count FROM discovery_jobs WHERE status = 'RUNNING'`).get() as any;
    const totalCandRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates`).get() as any;
    const reachableRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates WHERE pipeline_status IN ('REACHABLE', 'MEDIA_DETECTED', 'ACQUIRED', 'ANALYZED')`).get() as any;
    const mediaDetectedRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates WHERE pipeline_status IN ('MEDIA_DETECTED', 'ACQUIRED', 'ANALYZED')`).get() as any;
    const analyzedRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates WHERE pipeline_status = 'ANALYZED'`).get() as any;
    const inaccessibleRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates WHERE pipeline_status IN ('UNREACHABLE', 'DRM_PROTECTED', 'BLOCKED', 'REQUIRES_AUTHENTICATION', 'UNSUPPORTED', 'RATE_LIMITED')`).get() as any;
    const duplicateRow = this.db.prepare(`SELECT COALESCE(SUM(duplicate_count), 0) as count FROM candidates`).get() as any;
    const verifiedVideoRow = this.db.prepare(`SELECT COUNT(*) as count FROM candidates WHERE pipeline_status IN ('ACQUIRED', 'ANALYZED') OR asset_kind = 'VERIFIED_VIDEO_ASSET'`).get() as any;
    const potentialMatchesRow = this.db.prepare(`SELECT COUNT(*) as count FROM evidence_records WHERE match_status IN ('POTENTIAL_MATCH', 'CONFIRMED_INFRINGEMENT')`).get() as any;
    const confirmedRow = this.db.prepare(`SELECT COUNT(*) as count FROM evidence_records WHERE review_decision = 'CONFIRMED' OR match_status = 'CONFIRMED_INFRINGEMENT'`).get() as any;
    const pendingReviewsRow = this.db.prepare(`SELECT COUNT(*) as count FROM evidence_records WHERE review_decision = 'PENDING'`).get() as any;

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
      inaccessible_candidates: Number(inaccessibleRow.count || 0),
      duplicate_candidates: Number(duplicateRow.count || 0),
      verified_video_candidates: Number(verifiedVideoRow.count || 0),
      potential_matches: Number(potentialMatchesRow.count || 0),
      confirmed_infringements: Number(confirmedRow.count || 0),
      pending_reviews: Number(pendingReviewsRow.count || 0),
      asset_type_breakdown: assetBreakdown,
      provider_breakdown: providerBreakdown
    };
  }

  /**
   * Known accidental CLI adapter verification record IDs that leaked into the production database
   * when ARGUS_DB_PATH was previously ignored by ArgusDatabase constructor.
   */
  public static readonly ACCIDENTAL_ADAPTER_TEST_REFERENCE_IDS = new Set<string>([
    'ref_1793372833942_0ulmq',   // "Me at the zoo" (YouTube adapter CLI check)
    'ref_1793372831999_ig9uzq',  // "The New Vimeo Player (You Know, For Videos)" (Vimeo adapter CLI check)
    'ref_1793372827941_2cl9e',   // "Cat lapping water off ground in slow motion.gk" (Wikimedia adapter CLI check)
    'ref_1793372819547_g2ntiw',  // "point-opinion : Center for Accessible Technology in Sign" (Internet Archive adapter CLI check)
    'ref_1793372797540_3io03e'   // "Zelenskyy Calls for European Involvement..." (Dailymotion adapter CLI check)
  ]);

  /**
   * Determines whether a reference record is user-owned vs. a synthetic system/test fixture.
   * User-owned references must NEVER be automatically deleted, overwritten, or reset.
   */
  public isUserOwnedReference(ref: {
    id: string;
    title?: string;
    source_type?: string;
    source_url?: string;
    file_path?: string;
    status?: string;
    fingerprint_count?: number;
  }): boolean {
    if (!ref) return false;
    // Accidental CLI adapter verification fixtures are never user-owned
    if (ArgusDatabase.ACCIDENTAL_ADAPTER_TEST_REFERENCE_IDS.has(ref.id)) {
      return false;
    }
    // Any reference whose file_path points to a genuine user file upload (upl_*) in /uploads/ is user-owned
    if (ref.file_path && String(ref.file_path).includes('/uploads/') && path.basename(String(ref.file_path)).startsWith('upl_')) {
      return true;
    }
    // Any reference not explicitly tagged as FORENSIC_SAMPLE is user-owned
    if (ref.source_type && ref.source_type !== 'FORENSIC_SAMPLE') {
      return true;
    }
    // Any reference that has been genuinely fingerprinted or partially extracted (and is not a FORENSIC_SAMPLE) is user-owned
    if (
      ref.source_type !== 'FORENSIC_SAMPLE' &&
      (ref.status === 'FINGERPRINTED' || ref.status === 'PROCESSING') &&
      (ref.fingerprint_count || 0) > 0
    ) {
      return true;
    }
    return false;
  }

  /**
   * Removes ONLY confirmed synthetic FORENSIC_SAMPLE records, accidental CLI adapter test fixtures,
   * and their orphaned demo jobs/candidates/evidence/files.
   * Strictly preserves all user-registered references (including "Modern Family" ref_1793160884340_35piql
   * and "Taylor Swift — Patient Zero" ref_1793156120718_ts_user).
   */
  public purgeConfirmedSyntheticForensicSamples(): {
    removedReferences: Array<{ id: string; title: string; source_type: string; file_path?: string; reason: string }>;
    removedJobs: number;
    removedCandidates: number;
    removedEvidence: number;
  } {
    const allRefs = this.db
      .prepare(`SELECT id, title, source_type, source_url, file_path, status, fingerprint_count, notes FROM reference_items`)
      .all() as Array<{
      id: string;
      title: string;
      source_type: string;
      source_url?: string;
      file_path?: string;
      status: string;
      fingerprint_count: number;
      notes?: string;
    }>;

    const removedReferences: Array<{ id: string; title: string; source_type: string; file_path?: string; reason: string }> = [];
    const confirmedFakeRefIds: string[] = [];

    for (const ref of allRefs) {
      if (this.isUserOwnedReference(ref)) {
        // Ensure any user-owned reference with an uploaded file in /uploads/ is never left with source_type = 'FORENSIC_SAMPLE'
        if (ref.source_type === 'FORENSIC_SAMPLE' && ref.file_path && ref.file_path.includes('/uploads/')) {
          this.db.prepare(`UPDATE reference_items SET source_type = 'UPLOAD' WHERE id = ?`).run(ref.id);
        }
        continue;
      }

      if (ArgusDatabase.ACCIDENTAL_ADAPTER_TEST_REFERENCE_IDS.has(ref.id)) {
        confirmedFakeRefIds.push(ref.id);
        removedReferences.push({
          id: ref.id,
          title: ref.title,
          source_type: ref.source_type,
          file_path: ref.file_path,
          reason: `Accidental CLI adapter verification fixture (${ref.source_url || ref.title}) created when ARGUS_DB_PATH was not isolated`
        });
        continue;
      }

      const isSyntheticSampleSource = ref.source_type === 'FORENSIC_SAMPLE';
      const isSyntheticMediaPath =
        !ref.file_path ||
        ref.file_path.includes('/data/media/arsenal_bayern_') ||
        ref.file_path.includes('/data/media/ucl_') ||
        ref.file_path.includes('/data/media/apex_horizon_') ||
        ref.file_path.includes('/data/media/taylor_swift_patient_zero_master.mp4');

      if (isSyntheticSampleSource && isSyntheticMediaPath) {
        confirmedFakeRefIds.push(ref.id);
        removedReferences.push({
          id: ref.id,
          title: ref.title,
          source_type: ref.source_type,
          file_path: ref.file_path,
          reason:
            ref.notes && ref.notes.includes('testsrc')
              ? `Synthetic FORENSIC_SAMPLE fixture with FFmpeg testsrc colour bars (${ref.file_path || 'no file'})`
              : `System-generated FORENSIC_SAMPLE demo fixture (${ref.file_path || 'synthetic fixture'})`
        });
      }
    }

    // Delete confirmed fake/accidental references, their fingerprints/evidence, and any associated downloaded test files/thumbnails
    let removedEvidence = 0;
    let removedCandidates = 0;
    let removedJobs = 0;

    for (const fakeId of confirmedFakeRefIds) {
      const refRow = allRefs.find(r => r.id === fakeId);
      const fpsToRemove = this.db
        .prepare(`SELECT thumbnail_url, thumbnail_path FROM reference_fingerprints WHERE reference_id = ?`)
        .all(fakeId) as Array<{ thumbnail_url?: string; thumbnail_path?: string }>;

      const evDel = this.db.prepare(`DELETE FROM evidence_records WHERE reference_id = ?`).run(fakeId);
      removedEvidence += Number(evDel.changes);

      this.db
        .prepare(
          `DELETE FROM candidate_fingerprints WHERE candidate_id IN (SELECT id FROM candidates WHERE reference_id = ?)`
        )
        .run(fakeId);

      const candDel = this.db.prepare(`DELETE FROM candidates WHERE reference_id = ?`).run(fakeId);
      removedCandidates += Number(candDel.changes);

      const jobDel = this.db.prepare(`DELETE FROM discovery_jobs WHERE target_reference_id = ?`).run(fakeId);
      removedJobs += Number(jobDel.changes);

      this.db.prepare(`DELETE FROM reference_fingerprints WHERE reference_id = ?`).run(fakeId);
      this.db.prepare(`DELETE FROM reference_items WHERE id = ?`).run(fakeId);

      // Clean up associated thumbnail JPEGs for removed synthetic/test references
      for (const fp of fpsToRemove) {
        const route = fp.thumbnail_url || fp.thumbnail_path;
        if (route) {
          const thumbDiskPath = path.join(this.thumbnailsDir, path.basename(route));
          try {
            if (fs.existsSync(thumbDiskPath)) fs.unlinkSync(thumbDiskPath);
          } catch {}
        }
      }

      // Clean up downloaded url_ref_* / url_hls_* media files belonging to accidental adapter test references
      if (
        refRow?.file_path &&
        (path.basename(refRow.file_path).startsWith('url_ref_') || path.basename(refRow.file_path).startsWith('url_hls_'))
      ) {
        try {
          if (fs.existsSync(refRow.file_path)) fs.unlinkSync(refRow.file_path);
        } catch {}
      }
    }

    // Also clean up orphaned synthetic demo jobs and candidates if their target reference does not exist as a user-owned reference
    const remainingUserRefIds = new Set(
      (this.db.prepare(`SELECT id FROM reference_items`).all() as Array<{ id: string }>).map(r => r.id)
    );
    const sampleJobIds = ['job_sweep_sports_demo', 'job_sweep_taylor_swift_patient_zero', 'job_sweep_apex_vod'];
    for (const jobId of sampleJobIds) {
      const jobRow = this.db
        .prepare(`SELECT id, target_reference_id FROM discovery_jobs WHERE id = ?`)
        .get(jobId) as { id: string; target_reference_id?: string } | undefined;
      if (jobRow && (!jobRow.target_reference_id || !remainingUserRefIds.has(jobRow.target_reference_id))) {
        this.db
          .prepare(`DELETE FROM evidence_records WHERE candidate_id IN (SELECT id FROM candidates WHERE job_id = ?)`)
          .run(jobId);
        this.db
          .prepare(`DELETE FROM candidate_fingerprints WHERE candidate_id IN (SELECT id FROM candidates WHERE job_id = ?)`)
          .run(jobId);
        const cDel = this.db.prepare(`DELETE FROM candidates WHERE job_id = ?`).run(jobId);
        removedCandidates += Number(cDel.changes);
        const jDel = this.db.prepare(`DELETE FROM discovery_jobs WHERE id = ?`).run(jobId);
        removedJobs += Number(jDel.changes);
      }
    }

    // Clean up orphaned synthetic test candidates (cand_dedup_*, cand_sports_*, cand_ts_*, cand_apex_*) not linked to any existing user reference
    const orphanCandidates = this.db
      .prepare(
        `SELECT id, reference_id FROM candidates WHERE id LIKE 'cand_dedup_%' OR id LIKE 'cand_sports_%' OR id LIKE 'cand_ts_%' OR id LIKE 'cand_apex_%'`
      )
      .all() as Array<{ id: string; reference_id?: string }>;
    for (const oc of orphanCandidates) {
      if (!oc.reference_id || !remainingUserRefIds.has(oc.reference_id)) {
        const evDel = this.db.prepare(`DELETE FROM evidence_records WHERE candidate_id = ?`).run(oc.id);
        removedEvidence += Number(evDel.changes);
        this.db.prepare(`DELETE FROM candidate_fingerprints WHERE candidate_id = ?`).run(oc.id);
        const cDel = this.db.prepare(`DELETE FROM candidates WHERE id = ?`).run(oc.id);
        removedCandidates += Number(cDel.changes);
      }
    }

    return {
      removedReferences,
      removedJobs,
      removedCandidates,
      removedEvidence
    };
  }

  // --- Durable User-Reference Journal, Tombstone Protection & Orphan Upload Recovery ---
  private getTombstonesPath(): string {
    return path.join(path.dirname(this.dbFilePath), 'deleted_references_tombstones.json');
  }

  private getUserReferencesJournalPath(): string {
    return path.join(path.dirname(this.dbFilePath), 'user_references_journal.json');
  }

  public getTombstonedReferenceIds(): Set<string> {
    try {
      const p = this.getTombstonesPath();
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter(x => typeof x === 'string'));
        }
      }
    } catch {}
    return new Set<string>();
  }

  private recordTombstonedReferenceId(id: string): void {
    if (!id) return;
    try {
      const current = this.getTombstonedReferenceIds();
      current.add(id);
      fs.writeFileSync(this.getTombstonesPath(), JSON.stringify(Array.from(current), null, 2));
    } catch {}
  }

  private clearTombstonedReferenceId(id: string): void {
    if (!id) return;
    try {
      const p = this.getTombstonesPath();
      if (!fs.existsSync(p)) return;
      const current = this.getTombstonedReferenceIds();
      if (current.has(id)) {
        current.delete(id);
        fs.writeFileSync(p, JSON.stringify(Array.from(current), null, 2));
      }
    } catch {}
  }

  /**
   * Synchronizes all active user-owned references and their compact fingerprint index
   * to a durable journal file (`user_references_journal.json`) alongside the SQLite database.
   * Ensures that even if SQLite tables are ever reset or migrated, user-created references
   * (that have not been explicitly deleted) can be deterministically restored.
   */
  public syncUserReferencesJournal(): void {
    try {
      const tombstones = this.getTombstonedReferenceIds();
      const allRefs = this.db
        .prepare(`SELECT * FROM reference_items ORDER BY created_at DESC`)
        .all() as unknown as ReferenceItem[];

      const userRefs = allRefs.filter(r => this.isUserOwnedReference(r) && !tombstones.has(r.id));
      const existingJournalMap = new Map<string, any>();
      const journalPath = this.getUserReferencesJournalPath();
      if (fs.existsSync(journalPath)) {
        try {
          const prev = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
          if (Array.isArray(prev?.references)) {
            for (const entry of prev.references) {
              if (entry?.reference?.id && !tombstones.has(entry.reference.id)) {
                existingJournalMap.set(entry.reference.id, entry);
              }
            }
          }
        } catch {}
      }

      const fpSelectStmt = this.db.prepare(`
        SELECT id, reference_id, timestamp_sec, frame_index, phash_hex, vhash_hex, crop_phash_hex,
               avg_luminance, thumbnail_data, thumbnail_path, thumbnail_url, created_at
        FROM reference_fingerprints
        WHERE reference_id = ?
        ORDER BY frame_index ASC, timestamp_sec ASC
      `);

      for (const ref of userRefs) {
        const fps = fpSelectStmt.all(ref.id) as any[];
        const prevEntry = existingJournalMap.get(ref.id);
        // Never overwrite a previously journaled complete fingerprint index with an empty array unless explicitly cleared
        const effectiveFps =
          fps.length > 0
            ? fps
            : Array.isArray(prevEntry?.fingerprints) && prevEntry.fingerprints.length > 0 && ref.status !== 'INVALID'
            ? prevEntry.fingerprints
            : [];
        existingJournalMap.set(ref.id, {
          reference: ref,
          fingerprints: effectiveFps,
          updatedAt: new Date().toISOString()
        });
      }

      // Remove any tombstoned references from the journal
      for (const tId of tombstones) {
        existingJournalMap.delete(tId);
      }

      const payload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        references: Array.from(existingJournalMap.values())
      };
      const tmpPath = `${journalPath}.tmp_${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload));
      fs.renameSync(tmpPath, journalPath);
    } catch {}
  }

  /**
   * Restores any user-owned references present in `user_references_journal.json` that are
   * missing from `reference_items` (or missing their `reference_fingerprints` rows) and have
   * not been explicitly deleted by the user.
   */
  public restoreMissingUserReferencesFromJournal(): ReferenceItem[] {
    const restored: ReferenceItem[] = [];
    try {
      const journalPath = this.getUserReferencesJournalPath();
      if (!fs.existsSync(journalPath)) return restored;

      const parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      const entries: Array<{ reference: ReferenceItem; fingerprints?: FrameFingerprint[] }> = Array.isArray(parsed?.references)
        ? parsed.references
        : [];
      if (entries.length === 0) return restored;

      const tombstones = this.getTombstonedReferenceIds();

      for (const entry of entries) {
        const ref = entry?.reference;
        if (!ref || !ref.id || tombstones.has(ref.id) || !this.isUserOwnedReference(ref)) {
          continue;
        }

        const existingRow = this.db.prepare(`SELECT id, fingerprint_count FROM reference_items WHERE id = ?`).get(ref.id) as
          | { id: string; fingerprint_count: number }
          | undefined;
        const existingFpCountRow = this.db
          .prepare(`SELECT COUNT(*) as cnt FROM reference_fingerprints WHERE reference_id = ?`)
          .get(ref.id) as { cnt: number };
        const existingFpCount = Number(existingFpCountRow?.cnt || 0);
        const journalFps = Array.isArray(entry.fingerprints) ? entry.fingerprints : [];

        if (!existingRow) {
          this.upsertReference(ref);
          if (journalFps.length > 0) {
            this.insertReferenceFingerprints(journalFps);
            this.syncReferenceExtractionCompleteness(ref.id);
          }
          const hydrated = this.getReferenceById(ref.id);
          if (hydrated) restored.push(hydrated);
        } else if (existingFpCount === 0 && journalFps.length > 0 && ref.status !== 'INVALID') {
          this.insertReferenceFingerprints(journalFps);
          this.syncReferenceExtractionCompleteness(ref.id);
          const hydrated = this.getReferenceById(ref.id);
          if (hydrated) restored.push(hydrated);
        }
      }
    } catch (err: any) {
      console.warn('[Journal Restore Notice]', err.message);
    }
    return restored;
  }

  /**
   * Scans the `uploads/` directory and `thumbnails/` directory for user-uploaded master videos
   * (`upl_<ts>_<hex>-<filename>`) and extracted frame thumbnail sets (`thumb_ref_<ts>_<suffix>_*.jpg`)
   * that are not yet registered in `reference_items` (e.g., if a multi-hour video upload finished
   * extracting frames right before a server restart or UI update), and recovers them into SQLite.
   */
  public recoverOrphanedUploadedReferences(options?: {
    uploadsDir?: string;
    sessionRegistryPath?: string;
  }): ReferenceItem[] {
    const recovered: ReferenceItem[] = [];
    try {
      const uploadsDir = options?.uploadsDir
        ? path.resolve(options.uploadsDir)
        : path.resolve(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) return recovered;

      const tombstones = this.getTombstonedReferenceIds();

      // Load optional persisted upload session registry if present
      const registryPath =
        options?.sessionRegistryPath || path.join(uploadsDir, 'upload_sessions_registry.json');
      const sessionByUploadId = new Map<string, any>();
      if (fs.existsSync(registryPath)) {
        try {
          const regData = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
          const sessions = Array.isArray(regData?.sessions) ? regData.sessions : [];
          for (const s of sessions) {
            if (s?.uploadId) {
              sessionByUploadId.set(String(s.uploadId), s);
            }
          }
        } catch {}
      }

      const existingRefs = this.db
        .prepare(`SELECT id, title, file_path, provenance_sha256 FROM reference_items`)
        .all() as Array<{ id: string; title: string; file_path?: string; provenance_sha256?: string }>;

      const existingIds = new Set(existingRefs.map(r => r.id));
      const existingFilePaths = new Set(
        existingRefs.map(r => (r.file_path ? path.resolve(r.file_path) : '')).filter(Boolean)
      );
      const existingSuffixes = new Set(
        existingRefs
          .map(r =>
            r.file_path
              ? path
                  .basename(r.file_path)
                  .replace(/^upl_\d+_[a-f0-9]+-/i, '')
                  .toLowerCase()
              : ''
          )
          .filter(Boolean)
      );

      // Index any orphaned thumb_ref_<ts>_<suffix>_<idx>.jpg batches in thumbnailsDir
      const orphanThumbBatches = new Map<
        string,
        { refId: string; refTimestampMs: number; count: number; maxIndex: number }
      >();
      if (fs.existsSync(this.thumbnailsDir)) {
        const thumbFiles = fs.readdirSync(this.thumbnailsDir);
        for (const f of thumbFiles) {
          const m = f.match(/^thumb_(ref_(\d+)_[a-zA-Z0-9]+)_(\d+)\.jpg$/);
          if (!m) continue;
          const refId = m[1];
          if (existingIds.has(refId) || tombstones.has(refId)) continue;
          const refTs = parseInt(m[2], 10);
          const frameIdx = parseInt(m[3], 10);
          const cur = orphanThumbBatches.get(refId);
          if (!cur) {
            orphanThumbBatches.set(refId, {
              refId,
              refTimestampMs: refTs,
              count: 1,
              maxIndex: frameIdx
            });
          } else {
            cur.count++;
            if (frameIdx > cur.maxIndex) cur.maxIndex = frameIdx;
          }
        }
      }

      const uploadFiles = fs
        .readdirSync(uploadsDir)
        .filter(f => /^upl_\d+_[a-f0-9]+-.+\.(mp4|mkv|mov|webm|avi|ts|m4v)$/i.test(f))
        .sort();

      for (const fileEntry of uploadFiles) {
        const fullUploadPath = path.resolve(uploadsDir, fileEntry);
        if (existingFilePaths.has(fullUploadPath)) continue;

        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullUploadPath);
          if (!stat.isFile() || stat.size < 10000) continue;
        } catch {
          continue;
        }

        const headerMatch = fileEntry.match(/^(upl_(\d+)_[a-f0-9]+)-(.+)$/i);
        if (!headerMatch) continue;
        const uploadId = headerMatch[1];
        const uploadTsMs = parseInt(headerMatch[2], 10);
        const rawSuffix = headerMatch[3];
        const lowerSuffix = rawSuffix.toLowerCase();

        // Skip if another reference already links to the same filename suffix (e.g. re-uploaded file already attached)
        if (existingSuffixes.has(lowerSuffix)) continue;

        // Skip known synthetic demo fixtures
        if (
          lowerSuffix.includes('arsenal_bayern_ucl_master') ||
          lowerSuffix.includes('taylor_swift_patient_zero_master') ||
          lowerSuffix.includes('apex_horizon') ||
          lowerSuffix.includes('ucl_final_clean')
        ) {
          continue;
        }

        const savedSession = sessionByUploadId.get(uploadId);
        if (savedSession?.refId && tombstones.has(String(savedSession.refId))) {
          continue;
        }

        const probe = FingerprintEngine.probeVideoSync(fullUploadPath);
        if (!probe || probe.duration_sec <= 0 || probe.codec === 'unknown' || probe.codec === 'unavailable') {
          continue;
        }

        const intervalSec =
          savedSession?.sampleInterval && Number(savedSession.sampleInterval) > 0
            ? Number(savedSession.sampleInterval)
            : 2.0;
        const expectedFrames = ArgusDatabase.computeExpectedFrameCount(probe.duration_sec, intervalSec);

        // Match an orphaned thumb_ref_* batch in thumbnailsDir if one exists for this upload
        let matchedBatch: { refId: string; refTimestampMs: number; count: number; maxIndex: number } | undefined;
        if (savedSession?.refId && orphanThumbBatches.has(String(savedSession.refId))) {
          matchedBatch = orphanThumbBatches.get(String(savedSession.refId));
        } else {
          for (const batch of orphanThumbBatches.values()) {
            const timeDiffSec = Math.abs(batch.refTimestampMs - uploadTsMs) / 1000;
            if (batch.count === expectedFrames || (timeDiffSec <= 7200 && batch.count > 0)) {
              matchedBatch = batch;
              break;
            }
          }
        }

        const targetRefId =
          matchedBatch?.refId ||
          (savedSession?.refId ? String(savedSession.refId) : `ref_${uploadTsMs}_rec`);
        if (existingIds.has(targetRefId) || tombstones.has(targetRefId)) {
          continue;
        }

        // Derive human-readable metadata if session metadata was not persisted prior to server restart
        let derivedTitle = savedSession?.title ? String(savedSession.title).trim() : '';
        let derivedRightsHolder = savedSession?.rightsHolder ? String(savedSession.rightsHolder).trim() : '';
        let derivedAssetType: ReferenceItem['asset_type'] = savedSession?.assetType || 'VOD_FEATURE';
        let derivedSeasonEpisode: string | undefined = savedSession?.seasonEpisodeInfo;

        if (!derivedTitle) {
          const cleanedName = rawSuffix
            .replace(/\.(mp4|mkv|mov|webm|avi|ts|m4v)$/i, '')
            .replace(/^vidssave\.com_+/i, '')
            .replace(/_+\d{3,4}P$/i, '')
            .replace(/_+/g, ' ')
            .trim();
          if (/ind\s+vs\s+nz.*5th\s+t20i/i.test(cleanedName)) {
            derivedTitle = 'LIVE: IND vs NZ 5th T20I — India vs New Zealand Live Cricket';
            derivedRightsHolder = derivedRightsHolder || 'BCCI / Official Cricket Broadcast Rights';
            derivedAssetType = 'LIVE_SPORTS';
            derivedSeasonEpisode = derivedSeasonEpisode || '5th T20I — India vs New Zealand';
          } else {
            derivedTitle = cleanedName || 'Recovered Reference Video';
          }
        }
        if (!derivedRightsHolder) {
          derivedRightsHolder =
            derivedAssetType === 'LIVE_SPORTS' ? 'Official Sports Broadcast Rights Holder' : 'Rights Holder';
        }
        if (
          !savedSession?.assetType &&
          (/\b(live|t20i?|odi|cricket|match|premier league|ucl|champions league)\b/i.test(derivedTitle))
        ) {
          derivedAssetType = 'LIVE_SPORTS';
        }

        // Compute SHA-256 provenance hash of the video file
        const hash = crypto.createHash('sha256');
        const fd = fs.openSync(fullUploadPath, 'r');
        const chunkBuf = Buffer.allocUnsafe(4 * 1024 * 1024);
        let bytesRead = 0;
        try {
          while ((bytesRead = fs.readSync(fd, chunkBuf, 0, chunkBuf.length, null)) > 0) {
            hash.update(chunkBuf.subarray(0, bytesRead));
          }
        } finally {
          fs.closeSync(fd);
        }
        const provenanceSha256 = hash.digest('hex');

        const createdAtIso = new Date(matchedBatch?.refTimestampMs || uploadTsMs || stat.mtimeMs).toISOString();
        const samplingPlan = FingerprintEngine.calculateSamplingPlan(probe.duration_sec, intervalSec);

        let recoveredFrames: FrameFingerprint[] = [];
        if (matchedBatch && matchedBatch.count > 0) {
          const safePrefix = targetRefId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const jpegPattern = path.join(this.thumbnailsDir, `thumb_${safePrefix}_%d.jpg`);
          const batchHashes = FingerprintEngine.computeBatchFrameHashesFromJpegPatternSync(
            jpegPattern,
            matchedBatch.count
          );
          const embedAllB64 = matchedBatch.count <= 500;

          for (let i = 0; i < matchedBatch.count; i++) {
            const fname = `thumb_${safePrefix}_${i}.jpg`;
            const diskFile = path.join(this.thumbnailsDir, fname);
            if (!this.isValidJpegFileOnDisk(diskFile)) continue;
            const webRoute = `/thumbnails/${fname}`;
            const tsSec =
              samplingPlan.timestamps[i] !== undefined
                ? samplingPlan.timestamps[i]
                : Number((i * intervalSec).toFixed(2));
            let thumbData: string | undefined = undefined;
            if (embedAllB64 || i < 120) {
              try {
                const b = fs.readFileSync(diskFile);
                thumbData = `data:image/jpeg;base64,${b.toString('base64')}`;
              } catch {}
            }
            const h = batchHashes[i] || { phash_hex: '0000000000000000', avg_luminance: 0 };
            recoveredFrames.push({
              id: `fp_ref_${targetRefId}_${i}`,
              reference_id: targetRefId,
              timestamp_sec: tsSec,
              frame_index: i,
              phash_hex: h.phash_hex,
              vhash_hex: h.vhash_hex,
              crop_phash_hex: h.crop_phash_hex,
              avg_luminance: h.avg_luminance ?? 0,
              thumbnail_data: thumbData,
              thumbnail_path: webRoute,
              thumbnail_url: webRoute,
              created_at: createdAtIso
            });
          }
          orphanThumbBatches.delete(matchedBatch.refId);
        } else {
          // No pre-extracted thumbnail batch on disk -> extract frames from the uploaded video
          const extracted = FingerprintEngine.extractVideoFingerprintsSync(fullUploadPath, {
            referenceId: targetRefId,
            thumbnailsDir: this.thumbnailsDir,
            intervalSec,
            durationSec: probe.duration_sec,
            generateThumbnails: true,
            title: derivedTitle,
            isCandidate: false
          });
          recoveredFrames = extracted.map(f => ({
            id: `fp_ref_${targetRefId}_${f.frame_index}`,
            reference_id: targetRefId,
            timestamp_sec: f.timestamp_sec,
            frame_index: f.frame_index,
            phash_hex: f.phash_hex,
            vhash_hex: f.vhash_hex,
            crop_phash_hex: f.crop_phash_hex,
            avg_luminance: f.avg_luminance ?? 0,
            thumbnail_data: f.thumbnail_data,
            thumbnail_path: f.thumbnail_path,
            thumbnail_url: f.thumbnail_url,
            created_at: createdAtIso
          }));
        }

        if (recoveredFrames.length === 0) continue;

        const isComplete = recoveredFrames.length >= samplingPlan.expectedFrameCount;
        const firstThumb = recoveredFrames[0]?.thumbnail_url;
        const refRecord: ReferenceItem = {
          id: targetRefId,
          title: derivedTitle,
          rights_holder: derivedRightsHolder,
          asset_type: derivedAssetType,
          duration_sec: probe.duration_sec,
          resolution: `${probe.width}x${probe.height}`,
          fps: probe.fps,
          codec: probe.codec,
          source_type: savedSession?.sourceUrl ? 'OTT_PAGE' : 'UPLOAD',
          source_url: savedSession?.sourceUrl,
          platform: savedSession?.platform,
          season_episode_info: derivedSeasonEpisode,
          provider_integration_status: 'AUTHORIZED_MASTER_ATTACHED',
          acquisition_status: 'LOCAL_MASTER_UPLOADED',
          authorization_provenance: 'LOCAL_FILE_UPLOAD',
          last_acquisition_at: createdAtIso,
          file_path: fullUploadPath,
          thumbnail_url: firstThumb,
          created_at: createdAtIso,
          status: isComplete ? 'FINGERPRINTED' : 'PROCESSING',
          provenance_sha256: provenanceSha256,
          fingerprint_count: recoveredFrames.length,
          sample_interval_sec: intervalSec,
          expected_frame_count: samplingPlan.expectedFrameCount,
          extracted_frame_count: recoveredFrames.length,
          first_extracted_timestamp_sec: recoveredFrames[0]?.timestamp_sec ?? 0,
          last_extracted_timestamp_sec: recoveredFrames[recoveredFrames.length - 1]?.timestamp_sec ?? 0,
          extraction_status: isComplete ? 'COMPLETE' : 'PARTIAL',
          extraction_progress_pct: isComplete
            ? 100
            : Number(((recoveredFrames.length / Math.max(1, samplingPlan.expectedFrameCount)) * 100).toFixed(1)),
          notes:
            savedSession?.auditNotes ||
            `Recovered uploaded reference master (${recoveredFrames.length}/${samplingPlan.expectedFrameCount} verified keyframes across ${probe.duration_sec.toFixed(1)}s).`
        };

        try {
          this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
          this.upsertReference(refRecord);
          this.clearReferenceFingerprints(targetRefId);
          this.insertReferenceFingerprints(recoveredFrames);
          this.db.exec('COMMIT;');
        } catch (txErr) {
          try {
            this.db.exec('ROLLBACK;');
          } catch {}
          throw txErr;
        }

        const synced =
          this.syncReferenceExtractionCompleteness(targetRefId, {
            sampleIntervalSec: intervalSec,
            durationSec: probe.duration_sec,
            extractionError: null
          }) || this.getReferenceById(targetRefId);

        if (synced) {
          recovered.push(synced);
          existingIds.add(targetRefId);
          existingFilePaths.add(fullUploadPath);
          existingSuffixes.add(lowerSuffix);
        }
      }

      if (recovered.length > 0) {
        this.syncUserReferencesJournal();
      }
    } catch (err: any) {
      console.warn('[Orphan Reference Recovery Notice]', err.message);
    }
    return recovered;
  }

  // --- Reset only curated forensic sample fixtures while preserving user-registered records ---
  public clearForensicSamplesOnly(): void {
    this.purgeConfirmedSyntheticForensicSamples();
  }

  // --- Reset/Clear DB ---
  public clearAll(options?: {
    forceDeleteUserReferences?: boolean;
    recordTombstones?: boolean;
    syncJournal?: boolean;
  }): void {
    // CRITICAL SAFEGUARD: Never wipe user-registered references unless forceDeleteUserReferences is explicitly true
    if (options?.forceDeleteUserReferences !== true) {
      this.purgeConfirmedSyntheticForensicSamples();
      return;
    }
    if (options?.recordTombstones === true) {
      const allIds = (this.db.prepare(`SELECT id FROM reference_items`).all() as Array<{ id: string }>).map(r => r.id);
      for (const id of allIds) {
        this.recordTombstonedReferenceId(id);
      }
    }
    this.db.exec(`
      DELETE FROM coverage_snapshots;
      DELETE FROM evidence_records;
      DELETE FROM candidate_fingerprints;
      DELETE FROM candidates;
      DELETE FROM discovery_jobs;
      DELETE FROM reference_fingerprints;
      DELETE FROM reference_items;
    `);
    if (options?.syncJournal === true) {
      this.syncUserReferencesJournal();
    }
  }
}

// Singleton database instance
export const db = new ArgusDatabase();
