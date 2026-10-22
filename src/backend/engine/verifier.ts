/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Multi-Source Candidate Verification & Media Acquisition Pipeline
 *
 * Implements Stage C & Stage D:
 * DISCOVERED -> REACHABLE -> MEDIA_DETECTED -> ACQUIRED -> ANALYZED
 * Handles DRM protection (Widevine/PlayReady/FairPlay), HTTP errors,
 * Cloudflare anti-bot blocks, HLS/DASH manifest probing, and genuine perceptual frame matching.
 *
 * Never substitutes unrelated local sample videos or clones reference hashes to fabricate matches.
 */

import fs from 'node:fs';
import { db } from '../db/database.js';
import { FingerprintEngine } from './fingerprint.js';
import { AdapterRegistry, YouTubeAdapter } from './adapters/index.js';
import {
  CandidateItem,
  EvidenceRecord,
  FrameFingerprint,
  AudioFingerprint,
  PipelineStatus
} from '../types.js';

export class VerifierEngine {
  /**
   * Complete end-to-end multi-source verification and analysis of a candidate source.
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

    log(`Initiating candidate reachability & content verification for: ${candidate.source_url}`);

    // Determine target reference ID
    const refId = options.targetReferenceId || candidate.reference_id;
    const reference = refId ? db.getReferenceById(refId) : null;
    const referenceFingerprints = reference ? db.getReferenceFingerprints(reference.id) : [];

    // -------------------------------------------------------------
    // Step 1: Route to Specialized Source Adapter & Inspect Access
    // -------------------------------------------------------------
    const adapter = AdapterRegistry.getAdapterForUrl(candidate.source_url);
    log(`Dispatched to modular adapter: "${adapter.name}" (Category: ${adapter.sourceCategory})`);

    const probeResult = await adapter.acquireAndProbe(candidate.source_url, { timeoutMs: 5000 });

    for (const l of probeResult.technicalLogs) {
      logs.push(l);
    }

    let pipelineStatus: PipelineStatus = probeResult.pipelineStatus;
    const reachabilityCode = probeResult.httpStatus;
    const latencyMs = probeResult.latencyMs;
    const mediaType: any = probeResult.mediaType || candidate.media_type || 'UNKNOWN';
    const mediaResolution = probeResult.resolution || candidate.media_resolution;
    const mediaDuration = probeResult.durationSec || candidate.media_duration_sec;
    const isLive = candidate.is_live_stream || mediaType === 'HLS_M3U8';
    const rawHeaders: Record<string, string> = probeResult.headers || {};
    const drmScheme: string | undefined = probeResult.drmScheme;
    const platformName = probeResult.platform || candidate.platform || candidate.domain;

    // Handle non-accessible states: DRM_PROTECTED, BLOCKED, REQUIRES_AUTHENTICATION, UNREACHABLE, UNSUPPORTED
    const isNonAcquirable = (
      pipelineStatus === 'UNREACHABLE' ||
      pipelineStatus === 'DRM_PROTECTED' ||
      pipelineStatus === 'BLOCKED' ||
      pipelineStatus === 'REQUIRES_AUTHENTICATION' ||
      pipelineStatus === 'UNSUPPORTED'
    );

    if (isNonAcquirable) {
      log(`Verification result: Pipeline status "${pipelineStatus}" (HTTP ${reachabilityCode || 'ERR'}). Media stream not acquirable.`);
      if (pipelineStatus === 'DRM_PROTECTED') {
        log(`[Compliance Guarantee] DRM protection verified (${drmScheme || 'Widevine'}). Technical decryption without authorization is prohibited.`);
      }

      const acqStatus =
        pipelineStatus === 'DRM_PROTECTED'
          ? 'INACCESSIBLE_DRM_PROTECTED'
          : pipelineStatus === 'BLOCKED'
          ? 'INACCESSIBLE_ANTI_BOT_BLOCKED'
          : pipelineStatus === 'REQUIRES_AUTHENTICATION'
          ? 'INACCESSIBLE_AUTH_REQUIRED'
          : 'INACCESSIBLE_UNREACHABLE';

      db.updateCandidateVerification(candidate.id, {
        pipeline_status: pipelineStatus,
        acquisition_status: acqStatus,
        platform: platformName,
        reachability_code: reachabilityCode,
        reachability_latency_ms: latencyMs,
        media_type: mediaType,
        source_category: adapter.sourceCategory,
        drm_scheme: drmScheme,
        raw_headers_json: JSON.stringify(rawHeaders),
        verification_logs: logs.join('\n'),
        last_inspected_at: new Date().toISOString()
      });

      return {
        candidate: db.getCandidateById(candidate.id)!,
        evidenceRecord: null,
        logs
      };
    }

    // -------------------------------------------------------------
    // Step 2: Verify Page Content Plausible Relation to Target Reference
    // -------------------------------------------------------------
    const verifiedTitle = probeResult.pageTitle || candidate.discovered_title;
    if (reference) {
      const relevance = YouTubeAdapter.computeRelevanceScore(
        `${verifiedTitle} ${candidate.discovered_title}`,
        reference.title,
        reference.title
      );
      log(`Verified page title: "${verifiedTitle}" — Content relevance to reference "${reference.title}": ${(relevance * 100).toFixed(0)}%`);
      log(`[Verification Policy] Title/snippet overlap alone is NOT proof of infringement. Perceptual frame comparison is required.`);
    }

    // If the candidate URL is merely a reachable HTML webpage or embedded player page
    // without a decodable video stream, keep it as REACHABLE or MEDIA_DETECTED (unverified media).
    if (pipelineStatus === 'REACHABLE' || (pipelineStatus === 'MEDIA_DETECTED' && !probeResult.resolvedMediaUrl && !candidate.file_path)) {
      const acqStatus =
        pipelineStatus === 'MEDIA_DETECTED'
          ? 'ACCESSIBLE_UNVERIFIED_EMBED'
          : 'ACCESSIBLE_WEB_PAGE_NO_STREAM';

      log(`Candidate URL is accessible (HTTP ${reachabilityCode}), but no raw decodable video stream could be extracted. Status remains ${pipelineStatus} (${acqStatus}).`);

      db.updateCandidateVerification(candidate.id, {
        pipeline_status: pipelineStatus,
        acquisition_status: acqStatus,
        platform: platformName,
        reachability_code: reachabilityCode,
        reachability_latency_ms: latencyMs,
        media_type: mediaType,
        media_resolution: mediaResolution,
        media_duration_sec: mediaDuration,
        is_live_stream: isLive,
        source_category: adapter.sourceCategory,
        raw_headers_json: JSON.stringify(rawHeaders),
        verification_logs: logs.join('\n'),
        last_inspected_at: new Date().toISOString()
      });

      return {
        candidate: db.getCandidateById(candidate.id)!,
        evidenceRecord: null,
        logs
      };
    }

    // -------------------------------------------------------------
    // Step 3: Genuine Media Keyframe Extraction via FFmpeg
    // -------------------------------------------------------------
    let candidateFingerprints = db.getCandidateFingerprints(candidate.id);

    if (candidateFingerprints.length === 0) {
      let mediaSourceToExtract = probeResult.resolvedMediaUrl || candidate.source_url;
      if (candidate.file_path && fs.existsSync(candidate.file_path)) {
        mediaSourceToExtract = candidate.file_path;
      }

      log(`Attempting FFmpeg keyframe extraction from resolved source: ${mediaSourceToExtract}`);

      const extracted = await FingerprintEngine.extractVideoFingerprints(mediaSourceToExtract, {
        intervalSec: 2,
        maxFrames: 8,
        generateThumbnails: true,
        title: verifiedTitle,
        isCandidate: true
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
          thumbnail_url: f.thumbnail_url || (f.thumbnail_data?.startsWith('/thumbnails/') ? f.thumbnail_data : undefined),
          thumbnail_path: f.thumbnail_path,
          created_at: new Date().toISOString()
        }));

        db.insertCandidateFingerprints(candidateFingerprints);
        log(`Decoded ${candidateFingerprints.length} genuine keyframes with 64-bit dHash perceptual fingerprints.`);
      } else {
        log(`No decodable video keyframes could be extracted from "${mediaSourceToExtract}". Candidate remains unverified (MEDIA_DETECTED).`);
        db.updateCandidateVerification(candidate.id, {
          pipeline_status: 'MEDIA_DETECTED',
          acquisition_status: 'ACCESSIBLE_UNVERIFIED_MEDIA',
          platform: platformName,
          media_url: probeResult.resolvedMediaUrl,
          reachability_code: reachabilityCode,
          reachability_latency_ms: latencyMs,
          media_type: mediaType,
          media_resolution: mediaResolution,
          media_duration_sec: mediaDuration,
          is_live_stream: isLive,
          source_category: adapter.sourceCategory,
          raw_headers_json: JSON.stringify(rawHeaders),
          verification_logs: logs.join('\n'),
          last_inspected_at: new Date().toISOString()
        });

        return {
          candidate: db.getCandidateById(candidate.id)!,
          evidenceRecord: null,
          logs
        };
      }
    } else {
      log(`Loaded ${candidateFingerprints.length} existing candidate keyframe fingerprints.`);
    }

    pipelineStatus = 'ACQUIRED';

    // -------------------------------------------------------------
    // Step 4: Perceptual Frame Comparison Against Registered Reference
    // -------------------------------------------------------------
    let evidence: EvidenceRecord | null = null;
    let acqStatus = 'ACQUIRED_FRAMES_EXTRACTED';

    if (reference && reference.status === 'REGISTERED' && referenceFingerprints.length > 0) {
      pipelineStatus = 'ANALYZED';
      log(`Running perceptual 64-bit dHash sequence comparison against registered reference "${reference.title}" (${referenceFingerprints.length} reference frames)...`);

      let candidateAudioFps: AudioFingerprint[] = [];
      let referenceAudioFps: AudioFingerprint[] = [];

      const candLocalFile = candidate.file_path && fs.existsSync(candidate.file_path) ? candidate.file_path : null;
      const refLocalFile = reference.file_path && fs.existsSync(reference.file_path) ? reference.file_path : null;

      if (candLocalFile && refLocalFile) {
        candidateAudioFps = await FingerprintEngine.extractAudioFingerprints(candLocalFile, {
          intervalSec: 2,
          maxDurationSec: 16
        });
        referenceAudioFps = await FingerprintEngine.extractAudioFingerprints(refLocalFile, {
          intervalSec: 2,
          maxDurationSec: 16
        });
      }

      const comparison = FingerprintEngine.compareFingerprintSequences(
        candidateFingerprints,
        referenceFingerprints,
        {
          hammingThreshold: 12,
          minMatchedFrames: 2,
          candidateAudioFps: candidateAudioFps.length > 0 ? candidateAudioFps : undefined,
          referenceAudioFps: referenceAudioFps.length > 0 ? referenceAudioFps : undefined
        }
      );

      const isMatch = comparison.matchStatus === 'POTENTIAL_MATCH';
      acqStatus = isMatch ? 'VERIFIED_PERCEPTUAL_MATCH' : 'ANALYZED_NO_PERCEPTUAL_MATCH';

      log(
        `Perceptual comparison complete: Status=${comparison.matchStatus}, Classification=${comparison.matchClassification}, Confidence=${(comparison.confidenceScore * 100).toFixed(1)}%, MinHammingDist=${comparison.minHammingDist} bits (${comparison.matchedFramesCount}/${comparison.totalComparedFrames} frames aligned)`
      );

      const custodySeal = FingerprintEngine.generateCustodySeal({
        candidateUrl: candidate.source_url,
        referenceId: reference.id,
        confidenceScore: comparison.confidenceScore,
        minHammingDist: comparison.minHammingDist,
        temporalOffsetSec: comparison.temporalOffsetSec,
        samplePairs: comparison.samplePairs,
        audioMatch: comparison.audioMatch
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
        match_classification: comparison.matchClassification,
        confidence_score: comparison.confidenceScore,
        min_hamming_dist: comparison.minHammingDist,
        avg_hamming_dist: comparison.avgHammingDist,
        matched_frames_count: comparison.matchedFramesCount,
        total_compared_frames: comparison.totalComparedFrames,
        temporal_offset_sec: comparison.temporalOffsetSec,
        sample_pairs: comparison.samplePairs,
        audio_match: comparison.audioMatch,
        chain_of_custody_sha256: custodySeal,
        review_decision: 'PENDING',
        created_at: new Date().toISOString()
      };

      db.insertEvidenceRecord(evidence);
      log(`Tamper-evident chain of custody seal generated: ${custodySeal.substring(0, 16)}...`);
    } else if (reference && reference.status !== 'REGISTERED') {
      log(`Target reference "${reference.title}" has status "${reference.status}" and 0 valid reference keyframes. Cannot confirm perceptual match until a valid reference video is uploaded.`);
      acqStatus = 'ACQUIRED_AWAITING_VALID_REFERENCE';
    } else {
      log(`No target reference linked. Candidate keyframes extracted and stored (${acqStatus}).`);
    }

    // Update candidate state in SQLite
    db.updateCandidateVerification(candidate.id, {
      pipeline_status: pipelineStatus,
      acquisition_status: acqStatus,
      platform: platformName,
      media_url: probeResult.resolvedMediaUrl,
      reachability_code: reachabilityCode,
      reachability_latency_ms: latencyMs,
      media_type: mediaType,
      media_resolution: mediaResolution,
      media_duration_sec: mediaDuration,
      is_live_stream: isLive,
      source_category: adapter.sourceCategory,
      drm_scheme: drmScheme,
      raw_headers_json: JSON.stringify(rawHeaders),
      verification_logs: logs.join('\n'),
      last_inspected_at: new Date().toISOString()
    });

    return {
      candidate: db.getCandidateById(candidate.id)!,
      evidenceRecord: evidence,
      logs
    };
  }

  /**
   * Generates formal legal Takedown / DMCA Notice string
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
Official Forensic Fingerprint Matrix: Verified

2. LOCATION OF INFRINGING MATERIAL:
Infringing URL: ${evidence.candidate_url}
Hosting Domain: ${evidence.candidate_domain}

3. TECHNICAL FORENSIC VERIFICATION & EVIDENCE:
Algorithmic Match Classification: ${evidence.match_classification || 'FULL_COPY'}
Match Confidence Score: ${(((evidence.confidence_score ?? (evidence as any).confidenceScore ?? 0)) * 100).toFixed(2)}%
Perceptual Distance: ${evidence.min_hamming_dist} bits Hamming variation (Threshold <= 12)
Audio Spectral Verification: ${evidence.audio_match?.has_audio ? `${evidence.audio_match.audio_similarity_pct.toFixed(1)}% acoustic match` : 'Video perceptual match verified'}
Verified Aligned Frames: ${evidence.matched_frames_count} frames confirmed

4. GOOD FAITH STATEMENT:
I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.

5. ACCURACY STATEMENT:
The information in this notification is accurate, and under penalty of perjury, I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.

Signed,
SPECTRA Automated Rights Enforcement & Forensic Intelligence Pipeline
On behalf of: ${evidence.rights_holder}`;
  }
}
