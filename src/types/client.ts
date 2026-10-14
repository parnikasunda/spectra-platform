/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Client-side Type Definitions
 */

export type AssetType = 'VOD_FEATURE' | 'EPISODIC' | 'LIVE_SPORTS' | 'COMMERCIAL' | 'TRAILER';

export type PipelineStatus = 
  | 'DISCOVERED'
  | 'REACHABLE'
  | 'MEDIA_DETECTED'
  | 'ACQUIRED'
  | 'ANALYZED'
  | 'UNREACHABLE'
  | 'DRM_PROTECTED'
  | 'INVALID_MEDIA';

export type ReviewDecision = 'PENDING' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'AUTHORIZED_LICENSEE';

export type DiscoveryProvider = 'SEARCH_CRAWLER' | 'STREAM_INDEXER' | 'IPTV_PROBER' | 'SPORTS_DIRECTORY';

export interface ReferenceItem {
  id: string;
  title: string;
  rights_holder: string;
  asset_type: AssetType;
  duration_sec: number;
  resolution: string;
  fps: number;
  codec: string;
  source_type: 'UPLOAD' | 'DIRECT_URL' | 'FORENSIC_SAMPLE';
  source_url?: string;
  file_path?: string;
  thumbnail_url?: string;
  created_at: string;
  status: 'REGISTERED' | 'PROCESSING' | 'FAILED' | 'ARCHIVED';
  provenance_sha256: string;
  fingerprint_count: number;
  notes?: string;
  fingerprints?: FrameFingerprint[];
}

export interface FrameFingerprint {
  id: string;
  reference_id?: string;
  candidate_id?: string;
  timestamp_sec: number;
  frame_index: number;
  phash_hex: string;
  avg_luminance: number;
  thumbnail_data?: string;
  created_at: string;
}

export interface DiscoveryJob {
  id: string;
  name: string;
  target_reference_id?: string;
  provider: DiscoveryProvider;
  query_params: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  candidates_found: number;
  started_at: string;
  completed_at?: string;
  error_message?: string;
}

export interface CandidateItem {
  id: string;
  job_id?: string;
  reference_id?: string;
  source_url: string;
  domain: string;
  discovered_title: string;
  discovery_provider: DiscoveryProvider;
  discovered_at: string;
  pipeline_status: PipelineStatus;
  reachability_code: number;
  reachability_latency_ms: number;
  media_type: 'HLS_M3U8' | 'MP4' | 'WEBM' | 'HTML_PLAYER' | 'UNKNOWN';
  media_resolution?: string;
  media_duration_sec?: number;
  is_live_stream: boolean;
  raw_headers_json?: string;
  verification_logs?: string;
  last_inspected_at?: string;
}

export interface MatchedKeyframePair {
  reference_timestamp_sec: number;
  candidate_timestamp_sec: number;
  hamming_distance: number;
  similarity_pct: number;
  reference_phash: string;
  candidate_phash: string;
  reference_thumbnail?: string;
  candidate_thumbnail?: string;
}

export interface EvidenceRecord {
  id: string;
  candidate_id: string;
  reference_id: string;
  candidate_url: string;
  candidate_domain: string;
  reference_title: string;
  rights_holder: string;
  match_status: 'POTENTIAL_MATCH' | 'NO_MATCH' | 'CONFIRMED_INFRINGEMENT' | 'AUTHORIZED_LICENSEE' | 'FALSE_POSITIVE';
  confidence_score: number;
  min_hamming_dist: number;
  avg_hamming_dist: number;
  matched_frames_count: number;
  total_compared_frames: number;
  temporal_offset_sec: number;
  sample_pairs: MatchedKeyframePair[];
  chain_of_custody_sha256: string;
  reviewed_by?: string;
  review_decision: ReviewDecision;
  review_notes?: string;
  reviewed_at?: string;
  takedown_generated_at?: string;
  takedown_notice_text?: string;
  created_at: string;
}

export interface SystemStats {
  total_references: number;
  active_jobs: number;
  total_candidates: number;
  reachable_candidates: number;
  media_detected_candidates: number;
  analyzed_candidates: number;
  potential_matches: number;
  confirmed_infringements: number;
  pending_reviews: number;
  asset_type_breakdown: Record<string, number>;
  provider_breakdown: Record<string, number>;
}
