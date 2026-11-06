/**
 * Argus / SPECTRA Anti-Piracy Intelligence & Evidence Platform
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
  | 'BLOCKED'
  | 'UNSUPPORTED'
  | 'REQUIRES_AUTHENTICATION'
  | 'RATE_LIMITED'
  | 'AWAITING_REVIEW'
  | 'INVALID_MEDIA';

export type ReviewDecision = 'PENDING' | 'CONFIRMED' | 'FALSE_POSITIVE' | 'AUTHORIZED_LICENSEE';

export type DiscoveryProvider = 
  | 'ALL_SOURCES'
  | 'YOUTUBE_PUBLIC'
  | 'SUSPECTED_PIRACY'
  | 'STREAMING_SERVICES'
  | 'PUBLIC_PLATFORMS'
  | 'SEARCH_CRAWLER'
  | 'STREAM_INDEXER'
  | 'IPTV_PROBER'
  | 'SPORTS_DIRECTORY';

export type MatchClassification = 
  | 'FULL_COPY'
  | 'PARTIAL_REUSE'
  | 'EDITED_CLIP'
  | 'POTENTIAL_MATCH'
  | 'NO_MATCH'
  | 'UNCERTAIN_MATCH'
  | 'CONFIRMED_INFRINGEMENT'
  | 'AUTHORIZED_LICENSEE'
  | 'FALSE_POSITIVE';

export type ReferenceStatus =
  | 'REGISTERED'
  | 'FINGERPRINTED'
  | 'METADATA_REGISTERED'
  | 'AWAITING_AUTHORIZED_MEDIA'
  | 'PROCESSING'
  | 'FAILED'
  | 'INVALID'
  | 'ARCHIVED';

export type ExtractionStatus =
  | 'QUEUED'
  | 'EXTRACTING'
  | 'COMPLETE'
  | 'PARTIAL'
  | 'FAILED';

export interface EmbeddedPlayerInfo {
  playerType:
    | 'IFRAME_EMBED'
    | 'HTML5_VIDEO'
    | 'VIDEO_SOURCE'
    | 'OPENGRAPH_VIDEO'
    | 'TWITTER_PLAYER'
    | 'JSON_LD_VIDEO'
    | 'JS_PLAYER_SDK';
  provider: string;
  embedUrl?: string;
  directMediaDownloadable: boolean;
  reason?: string;
}

export interface AccessibleMediaMetadata {
  iframeSrcs: string[];
  videoElementSrcs: string[];
  videoSourceTags: Array<{ src: string; type?: string }>;
  openGraphVideoUrls: string[];
  openGraphVideoTypes: string[];
  twitterPlayerUrls: string[];
  jsonLdVideos: Array<{
    name?: string;
    contentUrl?: string;
    embedUrl?: string;
    duration?: string;
    thumbnailUrl?: string;
    uploadDate?: string;
  }>;
  detectedPlayerSdks: string[];
  htmlVideoElementCount: number;
}

export type SourceAdapterCategory =
  | 'YOUTUBE'
  | 'DAILYMOTION'
  | 'VIMEO'
  | 'PUBLIC_VIDEO_PLATFORM'
  | 'DIRECT_MP4'
  | 'HLS_STREAM'
  | 'DASH_STREAM'
  | 'AUTHORIZED_OTT';

export type AcquisitionCapability =
  | 'AUTOMATIC_DIRECT_ACQUISITION'
  | 'CONDITIONAL_AUTHORIZED_ACQUISITION'
  | 'METADATA_ONLY_REQUIRES_AUTH'
  | 'AUTOMATIC_WHEN_PERMITTED'
  | 'CONDITIONAL_AUTHORIZED';

export interface SourceAdapterDescriptor {
  id: string;
  name: string;
  category: SourceAdapterCategory;
  platforms: string[];
  enabled: boolean;
  acquisitionCapability: AcquisitionCapability;
  supportedMethods: string[];
  supportedProtocols: string[];
  supportsResumableDownload: boolean;
  requiresCredentials: boolean;
  envVar?: string;
  credentialsConfigured: boolean;
  description: string;
  fallbackGuidance: string;
}

export interface ResolvedVideoIdentity {
  videoId?: string;
  platformVideoId?: string;
  title?: string;
  platform?: string;
  canonicalUrl?: string;
  durationSec?: number;
  mediaFormat?: string;
  resolution?: string;
  codec?: string;
  authorOrRightsHolder?: string;
  rightsHolderOrAuthor?: string;
  seasonEpisodeInfo?: string;
  seasonEpisode?: string;
  isLiveStream?: boolean;
}

export type AcquisitionWorkflowStageName =
  | 'URL_SUBMITTED'
  | 'SOURCE_IDENTIFIED'
  | 'VIDEO_INSPECTED'
  | 'MEDIA_ACQUIRED'
  | 'MEDIA_VALIDATED'
  | 'FRAME_EXTRACTION'
  | 'FINGERPRINTING'
  | 'COMPLETE';

export interface AcquisitionWorkflowStage {
  stage: AcquisitionWorkflowStageName;
  label: string;
  status:
    | 'COMPLETE'
    | 'COMPLETED'
    | 'IN_PROGRESS'
    | 'SKIPPED_RESTRICTED'
    | 'REQUIRES_AUTHORIZATION'
    | 'FAILED'
    | 'PENDING';
  detail: string;
  timestamp: string;
}

export interface AttemptedAcquisitionMethod {
  method: string;
  status: 'SUCCESS' | 'RESTRICTED' | 'UNAVAILABLE' | 'FAILED';
  detail: string;
  timestamp: string;
}

export interface AcquisitionWorkflowReport {
  currentStage: AcquisitionWorkflowStageName;
  overallStatus: 'COMPLETE' | 'AWAITING_AUTHORIZATION' | 'INSPECTED_READY' | 'PARTIAL' | 'FAILED';
  adapter?: SourceAdapterDescriptor;
  sourceAdapterName?: string;
  canAutoAcquire?: boolean;
  restrictionReason?: string;
  recommendedAlternative?: string;
  videoIdentity?: ResolvedVideoIdentity;
  acquisitionMethod?: string;
  attemptedMethods?: AttemptedAcquisitionMethod[];
  resumedFromBytes?: number;
  reusedCachedMedia?: boolean;
  deduplicatedExistingReferenceId?: string;
  stages: AcquisitionWorkflowStage[];
  alternativeAction?: {
    reason: string;
    recommendedActions: string[];
  };
}

export interface ReferenceUrlInspectionResult {
  submittedUrl: string;
  finalUrl: string;
  finalDomain: string;
  urlClassification:
    | 'DIRECT_MEDIA_URL'
    | 'WEBPAGE_WITH_DIRECT_MEDIA'
    | 'WEBPAGE_WITH_EMBEDDED_PLAYER'
    | 'WEBPAGE_NO_DIRECT_MEDIA'
    | 'DRM_PROTECTED_WEBPAGE'
    | 'RESTRICTED_OR_PAYWALLED'
    | 'MEDIA_AVAILABILITY_UNKNOWN'
    | 'TORRENT_OR_UNSUPPORTED'
    | 'UNREACHABLE'
    | 'SSRF_REJECTED';
  inspectionStatus?:
    | 'DIRECT_MEDIA_ACCESSIBLE'
    | 'WEBPAGE_DIRECT_MEDIA_ACCESSIBLE'
    | 'EMBEDDED_PLAYER_DETECTED_NO_DIRECT_MEDIA'
    | 'ORDINARY_WEBPAGE_NO_MEDIA'
    | 'RESTRICTED_MEDIA'
    | 'MEDIA_AVAILABILITY_UNDETERMINED'
    | 'UNREACHABLE_OR_INVALID';
  isWebpage: boolean;
  directMediaAvailable: boolean;
  embeddedPlayerDetected?: boolean;
  detectedPlayerProvider?: string;
  embeddedPlayers?: EmbeddedPlayerInfo[];
  accessibleMediaMetadata?: AccessibleMediaMetadata;
  diagnosticErrors?: string[];
  resolvedMediaUrl?: string;
  mediaContentType?: string;
  contentLengthBytes?: number;
  pageTitle?: string;
  pageDescription?: string;
  platform?: string;
  seasonEpisodeInfo?: string;
  durationSec?: number;
  mediaFormat?: string;
  sourceAdapter?: SourceAdapterDescriptor;
  videoIdentity?: ResolvedVideoIdentity;
  acquisitionMethod?: string;
  attemptedMethods?: AttemptedAcquisitionMethod[];
  workflow?: AcquisitionWorkflowReport;
  acquisitionStatus: string;
  canAcquireAuthorized: boolean;
  reason: string;
  checkedAt: string;
}

export type ImageAvailabilityStatus =
  | 'COMPLETE'
  | 'PARTIAL_IMAGES_MISSING'
  | 'IMAGES_UNAVAILABLE'
  | 'NOT_EXTRACTED';

export interface ReferenceFrameAuditItem {
  reference_id: string;
  title: string;
  status: ReferenceStatus;
  indexed_frame_count: number;
  retrievable_frame_image_count: number;
  missing_frame_image_count: number;
  repaired_from_base64_count: number;
  repaired_from_sibling_batch_count: number;
  regenerated_from_source_video_count: number;
  backfilled_base64_count: number;
  image_availability_status: ImageAvailabilityStatus;
  source_video_available: boolean;
}

export interface ReferenceItem {
  id: string;
  title: string;
  rights_holder: string;
  asset_type: AssetType;
  duration_sec: number;
  resolution: string;
  fps: number;
  codec: string;
  source_type: 'UPLOAD' | 'DIRECT_URL' | 'OTT_PAGE' | 'OTT_URL' | 'PROVIDER_INTEGRATION' | 'FORENSIC_SAMPLE';
  source_url?: string;
  final_url?: string;
  media_url?: string;
  platform?: string;
  season_episode_info?: string;
  provider_integration_status?: string;
  acquisition_status?: string;
  authorization_provenance?: string;
  last_acquisition_at?: string;
  acquisition_error?: string;
  detected_player_provider?: string;
  embedded_player_metadata_json?: string;
  inspection_status?: string;
  file_path?: string;
  thumbnail_url?: string;
  first_thumbnail?: string;
  created_at: string;
  status: ReferenceStatus;
  provenance_sha256: string;
  fingerprint_count: number;
  sample_interval_sec?: number;
  expected_frame_count?: number;
  extracted_frame_count?: number;
  retrievable_frame_image_count?: number;
  missing_frame_image_count?: number;
  image_availability_status?: ImageAvailabilityStatus;
  source_video_available?: boolean;
  first_extracted_timestamp_sec?: number;
  last_extracted_timestamp_sec?: number;
  extraction_status?: ExtractionStatus;
  extraction_error?: string;
  extraction_progress_pct?: number;
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
  vhash_hex?: string;
  crop_phash_hex?: string;
  avg_luminance?: number;
  thumbnail_data?: string;
  thumbnail_path?: string;
  thumbnail_url?: string;
  image_available?: boolean;
  created_at: string;
}

export interface AudioFingerprint {
  id: string;
  reference_id?: string;
  candidate_id?: string;
  timestamp_sec: number;
  frame_index: number;
  audio_phash_hex: string;
  rms_energy: number;
  spectral_peaks: number;
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

export type OverallAssessmentState =
  | 'MATCH_FOUND'
  | 'POSSIBLE_MATCH'
  | 'NO_MATCH_FOUND'
  | 'INSUFFICIENT_EVIDENCE';

export interface MetadataSignal {
  signal_type:
    | 'EVENT_FIXTURE'
    | 'TEAMS_PARTICIPANTS'
    | 'COMPETITION_SERIES'
    | 'SCHEDULED_START'
    | 'STREAM_TITLE'
    | 'PLATFORM_CONTEXT'
    | 'SCOREBOARD_TEXT';
  label: string;
  observed_value: string;
  reference_value?: string;
  status: 'MATCHED' | 'PARTIAL' | 'OBSERVED_ONLY' | 'DIFFERENT';
  source: string;
}

export interface CapturedCandidateFrame {
  frame_index: number;
  timestamp_sec: number;
  phash_hex: string;
  vhash_hex?: string;
  crop_phash_hex?: string;
  avg_luminance?: number;
  thumbnail_url?: string;
  captured_at: string;
  source_url: string;
  platform: string;
  provenance_sha256: string;
  best_ref_timestamp_sec?: number;
  best_ref_phash?: string;
  best_ref_thumbnail?: string;
  best_hamming_distance?: number;
  best_similarity_pct?: number;
}

export type CandidateClassification =
  | 'VERIFIED_VIDEO_ASSET'
  | 'VIDEO_ASSET'
  | 'ARTICLE'
  | 'IMAGE'
  | 'GENERAL_WEBPAGE';

export interface SeedSourceProbeResult {
  seedUrl: string;
  finalUrl: string;
  finalDomain: string;
  redirected: boolean;
  httpStatus: number;
  latencyMs: number;
  crawlStatus: 'ACCESSIBLE' | 'REDIRECTED_ACCESSIBLE' | 'ACCESS_RESTRICTED' | 'BLOCKED' | 'UNREACHABLE';
  restrictionReason?: string;
  checkedAt: string;
}

export type CandidateSourceType =
  | 'configured_website'
  | 'frame_search'
  | 'title_search'
  | 'candidate_expansion'
  | string;

export interface CandidateDiscoveryProvenance {
  source_types: string[];
  source_urls: string[];
  media_urls: string[];
  match_methods: string[];
  matched_content_ids: string[];
  referring_pages: string[];
  discovered_timestamps: string[];
}

export interface DiscoverySourceRecord {
  id: string;
  name: string;
  url: string;
  source_type: CandidateSourceType;
  enabled: boolean;
  last_scan_at?: string;
  last_scan_status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'RESTRICTED' | 'FAILED';
  last_scan_outcome?: string;
  pages_inspected: number;
  inspected_urls_json?: string;
  candidates_discovered: number;
  direct_media_found: number;
  duplicates_merged: number;
  acquisitions_succeeded: number;
  acquisitions_restricted: number;
  frames_extracted: number;
  fingerprinted_count: number;
  failure_reasons_json?: string;
  created_at: string;
}

export type IdentityRelationship =
  | 'EXACT_TARGET_MATCH'
  | 'TARGET_SERIES_OR_ARTIST_GENERIC'
  | 'DIFFERENT_EPISODE_OR_ITEM'
  | 'UNRELATED_CONTENT'
  | 'INSUFFICIENT_METADATA';

export interface CandidateDetectedIdentity {
  detected_content_type: 'EPISODIC' | 'MOVIE' | 'LIVE_SPORTS' | 'MUSIC_VIDEO' | 'ARTICLE_OR_NEWS' | 'CLIP_OR_COMPILATION' | 'GENERAL';
  detected_work_title?: string;
  detected_subtitle_or_episode_title?: string;
  detected_season?: number;
  detected_episode?: number;
  detected_episode_code?: string;
  detected_artist?: string;
  detected_track?: string;
  detected_participants?: string[];
  detected_fixture?: string;
  detected_competition?: string;
  detected_year?: number;
  is_generic_compilation_or_clip?: boolean;
  identity_summary: string;
}

export interface CandidateResearchEvaluation {
  target_reference_id?: string;
  target_identity_summary: string;
  detected_identity: CandidateDetectedIdentity;
  identity_relationship: IdentityRelationship;
  research_relevance_score: number;
  supporting_evidence: string[];
  contradictory_evidence: string[];
  missing_metadata: string[];
  ranking_explanation: string;
  corroborating_sources: string[];
  discovered_identifiers: string[];
  research_status: 'COMPLETE' | 'INCOMPLETE_METADATA' | 'CONFLICTING_IDENTITY' | 'REJECTED_UNRELATED';
  researched_at: string;
}

export interface CandidateItem {
  id: string;
  job_id?: string;
  reference_id?: string;
  matched_content_id?: string;
  source_type?: CandidateSourceType;
  match_method?: string;
  discovery_provenance_json?: string;
  discovery_provenance?: CandidateDiscoveryProvenance;
  source_url: string;
  original_url?: string;
  final_url?: string;
  final_domain?: string;
  referring_page?: string;
  matched_keywords?: string;
  crawl_status?: string;
  duplicate_count?: number;
  candidate_classification?: CandidateClassification;
  media_url?: string;
  canonical_url?: string;
  platform?: string;
  acquisition_status?: string;
  frame_evidence?: string;
  domain: string;
  discovered_title: string;
  discovery_provider: DiscoveryProvider;
  source_category?: 'YOUTUBE' | 'STREAMING_SERVICE' | 'SUSPECTED_PIRACY' | 'PUBLIC_PLATFORM' | 'EMBEDDED_PLAYER' | 'DIRECT_STREAM' | 'OTHER';
  asset_kind?: 'DISCOVERED_PAGE' | 'VERIFIED_VIDEO_ASSET' | 'VIDEO_ASSET' | 'ARTICLE' | 'IMAGE' | 'GENERAL_WEBPAGE';
  discovered_at: string;
  pipeline_status: PipelineStatus;
  reachability_code: number;
  reachability_latency_ms: number;
  media_type: 'HLS_M3U8' | 'MP4' | 'WEBM' | 'HTML_PLAYER' | 'DASH_MPD' | 'DASH_DRM' | 'UNKNOWN';
  media_resolution?: string;
  media_duration_sec?: number;
  media_fps?: number;
  file_path?: string;
  thumbnail_url?: string;
  is_live_stream: boolean;
  drm_scheme?: string;
  raw_headers_json?: string;
  verification_logs?: string;
  last_inspected_at?: string;
  captured_frames?: CapturedCandidateFrame[];
  visual_similarity_score?: number;
  metadata_relevance_score?: number;
  research_relevance_score?: number;
  identity_relationship?: IdentityRelationship;
  detected_identity_json?: string;
  candidate_research?: CandidateResearchEvaluation;
  overall_assessment?: OverallAssessmentState;
  research_stage?: 'RESEARCHED' | 'AWAITING_RESEARCH' | 'REJECTED_UNRELATED';
  comparison_stage?: 'COMPARED' | 'QUEUED_FOR_COMPARISON' | 'DEFERRED_BY_LIMIT' | 'NOT_APPLICABLE';
}

export type DiscoveryPresetMode = 'STANDARD' | 'DEEP' | 'EXHAUSTIVE' | 'CUSTOM';

export interface DiscoveryLimitsConfig {
  preset_mode: DiscoveryPresetMode;
  max_unique_candidates: number;
  deep_research_limit: number;
  forensic_comparison_limit: number;
}

export type CoverageMeasurementType = 'MEASURED' | 'ESTIMATED' | 'UNAVAILABLE';
export type CoverageConfidenceLevel = 'HIGH' | 'MEDIUM' | 'MODERATE';

export interface CoverageMetricDetail {
  id: string;
  label: string;
  percentage: number;
  measured_pct: number;
  estimated_pct: number;
  unavailable_pct: number;
  numerator: number;
  denominator: number;
  unit_label: string;
  coverage_type: CoverageMeasurementType;
  methodology: string;
  denominator_definition: string;
  assumptions: string[];
  data_sources: string[];
  confidence_level: CoverageConfidenceLevel;
  last_updated_at: string;
}

export type PlatformEcosystemCategory =
  | 'YOUTUBE'
  | 'DAILYMOTION'
  | 'VIMEO'
  | 'PUBLIC_VIDEO_HOSTING'
  | 'PUBLICLY_INDEXED_WEB'
  | 'SOCIAL_VIDEO'
  | 'CONFIGURED_PIRACY_ECOSYSTEM'
  | 'COMMERCIAL_OTT';

export interface PlatformEcosystemCoverage {
  id: string;
  name: string;
  category: PlatformEcosystemCategory;
  platforms_included: string[];
  adapter_id?: string;
  adapter_enabled: boolean;
  adapter_status: 'ACTIVE_LIVE' | 'CONDITIONAL_AUTH' | 'METADATA_ONLY' | 'DISABLED' | 'UNCONFIGURED';
  universe_weight_pct: number;
  estimated_searchable_pct: number;
  measured_inspection_pct: number;
  unavailable_pct: number;
  weighted_universe_contribution_pct: number;
  sources_configured: number;
  sources_checked: number;
  queries_executed: number;
  pages_discovered: number;
  pages_inspected: number;
  unique_candidates: number;
  relevant_candidates: number;
  researched_candidates: number;
  compared_candidates: number;
  unavailable_sources_count: number;
  coverage_type: CoverageMeasurementType;
  methodology: string;
  denominator_definition: string;
  assumptions: string[];
  data_sources: string[];
  confidence_level: CoverageConfidenceLevel;
  gap_explanation: string;
  last_updated_at: string;
}

export interface CandidateLifecycleBreakdown {
  raw_discovered_count: number;
  duplicates_merged_count: number;
  unique_candidates_count: number;
  relevant_candidates_count: number;
  researched_candidates_count: number;
  awaiting_research_count: number;
  queued_for_comparison_count: number;
  compared_candidates_count: number;
  rejected_or_irrelevant_count: number;
  remaining_candidate_capacity: number;
  remaining_research_capacity: number;
  remaining_comparison_capacity: number;
  configured_limits: DiscoveryLimitsConfig;
  max_system_ceiling: number;
  unique_limit_reached: boolean;
  research_limit_reached: boolean;
  comparison_limit_reached: boolean;
  limit_explanation: string;
}

export interface SearchProgressBreakdown {
  completed_sources_count: number;
  pending_sources_count: number;
  failed_or_restricted_sources_count: number;
  completed_queries_count: number;
  remaining_queries_capacity: number;
  completed_research_count: number;
  pending_research_count: number;
  completed_comparisons_count: number;
  pending_comparisons_count: number;
  failed_inspections_count: number;
  overall_progress_pct: number;
}

export interface CoverageGapItem {
  id: string;
  ecosystem_or_source: string;
  gap_type: 'DRM_OR_AUTH_WALL' | 'MISSING_API_CREDENTIALS' | 'BLOCKED_OR_UNREACHABLE_SOURCE' | 'DISABLED_SOURCE_OR_ADAPTER' | 'CANDIDATE_OR_QUERY_LIMIT_REACHED' | 'UNINSPECTED_CANDIDATES';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  impact_pct: number;
  description: string;
  remediation_action: string;
  can_auto_remediate: boolean;
}

export interface SearchCoverageSnapshot {
  id: string;
  job_id?: string;
  reference_id?: string;
  reference_title?: string;
  preset_mode: DiscoveryPresetMode;
  max_unique_candidates: number;
  deep_research_limit: number;
  forensic_comparison_limit: number;
  overall_estimated_coverage_pct: number;
  measured_source_inspection_pct: number;
  candidate_research_coverage_pct: number;
  forensic_comparison_coverage_pct: number;
  sources_configured: number;
  sources_checked: number;
  queries_executed: number;
  pages_discovered: number;
  pages_inspected: number;
  raw_discovered_count: number;
  unique_candidates_count: number;
  relevant_candidates_count: number;
  researched_candidates_count: number;
  awaiting_research_count: number;
  queued_for_comparison_count: number;
  compared_candidates_count: number;
  rejected_count: number;
  created_at: string;
}

export interface DiscoveryPerformanceMetrics {
  sources_configured: number;
  sources_checked: number;
  sources_accessible: number;
  sources_unavailable_or_restricted: number;
  search_queries_executed: number;
  search_queries_planned_budget: number;
  pages_discovered: number;
  pages_inspected: number;
  raw_discovered_candidates: number;
  duplicates_merged: number;
  unique_candidates_discovered: number;
  relevant_candidates_identified: number;
  candidates_researched: number;
  candidates_awaiting_research: number;
  candidates_queued_for_comparison: number;
  candidates_forensically_compared: number;
  rejected_or_irrelevant_candidates: number;
}

export interface SearchCoverageReport {
  generated_at: string;
  target_reference_id?: string;
  target_reference_title?: string;
  active_job_id?: string;
  configured_limits: DiscoveryLimitsConfig;
  overall_coverage: {
    estimated_searchable_coverage: CoverageMetricDetail;
    source_inspection_coverage: CoverageMetricDetail;
    candidate_research_coverage: CoverageMetricDetail;
    forensic_investigation_coverage: CoverageMetricDetail;
  };
  discovery_performance: DiscoveryPerformanceMetrics;
  candidate_lifecycle: CandidateLifecycleBreakdown;
  search_progress: SearchProgressBreakdown;
  platform_ecosystems: PlatformEcosystemCoverage[];
  configured_sources: DiscoverySourceRecord[];
  source_adapters: SourceAdapterDescriptor[];
  unavailable_or_inaccessible_sources: Array<{
    id: string;
    name: string;
    url_or_platform: string;
    status: string;
    reason: string;
    last_checked_at?: string;
  }>;
  remaining_gaps: CoverageGapItem[];
  historical_snapshots: SearchCoverageSnapshot[];
  investigation_comparisons: Array<{
    reference_id: string;
    reference_title: string;
    asset_type: string;
    latest_preset_mode: DiscoveryPresetMode;
    max_unique_candidates: number;
    overall_estimated_coverage_pct: number;
    source_inspection_pct: number;
    candidate_research_pct: number;
    forensic_comparison_pct: number;
    unique_candidates: number;
    researched_candidates: number;
    compared_candidates: number;
    last_swept_at: string;
  }>;
}

export interface MatchedKeyframePair {
  reference_timestamp_sec: number;
  candidate_timestamp_sec: number;
  reference_frame_index?: number;
  candidate_frame_index?: number;
  hamming_distance: number;
  similarity_pct: number;
  reference_phash: string;
  candidate_phash: string;
  reference_thumbnail?: string;
  candidate_thumbnail?: string;
  match_feature?: 'FULL_FRAME' | 'CROP_INVARIANT' | 'LETTERBOX_INVARIANT' | 'VERTICAL_GRADIENT';
  is_duplicate_static_frame?: boolean;
}

export interface MatchedTimelineSegment {
  segment_id: string;
  reference_start_sec: number;
  reference_end_sec: number;
  reference_duration_sec: number;
  candidate_start_sec: number;
  candidate_end_sec: number;
  candidate_duration_sec: number;
  temporal_offset_sec: number;
  matched_pair_count: number;
  unique_reference_frames: number;
  unique_candidate_frames: number;
  avg_similarity_pct: number;
  max_similarity_pct: number;
  min_hamming_dist: number;
  avg_hamming_dist: number;
}

export interface FullCoverageMatchMetrics {
  reference_duration_sec: number;
  candidate_duration_sec: number;
  total_reference_frames: number;
  total_candidate_frames: number;
  raw_matching_pairs_count: number;
  deduplicated_matching_pairs_count: number;
  suppressed_static_duplicate_pairs_count?: number;
  unique_reference_frames_matched: number;
  unique_candidate_frames_matched: number;
  unique_visual_scenes_matched: number;
  reference_coverage_pct: number;
  candidate_coverage_pct: number;
  coverage_formula_explanation: string;
  is_single_frame_coincidence: boolean;
  is_reordered_or_edited: boolean;
  matched_segments: MatchedTimelineSegment[];
  all_matched_pairs?: MatchedKeyframePair[];
}

export interface AudioMatchMetrics {
  has_audio: boolean;
  audio_fingerprint_supported: boolean;
  audio_similarity_pct: number;
  matched_duration_sec: number;
  audio_hash_sample?: string;
}

export interface EvidenceRecord {
  id: string;
  candidate_id: string;
  reference_id: string;
  candidate_url: string;
  candidate_domain: string;
  candidate_platform?: string;
  candidate_title?: string;
  reference_title: string;
  rights_holder: string;
  match_status: 'POTENTIAL_MATCH' | 'NO_MATCH' | 'CONFIRMED_INFRINGEMENT' | 'AUTHORIZED_LICENSEE' | 'FALSE_POSITIVE';
  match_classification?: MatchClassification;
  confidence_score: number;
  visual_similarity_score?: number;
  metadata_relevance_score?: number;
  overall_assessment?: OverallAssessmentState;
  metadata_signals?: MetadataSignal[];
  captured_frames?: CapturedCandidateFrame[];
  uncertainty_reasons?: string[];
  min_hamming_dist: number;
  avg_hamming_dist: number;
  matched_frames_count: number;
  total_compared_frames: number;
  reference_duration_sec?: number;
  candidate_duration_sec?: number;
  total_reference_frames?: number;
  total_candidate_frames?: number;
  unique_reference_frames_matched?: number;
  unique_candidate_frames_matched?: number;
  reference_coverage_pct?: number;
  candidate_coverage_pct?: number;
  coverage_metrics?: FullCoverageMatchMetrics;
  temporal_offset_sec: number;
  sample_pairs: MatchedKeyframePair[];
  audio_match?: AudioMatchMetrics;
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
  inaccessible_candidates?: number;
  duplicate_candidates?: number;
  verified_video_candidates?: number;
  potential_matches: number;
  confirmed_infringements: number;
  pending_reviews: number;
  asset_type_breakdown: Record<string, number>;
  provider_breakdown: Record<string, number>;
}
