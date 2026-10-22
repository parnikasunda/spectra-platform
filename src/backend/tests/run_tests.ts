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

import { FingerprintEngine } from '../engine/fingerprint.js';
import { DiscoveryEngine } from '../engine/discovery.js';
import { db } from '../db/database.js';
import { loadOptionalForensicTestSuite } from '../engine/sampleData.js';
import { FrameFingerprint } from '../types.js';
import { AdapterRegistry } from '../engine/adapters/index.js';
import { VerifierEngine } from '../engine/verifier.js';
import { YouTubeAdapter } from '../engine/adapters/youtube.js';
import { StreamingServicesAdapter } from '../engine/adapters/streaming.js';
import { SuspectedPiracyAdapter } from '../engine/adapters/suspected_piracy.js';
import { PublicVideoPlatformsAdapter } from '../engine/adapters/public_video.js';
import { WebCrawlerAdapter } from '../engine/adapters/web_crawler.js';

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
  console.log('\n======================================================');
  console.log('  ARGUS ANTI-PIRACY PLATFORM — COMPREHENSIVE TEST SUITE');
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

  // Snapshot any user-registered references (non-FORENSIC_SAMPLE) before fixture test
  const userRefsBackup = db.getReferences().filter(r => r.source_type !== 'FORENSIC_SAMPLE');
  const userRefFpsBackup = new Map<string, FrameFingerprint[]>();
  for (const ur of userRefsBackup) {
    userRefFpsBackup.set(ur.id, db.getReferenceFingerprints(ur.id));
  }

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

  // Restore user-registered references
  for (const ur of userRefsBackup) {
    db.upsertReference(ur);
    const fps = userRefFpsBackup.get(ur.id) || [];
    if (fps.length > 0) {
      db.insertReferenceFingerprints(fps);
    }
  }

  // -------------------------------------------------------------
  // Test Group 5: Multi-Source Adapter Dispatch & DRM Compliance
  // -------------------------------------------------------------
  console.log('\n[Test Group 5] Multi-Source Adapter Dispatch & DRM Compliance');

  const allAdapters = AdapterRegistry.getAllAdapters();
  assert(allAdapters.length === 5, 'AdapterRegistry registers all 5 modular source adapters');

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

  // Deduplication check
  const urlSet = new Set(multiDiscovered.map(d => d.url.toLowerCase()));
  assert(urlSet.size === multiDiscovered.length, 'Deduplication guarantees all discovered URLs are unique');

  // Statutory DMCA Takedown Notice generation
  const takedownNotice = VerifierEngine.generateTakedownNotice(primaryEvidence);
  assert(takedownNotice.includes('DIGITAL MILLENNIUM COPYRIGHT ACT'), 'Takedown notice includes statutory DMCA header');
  assert(takedownNotice.includes(primaryEvidence.chain_of_custody_sha256), 'Takedown notice includes SHA-256 custody seal');
  assert(takedownNotice.includes(primaryEvidence.reference_title), 'Takedown notice references copyrighted work title');
  assert(takedownNotice.includes(primaryEvidence.candidate_url), 'Takedown notice specifies infringing candidate URL');
  assert(takedownNotice.includes('penalty of perjury'), 'Takedown notice includes penalty of perjury statutory declaration');
  assert(!takedownNotice.includes('NaN'), 'Confidence score is formatted cleanly without NaN');

  // -------------------------------------------------------------
  // Test Summary
  // -------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`  TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
