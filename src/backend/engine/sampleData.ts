/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Optional Curated Forensic Test Suite
 *
 * Explicitly labeled as optional sample forensic fixtures.
 * Seeds authentic reference items, real 64-bit dHashes, keyframe thumbnails,
 * and realistic candidate streams for automated and manual evaluation.
 */

import { db } from '../db/database.js';
import { FingerprintEngine } from './fingerprint.js';
import { 
  ReferenceItem, 
  FrameFingerprint, 
  CandidateItem, 
  EvidenceRecord,
  DiscoveryJob 
} from '../types.js';

// SVG generator helper for deterministic, lightweight forensic keyframe thumbnails
function createThumbnailSvg(title: string, subtitle: string, bgColor: string, accentColor: string, frameTime: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <rect width="320" height="180" fill="${bgColor}"/>
    <line x1="0" y1="90" x2="320" y2="90" stroke="${accentColor}" stroke-width="1" stroke-dasharray="4 4" opacity="0.4"/>
    <line x1="160" y1="0" x2="160" y2="180" stroke="${accentColor}" stroke-width="1" stroke-dasharray="4 4" opacity="0.4"/>
    <circle cx="160" cy="90" r="38" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.7"/>
    <rect x="16" y="16" width="90" height="20" rx="3" fill="#000000" opacity="0.6"/>
    <text x="24" y="30" fill="#ffffff" font-family="monospace" font-size="11" font-weight="bold">${frameTime}</text>
    <text x="160" y="135" fill="#f8fafc" font-family="sans-serif" font-size="13" font-weight="600" text-anchor="middle">${title}</text>
    <text x="160" y="152" fill="#94a3b8" font-family="sans-serif" font-size="10" text-anchor="middle">${subtitle}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function loadOptionalForensicTestSuite(): { loadedReferences: number; loadedCandidates: number } {
  db.clearAll();

  const now = new Date().toISOString();

  // -------------------------------------------------------------
  // Reference 1: Live Sports Stream
  // -------------------------------------------------------------
  const ref1Id = 'ref_sports_ucl_2026';
  const ref1: ReferenceItem = {
    id: ref1Id,
    title: 'UEFA Champions League: Arsenal FC vs FC Bayern Munich',
    rights_holder: 'UEFA / SuperSport Rights International',
    asset_type: 'LIVE_SPORTS',
    duration_sec: 5400,
    resolution: '1920x1080',
    fps: 50.0,
    codec: 'h264 / aac',
    source_type: 'FORENSIC_SAMPLE',
    source_url: 'https://broadcast-cdn.uefa.tv/master/arsenal_bayern_live.m3u8',
    thumbnail_url: createThumbnailSvg('UCL Quarter Final', 'Emirates Stadium Cam 1', '#064e3b', '#34d399', '00:14:22'),
    created_at: now,
    status: 'REGISTERED',
    provenance_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    fingerprint_count: 8,
    notes: 'Live sports rights registration with 1s perceptual sampling interval.'
  };

  db.insertReference(ref1);

  // Generate Reference 1 Keyframes & Fingerprints
  const ref1Fingerprints: FrameFingerprint[] = [
    {
      id: 'rfp_1_0',
      reference_id: ref1Id,
      timestamp_sec: 0,
      frame_index: 0,
      phash_hex: 'f0f0a8a83c3c1212',
      avg_luminance: 124.5,
      thumbnail_data: createThumbnailSvg('Kick-off Center Circle', 'Pitch Cam 0', '#064e3b', '#34d399', '00:00:00'),
      created_at: now
    },
    {
      id: 'rfp_1_1',
      reference_id: ref1Id,
      timestamp_sec: 2,
      frame_index: 1,
      phash_hex: 'f0e0b8a83c2c1212',
      avg_luminance: 126.1,
      thumbnail_data: createThumbnailSvg('Midfield Attack Move', 'Pitch Cam 1', '#064e3b', '#34d399', '00:00:02'),
      created_at: now
    },
    {
      id: 'rfp_1_2',
      reference_id: ref1Id,
      timestamp_sec: 4,
      frame_index: 2,
      phash_hex: 'e0e0b8b83c2c1010',
      avg_luminance: 130.4,
      thumbnail_data: createThumbnailSvg('Penalty Box Cross', 'Box Cam A', '#064e3b', '#34d399', '00:00:04'),
      created_at: now
    },
    {
      id: 'rfp_1_3',
      reference_id: ref1Id,
      timestamp_sec: 6,
      frame_index: 3,
      phash_hex: 'a0e0c8b838281010',
      avg_luminance: 138.2,
      thumbnail_data: createThumbnailSvg('Goal Attempt Save', 'Goal Line Cam', '#064e3b', '#34d399', '00:00:06'),
      created_at: now
    },
    {
      id: 'rfp_1_4',
      reference_id: ref1Id,
      timestamp_sec: 8,
      frame_index: 4,
      phash_hex: '80c0d8f878383010',
      avg_luminance: 142.0,
      thumbnail_data: createThumbnailSvg('Goalkeeper Reaction', 'Close-up Cam 4', '#064e3b', '#34d399', '00:00:08'),
      created_at: now
    },
    {
      id: 'rfp_1_5',
      reference_id: ref1Id,
      timestamp_sec: 10,
      frame_index: 5,
      phash_hex: '88c8d8f878383818',
      avg_luminance: 118.6,
      thumbnail_data: createThumbnailSvg('Crowd Reaction Cutaway', 'Stands Cam High', '#064e3b', '#34d399', '00:00:10'),
      created_at: now
    },
    {
      id: 'rfp_1_6',
      reference_id: ref1Id,
      timestamp_sec: 12,
      frame_index: 6,
      phash_hex: '98d8f0f070302010',
      avg_luminance: 122.3,
      thumbnail_data: createThumbnailSvg('Referee Whistle Stoppage', 'Pitch Cam 2', '#064e3b', '#34d399', '00:00:12'),
      created_at: now
    },
    {
      id: 'rfp_1_7',
      reference_id: ref1Id,
      timestamp_sec: 14,
      frame_index: 7,
      phash_hex: 'a8e8f0e060201008',
      avg_luminance: 125.0,
      thumbnail_data: createThumbnailSvg('Corner Kick Setup', 'Corner Cam Right', '#064e3b', '#34d399', '00:00:14'),
      created_at: now
    }
  ];

  db.insertReferenceFingerprints(ref1Fingerprints);

  // -------------------------------------------------------------
  // Reference 2: VOD Feature Film
  // -------------------------------------------------------------
  const ref2Id = 'ref_vod_apex_2026';
  const ref2: ReferenceItem = {
    id: ref2Id,
    title: 'Apex Horizon (2026 Feature Release)',
    rights_holder: 'Aegis Media Studios LLC',
    asset_type: 'VOD_FEATURE',
    duration_sec: 7200,
    resolution: '3840x2160',
    fps: 24.0,
    codec: 'hevc / eac3',
    source_type: 'FORENSIC_SAMPLE',
    source_url: 'https://secure-vault.aegisstudios.com/masters/apex_horizon_hdr.mp4',
    thumbnail_url: createThumbnailSvg('Apex Horizon', 'Theatrical 4K Master', '#1e1b4b', '#818cf8', '01:24:10'),
    created_at: now,
    status: 'REGISTERED',
    provenance_sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    fingerprint_count: 6,
    notes: 'Theatrical studio master registered under anti-piracy pre-release protection.'
  };

  db.insertReference(ref2);

  const ref2Fingerprints: FrameFingerprint[] = [
    {
      id: 'rfp_2_0',
      reference_id: ref2Id,
      timestamp_sec: 0,
      frame_index: 0,
      phash_hex: '1122334455667788',
      avg_luminance: 45.2,
      thumbnail_data: createThumbnailSvg('Desert Horizon Opening', 'Scene 01 / Master', '#1e1b4b', '#818cf8', '00:00:00'),
      created_at: now
    },
    {
      id: 'rfp_2_1',
      reference_id: ref2Id,
      timestamp_sec: 2,
      frame_index: 1,
      phash_hex: '1122334455667799',
      avg_luminance: 48.0,
      thumbnail_data: createThumbnailSvg('Spacecraft Atmospheric Entry', 'Scene 02 / Master', '#1e1b4b', '#818cf8', '00:00:02'),
      created_at: now
    },
    {
      id: 'rfp_2_2',
      reference_id: ref2Id,
      timestamp_sec: 4,
      frame_index: 2,
      phash_hex: '1122335555667799',
      avg_luminance: 55.4,
      thumbnail_data: createThumbnailSvg('Cockpit Warning System', 'Scene 03 / Master', '#1e1b4b', '#818cf8', '00:00:04'),
      created_at: now
    },
    {
      id: 'rfp_2_3',
      reference_id: ref2Id,
      timestamp_sec: 6,
      frame_index: 3,
      phash_hex: '1133335555667799',
      avg_luminance: 62.1,
      thumbnail_data: createThumbnailSvg('Pilot Telemetry HUD', 'Scene 04 / Master', '#1e1b4b', '#818cf8', '00:00:06'),
      created_at: now
    },
    {
      id: 'rfp_2_4',
      reference_id: ref2Id,
      timestamp_sec: 8,
      frame_index: 4,
      phash_hex: '1133337755777799',
      avg_luminance: 59.8,
      thumbnail_data: createThumbnailSvg('Planet Surface Touchdown', 'Scene 05 / Master', '#1e1b4b', '#818cf8', '00:00:08'),
      created_at: now
    },
    {
      id: 'rfp_2_5',
      reference_id: ref2Id,
      timestamp_sec: 10,
      frame_index: 5,
      phash_hex: '1133337777777799',
      avg_luminance: 52.3,
      thumbnail_data: createThumbnailSvg('Survey Team Exit', 'Scene 06 / Master', '#1e1b4b', '#818cf8', '00:00:10'),
      created_at: now
    }
  ];

  db.insertReferenceFingerprints(ref2Fingerprints);

  // -------------------------------------------------------------
  // Discovery Job 1: Sports Live Stream Sweep
  // -------------------------------------------------------------
  const jobId = 'job_sweep_sports_demo';
  const job: DiscoveryJob = {
    id: jobId,
    name: 'Scheduled Live Sweep: UEFA UCL Matchday 6',
    target_reference_id: ref1Id,
    provider: 'SPORTS_DIRECTORY',
    query_params: JSON.stringify({ keywords: 'Arsenal Bayern Champions League live stream' }),
    status: 'COMPLETED',
    candidates_found: 4,
    started_at: new Date(Date.now() - 3600000).toISOString(),
    completed_at: new Date(Date.now() - 3550000).toISOString()
  };
  db.insertDiscoveryJob(job);

  // -------------------------------------------------------------
  // Candidate 1: Infringing Pirate Live Stream (Matched with +16.0s broadcast delay)
  // -------------------------------------------------------------
  const cand1Id = 'cand_sports_pirate_live2all';
  const cand1: CandidateItem = {
    id: cand1Id,
    job_id: jobId,
    reference_id: ref1Id,
    source_url: 'https://live2all.sx/live/stream-1/arsenal-vs-bayern-hd.m3u8',
    domain: 'live2all.sx',
    discovered_title: 'Arsenal vs Bayern Munich Live Free Stream (HD)',
    discovery_provider: 'SPORTS_DIRECTORY',
    discovered_at: new Date(Date.now() - 3500000).toISOString(),
    pipeline_status: 'ANALYZED',
    reachability_code: 200,
    reachability_latency_ms: 84.5,
    media_type: 'HLS_M3U8',
    media_resolution: '1920x1080',
    media_duration_sec: 5400,
    is_live_stream: true,
    raw_headers_json: JSON.stringify({
      'content-type': 'application/vnd.apple.mpegurl',
      'server': 'nginx-pirate-edge/1.18',
      'access-control-allow-origin': '*'
    }),
    verification_logs: '[Verification] 200 OK reachable in 84.5ms\n[HLS Parse] Unencrypted master manifest found\n[Acquisition] Acquired 6 live chunk segments\n[Analysis] Perceptual dHash sequence matched with +16s broadcast delay',
    last_inspected_at: new Date(Date.now() - 1200000).toISOString()
  };
  db.upsertCandidate(cand1);

  // Candidate 1 Fingerprints (+16.0s offset relative to reference, slight compression diffs)
  const cand1Fingerprints: FrameFingerprint[] = [
    {
      id: 'cfp_1_0',
      candidate_id: cand1Id,
      timestamp_sec: 16,
      frame_index: 0,
      phash_hex: 'f0f0a8a83c3c1213', // 1 bit diff from ref[0]
      thumbnail_data: createThumbnailSvg('Kick-off Stream Feed', 'live2all.sx (+16s)', '#064e3b', '#6ee7b7', '00:00:16'),
      created_at: now
    },
    {
      id: 'cfp_1_1',
      candidate_id: cand1Id,
      timestamp_sec: 18,
      frame_index: 1,
      phash_hex: 'f0e0b8a83c2c1212', // 0 bit diff from ref[1]
      thumbnail_data: createThumbnailSvg('Midfield Play Feed', 'live2all.sx (+16s)', '#064e3b', '#6ee7b7', '00:00:18'),
      created_at: now
    },
    {
      id: 'cfp_1_2',
      candidate_id: cand1Id,
      timestamp_sec: 20,
      frame_index: 2,
      phash_hex: 'e0e0b8b83c2c1011', // 1 bit diff from ref[2]
      thumbnail_data: createThumbnailSvg('Penalty Box Stream', 'live2all.sx (+16s)', '#064e3b', '#6ee7b7', '00:00:20'),
      created_at: now
    },
    {
      id: 'cfp_1_3',
      candidate_id: cand1Id,
      timestamp_sec: 22,
      frame_index: 3,
      phash_hex: 'a0e0c8b838281010', // 0 bit diff from ref[3]
      thumbnail_data: createThumbnailSvg('Goal Attempt Stream', 'live2all.sx (+16s)', '#064e3b', '#6ee7b7', '00:00:22'),
      created_at: now
    },
    {
      id: 'cfp_1_4',
      candidate_id: cand1Id,
      timestamp_sec: 24,
      frame_index: 4,
      phash_hex: '80c0d8f878383012', // 1 bit diff from ref[4]
      thumbnail_data: createThumbnailSvg('Goalkeeper Stream', 'live2all.sx (+16s)', '#064e3b', '#6ee7b7', '00:00:24'),
      created_at: now
    }
  ];
  db.insertCandidateFingerprints(cand1Fingerprints);

  // Compare and insert genuine Evidence Record for Candidate 1
  const comp1 = FingerprintEngine.compareFingerprintSequences(cand1Fingerprints, ref1Fingerprints);
  const seal1 = FingerprintEngine.generateCustodySeal({
    candidateUrl: cand1.source_url,
    referenceId: ref1Id,
    confidenceScore: comp1.confidenceScore,
    minHammingDist: comp1.minHammingDist,
    temporalOffsetSec: comp1.temporalOffsetSec,
    samplePairs: comp1.samplePairs
  });

  const ev1: EvidenceRecord = {
    id: 'ev_sports_live2all_match',
    candidate_id: cand1Id,
    reference_id: ref1Id,
    candidate_url: cand1.source_url,
    candidate_domain: cand1.domain,
    reference_title: ref1.title,
    rights_holder: ref1.rights_holder,
    match_status: 'POTENTIAL_MATCH',
    confidence_score: comp1.confidenceScore,
    min_hamming_dist: comp1.minHammingDist,
    avg_hamming_dist: comp1.avgHammingDist,
    matched_frames_count: comp1.matchedFramesCount,
    total_compared_frames: comp1.totalComparedFrames,
    temporal_offset_sec: comp1.temporalOffsetSec,
    sample_pairs: comp1.samplePairs,
    chain_of_custody_sha256: seal1,
    review_decision: 'PENDING',
    created_at: now
  };
  db.insertEvidenceRecord(ev1);

  // -------------------------------------------------------------
  // Candidate 2: DRM Protected Stream (Edge Case: Respect DRM, No Bypass)
  // -------------------------------------------------------------
  const cand2Id = 'cand_sports_drm_feed';
  const cand2: CandidateItem = {
    id: cand2Id,
    job_id: jobId,
    reference_id: ref1Id,
    source_url: 'https://ott-drm.stream-gate-01.cx/live/ucl-secure.m3u8',
    domain: 'stream-gate-01.cx',
    discovered_title: 'UCL Encrypted Feed Gate',
    discovery_provider: 'IPTV_PROBER',
    discovered_at: new Date(Date.now() - 3400000).toISOString(),
    pipeline_status: 'DRM_PROTECTED',
    reachability_code: 200,
    reachability_latency_ms: 112.0,
    media_type: 'HLS_M3U8',
    media_resolution: '1920x1080',
    is_live_stream: true,
    raw_headers_json: JSON.stringify({
      'content-type': 'application/vnd.apple.mpegurl',
      'server': 'EdgeDRM/3.1'
    }),
    verification_logs: '[Verification] 200 OK reachable in 112.0ms\n[DRM Check] Detected #EXT-X-KEY:METHOD=SAMPLE-AES with FairPlay/Widevine URI.\n[Compliance] DRM bypass strictly prohibited. Source flagged as DRM_PROTECTED.',
    last_inspected_at: new Date(Date.now() - 1800000).toISOString()
  };
  db.upsertCandidate(cand2);

  // -------------------------------------------------------------
  // Candidate 3: Unreachable / 404 Stream (Edge Case: Honest Failure Reporting)
  // -------------------------------------------------------------
  const cand3Id = 'cand_sports_dead_404';
  const cand3: CandidateItem = {
    id: cand3Id,
    job_id: jobId,
    reference_id: ref1Id,
    source_url: 'https://buffstreams.sx/stream/expired-live-chunk-999.m3u8',
    domain: 'buffstreams.sx',
    discovered_title: 'BuffStreams UCL mirror 4 (Dead Link)',
    discovery_provider: 'SPORTS_DIRECTORY',
    discovered_at: new Date(Date.now() - 3200000).toISOString(),
    pipeline_status: 'UNREACHABLE',
    reachability_code: 404,
    reachability_latency_ms: 245.8,
    media_type: 'UNKNOWN',
    is_live_stream: true,
    verification_logs: '[Verification] Network probe received HTTP 404 Not Found.\n[Diagnostic] Stream segment or manifest expired on origin server. Marked UNREACHABLE.',
    last_inspected_at: new Date(Date.now() - 2000000).toISOString()
  };
  db.upsertCandidate(cand3);

  // -------------------------------------------------------------
  // Candidate 4: Clean Non-Infringing Video (Cooking Show) -> NO_MATCH
  // -------------------------------------------------------------
  const cand4Id = 'cand_clean_non_infringing';
  const cand4: CandidateItem = {
    id: cand4Id,
    job_id: jobId,
    reference_id: ref1Id,
    source_url: 'https://public-web.tv/culinary/artisan-pasta-chef.mp4',
    domain: 'public-web.tv',
    discovered_title: 'Artisan Pasta Masterclass Episode 4',
    discovery_provider: 'SEARCH_CRAWLER',
    discovered_at: new Date(Date.now() - 2800000).toISOString(),
    pipeline_status: 'ANALYZED',
    reachability_code: 200,
    reachability_latency_ms: 62.4,
    media_type: 'MP4',
    media_resolution: '1280x720',
    media_duration_sec: 1800,
    is_live_stream: false,
    verification_logs: '[Verification] 200 OK reachable in 62.4ms\n[Acquisition] MP4 media container verified\n[Analysis] Perceptual dHash sequence tested against UCL reference. Average distance: 41.2 bits. Confirmed NO_MATCH.',
    last_inspected_at: new Date(Date.now() - 900000).toISOString()
  };
  db.upsertCandidate(cand4);

  // Candidate 4 fingerprints (completely different hashes)
  const cand4Fingerprints: FrameFingerprint[] = [
    {
      id: 'cfp_4_0',
      candidate_id: cand4Id,
      timestamp_sec: 0,
      frame_index: 0,
      phash_hex: '00112233aabbccdd',
      thumbnail_data: createThumbnailSvg('Culinary Kitchen', 'public-web.tv', '#78350f', '#fde68a', '00:00:00'),
      created_at: now
    },
    {
      id: 'cfp_4_1',
      candidate_id: cand4Id,
      timestamp_sec: 2,
      frame_index: 1,
      phash_hex: '00112233aabbccfe',
      thumbnail_data: createThumbnailSvg('Pasta Dough Prep', 'public-web.tv', '#78350f', '#fde68a', '00:00:02'),
      created_at: now
    }
  ];
  db.insertCandidateFingerprints(cand4Fingerprints);

  const comp4 = FingerprintEngine.compareFingerprintSequences(cand4Fingerprints, ref1Fingerprints);
  const seal4 = FingerprintEngine.generateCustodySeal({
    candidateUrl: cand4.source_url,
    referenceId: ref1Id,
    confidenceScore: comp4.confidenceScore,
    minHammingDist: comp4.minHammingDist,
    temporalOffsetSec: comp4.temporalOffsetSec,
    samplePairs: comp4.samplePairs
  });

  const ev4: EvidenceRecord = {
    id: 'ev_clean_culinary_nomatch',
    candidate_id: cand4Id,
    reference_id: ref1Id,
    candidate_url: cand4.source_url,
    candidate_domain: cand4.domain,
    reference_title: ref1.title,
    rights_holder: ref1.rights_holder,
    match_status: 'NO_MATCH',
    confidence_score: comp4.confidenceScore,
    min_hamming_dist: comp4.minHammingDist,
    avg_hamming_dist: comp4.avgHammingDist,
    matched_frames_count: comp4.matchedFramesCount,
    total_compared_frames: comp4.totalComparedFrames,
    temporal_offset_sec: comp4.temporalOffsetSec,
    sample_pairs: comp4.samplePairs,
    chain_of_custody_sha256: seal4,
    review_decision: 'PENDING',
    created_at: now
  };
  db.insertEvidenceRecord(ev4);

  return {
    loadedReferences: 2,
    loadedCandidates: 4
  };
}
