/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Automated Verification & Test Suite
 *
 * Covers:
 * 1. Perceptual hashing (dHash) & mathematical Hamming distance calculation
 * 2. Temporal sequence cross-correlation & confidence score derivations
 * 3. Candidate URL deduplication and normalization
 * 4. Database CRUD operations, constraints, and cascading integrity
 * 5. Digital evidence seal generation (SHA-256 chain of custody)
 * 6. Pipeline state transitions & error handling
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { FrameFingerprint } from '../types.js';

// CRITICAL SAFEGUARD: Configure an isolated temporary SQLite database path BEFORE importing
// the database singleton or any application modules so tests never read or modify data/argus.db.
const LIVE_DB_PATH = path.resolve(process.cwd(), 'data', 'argus.db');
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `spectra_isolated_test_${process.pid}_`));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'argus_test.db');
const TEST_THUMBNAILS_DIR = path.join(TEST_DB_DIR, 'thumbnails');
process.env.SPECTRA_DB_PATH = TEST_DB_PATH;
process.env.SPECTRA_THUMBNAILS_DIR = TEST_THUMBNAILS_DIR;

const liveDbExistedBefore = fs.existsSync(LIVE_DB_PATH);
const liveDbSha256Before = liveDbExistedBefore
  ? crypto.createHash('sha256').update(fs.readFileSync(LIVE_DB_PATH)).digest('hex')
  : null;
const liveDbSizeBefore = liveDbExistedBefore ? fs.statSync(LIVE_DB_PATH).size : null;

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failedTests++;
  }
}

async function runTestSuite() {
  const { FingerprintEngine } = await import('../engine/fingerprint.js');
  const { DiscoveryEngine } = await import('../engine/discovery.js');
  const { db, ArgusDatabase } = await import('../db/database.js');
  const { loadOptionalForensicTestSuite, ensureMasterVideosExist, ensureTaylorSwiftPatientZeroRegistered } = await import('../engine/sampleData.js');
  const { AdapterRegistry } = await import('../engine/adapters/index.js');
  const { VerifierEngine } = await import('../engine/verifier.js');
  const { YouTubeAdapter } = await import('../engine/adapters/youtube.js');
  const { StreamingServicesAdapter } = await import('../engine/adapters/streaming.js');
  const { SuspectedPiracyAdapter } = await import('../engine/adapters/suspected_piracy.js');
  const { PublicVideoPlatformsAdapter } = await import('../engine/adapters/public_video.js');
  const { WebCrawlerAdapter } = await import('../engine/adapters/web_crawler.js');
  const { O2TvSeriesAdapter } = await import('../engine/adapters/o2tvseries.js');
  const { CandidateResearchEngine } = await import('../engine/candidateResearch.js');
  const { SearchCoverageEngine } = await import('../engine/searchCoverage.js');

  try {
  console.log('\n======================================================');
  console.log('  ARGUS ANTI-PIRACY PLATFORM — COMPREHENSIVE TEST SUITE');
  console.log(`  Isolated Test DB: ${db.getDbFilePath()}`);
  console.log('======================================================\n');

  // -------------------------------------------------------------
  // Test Group 1: Perceptual Hashing & Hamming Distance Math
  // -------------------------------------------------------------
  console.log('[Test Group 1] Perceptual Hashing & Hamming Metric Verification');

  // Test 1.1: Identical hashes must yield distance = 0 and 100% similarity
  const hashA = 'f0f0a8a83c3c1212';
  const distIdentical = FingerprintEngine.hammingDistance(hashA, hashA);
  assert(distIdentical === 0, 'Identical hashes produce Hamming distance of 0');
  assert(FingerprintEngine.similarityPercentage(distIdentical) === 100, 'Identical hashes produce 100% similarity');

  // Test 1.2: Single bit difference
  // 'f0f0a8a83c3c1212' vs 'f0f0a8a83c3c1213' (last nibble: 0x2 (0010) vs 0x3 (0011) -> 1 bit difference)
  const hashB = 'f0f0a8a83c3c1213';
  const distSingleBit = FingerprintEngine.hammingDistance(hashA, hashB);
  assert(distSingleBit === 1, 'Single-bit variation produces Hamming distance of 1', `Got: ${distSingleBit}`);
  assert(FingerprintEngine.similarityPercentage(distSingleBit) === 98.44, 'Single bit difference yields ~98.44% similarity');

  // Test 1.3: Inverse hash (64 bits differing)
  // 0x0000000000000000 vs 0xffffffffffffffff -> 64 bits diff
  const hashZero = '0000000000000000';
  const hashFull = 'ffffffffffffffff';
  const distMax = FingerprintEngine.hammingDistance(hashZero, hashFull);
  assert(distMax === 64, 'Opposite hashes produce maximum Hamming distance of 64', `Got: ${distMax}`);
  assert(FingerprintEngine.similarityPercentage(distMax) === 0, 'Inverse hashes produce 0% similarity');

  // Test 1.4: Synthetic 9x8 grayscale raw buffer dHash computation
  // Create 72 bytes buffer where left > right alternating
  const syntheticBuffer = Buffer.alloc(72);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 9; c++) {
      syntheticBuffer[r * 9 + c] = (c % 2 === 0) ? 200 : 50;
    }
  }
  const computed = FingerprintEngine.computeDHashFromGrayscale9x8(syntheticBuffer);
  assert(computed.phash_hex.length === 16, 'Computed dHash produces 16 hex character (64-bit) fingerprint');
  assert(computed.avg_luminance > 0, 'Average luminance is computed accurately');

  // -------------------------------------------------------------
  // Test Group 2: Temporal Sequence Cross-Correlation Alignment
  // -------------------------------------------------------------
  console.log('\n[Test Group 2] Temporal Alignment & Sequence Matching');

  const refFrames: FrameFingerprint[] = [
    { id: 't_r0', timestamp_sec: 0, frame_index: 0, phash_hex: 'a1b2c3d4e5f60718', avg_luminance: 100, created_at: '' },
    { id: 't_r1', timestamp_sec: 2, frame_index: 1, phash_hex: 'a1b2c3d4e5f60719', avg_luminance: 100, created_at: '' },
    { id: 't_r2', timestamp_sec: 4, frame_index: 2, phash_hex: 'a1b2c3d4e5f60720', avg_luminance: 100, created_at: '' },
    { id: 't_r3', timestamp_sec: 6, frame_index: 3, phash_hex: 'a1b2c3d4e5f60721', avg_luminance: 100, created_at: '' }
  ];

  // Candidate with +10s broadcast delay and minimal compression noise (1 bit diff per frame)
  const candMatchingFrames: FrameFingerprint[] = [
    { id: 't_c0', timestamp_sec: 10, frame_index: 0, phash_hex: 'a1b2c3d4e5f60718', created_at: '', avg_luminance: 100 },
    { id: 't_c1', timestamp_sec: 12, frame_index: 1, phash_hex: 'a1b2c3d4e5f60719', created_at: '', avg_luminance: 100 },
    { id: 't_c2', timestamp_sec: 14, frame_index: 2, phash_hex: 'a1b2c3d4e5f60720', created_at: '', avg_luminance: 100 },
    { id: 't_c3', timestamp_sec: 16, frame_index: 3, phash_hex: 'a1b2c3d4e5f60721', created_at: '', avg_luminance: 100 }
  ];

  const matchResult = FingerprintEngine.compareFingerprintSequences(candMatchingFrames, refFrames);
  assert(matchResult.matchStatus === 'POTENTIAL_MATCH', 'Detects potential match for aligned temporal stream');
  assert(matchResult.temporalOffsetSec === 10, 'Identifies precise temporal offset (+10s delay)', `Got: ${matchResult.temporalOffsetSec}`);
  assert(matchResult.minHammingDist === 0, 'Calculates minimum Hamming distance = 0 on exact match');
  assert(matchResult.confidenceScore > 0.8, 'Assigns high confidence score for coherent sequence match');

  // Candidate with random unrelated hashes -> NO_MATCH
  const candDissimilarFrames: FrameFingerprint[] = [
    { id: 't_d0', timestamp_sec: 0, frame_index: 0, phash_hex: 'ffffffff00000000', created_at: '', avg_luminance: 50 },
    { id: 't_d1', timestamp_sec: 2, frame_index: 1, phash_hex: '00000000ffffffff', created_at: '', avg_luminance: 50 }
  ];
  const noMatchResult = FingerprintEngine.compareFingerprintSequences(candDissimilarFrames, refFrames);
  assert(noMatchResult.matchStatus === 'NO_MATCH', 'Correctly rejects dissimilar candidate stream (NO_MATCH)');
  assert(noMatchResult.confidenceScore === 0.0, 'Assigns 0 confidence to non-matching stream');

  // -------------------------------------------------------------
  // Test Group 3: URL Deduplication & Domain Normalization
  // -------------------------------------------------------------
  console.log('\n[Test Group 3] URL Normalization & Deduplication');

  const urlWithTracking = 'https://STREAM-hd.TV/live/match-1?utm_source=twitter&ref=pirate&fbclid=123';
  const normalized = DiscoveryEngine.normalizeUrl(urlWithTracking);
  assert(normalized.domain === 'stream-hd.tv', 'Domain is extracted and lowercased');
  assert(!normalized.normalizedUrl.includes('utm_source'), 'Strips marketing tracking parameters');
  assert(!normalized.normalizedUrl.includes('fbclid'), 'Strips social click tracking parameters');

  // -------------------------------------------------------------
  // Test Group 4: Database Persistence & Forensic Fixture Integrity
  // -------------------------------------------------------------
  console.log('\n[Test Group 4] Database CRUD & Forensic Suite Verification');

  // Snapshot any user-registered references, jobs, candidates, fingerprints, and evidence before fixture test
  const userRefsBackup = db.getReferences().filter(r => r.source_type !== 'FORENSIC_SAMPLE');
  const userRefIds = new Set(userRefsBackup.map(r => r.id));
  const userRefFpsBackup = new Map<string, FrameFingerprint[]>();
  for (const ur of userRefsBackup) {
    userRefFpsBackup.set(ur.id, db.getReferenceFingerprints(ur.id));
  }
  const userJobsBackup = db.getDiscoveryJobs().filter(j => j.target_reference_id && userRefIds.has(j.target_reference_id));
  const userCandsBackup = db.getCandidates().filter(c => c.reference_id && userRefIds.has(c.reference_id));
  const userCandFpsBackup = new Map<string, FrameFingerprint[]>();
  for (const uc of userCandsBackup) {
    userCandFpsBackup.set(uc.id, db.getCandidateFingerprints(uc.id));
  }
  const userEvBackup = db.getEvidenceRecords().filter(e => userRefIds.has(e.reference_id));

  const { loadedReferences, loadedCandidates } = loadOptionalForensicTestSuite();
  assert(loadedReferences >= 2, `Seeded ${loadedReferences} reference items successfully`);
  assert(loadedCandidates >= 4, `Seeded ${loadedCandidates} candidate sources across edge cases`);

  const refs = db.getReferences();
  assert(refs.length >= 2, 'Retrieved persisted references from SQLite database');

  const candList = db.getCandidates();
  assert(candList.length >= 4, 'Retrieved candidates from SQLite database');

  // Verify edge cases are correctly represented in database:
  const drmCand = candList.find(c => c.pipeline_status === 'DRM_PROTECTED');
  assert(Boolean(drmCand), 'DRM_PROTECTED stream edge case correctly recorded in database');

  const deadCand = candList.find(c => c.pipeline_status === 'UNREACHABLE');
  assert(Boolean(deadCand), 'UNREACHABLE / 404 stream edge case correctly recorded in database');

  const evidenceRecords = db.getEvidenceRecords();
  assert(evidenceRecords.length >= 2, 'Evidence records persisted with sample pairs');

  const primaryEvidence = evidenceRecords[0];
  assert(Boolean(primaryEvidence.chain_of_custody_sha256), 'Cryptographic SHA-256 custody seal is present');
  assert(primaryEvidence.sample_pairs.length > 0, 'Side-by-side keyframe match pairs are stored');

  // Verify review workflow update
  db.updateEvidenceReview(primaryEvidence.id, 'CONFIRMED', 'Senior Investigator Jane Doe', 'Definitive broadcast watermark and sequence match', 'CONFIRMED_INFRINGEMENT');
  const reviewedEv = db.getEvidenceById(primaryEvidence.id);
  assert(reviewedEv?.review_decision === 'CONFIRMED', 'Human review decision successfully recorded');
  assert(reviewedEv?.match_status === 'CONFIRMED_INFRINGEMENT', 'Match status transitioned to CONFIRMED_INFRINGEMENT');
  assert(reviewedEv?.reviewed_by === 'Senior Investigator Jane Doe', 'Reviewer attribution preserved in audit log');

  // Verify computed system stats
  const stats = db.getSystemStats();
  assert(stats.total_references >= 2, 'Stats: computed total references is accurate');
  assert(stats.total_candidates >= 4, 'Stats: computed total candidates is accurate');
  assert(stats.confirmed_infringements >= 1, 'Stats: computed confirmed infringements matches human review');

  // Restore user-registered references, jobs, candidates, fingerprints, and evidence
  for (const ur of userRefsBackup) {
    db.upsertReference(ur);
    const fps = userRefFpsBackup.get(ur.id) || [];
    if (fps.length > 0) {
      db.clearReferenceFingerprints(ur.id);
      db.insertReferenceFingerprints(fps);
    }
  }
  for (const uj of userJobsBackup) {
    try { db.insertDiscoveryJob(uj); } catch {}
  }
  for (const uc of userCandsBackup) {
    db.upsertCandidate(uc);
    db.updateCandidateVerification(uc.id, uc);
    const cfps = userCandFpsBackup.get(uc.id) || [];
    if (cfps.length > 0) {
      db.clearCandidateFingerprints(uc.id);
      db.insertCandidateFingerprints(cfps);
    }
  }
  for (const ue of userEvBackup) {
    db.insertEvidenceRecord(ue);
  }

  // -------------------------------------------------------------
  // Test Group 5: Multi-Source Adapter Dispatch & DRM Compliance
  // -------------------------------------------------------------
  console.log('\n[Test Group 5] Multi-Source Adapter Dispatch & DRM Compliance');

  const allAdapters = AdapterRegistry.getAllAdapters();
  assert(allAdapters.length >= 5, `AdapterRegistry registers all ${allAdapters.length} modular source adapters (including O2TvSeriesAdapter)`);

  const ytAdapter = AdapterRegistry.getAdapterForUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert(ytAdapter instanceof YouTubeAdapter, 'Resolves YouTubeAdapter for youtube.com watch URLs');

  const netflixAdapter = AdapterRegistry.getAdapterForUrl('https://www.netflix.com/title/81442199');
  assert(netflixAdapter instanceof StreamingServicesAdapter, 'Resolves StreamingServicesAdapter for netflix.com URLs');

  const hotstarAdapter = AdapterRegistry.getAdapterForUrl('https://www.hotstar.com/movies/patient-zero/1260084321');
  assert(hotstarAdapter instanceof StreamingServicesAdapter, 'Resolves StreamingServicesAdapter for hotstar.com URLs');

  const piracyAdapter = AdapterRegistry.getAdapterForUrl('https://soap2day-mirror.org/movie/test-leak-hd');
  assert(piracyAdapter instanceof SuspectedPiracyAdapter, 'Resolves SuspectedPiracyAdapter for soap2day / embed domains');

  const publicVideoAdapter = AdapterRegistry.getAdapterForUrl('https://archive.org/details/test_video_preservation');
  assert(publicVideoAdapter instanceof PublicVideoPlatformsAdapter, 'Resolves PublicVideoPlatformsAdapter for archive.org');

  const crawlerAdapter = AdapterRegistry.getAdapterForUrl('https://unknown-indie-cinema.org/watch');
  assert(crawlerAdapter instanceof WebCrawlerAdapter, 'Resolves WebCrawlerAdapter as fallback for arbitrary public websites');

  // Probe Netflix title: Must flag DRM_PROTECTED and refuse unauthorized circumvention
  const streaming = new StreamingServicesAdapter();
  const netflixProbe = await streaming.acquireAndProbe('https://www.netflix.com/title/81442199');
  assert(netflixProbe.pipelineStatus === 'DRM_PROTECTED', 'Netflix catalog probed with pipelineStatus: DRM_PROTECTED');
  assert(Boolean(netflixProbe.drmScheme?.includes('Widevine')), 'Detects Widevine Modular DRM protection scheme');
  assert(netflixProbe.accessible === false, 'Compliance guarantee: prohibits unauthorized DRM circumvention');

  // Probe Cloudflare blocked piracy host
  const piracy = new SuspectedPiracyAdapter();
  const blockedProbe = await piracy.acquireAndProbe('https://fmovies-free.to/film/test/cf-blocked');
  assert(blockedProbe.pipelineStatus === 'BLOCKED', 'Detects Cloudflare Turnstile CAPTCHA wall (BLOCKED)');
  assert(blockedProbe.httpStatus === 403, 'Records HTTP 403 status code for blocked host');

  // Probe non-existent piracy host: Must honestly report UNREACHABLE (never fake HTTP 200)
  const unreachProbe = await piracy.acquireAndProbe('https://superstream-nonexistent-host-9999.tv/hls/live/test/master.m3u8');
  assert(unreachProbe.pipelineStatus === 'UNREACHABLE', 'Non-existent host honestly reported as UNREACHABLE');
  assert(unreachProbe.accessible === false, 'Unreachable stream is marked accessible: false');

  // -------------------------------------------------------------
  // Test Group 6: Live Multi-Source Discovery & Statutory Takedowns
  // -------------------------------------------------------------
  console.log('\n[Test Group 6] Live Multi-Source Discovery & Statutory Takedowns');

  // Live multi-source discovery across real adapters (YouTube, Dailymotion, Archive.org, Web Search)
  const multiDiscovered = await AdapterRegistry.executeMultiSourceDiscovery('India vs New Zealand 1st T20', {
    maxTotalCandidates: 20
  });
  assert(multiDiscovered.length >= 3, `Discovered ${multiDiscovered.length} genuine live candidate URLs`);

  // Verify no fabricated hardcoded Rick Astley IDs or random slug URLs
  const hasFabricatedRickRoll = multiDiscovered.some(d => d.url.includes('dQw4w9WgXcQ'));
  assert(!hasFabricatedRickRoll, 'Never returns hardcoded unrelated YouTube IDs (e.g. dQw4w9WgXcQ)');

  const categorySet = new Set(multiDiscovered.map(d => d.sourceCategory));
  assert(categorySet.has('YOUTUBE') || categorySet.has('PUBLIC_PLATFORM') || categorySet.has('OTHER'), 'Discovered live candidate URLs from real accessible providers');

  // Verify adapter diagnostics are recorded
  const diagnostics = AdapterRegistry.getLastRunDiagnostics();
  assert(diagnostics.length >= 3, `Recorded ${diagnostics.length} per-adapter diagnostic entries`);

  // Deduplication check (distinct media assets on the same webpage have unique url||mediaUrl keys)
  const urlAssetSet = new Set(multiDiscovered.map(d => `${d.url.toLowerCase()}||${(d.mediaUrl || '').toLowerCase()}`));
  assert(urlAssetSet.size === multiDiscovered.length, 'Deduplication guarantees all discovered candidate assets (url + mediaUrl) are unique');

  // Statutory DMCA Takedown Notice generation
  const takedownNotice = VerifierEngine.generateTakedownNotice(primaryEvidence);
  assert(takedownNotice.includes('DIGITAL MILLENNIUM COPYRIGHT ACT'), 'Takedown notice includes statutory DMCA header');
  assert(takedownNotice.includes(primaryEvidence.chain_of_custody_sha256), 'Takedown notice includes SHA-256 custody seal');
  assert(takedownNotice.includes(primaryEvidence.reference_title), 'Takedown notice references copyrighted work title');
  assert(takedownNotice.includes(primaryEvidence.candidate_url), 'Takedown notice specifies infringing candidate URL');
  assert(takedownNotice.includes('penalty of perjury'), 'Takedown notice includes penalty of perjury statutory declaration');
  assert(!takedownNotice.includes('NaN'), 'Confidence score is formatted cleanly without NaN');

  // -------------------------------------------------------------
  // Test Group 7: OTT Reference Ingestion Workflow & Compliance Gates
  // -------------------------------------------------------------
  console.log('\n[Test Group 7] OTT Reference Ingestion Workflow (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video)');

  const sonyLivUrl = 'https://www.sonyliv.com/live-sport/india-tour-of-new-zealand-2026-1790007839/cricket-1st-t20i-22-oct-2026-1090549541?watch=true';
  const sonyCheck = FingerprintEngine.isDrmOrProtectedWebPlatform(sonyLivUrl);
  assert(sonyCheck.isProtected === true, 'Detects SonyLIV watch URL as protected OTT platform');
  assert(sonyCheck.platformName === 'SonyLIV', 'Extracts platform name "SonyLIV" from URL');
  assert(Boolean(sonyCheck.suggestedSeasonEpisode?.includes('1st T20i')), 'Extracts live sports event detail ("1st T20i 22 Oct 2026") from SonyLIV URL');

  const hotstarCheck = FingerprintEngine.isDrmOrProtectedWebPlatform('https://www.hotstar.com/in/shows/special-ops/1260022894/season-1-episode-3/watch');
  assert(hotstarCheck.isProtected && hotstarCheck.platformName === 'Disney+ Hotstar', 'Detects Disney+ Hotstar URL');
  assert(Boolean(hotstarCheck.suggestedSeasonEpisode?.includes('SEASON 1 EPISODE 3')), 'Extracts Season/Episode metadata from Hotstar URL');

  const jioCheck = FingerprintEngine.isDrmOrProtectedWebPlatform('https://www.jiocinema.com/sports/cricket/india-vs-australia-s01e01/3999111');
  assert(jioCheck.isProtected && jioCheck.platformName === 'JioCinema', 'Detects JioCinema OTT URL');

  const primeCheck = FingerprintEngine.isDrmOrProtectedWebPlatform('https://www.primevideo.com/detail/0G9X123456');
  assert(primeCheck.isProtected && primeCheck.platformName === 'Amazon Prime Video', 'Detects Amazon Prime Video OTT URL');

  // Verify extractVideoFingerprints throws OTT_PROTECTED_WEBPAGE (never INVALID_TEST_PATTERN_SOURCE)
  let caughtOttCode = '';
  try {
    await FingerprintEngine.extractVideoFingerprints(sonyLivUrl, { isCandidate: false });
  } catch (err: any) {
    caughtOttCode = err?.code || '';
  }
  assert(caughtOttCode === 'OTT_PROTECTED_WEBPAGE', 'Protected OTT watch page throws OTT_PROTECTED_WEBPAGE instead of INVALID_TEST_PATTERN_SOURCE');

  // Persist a METADATA_REGISTERED and AWAITING_AUTHORIZED_MEDIA OTT reference and verify metadata preservation & frame-matching gate
  const testOttRefId = 'ref_test_ott_sonyliv';
  db.upsertReference({
    id: testOttRefId,
    title: 'India Tour of New Zealand 2026',
    rights_holder: 'Sony Pictures Networks India',
    asset_type: 'LIVE_SPORTS',
    duration_sec: 5400,
    resolution: '1920x1080',
    fps: 50,
    codec: 'ott-drm-protected',
    source_type: 'OTT_PAGE',
    source_url: sonyLivUrl,
    platform: 'SonyLIV',
    season_episode_info: '1st T20I • 22 Oct 2026',
    provider_integration_status: 'AWAITING_AUTHORIZED_MEDIA',
    created_at: new Date().toISOString(),
    status: 'AWAITING_AUTHORIZED_MEDIA',
    provenance_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    fingerprint_count: 0,
    notes: 'OTT metadata registered for SonyLIV'
  });

  const savedOttRef = db.getReferenceById(testOttRefId);
  assert(savedOttRef?.status === 'AWAITING_AUTHORIZED_MEDIA', 'OTT reference saved with status AWAITING_AUTHORIZED_MEDIA (not INVALID)');
  assert(savedOttRef?.platform === 'SonyLIV', 'OTT reference preserves platform metadata');
  assert(savedOttRef?.season_episode_info === '1st T20I • 22 Oct 2026', 'OTT reference preserves season/episode/event details');
  assert(savedOttRef?.source_url === sonyLivUrl, 'OTT reference preserves original OTT webpage URL');
  assert(savedOttRef?.fingerprint_count === 0, 'OTT metadata-only reference has 0 fingerprints (never fabricated)');

  // Clean up temporary test reference
  db.deleteReference(testOttRefId);

  // -------------------------------------------------------------
  // Test Group 8: Live Sports Multi-Offset Matching, Metadata Assessment & Evidence Vault Preservation
  // -------------------------------------------------------------
  console.log('\n[Test Group 8] Live Sports Multi-Offset Matching, Metadata Assessment & Evidence Preservation');

  // 8.1: Live sports candidate with non-linear replay/camera cut offsets and 14-bit scoreboard overlay difference
  // Reference hash '85d7c319cfc665a6' vs candidate with 14 bits flipped ('85d7c319cfc65a59' -> 14 bits diff)
  const sportsRefFps: FrameFingerprint[] = [
    { id: 'sr_0', timestamp_sec: 0, frame_index: 0, phash_hex: '85d7c319cfc665a6', avg_luminance: 120, thumbnail_url: '/thumbnails/ref0.jpg', created_at: '' },
    { id: 'sr_1', timestamp_sec: 2, frame_index: 1, phash_hex: '85d7c70d0fc64526', avg_luminance: 122, thumbnail_url: '/thumbnails/ref1.jpg', created_at: '' },
    { id: 'sr_2', timestamp_sec: 4, frame_index: 2, phash_hex: '8e53331dcd4d65b1', avg_luminance: 118, thumbnail_url: '/thumbnails/ref2.jpg', created_at: '' }
  ];

  // Candidate has non-identical timestamps (+24s and +52s replay cut) and 14-bit overlay variation
  const sportsCandReplayFps: FrameFingerprint[] = [
    { id: 'sc_0', timestamp_sec: 24, frame_index: 0, phash_hex: '85d7c319cfc60000', avg_luminance: 119, thumbnail_url: '/thumbnails/cand0.jpg', created_at: '' },
    { id: 'sc_1', timestamp_sec: 52, frame_index: 1, phash_hex: '8e53331dcd4d0000', avg_luminance: 117, thumbnail_url: '/thumbnails/cand1.jpg', created_at: '' }
  ];

  const liveReplayComp = FingerprintEngine.compareFingerprintSequences(sportsCandReplayFps, sportsRefFps, {
    isLiveSports: true
  });
  assert(liveReplayComp.matchedFramesCount === 2, 'Live sports mode matches frames across non-linear replay offsets and overlay variance');
  assert((liveReplayComp.visualSimilarityScore ?? 0) > 0.80, `Computes genuine visual similarity (${((liveReplayComp.visualSimilarityScore ?? 0) * 100).toFixed(1)}%) across temporal offsets`);
  assert(liveReplayComp.samplePairs.length >= 2, 'Preserves side-by-side sample pairs for non-linear live sports matches');

  // 8.2: Candidate with alternate camera angle (20-bit Hamming distance -> 68.75% visual similarity)
  // Must NOT report 0% visual similarity and must NOT discard samplePairs!
  const altCameraCandFps: FrameFingerprint[] = [
    { id: 'ac_0', timestamp_sec: 10, frame_index: 0, phash_hex: '85d7c31900009a59', avg_luminance: 115, thumbnail_url: '/thumbnails/alt0.jpg', created_at: '' },
    { id: 'ac_1', timestamp_sec: 12, frame_index: 1, phash_hex: '85d7c70dffffbadd', avg_luminance: 115, thumbnail_url: '/thumbnails/alt1.jpg', created_at: '' }
  ];
  const altComp = FingerprintEngine.compareFingerprintSequences(altCameraCandFps, sportsRefFps, {
    isLiveSports: true
  });
  assert((altComp.visualSimilarityScore ?? 0) > 0.55, `Never reports 0% visual similarity when temporal/threshold lock fails (Got: ${((altComp.visualSimilarityScore ?? 0) * 100).toFixed(1)}%)`);
  assert(altComp.samplePairs.length === 2, 'Preserves closest visual samplePairs even when matchedFramesCount is 0');
  assert(altComp.samplePairs[0].candidate_thumbnail === '/thumbnails/alt0.jpg', 'Preserves candidate frame thumbnail in unmatched samplePairs');

  // 8.3: Metadata & Context Assessment + Non-Infringement Safeguard
  const metaResult = FingerprintEngine.assessMetadataAndContext({
    candidate: {
      id: 'cand_test_ind_nz',
      source_url: 'https://www.youtube.com/watch?v=Y1EAvFkTRVM',
      domain: 'youtube.com',
      platform: 'YouTube',
      discovered_title: 'India vs New Zealand 1st T20 Full Highlights 2026 | IND VS NZ | 226 Run Chase',
      discovery_provider: 'YOUTUBE_PUBLIC',
      discovered_at: new Date().toISOString(),
      pipeline_status: 'ANALYZED',
      reachability_code: 200,
      reachability_latency_ms: 95,
      media_type: 'HTML_PLAYER',
      is_live_stream: false
    },
    reference: {
      id: 'ref_test_ind_nz',
      title: 'India Tour of New Zealand 2026 — 1st T20I',
      rights_holder: 'Sony Pictures Networks India',
      asset_type: 'LIVE_SPORTS',
      duration_sec: 5400,
      resolution: '1920x1080',
      fps: 50,
      codec: 'h264',
      source_type: 'DIRECT_URL',
      platform: 'SonyLIV',
      season_episode_info: '1st T20I • 22 Oct 2026',
      created_at: new Date().toISOString(),
      status: 'FINGERPRINTED',
      provenance_sha256: 'abc',
      fingerprint_count: 3
    },
    verifiedPageTitle: 'India vs New Zealand 1st T20 Full Highlights 2026 | IND VS NZ | 226 Run Chase',
    candidateFps: altCameraCandFps,
    referenceFps: sportsRefFps,
    visualSimilarityScore: altComp.visualSimilarityScore,
    matchedFramesCount: 0,
    minHammingDist: 20,
    confidenceScore: 0
  });

  assert(metaResult.metadataRelevanceScore >= 0.80, `Computes high metadata relevance (${(metaResult.metadataRelevanceScore * 100).toFixed(0)}%) for matching teams, fixture, competition, and year`);
  assert(metaResult.overallAssessment === 'POSSIBLE_MATCH', `Classifies event-related alternate-angle candidate as POSSIBLE_MATCH (Got: ${metaResult.overallAssessment})`);
  assert(metaResult.metadataSignals.some(s => s.signal_type === 'TEAMS_PARTICIPANTS' && s.status === 'MATCHED'), 'Observes and matches Teams/Participants signal (India vs New Zealand)');
  assert(metaResult.metadataSignals.some(s => s.signal_type === 'EVENT_FIXTURE' && s.status === 'MATCHED'), 'Observes and matches Event/Fixture signal (1st T20I)');
  assert(metaResult.metadataSignals.some(s => s.signal_type === 'SCOREBOARD_TEXT'), 'Observes Scoreboard/Overlay text cues and frame luminance telemetry');
  assert(metaResult.uncertaintyReasons.some(r => r.includes('metadata alone does not establish copyright infringement')), 'Includes explicit compliance reason that metadata alone does not establish infringement');

  // -------------------------------------------------------------
  // Test Group 9: Seed Sources, Keyword Combinations, Provenance Deduplication & Classification
  // -------------------------------------------------------------
  console.log('\n[Test Group 9] Seed Sources, Expanded Keyword Combinations, Provenance & Asset Classification');

  // 9.1: Configurable Seed Sources include kickasstorrents.io and unblockit.li
  const configuredSeeds = SuspectedPiracyAdapter.getConfiguredSeedSources();
  assert(configuredSeeds.includes('https://kickasstorrents.io/'), 'Default configurable seed sources include https://kickasstorrents.io/');
  assert(configuredSeeds.includes('https://unblockit.li/'), 'Default configurable seed sources include https://unblockit.li/');

  // Live probe of seed sources (validates redirect / finalDomain / crawlStatus recording)
  const katProbe = await SuspectedPiracyAdapter.probeSeedSource('https://kickasstorrents.io/');
  assert(
    katProbe.seedUrl === 'https://kickasstorrents.io/' &&
      typeof katProbe.finalDomain === 'string' &&
      katProbe.finalDomain.length > 0 &&
      ['ACCESSIBLE', 'ACCESS_RESTRICTED', 'BLOCKED_OR_CHALLENGED', 'UNREACHABLE', 'TIMEOUT'].includes(katProbe.crawlStatus),
    `Probes https://kickasstorrents.io/ and records crawlStatus=${katProbe.crawlStatus}, httpStatus=${katProbe.httpStatus}, finalDomain=${katProbe.finalDomain}`
  );

  const unblockitProbe = await SuspectedPiracyAdapter.probeSeedSource('https://unblockit.li/');
  assert(
    unblockitProbe.seedUrl === 'https://unblockit.li/' &&
      typeof unblockitProbe.finalDomain === 'string' &&
      unblockitProbe.finalDomain.length > 0 &&
      ['ACCESSIBLE', 'ACCESS_RESTRICTED', 'BLOCKED_OR_CHALLENGED', 'UNREACHABLE', 'TIMEOUT'].includes(unblockitProbe.crawlStatus),
    `Probes https://unblockit.li/ and records crawlStatus=${unblockitProbe.crawlStatus}, httpStatus=${unblockitProbe.httpStatus}, finalDomain=${unblockitProbe.finalDomain}`
  );

  // 9.2: Expanded Keyword Combination Generation
  const sportsCombos = DiscoveryEngine.generateKeywordCombinations({
    title: 'India Tour of New Zealand 2026 — 1st T20I',
    seasonEpisodeInfo: '1st T20I • 22 Oct 2026',
    assetType: 'LIVE_SPORTS',
    customVariations: DiscoveryEngine.STANDARD_KEYWORD_VARIATIONS
  });
  assert(sportsCombos.some(c => c.includes('LIVE STREAM') || c.includes('FULL MATCH')), 'Generates LIVE STREAM / FULL MATCH combinations for Live Sports reference');
  assert(sportsCombos.some(c => c.toLowerCase().includes('india vs new zealand') || c.includes('IND vs NZ')), 'Extracts participating teams for keyword combinations');
  assert(sportsCombos.some(c => c.includes('1080p') || c.includes('HD') || c.includes('4K')), 'Includes resolution/quality variations (HD, 1080p, 4K)');

  const episodicCombos = DiscoveryEngine.generateKeywordCombinations({
    title: 'Mirzapur',
    seasonEpisodeInfo: 'Season 1 Episode 1 (S01E01)',
    assetType: 'EPISODIC',
    customVariations: DiscoveryEngine.STANDARD_KEYWORD_VARIATIONS
  });
  assert(episodicCombos.some(c => c.includes('S01E01') || c.includes('SEASON') || c.includes('WEB-DL')), 'Generates S01E01 / SEASON / WEB-DL combinations for episodic TV reference');

  // 9.3: URL Normalization preserves distinct video parameters while stripping tracking
  const normVid1 = DiscoveryEngine.normalizeUrl('https://www.youtube.com/watch?v=ABC123xyz&utm_source=share&feature=youtu.be');
  const normVid2 = DiscoveryEngine.normalizeUrl('https://www.youtube.com/watch?v=DEF456uvw&utm_source=share');
  assert(normVid1.normalizedUrl !== normVid2.normalizedUrl, 'URL normalization never merges distinct video assets (?v=ABC123xyz vs ?v=DEF456uvw)');
  assert(!normVid1.normalizedUrl.includes('utm_source'), 'URL normalization strips tracking parameters');

  // 9.4: Provenance-preserving deduplication in db.upsertCandidate
  const dedupCandId = `cand_dedup_${Date.now()}`;
  const dedupUrl = `https://archive.org/details/test_dedup_${Date.now()}`;
  const firstInsert = db.upsertCandidate({
    id: dedupCandId,
    source_url: dedupUrl,
    original_url: `${dedupUrl}?utm_source=seed1`,
    final_url: dedupUrl,
    final_domain: 'archive.org',
    referring_page: 'https://kickasstorrents.io/',
    matched_keywords: 'Test Movie 1080p',
    crawl_status: 'DISCOVERED',
    duplicate_count: 1,
    candidate_classification: 'VIDEO_ASSET',
    domain: 'archive.org',
    discovered_title: 'Test Dedup Video',
    discovery_provider: 'SUSPECTED_PIRACY',
    discovered_at: new Date().toISOString(),
    pipeline_status: 'DISCOVERED',
    reachability_code: 200,
    reachability_latency_ms: 50,
    media_type: 'MP4',
    is_live_stream: false
  });
  const secondInsert = db.upsertCandidate({
    id: `${dedupCandId}_dup`,
    source_url: dedupUrl,
    original_url: `${dedupUrl}?utm_source=seed2`,
    final_url: dedupUrl,
    final_domain: 'archive.org',
    referring_page: 'https://unblockit.li/',
    matched_keywords: 'Test Movie WEB-DL',
    crawl_status: 'ACCESSIBLE',
    duplicate_count: 1,
    candidate_classification: 'VIDEO_ASSET',
    domain: 'archive.org',
    discovered_title: 'Test Dedup Video',
    discovery_provider: 'SUSPECTED_PIRACY',
    discovered_at: new Date().toISOString(),
    pipeline_status: 'DISCOVERED',
    reachability_code: 200,
    reachability_latency_ms: 45,
    media_type: 'MP4',
    is_live_stream: false
  });
  const storedDedup = db.getCandidateById(dedupCandId);
  assert(firstInsert === true && secondInsert === false, 'Upserting duplicate normalized URL returns false on second insert while preserving existing candidate ID');
  assert((storedDedup?.duplicate_count ?? 0) === 2, `Increments duplicate_count on collision (Got: ${storedDedup?.duplicate_count})`);
  assert(
    Boolean(storedDedup?.matched_keywords?.includes('Test Movie 1080p') && storedDedup?.matched_keywords?.includes('Test Movie WEB-DL')),
    `Merges matched_keywords across duplicate discoveries (${storedDedup?.matched_keywords})`
  );
  assert(
    Boolean(storedDedup?.referring_page?.includes('kickasstorrents.io') && storedDedup?.referring_page?.includes('unblockit.li')),
    `Merges referring_page provenance across duplicate discoveries (${storedDedup?.referring_page})`
  );

  // 9.5: Candidate Classification & Torrent Payload Compliance Guard
  assert(SuspectedPiracyAdapter.classifyDiscoveredUrl('https://cdn.example.com/live/match.m3u8', 'Live Stream').candidateClassification === 'VIDEO_ASSET', 'Classifies .m3u8 stream as VIDEO_ASSET');
  assert(SuspectedPiracyAdapter.classifyDiscoveredUrl('https://news.example.com/article/2026/10/match-preview', 'Match Preview Report').candidateClassification === 'ARTICLE', 'Classifies news article URL without video as ARTICLE');
  assert(SuspectedPiracyAdapter.classifyDiscoveredUrl('https://cdn.example.com/poster/thumb.jpg', 'Poster Image').candidateClassification === 'IMAGE', 'Classifies image URL as IMAGE');
  assert(SuspectedPiracyAdapter.classifyDiscoveredUrl('https://kickasstorrents.io/search/cricket', 'Search Results').candidateClassification === 'GENERAL_WEBPAGE', 'Classifies index/directory page without playable media as GENERAL_WEBPAGE');

  const seedPiracyAdapter = new SuspectedPiracyAdapter();
  const torrentGuardRes = await seedPiracyAdapter.acquireAndProbe('https://example.com/files/sample_movie.torrent');
  assert(
    torrentGuardRes.crawlStatus === 'TORRENT_PAYLOAD_SKIPPED' && torrentGuardRes.accessible === false,
    'Compliance guard refuses to automatically download .torrent payload or execute untrusted binaries'
  );

  // -------------------------------------------------------------
  // Test Group 10: URL-Based Reference Media Ingestion, SSRF Protection & Webpage vs. Media Inspection
  // -------------------------------------------------------------
  console.log('\n[Test Group 10] URL-Based Reference Media Ingestion, SSRF Protection & Webpage vs. Media Inspection');

  // 10.1: SSRF Protection & URL Validation
  const ssrfLoopback = await FingerprintEngine.validateSafePublicUrl('http://127.0.0.1:8080/internal-video.mp4');
  assert(!ssrfLoopback.safe, 'SSRF Guard blocks loopback IP 127.0.0.1');

  const ssrfMetadata = await FingerprintEngine.validateSafePublicUrl('http://169.254.169.254/latest/meta-data/');
  assert(!ssrfMetadata.safe, 'SSRF Guard blocks cloud metadata IP 169.254.169.254');

  const ssrfPrivateNet = await FingerprintEngine.validateSafePublicUrl('http://10.0.0.42/secret.mp4');
  assert(!ssrfPrivateNet.safe, 'SSRF Guard blocks RFC1918 private network 10.0.0.0/8');

  const ssrfLocalhost = await FingerprintEngine.validateSafePublicUrl('http://localhost:3000/api/references');
  assert(!ssrfLocalhost.safe, 'SSRF Guard blocks localhost hostname');

  const ssrfBadProtocol = await FingerprintEngine.validateSafePublicUrl('file:///etc/passwd');
  assert(!ssrfBadProtocol.safe, 'SSRF Guard rejects non-HTTP/HTTPS file:// protocol');

  const ssrfEmbeddedCreds = await FingerprintEngine.validateSafePublicUrl('https://admin:secret@example.com/video.mp4');
  assert(!ssrfEmbeddedCreds.safe, 'SSRF Guard rejects URLs with embedded credentials');

  const torrentInspect = await FingerprintEngine.inspectReferenceUrlAvailability('https://example.com/releases/film.torrent');
  assert(
    torrentInspect.urlClassification === 'TORRENT_OR_UNSUPPORTED' && !torrentInspect.canAcquireAuthorized,
    'Rejects .torrent payload URLs during reference URL inspection'
  );

  const drmWebpageInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
    'https://www.netflix.com/watch/80192098'
  );
  assert(
    drmWebpageInspect.urlClassification === 'DRM_PROTECTED_WEBPAGE' &&
      drmWebpageInspect.isWebpage === true &&
      drmWebpageInspect.directMediaAvailable === false &&
      drmWebpageInspect.canAcquireAuthorized === false,
    'Distinguishes DRM-protected OTT webpage from direct media and refuses to bypass DRM'
  );

  // 10.2: Spin up an isolated local HTTP fixture server to test webpage vs. media URL inspection,
  // redirect SSRF blocking, paywalls/403, unsupported formats, corrupted containers, size/duration limits,
  // and full authorized media acquisition + FFmpeg frame extraction + 64-bit dHash generation.
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const candidateVideoPaths = [
    path.resolve(process.cwd(), 'data', 'media', 'apex_horizon_master.mp4'),
    path.resolve(process.cwd(), 'data', 'media', 'taylor_swift_soap2day_mirror.mp4')
  ];
  const validMasterVideoPath =
    candidateVideoPaths.find(p => fs.existsSync(p) && fs.statSync(p).size > 10000) || candidateVideoPaths[0];

  let testServerOrigin = '';
  const fixtureServer = http.createServer((req, res) => {
    const reqUrl = req.url || '/';

    if (reqUrl === '/webpage-with-video') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
        <html>
          <head>
            <title>Official Press Screener - India vs New Zealand 1st T20I</title>
            <meta property="og:title" content="Official Press Screener - India vs New Zealand 1st T20I" />
            <meta property="og:site_name" content="SonyLIV Rights Portal" />
            <meta property="og:video" content="${testServerOrigin}/media/authorized_master.mp4" />
          </head>
          <body>
            <video src="${testServerOrigin}/media/authorized_master.mp4"></video>
          </body>
        </html>`);
      return;
    }

    if (reqUrl === '/webpage-embedded-iframe') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
        <html>
          <head>
            <title>Official Match Highlights - Embedded Broadcast Player</title>
            <meta property="og:title" content="Official Match Highlights - Embedded Broadcast Player" />
            <meta property="og:site_name" content="Sports Rights Portal" />
            <meta property="og:video" content="https://www.youtube.com/embed/RJFGcXQLDYg" />
            <meta name="twitter:player" content="https://www.youtube.com/embed/RJFGcXQLDYg" />
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "VideoObject",
                "name": "India vs New Zealand 1st T20I Highlights",
                "duration": "PT12M30S",
                "thumbnailUrl": "https://example.com/thumb.jpg",
                "uploadDate": "2026-10-22T18:00:00Z",
                "embedUrl": "https://www.youtube.com/embed/RJFGcXQLDYg"
              }
            </script>
          </head>
          <body>
            <h1>Match Highlights</h1>
            <iframe width="640" height="360" src="https://www.youtube.com/embed/RJFGcXQLDYg" allow="autoplay; encrypted-media" allowfullscreen></iframe>
            <video controls poster="https://example.com/poster.jpg"></video>
          </body>
        </html>`);
      return;
    }

    if (reqUrl === '/webpage-jsonld-direct-video') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
        <html>
          <head>
            <title>Syndicated Rights Feed - JSON-LD VideoObject</title>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "VideoObject",
                "name": "Syndicated Master Feed",
                "duration": "PT2M00S",
                "contentUrl": "${testServerOrigin}/media/authorized_master.mp4",
                "embedUrl": "https://player.vimeo.com/video/123456789"
              }
            </script>
          </head>
          <body>
            <h1>Syndicated Feed Portal</h1>
          </body>
        </html>`);
      return;
    }

    if (reqUrl === '/webpage-restricted-video-source') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
        <html>
          <head>
            <title>Subscriber Only Stream - Restricted Video Asset</title>
          </head>
          <body>
            <video controls poster="${testServerOrigin}/poster.jpg">
              <source src="${testServerOrigin}/paywalled-page" type="video/mp4" />
            </video>
            <script src="https://cdn.jsdelivr.net/npm/video.js@8/dist/video.min.js"></script>
          </body>
        </html>`);
      return;
    }

    if (reqUrl === '/webpage-undetermined-player') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
        <html>
          <head><title>Dynamic Match Center</title></head>
          <body>
            <div id="live-mount" data-video-id="match_2026_nz_ind"></div>
          </body>
        </html>`);
      return;
    }

    if (reqUrl === '/webpage-no-video') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
        <html>
          <head><title>Match Preview Article - No Video</title></head>
          <body><h1>Editorial Preview</h1><p>Text article only without any video asset.</p></body>
        </html>`);
      return;
    }

    if (reqUrl === '/paywalled-page') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>Subscription or Login Required</body></html>');
      return;
    }

    if (reqUrl === '/antibot-page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Just a moment...</title></head><body><div class="cf-turnstile"></div></body></html>');
      return;
    }

    if (reqUrl === '/redirect-to-ssrf') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }

    if (reqUrl === '/unsupported.pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end('%PDF-1.5 fake pdf payload');
      return;
    }

    if (reqUrl === '/corrupted.mp4') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': '512'
      });
      res.end(Buffer.alloc(512, 0x41));
      return;
    }

    if (reqUrl === '/embed-player-frame') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Authorized Broadcast Embed Player</title></head><body><video id="embed-video" class="video-js" controls><source src="${testServerOrigin}/media/authorized_master.mp4" type="video/mp4" /></video><script src="https://vjs.zencdn.net/8.0.0/video.min.js"></script></body></html>`);
      return;
    }

    if (reqUrl === '/webpage-with-accessible-embedded-player') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Rights Syndication Portal — Embedded Match Player</title><meta property="og:title" content="Rights Syndication Portal — Embedded Match Player" /><meta property="og:site_name" content="Sports Syndication Hub" /></head><body><h1>Authorized Match Feed</h1><iframe width="800" height="450" src="${testServerOrigin}/embed-player-frame" allowfullscreen></iframe></body></html>`);
      return;
    }

    if (reqUrl === '/webpage-with-inline-js-player') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Studio Screener Portal — Inline JW Player</title><script src="https://ssl.p.jwpcdn.com/player/v/8.26.0/jwplayer.js"></script></head><body><div id="player-container"></div><script>jwplayer("player-container").setup({ file: "${testServerOrigin}/media/authorized_master.mp4", width: "100%" });</script></body></html>`);
      return;
    }

    if (reqUrl === '/embed-player-drm-blocked') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Encrypted DRM Embed</title></head><body><script>navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{}]);</script></body></html>`);
      return;
    }

    if (reqUrl === '/webpage-with-drm-embedded-player') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Protected Partner Screening Room</title></head><body><iframe width="800" height="450" src="${testServerOrigin}/embed-player-drm-blocked" allowfullscreen></iframe></body></html>`);
      return;
    }

    if (reqUrl === '/media/authorized_master.mp4') {
      const stat = fs.statSync(validMasterVideoPath);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(stat.size)
      });
      fs.createReadStream(validMasterVideoPath).pipe(res);
      return;
    }

    // Mock o2tvseries4u-structured catalog, pagination, episode page, and download routes
    if (reqUrl === '/o2tv' || reqUrl === '/o2tv/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Index of Tv Series | O2TvSeries4u.Com</title></head><body>
        <div class="alphabet">
          <a href="${testServerOrigin}/o2tv/m">M</a>
          <a href="${testServerOrigin}/o2tv/search/list_all_tv_series">List All Tv Series</a>
          <a href="${testServerOrigin}/o2tv/pages/about-us">About Us</a>
          <a href="https://hdmp4mania2.com/promo">HDMp4Mania Promo</a>
        </div>
        <div class="recent">
          <a href="${testServerOrigin}/o2tv/Another-Show-99/Season-01/Episode-01/index.html">Another Show - Season 01 - Episode 01</a>
        </div>
      </body></html>`);
      return;
    }

    if (reqUrl === '/o2tv/m' || reqUrl === '/o2tv/search/list_all_tv_series') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Tv Series Starting With M | O2TvSeries4u.Com</title></head><body>
        <div class="data_list">
          <div class="data"><a href="${testServerOrigin}/o2tv/Modern-Family-8-otv79xy4/index.html">Modern Family</a></div>
          <div class="data"><a href="${testServerOrigin}/o2tv/Unrelated-Show-1/index.html">Unrelated Show</a></div>
          <div class="data"><a href="${testServerOrigin}/o2tv/pages/disclaimer">Disclaimer</a></div>
        </div>
      </body></html>`);
      return;
    }

    if (reqUrl === '/o2tv/Modern-Family-8-otv79xy4/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Download Modern Family Tv Series | O2TvSeries4u.Com</title></head><body>
        <div class="data_list">
          <div class="data"><a href="${testServerOrigin}/o2tv/Modern-Family-8-otv79xy4/Season-01/index.html">Season 01</a></div>
          <div class="data"><a href="${testServerOrigin}/o2tv/Modern-Family-8-otv79xy4/Season-02/index.html">Season 02</a></div>
        </div>
      </body></html>`);
      return;
    }

    if (reqUrl === '/o2tv/Modern-Family-8-otv79xy4/Season-01/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Download Modern Family - Season 01 | O2TvSeries4u.Com</title></head><body>
        <div class="sort">
          <a href="${testServerOrigin}/o2tv/Modern-Family-8-otv79xy4/Season-01/page1.html?sort=old">Oldest First</a>
        </div>
        <div class="data_list">
          <div class="data"><a href="${testServerOrigin}/o2tv/Modern-Family-8-otv79xy4/Season-01/Episode-24/index.html">Episode 24</a></div>
        </div>
      </body></html>`);
      return;
    }

    if (reqUrl?.startsWith('/o2tv/Modern-Family-8-otv79xy4/Season-01/page1.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Download Modern Family - Season 01 (Oldest) | O2TvSeries4u.Com</title></head><body>
        <div class="data_list">
          <div class="data"><a href="${testServerOrigin}/o2tv/Modern-Family-8-otv79xy4/Season-01/Episode-01/index.html">Episode 01</a></div>
        </div>
      </body></html>`);
      return;
    }

    if (reqUrl === '/o2tv/Modern-Family-8-otv79xy4/Season-01/Episode-01/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Download Modern Family - Season 01 - Episode 01 | O2TvSeries4u.Com</title></head><body>
        <h1>Modern Family - Season 01 - Episode 01 (Pilot)</h1>
        <div class="data_list">
          <div class="data"><a href="${testServerOrigin}/media/authorized_master.mp4">Click to Download Episode 01 in Mp4 Format</a></div>
          <div class="data"><a href="${testServerOrigin}/o2tv/download/41950">Click to Download Episode 01 in 3gp Format</a></div>
          <div class="data"><a href="https://hdmp4mania2.com/external-ad">Download Movies From HDMp4Mania</a></div>
        </div>
      </body></html>`);
      return;
    }

    if (reqUrl === '/o2tv/download/41950') {
      res.writeHead(302, { Location: `${testServerOrigin}/o2tv/areyouhuman.php?fid=41950` });
      res.end();
      return;
    }

    if (reqUrl?.startsWith('/o2tv/areyouhuman.php')) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Attention Required! | Cloudflare</title></head><body>Please complete the security check to access o2tvseries4u.com</body></html>');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  fixtureServer.keepAliveTimeout = 60000;
  fixtureServer.headersTimeout = 65000;
  await new Promise<void>(resolve => fixtureServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = fixtureServer.address() as { port: number };
  testServerOrigin = `http://127.0.0.1:${addr.port}`;
  process.env.SPECTRA_TEST_ALLOWED_ORIGIN = testServerOrigin;

  try {
    // 10.3: Webpage without video vs. Webpage with direct media vs. Direct Media URL
    const noVideoPage = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/webpage-no-video`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      noVideoPage.isWebpage === true &&
        noVideoPage.directMediaAvailable === false &&
        noVideoPage.urlClassification === 'WEBPAGE_NO_DIRECT_MEDIA' &&
        noVideoPage.inspectionStatus === 'ORDINARY_WEBPAGE_NO_MEDIA' &&
        noVideoPage.embeddedPlayerDetected === false &&
        noVideoPage.canAcquireAuthorized === false,
      'Distinguishes HTML webpage without video from a media URL or embedded player page'
    );

    const withVideoPage = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/webpage-with-video`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      withVideoPage.isWebpage === true &&
        withVideoPage.directMediaAvailable === true &&
        withVideoPage.urlClassification === 'WEBPAGE_WITH_DIRECT_MEDIA' &&
        withVideoPage.inspectionStatus === 'WEBPAGE_DIRECT_MEDIA_ACCESSIBLE' &&
        withVideoPage.resolvedMediaUrl === `${testServerOrigin}/media/authorized_master.mp4` &&
        withVideoPage.canAcquireAuthorized === true,
      'Inspects accessible HTML page metadata (og:video / <video>) and resolves direct video asset URL'
    );

    const directMediaInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/media/authorized_master.mp4`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      directMediaInspect.isWebpage === false &&
        directMediaInspect.directMediaAvailable === true &&
        directMediaInspect.urlClassification === 'DIRECT_MEDIA_URL' &&
        directMediaInspect.inspectionStatus === 'DIRECT_MEDIA_ACCESSIBLE' &&
        directMediaInspect.canAcquireAuthorized === true,
      'Identifies direct .mp4 URL as DIRECT_MEDIA_URL'
    );

    // 10.3b: Embedded Player Detection (iframe, <video>, og:video, twitter:player, JSON-LD VideoObject)
    console.log('\n--- Test Group 11: Embedded Video Player Detection on Webpages ---');
    const embeddedIframeInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/webpage-embedded-iframe`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      embeddedIframeInspect.isWebpage === true &&
        embeddedIframeInspect.urlClassification === 'WEBPAGE_WITH_EMBEDDED_PLAYER' &&
        embeddedIframeInspect.inspectionStatus === 'EMBEDDED_PLAYER_DETECTED_NO_DIRECT_MEDIA' &&
        embeddedIframeInspect.embeddedPlayerDetected === true &&
        embeddedIframeInspect.detectedPlayerProvider === 'YouTube Embedded Player' &&
        embeddedIframeInspect.directMediaAvailable === false &&
        embeddedIframeInspect.canAcquireAuthorized === false &&
        !embeddedIframeInspect.resolvedMediaUrl,
      'Classifies webpage with iframe/og:video/JSON-LD embed as WEBPAGE_WITH_EMBEDDED_PLAYER and never fabricates a downloadable media URL'
    );
    assert(
      Boolean(
        embeddedIframeInspect.accessibleMediaMetadata &&
          embeddedIframeInspect.accessibleMediaMetadata.iframeSrcs.length === 1 &&
          embeddedIframeInspect.accessibleMediaMetadata.iframeSrcs.includes('https://www.youtube.com/embed/RJFGcXQLDYg') &&
          embeddedIframeInspect.accessibleMediaMetadata.htmlVideoElementCount === 1 &&
          embeddedIframeInspect.accessibleMediaMetadata.openGraphVideoUrls.includes('https://www.youtube.com/embed/RJFGcXQLDYg') &&
          embeddedIframeInspect.accessibleMediaMetadata.twitterPlayerUrls.includes('https://www.youtube.com/embed/RJFGcXQLDYg') &&
          embeddedIframeInspect.accessibleMediaMetadata.jsonLdVideos.length === 1 &&
          embeddedIframeInspect.accessibleMediaMetadata.jsonLdVideos[0].name === 'India vs New Zealand 1st T20I Highlights' &&
          embeddedIframeInspect.accessibleMediaMetadata.jsonLdVideos[0].duration === 'PT12M30S'
      ),
      'Records accessible embedded-player metadata (iframe, HTML <video>, Open Graph video, Twitter player, and JSON-LD VideoObject)'
    );
    assert(
      Array.isArray(embeddedIframeInspect.diagnosticErrors) && embeddedIframeInspect.diagnosticErrors.length > 0,
      'Records diagnostic reason when an embedded player is detected without an accessible direct video stream'
    );

    // JSON-LD VideoObject with direct contentUrl + embedUrl
    const jsonLdDirectInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/webpage-jsonld-direct-video`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      jsonLdDirectInspect.urlClassification === 'WEBPAGE_WITH_DIRECT_MEDIA' &&
        jsonLdDirectInspect.inspectionStatus === 'WEBPAGE_DIRECT_MEDIA_ACCESSIBLE' &&
        jsonLdDirectInspect.directMediaAvailable === true &&
        jsonLdDirectInspect.resolvedMediaUrl === `${testServerOrigin}/media/authorized_master.mp4` &&
        jsonLdDirectInspect.embeddedPlayerDetected === true,
      'Extracts and validates direct contentUrl from JSON-LD VideoObject metadata while also recording embedded player metadata'
    );

    // Webpage with <video><source> pointing to restricted (HTTP 403) stream + Video.js SDK
    const restrictedSourceInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/webpage-restricted-video-source`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      restrictedSourceInspect.urlClassification === 'RESTRICTED_OR_PAYWALLED' &&
        restrictedSourceInspect.inspectionStatus === 'RESTRICTED_MEDIA' &&
        restrictedSourceInspect.embeddedPlayerDetected === true &&
        restrictedSourceInspect.directMediaAvailable === false &&
        restrictedSourceInspect.canAcquireAuthorized === false &&
        Boolean(restrictedSourceInspect.accessibleMediaMetadata?.detectedPlayerSdks.includes('Video.js')) &&
        Boolean(restrictedSourceInspect.diagnosticErrors?.some(e => e.includes('403'))),
      'Distinguishes restricted embedded <video><source> (HTTP 403) and records Video.js SDK + diagnostic error'
    );

    // Webpage where media availability cannot be determined (dynamic JS player container without static source)
    const undeterminedInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/webpage-undetermined-player`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      undeterminedInspect.urlClassification === 'MEDIA_AVAILABILITY_UNKNOWN' &&
        undeterminedInspect.inspectionStatus === 'MEDIA_AVAILABILITY_UNDETERMINED' &&
        undeterminedInspect.directMediaAvailable === false &&
        undeterminedInspect.canAcquireAuthorized === false,
      'Distinguishes pages where media availability cannot be statically determined (MEDIA_AVAILABILITY_UNKNOWN)'
    );

    // 10.4: Paywall (HTTP 403), Anti-Bot challenge, Redirect to SSRF target, and Unsupported format
    const paywallInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/paywalled-page`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      paywallInspect.urlClassification === 'RESTRICTED_OR_PAYWALLED' && !paywallInspect.canAcquireAuthorized,
      'Detects HTTP 403 paywall/access restriction and refuses to bypass it'
    );

    const antibotInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/antibot-page`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      antibotInspect.urlClassification === 'RESTRICTED_OR_PAYWALLED' &&
        antibotInspect.acquisitionStatus === 'ANTI_BOT_PROTECTION_DETECTED' &&
        !antibotInspect.canAcquireAuthorized,
      'Detects anti-bot challenge in HTML and refuses to bypass it'
    );

    const redirectSsrfInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/redirect-to-ssrf`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      redirectSsrfInspect.urlClassification === 'SSRF_REJECTED' &&
        redirectSsrfInspect.acquisitionStatus === 'SSRF_REDIRECT_BLOCKED',
      'Validates redirect hops and blocks redirect to private/metadata SSRF IP'
    );

    const pdfInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/unsupported.pdf`,
      { allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      pdfInspect.urlClassification === 'TORRENT_OR_UNSUPPORTED' &&
        pdfInspect.acquisitionStatus === 'UNSUPPORTED_MEDIA_FORMAT',
      'Rejects unsupported non-video MIME type (application/pdf)'
    );

    // 10.5: Enforce file-size limit, duration limit, and FFprobe container validation
    const sizeLimitInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
      `${testServerOrigin}/media/authorized_master.mp4`,
      { maxBytes: 1024, allowLocalhostTestOrigin: testServerOrigin }
    );
    assert(
      sizeLimitInspect.acquisitionStatus === 'FILE_SIZE_LIMIT_EXCEEDED' && !sizeLimitInspect.canAcquireAuthorized,
      'Enforces file-size limit during URL inspection and acquisition'
    );

    let corruptedRejected = false;
    try {
      await FingerprintEngine.acquireAuthorizedReferenceMediaFromUrl(
        `${testServerOrigin}/corrupted.mp4`,
        { allowLocalhostTestOrigin: testServerOrigin }
      );
    } catch (err: any) {
      corruptedRejected = err?.code === 'INVALID_MEDIA_CONTAINER';
    }
    assert(corruptedRejected, 'FFprobe validation rejects corrupted / non-video binary payload before fingerprinting');

    let durationLimitRejected = false;
    try {
      await FingerprintEngine.acquireAuthorizedReferenceMediaFromUrl(
        `${testServerOrigin}/media/authorized_master.mp4`,
        { maxDurationSec: 0.5, allowLocalhostTestOrigin: testServerOrigin }
      );
    } catch (err: any) {
      durationLimitRejected = err?.code === 'MEDIA_DURATION_LIMIT_EXCEEDED';
    }
    assert(durationLimitRejected, 'Enforces maximum video duration limit before frame extraction');

    // 10.6: Full E2E test of /api/references/:id/attach-media route:
    // - Failed acquisition preserves existing reference record and NEVER marks as FINGERPRINTED
    // - Successful authorized webpage/media acquisition stores video, extracts real frames via FFmpeg,
    //   computes 64-bit dHash fingerprints, records audit fields, and transitions status to FINGERPRINTED.
    const express = (await import('express')).default;
    const apiRouter = (await import('../routes.js')).default;
    const apiApp = express();
    apiApp.use(express.json());
    apiApp.use('/api', apiRouter);
    const apiServer = http.createServer(apiApp);
    apiServer.keepAliveTimeout = 60000;
    apiServer.headersTimeout = 65000;
    await new Promise<void>(resolve => apiServer.listen(0, '127.0.0.1', () => resolve()));
    const apiPort = (apiServer.address() as { port: number }).port;
    const apiBase = `http://127.0.0.1:${apiPort}/api`;

    try {
      const testRefId = `ref_url_ingest_test_${Date.now()}`;
      db.upsertReference({
        id: testRefId,
        title: 'India Tour of New Zealand 2026 - 1st T20I (OTT Record)',
        rights_holder: 'Sony Pictures Networks India',
        asset_type: 'LIVE_SPORTS',
        duration_sec: 0,
        resolution: 'OTT Catalog',
        fps: 0,
        codec: 'OTT_METADATA_ONLY',
        source_type: 'OTT_PAGE',
        source_url: 'https://www.sonyliv.com/live-sport/india-tour-of-new-zealand-2026-1790007839',
        platform: 'SonyLIV',
        season_episode_info: '1st T20I • 22 Oct 2026',
        created_at: new Date().toISOString(),
        status: 'AWAITING_AUTHORIZED_MEDIA',
        provenance_sha256: 'ott_meta_initial_hash',
        fingerprint_count: 0,
        notes: 'Initial OTT metadata registration'
      });

      // Attempt failed attach-media (webpage with no video) -> must preserve record & status = AWAITING_AUTHORIZED_MEDIA
      const failedAttachRes = await fetch(`${apiBase}/references/${testRefId}/attach-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceWebpageUrl: `${testServerOrigin}/webpage-no-video`,
          authorizationConfirmed: true,
          authorizationProvenance: 'RIGHTS_HOLDER_DIRECT_AUTHORIZATION'
        })
      });
      const failedAttachJson: any = await failedAttachRes.json();
      const afterFailedRef = db.getReferenceById(testRefId);
      assert(
        failedAttachRes.status === 422 &&
          afterFailedRef?.status === 'AWAITING_AUTHORIZED_MEDIA' &&
          (afterFailedRef?.fingerprint_count ?? 0) === 0 &&
          afterFailedRef?.acquisition_status === 'NO_DIRECT_MEDIA_ON_WEBPAGE' &&
          Boolean(afterFailedRef?.acquisition_error),
        'Failed URL media acquisition preserves existing reference record, records error details, and never marks as FINGERPRINTED'
      );
      assert(
        afterFailedRef?.source_url === 'https://www.sonyliv.com/live-sport/india-tour-of-new-zealand-2026-1790007839',
        'Preserves original OTT source_url when URL media acquisition fails'
      );

      // Inspect embedded player webpage on reference via /api/references/:id/inspect-url and attempt attach-media
      const inspectEmbeddedRes = await fetch(`${apiBase}/references/${testRefId}/inspect-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${testServerOrigin}/webpage-embedded-iframe` })
      });
      const inspectEmbeddedJson: any = await inspectEmbeddedRes.json();
      const afterEmbeddedInspectRef = db.getReferenceById(testRefId);
      assert(
        inspectEmbeddedRes.status === 200 &&
          inspectEmbeddedJson.data?.urlClassification === 'WEBPAGE_WITH_EMBEDDED_PLAYER' &&
          afterEmbeddedInspectRef?.status === 'AWAITING_AUTHORIZED_MEDIA' &&
          afterEmbeddedInspectRef?.detected_player_provider === 'YouTube Embedded Player' &&
          afterEmbeddedInspectRef?.inspection_status === 'EMBEDDED_PLAYER_DETECTED_NO_DIRECT_MEDIA' &&
          Boolean(afterEmbeddedInspectRef?.embedded_player_metadata_json),
        'Persists detected_player_provider, inspection_status, and embedded_player_metadata_json on reference without marking as FINGERPRINTED'
      );

      const attachEmbeddedRes = await fetch(`${apiBase}/references/${testRefId}/attach-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceWebpageUrl: `${testServerOrigin}/webpage-embedded-iframe`,
          authorizationConfirmed: true,
          authorizationProvenance: 'RIGHTS_HOLDER_DIRECT_AUTHORIZATION'
        })
      });
      const afterEmbeddedAttachRef = db.getReferenceById(testRefId);
      assert(
        attachEmbeddedRes.status === 422 &&
          afterEmbeddedAttachRef?.status === 'AWAITING_AUTHORIZED_MEDIA' &&
          (afterEmbeddedAttachRef?.fingerprint_count ?? 0) === 0 &&
          afterEmbeddedAttachRef?.acquisition_status === 'EMBEDDED_PLAYER_ONLY_NO_DIRECT_MEDIA',
        'Refuses to mark embedded-player-only webpage as acquired or FINGERPRINTED and preserves reference record'
      );

      // Now attach authorized webpage that exposes a valid direct video asset
      const successAttachRes = await fetch(`${apiBase}/references/${testRefId}/attach-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceWebpageUrl: `${testServerOrigin}/webpage-with-video`,
          authorizationConfirmed: true,
          authorizationProvenance: 'RIGHTS_HOLDER_DIRECT_AUTHORIZATION',
          sampleInterval: 2
        })
      });
      const successAttachJson: any = await successAttachRes.json();
      const afterSuccessRef = db.getReferenceById(testRefId);
      const extractedRefFps = db.getReferenceFingerprints(testRefId);

      assert(
        successAttachRes.status === 200 &&
          successAttachJson.success === true &&
          afterSuccessRef?.status === 'FINGERPRINTED' &&
          extractedRefFps.length > 0 &&
          afterSuccessRef?.fingerprint_count === extractedRefFps.length,
        `Authorized webpage media acquisition extracts real FFmpeg frames (${extractedRefFps.length} frames) and transitions status to FINGERPRINTED`
      );
      assert(
        afterSuccessRef?.source_url === 'https://www.sonyliv.com/live-sport/india-tour-of-new-zealand-2026-1790007839' &&
          afterSuccessRef?.final_url === `${testServerOrigin}/webpage-with-video` &&
          afterSuccessRef?.media_url === `${testServerOrigin}/media/authorized_master.mp4` &&
          afterSuccessRef?.acquisition_status === 'AUTHORIZED_MEDIA_ACQUIRED' &&
          afterSuccessRef?.authorization_provenance === 'RIGHTS_HOLDER_DIRECT_AUTHORIZATION' &&
          Boolean(afterSuccessRef?.last_acquisition_at) &&
          !afterSuccessRef?.acquisition_error,
        'Preserves source_url, final_url, media_url, acquisition_status, authorization_provenance, and timestamp for audit trail'
      );

      // -------------------------------------------------------------
      // Test Group 12: Reference Registration Persistence Across DB Re-Initialisation & Restarts
      // -------------------------------------------------------------
      console.log('\n--- Test Group 12: Reference Registration Persistence & Re-Initialisation Regression ---');

      const regRes = await fetch(`${apiBase}/references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Persistence Regression Test — India vs New Zealand 2nd T20I',
          rightsHolder: 'Sony Pictures Networks India',
          assetType: 'LIVE_SPORTS',
          platform: 'SonyLIV',
          seasonEpisodeInfo: '2nd T20I • 25 Oct 2026',
          sourceUrl: 'https://www.sonyliv.com/live-sport/india-tour-of-new-zealand-2026-2nd-t20i'
        })
      });
      const regJson: any = await regRes.json();
      const persistedRefId: string = regJson.data?.id;
      assert(
        regRes.status === 201 && Boolean(persistedRefId),
        `Registered reference via POST /api/references (id=${persistedRefId})`
      );

      // Attach authorized media so fingerprints and thumbnails are also persisted
      const attachPersistRes = await fetch(`${apiBase}/references/${persistedRefId}/attach-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceWebpageUrl: `${testServerOrigin}/webpage-with-video`,
          authorizationConfirmed: true,
          authorizationProvenance: 'RIGHTS_HOLDER_DIRECT_AUTHORIZATION',
          sampleInterval: 2
        })
      });
      const attachPersistJson: any = await attachPersistRes.json();
      const preRestartFpsCount: number = attachPersistJson.data?.fingerprint_count ?? 0;
      const preRestartSha: string = attachPersistJson.data?.provenance_sha256 ?? '';
      assert(
        attachPersistRes.status === 200 && preRestartFpsCount > 0,
        `Persisted ${preRestartFpsCount} fingerprints for reference ${persistedRefId}`
      );

      // Simulate thumbnail deletion on disk + server startup routines + fresh DB connection re-initialisation
      const preFps = db.getReferenceFingerprints(persistedRefId);
      const firstThumbRoute = preFps[0]?.thumbnail_url;
      if (firstThumbRoute && firstThumbRoute.startsWith('/thumbnails/')) {
        const diskThumbPath = path.join(db.getThumbnailsDir(), path.basename(firstThumbRoute));
        if (fs.existsSync(diskThumbPath)) {
          fs.unlinkSync(diskThumbPath);
        }
      }

      // Run startup/fixture routines that previously wiped user references
      ensureMasterVideosExist();
      loadOptionalForensicTestSuite();

      // Re-initialise a brand-new ArgusDatabase instance against the same SQLite file (simulating backend restart)
      const reinitialisedDb = new ArgusDatabase(db.getDbFilePath());
      try {
        const fromReinitById = reinitialisedDb.getReferenceById(persistedRefId);
        const fromReinitList = reinitialisedDb.getReferences().find(r => r.id === persistedRefId);
        const fromReinitFps = reinitialisedDb.getReferenceFingerprints(persistedRefId);

        assert(
          Boolean(fromReinitById) && Boolean(fromReinitList) && fromReinitById?.id === persistedRefId,
          'Same reference ID remains available after database re-initialisation and startup routines'
        );
        assert(
          fromReinitById?.title === 'Persistence Regression Test — India vs New Zealand 2nd T20I' &&
            fromReinitById?.rights_holder === 'Sony Pictures Networks India' &&
            fromReinitById?.platform === 'SonyLIV' &&
            fromReinitById?.season_episode_info === '2nd T20I • 25 Oct 2026' &&
            fromReinitById?.source_url === 'https://www.sonyliv.com/live-sport/india-tour-of-new-zealand-2026-2nd-t20i' &&
            fromReinitById?.final_url === `${testServerOrigin}/webpage-with-video` &&
            fromReinitById?.media_url === `${testServerOrigin}/media/authorized_master.mp4` &&
            fromReinitById?.acquisition_status === 'AUTHORIZED_MEDIA_ACQUIRED' &&
            fromReinitById?.authorization_provenance === 'RIGHTS_HOLDER_DIRECT_AUTHORIZATION' &&
            fromReinitById?.status === 'FINGERPRINTED' &&
            fromReinitById?.provenance_sha256 === preRestartSha &&
            fromReinitById?.fingerprint_count === preRestartFpsCount &&
            fromReinitFps.length === preRestartFpsCount,
          'Preserves all reference metadata, URLs, acquisition provenance, status, and fingerprint records across re-initialisation'
        );

        // Verify self-healed thumbnail on disk
        if (firstThumbRoute && firstThumbRoute.startsWith('/thumbnails/')) {
          const healedThumbPath = path.join(db.getThumbnailsDir(), path.basename(firstThumbRoute));
          assert(
            fs.existsSync(healedThumbPath),
            'Self-heals missing thumbnail file on disk from SQLite base64 thumbnail_data without invalidating reference'
          );
        }

        // Verify HTTP GET /api/references and GET /api/references/:id return the persisted record
        const listApiRes = await fetch(`${apiBase}/references`);
        const listApiJson: any = await listApiRes.json();
        const detailApiRes = await fetch(`${apiBase}/references/${persistedRefId}`);
        const detailApiJson: any = await detailApiRes.json();
        assert(
          listApiRes.status === 200 &&
            Array.isArray(listApiJson.data) &&
            listApiJson.data.some((r: any) => r.id === persistedRefId) &&
            detailApiRes.status === 200 &&
            detailApiJson.data?.id === persistedRefId &&
            Array.isArray(detailApiJson.data?.fingerprints) &&
            detailApiJson.data.fingerprints.length === preRestartFpsCount,
          'GET /api/references and GET /api/references/:id return the persisted reference and its fingerprints after restart'
        );
      } finally {
        reinitialisedDb.close();
      }

      // Clean up test references and downloaded test files
      const persistedRefObj = db.getReferenceById(persistedRefId);
      if (persistedRefObj?.file_path && persistedRefObj.file_path.includes('url_ref_') && fs.existsSync(persistedRefObj.file_path)) {
        try { fs.unlinkSync(persistedRefObj.file_path); } catch {}
      }
      db.deleteReference(persistedRefId);

      // -------------------------------------------------------------
      // Test Group 13: Embedded-Player Reference Video Ingestion, Frame Extraction, Persistence & Blocker Reporting
      // -------------------------------------------------------------
      console.log('\n--- Test Group 13: Embedded-Player Reference Video Ingestion & Frame Extraction ---');

      // 13.1: Inspect webpage that embeds an iframe video player exposing an accessible video stream
      const embedWithMediaInspect = await FingerprintEngine.inspectReferenceUrlAvailability(
        `${testServerOrigin}/webpage-with-accessible-embedded-player`,
        { allowLocalhostTestOrigin: testServerOrigin }
      );
      assert(
        embedWithMediaInspect.isWebpage === true &&
          embedWithMediaInspect.embeddedPlayerDetected === true &&
          embedWithMediaInspect.directMediaAvailable === true &&
          embedWithMediaInspect.canAcquireAuthorized === true &&
          embedWithMediaInspect.resolvedMediaUrl === `${testServerOrigin}/media/authorized_master.mp4`,
        'Resolves accessible video stream from inside an embedded <iframe> player page and marks canAcquireAuthorized=true'
      );

      // 13.2: Register reference directly from embedded-player webpage URL -> acquires video, validates via FFprobe, extracts real frames via FFmpeg, persists JPEG frames & dHashes, and sets status=FINGERPRINTED
      const embedRegRes = await fetch(`${apiBase}/references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Embedded Player Ingestion Test — 1st T20I Syndicated Feed',
          rightsHolder: 'Sony Pictures Networks India',
          assetType: 'LIVE_SPORTS',
          platform: 'Sports Syndication Hub',
          seasonEpisodeInfo: '1st T20I • 22 Oct 2026',
          sourceUrl: `${testServerOrigin}/webpage-with-accessible-embedded-player`,
          sampleInterval: 2
        })
      });
      const embedRegJson: any = await embedRegRes.json();
      const embedRefId: string = embedRegJson.data?.id;
      const embedRefFps = db.getReferenceFingerprints(embedRefId);
      assert(
        embedRegRes.status === 201 &&
          embedRegJson.success === true &&
          embedRegJson.data?.status === 'FINGERPRINTED' &&
          embedRefFps.length > 0 &&
          embedRegJson.data?.fingerprint_count === embedRefFps.length &&
          embedRegJson.data?.media_url === `${testServerOrigin}/media/authorized_master.mp4` &&
          embedRegJson.data?.acquisition_status === 'AUTHORIZED_MEDIA_ACQUIRED',
        `Direct registration of embedded-player webpage acquires video, extracts ${embedRefFps.length} real FFmpeg frames, and transitions to FINGERPRINTED`
      );

      // Verify persisted frame images on disk, timestamps, and 64-bit dHash format
      const firstEmbedFp = embedRefFps[0];
      const firstEmbedThumbDisk = firstEmbedFp?.thumbnail_url
        ? path.join(db.getThumbnailsDir(), path.basename(firstEmbedFp.thumbnail_url))
        : '';
      const firstEmbedJpegBuf = firstEmbedThumbDisk && fs.existsSync(firstEmbedThumbDisk)
        ? fs.readFileSync(firstEmbedThumbDisk)
        : Buffer.alloc(0);
      assert(
        Boolean(
          firstEmbedFp &&
            typeof firstEmbedFp.timestamp_sec === 'number' &&
            /^[0-9a-f]{16}$/i.test(firstEmbedFp.phash_hex) &&
            typeof firstEmbedFp.avg_luminance === 'number' &&
            firstEmbedJpegBuf.length > 500 &&
            firstEmbedJpegBuf[0] === 0xff &&
            firstEmbedJpegBuf[1] === 0xd8
        ),
        'Persists actual JPEG frame file on disk (valid 0xFFD8 SOI header), base64 thumbnail_data, timestamp_sec, and 64-bit dHash in SQLite'
      );

      // Verify Reference Inspector endpoint (GET /api/references/:id) returns the extracted frames
      const inspectorRes = await fetch(`${apiBase}/references/${embedRefId}`);
      const inspectorJson: any = await inspectorRes.json();
      assert(
        inspectorRes.status === 200 &&
          inspectorJson.data?.status === 'FINGERPRINTED' &&
          Array.isArray(inspectorJson.data?.fingerprints) &&
          inspectorJson.data.fingerprints.length === embedRefFps.length &&
          inspectorJson.data.fingerprints[0]?.thumbnail_url === firstEmbedFp.thumbnail_url,
        'Reference Inspector endpoint (GET /api/references/:id) returns all persisted reference frames, timestamps, and dHashes'
      );

      // 13.3: Register reference from webpage with inline JS player configuration (JW Player setup({ file: ... }))
      const inlineJsRegRes = await fetch(`${apiBase}/references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Inline JS Player Ingestion Test — Studio Screener',
          rightsHolder: 'Studio Rights Corp',
          assetType: 'VOD_FEATURE',
          sourceUrl: `${testServerOrigin}/webpage-with-inline-js-player`,
          sampleInterval: 2
        })
      });
      const inlineJsRegJson: any = await inlineJsRegRes.json();
      const inlineJsRefId: string = inlineJsRegJson.data?.id;
      assert(
        inlineJsRegRes.status === 201 &&
          inlineJsRegJson.data?.status === 'FINGERPRINTED' &&
          (inlineJsRegJson.data?.fingerprint_count ?? 0) > 0 &&
          inlineJsRegJson.data?.media_url === `${testServerOrigin}/media/authorized_master.mp4`,
        'Extracts direct media URL from inline JS player configuration, validates video, and extracts FFmpeg frames'
      );

      // 13.4: Webpage with DRM-blocked embedded player reports precise blocker and NEVER marks as FINGERPRINTED
      const drmEmbedRegRes = await fetch(`${apiBase}/references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'DRM Blocked Embedded Player Test',
          rightsHolder: 'Studio Rights Corp',
          assetType: 'VOD_FEATURE',
          sourceUrl: `${testServerOrigin}/webpage-with-drm-embedded-player`,
          sampleInterval: 2
        })
      });
      const drmEmbedRegJson: any = await drmEmbedRegRes.json();
      const drmEmbedRefId: string = drmEmbedRegJson.data?.id;
      assert(
        drmEmbedRegRes.status === 201 &&
          drmEmbedRegJson.data?.status === 'AWAITING_AUTHORIZED_MEDIA' &&
          (drmEmbedRegJson.data?.fingerprint_count ?? 0) === 0 &&
          Boolean(drmEmbedRegJson.data?.acquisition_error) &&
          Boolean(drmEmbedRegJson.inspection?.diagnosticErrors?.some((e: string) => e.toLowerCase().includes('drm'))),
        'Reports precise DRM blocker when embedded player uses Widevine/EME and never marks reference as FINGERPRINTED'
      );

      // -------------------------------------------------------------
      // Test Group 14: Regression Tests — Failed URL Acquisition Persistence,
      // Duplicate Registration Handling, Fingerprinted Protection & Test Isolation
      // -------------------------------------------------------------
      console.log('\n[Test Group 14] Failed URL Acquisition Persistence, Duplicate Handling & Test Isolation');

      // 14.1: Failed URL media acquisition on a direct/non-webpage URL without initialStatus must STILL persist a metadata-only reference (AWAITING_AUTHORIZED_MEDIA) and never discard the registration
      const failedUrlRegRes = await fetch(`${apiBase}/references/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Episodic Reference Regression Test S01E01',
          rightsHolder: '20th Television / Disney',
          assetType: 'EPISODIC',
          platform: 'Syndicated Web Portal',
          seasonEpisodeInfo: 'S01E01 • Pilot',
          sourceUrl: `${testServerOrigin}/media/unavailable_direct_stream.mp4`,
          sampleInterval: 2,
          auditNotes: 'Initial URL registration when media asset is temporarily unavailable'
        })
      });
      const failedUrlRegJson: any = await failedUrlRegRes.json();
      const failedUrlRefId: string = failedUrlRegJson.data?.id;
      const persistedFailedRef = failedUrlRefId ? db.getReferenceById(failedUrlRefId) : undefined;
      assert(
        failedUrlRegRes.status === 201 &&
          failedUrlRegJson.success === true &&
          Boolean(failedUrlRefId) &&
          persistedFailedRef?.status === 'AWAITING_AUTHORIZED_MEDIA' &&
          persistedFailedRef?.title === 'Episodic Reference Regression Test S01E01' &&
          persistedFailedRef?.season_episode_info === 'S01E01 • Pilot' &&
          persistedFailedRef?.source_url === `${testServerOrigin}/media/unavailable_direct_stream.mp4` &&
          persistedFailedRef?.fingerprint_count === 0 &&
          Boolean(persistedFailedRef?.acquisition_status) &&
          Boolean(persistedFailedRef?.acquisition_error),
        'Failed direct URL media acquisition persists reference metadata, source_url, and diagnostic error as AWAITING_AUTHORIZED_MEDIA (never returns 422 or discards record)'
      );

      // 14.2: Duplicate registration with the same title, rightsHolder, seasonEpisodeInfo, and sourceUrl reuses the existing reference ID instead of creating a duplicate
      const refCountBeforeDup = db.getReferences().length;
      const dupRegRes = await fetch(`${apiBase}/references/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Episodic Reference Regression Test S01E01',
          rightsHolder: '20th Television / Disney',
          assetType: 'EPISODIC',
          platform: 'Syndicated Web Portal',
          seasonEpisodeInfo: 'S01E01 • Pilot',
          sourceUrl: `${testServerOrigin}/media/unavailable_direct_stream.mp4/`,
          sampleInterval: 2
        })
      });
      const dupRegJson: any = await dupRegRes.json();
      const refCountAfterDup = db.getReferences().length;
      assert(
        dupRegRes.status === 201 &&
          dupRegJson.data?.id === failedUrlRefId &&
          dupRegJson.duplicateUpdated === true &&
          refCountAfterDup === refCountBeforeDup,
        'Duplicate registration reuses existing reference ID and prevents duplicate rows in reference_items'
      );

      // 14.3: Subsequent registration for the same reference with an accessible authorized media URL upgrades the existing reference ID in-place to FINGERPRINTED
      const upgradeRegRes = await fetch(`${apiBase}/references/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Episodic Reference Regression Test S01E01',
          rightsHolder: '20th Television / Disney',
          assetType: 'EPISODIC',
          platform: 'Syndicated Web Portal',
          seasonEpisodeInfo: 'S01E01 • Pilot',
          sourceUrl: `${testServerOrigin}/media/unavailable_direct_stream.mp4`,
          authorizedMasterUrl: `${testServerOrigin}/media/authorized_master.mp4`,
          sampleInterval: 2
        })
      });
      const upgradeRegJson: any = await upgradeRegRes.json();
      const upgradedFps = db.getReferenceFingerprints(failedUrlRefId);
      assert(
        upgradeRegRes.status === 201 &&
          upgradeRegJson.data?.id === failedUrlRefId &&
          upgradeRegJson.data?.status === 'FINGERPRINTED' &&
          upgradedFps.length > 0 &&
          upgradeRegJson.data?.fingerprint_count === upgradedFps.length,
        'Supplying valid media upgrades the existing reference ID in-place to FINGERPRINTED with real extracted frames'
      );

      // 14.4: Submitting a failed URL or metadata-only registration for an already-FINGERPRINTED reference NEVER overwrites or clears its fingerprints
      const protectRegRes = await fetch(`${apiBase}/references/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Episodic Reference Regression Test S01E01',
          rightsHolder: '20th Television / Disney',
          assetType: 'EPISODIC',
          seasonEpisodeInfo: 'S01E01 • Pilot',
          sourceUrl: `${testServerOrigin}/media/unavailable_direct_stream.mp4`,
          sampleInterval: 2
        })
      });
      const protectRegJson: any = await protectRegRes.json();
      const protectedRefAfter = db.getReferenceById(failedUrlRefId);
      const protectedFpsAfter = db.getReferenceFingerprints(failedUrlRefId);
      assert(
        protectRegRes.status === 201 &&
          protectRegJson.duplicatePreserved === true &&
          protectedRefAfter?.status === 'FINGERPRINTED' &&
          protectedRefAfter?.fingerprint_count === upgradedFps.length &&
          protectedFpsAfter.length === upgradedFps.length,
        'Never overwrites or downgrades an existing FINGERPRINTED reference when a subsequent duplicate or failing URL registration is submitted'
      );

      // Clean up Group 13 & Group 14 test references and downloaded files
      for (const cleanupId of [embedRefId, inlineJsRefId, drmEmbedRefId, failedUrlRefId]) {
        if (!cleanupId) continue;
        const refObj = db.getReferenceById(cleanupId);
        if (refObj?.file_path && refObj.file_path.includes('url_ref_') && fs.existsSync(refObj.file_path)) {
          try { fs.unlinkSync(refObj.file_path); } catch {}
        }
        db.deleteReference(cleanupId);
      }

      if (afterSuccessRef?.file_path && afterSuccessRef.file_path.includes('url_ref_') && fs.existsSync(afterSuccessRef.file_path)) {
        try { fs.unlinkSync(afterSuccessRef.file_path); } catch {}
      }
      db.deleteReference(testRefId);

      // -------------------------------------------------------------
      // Test Group 15: Persistent o2tvseries4u.com Discovery Source,
      // Unified Multi-Source Provenance, Multi-Asset Separation &
      // End-to-End Frame Verification
      // -------------------------------------------------------------
      console.log('\n[Test Group 15] Persistent o2tvseries4u.com Discovery Source & Unified Multi-Source Provenance');

      // 15.1: Verify https://o2tvseries4u.com/ is registered and enabled in the persistent discovery_sources registry
      const sourcesRes = await fetch(`${apiBase}/discovery/sources`);
      const sourcesJson: any = await sourcesRes.json();
      const sourcesList: any[] = Array.isArray(sourcesJson.data) ? sourcesJson.data : [];
      const o2DefaultSource = sourcesList.find(
        (s: any) => s.id === 'src_o2tvseries4u' || s.url === 'https://o2tvseries4u.com/'
      );
      assert(
        sourcesRes.status === 200 &&
          Boolean(o2DefaultSource) &&
          o2DefaultSource.url === 'https://o2tvseries4u.com/' &&
          Boolean(o2DefaultSource.enabled) &&
          o2DefaultSource.source_type === 'configured_website',
        'Registers https://o2tvseries4u.com/ in persistent discovery_sources registry as an enabled configured_website source by default'
      );

      // 15.2: Register a Reference Master for "Modern Family S01E01" with real extracted visual fingerprints
      const o2RefId = `ref_o2tv_modern_family_${Date.now()}`;
      const o2Extracted = await FingerprintEngine.extractVideoFingerprints(validMasterVideoPath, {
        intervalSec: 1,
        maxFrames: 10,
        generateThumbnails: true,
        title: 'Modern Family S01E01',
        isCandidate: false
      });
      const o2RefFps: FrameFingerprint[] = o2Extracted.map((f, idx) => ({
        id: `rfp_${o2RefId}_${idx}`,
        reference_id: o2RefId,
        timestamp_sec: f.timestamp_sec,
        frame_index: f.frame_index,
        phash_hex: f.phash_hex,
        avg_luminance: f.avg_luminance,
        thumbnail_data: f.thumbnail_data,
        thumbnail_path: f.thumbnail_path,
        thumbnail_url: f.thumbnail_url,
        created_at: new Date().toISOString()
      }));
      db.upsertReference({
        id: o2RefId,
        title: 'Modern Family S01E01',
        rights_holder: '20th Television',
        asset_type: 'EPISODIC',
        duration_sec: 6,
        resolution: '1920x1080',
        fps: 24,
        codec: 'H.264',
        file_path: validMasterVideoPath,
        source_type: 'UPLOAD',
        created_at: new Date().toISOString(),
        status: 'FINGERPRINTED',
        provenance_sha256: 'o2tv_ref_sha256',
        fingerprint_count: o2RefFps.length
      });
      db.insertReferenceFingerprints(o2RefFps);

      // Point src_o2tvseries4u temporarily at the local o2tvseries4u-structured fixture server for deterministic end-to-end testing
      db.upsertDiscoverySource({
        id: 'src_o2tvseries4u',
        name: 'O2TvSeries4u TV Series Index',
        url: `${testServerOrigin}/o2tv/`,
        source_type: 'configured_website',
        enabled: true
      });

      const o2FixtureAdapter = new O2TvSeriesAdapter();
      const o2CrawlCandidates = await o2FixtureAdapter.discover('Modern Family S01E01', {
        referenceTitle: 'Modern Family S01E01',
        targetReferenceId: o2RefId,
        baseUrlOverride: `${testServerOrigin}/o2tv/`
      });
      const o2CrawlTelemetry = o2FixtureAdapter.getLastTelemetry();

      const expectedEpisodePageUrl = `${testServerOrigin}/o2tv/Modern-Family-8-otv79xy4/Season-01/Episode-01/index.html`;
      const expectedMp4MediaUrl = `${testServerOrigin}/media/authorized_master.mp4`;
      const expectedGateMediaUrl = `${testServerOrigin}/o2tv/download/41950`;

      const mp4CandidateFromAdapter = o2CrawlCandidates.find(
        c => c.url === expectedEpisodePageUrl && c.mediaUrl === expectedMp4MediaUrl
      );
      const gateCandidateFromAdapter = o2CrawlCandidates.find(
        c => c.url === expectedEpisodePageUrl && c.mediaUrl === expectedGateMediaUrl
      );
      const noiseCandidateFromAdapter = o2CrawlCandidates.find(
        c => c.url.includes('about-us') || c.url.includes('disclaimer') || c.url.includes('hdmp4mania2.com') || (c.mediaUrl && c.mediaUrl.includes('hdmp4mania2.com'))
      );

      assert(
        Boolean(o2CrawlTelemetry && o2CrawlTelemetry.pagesInspected >= 5) &&
          Boolean(mp4CandidateFromAdapter) &&
          Boolean(gateCandidateFromAdapter) &&
          !noiseCandidateFromAdapter,
        `O2TvSeriesAdapter traverses homepage, alphabetical index (/m), series page, season page, and pagination (page1.html?sort=old) to Episode-01 (${o2CrawlTelemetry?.pagesInspected || 0} pages), extracting distinct media assets while excluding nav/ad noise`
      );

      // 15.3: Pre-seed an existing candidate from title_search for the same MP4 asset on Episode-01
      // with indexed frame hashes so unified discovery merges configured_website + frame_search + title_search
      // without discarding the candidate, while keeping the second video asset (/o2tv/download/41950) separate!
      const preExistingCandId = `cand_preexisting_title_${Date.now()}`;
      db.upsertCandidateWithResult({
        id: preExistingCandId,
        reference_id: o2RefId,
        matched_content_id: o2RefId,
        source_url: expectedEpisodePageUrl,
        media_url: expectedMp4MediaUrl,
        domain: '127.0.0.1',
        discovery_provider: 'SUSPECTED_PIRACY',
        source_type: 'title_search',
        match_method: 'title_match',
        discovered_title: 'Modern Family S01E01 (Pre-existing Title Match)',
        discovered_at: new Date().toISOString(),
        pipeline_status: 'DISCOVERED',
        crawl_status: 'DISCOVERED',
        reachability_code: 200,
        reachability_latency_ms: 10,
        media_type: 'MP4',
        is_live_stream: false
      });
      db.insertCandidateFingerprints(
        o2RefFps.slice(0, 3).map((fp, idx) => ({
          id: `cfp_pre_${preExistingCandId}_${idx}`,
          candidate_id: preExistingCandId,
          timestamp_sec: fp.timestamp_sec,
          frame_index: fp.frame_index,
          phash_hex: fp.phash_hex,
          avg_luminance: fp.avg_luminance,
          created_at: new Date().toISOString()
        }))
      );

      // Execute unified discovery sweep (combines frame_search, configured_website o2tvseries4u, and title_search)
      await DiscoveryEngine.executeDiscoverySweep({
        jobName: 'Unified Test Sweep (Modern Family S01E01)',
        provider: 'SUSPECTED_PIRACY',
        targetReferenceId: o2RefId,
        queryKeywords: 'Modern Family S01E01',
        maxCandidates: 15,
        autoVerify: true,
        o2tvBaseUrlOverride: `${testServerOrigin}/o2tv/`
      });

      const allRefCandidates = db.getCandidates({ referenceId: o2RefId });
      const episodePageCandidates = allRefCandidates.filter(c => c.source_url === expectedEpisodePageUrl);
      const mergedMp4Cand = episodePageCandidates.find(c => c.media_url === expectedMp4MediaUrl);
      const separateGateCand = episodePageCandidates.find(c => c.media_url === expectedGateMediaUrl);

      assert(
        episodePageCandidates.length >= 2 &&
          Boolean(mergedMp4Cand) &&
          Boolean(separateGateCand) &&
          mergedMp4Cand!.id !== separateGateCand!.id,
        'Keeps distinct video assets (authorized_master.mp4 vs /o2tv/download/41950) separate even when both originate from the same Episode-01 webpage'
      );

      // 15.4: Verify intelligent deduplication & merged provenance across title_search, configured_website, and frame_search
      const mergedProvenance = mergedMp4Cand?.discovery_provenance;
      assert(
        Boolean(mergedMp4Cand) &&
          mergedMp4Cand!.matched_content_id === o2RefId &&
          mergedMp4Cand!.source_url === expectedEpisodePageUrl &&
          mergedMp4Cand!.media_url === expectedMp4MediaUrl &&
          Boolean(mergedMp4Cand!.discovered_at) &&
          Boolean(mergedProvenance) &&
          mergedProvenance!.source_types.includes('title_search') &&
          mergedProvenance!.source_types.includes('configured_website') &&
          mergedProvenance!.source_types.includes('frame_search') &&
          mergedProvenance!.match_methods.includes('title_match') &&
          mergedProvenance!.match_methods.includes('frame_match') &&
          mergedProvenance!.source_urls.includes(expectedEpisodePageUrl),
        'Merges duplicate discoveries across configured_website, frame_search, and title_search while preserving all source_types, source_urls, and match_methods'
      );

      // 15.5: Verify end-to-end FFmpeg frame extraction & 64-bit dHash perceptual matching on accessible MP4 candidate,
      // and accurate ACCESS_RESTRICTED status on anti-bot /download/41950 candidate
      assert(
        mergedMp4Cand!.pipeline_status === 'ANALYZED' &&
          mergedMp4Cand!.acquisition_status === 'VERIFIED_PERCEPTUAL_MATCH' &&
          mergedMp4Cand!.overall_assessment === 'MATCH_FOUND' &&
          Boolean(mergedMp4Cand!.captured_frames && mergedMp4Cand!.captured_frames.length > 0) &&
          (mergedMp4Cand!.visual_similarity_score ?? 0) > 0.7 &&
          Boolean(mergedMp4Cand!.match_method && mergedMp4Cand!.match_method.includes('frame_match')),
        `Extracts real frames via FFmpeg and confirms visual dHash match on accessible MP4 asset from o2tvseries4u (${mergedMp4Cand?.captured_frames?.length || 0} frames, similarity ${((mergedMp4Cand?.visual_similarity_score || 0) * 100).toFixed(1)}%)`
      );

      assert(
        separateGateCand!.pipeline_status === 'BLOCKED' &&
          separateGateCand!.crawl_status === 'ACCESS_RESTRICTED' &&
          Boolean(
            separateGateCand!.verification_logs && separateGateCand!.verification_logs.includes('areyouhuman.php')
          ),
        'Preserves anti-bot gated download link (/o2tv/download/41950 -> areyouhuman.php HTTP 403) as a candidate with accurate diagnostic reason without fabricating frames'
      );

      // 15.6: Verify source-specific telemetry persisted in discovery_sources and returned by API
      const updatedSourcesRes = await fetch(`${apiBase}/discovery/sources`);
      const updatedSourcesJson: any = await updatedSourcesRes.json();
      const updatedSourcesList: any[] = Array.isArray(updatedSourcesJson.data) ? updatedSourcesJson.data : [];
      const updatedO2Source = updatedSourcesList.find((s: any) => s.id === 'src_o2tvseries4u');
      assert(
        Boolean(updatedO2Source) &&
          updatedO2Source.last_scan_status === 'COMPLETED' &&
          updatedO2Source.pages_inspected >= 5 &&
          updatedO2Source.candidates_discovered >= 2 &&
          updatedO2Source.direct_media_found >= 2 &&
          updatedO2Source.duplicates_merged >= 1 &&
          updatedO2Source.acquisitions_succeeded >= 1 &&
          updatedO2Source.acquisitions_restricted >= 1 &&
          updatedO2Source.frames_extracted > 0 &&
          updatedO2Source.fingerprinted_count >= 1,
        'Persists source-specific scan telemetry (pages inspected, candidates found, direct media, duplicates merged, acquisitions succeeded/restricted, frames extracted, fingerprinted count)'
      );

      // 15.7: Restore canonical https://o2tvseries4u.com/ URL and verify live website inspection for Modern Family S01E01
      db.upsertDiscoverySource({
        id: 'src_o2tvseries4u',
        name: 'O2TvSeries4u TV Series Index',
        url: 'https://o2tvseries4u.com/',
        source_type: 'configured_website',
        enabled: true
      });

      const liveO2Adapter = new O2TvSeriesAdapter();
      const liveO2Candidates = await liveO2Adapter.discover('Modern Family S01E01', {
        referenceTitle: 'Modern Family S01E01',
        targetReferenceId: o2RefId,
        baseUrlOverride: 'https://o2tvseries4u.com/'
      });
      const liveO2Telemetry = liveO2Adapter.getLastTelemetry();
      if (liveO2Telemetry && liveO2Telemetry.pagesInspected > 0 && liveO2Candidates.length > 0) {
        const liveEp1Candidates = liveO2Candidates.filter(c =>
          c.url.includes('Modern-Family') && c.url.includes('Season-01/Episode-01')
        );
        assert(
          liveEp1Candidates.length >= 2 &&
            liveEp1Candidates.some(c => c.mediaUrl?.includes('/download/41950')) &&
            liveEp1Candidates.some(c => c.mediaUrl?.includes('/download/41949')),
          `Live https://o2tvseries4u.com/ crawl discovers Modern Family Season-01/Episode-01 and its distinct download media links (${liveEp1Candidates.map(c => c.mediaUrl).join(', ')})`
        );
      } else {
        assert(
          Boolean(liveO2Telemetry && (liveO2Telemetry.failureReasons.length > 0 || liveO2Telemetry.scanOutcome)),
          'Live https://o2tvseries4u.com/ crawl records explicit diagnostic telemetry when network access is unavailable'
        );
      }

      db.deleteReference(o2RefId);

      // -------------------------------------------------------------
      // Test Group 16: Strict Separation Between Synthetic Demo Data
      // (FORENSIC_SAMPLE) and User-Registered References
      // -------------------------------------------------------------
      console.log('\n[Test Group 16] Strict Separation of Synthetic FORENSIC_SAMPLE Data & Permanent User Reference Persistence');

      // 16.1 & 16.8: Seed synthetic demo records AND a genuine user-owned "Taylor Swift — Patient Zero" reference
      // (same title, distinct user-owned ID and /uploads/ provenance), then purge confirmed fake records.
      loadOptionalForensicTestSuite();
      const userTsRefId = `ref_user_ts_patient_zero_${Date.now()}`;
      const testUploadsDir16 = path.join(TEST_DB_DIR, 'uploads');
      fs.mkdirSync(testUploadsDir16, { recursive: true });
      const userTsUploadSimPath = path.join(testUploadsDir16, `sim_${userTsRefId}.mp4`);
      fs.copyFileSync(validMasterVideoPath, userTsUploadSimPath);
      const userTsFrames = await FingerprintEngine.extractVideoFingerprints(userTsUploadSimPath, {
        intervalSec: 1,
        durationSec: 5,
        generateThumbnails: true,
        title: 'Taylor Swift — Patient Zero',
        isCandidate: false,
        referenceId: userTsRefId,
        thumbnailsDir: db.getThumbnailsDir()
      });
      const userTsFps: FrameFingerprint[] = userTsFrames.map((f, idx) => ({
        id: `rfp_${userTsRefId}_${idx}`,
        reference_id: userTsRefId,
        timestamp_sec: f.timestamp_sec,
        frame_index: f.frame_index,
        phash_hex: f.phash_hex,
        vhash_hex: f.vhash_hex,
        crop_phash_hex: f.crop_phash_hex,
        avg_luminance: f.avg_luminance,
        thumbnail_data: f.thumbnail_data,
        thumbnail_path: f.thumbnail_path,
        thumbnail_url: f.thumbnail_url,
        created_at: new Date().toISOString()
      }));
      db.persistAndVerifyReferenceExtraction({
        reference: {
          id: userTsRefId,
          title: 'Taylor Swift — Patient Zero',
          rights_holder: 'Universal Music Group / Taylor Swift Productions',
          asset_type: 'VOD_FEATURE',
          duration_sec: 5,
          resolution: '1920x1080',
          fps: 24,
          codec: 'h264',
          source_type: 'UPLOAD',
          file_path: userTsUploadSimPath,
          thumbnail_url: userTsFps[0]?.thumbnail_url,
          first_thumbnail: userTsFps[0]?.thumbnail_url,
          created_at: new Date().toISOString(),
          status: 'FINGERPRINTED',
          provenance_sha256: 'user_ts_sha256_authentic',
          fingerprint_count: userTsFps.length,
          sample_interval_sec: 1,
          expected_frame_count: 6,
          extracted_frame_count: userTsFps.length,
          notes: 'User-registered genuine master for Taylor Swift — Patient Zero'
        },
        fingerprints: userTsFps,
        expectedFrameCount: 6,
        sampleIntervalSec: 1,
        durationSec: 5,
        replaceExistingFingerprints: true
      });

      // Verify both synthetic demo records and user record exist prior to purge
      const refsBeforePurge = db.getReferences();
      const hasFakeUclBefore = refsBeforePurge.some(r => r.id === 'ref_sports_ucl_2026' && r.source_type === 'FORENSIC_SAMPLE');
      const hasFakeApexBefore = refsBeforePurge.some(r => r.id === 'ref_vod_apex_2026' && r.source_type === 'FORENSIC_SAMPLE');
      const hasFakeTsBefore = refsBeforePurge.some(r => r.id === 'ref_taylor_swift_patient_zero' && r.source_type === 'FORENSIC_SAMPLE');
      const hasUserTsBefore = refsBeforePurge.some(r => r.id === userTsRefId && r.source_type === 'UPLOAD');

      const purgeRes = await fetch(`${apiBase}/fixtures/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const purgeJson: any = await purgeRes.json();
      const refsAfterPurge = db.getReferences();

      assert(
        hasFakeUclBefore &&
          hasFakeApexBefore &&
          hasFakeTsBefore &&
          hasUserTsBefore &&
          purgeRes.status === 200 &&
          Array.isArray(purgeJson.removedReferences) &&
          purgeJson.removedReferences.length === 3 &&
          !refsAfterPurge.some(r => r.source_type === 'FORENSIC_SAMPLE') &&
          !refsAfterPurge.some(r => r.id === 'ref_sports_ucl_2026' || r.id === 'ref_vod_apex_2026' || r.id === 'ref_taylor_swift_patient_zero'),
        '16.1: Removes only confirmed synthetic FORENSIC_SAMPLE records (UEFA UCL, Apex Horizon, and synthetic Taylor Swift sample)'
      );

      const preservedUserTs = db.getReferenceById(userTsRefId);
      const preservedUserTsFps = db.getReferenceFingerprints(userTsRefId);
      assert(
        Boolean(preservedUserTs) &&
          preservedUserTs!.title === 'Taylor Swift — Patient Zero' &&
          preservedUserTs!.source_type === 'UPLOAD' &&
          preservedUserTs!.status === 'FINGERPRINTED' &&
          preservedUserTsFps.length === userTsFps.length,
        '16.8: Preserves the genuine user-owned "Taylor Swift — Patient Zero" reference (with all extracted frames and fingerprints) when a synthetic sample shares the same title'
      );

      // 16.2: Register a new user reference via API and verify it appears in the library
      const newUserRegRes = await fetch(`${apiBase}/references/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'User Registered Feature Reference 2026',
          rightsHolder: 'Independent Studio Rights LLC',
          assetType: 'VOD_FEATURE',
          sourceUrl: `${testServerOrigin}/media/authorized_master.mp4`,
          sampleInterval: 2
        })
      });
      const newUserRegJson: any = await newUserRegRes.json();
      const newUserRefId: string = newUserRegJson.data?.id;

      const listAfterRegRes = await fetch(`${apiBase}/references`);
      const listAfterRegJson: any = await listAfterRegRes.json();
      const listAfterReg: any[] = Array.isArray(listAfterRegJson.data) ? listAfterRegJson.data : [];

      assert(
        newUserRegRes.status === 201 &&
          Boolean(newUserRefId) &&
          newUserRegJson.data?.status === 'FINGERPRINTED' &&
          newUserRegJson.data?.source_type !== 'FORENSIC_SAMPLE' &&
          listAfterReg.some(r => r.id === newUserRefId),
        '16.2: Newly registered user reference is marked as user-owned and appears in the Reference Library'
      );

      // 16.3, 16.4, 16.5, 16.6: Simulate backend startup hooks, database re-initialization (initSchema), and UI refresh
      delete process.env.SPECTRA_LOAD_DEMO_FIXTURES;
      ensureMasterVideosExist();
      ensureTaylorSwiftPatientZeroRegistered();

      const reinitDbInstance = new ArgusDatabase(TEST_DB_PATH);
      const refsAfterReinit = reinitDbInstance.getReferences();
      reinitDbInstance.close();

      const refreshUiRes = await fetch(`${apiBase}/references`);
      const refreshUiJson: any = await refreshUiRes.json();
      const refreshedRefs: any[] = Array.isArray(refreshUiJson.data) ? refreshUiJson.data : [];

      assert(
        refsAfterReinit.some(r => r.id === newUserRefId && r.status === 'FINGERPRINTED') &&
          refsAfterReinit.some(r => r.id === userTsRefId && r.status === 'FINGERPRINTED'),
        '16.3 & 16.5: User references survive backend startup routines and database initialization (initSchema) with all metadata and fingerprints intact'
      );

      assert(
        refreshUiRes.status === 200 &&
          refreshedRefs.some(r => r.id === newUserRefId) &&
          refreshedRefs.some(r => r.id === userTsRefId),
        '16.4: User references remain present and intact across UI refresh calls (GET /api/references)'
      );

      assert(
        !refreshedRefs.some(r => r.source_type === 'FORENSIC_SAMPLE') &&
          !refreshedRefs.some(r => r.id === 'ref_sports_ucl_2026' || r.id === 'ref_vod_apex_2026' || r.id === 'ref_taylor_swift_patient_zero'),
        '16.6: Confirm no synthetic FORENSIC_SAMPLE demo records are automatically reinserted on startup, DB init, or refresh'
      );

      // 16.7: Confirm failed media validation (unreachable URL or invalid test-pattern source) does NOT delete user-created metadata
      const failedValidationRegRes = await fetch(`${apiBase}/references/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'User Reference With Unreachable Media',
          rightsHolder: 'Studio Rights Corp',
          assetType: 'EPISODIC',
          seasonEpisodeInfo: 'S02E05',
          sourceUrl: `${testServerOrigin}/media/nonexistent_stream_404.mp4`
        })
      });
      const failedValidationRegJson: any = await failedValidationRegRes.json();
      const failedValidationRefId: string = failedValidationRegJson.data?.id;
      const persistedFailedValidationRef = failedValidationRefId ? db.getReferenceById(failedValidationRefId) : undefined;

      assert(
        failedValidationRegRes.status === 201 &&
          Boolean(persistedFailedValidationRef) &&
          persistedFailedValidationRef!.title === 'User Reference With Unreachable Media' &&
          persistedFailedValidationRef!.rights_holder === 'Studio Rights Corp' &&
          persistedFailedValidationRef!.season_episode_info === 'S02E05' &&
          persistedFailedValidationRef!.status === 'AWAITING_AUTHORIZED_MEDIA' &&
          db.isUserOwnedReference(persistedFailedValidationRef!),
        '16.7: Failed media acquisition/validation preserves user-created reference metadata in the library with accurate status instead of deleting it'
      );

      // Clean up Group 16 test files and test records
      if (fs.existsSync(userTsUploadSimPath)) {
        try { fs.unlinkSync(userTsUploadSimPath); } catch {}
      }
      for (const idToClean of [userTsRefId, newUserRefId, failedValidationRefId]) {
        if (!idToClean) continue;
        const rObj = db.getReferenceById(idToClean);
        if (rObj?.file_path && rObj.file_path.includes('url_ref_') && fs.existsSync(rObj.file_path)) {
          try { fs.unlinkSync(rObj.file_path); } catch {}
        }
        db.deleteReference(idToClean);
      }

      // -------------------------------------------------------------
      // Test Group 17: Full-Video Frame Extraction (0s to End),
      // Sampling Rate Accuracy, Resumable Extraction, Completeness Guards &
      // All-to-All (R × C) Cross-Timestamp Visual Matching
      // -------------------------------------------------------------
      console.log('\n[Test Group 17] Full-Video Frame Extraction (0s–End), Resumability & All-to-All (R×C) Cross-Timestamp Matching');

      const { execFileSync } = await import('node:child_process');
      const tmpMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra_test17_media_'));

      // Build an 18.6-second multi-scene reference video with non-integer tail duration from real video content
      const ref18sPath = path.join(tmpMediaDir, 'ref_full_18_6s.mp4');
      execFileSync('ffmpeg', [
        '-y',
        '-t', '6.2', '-i', validMasterVideoPath,
        '-t', '6.2', '-i', validMasterVideoPath,
        '-t', '6.23', '-i', validMasterVideoPath,
        '-filter_complex',
        '[0:v]scale=320:180,drawbox=x=mod(t*45\\,220):y=16:w=76:h=54:color=white@0.92:t=fill,setsar=1[v0];' +
        '[1:v]scale=320:180,hflip,negate,drawbox=x=18:y=mod(t*35\\,110):w=84:h=56:color=black@0.92:t=fill,setsar=1[v1];' +
        '[2:v]scale=320:180,vflip,drawbox=x=mod(210-t*42\\,210):y=mod(110-t*28\\,110):w=92:h=62:color=white@0.92:t=fill,setsar=1[v2];' +
        '[v0][v1][v2]concat=n=3:v=1:a=0[outv]',
        '-map', '[outv]',
        '-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
        ref18sPath
      ], { stdio: 'ignore' });

      const probe18s = await FingerprintEngine.probeVideo(ref18sPath);

      // 17.1: Full-duration frame extraction from 0.00s to the final partial interval at the end of the video
      const plan2s = FingerprintEngine.calculateSamplingPlan(probe18s.duration_sec, 2);
      const frames2s = await FingerprintEngine.extractVideoFingerprints(ref18sPath, {
        intervalSec: 2,
        durationSec: probe18s.duration_sec,
        generateThumbnails: true,
        title: 'Test 17 Full Duration 18.6s'
      });
      const firstTs = frames2s[0]?.timestamp_sec ?? -1;
      const lastTs = frames2s[frames2s.length - 1]?.timestamp_sec ?? -1;
      assert(
        frames2s.length === plan2s.expectedFrameCount &&
          frames2s.length >= 10 &&
          firstTs === 0 &&
          lastTs >= probe18s.duration_sec - 0.5 &&
          frames2s.every(f => Boolean(f.phash_hex && f.vhash_hex && f.crop_phash_hex)),
        `17.1: Extracts frames across the ENTIRE video duration (0.00s to ${lastTs.toFixed(2)}s of ${probe18s.duration_sec.toFixed(2)}s, ${frames2s.length}/${plan2s.expectedFrameCount} frames including final partial interval)`
      );

      // 17.2: Sampling rate accuracy (1s, 2s, 5s, and custom 3.5s interval)
      const plan1s = FingerprintEngine.calculateSamplingPlan(probe18s.duration_sec, 1);
      const plan5s = FingerprintEngine.calculateSamplingPlan(probe18s.duration_sec, 5);
      const planCustom = FingerprintEngine.calculateSamplingPlan(probe18s.duration_sec, 3.5);
      const frames5s = await FingerprintEngine.extractVideoFingerprints(ref18sPath, {
        intervalSec: 5,
        durationSec: probe18s.duration_sec,
        generateThumbnails: false
      });
      const framesCustom = await FingerprintEngine.extractVideoFingerprints(ref18sPath, {
        intervalSec: 3.5,
        durationSec: probe18s.duration_sec,
        generateThumbnails: false
      });
      assert(
        plan1s.expectedFrameCount >= 19 &&
          frames5s.length === plan5s.expectedFrameCount &&
          framesCustom.length === planCustom.expectedFrameCount &&
          Math.abs(framesCustom[1].timestamp_sec - 3.5) < 0.05 &&
          framesCustom[framesCustom.length - 1].timestamp_sec >= probe18s.duration_sec - 0.5,
        `17.2: Sampling rate accuracy verified for 1s (${plan1s.expectedFrameCount}f), 2s (${frames2s.length}f), 5s (${frames5s.length}f), and custom 3.5s (${framesCustom.length}f)`
      );

      // Convert frames2s into Reference FrameFingerprint objects
      const ref17Id = `ref_test17_${Date.now()}`;
      const ref17Fps: FrameFingerprint[] = frames2s.map((f, idx) => ({
        id: `rfp_${ref17Id}_${idx}`,
        reference_id: ref17Id,
        timestamp_sec: f.timestamp_sec,
        frame_index: f.frame_index ?? idx,
        phash_hex: f.phash_hex,
        vhash_hex: f.vhash_hex,
        crop_phash_hex: f.crop_phash_hex,
        avg_luminance: f.avg_luminance,
        thumbnail_data: f.thumbnail_data,
        thumbnail_path: f.thumbnail_path,
        thumbnail_url: f.thumbnail_url,
        created_at: new Date().toISOString()
      }));

      // 17.3: Same clip at a shifted timestamp (e.g., reference 00:02–00:10 placed at 00:14–00:22 in candidate)
      const shiftedCandPath = path.join(tmpMediaDir, 'cand_shifted.mp4');
      execFileSync('ffmpeg', [
        '-y',
        '-stream_loop', '2', '-t', '14', '-i', ref18sPath,
        '-ss', '2', '-t', '8', '-i', ref18sPath,
        '-filter_complex', '[0:v]scale=320:180,hflip,vflip,negate,setsar=1[v0];[1:v]scale=320:180,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[outv]',
        '-map', '[outv]', '-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast',
        shiftedCandPath
      ], { stdio: 'ignore' });
      const shiftedProbe = await FingerprintEngine.probeVideo(shiftedCandPath);
      const shiftedCandFramesRaw = await FingerprintEngine.extractVideoFingerprints(shiftedCandPath, {
        intervalSec: 2,
        durationSec: shiftedProbe.duration_sec,
        generateThumbnails: false,
        isCandidate: true
      });
      const shiftedCandFps: FrameFingerprint[] = shiftedCandFramesRaw.map((f, idx) => ({
        id: `cfp_shifted_${idx}`,
        timestamp_sec: f.timestamp_sec,
        frame_index: idx,
        phash_hex: f.phash_hex,
        vhash_hex: f.vhash_hex,
        crop_phash_hex: f.crop_phash_hex,
        avg_luminance: f.avg_luminance,
        created_at: ''
      }));
      const shiftedMatch = FingerprintEngine.compareFingerprintSequences(shiftedCandFps, ref17Fps, {
        hammingThreshold: 16,
        referenceDurationSec: probe18s.duration_sec,
        candidateDurationSec: shiftedProbe.duration_sec
      });
      assert(
        shiftedMatch.matchStatus === 'POTENTIAL_MATCH' &&
          Math.abs(shiftedMatch.temporalOffsetSec - 12) <= 2.5 &&
          shiftedMatch.coverageMetrics.unique_reference_frames_matched >= 3 &&
          shiftedMatch.coverageMetrics.matched_segments.length >= 1,
        `17.3: Cross-timestamp all-to-all (R×C) matching detects reference clip (02s–10s) shifted to (14s–22s) in candidate (Δt=${shiftedMatch.temporalOffsetSec.toFixed(1)}s, matched=${shiftedMatch.matchedFramesCount})`
      );

      // 17.4: Partial clip from the middle of a longer reference video (06s–14s extracted from 18.6s reference)
      const middleClipPath = path.join(tmpMediaDir, 'cand_middle_clip.mp4');
      execFileSync('ffmpeg', [
        '-y', '-ss', '6', '-t', '8', '-i', ref18sPath,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
        middleClipPath
      ], { stdio: 'ignore' });
      const middleProbe = await FingerprintEngine.probeVideo(middleClipPath);
      const middleFramesRaw = await FingerprintEngine.extractVideoFingerprints(middleClipPath, {
        intervalSec: 2,
        durationSec: middleProbe.duration_sec,
        generateThumbnails: false,
        isCandidate: true
      });
      const middleCandFps: FrameFingerprint[] = middleFramesRaw.map((f, idx) => ({
        id: `cfp_mid_${idx}`,
        timestamp_sec: f.timestamp_sec,
        frame_index: idx,
        phash_hex: f.phash_hex,
        vhash_hex: f.vhash_hex,
        crop_phash_hex: f.crop_phash_hex,
        avg_luminance: f.avg_luminance,
        created_at: ''
      }));
      const middleMatch = FingerprintEngine.compareFingerprintSequences(middleCandFps, ref17Fps, {
        hammingThreshold: 16,
        referenceDurationSec: probe18s.duration_sec,
        candidateDurationSec: middleProbe.duration_sec
      });
      assert(
        middleMatch.matchStatus === 'POTENTIAL_MATCH' &&
          middleMatch.coverageMetrics.candidate_coverage_pct >= 75 &&
          middleMatch.coverageMetrics.reference_coverage_pct >= 25 &&
          middleMatch.coverageMetrics.reference_coverage_pct <= 70,
        `17.4: Partial middle excerpt (06s–14s) matches against longer reference with ${middleMatch.coverageMetrics.candidate_coverage_pct.toFixed(1)}% candidate coverage and ${middleMatch.coverageMetrics.reference_coverage_pct.toFixed(1)}% reference coverage`
      );

      // 17.5: Reordered or edited segments (Segment B [10s..16s] placed before Segment A [0s..6s])
      const reorderedCandPath = path.join(tmpMediaDir, 'cand_reordered.mp4');
      execFileSync('ffmpeg', [
        '-y',
        '-ss', '10', '-t', '6', '-i', ref18sPath,
        '-ss', '0', '-t', '6', '-i', ref18sPath,
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[outv]',
        '-map', '[outv]', '-c:v', 'libx264', '-preset', 'ultrafast',
        reorderedCandPath
      ], { stdio: 'ignore' });
      const reorderedProbe = await FingerprintEngine.probeVideo(reorderedCandPath);
      const reorderedFramesRaw = await FingerprintEngine.extractVideoFingerprints(reorderedCandPath, {
        intervalSec: 2,
        durationSec: reorderedProbe.duration_sec,
        generateThumbnails: false,
        isCandidate: true
      });
      const reorderedCandFps: FrameFingerprint[] = reorderedFramesRaw.map((f, idx) => ({
        id: `cfp_reord_${idx}`,
        timestamp_sec: f.timestamp_sec,
        frame_index: idx,
        phash_hex: f.phash_hex,
        vhash_hex: f.vhash_hex,
        crop_phash_hex: f.crop_phash_hex,
        avg_luminance: f.avg_luminance,
        created_at: ''
      }));
      const reorderedMatch = FingerprintEngine.compareFingerprintSequences(reorderedCandFps, ref17Fps, {
        hammingThreshold: 16,
        referenceDurationSec: probe18s.duration_sec,
        candidateDurationSec: reorderedProbe.duration_sec
      });
      assert(
        reorderedMatch.matchStatus === 'POTENTIAL_MATCH' &&
          reorderedMatch.coverageMetrics.matched_segments.length >= 2 &&
          reorderedMatch.coverageMetrics.unique_candidate_frames_matched >= 5,
        `17.5: Reordered segments ([10s..16s] followed by [0s..6s]) both detected across distinct temporal offsets (${reorderedMatch.coverageMetrics.matched_segments.length} segments matched)`
      );

      // 17.6: Different durations and frame rates (30 fps re-encoded 10s excerpt vs 24 fps 18.6s reference)
      const fps30CandPath = path.join(tmpMediaDir, 'cand_30fps.mp4');
      execFileSync('ffmpeg', [
        '-y', '-ss', '4', '-t', '10', '-i', ref18sPath,
        '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
        fps30CandPath
      ], { stdio: 'ignore' });
      const fps30Probe = await FingerprintEngine.probeVideo(fps30CandPath);
      const fps30FramesRaw = await FingerprintEngine.extractVideoFingerprints(fps30CandPath, {
        intervalSec: 2,
        durationSec: fps30Probe.duration_sec,
        generateThumbnails: false,
        isCandidate: true
      });
      const fps30CandFps: FrameFingerprint[] = fps30FramesRaw.map((f, idx) => ({
        id: `cfp_30fps_${idx}`,
        timestamp_sec: f.timestamp_sec,
        frame_index: idx,
        phash_hex: f.phash_hex,
        vhash_hex: f.vhash_hex,
        crop_phash_hex: f.crop_phash_hex,
        avg_luminance: f.avg_luminance,
        created_at: ''
      }));
      const fps30Match = FingerprintEngine.compareFingerprintSequences(fps30CandFps, ref17Fps, {
        hammingThreshold: 16,
        referenceDurationSec: probe18s.duration_sec,
        candidateDurationSec: fps30Probe.duration_sec
      });
      assert(
        fps30Match.matchStatus === 'POTENTIAL_MATCH' &&
          Math.round(fps30Probe.fps) === 30 &&
          fps30Match.coverageMetrics.candidate_coverage_pct >= 75,
        `17.6: Matches candidate with different frame rate (30 fps vs 24 fps) and shorter duration (${fps30Probe.duration_sec.toFixed(1)}s vs ${probe18s.duration_sec.toFixed(1)}s)`
      );

      // 17.7: Resized, re-encoded, letterboxed, or mildly cropped copy
      const letterboxCandPath = path.join(tmpMediaDir, 'cand_letterbox_cropped.mp4');
      execFileSync('ffmpeg', [
        '-y', '-ss', '2', '-t', '10', '-i', ref18sPath,
        '-vf', 'crop=iw*0.92:ih*0.92,pad=iw:ih+36:0:18:black,scale=240:160',
        '-c:v', 'libx264', '-b:v', '300k', '-preset', 'ultrafast', '-an',
        letterboxCandPath
      ], { stdio: 'ignore' });
      const lbProbe = await FingerprintEngine.probeVideo(letterboxCandPath);
      const lbFramesRaw = await FingerprintEngine.extractVideoFingerprints(letterboxCandPath, {
        intervalSec: 2,
        durationSec: lbProbe.duration_sec,
        generateThumbnails: false,
        isCandidate: true
      });
      const lbCandFps: FrameFingerprint[] = lbFramesRaw.map((f, idx) => ({
        id: `cfp_lb_${idx}`,
        timestamp_sec: f.timestamp_sec,
        frame_index: idx,
        phash_hex: f.phash_hex,
        vhash_hex: f.vhash_hex,
        crop_phash_hex: f.crop_phash_hex,
        avg_luminance: f.avg_luminance,
        created_at: ''
      }));
      const lbMatch = FingerprintEngine.compareFingerprintSequences(lbCandFps, ref17Fps, {
        hammingThreshold: 16,
        referenceDurationSec: probe18s.duration_sec,
        candidateDurationSec: lbProbe.duration_sec
      });
      assert(
        lbMatch.matchStatus === 'POTENTIAL_MATCH' && lbMatch.matchedFramesCount >= 3,
        `17.7: Matches resized, re-encoded, mildly cropped & letterboxed copy via multi-feature (full + center-crop) perceptual fingerprints (${lbMatch.matchedFramesCount} frames matched)`
      );

      // 17.8: Unrelated video produces NO_MATCH and near-zero coverage
      const unrelatedCandFps: FrameFingerprint[] = Array.from({ length: 8 }, (_, idx) => ({
        id: `cfp_unrel_${idx}`,
        timestamp_sec: idx * 2,
        frame_index: idx,
        phash_hex: ref17Fps[idx % ref17Fps.length].phash_hex
          .split('')
          .map(ch => (15 - parseInt(ch, 16)).toString(16))
          .join(''),
        vhash_hex: (ref17Fps[idx % ref17Fps.length].vhash_hex || '0000000000000000')
          .split('')
          .map(ch => (15 - parseInt(ch, 16)).toString(16))
          .join(''),
        crop_phash_hex: (ref17Fps[idx % ref17Fps.length].crop_phash_hex || '0000000000000000')
          .split('')
          .map(ch => (15 - parseInt(ch, 16)).toString(16))
          .join(''),
        avg_luminance: 40,
        created_at: ''
      }));
      const unrelatedMatch = FingerprintEngine.compareFingerprintSequences(unrelatedCandFps, ref17Fps, {
        hammingThreshold: 16,
        referenceDurationSec: probe18s.duration_sec,
        candidateDurationSec: 16
      });
      assert(
        unrelatedMatch.matchStatus === 'NO_MATCH' &&
          unrelatedMatch.coverageMetrics.reference_coverage_pct === 0 &&
          unrelatedMatch.coverageMetrics.candidate_coverage_pct === 0,
        '17.8: Unrelated video produces NO_MATCH with 0% reference and candidate coverage'
      );

      // 17.9: Duplicate/static frames suppression & isolated single-frame coincidence guard
      const staticCandFps: FrameFingerprint[] = [
        ...Array.from({ length: 5 }, (_, idx) => ({
          id: `cfp_static_${idx}`,
          timestamp_sec: idx * 2,
          frame_index: idx,
          phash_hex: ref17Fps[0].phash_hex,
          vhash_hex: ref17Fps[0].vhash_hex,
          crop_phash_hex: ref17Fps[0].crop_phash_hex,
          avg_luminance: ref17Fps[0].avg_luminance,
          created_at: ''
        })),
        ...unrelatedCandFps.slice(0, 4).map((f, idx) => ({
          ...f,
          id: `cfp_static_tail_${idx}`,
          timestamp_sec: (idx + 5) * 2,
          frame_index: idx + 5
        }))
      ];
      const isolatedRefFps17 = [
        ref17Fps[0],
        ...ref17Fps.slice(1).filter(rf => FingerprintEngine.hammingDistance(rf.phash_hex, ref17Fps[0].phash_hex) > 20)
      ];
      const staticMatch = FingerprintEngine.compareFingerprintSequences(staticCandFps, isolatedRefFps17, {
        hammingThreshold: 16,
        referenceDurationSec: probe18s.duration_sec,
        candidateDurationSec: 18
      });
      assert(
        (staticMatch.coverageMetrics.suppressed_static_duplicate_pairs_count ?? 0) >= 4 &&
          staticMatch.coverageMetrics.unique_reference_frames_matched === 1 &&
          staticMatch.coverageMetrics.is_single_frame_coincidence === true &&
          staticMatch.matchStatus === 'NO_MATCH' &&
          staticMatch.matchClassification === 'UNCERTAIN_MATCH',
        `17.9: Suppresses static duplicate frames (${staticMatch.coverageMetrics.suppressed_static_duplicate_pairs_count} suppressed) and flags a single isolated reference frame match as UNCERTAIN_MATCH (is_single_frame_coincidence=true) rather than a confirmed sequence match`
      );

      // 17.10 & 17.11: Interrupted / partial extraction, incomplete status guard, and resumable extraction via API
      const interruptRegRes = await fetch(`${apiBase}/references/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Resumable Full-Duration Extraction Test',
          rightsHolder: 'SPECTRA Continuity Lab',
          assetType: 'VOD_FEATURE',
          sourceUrl: ref18sPath,
          sampleInterval: 2,
          simulateInterruptAfterFrames: 4
        })
      });
      const interruptRegJson: any = await interruptRegRes.json();
      const interruptedRefId: string = interruptRegJson.data?.id;
      const partialRefRecord = db.getReferenceById(interruptedRefId);
      const partialFpsBeforeResume = db.getReferenceFingerprints(interruptedRefId);

      assert(
        interruptRegRes.status === 201 &&
          Boolean(partialRefRecord) &&
          partialRefRecord!.status === 'PROCESSING' &&
          (partialRefRecord!.status as string) !== 'FINGERPRINTED' &&
          partialRefRecord!.extraction_status === 'PARTIAL' &&
          (partialRefRecord!.extraction_status as string) !== 'COMPLETE' &&
          partialRefRecord!.extracted_frame_count === 4 &&
          partialRefRecord!.expected_frame_count === plan2s.expectedFrameCount &&
          partialRefRecord!.last_extracted_timestamp_sec === 6 &&
          Boolean(partialRefRecord!.extraction_error) &&
          partialFpsBeforeResume.length === 4,
        `17.10a & 17.11: Interrupted extraction records status=PROCESSING & extraction_status=PARTIAL (never FINGERPRINTED or COMPLETE when 4 < ${plan2s.expectedFrameCount}), last_extracted_timestamp_sec=6s, and error diagnostic`
      );

      // Now resume extraction via POST /api/references/:id/extract-frames with resume: true
      const resumeRes = await fetch(`${apiBase}/references/${interruptedRefId}/extract-frames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume: true,
          sampleInterval: 2
        })
      });
      const resumeJson: any = await resumeRes.json();
      const resumedRefRecord = db.getReferenceById(interruptedRefId);
      const resumedFps = db.getReferenceFingerprints(interruptedRefId);
      const uniqueFrameIndices = new Set(resumedFps.map(f => f.frame_index));

      assert(
        resumeRes.status === 200 &&
          Boolean(resumedRefRecord) &&
          resumedRefRecord!.status === 'FINGERPRINTED' &&
          resumedRefRecord!.extraction_status === 'COMPLETE' &&
          resumedRefRecord!.image_availability_status === 'COMPLETE' &&
          resumedRefRecord!.extracted_frame_count === plan2s.expectedFrameCount &&
          resumedRefRecord!.retrievable_frame_image_count === plan2s.expectedFrameCount &&
          resumedRefRecord!.missing_frame_image_count === 0 &&
          resumedFps.length === plan2s.expectedFrameCount &&
          uniqueFrameIndices.size === plan2s.expectedFrameCount &&
          (resumedRefRecord!.last_extracted_timestamp_sec ?? 0) >= probe18s.duration_sec - 0.5,
        `17.10b: Resuming interrupted extraction completes remaining frames (${resumedFps.length}/${plan2s.expectedFrameCount}) through ${resumedRefRecord?.last_extracted_timestamp_sec?.toFixed(2)}s with all images verified and transitions status to FINGERPRINTED / COMPLETE`
      );

      // Test paginated frame endpoint GET /api/references/:id/frames
      const paginatedRes = await fetch(`${apiBase}/references/${interruptedRefId}/frames?page=1&limit=5`);
      const paginatedJson: any = await paginatedRes.json();
      assert(
        paginatedRes.status === 200 &&
          Array.isArray(paginatedJson.data?.frames) &&
          paginatedJson.data.frames.length === 5 &&
          paginatedJson.data.totalFrames === plan2s.expectedFrameCount &&
          db.getReferenceFingerprints(interruptedRefId).length === plan2s.expectedFrameCount,
        'Paginated frame timeline API returns 5 frames for display while all extracted frames remain indexed in SQLite'
      );

      // Clean up Test Group 17 temporary files and reference
      db.deleteReference(interruptedRefId);
      try {
        fs.rmSync(tmpMediaDir, { recursive: true, force: true });
      } catch {}
    } finally {
      await new Promise<void>(resolve => apiServer.close(() => resolve()));
    }
  } finally {
    delete process.env.SPECTRA_TEST_ALLOWED_ORIGIN;
    await new Promise<void>(resolve => fixtureServer.close(() => resolve()));
  }

  // -------------------------------------------------------------
  // Test Group 18: Candidate Research, Relevance Ranking & False-Positive Prevention Across All Content Types
  // -------------------------------------------------------------
  console.log('\n[Test Group 18] Candidate Research, Relevance Ranking & False-Positive Prevention');

  // 18.1: Episodic Content — Modern Family S01E01 ("Pilot") target parsing, query generation, and ranking above generic Modern Family results
  const mfRef: any = {
    id: 'ref_test18_mf_s01e01',
    title: 'Modern Family',
    season_episode_info: 'S01E01 - Pilot',
    rights_holder: '20th Television',
    asset_type: 'EPISODIC',
    status: 'FINGERPRINTED',
    file_path: '/app/applet/data/uploads/Modern_Family_-_S01E01__O2TvSeries.Com_.mp4',
    duration_sec: 1378,
    created_at: new Date().toISOString()
  };

  const mfTargetIdentity = CandidateResearchEngine.parseReferenceTargetIdentity(mfRef);
  const mfQueries = CandidateResearchEngine.generateTargetedQueries({ reference: mfRef });
  assert(
    mfTargetIdentity.contentType === 'EPISODIC' &&
      mfTargetIdentity.primaryTitle.toLowerCase() === 'modern family' &&
      mfTargetIdentity.seasonNumber === 1 &&
      mfTargetIdentity.episodeNumber === 1 &&
      mfTargetIdentity.episodeCode === 'S01E01' &&
      mfTargetIdentity.subTitleOrEpisodeTitle?.toLowerCase() === 'pilot' &&
      mfQueries.some(q => q.includes('S01E01')) &&
      mfQueries.some(q => /Season 1 Episode 1/i.test(q)) &&
      mfQueries.some(q => /1x01/i.test(q)) &&
      mfQueries.some(q => /Pilot/i.test(q)),
    `18.1a: Parses complete episodic target identity (Modern Family S01E01 "Pilot") and generates targeted query variations (${mfQueries.slice(0, 4).join(' | ')})`
  );

  const candMfExact: any = {
    id: 'cand_18_mf_exact',
    reference_id: mfRef.id,
    source_url: 'https://o2tvseries4u.com/Modern-Family-8/Season-01/Episode-01/index.html',
    media_url: 'https://d9.o2tv.org/Modern%20Family/Season%2001/Modern%20Family%20-%20S01E01%20Pilot%20(O2TvSeries.Com).mp4',
    domain: 'o2tvseries4u.com',
    discovered_title: 'Modern Family - Season 1 Episode 1 (S01E01) - Pilot Full Episode MP4',
    discovery_provider: 'SUSPECTED_PIRACY',
    pipeline_status: 'DISCOVERED',
    reachability_code: 200,
    reachability_latency_ms: 40,
    media_type: 'MP4',
    candidate_classification: 'VIDEO_ASSET',
    is_live_stream: false,
    discovered_at: new Date().toISOString()
  };

  const candMfGeneric: any = {
    id: 'cand_18_mf_generic',
    reference_id: mfRef.id,
    source_url: 'https://www.youtube.com/watch?v=mfCastClip01',
    domain: 'youtube.com',
    discovered_title: 'Modern Family Cast Funny Moments & Best Scenes Compilation',
    discovery_provider: 'YOUTUBE_PUBLIC',
    pipeline_status: 'DISCOVERED',
    reachability_code: 200,
    reachability_latency_ms: 50,
    media_type: 'HTML_PLAYER',
    candidate_classification: 'GENERAL_WEBPAGE',
    is_live_stream: false,
    discovered_at: new Date().toISOString()
  };

  const candMfWrongEp: any = {
    id: 'cand_18_mf_wrongep',
    reference_id: mfRef.id,
    source_url: 'https://o2tvseries4u.com/Modern-Family-8/Season-01/Episode-02/index.html',
    media_url: 'https://d9.o2tv.org/Modern%20Family/Season%2001/Modern%20Family%20-%20S01E02%20(O2TvSeries.Com).mp4',
    domain: 'o2tvseries4u.com',
    discovered_title: 'Modern Family S01E02 - The Bicycle Thief (Season 1 Episode 2)',
    discovery_provider: 'SUSPECTED_PIRACY',
    pipeline_status: 'DISCOVERED',
    reachability_code: 200,
    reachability_latency_ms: 45,
    media_type: 'MP4',
    candidate_classification: 'VIDEO_ASSET',
    is_live_stream: false,
    discovered_at: new Date().toISOString()
  };

  const candUnrelatedShow: any = {
    id: 'cand_18_unrelated_show',
    reference_id: mfRef.id,
    source_url: 'https://www.youtube.com/watch?v=officePilot1',
    domain: 'youtube.com',
    discovered_title: 'The Office S01E01 Pilot Full Episode Highlights',
    discovery_provider: 'YOUTUBE_PUBLIC',
    pipeline_status: 'DISCOVERED',
    reachability_code: 200,
    reachability_latency_ms: 55,
    media_type: 'HTML_PLAYER',
    candidate_classification: 'GENERAL_WEBPAGE',
    is_live_stream: false,
    discovered_at: new Date().toISOString()
  };

  const evalExact = CandidateResearchEngine.evaluateCandidateAgainstTarget({ candidate: candMfExact, reference: mfRef });
  const evalGeneric = CandidateResearchEngine.evaluateCandidateAgainstTarget({ candidate: candMfGeneric, reference: mfRef });
  const evalWrongEp = CandidateResearchEngine.evaluateCandidateAgainstTarget({ candidate: candMfWrongEp, reference: mfRef });
  const evalUnrelated = CandidateResearchEngine.evaluateCandidateAgainstTarget({ candidate: candUnrelatedShow, reference: mfRef });

  candMfExact.candidate_research = evalExact;
  candMfExact.research_relevance_score = evalExact.research_relevance_score;
  candMfExact.identity_relationship = evalExact.identity_relationship;

  candMfGeneric.candidate_research = evalGeneric;
  candMfGeneric.research_relevance_score = evalGeneric.research_relevance_score;
  candMfGeneric.identity_relationship = evalGeneric.identity_relationship;

  candMfWrongEp.candidate_research = evalWrongEp;
  candMfWrongEp.research_relevance_score = evalWrongEp.research_relevance_score;
  candMfWrongEp.identity_relationship = evalWrongEp.identity_relationship;

  candUnrelatedShow.candidate_research = evalUnrelated;
  candUnrelatedShow.research_relevance_score = evalUnrelated.research_relevance_score;
  candUnrelatedShow.identity_relationship = evalUnrelated.identity_relationship;

  const rankedMfList = CandidateResearchEngine.rankCandidates([
    candUnrelatedShow,
    candMfWrongEp,
    candMfGeneric,
    candMfExact
  ]);

  assert(
    evalExact.identity_relationship === 'EXACT_TARGET_MATCH' &&
      evalGeneric.identity_relationship === 'TARGET_SERIES_OR_ARTIST_GENERIC' &&
      evalExact.research_relevance_score > evalGeneric.research_relevance_score &&
      rankedMfList[0].id === candMfExact.id &&
      rankedMfList[1].id === candMfGeneric.id,
    `18.1b: Modern Family S01E01 ("Pilot") ranks #1 (${(evalExact.research_relevance_score * 100).toFixed(0)}% EXACT_TARGET_MATCH) above generic Modern Family series clip (${(evalGeneric.research_relevance_score * 100).toFixed(0)}% TARGET_SERIES_OR_ARTIST_GENERIC)`
  );

  // 18.2: Different episode (Modern Family S01E02) is flagged as DIFFERENT_EPISODE_OR_ITEM with contradictory evidence and ranked below S01E01
  assert(
    evalWrongEp.identity_relationship === 'DIFFERENT_EPISODE_OR_ITEM' &&
      evalWrongEp.contradictory_evidence.length >= 1 &&
      evalWrongEp.research_relevance_score < evalExact.research_relevance_score &&
      evalWrongEp.research_relevance_score < evalGeneric.research_relevance_score &&
      rankedMfList.findIndex(c => c.id === candMfWrongEp.id) > rankedMfList.findIndex(c => c.id === candMfExact.id),
    `18.2: Different episode (Modern Family S01E02) is flagged as DIFFERENT_EPISODE_OR_ITEM (${(evalWrongEp.research_relevance_score * 100).toFixed(0)}%), records contradictory evidence ("${evalWrongEp.contradictory_evidence[0]}"), and ranks below S01E01`
  );

  // 18.3: Unrelated show cannot be confirmed as a match (MATCH_FOUND), and scattered low-precision frame collisions do not trigger POTENTIAL_MATCH
  const cryptoMod = await import('node:crypto');
  const refTest18Fps: FrameFingerprint[] = Array.from({ length: 20 }, (_, i) => ({
    id: `rfp_18_${i}`,
    reference_id: mfRef.id,
    timestamp_sec: i * 5,
    frame_index: i,
    phash_hex: cryptoMod.createHash('sha256').update(`distinct_ref_scene_${i}`).digest('hex').slice(0, 16),
    avg_luminance: 120,
    created_at: ''
  }));

  // Create 3 candidate preview frames where 2 frames have scattered distance=11 at completely unrelated temporal offsets (t=10s and t=85s)
  const flipElevenBits = (hex: string) => {
    const val = BigInt(`0x${hex}`) ^ 0b11111111111n; // 11 bits flipped -> Hamming distance 11
    return val.toString(16).padStart(16, '0');
  };
  const scatteredThumbFps: FrameFingerprint[] = [
    {
      id: 'cfp_scat_0',
      timestamp_sec: 0,
      frame_index: 0,
      phash_hex: flipElevenBits(refTest18Fps[2].phash_hex), // matches ref t=10s (offset -10s) with dist=11
      avg_luminance: 118,
      created_at: ''
    },
    {
      id: 'cfp_scat_1',
      timestamp_sec: 2,
      frame_index: 1,
      phash_hex: flipElevenBits(refTest18Fps[17].phash_hex), // matches ref t=85s (offset -83s) with dist=11
      avg_luminance: 122,
      created_at: ''
    },
    {
      id: 'cfp_scat_2',
      timestamp_sec: 4,
      frame_index: 2,
      phash_hex: cryptoMod.createHash('sha256').update('unrelated_cand_scene').digest('hex').slice(0, 16),
      avg_luminance: 90,
      created_at: ''
    }
  ];

  const scatteredSeqComp = FingerprintEngine.compareFingerprintSequences(scatteredThumbFps, refTest18Fps, {
    hammingThreshold: 13,
    minMatchedFrames: 2
  });

  const unrelatedContextAssessment = FingerprintEngine.assessMetadataAndContext({
    candidate: candUnrelatedShow,
    reference: mfRef,
    verifiedPageTitle: candUnrelatedShow.discovered_title,
    candidateFps: scatteredThumbFps,
    referenceFps: refTest18Fps,
    visualSimilarityScore: scatteredSeqComp.visualSimilarityScore,
    matchedFramesCount: 2,
    minHammingDist: 10,
    confidenceScore: 0.55
  });

  assert(
    evalUnrelated.identity_relationship === 'UNRELATED_CONTENT' &&
      scatteredSeqComp.matchStatus === 'NO_MATCH' &&
      unrelatedContextAssessment.overallAssessment !== 'MATCH_FOUND' &&
      rankedMfList[rankedMfList.length - 1].id === candUnrelatedShow.id,
    `18.3: Unrelated show ("The Office S01E01") is classified as UNRELATED_CONTENT, ranked last, and blocked from false-positive MATCH_FOUND confirmation (assessment=${unrelatedContextAssessment.overallAssessment}, seqStatus=${scatteredSeqComp.matchStatus})`
  );

  // 18.4: Equivalent content-specific identity & ranking checks across Movies, Live Sports, and Music Videos
  // (a) Movies: Apex Horizon (2026) vs Apex Horizon (2019) vs Official Trailer
  const movieRef: any = {
    id: 'ref_18_movie',
    title: 'Apex Horizon (2026)',
    rights_holder: 'Paramount Pictures',
    asset_type: 'VOD_FEATURE',
    status: 'FINGERPRINTED',
    created_at: new Date().toISOString()
  };
  const movieExactEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
    candidate: {
      id: 'c_mov_exact',
      source_url: 'https://cinema-mirror.to/movies/apex-horizon-2026-1080p.mp4',
      domain: 'cinema-mirror.to',
      discovered_title: 'Apex Horizon (2026) Full Movie 1080p WEB-DL'
    } as any,
    reference: movieRef
  });
  const movieWrongYearEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
    candidate: {
      id: 'c_mov_wrongyear',
      source_url: 'https://cinema-mirror.to/movies/apex-horizon-2019.mp4',
      domain: 'cinema-mirror.to',
      discovered_title: 'Apex Horizon (2019) Original Short Film'
    } as any,
    reference: movieRef
  });

  // (b) Live Sports: India vs New Zealand 1st T20I vs 2nd ODI vs India vs Australia
  const sportsRef: any = {
    id: 'ref_18_sports',
    title: 'India vs New Zealand — 1st T20I Live Broadcast',
    season_episode_info: '1st T20I',
    rights_holder: 'BCCI / Star Sports',
    asset_type: 'LIVE_SPORTS',
    status: 'FINGERPRINTED',
    created_at: new Date().toISOString()
  };
  const sportsExactEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
    candidate: {
      id: 'c_sp_exact',
      source_url: 'https://cricstream.tv/live/ind-vs-nz-1st-t20i.m3u8',
      domain: 'cricstream.tv',
      discovered_title: 'IND vs NZ 1st T20I Live Stream Full Match HD'
    } as any,
    reference: sportsRef
  });
  const sportsDiffFixtureEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
    candidate: {
      id: 'c_sp_difffix',
      source_url: 'https://cricstream.tv/live/ind-vs-nz-2nd-odi.m3u8',
      domain: 'cricstream.tv',
      discovered_title: 'India vs New Zealand 2nd ODI Highlights'
    } as any,
    reference: sportsRef
  });
  const sportsDiffTeamsEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
    candidate: {
      id: 'c_sp_diffteams',
      source_url: 'https://cricstream.tv/live/ind-vs-aus-1st-t20i.m3u8',
      domain: 'cricstream.tv',
      discovered_title: 'India vs Australia 1st T20I Live Stream'
    } as any,
    reference: sportsRef
  });

  // (c) Music Videos: Taylor Swift — Patient Zero vs Taylor Swift — Blank Space
  const musicRef: any = {
    id: 'ref_18_music',
    title: 'Taylor Swift — Patient Zero',
    rights_holder: 'Universal Music Group',
    asset_type: 'MUSIC_VIDEO',
    status: 'FINGERPRINTED',
    created_at: new Date().toISOString()
  };
  const musicExactEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
    candidate: {
      id: 'c_mus_exact',
      source_url: 'https://video-share.net/watch/taylor-swift-patient-zero-official-video',
      domain: 'video-share.net',
      discovered_title: 'Taylor Swift - Patient Zero (Official Music Video)'
    } as any,
    reference: musicRef
  });
  const musicDiffTrackEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
    candidate: {
      id: 'c_mus_difftrack',
      source_url: 'https://www.youtube.com/watch?v=e-ORhEE9VVg',
      domain: 'youtube.com',
      discovered_title: 'Taylor Swift - Blank Space (Official Music Video)'
    } as any,
    reference: musicRef
  });

  assert(
    movieExactEval.identity_relationship === 'EXACT_TARGET_MATCH' &&
      movieWrongYearEval.identity_relationship === 'DIFFERENT_EPISODE_OR_ITEM' &&
      movieExactEval.research_relevance_score > movieWrongYearEval.research_relevance_score &&
      sportsExactEval.identity_relationship === 'EXACT_TARGET_MATCH' &&
      sportsDiffFixtureEval.identity_relationship === 'DIFFERENT_EPISODE_OR_ITEM' &&
      sportsDiffTeamsEval.identity_relationship === 'DIFFERENT_EPISODE_OR_ITEM' &&
      sportsExactEval.research_relevance_score > sportsDiffFixtureEval.research_relevance_score &&
      musicExactEval.identity_relationship === 'EXACT_TARGET_MATCH' &&
      musicDiffTrackEval.identity_relationship === 'DIFFERENT_EPISODE_OR_ITEM' &&
      musicExactEval.research_relevance_score > musicDiffTrackEval.research_relevance_score,
    `18.4: Content-specific identity verification & ranking works across Movies (${(movieExactEval.research_relevance_score * 100).toFixed(0)}% vs ${(movieWrongYearEval.research_relevance_score * 100).toFixed(0)}%), Live Sports (${(sportsExactEval.research_relevance_score * 100).toFixed(0)}% vs ${(sportsDiffFixtureEval.research_relevance_score * 100).toFixed(0)}%), and Music Videos (${(musicExactEval.research_relevance_score * 100).toFixed(0)}% vs ${(musicDiffTrackEval.research_relevance_score * 100).toFixed(0)}%)`
  );

  // 18.5: Missing metadata is treated conservatively as INSUFFICIENT_METADATA (unknown) rather than assumed match or mismatch
  const opaqueCand: any = {
    id: 'cand_18_opaque',
    reference_id: mfRef.id,
    source_url: 'https://edge-relay-04.streamcdn.org/live/channel_feed_720p.m3u8',
    domain: 'edge-relay-04.streamcdn.org',
    discovered_title: 'https://edge-relay-04.streamcdn.org/live/channel_feed_720p.m3u8',
    discovery_provider: 'SUSPECTED_PIRACY',
    pipeline_status: 'DISCOVERED',
    reachability_code: 200,
    reachability_latency_ms: 30,
    media_type: 'HLS_M3U8',
    is_live_stream: true,
    discovered_at: new Date().toISOString()
  };
  const opaqueEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
    candidate: opaqueCand,
    reference: mfRef
  });
  assert(
    opaqueEval.identity_relationship === 'INSUFFICIENT_METADATA' &&
      opaqueEval.missing_metadata.length >= 1 &&
      opaqueEval.contradictory_evidence.length === 0,
    `18.5: Opaque stream URL with missing title/episode metadata is treated conservatively as INSUFFICIENT_METADATA (score=${(opaqueEval.research_relevance_score * 100).toFixed(0)}%, missing="${opaqueEval.missing_metadata[0]}") rather than assumed match or mismatch`
  );

  // 18.6: Research relevance and forensic confidence remain strictly separate
  const highResearchZeroVisual = FingerprintEngine.assessMetadataAndContext({
    candidate: candMfExact,
    reference: mfRef,
    verifiedPageTitle: candMfExact.discovered_title,
    candidateFps: [],
    referenceFps: refTest18Fps,
    visualSimilarityScore: undefined,
    matchedFramesCount: 0,
    minHammingDist: 64,
    confidenceScore: 0
  });
  assert(
    evalExact.research_relevance_score >= 0.85 &&
      highResearchZeroVisual.metadataRelevanceScore >= 0.80 &&
      highResearchZeroVisual.overallAssessment === 'INSUFFICIENT_EVIDENCE',
    `18.6: Research relevance (${(evalExact.research_relevance_score * 100).toFixed(0)}%) and forensic frame match confidence (0%, assessment=${highResearchZeroVisual.overallAssessment}) remain strictly separate`
  );

  // -------------------------------------------------------------
  // 19. Multi-Reference Frame Image Persistence, Self-Healing (>80 Frames), Selective Regeneration & Honest Availability Telemetry
  // -------------------------------------------------------------
  console.log('\n[19] Testing Multi-Reference Frame Persistence (>80 Frames), Self-Healing, Selective Regeneration & HTTP Image Serving...');

  const { execFileSync: execFileSync19 } = await import('node:child_process');
  const test19TempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-test19-media-'));
  const createdThumbPaths19: string[] = [];
  try {
    const longVideoPath = path.join(test19TempDir, 'episodic_92s_master.mp4');
    const vodShortVideoPath = path.join(test19TempDir, 'vod_feature_12s_master.mp4');

    // Generate two distinct non-testsrc reference videos: 92s (>80 frames at 1s interval = 93 frames) and 12s (7 frames at 2s interval)
    execFileSync19(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'cellauto=s=160x90:r=4',
        '-t',
        '92',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'ultrafast',
        longVideoPath
      ],
      { timeout: 30000 }
    );

    execFileSync19(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'life=size=160x90:rate=4:ratio=0.4',
        '-t',
        '12',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'ultrafast',
        vodShortVideoPath
      ],
      { timeout: 20000 }
    );

    const refAId = 'ref_19_episodic_93frames';
    const extractedA = await FingerprintEngine.extractVideoFingerprints(longVideoPath, {
      intervalSec: 1,
      durationSec: 92,
      generateThumbnails: true,
      title: 'Episodic 92s Reference',
      isCandidate: false,
      referenceId: refAId,
      thumbnailsDir: db.getThumbnailsDir()
    });

    for (const f of extractedA) {
      if (f.thumbnail_url) {
        createdThumbPaths19.push(path.join(db.getThumbnailsDir(), path.basename(f.thumbnail_url)));
      }
    }

    const everyFrameHasDiskAndBase64 =
      extractedA.length >= 90 &&
      extractedA.every(f => {
        const diskFile = f.thumbnail_url
          ? path.join(db.getThumbnailsDir(), path.basename(f.thumbnail_url))
          : '';
        return (
          Boolean(f.thumbnail_data && f.thumbnail_data.startsWith('data:image/jpeg;base64,')) &&
          Boolean(diskFile && fs.existsSync(diskFile) && fs.statSync(diskFile).size > 100)
        );
      });

    assert(
      everyFrameHasDiskAndBase64 && Boolean(extractedA[85]?.thumbnail_data),
      `19.1: Extracting >80 reference frames (${extractedA.length} frames) persists both disk JPEGs and SQLite base64 thumbnail_data for ALL frames including frame #85 (no 30/80 frame cutoff)`
    );

    const now19 = new Date().toISOString();
    db.persistAndVerifyReferenceExtraction({
      reference: {
        id: refAId,
        title: 'Chronicles S02E04 — Full 92s Episode',
        rights_holder: 'Studio Alpha',
        asset_type: 'EPISODIC',
        duration_sec: 92,
        resolution: '320x180',
        fps: 10,
        codec: 'h264',
        source_type: 'UPLOAD',
        file_path: longVideoPath,
        thumbnail_url: extractedA[0]?.thumbnail_url,
        created_at: now19,
        status: 'FINGERPRINTED',
        provenance_sha256: 'sha256_ref19_a',
        fingerprint_count: extractedA.length,
        sample_interval_sec: 1,
        expected_frame_count: extractedA.length,
        extracted_frame_count: extractedA.length,
        extraction_status: 'COMPLETE',
        extraction_progress_pct: 100
      },
      extractedFrames: extractedA,
      sampleIntervalSec: 1,
      durationSec: 92,
      sourceVideoPath: longVideoPath,
      replaceExistingFingerprints: true
    });

    const refBId = 'ref_19_vod_feature';
    const extractedB = await FingerprintEngine.extractVideoFingerprints(vodShortVideoPath, {
      intervalSec: 2,
      durationSec: 12,
      generateThumbnails: true,
      title: 'VOD Feature 12s Reference',
      isCandidate: false,
      referenceId: refBId,
      thumbnailsDir: db.getThumbnailsDir()
    });
    for (const f of extractedB) {
      if (f.thumbnail_url) {
        createdThumbPaths19.push(path.join(db.getThumbnailsDir(), path.basename(f.thumbnail_url)));
      }
    }
    db.persistAndVerifyReferenceExtraction({
      reference: {
        id: refBId,
        title: 'Solaris Horizon (2026 Feature)',
        rights_holder: 'Studio Beta',
        asset_type: 'VOD_FEATURE',
        duration_sec: 12,
        resolution: '320x180',
        fps: 10,
        codec: 'h264',
        source_type: 'UPLOAD',
        file_path: vodShortVideoPath,
        thumbnail_url: extractedB[0]?.thumbnail_url,
        created_at: now19,
        status: 'FINGERPRINTED',
        provenance_sha256: 'sha256_ref19_b',
        fingerprint_count: extractedB.length,
        sample_interval_sec: 2,
        expected_frame_count: extractedB.length,
        extracted_frame_count: extractedB.length,
        extraction_status: 'COMPLETE',
        extraction_progress_pct: 100
      },
      extractedFrames: extractedB,
      sampleIntervalSec: 2,
      durationSec: 12,
      sourceVideoPath: vodShortVideoPath,
      replaceExistingFingerprints: true
    });

    // 19.2: Simulate restart / disk loss by deleting disk JPEGs for frames #0, #35, and #85 of Ref A and frame #3 of Ref B
    for (const idx of [0, 35, 85]) {
      const f = extractedA[idx];
      if (f?.thumbnail_url) {
        const p = path.join(db.getThumbnailsDir(), path.basename(f.thumbnail_url));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
    if (extractedB[3]?.thumbnail_url) {
      const pB = path.join(db.getThumbnailsDir(), path.basename(extractedB[3].thumbnail_url));
      if (fs.existsSync(pB)) fs.unlinkSync(pB);
    }

    // Verify getReferenceFrameImageBuffer and getReferenceFingerprints self-heal all deleted thumbnails from SQLite thumbnail_data
    const imgBuf85 = db.getReferenceFrameImageBuffer(refAId, 85);
    const imgBuf35 = db.getReferenceFrameImageBuffer(refAId, 35);
    const imgBufB3 = db.getReferenceFrameImageBuffer(refBId, 3);
    const diskPath85After = path.join(
      db.getThumbnailsDir(),
      path.basename(extractedA[85].thumbnail_url!)
    );
    const refAfterHeal = db.getReferenceById(refAId);

    assert(
      Boolean(imgBuf85 && imgBuf85.buffer[0] === 0xff && imgBuf85.buffer[1] === 0xd8) &&
        Boolean(imgBuf35 && imgBuf35.buffer[0] === 0xff && imgBuf35.buffer[1] === 0xd8) &&
        Boolean(imgBufB3 && imgBufB3.buffer[0] === 0xff && imgBufB3.buffer[1] === 0xd8) &&
        fs.existsSync(diskPath85After) &&
        refAfterHeal?.image_availability_status === 'COMPLETE' &&
        refAfterHeal?.retrievable_frame_image_count === extractedA.length,
      `19.2: Deleted disk thumbnails across multiple references (including frame #35 and frame #85) automatically self-heal from SQLite thumbnail_data and return valid JPEG bytes (0xFF 0xD8)`
    );

    // 19.3: Selective single-frame regeneration when BOTH disk file AND SQLite thumbnail_data are missing, while source video exists
    const missingIdx = 42;
    const diskPath42 = path.join(
      db.getThumbnailsDir(),
      path.basename(extractedA[missingIdx].thumbnail_url!)
    );
    if (fs.existsSync(diskPath42)) fs.unlinkSync(diskPath42);
    // Wipe thumbnail_data in SQLite for frame #42 only to simulate legacy unbacked frame
    (db as any).db
      .prepare(`UPDATE reference_fingerprints SET thumbnail_data = NULL WHERE id = ?`)
      .run(`fp_ref_${refAId}_${missingIdx}`);

    const auditBeforeRegen = db.computeReferenceImageAvailability(refAId, extractedA.length);
    const repairReport = db.auditAndRepairReferenceFrameImages(refAId);
    const auditItemA = repairReport.find(a => a.reference_id === refAId);
    const fpsAfterRegen = db.getReferenceFingerprints(refAId, false);
    const fp42After = fpsAfterRegen.find(f => f.frame_index === missingIdx);

    assert(
      auditBeforeRegen.missing_frame_image_count === 1 &&
        auditBeforeRegen.image_availability_status === 'PARTIAL_IMAGES_MISSING' &&
        Boolean(auditItemA) &&
        auditItemA!.regenerated_from_source_video_count === 1 &&
        auditItemA!.retrievable_frame_image_count === extractedA.length &&
        auditItemA!.image_availability_status === 'COMPLETE' &&
        fs.existsSync(diskPath42) &&
        Boolean(fp42After?.thumbnail_data?.startsWith('data:image/jpeg;base64,')) &&
        fp42After?.image_available === true,
      `19.3: auditAndRepairReferenceFrameImages selectively regenerates ONLY the 1 missing frame (#42 at t=${extractedA[missingIdx].timestamp_sec}s) from source video without recreating the reference`
    );

    // 19.4: Strict Completion Gate — Distinguish indexed frames from retrievable images when source video is unavailable
    // (must NEVER mark reference FINGERPRINTED or COMPLETE when any frame images are missing)
    const refCId = 'ref_19_missing_source_partial';
    db.upsertReference({
      id: refCId,
      title: 'Legacy Reference With Partial Missing Images',
      rights_holder: 'Studio Gamma',
      asset_type: 'VOD_FEATURE',
      duration_sec: 10,
      resolution: '320x180',
      fps: 10,
      codec: 'h264',
      source_type: 'UPLOAD',
      file_path: '/app/applet/uploads/non_existent_removed_video_file.mp4',
      thumbnail_url: extractedB[0]?.thumbnail_url,
      created_at: now19,
      status: 'FINGERPRINTED',
      provenance_sha256: 'sha256_ref19_c',
      fingerprint_count: 6,
      sample_interval_sec: 2,
      expected_frame_count: 6,
      extracted_frame_count: 6,
      extraction_status: 'COMPLETE',
      extraction_progress_pct: 100
    });

    // Frames 0..2 have valid base64 + disk thumbnails; frames 3..5 have broken /thumbnails/nonexistent_*.jpg paths and NULL thumbnail_data
    const refCFps: FrameFingerprint[] = [0, 1, 2, 3, 4, 5].map(idx => ({
      id: `fp_ref_${refCId}_${idx}`,
      reference_id: refCId,
      timestamp_sec: idx * 2,
      frame_index: idx,
      phash_hex: `a1b2c3d4e5f6000${idx}`,
      avg_luminance: 120,
      thumbnail_data: idx < 3 ? extractedB[idx]?.thumbnail_data : undefined,
      thumbnail_path: idx < 3 ? extractedB[idx]?.thumbnail_path : `/thumbnails/thumb_nonexistent_dead_${idx}.jpg`,
      thumbnail_url: idx < 3 ? extractedB[idx]?.thumbnail_url : `/thumbnails/thumb_nonexistent_dead_${idx}.jpg`,
      created_at: now19
    }));
    db.insertReferenceFingerprints(refCFps);

    // Run auditAndRepairReferenceFrameImages on refCId — since source video is missing, it must downgrade status from FINGERPRINTED -> PROCESSING and extraction_status from COMPLETE -> PARTIAL
    db.auditAndRepairReferenceFrameImages(refCId);

    const refCDetails = db.getReferenceById(refCId);
    const refCFetchedFps = db.getReferenceFingerprints(refCId, true);
    const availableFramesC = refCFetchedFps.filter(f => f.image_available === true && Boolean(f.thumbnail_url));
    const missingFramesC = refCFetchedFps.filter(f => f.image_available === false && !f.thumbnail_url);

    assert(
      refCDetails !== null &&
        refCDetails.status === 'PROCESSING' &&
        (refCDetails.status as string) !== 'FINGERPRINTED' &&
        refCDetails.extraction_status === 'PARTIAL' &&
        (refCDetails.extraction_status as string) !== 'COMPLETE' &&
        refCDetails.fingerprint_count === 6 &&
        refCDetails.retrievable_frame_image_count === 3 &&
        refCDetails.missing_frame_image_count === 3 &&
        refCDetails.extraction_progress_pct === 50 &&
        refCDetails.image_availability_status === 'PARTIAL_IMAGES_MISSING' &&
        Boolean(refCDetails.extraction_error && refCDetails.extraction_error.includes('3/6 images retrievable')) &&
        availableFramesC.length === 3 &&
        missingFramesC.length === 3,
      `19.4: Strict completion gate downgrades reference with missing frame images (3/6 retrievable) to status=${refCDetails?.status}, extraction_status=${refCDetails?.extraction_status}, progress=${refCDetails?.extraction_progress_pct}%, and never marks it FINGERPRINTED or COMPLETE`
    );

    // 19.5: Multi-duration & multi-sampling-interval persistence (1s, 2s, 5s, custom 1.5s) + full retrievability after simulated backend restart
    const video6sPath = path.join(test19TempDir, 'multi_interval_6s.mp4');
    const video9_4sPath = path.join(test19TempDir, 'multi_interval_9_4s.mp4');
    execFileSync19(
      'ffmpeg',
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'cellauto=s=160x90:r=10', '-t', '6.0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', video6sPath],
      { timeout: 20000 }
    );
    execFileSync19(
      'ffmpeg',
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'life=size=160x90:rate=10:ratio=0.45', '-t', '9.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', video9_4sPath],
      { timeout: 20000 }
    );

    const multiIntervalCases = [
      { id: 'ref_19_5_int_1s', title: 'Interval 1.0s Reference (6.0s)', path: video6sPath, interval: 1 },
      { id: 'ref_19_5_int_2s', title: 'Interval 2.0s Reference (6.0s)', path: video6sPath, interval: 2 },
      { id: 'ref_19_5_int_5s', title: 'Interval 5.0s Reference (6.0s)', path: video6sPath, interval: 5 },
      { id: 'ref_19_5_int_1_5s', title: 'Custom Interval 1.5s Reference (9.4s)', path: video9_4sPath, interval: 1.5 }
    ];

    let allMultiIntervalsVerified = true;
    const expectedCountsByRef: Record<string, number> = {};

    for (const tc of multiIntervalCases) {
      const probeTc = await FingerprintEngine.probeVideo(tc.path);
      const planTc = FingerprintEngine.calculateSamplingPlan(probeTc.duration_sec, tc.interval);
      expectedCountsByRef[tc.id] = planTc.expectedFrameCount;

      const framesTc = await FingerprintEngine.extractVideoFingerprints(tc.path, {
        intervalSec: tc.interval,
        durationSec: probeTc.duration_sec,
        generateThumbnails: true,
        title: tc.title,
        isCandidate: false,
        referenceId: tc.id,
        thumbnailsDir: db.getThumbnailsDir()
      });

      const persistedTcResult = db.persistAndVerifyReferenceExtraction({
        reference: {
          id: tc.id,
          title: tc.title,
          rights_holder: 'SPECTRA Verification Suite',
          asset_type: 'VOD_FEATURE',
          duration_sec: probeTc.duration_sec,
          resolution: `${probeTc.width}x${probeTc.height}`,
          fps: probeTc.fps,
          codec: probeTc.codec,
          source_type: 'UPLOAD',
          file_path: tc.path,
          thumbnail_url: framesTc[0]?.thumbnail_url,
          created_at: now19,
          status: 'PROCESSING',
          provenance_sha256: `sha256_${tc.id}`,
          fingerprint_count: framesTc.length,
          sample_interval_sec: tc.interval,
          expected_frame_count: planTc.expectedFrameCount,
          extracted_frame_count: framesTc.length
        },
        extractedFrames: framesTc,
        sampleIntervalSec: tc.interval,
        durationSec: probeTc.duration_sec,
        sourceVideoPath: tc.path,
        replaceExistingFingerprints: true
      });
      const persistedTc = persistedTcResult.reference;

      if (
        !persistedTc ||
        persistedTc.status !== 'FINGERPRINTED' ||
        persistedTc.extraction_status !== 'COMPLETE' ||
        persistedTc.image_availability_status !== 'COMPLETE' ||
        persistedTc.expected_frame_count !== planTc.expectedFrameCount ||
        persistedTc.extracted_frame_count !== planTc.expectedFrameCount ||
        persistedTc.retrievable_frame_image_count !== planTc.expectedFrameCount ||
        persistedTc.missing_frame_image_count !== 0 ||
        persistedTc.extraction_progress_pct !== 100
      ) {
        allMultiIntervalsVerified = false;
      }

      // Delete the last frame's disk JPEG to verify post-restart self-healing on every reference
      const lastThumbUrl = framesTc[framesTc.length - 1]?.thumbnail_url;
      if (lastThumbUrl) {
        const pLast = path.join(db.getThumbnailsDir(), path.basename(lastThumbUrl));
        if (fs.existsSync(pLast)) fs.unlinkSync(pLast);
      }
    }

    // Simulate backend restart by opening a fresh ArgusDatabase connection against TEST_DB_PATH
    const restartDb19 = new ArgusDatabase(TEST_DB_PATH);
    let allRetrievableAfterRestart = true;
    try {
      for (const tc of multiIntervalCases) {
        const refAfterRestart = restartDb19.getReferenceById(tc.id);
        const fpsAfterRestart = restartDb19.getReferenceFingerprints(tc.id, true);
        const expCount = expectedCountsByRef[tc.id];
        const lastFrameBuf = restartDb19.getReferenceFrameImageBuffer(tc.id, expCount - 1);
        if (
          !refAfterRestart ||
          refAfterRestart.status !== 'FINGERPRINTED' ||
          refAfterRestart.extraction_status !== 'COMPLETE' ||
          refAfterRestart.image_availability_status !== 'COMPLETE' ||
          fpsAfterRestart.length !== expCount ||
          !fpsAfterRestart.every(f => f.image_available === true && Boolean(f.thumbnail_url)) ||
          !lastFrameBuf ||
          lastFrameBuf.buffer[0] !== 0xff ||
          lastFrameBuf.buffer[1] !== 0xd8
        ) {
          allRetrievableAfterRestart = false;
        }
      }
    } finally {
      restartDb19.close();
    }

    assert(
      allMultiIntervalsVerified && allRetrievableAfterRestart,
      `19.5: Multiple new references across different durations and intervals (1s=${expectedCountsByRef['ref_19_5_int_1s']}f, 2s=${expectedCountsByRef['ref_19_5_int_2s']}f, 5s=${expectedCountsByRef['ref_19_5_int_5s']}f, custom 1.5s=${expectedCountsByRef['ref_19_5_int_1_5s']}f) persist 100% of frames/images and remain retrievable after simulated backend restart`
    );

    // 19.6: Verify probeVideo & POST /api/references/:id/extract-frames never fabricate 7200s / 3,601 expected frames when source video is missing
    const missingVideoPath = '/app/applet/uploads/non_existent_patient_zero_312s.mp4';
    const missingProbe = await FingerprintEngine.probeVideo(missingVideoPath);
    const refMissingSourceId = 'ref_19_6_missing_source_312s';
    db.upsertReference({
      id: refMissingSourceId,
      title: 'Missing Source Video Guard Test (312.23s @ 2s = 157 frames)',
      rights_holder: 'SPECTRA Verification Suite',
      asset_type: 'VOD_FEATURE',
      duration_sec: 7200, // Simulate legacy corrupted 7200s fallback
      resolution: '1920x1080',
      fps: 24,
      codec: 'h264',
      source_type: 'UPLOAD',
      file_path: missingVideoPath,
      created_at: now19,
      status: 'PROCESSING',
      provenance_sha256: 'sha256_ref_19_6',
      fingerprint_count: 157,
      sample_interval_sec: 2,
      expected_frame_count: 3601,
      extracted_frame_count: 157
    });
    const fps157: FrameFingerprint[] = [];
    for (let idx = 0; idx < 157; idx++) {
      fps157.push({
        id: `fp_${refMissingSourceId}_${idx}`,
        reference_id: refMissingSourceId,
        timestamp_sec: idx * 2,
        frame_index: idx,
        phash_hex: (BigInt(idx + 1) * 0x1020304050607n).toString(16).padStart(16, '0').slice(0, 16),
        avg_luminance: 120,
        thumbnail_data: idx < 30 ? extractedA[idx % extractedA.length].thumbnail_data : undefined,
        thumbnail_path: `/thumbnails/thumb_${refMissingSourceId}_${idx}.jpg`,
        thumbnail_url: `/thumbnails/thumb_${refMissingSourceId}_${idx}.jpg`,
        created_at: now19
      });
    }
    db.insertReferenceFingerprints(fps157);
    for (let idx = 0; idx < 30; idx++) {
      createdThumbPaths19.push(path.join(db.getThumbnailsDir(), `thumb_${refMissingSourceId}_${idx}.jpg`));
    }

    const beforeSyncRef157 = db.getReferenceById(refMissingSourceId)!;
    const resolvedMissingVideo = db.resolveExistingReferenceVideoPath(beforeSyncRef157);
    const healedRef157 = db.syncReferenceExtractionCompleteness(refMissingSourceId);

    assert(
      missingProbe.duration_sec === 0 &&
        resolvedMissingVideo === null &&
        Boolean(healedRef157) &&
        healedRef157!.source_video_available === false &&
        healedRef157!.duration_sec === 312 &&
        healedRef157!.expected_frame_count === 157 &&
        healedRef157!.extracted_frame_count === 157 &&
        healedRef157!.retrievable_frame_image_count === 30 &&
        healedRef157!.missing_frame_image_count === 127 &&
        healedRef157!.status === 'PROCESSING' &&
        healedRef157!.extraction_status === 'PARTIAL',
      `19.6: probeVideo returns duration_sec=0 for missing files, resolveExistingReferenceVideoPath returns null without corrupting duration to 7200s/3,601 frames, and syncReferenceExtractionCompleteness restores true duration=312s (expected=157, retrievable=30, missing=127)`
    );

    // 19.7: Multi-batch (>60 frames) full-video extraction & base64 + disk JPEG persistence across all frames (no 30-frame or 80-frame cap)
    const video65sPath = path.join(test19TempDir, 'batched_full_video_65_6s.mp4');
    execFileSync19(
      'ffmpeg',
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'cellauto=s=160x90:r=5', '-t', '65.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', video65sPath],
      { timeout: 30000 }
    );
    const probe65 = await FingerprintEngine.probeVideo(video65sPath);
    const plan65 = FingerprintEngine.calculateSamplingPlan(probe65.duration_sec, 1.0);
    const refBatchId = 'ref_19_7_batched_65s';
    let progressBatchesCount = 0;

    const extracted65 = await FingerprintEngine.extractVideoFingerprints(video65sPath, {
      referenceId: refBatchId,
      thumbnailsDir: db.getThumbnailsDir(),
      intervalSec: 1.0,
      durationSec: probe65.duration_sec,
      generateThumbnails: true,
      title: 'Batched 65.6s Full-Video Reference',
      isCandidate: false,
      onProgress: () => {
        progressBatchesCount++;
      }
    });
    for (const f of extracted65) {
      if (f.thumbnail_url) {
        createdThumbPaths19.push(path.join(db.getThumbnailsDir(), path.basename(f.thumbnail_url)));
      }
    }

    const persisted65 = db.persistAndVerifyReferenceExtraction({
      reference: {
        id: refBatchId,
        title: 'Batched 65.6s Full-Video Reference',
        rights_holder: 'SPECTRA Verification Suite',
        asset_type: 'VOD_FEATURE',
        duration_sec: probe65.duration_sec,
        resolution: `${probe65.width}x${probe65.height}`,
        fps: probe65.fps,
        codec: probe65.codec,
        source_type: 'UPLOAD',
        file_path: video65sPath,
        thumbnail_url: extracted65[0]?.thumbnail_url,
        created_at: now19,
        status: 'PROCESSING',
        provenance_sha256: 'sha256_ref_19_7',
        fingerprint_count: extracted65.length,
        sample_interval_sec: 1.0,
        expected_frame_count: plan65.expectedFrameCount,
        extracted_frame_count: extracted65.length
      },
      extractedFrames: extracted65,
      sampleIntervalSec: 1.0,
      durationSec: probe65.duration_sec,
      sourceVideoPath: video65sPath,
      replaceExistingFingerprints: true
    });

    const rawFps65 = db.getReferenceFingerprints(refBatchId, false);
    const allHaveBase64AndDisk65 = rawFps65.every(fp => {
      const hasB64 = Boolean(fp.thumbnail_data && fp.thumbnail_data.startsWith('data:image/jpeg;base64,'));
      const diskFile = fp.thumbnail_url ? path.join(db.getThumbnailsDir(), path.basename(fp.thumbnail_url)) : '';
      return hasB64 && Boolean(diskFile && fs.existsSync(diskFile) && fs.statSync(diskFile).size >= 64);
    });

    assert(
      plan65.expectedFrameCount >= 66 &&
        extracted65.length === plan65.expectedFrameCount &&
        progressBatchesCount >= 2 &&
        persisted65.isComplete === true &&
        persisted65.reference.status === 'FINGERPRINTED' &&
        persisted65.reference.extraction_status === 'COMPLETE' &&
        persisted65.reference.retrievable_frame_image_count === plan65.expectedFrameCount &&
        persisted65.reference.missing_frame_image_count === 0 &&
        allHaveBase64AndDisk65,
      `19.7: Batched extraction (>60 frames, duration=${probe65.duration_sec.toFixed(2)}s @ 1s = ${plan65.expectedFrameCount} frames, ${progressBatchesCount} progress batches) processes 0.00s through final tail timestamp (${extracted65[extracted65.length - 1]?.timestamp_sec}s) and persists both disk JPEG + SQLite base64 for all ${plan65.expectedFrameCount}/${plan65.expectedFrameCount} frames`
    );

    // 19.8: Explicitly verify frames 29, 30, 31, 32, and all subsequent frames (30..end) have persisted JPEGs and survive backend restart + disk wipe
    const boundaryIndices = [28, 29, 30, 31, 32, 45, 60, plan65.expectedFrameCount - 1];
    const boundaryBeforeRestartOk = boundaryIndices.every(idx => {
      const fp = rawFps65.find(f => f.frame_index === idx);
      if (!fp || !fp.thumbnail_url || !fp.thumbnail_data?.startsWith('data:image/jpeg;base64,')) return false;
      const diskP = path.join(db.getThumbnailsDir(), path.basename(fp.thumbnail_url));
      if (!fs.existsSync(diskP) || fs.statSync(diskP).size < 64) return false;
      const buf = fs.readFileSync(diskP);
      return buf[0] === 0xff && buf[1] === 0xd8;
    });

    // Delete all disk JPEGs for refBatchId (including frames 28, 29, 30, 31, 32..end) and simulate backend restart
    for (const fp of rawFps65) {
      if (fp.thumbnail_url) {
        const dp = path.join(db.getThumbnailsDir(), path.basename(fp.thumbnail_url));
        if (fs.existsSync(dp)) fs.unlinkSync(dp);
      }
    }
    const reopenedDb19_8 = new ArgusDatabase(TEST_DB_PATH);
    let boundaryAfterRestartOk = false;
    try {
      const restoredFps65 = reopenedDb19_8.getReferenceFingerprints(refBatchId, false);
      boundaryAfterRestartOk =
        restoredFps65.length === plan65.expectedFrameCount &&
        restoredFps65.every((fp, idx) => {
          if (idx < 28) return fp.image_available === true;
          const imgBuf = reopenedDb19_8.getReferenceFrameImageBuffer(refBatchId, fp.frame_index);
          const diskP = fp.thumbnail_url ? path.join(reopenedDb19_8.getThumbnailsDir(), path.basename(fp.thumbnail_url)) : '';
          return (
            fp.image_available === true &&
            Boolean(imgBuf && imgBuf.buffer.length >= 64 && imgBuf.buffer[0] === 0xff && imgBuf.buffer[1] === 0xd8) &&
            Boolean(diskP && fs.existsSync(diskP) && fs.statSync(diskP).size >= 64)
          );
        });
    } finally {
      reopenedDb19_8.close();
    }

    assert(
      boundaryBeforeRestartOk && boundaryAfterRestartOk,
      `19.8: Frames #29, #30, #31, #32 (frame_index 28, 29, 30, 31) and every subsequent frame (32..${plan65.expectedFrameCount - 1}) have verified persisted JPEGs and remain 100% retrievable after backend restart`
    );

    // 19.9: Reproduce exact Taylor Swift — Patient Zero legacy state (frames 0..29 have JPEGs, frames 30..end have dHash only)
    // and verify repair regenerates all missing JPEGs from original video at recorded timestamps WITHOUT changing frame IDs, timestamps, or fingerprints
    const snapshotBeforeRepair = db.getReferenceFingerprints(refBatchId, false).map(f => ({
      id: f.id,
      frame_index: f.frame_index,
      timestamp_sec: f.timestamp_sec,
      phash_hex: f.phash_hex
    }));

    // Simulate legacy 30-frame cutoff on refBatchId: remove disk JPEGs FIRST and then set SQLite thumbnail_data = NULL for frame_index >= 30
    for (const fp of snapshotBeforeRepair) {
      if (fp.frame_index >= 30) {
        const canonicalP = path.join(db.getThumbnailsDir(), `thumb_${refBatchId}_${fp.frame_index}.jpg`);
        if (fs.existsSync(canonicalP)) fs.unlinkSync(canonicalP);
      }
    }
    const { DatabaseSync: SqliteSync19_9 } = await import('node:sqlite');
    const rawSqlite19_9 = new SqliteSync19_9(TEST_DB_PATH);
    try {
      rawSqlite19_9
        .prepare(`UPDATE reference_fingerprints SET thumbnail_data = NULL WHERE reference_id = ? AND frame_index >= 30`)
        .run(refBatchId);
    } finally {
      rawSqlite19_9.close();
    }

    const degradedState = db.syncReferenceExtractionCompleteness(refBatchId)!;
    const expectedMissingCount = plan65.expectedFrameCount - 30;
    const repairAudit19_9 = db.auditAndRepairReferenceFrameImages(refBatchId)[0];
    const afterRepairRef = db.getReferenceById(refBatchId)!;
    const afterRepairFps = db.getReferenceFingerprints(refBatchId, false);

    const idsTimestampsHashesPreserved =
      afterRepairFps.length === snapshotBeforeRepair.length &&
      afterRepairFps.every((fp, i) => {
        const orig = snapshotBeforeRepair[i];
        const hasValidJpeg =
          fp.image_available === true &&
          Boolean(fp.thumbnail_data?.startsWith('data:image/jpeg;base64,')) &&
          Boolean(fp.thumbnail_url && fs.existsSync(path.join(db.getThumbnailsDir(), path.basename(fp.thumbnail_url))));
        return (
           hasValidJpeg &&
          fp.id === orig.id &&
          fp.frame_index === orig.frame_index &&
          Math.abs(fp.timestamp_sec - orig.timestamp_sec) < 0.001 &&
          fp.phash_hex === orig.phash_hex
        );
      });

    assert(
      degradedState.retrievable_frame_image_count === 30 &&
        degradedState.missing_frame_image_count === expectedMissingCount &&
        degradedState.status === 'PROCESSING' &&
        degradedState.extraction_status === 'PARTIAL' &&
        repairAudit19_9.regenerated_from_source_video_count === expectedMissingCount &&
        repairAudit19_9.missing_frame_image_count === 0 &&
        afterRepairRef.status === 'FINGERPRINTED' &&
        afterRepairRef.extraction_status === 'COMPLETE' &&
        afterRepairRef.retrievable_frame_image_count === plan65.expectedFrameCount &&
        idsTimestampsHashesPreserved,
      `19.9: Repair operation regenerates all ${expectedMissingCount} missing JPEGs (frames 30..${plan65.expectedFrameCount - 1}) using original video and recorded timestamps while preserving 100% of existing frame IDs, timestamps, and dHash fingerprints`
    );

    // 19.10: Verify persistAndVerifyReferenceExtraction never saves newly extracted fingerprints independently without verified JPEGs
    const refNoImgGuardId = 'ref_19_10_no_imageless_fp';
    const imagelessPersistence = db.persistAndVerifyReferenceExtraction({
      reference: {
        id: refNoImgGuardId,
        title: 'Unverified Image Guard Test',
        rights_holder: 'SPECTRA Test',
        asset_type: 'VOD_FEATURE',
        duration_sec: 4,
        resolution: '1280x720',
        fps: 24,
        codec: 'h264',
        source_type: 'UPLOAD',
        file_path: '/tmp/non_existent_source_19_10.mp4',
        created_at: now19,
        status: 'PROCESSING',
        provenance_sha256: 'sha_19_10',
        fingerprint_count: 0,
        sample_interval_sec: 2,
        expected_frame_count: 3,
        extracted_frame_count: 0
      },
      extractedFrames: [
        {
          frame_index: 0,
          timestamp_sec: 0,
          phash_hex: '97975393b3331313',
          thumbnail_data: extracted65[0]?.thumbnail_data,
          thumbnail_url: `/thumbnails/thumb_${refNoImgGuardId}_0.jpg`
        },
        {
          frame_index: 1,
          timestamp_sec: 2,
          phash_hex: '595d559191830f3d',
          thumbnail_data: undefined,
          thumbnail_url: undefined
        }
      ],
      sampleIntervalSec: 2,
      durationSec: 4,
      sourceVideoPath: null,
      replaceExistingFingerprints: true
    });
    createdThumbPaths19.push(path.join(db.getThumbnailsDir(), `thumb_${refNoImgGuardId}_0.jpg`));

    assert(
      imagelessPersistence.fingerprints.length === 1 &&
        imagelessPersistence.fingerprints[0].frame_index === 0 &&
        imagelessPersistence.isComplete === false &&
        imagelessPersistence.reference.status === 'PROCESSING' &&
        imagelessPersistence.reference.extraction_status === 'PARTIAL',
      `19.10: persistAndVerifyReferenceExtraction refuses to save image-less fingerprints independently (saved ${imagelessPersistence.fingerprints.length} verified frame, skipped unverified frame #1, status=${imagelessPersistence.reference.status}/${imagelessPersistence.reference.extraction_status})`
    );
  } finally {
    for (const tp of createdThumbPaths19) {
      try {
        if (fs.existsSync(tp)) fs.unlinkSync(tp);
      } catch {}
    }
    try {
      fs.rmSync(test19TempDir, { recursive: true, force: true });
    } catch {}
  }

  // -------------------------------------------------------------
  // Test Group 20: API JSON Routing, HTML Fallback Guard, YouTube Watch-Page Inspection & All 3 Registration Modes E2E
  // -------------------------------------------------------------
  console.log('\n[Test Group 20] API JSON Routing, HTML Fallback Prevention, YouTube Watch-Page Handling & 3 Registration Modes E2E');

  const http20 = await import('node:http');
  const express20 = (await import('express')).default;
  const apiRouter20 = (await import('../routes.js')).default;
  const { formatNonJsonApiError } = await import('../../api.js');

  const validMasterVideo20 = [
    path.resolve(process.cwd(), 'data', 'media', 'apex_horizon_master.mp4'),
    path.resolve(process.cwd(), 'data', 'media', 'taylor_swift_soap2day_mirror.mp4')
  ].find(p => fs.existsSync(p) && fs.statSync(p).size > 10000)!;

  let fixtureOrigin20 = '';
  const fixtureServer20 = http20.createServer((req, res) => {
    const reqUrl = req.url || '/';
    if (reqUrl === '/media/valid_stream.mp4') {
      const stat = fs.statSync(validMasterVideo20);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(stat.size)
      });
      fs.createReadStream(validMasterVideo20).pipe(res);
      return;
    }
    if (reqUrl === '/media/invalid_corrupted.mp4') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': '512'
      });
      res.end(Buffer.alloc(512, 0x55));
      return;
    }
    if (reqUrl === '/ott/valid-watch-page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Official OTT Watch Page — Episode 1</title><meta property="og:title" content="Official OTT Watch Page — Episode 1" /><meta property="og:site_name" content="PremierOTT" /></head><body><iframe src="https://www.youtube.com/embed/RJFGcXQLDYg"></iframe></body></html>`);
      return;
    }
    if (reqUrl?.startsWith('/watch?v=validYtTest11')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Sample YouTube Broadcast Clip - YouTube</title><meta property="og:title" content="Sample YouTube Broadcast Clip" /><meta property="og:site_name" content="YouTube" /></head><body><script>var ytInitialPlayerResponse = {"streamingData":{"adaptiveFormats":[{"mimeType":"video/mp4; codecs=\\"avc1.4d401f\\"","drmFamilies":["WIDEVINE"]}]}};</script></body></html>`);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>404 Not Found</title></head><body>Not Found</body></html>');
  });

  await new Promise<void>(resolve => fixtureServer20.listen(0, '127.0.0.1', () => resolve()));
  const fixturePort20 = (fixtureServer20.address() as { port: number }).port;
  fixtureOrigin20 = `http://127.0.0.1:${fixturePort20}`;
  process.env.SPECTRA_TEST_ALLOWED_ORIGIN = fixtureOrigin20;

  // Mount full Express app mirroring server.ts (including /api, /api/api, JSON 404 guard, and SPA HTML fallback for non-API routes)
  const app20 = express20();
  app20.use(express20.json({ limit: '500mb' }));
  app20.use(express20.urlencoded({ limit: '500mb', extended: true }));
  app20.use('/api/api', apiRouter20);
  app20.use('/api', apiRouter20);
  app20.all(['/api', '/api/*'], (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });
  app20.get('*', (req, res) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
    }
    res.status(200).send('<!doctype html><html><head><title>SPECTRA SPA</title></head><body><div id="root"></div></body></html>');
  });

  const apiServer20 = http20.createServer(app20);
  await new Promise<void>(resolve => apiServer20.listen(0, '127.0.0.1', () => resolve()));
  const apiPort20 = (apiServer20.address() as { port: number }).port;
  const apiBase20 = `http://127.0.0.1:${apiPort20}/api`;
  const createdRefIds20: string[] = [];

  try {
    // 20.1: Verify API routes NEVER return SPA HTML fallback (<!doctype html>), even for unknown /api/* endpoints
    const unknownApiGet = await fetch(`${apiBase20}/non-existent-endpoint`);
    const unknownApiGetText = await unknownApiGet.text();
    const unknownApiPost = await fetch(`${apiBase20}/references/non-existent-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const unknownApiPostText = await unknownApiPost.text();

    let unknownGetJson: any = null;
    let unknownPostJson: any = null;
    try { unknownGetJson = JSON.parse(unknownApiGetText); } catch {}
    try { unknownPostJson = JSON.parse(unknownApiPostText); } catch {}

    assert(
      unknownApiGet.status === 404 &&
        unknownApiPost.status === 404 &&
        Boolean(unknownGetJson?.error) &&
        Boolean(unknownPostJson?.error) &&
        !unknownApiGetText.toLowerCase().includes('<!doctype html>') &&
        !unknownApiPostText.toLowerCase().includes('<!doctype html>'),
      '20.1: Unhandled /api/* GET and POST requests consistently return HTTP 404 JSON and never fall through to the frontend <!doctype html> SPA fallback'
    );

    // 20.2: Verify frontend error formatter identifies the failing endpoint & diagnostic cause instead of dumping raw <!doctype html>
    const warmupDiag = formatNonJsonApiError(
      200,
      '<!doctype html><html><head><title>Starting Server...</title></head><body>Starting...</body></html>',
      { method: 'POST', endpoint: '/api/references/inspect-url' }
    );
    const spaFallbackDiag = formatNonJsonApiError(
      200,
      '<!doctype html><html lang="en"><head><title>SPECTRA — Anti-Piracy Platform</title></head><body></body></html>',
      { method: 'POST', endpoint: '/api/references' }
    );

    assert(
      warmupDiag.includes('POST /api/references/inspect-url') &&
        warmupDiag.includes('Starting Server...') &&
        !warmupDiag.includes('<!doctype html') &&
        spaFallbackDiag.includes('POST /api/references') &&
        spaFallbackDiag.includes('unexpected HTML document') &&
        !spaFallbackDiag.includes('<!doctype html'),
      '20.2: Frontend error handler identifies the exact failing endpoint (METHOD /path) and diagnostic cause without dumping raw <!doctype html>'
    );

    // 20.3: Verify YouTube watch-page URLs are treated as webpage/player URLs requiring inspection, NOT direct MP4/HLS streams
    const ytWatchUrl = `${fixtureOrigin20}/watch?v=validYtTest11`;
    const ytProbe = await FingerprintEngine.probeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    let ytExtractRejectedAsWebpage = false;
    try {
      await FingerprintEngine.extractVideoFingerprints('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
        isCandidate: false
      });
    } catch (err: any) {
      ytExtractRejectedAsWebpage = err?.code === 'WEBPAGE_REQUIRES_INSPECTION';
    }

    const ytInspectRes = await fetch(`${apiBase20}/references/inspect-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: ytWatchUrl })
    });
    const ytInspectJson: any = await ytInspectRes.json();

    // Submitting a YouTube watch-page URL in Direct Stream URL mode (registrationMode='url', requireDirectMedia=true) must NOT assume it is a direct stream or create an incomplete record
    const refCountBeforeYtDirect = db.getReferences().length;
    const ytDirectRegRes = await fetch(`${apiBase20}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'url',
        requireDirectMedia: true,
        title: 'YouTube Watch URL Direct Stream Attempt',
        rightsHolder: 'Rights Corp',
        assetType: 'VOD_FEATURE',
        sourceUrl: ytWatchUrl,
        sampleInterval: 2
      })
    });
    const ytDirectRegJson: any = await ytDirectRegRes.json();
    const refCountAfterYtDirect = db.getReferences().length;

    assert(
      ytProbe.duration_sec === 0 &&
        ytProbe.codec === 'youtube-webpage' &&
        ytExtractRejectedAsWebpage &&
        ytInspectRes.status === 200 &&
        ytInspectJson.data?.urlClassification === 'WEBPAGE_WITH_EMBEDDED_PLAYER' &&
        ytInspectJson.data?.isWebpage === true &&
        ytInspectJson.data?.directMediaAvailable === false &&
        ytInspectJson.data?.detectedPlayerProvider === 'YouTube Web Player' &&
        ytDirectRegRes.status === 422 &&
        ytDirectRegJson.mediaAcquired === false &&
        ytDirectRegJson.inspection?.urlClassification === 'WEBPAGE_WITH_EMBEDDED_PLAYER' &&
        refCountAfterYtDirect === refCountBeforeYtDirect,
      '20.3: YouTube watch-page URLs are classified as WEBPAGE_WITH_EMBEDDED_PLAYER (YouTube Web Player, isWebpage=true, directMediaAvailable=false), never assumed to be direct MP4/HLS streams, and never create incomplete records on direct-stream submission'
    );

    // 20.4: Mode 1 — Master File Upload E2E (/api/uploads/init -> /api/uploads/chunk -> /api/uploads/complete)
    const masterBuf = fs.readFileSync(validMasterVideo20);
    const initUploadRes = await fetch(`${apiBase20}/uploads/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'e2e_master_upload_test.mp4',
        fileSize: masterBuf.length,
        mimeType: 'video/mp4',
        title: 'Mode 1 E2E — Master File Upload Reference',
        rightsHolder: 'SPECTRA Studio Rights',
        assetType: 'VOD_FEATURE',
        sampleInterval: 2
      })
    });
    const initUploadJson: any = await initUploadRes.json();
    const uploadId20 = initUploadJson.data?.uploadId;

    const chunkForm = new FormData();
    chunkForm.append('uploadId', uploadId20);
    chunkForm.append('chunkIndex', '0');
    chunkForm.append('totalChunks', '1');
    chunkForm.append('chunk', new Blob([masterBuf]), 'chunk_0');
    const chunkUploadRes = await fetch(`${apiBase20}/uploads/chunk`, {
      method: 'POST',
      body: chunkForm
    });
    const chunkUploadJson: any = await chunkUploadRes.json();

    const completeUploadRes = await fetch(`${apiBase20}/uploads/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: uploadId20 })
    });
    const completeUploadJson: any = await completeUploadRes.json();
    const uploadedRef = completeUploadJson.data;
    if (uploadedRef?.id) createdRefIds20.push(uploadedRef.id);

    // Also verify Mode 1 rejects corrupted/non-video uploads with HTTP 422 JSON without creating incomplete records
    const refsBeforeCorruptUpload = db.getReferences().length;
    const corruptUploadBuf = Buffer.alloc(1024, 0x42);
    const initCorruptUploadRes = await fetch(`${apiBase20}/uploads/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'corrupt_non_video.mp4',
        fileSize: corruptUploadBuf.length,
        title: 'Mode 1 E2E — Corrupted Upload',
        rightsHolder: 'SPECTRA Studio Rights',
        assetType: 'VOD_FEATURE',
        sampleInterval: 2
      })
    });
    const initCorruptUploadJson: any = await initCorruptUploadRes.json();
    const corruptChunkForm = new FormData();
    corruptChunkForm.append('uploadId', initCorruptUploadJson.uploadId);
    corruptChunkForm.append('chunkIndex', '0');
    corruptChunkForm.append('totalChunks', '1');
    corruptChunkForm.append('chunk', new Blob([corruptUploadBuf]), 'chunk_0');
    await fetch(`${apiBase20}/uploads/chunk`, {
      method: 'POST',
      body: corruptChunkForm
    });
    const completeCorruptUploadRes = await fetch(`${apiBase20}/uploads/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: initCorruptUploadJson.uploadId })
    });
    const completeCorruptUploadJson: any = await completeCorruptUploadRes.json();
    const refsAfterCorruptUpload = db.getReferences().length;

    assert(
      initUploadRes.status === 200 &&
        chunkUploadRes.status === 200 &&
        chunkUploadJson.success === true &&
        completeUploadRes.status === 201 &&
        uploadedRef?.status === 'FINGERPRINTED' &&
        uploadedRef?.extraction_status === 'COMPLETE' &&
        uploadedRef?.fingerprint_count > 0 &&
        uploadedRef?.retrievable_frame_image_count === uploadedRef?.expected_frame_count &&
        uploadedRef?.missing_frame_image_count === 0 &&
        completeCorruptUploadRes.status === 422 &&
        completeCorruptUploadJson.acquisitionStatus === 'INVALID_MEDIA_CONTAINER' &&
        refsAfterCorruptUpload === refsBeforeCorruptUpload,
      `20.4: Mode 1 (Master File Upload) E2E succeeds with valid JSON across init/chunk/complete (${uploadedRef?.retrievable_frame_image_count}/${uploadedRef?.expected_frame_count} verified JPEG frames) and rejects corrupted uploads (HTTP 422 JSON) without creating incomplete records`
    );

    // 20.5: Mode 2 — OTT Webpage URL E2E (valid webpage vs. inaccessible 404 URL)
    const ottValidRes = await fetch(`${apiBase20}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'ott',
        title: 'Mode 2 E2E — Valid OTT Watch Page',
        rightsHolder: 'PremierOTT Networks',
        assetType: 'EPISODIC',
        seasonEpisodeInfo: 'S01E01',
        initialStatus: 'AWAITING_AUTHORIZED_MEDIA',
        sourceUrl: `${fixtureOrigin20}/ott/valid-watch-page`,
        sampleInterval: 2
      })
    });
    const ottValidJson: any = await ottValidRes.json();
    if (ottValidJson.data?.id) createdRefIds20.push(ottValidJson.data.id);

    const refsBeforeOtt404 = db.getReferences().length;
    const ottInaccessibleRes = await fetch(`${apiBase20}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'ott',
        title: 'Mode 2 E2E — Inaccessible OTT URL',
        rightsHolder: 'PremierOTT Networks',
        assetType: 'EPISODIC',
        initialStatus: 'AWAITING_AUTHORIZED_MEDIA',
        sourceUrl: `${fixtureOrigin20}/ott/non-existent-404-page`,
        sampleInterval: 2
      })
    });
    const ottInaccessibleJson: any = await ottInaccessibleRes.json();
    const refsAfterOtt404 = db.getReferences().length;

    assert(
      ottValidRes.status === 201 &&
        ottValidJson.ottMetadataRegistered === true &&
        ottValidJson.data?.status === 'AWAITING_AUTHORIZED_MEDIA' &&
        ottValidJson.data?.fingerprint_count === 0 &&
        ottInaccessibleRes.status === 422 &&
        ottInaccessibleJson.inspection?.urlClassification === 'UNREACHABLE' &&
        refsAfterOtt404 === refsBeforeOtt404,
      '20.5: Mode 2 (OTT Webpage URL) registers valid watch pages as AWAITING_AUTHORIZED_MEDIA and rejects inaccessible 404 URLs (HTTP 422 JSON) without creating incomplete records'
    );

    // 20.6: Mode 3 — Direct Stream URL E2E (valid direct MP4 stream vs. inaccessible 404 URL vs. invalid/corrupted media response)
    const directValidRes = await fetch(`${apiBase20}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'url',
        requireDirectMedia: true,
        title: 'Mode 3 E2E — Direct Stream Valid MP4',
        rightsHolder: 'SPECTRA Broadcast Corp',
        assetType: 'LIVE_SPORTS',
        sourceUrl: `${fixtureOrigin20}/media/valid_stream.mp4`,
        sampleInterval: 2
      })
    });
    const directValidJson: any = await directValidRes.json();
    const directValidRef = directValidJson.data;
    if (directValidRef?.id) createdRefIds20.push(directValidRef.id);

    const refsBeforeDirectFail = db.getReferences().length;
    const direct404Res = await fetch(`${apiBase20}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'url',
        requireDirectMedia: true,
        title: 'Mode 3 E2E — Inaccessible Direct Stream',
        rightsHolder: 'SPECTRA Broadcast Corp',
        assetType: 'LIVE_SPORTS',
        sourceUrl: `${fixtureOrigin20}/media/missing_404_stream.mp4`,
        sampleInterval: 2
      })
    });
    const direct404Json: any = await direct404Res.json();

    const directCorruptRes = await fetch(`${apiBase20}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'url',
        requireDirectMedia: true,
        title: 'Mode 3 E2E — Corrupted Media Response',
        rightsHolder: 'SPECTRA Broadcast Corp',
        assetType: 'LIVE_SPORTS',
        sourceUrl: `${fixtureOrigin20}/media/invalid_corrupted.mp4`,
        sampleInterval: 2
      })
    });
    const directCorruptJson: any = await directCorruptRes.json();
    const refsAfterDirectFail = db.getReferences().length;

    assert(
      directValidRes.status === 201 &&
        directValidRef?.status === 'FINGERPRINTED' &&
        directValidRef?.extraction_status === 'COMPLETE' &&
        directValidRef?.fingerprint_count > 0 &&
        directValidRef?.retrievable_frame_image_count === directValidRef?.expected_frame_count &&
        direct404Res.status === 422 &&
        direct404Json.mediaAcquired === false &&
        directCorruptRes.status === 422 &&
        directCorruptJson.acquisitionStatus === 'INVALID_MEDIA_CONTAINER' &&
        refsAfterDirectFail === refsBeforeDirectFail,
      `20.6: Mode 3 (Direct Stream URL) extracts ${directValidRef?.retrievable_frame_image_count}/${directValidRef?.expected_frame_count} frames for valid streams and rejects inaccessible (404) or invalid/corrupted media (HTTP 422 JSON) without creating incomplete records`
    );

    // 20.7: Verify failed URL inspections and failed media attachments never corrupt existing fingerprinted references
    const inspectFailOnExistingRes = await fetch(`${apiBase20}/references/${directValidRef.id}/inspect-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${fixtureOrigin20}/media/missing_404_stream.mp4` })
    });
    const inspectFailOnExistingJson: any = await inspectFailOnExistingRes.json();
    const afterFailedInspectExisting = db.getReferenceById(directValidRef.id)!;
    const afterFailedInspectFps = db.getReferenceFingerprints(directValidRef.id);

    assert(
      inspectFailOnExistingRes.status === 200 &&
        inspectFailOnExistingJson.data?.urlClassification === 'UNREACHABLE' &&
        afterFailedInspectExisting.status === 'FINGERPRINTED' &&
        afterFailedInspectExisting.source_url === `${fixtureOrigin20}/media/valid_stream.mp4` &&
        afterFailedInspectExisting.media_url === `${fixtureOrigin20}/media/valid_stream.mp4` &&
        afterFailedInspectFps.length === directValidRef.fingerprint_count,
      '20.7: Failed URL inspection on an existing fingerprinted reference preserves its status, URLs, and fingerprints without corruption'
    );
  } finally {
    for (const rid of createdRefIds20) {
      try {
        const r = db.getReferenceById(rid);
        if (r?.file_path && (r.file_path.includes('url_ref_') || r.file_path.includes('upl_')) && fs.existsSync(r.file_path)) {
          fs.unlinkSync(r.file_path);
        }
        db.deleteReference(rid);
      } catch {}
    }
    await new Promise<void>(resolve => apiServer20.close(() => resolve()));
    await new Promise<void>(resolve => fixtureServer20.close(() => resolve()));
  }

  // -------------------------------------------------------------
  // Test Group 21: Configurable Source-Adapter System, Automated Multi-Platform Media Acquisition, Resumable Downloads, HLS/DASH & 8-Stage Workflow
  // -------------------------------------------------------------
  console.log('\n[Test Group 21] Configurable Source-Adapter System, Automated Multi-Platform Media Acquisition, Resumable Downloads & 8-Stage Workflow');

  const test21TempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-test21-'));
  const hlsPlaylistPath21 = path.join(test21TempDir, 'live_stream.m3u8');
  const hlsSegPattern21 = path.join(test21TempDir, 'seg_%03d.ts');
  const { execFileSync: execFileSync21 } = await import('node:child_process');
  execFileSync21('ffmpeg', [
    '-y',
    '-i',
    validMasterVideo20,
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-f',
    'hls',
    '-hls_time',
    '2',
    '-hls_list_size',
    '0',
    '-hls_segment_filename',
    hlsSegPattern21,
    hlsPlaylistPath21
  ], { stdio: 'ignore' });

  let fixtureOrigin21 = '';
  let rangeHeaderReceivedCount21 = 0;
  const fixtureServer21 = http20.createServer((req, res) => {
    const reqUrl = req.url || '/';

    // Direct MP4 with HTTP Range (206 Partial Content) support
    if (reqUrl.startsWith('/media/authorized_master.mp4') || reqUrl.startsWith('/media/resumable_test.mp4')) {
      const stat = fs.statSync(validMasterVideo20);
      const rangeHeader = req.headers.range;
      if (rangeHeader && /^bytes=(\d+)-/i.test(rangeHeader)) {
        rangeHeaderReceivedCount21++;
        const startByte = parseInt(rangeHeader.match(/^bytes=(\d+)-/i)![1], 10);
        if (startByte > 0 && startByte < stat.size) {
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${startByte}-${stat.size - 1}/${stat.size}`,
            'Content-Length': String(stat.size - startByte)
          });
          fs.createReadStream(validMasterVideo20, { start: startByte }).pipe(res);
          return;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(stat.size)
      });
      fs.createReadStream(validMasterVideo20).pipe(res);
      return;
    }

    // YouTube watch page exposing an authorized/unencrypted progressive MP4 stream in ytInitialPlayerResponse.streamingData.formats
    if (reqUrl.startsWith('/youtube.com/watch?v=ytAuthVideo01')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Official Studio Trailer (4K) - YouTube</title><meta property="og:title" content="Official Studio Trailer (4K)" /><meta property="og:site_name" content="YouTube" /></head><body><script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"ytAuthVideo01","title":"Official Studio Trailer (4K)","lengthSeconds":"6","author":"SPECTRA Official Channel"},"streamingData":{"formats":[{"itag":22,"mimeType":"video/mp4; codecs=\\"avc1.64001F, mp4a.40.2\\"","url":"${fixtureOrigin21}/media/authorized_master.mp4?src=yt"}]}};</script></body></html>`);
      return;
    }

    // Vimeo video page exposing progressive MP4 in request.files.progressive
    if (reqUrl.startsWith('/vimeo.com/987654321')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Vimeo Authorized Short Film on Vimeo</title><meta property="og:title" content="Vimeo Authorized Short Film" /><meta property="og:site_name" content="Vimeo" /><meta property="video:duration" content="6" /></head><body><script>window.playerConfig = {"video":{"id":987654321,"title":"Vimeo Authorized Short Film","duration":6},"request":{"files":{"progressive":[{"profile":"1080p","mime":"video/mp4","url":"${fixtureOrigin21}/media/authorized_master.mp4?src=vimeo"}]}}};</script></body></html>`);
      return;
    }

    // Dailymotion video page exposing MP4 stream in qualities
    if (reqUrl.startsWith('/dailymotion.com/video/x8abcde')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Dailymotion Broadcaster Highlight S01E02 - Dailymotion</title><meta property="og:title" content="Dailymotion Broadcaster Highlight S01E02" /><meta property="og:site_name" content="Dailymotion" /></head><body><script>var __PLAYER_CONFIG__ = {"metadata":{"title":"Dailymotion Broadcaster Highlight S01E02","duration":6,"qualities":{"720":[{"type":"video/mp4","url":"${fixtureOrigin21}/media/authorized_master.mp4?src=dm"}]}}};</script></body></html>`);
      return;
    }

    // Public Video Platform / Internet Archive page exposing downloadable MP4 link & JSON-LD
    if (reqUrl.startsWith('/archive.org/details/public_domain_cinema_01')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Public Archive Cinema Master : Internet Archive</title><meta property="og:title" content="Public Archive Cinema Master" /><meta property="og:site_name" content="Internet Archive" /><script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Public Archive Cinema Master","duration":"PT6S","contentUrl":"${fixtureOrigin21}/media/authorized_master.mp4?src=archive"}</script></head><body><a href="${fixtureOrigin21}/media/authorized_master.mp4?src=archive">Download MPEG4</a></body></html>`);
      return;
    }

    // HLS .m3u8 playlist and .ts segments
    if (reqUrl === '/hls/live_stream.m3u8') {
      const playlistText = fs.readFileSync(hlsPlaylistPath21, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(playlistText);
      return;
    }
    if (reqUrl.startsWith('/hls/seg_') && reqUrl.endsWith('.ts')) {
      const segName = path.basename(reqUrl);
      const segFile = path.join(test21TempDir, segName);
      if (fs.existsSync(segFile)) {
        res.writeHead(200, { 'Content-Type': 'video/mp2t' });
        fs.createReadStream(segFile).pipe(res);
        return;
      }
    }

    // Unencrypted MPEG-DASH .mpd manifest with <BaseURL> pointing to authorized MP4
    if (reqUrl === '/dash/open_stream.mpd') {
      res.writeHead(200, { 'Content-Type': 'application/dash+xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT6S"><Period><AdaptationSet mimeType="video/mp4"><Representation id="1080p" bandwidth="4000000"><BaseURL>${fixtureOrigin21}/media/authorized_master.mp4?src=dash</BaseURL></Representation></AdaptationSet></Period></MPD>`);
      return;
    }

    // CENC/Widevine DRM MPEG-DASH .mpd manifest
    if (reqUrl === '/dash/drm_protected.mpd') {
      res.writeHead(200, { 'Content-Type': 'application/dash+xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT120S"><Period><AdaptationSet mimeType="video/mp4"><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" cenc:default_KID="12345678-1234-1234-1234-1234567890ab"/><Representation id="1080p"><BaseURL>${fixtureOrigin21}/media/authorized_master.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`);
      return;
    }

    // YouTube watch page with ciphered/gated playback (no unencrypted progressive stream in HTML)
    if (reqUrl.startsWith('/youtube.com/watch?v=ytCipherGated99')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>Protected Live Concert — Official Channel - YouTube</title><meta property="og:title" content="Protected Live Concert — Official Channel" /><meta property="og:site_name" content="YouTube" /></head><body><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},"videoDetails":{"videoId":"ytCipherGated99","title":"Protected Live Concert — Official Channel","lengthSeconds":"6","author":"Official Music Label"},"streamingData":{"formats":[{"itag":18,"mimeType":"video/mp4","signatureCipher":"s=encrypted_sig&url=https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback"}]}};</script></body></html>`);
      return;
    }

    // Authorized partner feed endpoint for YouTube videoId
    if (reqUrl.startsWith('/partner-feed/ytCipherGated99.mp4')) {
      const stat = fs.statSync(validMasterVideo20);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(stat.size)
      });
      fs.createReadStream(validMasterVideo20).pipe(res);
      return;
    }

    // Wikimedia Commons file page + MediaWiki imageinfo API
    if (reqUrl.startsWith('/commons.wikimedia.org/wiki/File:Commons_Test_Clip.mp4')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><title>File:Commons Test Clip.mp4 - Wikimedia Commons</title><meta property="og:title" content="File:Commons Test Clip.mp4" /><meta property="og:site_name" content="Wikimedia Commons" /></head><body><video src="${fixtureOrigin21}/media/authorized_master.mp4?src=wikimedia"></video></body></html>`);
      return;
    }

    if (reqUrl.startsWith('/w/api.php') && reqUrl.includes('File%3ACommons_Test_Clip.mp4')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          query: {
            pages: {
              '12345': {
                pageid: 12345,
                title: 'File:Commons Test Clip.mp4',
                imageinfo: [
                  {
                    url: `${fixtureOrigin21}/media/authorized_master.mp4?src=wikimedia_api`,
                    duration: 6,
                    mime: 'video/mp4',
                    mediatype: 'VIDEO'
                  }
                ]
              }
            }
          }
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>(resolve => fixtureServer21.listen(0, '127.0.0.1', () => resolve()));
  const fixturePort21 = (fixtureServer21.address() as { port: number }).port;
  fixtureOrigin21 = `http://127.0.0.1:${fixturePort21}`;
  process.env.SPECTRA_TEST_ALLOWED_ORIGIN = fixtureOrigin21;

  const app21 = express20();
  app21.use(express20.json({ limit: '500mb' }));
  app21.use(express20.urlencoded({ limit: '500mb', extended: true }));
  app21.use('/api', apiRouter20);
  const apiServer21 = http20.createServer(app21);
  await new Promise<void>(resolve => apiServer21.listen(0, '127.0.0.1', () => resolve()));
  const apiPort21 = (apiServer21.address() as { port: number }).port;
  const apiBase21 = `http://127.0.0.1:${apiPort21}/api`;
  const createdRefIds21: string[] = [];

  try {
    // 21.1: Verify Configurable Source-Adapter System supports all 8 required source categories
    const adaptersRes = await fetch(`${apiBase21}/source-adapters`);
    const adaptersJson: any = await adaptersRes.json();
    const adapterList: any[] = adaptersJson.data || [];
    const adapterIds = new Set(adapterList.map(a => a.id));

    const toggleVimeoRes = await fetch(`${apiBase21}/source-adapters/VIMEO_ADAPTER`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supportsResumableDownload: true, enabled: true })
    });
    const toggleVimeoJson: any = await toggleVimeoRes.json();

    assert(
      adaptersRes.status === 200 &&
        adapterIds.has('YOUTUBE_ADAPTER') &&
        adapterIds.has('DAILYMOTION_ADAPTER') &&
        adapterIds.has('VIMEO_ADAPTER') &&
        adapterIds.has('PUBLIC_VIDEO_PLATFORM_ADAPTER') &&
        adapterIds.has('DIRECT_MEDIA_ADAPTER') &&
        adapterIds.has('HLS_STREAM_ADAPTER') &&
        adapterIds.has('DASH_STREAM_ADAPTER') &&
        adapterIds.has('AUTHORIZED_OTT_ADAPTER') &&
        toggleVimeoRes.status === 200 &&
        toggleVimeoJson.data?.id === 'VIMEO_ADAPTER' &&
        toggleVimeoJson.data?.enabled === true,
      `21.1: Source-Adapter Registry exposes and configures all 8 video source categories (${Array.from(adapterIds).join(', ')})`
    );

    // 21.2: Verify automatic media acquisition, FFprobe validation, full-video frame extraction (0s to end), JPEG persistence, and 8-stage workflow across YouTube, Vimeo, Dailymotion, and Public Video Platforms (Internet Archive)
    const platformSamples = [
      {
        label: 'YouTube (Authorized Progressive Stream)',
        url: `${fixtureOrigin21}/youtube.com/watch?v=ytAuthVideo01`,
        expectedAdapter: 'YOUTUBE_ADAPTER',
        mode: 'ott'
      },
      {
        label: 'Vimeo (Progressive Stream)',
        url: `${fixtureOrigin21}/vimeo.com/987654321`,
        expectedAdapter: 'VIMEO_ADAPTER',
        mode: 'url'
      },
      {
        label: 'Dailymotion (Progressive Stream)',
        url: `${fixtureOrigin21}/dailymotion.com/video/x8abcde`,
        expectedAdapter: 'DAILYMOTION_ADAPTER',
        mode: 'url'
      },
      {
        label: 'Internet Archive (Public Video Platform)',
        url: `${fixtureOrigin21}/archive.org/details/public_domain_cinema_01`,
        expectedAdapter: 'PUBLIC_VIDEO_PLATFORM_ADAPTER',
        mode: 'ott'
      }
    ];

    for (const sample of platformSamples) {
      const regRes = await fetch(`${apiBase21}/references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationMode: sample.mode,
          title: `Auto-Acquired ${sample.label}`,
          rightsHolder: 'SPECTRA Multi-Platform Verification',
          assetType: 'VOD_FEATURE',
          sourceUrl: sample.url,
          authorizationConfirmed: true,
          sampleInterval: 2
        })
      });
      const regJson: any = await regRes.json();
      const refData = regJson.data;
      if (refData?.id) createdRefIds21.push(refData.id);

      const wfStages: any[] = regJson.workflow?.stages || [];
      const all8Complete =
        wfStages.length === 8 &&
        wfStages.every((s: any) => s.status === 'COMPLETE') &&
        wfStages.map((s: any) => s.stage).join('->') ===
          'URL_SUBMITTED->SOURCE_IDENTIFIED->VIDEO_INSPECTED->MEDIA_ACQUIRED->MEDIA_VALIDATED->FRAME_EXTRACTION->FINGERPRINTING->COMPLETE';

      const detailRes = await fetch(`${apiBase21}/references/${refData?.id}`);
      const detailJson: any = await detailRes.json();
      const fps: any[] = detailJson.data?.fingerprints || [];
      const allJpegsVerified =
        fps.length > 0 &&
        fps.length === refData?.expected_frame_count &&
        fps.every(fp => {
          const diskFile = path.join(db.getThumbnailsDir(), path.basename(fp.thumbnail_url || ''));
          if (!fs.existsSync(diskFile)) return false;
          const b = fs.readFileSync(diskFile);
          return b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && /^[0-9a-f]{16}$/i.test(fp.phash_hex);
        });

      assert(
        regRes.status === 201 &&
          regJson.mediaAcquired === true &&
          refData?.status === 'FINGERPRINTED' &&
          refData?.extraction_status === 'COMPLETE' &&
          regJson.inspection?.sourceAdapter?.id === sample.expectedAdapter &&
          all8Complete &&
          allJpegsVerified,
        `21.2 (${sample.label}): Automatically identified ${sample.expectedAdapter}, acquired media, extracted ${fps.length}/${refData?.expected_frame_count} frames from 0s to end with verified JPEGs & 64-bit dHashes, and completed all 8 workflow stages`
      );
    }

    // 21.3: Verify HLS (.m3u8) and MPEG-DASH (.mpd) stream inspection, automatic acquisition, and CENC DRM gating
    const hlsRegRes = await fetch(`${apiBase21}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'url',
        title: 'HLS Live Stream Reference (.m3u8)',
        rightsHolder: 'SPECTRA Sports Network',
        assetType: 'LIVE_SPORTS',
        sourceUrl: `${fixtureOrigin21}/hls/live_stream.m3u8`,
        authorizationConfirmed: true,
        sampleInterval: 2
      })
    });
    const hlsRegJson: any = await hlsRegRes.json();
    if (hlsRegJson.data?.id) createdRefIds21.push(hlsRegJson.data.id);

    const dashOpenRegRes = await fetch(`${apiBase21}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'url',
        title: 'Open MPEG-DASH Manifest Reference (.mpd)',
        rightsHolder: 'SPECTRA Broadcast Corp',
        assetType: 'VOD_FEATURE',
        sourceUrl: `${fixtureOrigin21}/dash/open_stream.mpd`,
        authorizationConfirmed: true,
        sampleInterval: 2
      })
    });
    const dashOpenRegJson: any = await dashOpenRegRes.json();
    if (dashOpenRegJson.data?.id) createdRefIds21.push(dashOpenRegJson.data.id);

    const dashDrmInspectRes = await fetch(`${apiBase21}/references/inspect-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${fixtureOrigin21}/dash/drm_protected.mpd` })
    });
    const dashDrmInspectJson: any = await dashDrmInspectRes.json();

    assert(
      hlsRegRes.status === 201 &&
        hlsRegJson.mediaAcquired === true &&
        hlsRegJson.data?.status === 'FINGERPRINTED' &&
        hlsRegJson.data?.extraction_status === 'COMPLETE' &&
        hlsRegJson.data?.fingerprint_count > 0 &&
        hlsRegJson.inspection?.sourceAdapter?.id === 'HLS_STREAM_ADAPTER' &&
        dashOpenRegRes.status === 201 &&
        dashOpenRegJson.mediaAcquired === true &&
        dashOpenRegJson.data?.status === 'FINGERPRINTED' &&
        dashOpenRegJson.data?.extraction_status === 'COMPLETE' &&
        dashOpenRegJson.inspection?.sourceAdapter?.id === 'DASH_STREAM_ADAPTER' &&
        dashDrmInspectRes.status === 200 &&
        dashDrmInspectJson.data?.urlClassification === 'DRM_PROTECTED_WEBPAGE' &&
        dashDrmInspectJson.data?.canAcquireAuthorized === false,
      `21.3: HLS (.m3u8) and unencrypted MPEG-DASH (.mpd) streams are automatically acquired, remuxed/validated, and fingerprinted (${hlsRegJson.data?.fingerprint_count} & ${dashOpenRegJson.data?.fingerprint_count} frames), while CENC/Widevine DRM DASH manifests are gated as DRM_PROTECTED_WEBPAGE`
    );

    // 21.4: Verify resumable HTTP Range download (.part staging file -> 206 Partial Content), SHA-256 deduplication, and duplicate-free retry via POST /api/references/:id/acquire-media
    const resumableUrl21 = `${fixtureOrigin21}/media/resumable_test.mp4`;
    const stagingDir21 = path.resolve(process.cwd(), 'uploads', 'staging');
    if (!fs.existsSync(stagingDir21)) fs.mkdirSync(stagingDir21, { recursive: true });
    const urlHash21 = crypto.createHash('sha256').update(resumableUrl21).digest('hex').slice(0, 20);
    const partPath21 = path.join(stagingDir21, `dl_${urlHash21}.part`);
    // Pre-seed the first 4096 bytes of validMasterVideo20 as an interrupted .part file
    const fullMasterBytes21 = fs.readFileSync(validMasterVideo20);
    fs.writeFileSync(partPath21, fullMasterBytes21.subarray(0, 4096));

    // Create an AWAITING_AUTHORIZED_MEDIA reference first, then trigger POST /api/references/:id/acquire-media
    const awaitingRef21Id = `ref_awaiting_resume_${Date.now()}`;
    createdRefIds21.push(awaitingRef21Id);
    db.insertReference({
      id: awaitingRef21Id,
      title: 'Resumable Range Download & In-Place Acquisition Reference',
      rights_holder: 'SPECTRA Rights Group',
      asset_type: 'EPISODIC',
      season_episode_info: 'S02E05',
      platform: 'Public Video Platform',
      source_type: 'OTT_PAGE',
      source_url: resumableUrl21,
      duration_sec: 0,
      resolution: '1920x1080',
      fps: 24,
      codec: 'h264',
      created_at: new Date().toISOString(),
      status: 'AWAITING_AUTHORIZED_MEDIA',
      provenance_sha256: 'pending_acquisition_sha256',
      fingerprint_count: 0
    });

    const refsCountBeforeAcquire21 = db.getReferences().length;
    const rangeCountBefore21 = rangeHeaderReceivedCount21;
    const acquireInPlaceRes = await fetch(`${apiBase21}/references/${awaitingRef21Id}/acquire-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleInterval: 2, authorizationConfirmed: true })
    });
    const acquireInPlaceJson: any = await acquireInPlaceRes.json();
    const refsCountAfterAcquire21 = db.getReferences().length;

    // Also test direct SHA-256 deduplication on a second acquireAuthorizedReferenceMediaFromUrl call
    const dedupResult21 = await FingerprintEngine.acquireAuthorizedReferenceMediaFromUrl(resumableUrl21, {
      authorizationConfirmed: true
    });

    assert(
      acquireInPlaceRes.status === 200 &&
        rangeHeaderReceivedCount21 > rangeCountBefore21 &&
        !fs.existsSync(partPath21) &&
        refsCountAfterAcquire21 === refsCountBeforeAcquire21 &&
        acquireInPlaceJson.data?.id === awaitingRef21Id &&
        acquireInPlaceJson.data?.season_episode_info === 'S02E05' &&
        acquireInPlaceJson.data?.status === 'FINGERPRINTED' &&
        acquireInPlaceJson.data?.extraction_status === 'COMPLETE' &&
        acquireInPlaceJson.data?.retrievable_frame_image_count === acquireInPlaceJson.data?.expected_frame_count &&
        dedupResult21.deduplicatedExistingFile === true &&
        dedupResult21.sha256 === acquireInPlaceJson.data?.provenance_sha256,
      `21.4: Resumable HTTP Range download resumed from 4,096-byte .part file (HTTP 206), upgraded ${awaitingRef21Id} in-place to FINGERPRINTED without creating duplicate references, and deduplicated identical media via SHA-256 (${dedupResult21.sha256?.slice(0, 12)}…)`
    );

    // 21.5: Strict completion gate — inspecting a URL or registering a DRM-protected OTT webpage NEVER marks a reference FINGERPRINTED or COMPLETE
    const drmSonyRes = await fetch(`${apiBase21}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'ott',
        title: 'SonyLIV DRM Broadcast — Strict Gate Test',
        rightsHolder: 'Culver Max Entertainment',
        assetType: 'LIVE_SPORTS',
        sourceUrl: 'https://www.sonyliv.com/live-sport/strict-gate-match-1000999',
        sampleInterval: 2
      })
    });
    const drmSonyJson: any = await drmSonyRes.json();
    if (drmSonyJson.data?.id) createdRefIds21.push(drmSonyJson.data.id);

    assert(
      drmSonyRes.status === 201 &&
        drmSonyJson.mediaAcquired === false &&
        drmSonyJson.data?.status === 'AWAITING_AUTHORIZED_MEDIA' &&
        drmSonyJson.data?.extraction_status !== 'COMPLETE' &&
        drmSonyJson.workflow?.canAutoAcquire === false &&
        Boolean(drmSonyJson.workflow?.restrictionReason) &&
        Boolean(drmSonyJson.workflow?.recommendedAlternative),
      `21.5: DRM-protected OTT URLs (SonyLIV) are never falsely marked FINGERPRINTED or COMPLETE upon inspection/registration (status=${drmSonyJson.data?.status}, canAutoAcquire=${drmSonyJson.workflow?.canAutoAcquire})`
    );

    // 21.6: Verify URL-only submission (without manual title/rightsHolder) auto-resolves metadata and completes full-video fingerprinting
    const urlOnlyWikimediaRes = await fetch(`${apiBase21}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'url',
        sourceUrl: `${fixtureOrigin21}/commons.wikimedia.org/wiki/File:Commons_Test_Clip.mp4`,
        sampleInterval: 2
      })
    });
    const urlOnlyWikimediaJson: any = await urlOnlyWikimediaRes.json();
    if (urlOnlyWikimediaJson.data?.id) createdRefIds21.push(urlOnlyWikimediaJson.data.id);

    assert(
      urlOnlyWikimediaRes.status === 201 &&
        urlOnlyWikimediaJson.mediaAcquired === true &&
        urlOnlyWikimediaJson.data?.status === 'FINGERPRINTED' &&
        urlOnlyWikimediaJson.data?.extraction_status === 'COMPLETE' &&
        Boolean(urlOnlyWikimediaJson.data?.title) &&
        Boolean(urlOnlyWikimediaJson.data?.rights_holder) &&
        Array.isArray(urlOnlyWikimediaJson.attemptedMethods) &&
        urlOnlyWikimediaJson.attemptedMethods.length > 0,
      `21.6: URL-only submission auto-resolves title ("${urlOnlyWikimediaJson.data?.title}") & rights holder ("${urlOnlyWikimediaJson.data?.rights_holder}"), acquires media, and completes fingerprinting`
    );

    // 21.7: Verify YouTube cipher-gated watch page records attemptedMethods, registers for Discovery Sweeps, and upgrades to FINGERPRINTED via "Auto-Acquire & Process Video" when authorized partner feed is configured
    delete process.env.YOUTUBE_PARTNER_FEED_URL_TEMPLATE;
    const ytGatedRegRes = await fetch(`${apiBase21}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationMode: 'url',
        allowMetadataFallback: true,
        sourceUrl: `${fixtureOrigin21}/youtube.com/watch?v=ytCipherGated99`,
        sampleInterval: 2
      })
    });
    const ytGatedRegJson: any = await ytGatedRegRes.json();
    const ytGatedRefId = ytGatedRegJson.data?.id;
    if (ytGatedRefId) createdRefIds21.push(ytGatedRefId);

    const gatedMethods: any[] = ytGatedRegJson.attemptedMethods || ytGatedRegJson.workflow?.attemptedMethods || [];
    const hasRestrictedStreamMethod = gatedMethods.some(
      m => m.method === 'YOUTUBE_PROGRESSIVE_STREAM_ACQUISITION' && m.status === 'RESTRICTED'
    );
    const hasUnavailablePartnerMethod = gatedMethods.some(
      m => m.method === 'YOUTUBE_AUTHORIZED_PARTNER_FEED' && m.status === 'UNAVAILABLE'
    );

    // Now configure YOUTUBE_PARTNER_FEED_URL_TEMPLATE and trigger POST /api/references/:id/acquire-media ("Auto-Acquire & Process Video")
    process.env.YOUTUBE_PARTNER_FEED_URL_TEMPLATE = `${fixtureOrigin21}/partner-feed/{videoId}.mp4`;
    const ytPartnerAcquireRes = await fetch(`${apiBase21}/references/${ytGatedRefId}/acquire-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleInterval: 2, authorizationConfirmed: true })
    });
    const ytPartnerAcquireJson: any = await ytPartnerAcquireRes.json();
    delete process.env.YOUTUBE_PARTNER_FEED_URL_TEMPLATE;

    const partnerMethods: any[] = ytPartnerAcquireJson.attemptedMethods || ytPartnerAcquireJson.workflow?.attemptedMethods || [];
    const hasSuccessPartnerMethod = partnerMethods.some(
      m => m.method === 'YOUTUBE_AUTHORIZED_PARTNER_FEED' && m.status === 'SUCCESS'
    );

    assert(
      ytGatedRegRes.status === 201 &&
        ytGatedRegJson.mediaAcquired === false &&
        ytGatedRegJson.data?.status === 'AWAITING_AUTHORIZED_MEDIA' &&
        ytGatedRegJson.data?.title === 'Protected Live Concert — Official Channel' &&
        ytGatedRegJson.data?.rights_holder === 'Official Music Label' &&
        hasRestrictedStreamMethod &&
        hasUnavailablePartnerMethod &&
        ytPartnerAcquireRes.status === 200 &&
        ytPartnerAcquireJson.mediaAcquired === true &&
        ytPartnerAcquireJson.data?.status === 'FINGERPRINTED' &&
        ytPartnerAcquireJson.data?.extraction_status === 'COMPLETE' &&
        ytPartnerAcquireJson.data?.retrievable_frame_image_count === ytPartnerAcquireJson.data?.expected_frame_count &&
        hasSuccessPartnerMethod,
      `21.7: Cipher-gated YouTube URL logs attemptedMethods (RESTRICTED/UNAVAILABLE), preserves metadata for Discovery Sweeps, and upgrades to FINGERPRINTED (${ytPartnerAcquireJson.data?.retrievable_frame_image_count}/${ytPartnerAcquireJson.data?.expected_frame_count} frames) when Auto-Acquire executes authorized partner feed`
    );
  } finally {
    for (const rid of createdRefIds21) {
      try {
        const r = db.getReferenceById(rid);
        if (
          r?.file_path &&
          (r.file_path.includes('url_ref_') || r.file_path.includes('url_hls_') || r.file_path.includes('upl_')) &&
          fs.existsSync(r.file_path)
        ) {
          fs.unlinkSync(r.file_path);
        }
        db.deleteReference(rid);
      } catch {}
    }
    try {
      fs.rmSync(test21TempDir, { recursive: true, force: true });
    } catch {}
    await new Promise<void>(resolve => apiServer21.close(() => resolve()));
    await new Promise<void>(resolve => fixtureServer21.close(() => resolve()));
  }

  // -------------------------------------------------------------
  // Test Group 22: Reference Library Pollution Prevention, DB Environment Isolation & Candidate Filtering
  // -------------------------------------------------------------
  console.log('\n[Test Group 22] Reference Library Pollution Prevention, DB Environment Isolation & Candidate Filtering');

  const test22TempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-test22-'));
  try {
    // 22.1: Verify ARGUS_DB_PATH, SPECTRA_DB_PATH, and TEST_DB_PATH all isolate ArgusDatabase from the live DB
    const prevSpectraDbPath = process.env.SPECTRA_DB_PATH;
    const prevArgusDbPath = process.env.ARGUS_DB_PATH;
    const customArgusDbFile = path.join(test22TempDir, 'argus_env_isolated.db');
    delete process.env.SPECTRA_DB_PATH;
    process.env.ARGUS_DB_PATH = customArgusDbFile;

    const envIsolatedDb = new ArgusDatabase();
    const resolvedEnvDbPath = envIsolatedDb.getDbFilePath();
    envIsolatedDb.close();

    if (prevSpectraDbPath !== undefined) process.env.SPECTRA_DB_PATH = prevSpectraDbPath;
    else delete process.env.SPECTRA_DB_PATH;
    if (prevArgusDbPath !== undefined) process.env.ARGUS_DB_PATH = prevArgusDbPath;
    else delete process.env.ARGUS_DB_PATH;

    assert(
      resolvedEnvDbPath === path.resolve(customArgusDbFile) && resolvedEnvDbPath !== LIVE_DB_PATH,
      `22.1: ARGUS_DB_PATH environment variable isolates ArgusDatabase (${resolvedEnvDbPath}) and prevents test/CLI scripts from writing to live database`
    );

    // 22.2: Verify accidental CLI adapter verification records are purged on initialization while preserving user-registered references
    const purgeTestDbPath = path.join(test22TempDir, 'purge_accidental_test.db');
    const purgeDb1 = new ArgusDatabase(purgeTestDbPath);
    const genuineUserRefId = 'ref_22_genuine_user_asset';
    purgeDb1.insertReference({
      id: genuineUserRefId,
      title: 'Modern Family',
      rights_holder: 'Disney Entertainment',
      asset_type: 'EPISODIC',
      season_episode_info: 'Season 1 Episode 1 (S01E01) — Pilot',
      duration_sec: 1378,
      resolution: '1920x1080',
      fps: 24,
      codec: 'h264',
      source_type: 'UPLOAD',
      file_path: '/app/applet/uploads/upl_1793160894057_fddb48ae-Modern_Family_-_S01E01__O2TvSeries.Com_.mp4',
      created_at: new Date().toISOString(),
      status: 'FINGERPRINTED',
      provenance_sha256: 'user_sha256_mf',
      fingerprint_count: 277
    });
    // Simulate accidental CLI adapter test records
    for (const polluted of [
      { id: 'ref_1793372833942_0ulmq', title: 'Me at the zoo', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
      { id: 'ref_1793372831999_ig9uzq', title: 'The New Vimeo Player (You Know, For Videos)', url: 'https://vimeo.com/76979871' },
      { id: 'ref_1793372827941_2cl9e', title: 'Cat lapping water off ground in slow motion.gk', url: 'https://commons.wikimedia.org/wiki/File:Cat_lapping_water_off_ground_in_slow_motion.gk.webm' },
      { id: 'ref_1793372819547_g2ntiw', title: 'point-opinion : Center for Accessible Technology in Sign : Free Download, Borrow, and Streaming : Internet Archive', url: 'https://archive.org/details/point-opinionASL' },
      { id: 'ref_1793372797540_3io03e', title: 'Zelenskyy Calls for European Involvement in Ukraine-US-Russia Peace Talks', url: 'https://www.dailymotion.com/video/xbs9dle' }
    ]) {
      purgeDb1.insertReference({
        id: polluted.id,
        title: polluted.title,
        rights_holder: 'Test Adapter',
        asset_type: 'VOD_FEATURE',
        duration_sec: 10,
        resolution: '1280x720',
        fps: 24,
        codec: 'h264',
        source_type: 'OTT_PAGE',
        source_url: polluted.url,
        created_at: new Date().toISOString(),
        status: 'FINGERPRINTED',
        provenance_sha256: `sha_${polluted.id}`,
        fingerprint_count: 5
      });
    }
    const purgeResult22 = purgeDb1.purgeConfirmedSyntheticForensicSamples();
    const refsAfterPurge22 = purgeDb1.getReferences();
    purgeDb1.close();

    assert(
      purgeResult22.removedReferences.length === 5 &&
        refsAfterPurge22.length === 1 &&
        refsAfterPurge22[0].id === genuineUserRefId &&
        refsAfterPurge22[0].title === 'Modern Family',
      `22.2: Purges all 5 accidental adapter test records ("Me at the zoo", "The New Vimeo Player", Wikimedia cat clip, Internet Archive clip, Dailymotion news clip) while preserving genuine user-registered reference`
    );

    // 22.3: Verify Discovery Sweeps NEVER create Reference Library entries, reject generic platform test videos & unrelated content, and preserve relevant candidates with provenance
    const targetRef22Id = `ref_22_target_${Date.now()}`;
    db.insertReference({
      id: targetRef22Id,
      title: 'Taylor Swift — Patient Zero',
      rights_holder: 'Universal Music Group / Taylor Swift Productions',
      asset_type: 'VOD_FEATURE',
      duration_sec: 312,
      resolution: '1920x1080',
      fps: 24,
      codec: 'h264',
      source_type: 'UPLOAD',
      file_path: '/app/applet/uploads/upl_1793362994322_18ebe580-Taylor_Swift_-_Patient_Zero__Official_Music_Video_.mp4',
      created_at: new Date().toISOString(),
      status: 'FINGERPRINTED',
      provenance_sha256: 'ts_patient_zero_sha',
      fingerprint_count: 157
    });

    const refIdsBeforeSweep22 = new Set(db.getReferences().map(r => r.id));
    const sweepJob22 = await DiscoveryEngine.executeDiscoverySweep({
      jobName: 'Test 22 Candidate Filtering & Reference Library Isolation Sweep',
      provider: 'PUBLIC_PLATFORMS',
      targetReferenceId: targetRef22Id,
      queryKeywords: 'Taylor Swift Patient Zero',
      maxCandidates: 10,
      autoVerify: false,
      additionalDiscoveredItems: [
        {
          url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
          title: 'Me at the zoo',
          platform: 'YouTube',
          sourceCategory: 'YOUTUBE',
          assetKind: 'DISCOVERED_PAGE',
          suggestedType: 'HTML_PLAYER',
          domain: 'youtube.com',
          isLive: false,
          sourceType: 'title_search',
          referringPage: 'YouTube Public Search'
        },
        {
          url: 'https://vimeo.com/76979871',
          title: 'The New Vimeo Player (You Know, For Videos)',
          platform: 'Vimeo',
          sourceCategory: 'PUBLIC_PLATFORM',
          assetKind: 'DISCOVERED_PAGE',
          suggestedType: 'HTML_PLAYER',
          domain: 'vimeo.com',
          isLive: false,
          sourceType: 'title_search',
          referringPage: 'Vimeo Public Search'
        },
        {
          url: 'https://commons.wikimedia.org/wiki/File:Cat_lapping_water_off_ground_in_slow_motion.gk.webm',
          title: 'Cat lapping water off ground in slow motion.gk',
          platform: 'Wikimedia Commons',
          sourceCategory: 'PUBLIC_PLATFORM',
          assetKind: 'DISCOVERED_PAGE',
          suggestedType: 'WEBM',
          domain: 'commons.wikimedia.org',
          isLive: false,
          sourceType: 'title_search',
          referringPage: 'Wikimedia Search'
        },
        {
          url: 'https://archive.org/details/point-opinionASL',
          title: 'point-opinion : Center for Accessible Technology in Sign',
          platform: 'Internet Archive',
          sourceCategory: 'PUBLIC_PLATFORM',
          assetKind: 'DISCOVERED_PAGE',
          suggestedType: 'MP4',
          domain: 'archive.org',
          isLive: false,
          sourceType: 'title_search',
          referringPage: 'Internet Archive Search'
        },
        {
          url: 'https://www.dailymotion.com/video/xbs9dle',
          title: 'Zelenskyy Calls for European Involvement in Ukraine-US-Russia Peace Talks',
          platform: 'Dailymotion',
          sourceCategory: 'PUBLIC_PLATFORM',
          assetKind: 'DISCOVERED_PAGE',
          suggestedType: 'HTML_PLAYER',
          domain: 'dailymotion.com',
          isLive: false,
          sourceType: 'title_search',
          referringPage: 'Dailymotion API'
        },
        {
          url: 'https://www.dailymotion.com/video/x9ts_patient_zero_leak',
          title: 'Taylor Swift — Patient Zero (Official Music Video Full HD Leak)',
          platform: 'Dailymotion',
          sourceCategory: 'PUBLIC_PLATFORM',
          assetKind: 'DISCOVERED_PAGE',
          suggestedType: 'HTML_PLAYER',
          domain: 'dailymotion.com',
          isLive: false,
          sourceType: 'title_search',
          referringPage: 'Dailymotion API (Query: "Taylor Swift Patient Zero")',
          matchedKeywords: ['Taylor Swift Patient Zero']
        }
      ]
    });

    const refIdsAfterSweep22 = new Set(db.getReferences().map(r => r.id));
    const candidatesForTarget22 = db.getCandidates({ referenceId: targetRef22Id });
    const jobParams22 = JSON.parse(sweepJob22.query_params || '{}');
    const rejectedList22: any[] = jobParams22.rejectedCandidates || [];

    const hasPollutedCand = candidatesForTarget22.some(
      c =>
        c.source_url.includes('jNQXAC9IVRw') ||
        c.source_url.includes('vimeo.com/76979871') ||
        c.source_url.includes('Cat_lapping_water') ||
        c.source_url.includes('point-opinionASL') ||
        c.source_url.includes('xbs9dle')
    );
    const matchingRelevantCand = candidatesForTarget22.find(c =>
      c.source_url.includes('x9ts_patient_zero_leak')
    );

    assert(
      refIdsAfterSweep22.size === refIdsBeforeSweep22.size &&
        !hasPollutedCand &&
        rejectedList22.length >= 5 &&
        Boolean(matchingRelevantCand) &&
        matchingRelevantCand?.identity_relationship === 'EXACT_TARGET_MATCH' &&
        Boolean(matchingRelevantCand?.referring_page) &&
        Boolean(matchingRelevantCand?.candidate_research?.ranking_explanation),
      `22.3: Discovery Sweep creates 0 Reference Library entries, rejects all 5 generic/unrelated videos with recorded reasons (${rejectedList22.length} rejected), and promotes only target-relevant candidate ("${matchingRelevantCand?.discovered_title}") with full provenance`
    );

    db.deleteReference(targetRef22Id);
  } finally {
    try {
      fs.rmSync(test22TempDir, { recursive: true, force: true });
    } catch {}
  }

  // -------------------------------------------------------------
  // Test Group 23: Search Coverage & Discovery Intelligence
  // -------------------------------------------------------------
  console.log('\n[Test Group 23] Search Coverage & Discovery Intelligence (Presets, Prioritization, Caching & Coverage Telemetry)');

  // 23.1: Verify Discovery Limit Presets (Standard: 250, Deep: 500, Exhaustive: 1,000, Custom: 1–1,000) & Research/Comparison Limits
  const stdLimits = SearchCoverageEngine.resolveDiscoveryLimits({ presetMode: 'STANDARD' });
  const deepLimits = SearchCoverageEngine.resolveDiscoveryLimits({ presetMode: 'DEEP' });
  const exhLimits = SearchCoverageEngine.resolveDiscoveryLimits({ presetMode: 'EXHAUSTIVE' });
  const customLimits = SearchCoverageEngine.resolveDiscoveryLimits({
    presetMode: 'CUSTOM',
    maxUniqueCandidates: 750,
    deepResearchLimit: 400,
    forensicComparisonLimit: 250
  });
  const clampedLimits = SearchCoverageEngine.resolveDiscoveryLimits({
    presetMode: 'CUSTOM',
    maxUniqueCandidates: 2500,
    deepResearchLimit: 1500,
    forensicComparisonLimit: 1200
  });

  assert(
    stdLimits.preset_mode === 'STANDARD' &&
      stdLimits.max_unique_candidates === 250 &&
      stdLimits.deep_research_limit === 200 &&
      stdLimits.forensic_comparison_limit === 100 &&
      deepLimits.preset_mode === 'DEEP' &&
      deepLimits.max_unique_candidates === 500 &&
      exhLimits.preset_mode === 'EXHAUSTIVE' &&
      exhLimits.max_unique_candidates === 1000 &&
      customLimits.preset_mode === 'CUSTOM' &&
      customLimits.max_unique_candidates === 750 &&
      customLimits.deep_research_limit === 400 &&
      customLimits.forensic_comparison_limit === 250 &&
      clampedLimits.max_unique_candidates === 1000 &&
      clampedLimits.deep_research_limit === 1000 &&
      clampedLimits.forensic_comparison_limit === 1000,
    '23.1: Resolves Standard (250), Deep (500), Exhaustive (1,000), and Custom (1–1,000) candidate discovery presets with configurable deep research (default 200) and forensic comparison (default 100) limits'
  );

  // 23.2: Multi-source candidate deduplication, ranking prioritization, and deferred retention
  const ref23Id = `ref_23_coverage_${Date.now()}`;
  db.insertReference({
    id: ref23Id,
    title: 'Modern Family',
    rights_holder: 'Disney Entertainment',
    asset_type: 'EPISODIC',
    season_episode_info: 'Season 1 Episode 1 (S01E01) — Pilot',
    duration_sec: 1378,
    resolution: '1920x1080',
    fps: 24,
    codec: 'h264',
    source_type: 'UPLOAD',
    file_path: '/app/applet/uploads/upl_1793160894057_fddb48ae-Modern_Family_-_S01E01__O2TvSeries.Com_.mp4',
    created_at: new Date().toISOString(),
    status: 'FINGERPRINTED',
    provenance_sha256: 'sha256_ref23_modern_family',
    fingerprint_count: 10
  });

  // Create 8 discovered items including 2 duplicate URLs across different sources + 1 irrelevant video
  const rawDiscoveredBatch23: any[] = [
    {
      url: 'https://www.dailymotion.com/video/x9mf_s01e01_full',
      title: 'Modern Family S01E01 Pilot Full Episode HD',
      platform: 'Dailymotion',
      sourceCategory: 'PUBLIC_PLATFORM',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'HTML_PLAYER',
      domain: 'dailymotion.com',
      isLive: false,
      sourceType: 'title_search',
      referringPage: 'Dailymotion Public API (Query: "Modern Family S01E01")',
      matchedKeywords: ['Modern Family S01E01'],
      durationSec: 1378
    },
    // Duplicate of item 1 discovered via Web Search Crawler -> must merge provenance & count as 1 unique candidate
    {
      url: 'https://www.dailymotion.com/video/x9mf_s01e01_full',
      title: 'Modern Family S01E01 Pilot Full Episode HD',
      platform: 'Dailymotion',
      sourceCategory: 'SEARCH_ENGINE',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'HTML_PLAYER',
      domain: 'dailymotion.com',
      isLive: false,
      sourceType: 'keyword_variation',
      referringPage: 'DuckDuckGo Web Index',
      matchedKeywords: ['Modern Family S01E01 HD']
    },
    {
      url: 'https://o2tvseries4u.com/Modern-Family-8/Season-01/Episode-01',
      title: 'Modern Family - Season 01 - Episode 01 [Mp4 Download]',
      platform: 'O2TvSeries4u',
      sourceCategory: 'SUSPECTED_PIRACY',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'MP4',
      domain: 'o2tvseries4u.com',
      isLive: false,
      sourceType: 'configured_website',
      referringPage: 'https://o2tvseries4u.com/Modern-Family-8/Season-01/index.html',
      matchedKeywords: ['Modern Family Season 1 Episode 1'],
      durationSec: 1375
    },
    {
      url: 'https://www.youtube.com/watch?v=mfS01E01_clipA',
      title: 'Modern Family S01E01 Pilot Opening Scene HD',
      platform: 'YouTube',
      sourceCategory: 'YOUTUBE',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'HTML_PLAYER',
      domain: 'youtube.com',
      isLive: false,
      sourceType: 'title_search',
      referringPage: 'YouTube Search',
      matchedKeywords: ['Modern Family S01E01']
    },
    {
      url: 'https://vimeo.com/991122334',
      title: 'Modern Family Season 1 Episode 1 Pilot Screening Copy',
      platform: 'Vimeo',
      sourceCategory: 'PUBLIC_PLATFORM',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'HTML_PLAYER',
      domain: 'vimeo.com',
      isLive: false,
      sourceType: 'title_search',
      referringPage: 'Vimeo Public Search',
      matchedKeywords: ['Modern Family Season 1 Episode 1']
    },
    {
      url: 'https://archive.org/details/modern-family-s01e01-pilot-archive',
      title: 'Modern Family S01E01 Pilot Community Upload',
      platform: 'Internet Archive',
      sourceCategory: 'PUBLIC_PLATFORM',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'MP4',
      domain: 'archive.org',
      isLive: false,
      sourceType: 'title_search',
      referringPage: 'Internet Archive Search',
      matchedKeywords: ['Modern Family S01E01']
    },
    {
      url: 'https://reddit.com/r/television/comments/mf_s01e01_stream_mirror',
      title: 'Modern Family S01E01 Pilot Stream Mirror Discussion',
      platform: 'Reddit Video',
      sourceCategory: 'SEARCH_ENGINE',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'HTML_PLAYER',
      domain: 'reddit.com',
      isLive: false,
      sourceType: 'keyword_variation',
      referringPage: 'Web Search Index',
      matchedKeywords: ['Modern Family']
    },
    // Unrelated candidate that must be rejected and tracked in rejected_or_irrelevant
    {
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      title: 'Me at the zoo',
      platform: 'YouTube',
      sourceCategory: 'YOUTUBE',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'HTML_PLAYER',
      domain: 'youtube.com',
      isLive: false,
      sourceType: 'title_search',
      referringPage: 'YouTube Public Search'
    }
  ];

  // Execute sweep with custom limits: maxUniqueCandidates=10, deepResearchLimit=3, forensicComparisonLimit=2 (autoVerify=false so comparison stays queued)
  const job23 = await DiscoveryEngine.executeDiscoverySweep({
    jobName: 'Test 23 Prioritized Coverage Sweep',
    provider: 'PUBLIC_PLATFORMS',
    targetReferenceId: ref23Id,
    queryKeywords: 'Modern Family S01E01',
    presetMode: 'CUSTOM',
    maxUniqueCandidates: 10,
    deepResearchLimit: 3,
    forensicComparisonLimit: 2,
    autoVerify: false,
    additionalDiscoveredItems: rawDiscoveredBatch23
  });

  const cands23 = db.getCandidates({ referenceId: ref23Id });
  const researchedCands23 = cands23.filter(c => c.research_stage === 'RESEARCHED');
  const awaitingCands23 = cands23.filter(c => c.research_stage === 'AWAITING_RESEARCH');
  const dmMergedCand = cands23.find(c => c.source_url.includes('x9mf_s01e01_full'));
  const dmProvenanceCount = dmMergedCand?.discovery_provenance?.source_types?.length || 0;

  assert(
    cands23.length >= 6 &&
      researchedCands23.length === 3 &&
      awaitingCands23.length >= 3 &&
      Boolean(dmMergedCand) &&
      dmProvenanceCount >= 2 &&
      awaitingCands23.every(c => c.comparison_stage === 'DEFERRED_BY_LIMIT'),
    `23.2: Deduplicates cross-source candidates (${dmProvenanceCount} provenances merged on Dailymotion), prioritizes top 3 candidates as RESEARCHED, and retains ${awaitingCands23.length} lower-ranked candidates as AWAITING_RESEARCH (DEFERRED_BY_LIMIT) without discarding them`
  );

  // 23.3: Expand existing investigation to DEEP preset (500 unique, 350 deep research) and verify cached research reuse + promotion of awaiting candidates
  const expansionRes23 = await DiscoveryEngine.expandInvestigation({
    jobId: job23.id,
    referenceId: ref23Id,
    presetMode: 'DEEP',
    maxUniqueCandidates: 500,
    deepResearchLimit: 350,
    forensicComparisonLimit: 200,
    autoVerify: false
  });

  const candsAfterExpand23 = db.getCandidates({ referenceId: ref23Id });
  const researchedAfterExpand23 = candsAfterExpand23.filter(c => c.research_stage === 'RESEARCHED');
  const awaitingAfterExpand23 = candsAfterExpand23.filter(c => c.research_stage === 'AWAITING_RESEARCH');

  assert(
    expansionRes23.reusedResearchCount >= 3 &&
      expansionRes23.newlyResearchedCount >= 3 &&
      researchedAfterExpand23.length === candsAfterExpand23.length &&
      awaitingAfterExpand23.length === 0,
    `23.3: Expanding investigation to DEEP (500 max / 350 research) reuses ${expansionRes23.reusedResearchCount} cached research records without repeating completed work and promotes ${expansionRes23.newlyResearchedCount} deferred candidates to RESEARCHED`
  );

  // 23.4: Generate SearchCoverageReport and verify Measured vs. Estimated vs. Unavailable breakdown, universe denominator, 8 platform ecosystems, lifecycle states, and historical snapshots
  const report23 = SearchCoverageEngine.generateCoverageReport({
    referenceId: ref23Id,
    jobId: job23.id
  });

  const totalUniverseWeight = report23.platform_ecosystems.reduce(
    (sum, eco) => sum + eco.universe_weight_pct,
    0
  );
  const hasAllRequiredEcosystems = [
    'YOUTUBE',
    'DAILYMOTION',
    'VIMEO',
    'PUBLIC_VIDEO_HOSTING',
    'PUBLICLY_INDEXED_WEB',
    'SOCIAL_VIDEO',
    'CONFIGURED_PIRACY_ECOSYSTEM',
    'COMMERCIAL_OTT'
  ].every(cat => report23.platform_ecosystems.some(e => e.category === cat));

  const overallMeta = report23.overall_coverage.estimated_searchable_coverage;
  assert(
    Math.abs(totalUniverseWeight - 100.0) < 0.01 &&
      hasAllRequiredEcosystems &&
      overallMeta.denominator === 1000 &&
      overallMeta.percentage > 0 &&
      (overallMeta.measured_pct ?? 0) >= 0 &&
      (overallMeta.unavailable_pct ?? 0) > 0 &&
      Boolean(overallMeta.methodology) &&
      Boolean(overallMeta.denominator_definition) &&
      overallMeta.assumptions.length >= 3 &&
      overallMeta.data_sources.length >= 3 &&
      Boolean(overallMeta.confidence_level) &&
      Boolean(overallMeta.last_updated_at) &&
      report23.candidate_lifecycle.unique_candidates_count === candsAfterExpand23.length &&
      report23.candidate_lifecycle.researched_candidates_count === researchedAfterExpand23.length &&
      report23.candidate_lifecycle.remaining_candidate_capacity === 500 - candsAfterExpand23.length &&
      report23.historical_snapshots.length >= 2 &&
      report23.unavailable_or_inaccessible_sources.length > 0 &&
      report23.remaining_gaps.length > 0,
    `23.4: Generates evidence-backed SearchCoverageReport across 8 ecosystems (${totalUniverseWeight.toFixed(1)}% universe weight, ${overallMeta.percentage}% estimated reachable, ${overallMeta.measured_pct}% measured, ${overallMeta.unavailable_pct}% unavailable) with full methodology metadata and ${report23.historical_snapshots.length} historical snapshots`
  );

  // 23.5: Verify enabling/disabling a discovery ecosystem dynamically updates coverage and unavailable sources
  const baselineReachablePct = report23.overall_coverage.estimated_searchable_coverage.percentage;
  SearchCoverageEngine.setEcosystemEnabled('VIMEO', false);
  const reportWithVimeoDisabled = SearchCoverageEngine.generateCoverageReport({
    referenceId: ref23Id,
    jobId: job23.id
  });
  const vimeoDisabledEco = reportWithVimeoDisabled.platform_ecosystems.find(e => e.category === 'VIMEO');
  SearchCoverageEngine.setEcosystemEnabled('VIMEO', true);
  const reportWithVimeoReenabled = SearchCoverageEngine.generateCoverageReport({
    referenceId: ref23Id,
    jobId: job23.id
  });

  assert(
    Boolean(vimeoDisabledEco && !vimeoDisabledEco.adapter_enabled) &&
      vimeoDisabledEco!.estimated_searchable_pct === 0 &&
      reportWithVimeoDisabled.overall_coverage.estimated_searchable_coverage.percentage < baselineReachablePct &&
      reportWithVimeoReenabled.overall_coverage.estimated_searchable_coverage.percentage === baselineReachablePct,
    `23.5: Disabling VIMEO ecosystem dynamically reduces estimated reachable coverage (${baselineReachablePct}% -> ${reportWithVimeoDisabled.overall_coverage.estimated_searchable_coverage.percentage}%) and re-enabling restores ${reportWithVimeoReenabled.overall_coverage.estimated_searchable_coverage.percentage}%`
  );

  db.deleteReference(ref23Id);

  // -------------------------------------------------------------
  // Test Group 24: Permanent Reference Persistence, Journal Recovery,
  // Multi-Reference Preservation, Restart Durability & Orphan Upload Recovery
  // -------------------------------------------------------------
  console.log('\n[Test Group 24] Permanent Reference Persistence, Journal Recovery & Orphan Upload Recovery');

  const test24Dir = path.join(TEST_DB_DIR, 'test24_persistence');
  const test24DbPath = path.join(test24Dir, 'argus_test24.db');
  const test24UploadsDir = path.join(test24Dir, 'uploads');
  fs.mkdirSync(test24UploadsDir, { recursive: true });

  const db24 = new ArgusDatabase(test24DbPath);
  try {
    // 24.1: Registering multiple references preserves every existing reference without overwriting
    const ref24AId = 'ref_test24_cricket_1';
    const ref24BId = 'ref_test24_modern_family_2';
    const ref24CId = 'ref_test24_taylor_swift_3';

    const video24Path = validMasterVideoPath;
    const extracted24A = await FingerprintEngine.extractVideoFingerprints(video24Path, {
      referenceId: ref24AId,
      thumbnailsDir: db24.getThumbnailsDir(),
      intervalSec: 2,
      maxFrames: 4,
      generateThumbnails: true,
      title: 'Cricket Match Reference A',
      isCandidate: false
    });
    const extracted24B = await FingerprintEngine.extractVideoFingerprints(video24Path, {
      referenceId: ref24BId,
      thumbnailsDir: db24.getThumbnailsDir(),
      intervalSec: 2,
      maxFrames: 4,
      generateThumbnails: true,
      title: 'Modern Family Reference B',
      isCandidate: false
    });
    const extracted24C = await FingerprintEngine.extractVideoFingerprints(video24Path, {
      referenceId: ref24CId,
      thumbnailsDir: db24.getThumbnailsDir(),
      intervalSec: 2,
      maxFrames: 4,
      generateThumbnails: true,
      title: 'Taylor Swift Reference C',
      isCandidate: false
    });

    db24.persistAndVerifyReferenceExtraction({
      reference: {
        id: ref24AId,
        title: 'LIVE: IND vs NZ 5th T20I Cricket Reference',
        rights_holder: 'BCCI Broadcast Rights',
        asset_type: 'LIVE_SPORTS',
        duration_sec: 6,
        resolution: '320x180',
        fps: 25,
        codec: 'h264',
        source_type: 'UPLOAD',
        file_path: video24Path,
        created_at: new Date().toISOString(),
        status: 'PROCESSING',
        provenance_sha256: 'sha256_cricket_24a',
        fingerprint_count: 0
      },
      extractedFrames: extracted24A,
      sampleIntervalSec: 2,
      durationSec: 6,
      sourceVideoPath: video24Path,
      replaceExistingFingerprints: true
    });

    db24.persistAndVerifyReferenceExtraction({
      reference: {
        id: ref24BId,
        title: 'Modern Family S01E01 Reference',
        rights_holder: 'Disney Entertainment',
        asset_type: 'EPISODIC',
        duration_sec: 6,
        resolution: '320x180',
        fps: 25,
        codec: 'h264',
        source_type: 'UPLOAD',
        file_path: video24Path,
        created_at: new Date().toISOString(),
        status: 'PROCESSING',
        provenance_sha256: 'sha256_mf_24b',
        fingerprint_count: 0
      },
      extractedFrames: extracted24B,
      sampleIntervalSec: 2,
      durationSec: 6,
      sourceVideoPath: video24Path,
      replaceExistingFingerprints: true
    });

    db24.persistAndVerifyReferenceExtraction({
      reference: {
        id: ref24CId,
        title: 'Taylor Swift — Patient Zero Reference',
        rights_holder: 'Universal Music Group',
        asset_type: 'VOD_FEATURE',
        duration_sec: 6,
        resolution: '320x180',
        fps: 25,
        codec: 'h264',
        source_type: 'UPLOAD',
        file_path: video24Path,
        created_at: new Date().toISOString(),
        status: 'PROCESSING',
        provenance_sha256: 'sha256_ts_24c',
        fingerprint_count: 0
      },
      extractedFrames: extracted24C,
      sampleIntervalSec: 2,
      durationSec: 6,
      sourceVideoPath: video24Path,
      replaceExistingFingerprints: true
    });

    const allRefs24 = db24.getReferences();
    assert(
      allRefs24.length === 3 &&
        allRefs24.some(r => r.id === ref24AId && r.status === 'FINGERPRINTED') &&
        allRefs24.some(r => r.id === ref24BId && r.status === 'FINGERPRINTED') &&
        allRefs24.some(r => r.id === ref24CId && r.status === 'FINGERPRINTED'),
      '24.1: Registering multiple references preserves every existing reference in SQLite without overwriting'
    );

    // 24.2: Calling clearAll() without forceDeleteUserReferences preserves all user-registered references
    db24.clearAll();
    const refsAfterSafeClear = db24.getReferences();
    assert(
      refsAfterSafeClear.length === 3 &&
        db24.getReferenceFingerprints(ref24AId).length === extracted24A.length &&
        db24.getReferenceFingerprints(ref24BId).length === extracted24B.length &&
        db24.getReferenceFingerprints(ref24CId).length === extracted24C.length,
      '24.2: Cleanup / clearAll() without explicit forceDeleteUserReferences preserves all 3 user references and their fingerprints'
    );

    // 24.3: Backend restart (new ArgusDatabase instance) preserves all references, frames, and thumbnails
    db24.close();
    const db24Restarted = new ArgusDatabase(test24DbPath);
    try {
      const restartedRefs = db24Restarted.getReferences();
      const restartedCricketFps = db24Restarted.getReferenceFingerprints(ref24AId);
      assert(
        restartedRefs.length === 3 &&
          restartedCricketFps.length === extracted24A.length &&
          restartedCricketFps.every(f => f.image_available === true),
        '24.3: Restarting backend preserves all 3 references, extracted frames, fingerprints, and verified thumbnails'
      );

      // 24.4: Explicit user deletion records tombstone and removes only the targeted reference
      const delSuccess = db24Restarted.deleteReference(ref24CId);
      const afterExplicitDelete = db24Restarted.getReferences();
      assert(
        delSuccess === true &&
          afterExplicitDelete.length === 2 &&
          !afterExplicitDelete.some(r => r.id === ref24CId) &&
          afterExplicitDelete.some(r => r.id === ref24AId) &&
          afterExplicitDelete.some(r => r.id === ref24BId),
        '24.4: Explicit deleteReference removes only the deleted reference while preserving remaining user references'
      );

      // 24.5: Journal recovery restores non-deleted user references if SQLite rows are accidentally lost, while respecting deletion tombstones
      db24Restarted.clearAll({ forceDeleteUserReferences: true });
      assert(db24Restarted.getReferences().length === 0, '24.5a: Forced table clear empties SQLite table for simulation');
      const restoredRefs = db24Restarted.restoreMissingUserReferencesFromJournal();
      const afterJournalRestore = db24Restarted.getReferences();
      assert(
        restoredRefs.some(r => r.id === ref24AId) &&
          restoredRefs.some(r => r.id === ref24BId) &&
          !restoredRefs.some(r => r.id === ref24CId) &&
          afterJournalRestore.length === 2 &&
          db24Restarted.getReferenceFingerprints(ref24AId).length === extracted24A.length,
        '24.5b: Durable user_references_journal.json restores user references and fingerprints while respecting deleted_references_tombstones.json'
      );

      // 24.6: Orphaned uploaded video file + thumb_ref_* thumbnail batch on disk is automatically recovered into SQLite
      const orphanUploadFile = path.join(
        test24UploadsDir,
        'upl_1793610227644_bd02ab24-vidssave.com___LIVE__IND_vs_NZ__5th_T20I___INDIA_vs_NEW_ZEALAND_Live_match_Today__Live_Cricket_Score___Fan_Chat_240P.mp4'
      );
      fs.copyFileSync(video24Path, orphanUploadFile);
      const orphanRefId = 'ref_1793610326730_orphan24';
      await FingerprintEngine.extractVideoFingerprints(orphanUploadFile, {
        referenceId: orphanRefId,
        thumbnailsDir: db24Restarted.getThumbnailsDir(),
        intervalSec: 2,
        generateThumbnails: true,
        title: 'Orphan Cricket Upload',
        isCandidate: false
      });

      const recoveredOrphans = db24Restarted.recoverOrphanedUploadedReferences({
        uploadsDir: test24UploadsDir
      });
      const recoveredOrphanRef = db24Restarted.getReferenceById(orphanRefId);
      const recoveredOrphanFps = db24Restarted.getReferenceFingerprints(orphanRefId);
      assert(
        recoveredOrphans.some(o => o.id === orphanRefId) &&
          Boolean(recoveredOrphanRef) &&
          recoveredOrphanRef?.status === 'FINGERPRINTED' &&
          recoveredOrphanRef?.asset_type === 'LIVE_SPORTS' &&
          recoveredOrphanFps.length >= 3 &&
          recoveredOrphanFps.every(f => f.image_available === true),
        `24.6: Automatically recovers orphaned uploaded video + extracted thumbnail batch (${orphanRefId}) into SQLite as FINGERPRINTED`
      );
    } finally {
      db24Restarted.close();
    }
  } finally {
    try {
      fs.rmSync(test24Dir, { recursive: true, force: true });
    } catch {}
  }

  // 14.5: Verify Test Database Isolation — live /app/applet/data/argus.db was never opened or modified
  const liveDbExistedAfter = fs.existsSync(LIVE_DB_PATH);
  const liveDbSha256After = liveDbExistedAfter
    ? crypto.createHash('sha256').update(fs.readFileSync(LIVE_DB_PATH)).digest('hex')
    : null;
  const liveDbSizeAfter = liveDbExistedAfter ? fs.statSync(LIVE_DB_PATH).size : null;
  assert(
    db.getDbFilePath() === path.resolve(TEST_DB_PATH) &&
      db.getDbFilePath() !== LIVE_DB_PATH &&
      liveDbExistedBefore === liveDbExistedAfter &&
      liveDbSha256Before === liveDbSha256After &&
      liveDbSizeBefore === liveDbSizeAfter,
    `Test suite is 100% isolated in ${db.getDbFilePath()}; live database (${LIVE_DB_PATH}) SHA-256 and contents are untouched`
  );

  // -------------------------------------------------------------
  // Test Summary
  // -------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`  TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exitCode = 1;
  }
  } finally {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {}
  }
  process.exit(failedTests > 0 ? 1 : 0);
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

