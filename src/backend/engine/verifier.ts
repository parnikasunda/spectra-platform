/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Candidate Source Verification & Media Acquisition Pipeline
 *
 * Implements Stage C & Stage D:
 * DISCOVERED -> REACHABLE -> MEDIA_DETECTED -> ACQUIRED -> ANALYZED
 * Handles DRM protection, HTTP errors, HLS manifest parsing, and perceptual comparison.
 */

import { db } from '../db/database.js';
import { FingerprintEngine } from './fingerprint.js';
import { 
  CandidateItem, 
  EvidenceRecord, 
  FrameFingerprint, 
  PipelineStatus,
  MatchedKeyframePair 
} from '../types.js';

export class VerifierEngine {
  /**
   * Complete end-to-end verification and analysis of a candidate source.
   */
  public static async verifyCandidate(
    candidateId: string,
    options: { targetReferenceId?: string } = {}
  ): Promise<{
    candidate: CandidateItem;
    evidenceRecord?: EvidenceRecord | null;
    logs: string[];
  }> {
    const candidate = db.getCandidateById(candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${candidateId} not found`);
    }

    const logs: string[] = [];
    const log = (msg: string) => {
      const entry = `[${new Date().toISOString()}] ${msg}`;
      logs.push(entry);
    };

    log(`Starting candidate inspection for URL: ${candidate.source_url}`);

    // Determine target reference ID
    const refId = options.targetReferenceId || candidate.reference_id;
    const reference = refId ? db.getReferenceById(refId) : null;

    let pipelineStatus: PipelineStatus = 'DISCOVERED';
    let reachabilityCode = 0;
    let latencyMs = 0;
    let mediaType: any = candidate.media_type;
    let mediaResolution = candidate.media_resolution || '1280x720';
    let mediaDuration = candidate.media_duration_sec || 0;
    let isLive = candidate.is_live_stream;
    let rawHeaders: Record<string, string> = {};

    // -------------------------------------------------------------
    // Step 1: Reachability & HTTP Probing
    // -------------------------------------------------------------
    const startTime = Date.now();
    try {
      log(`Probing network reachability via HTTP GET/HEAD...`);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      // Perform real HTTP fetch
      let response: Response;
      try {
        response = await fetch(candidate.source_url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ArgusInspectionBot/2.4',
            'Accept': '*/*'
          },
          signal: controller.signal
        });
      } catch (fetchErr: any) {
        clearTimeout(timeout);
        latencyMs = Date.now() - startTime;
        log(`Network connection failed: ${fetchErr.message}`);

        // Update candidate state as UNREACHABLE
        db.updateCandidateVerification(candidate.id, {
          pipeline_status: 'UNREACHABLE',
          reachability_code: 0,
          reachability_latency_ms: latencyMs,
          verification_logs: logs.join('\n'),
          last_inspected_at: new Date().toISOString()
        });

        return {
          candidate: { ...candidate, pipeline_status: 'UNREACHABLE', reachability_code: 0 },
          evidenceRecord: null,
          logs
        };
      }

      clearTimeout(timeout);
      latencyMs = Date.now() - startTime;
      reachabilityCode = response.status;

      response.headers.forEach((v, k) => {
        rawHeaders[k] = v;
      });

      log(`HTTP status code: ${reachabilityCode} in ${latencyMs}ms`);

      if (reachabilityCode >= 400) {
        log(`Target returned error code ${reachabilityCode}. Source unreachable or restricted.`);
        db.updateCandidateVerification(candidate.id, {
          pipeline_status: 'UNREACHABLE',
          reachability_code: reachabilityCode,
          reachability_latency_ms: latencyMs,
          raw_headers_json: JSON.stringify(rawHeaders),
          verification_logs: logs.join('\n'),
          last_inspected_at: new Date().toISOString()
        });

        return {
          candidate: { ...candidate, pipeline_status: 'UNREACHABLE', reachability_code: reachabilityCode },
          evidenceRecord: null,
          logs
        };
      }

      pipelineStatus = 'REACHABLE';

      // -------------------------------------------------------------
      // Step 2: Media Stream Detection & Manifest Inspection
      // -------------------------------------------------------------
      const contentType = response.headers.get('content-type') || '';
      log(`Inspecting Content-Type header: "${contentType}"`);

      let manifestContent = '';
      if (
        contentType.includes('mpegurl') || 
        contentType.includes('application/x-mpegURL') || 
        candidate.source_url.includes('.m3u8')
      ) {
        mediaType = 'HLS_M3U8';
        isLive = true;
        manifestContent = await response.text();
        log(`Detected HLS Manifest stream. Checking encryption and segments...`);

        // Check for DRM or Encryption keys
        if (manifestContent.includes('#EXT-X-KEY') || manifestContent.includes('SAMPLE-AES')) {
          log(`DRM Protection detected in HLS manifest (#EXT-X-KEY). Technical restrictions respected.`);
          pipelineStatus = 'DRM_PROTECTED';

          db.updateCandidateVerification(candidate.id, {
            pipeline_status: 'DRM_PROTECTED',
            reachability_code: reachabilityCode,
            reachability_latency_ms: latencyMs,
            media_type: 'HLS_M3U8',
            raw_headers_json: JSON.stringify(rawHeaders),
            verification_logs: logs.join('\n'),
            last_inspected_at: new Date().toISOString()
          });

          return {
            candidate: { ...candidate, pipeline_status: 'DRM_PROTECTED' },
            evidenceRecord: null,
            logs
          };
        }

        // Parse resolution if available
        const resMatch = manifestContent.match(/RESOLUTION=(\d+x\d+)/);
        if (resMatch) {
          mediaResolution = resMatch[1];
          log(`Parsed stream resolution from master manifest: ${mediaResolution}`);
        }

        pipelineStatus = 'MEDIA_DETECTED';
      } else if (contentType.includes('video/mp4') || candidate.source_url.includes('.mp4')) {
        mediaType = 'MP4';
        pipelineStatus = 'MEDIA_DETECTED';
        log(`Detected direct MP4 video media container.`);
      } else {
        // HTML or other web source
        mediaType = 'HTML_PLAYER';
        pipelineStatus = 'MEDIA_DETECTED';
        log(`Web player source reached.`);
      }

    } catch (err: any) {
      log(`Inspection error: ${err.message}`);
      pipelineStatus = 'UNREACHABLE';
    }

    // -------------------------------------------------------------
    // Step 3: Media Acquisition & Perceptual Fingerprinting
    // -------------------------------------------------------------
    pipelineStatus = 'ACQUIRED';
    log(`Acquiring media frames and executing perceptual hash pipeline...`);

    // Extract frames using FingerprintEngine
    let candidateFingerprints: FrameFingerprint[] = [];

    // Check if candidate already has fingerprints stored or extract fresh
    const existingCandFps = db.getCandidateFingerprints(candidate.id);
    if (existingCandFps.length > 0) {
      candidateFingerprints = existingCandFps;
      log(`Retrieved ${candidateFingerprints.length} pre-extracted candidate frame fingerprints.`);
    } else {
      // If candidate is a test URL or accessible video, run genuine extraction
      const extracted = await FingerprintEngine.extractVideoFingerprints(candidate.source_url, {
        intervalSec: 2,
        maxFrames: 15,
        generateThumbnails: true
      });

      if (extracted.length > 0) {
        candidateFingerprints = extracted.map(f => ({
          id: `cfp_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          candidate_id: candidate.id,
          timestamp_sec: f.timestamp_sec,
          frame_index: f.frame_index,
          phash_hex: f.phash_hex,
          avg_luminance: f.avg_luminance,
          thumbnail_data: f.thumbnail_data,
          created_at: new Date().toISOString()
        }));

        db.insertCandidateFingerprints(candidateFingerprints);
        log(`Extracted ${candidateFingerprints.length} frame fingerprints via FFmpeg dHash pipeline.`);
      }
    }

    // -------------------------------------------------------------
    // Step 4: Temporal Alignment & Perceptual Similarity Comparison
    // -------------------------------------------------------------
    let evidence: EvidenceRecord | null = null;

    if (reference) {
      pipelineStatus = 'ANALYZED';
      log(`Performing temporal sequence cross-correlation against reference "${reference.title}"...`);

      const referenceFingerprints = db.getReferenceFingerprints(reference.id);
      log(`Loaded ${referenceFingerprints.length} reference frame fingerprints.`);

      const comparison = FingerprintEngine.compareFingerprintSequences(
        candidateFingerprints,
        referenceFingerprints,
        { hammingThreshold: 12, minMatchedFrames: 2 }
      );

      log(`Comparison complete: Status=${comparison.matchStatus}, Confidence=${(comparison.confidenceScore * 100).toFixed(1)}%, MinDistance=${comparison.minHammingDist}, MatchedFrames=${comparison.matchedFramesCount}`);

      const custodySeal = FingerprintEngine.generateCustodySeal({
        candidateUrl: candidate.source_url,
        referenceId: reference.id,
        confidenceScore: comparison.confidenceScore,
        minHammingDist: comparison.minHammingDist,
        temporalOffsetSec: comparison.temporalOffsetSec,
        samplePairs: comparison.samplePairs
      });

      evidence = {
        id: `ev_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        candidate_id: candidate.id,
        reference_id: reference.id,
        candidate_url: candidate.source_url,
        candidate_domain: candidate.domain,
        reference_title: reference.title,
        rights_holder: reference.rights_holder,
        match_status: comparison.matchStatus,
        confidence_score: comparison.confidenceScore,
        min_hamming_dist: comparison.minHammingDist,
        avg_hamming_dist: comparison.avgHammingDist,
        matched_frames_count: comparison.matchedFramesCount,
        total_compared_frames: comparison.totalComparedFrames,
        temporal_offset_sec: comparison.temporalOffsetSec,
        sample_pairs: comparison.samplePairs,
        chain_of_custody_sha256: custodySeal,
        review_decision: 'PENDING',
        created_at: new Date().toISOString()
      };

      db.insertEvidenceRecord(evidence);
      log(`Generated digital evidence record with SHA-256 seal: ${custodySeal.substring(0, 16)}...`);
    }

    // Update candidate record in DB
    db.updateCandidateVerification(candidate.id, {
      pipeline_status: pipelineStatus,
      reachability_code: reachabilityCode,
      reachability_latency_ms: latencyMs,
      media_type: mediaType,
      media_resolution: mediaResolution,
      media_duration_sec: mediaDuration,
      is_live_stream: isLive,
      raw_headers_json: JSON.stringify(rawHeaders),
      verification_logs: logs.join('\n'),
      last_inspected_at: new Date().toISOString()
    });

    const updatedCand = db.getCandidateById(candidate.id)!;

    return {
      candidate: updatedCand,
      evidenceRecord: evidence,
      logs
    };
  }

  /**
   * Generates a formal legal Takedown / DMCA Notice string
   */
  public static generateTakedownNotice(evidence: EvidenceRecord): string {
    const dateStr = new Date().toUTCString();
    return `DIGITAL MILLENNIUM COPYRIGHT ACT (DMCA) / STATUTORY TAKEDOWN NOTICE
Date: ${dateStr}
Chain of Custody Evidence Seal: ${evidence.chain_of_custody_sha256}

TO: Abuse & DMCA Compliance Officer
Hosting Domain / Service Provider: ${evidence.candidate_domain}

Re: Notice of Unauthorized Infringing Media Distribution

Dear Abuse / Copyright Team,

This letter serves as formal notification pursuant to the Digital Millennium Copyright Act (17 U.S.C. § 512(c)) and applicable international digital copyright conventions that your service is hosting, linking, or transmitting unauthorized copyrighted content.

1. IDENTIFICATION OF COPYRIGHTED WORK:
   Title: "${evidence.reference_title}"
   Exclusive Rights Holder: ${evidence.rights_holder}
   Reference ID: ${evidence.reference_id}

2. INFRINGING MATERIAL IDENTIFIER & LOCATION:
   Candidate Source URL: ${evidence.candidate_url}
   Hosting Domain: ${evidence.candidate_domain}

3. TECHNICAL FORENSIC VERIFICATION & EVIDENCE:
   Automated Perceptual Fingerprint Verification: MATCH IDENTIFIED
   Mathematical Match Confidence: ${(evidence.confidence_score * 100).toFixed(2)}%
   Min Hamming Distance: ${evidence.min_hamming_dist} bits (Threshold: <= 12)
   Average Hamming Distance: ${evidence.avg_hamming_dist.toFixed(1)} bits
   Synchronized Matched Frame Count: ${evidence.matched_frames_count} frames
   Detected Broadcast Temporal Delay: ${evidence.temporal_offset_sec > 0 ? `+${evidence.temporal_offset_sec}s delay` : `${evidence.temporal_offset_sec}s`}
   Cryptographic Evidence Fingerprint: ${evidence.chain_of_custody_sha256}

4. STATEMENT OF GOOD FAITH & AFFIRMATION:
   I have a good faith belief that the use and distribution of the material described above is not authorized by the copyright owner, its agent, or the law.
   The information in this notification is accurate, and under penalty of perjury, I confirm that I am authorized to act on behalf of the exclusive rights holder.

We demand that you immediately disable access to or remove the infringing transmission at the aforementioned URL.

Sincerely,
Argus Anti-Piracy Enforcement Team
Authorized Representative of ${evidence.rights_holder}
Evidence ID: ${evidence.id}`;
  }
}
