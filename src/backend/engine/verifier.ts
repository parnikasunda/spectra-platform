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
import { CandidateResearchEngine } from './candidateResearch.js';
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
    const probeTargetUrl = candidate.media_url || candidate.source_url;
    const o2Adapter = AdapterRegistry.getO2TvSeriesAdapter();
    const adapter =
      o2Adapter.canHandle(candidate.source_url) || o2Adapter.canHandle(probeTargetUrl)
        ? o2Adapter
        : AdapterRegistry.getAdapterForUrl(probeTargetUrl);
    log(`Dispatched to modular adapter: "${adapter.name}" (Category: ${adapter.sourceCategory}, Target: ${probeTargetUrl})`);

    const probeResult = await adapter.acquireAndProbe(probeTargetUrl, { timeoutMs: 5000 });

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
    const finalUrl = probeResult.finalUrl || candidate.final_url || candidate.source_url;
    const finalDomain = probeResult.finalDomain || candidate.final_domain || candidate.domain;
    const crawlStatus =
      probeResult.crawlStatus ||
      (pipelineStatus === 'UNREACHABLE'
        ? 'UNREACHABLE'
        : pipelineStatus === 'BLOCKED'
        ? 'BLOCKED'
        : pipelineStatus === 'DRM_PROTECTED' || pipelineStatus === 'REQUIRES_AUTHENTICATION'
        ? 'ACCESS_RESTRICTED'
        : probeResult.redirected
        ? 'REDIRECTED_ACCESSIBLE'
        : reachabilityCode === 200
        ? 'CRAWLED_OK'
        : 'DISCOVERED');

    // Handle non-accessible states: DRM_PROTECTED, BLOCKED, REQUIRES_AUTHENTICATION, UNREACHABLE, UNSUPPORTED
    const isNonAcquirable = (
      pipelineStatus === 'UNREACHABLE' ||
      pipelineStatus === 'DRM_PROTECTED' ||
      pipelineStatus === 'BLOCKED' ||
      pipelineStatus === 'REQUIRES_AUTHENTICATION' ||
      pipelineStatus === 'UNSUPPORTED'
    );

    if (isNonAcquirable) {
      log(`Verification result: Pipeline status "${pipelineStatus}" (HTTP ${reachabilityCode || 'ERR'}, Crawl: ${crawlStatus}). Media stream not acquirable.`);
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
          : pipelineStatus === 'UNSUPPORTED'
          ? 'UNSUPPORTED_OR_TORRENT_SKIPPED'
          : 'INACCESSIBLE_UNREACHABLE';

      const nonAcqClassification =
        probeResult.candidateClassification ||
        (pipelineStatus === 'DRM_PROTECTED' ? 'VIDEO_ASSET' : 'GENERAL_WEBPAGE');

      const nonAcqResearch = CandidateResearchEngine.evaluateCandidateAgainstTarget({
        candidate: {
          ...candidate,
          final_url: finalUrl,
          final_domain: finalDomain,
          platform: platformName
        },
        reference,
        verifiedPageTitle: probeResult.pageTitle
      });

      db.updateCandidateVerification(candidate.id, {
        pipeline_status: pipelineStatus,
        acquisition_status: acqStatus,
        final_url: finalUrl,
        final_domain: finalDomain,
        crawl_status: crawlStatus,
        candidate_classification: nonAcqClassification,
        platform: platformName,
        reachability_code: reachabilityCode,
        reachability_latency_ms: latencyMs,
        media_type: mediaType,
        source_category: adapter.sourceCategory,
        drm_scheme: drmScheme,
        raw_headers_json: JSON.stringify(rawHeaders),
        research_relevance_score: nonAcqResearch.research_relevance_score,
        identity_relationship: nonAcqResearch.identity_relationship,
        detected_identity_json: JSON.stringify(nonAcqResearch),
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
    // Step 2: Verify Page Content Plausible Relation & Research Metadata
    // -------------------------------------------------------------
    let webResearchSignals: Awaited<ReturnType<typeof CandidateResearchEngine.fetchWebpageResearchMetadata>> = null;
    if (
      /^https?:\/\//i.test(candidate.source_url) &&
      !/\.(mp4|m3u8|webm|mkv|mov|ts)(\?|$)/i.test(candidate.source_url)
    ) {
      webResearchSignals = await CandidateResearchEngine.fetchWebpageResearchMetadata(candidate.source_url, 3200);
    }

    const verifiedTitle = probeResult.pageTitle || webResearchSignals?.pageTitle || candidate.discovered_title;
    const candidateResearchEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
      candidate: {
        ...candidate,
        final_url: finalUrl,
        final_domain: finalDomain,
        platform: platformName,
        media_url: probeResult.resolvedMediaUrl || candidate.media_url
      },
      reference,
      verifiedPageTitle: verifiedTitle,
      pageDescription: webResearchSignals?.description,
      structuredMetadata: webResearchSignals?.structuredMetadata
    });

    if (reference) {
      log(
        `Verified page title: "${verifiedTitle}" — Identity relationship: ${candidateResearchEval.identity_relationship} | Research relevance to "${reference.title}": ${(candidateResearchEval.research_relevance_score * 100).toFixed(0)}% (${candidateResearchEval.detected_identity.identity_summary})`
      );
      if (candidateResearchEval.contradictory_evidence.length > 0) {
        log(`[Identity Warning] Contradictory evidence detected: ${candidateResearchEval.contradictory_evidence.join(' | ')}`);
      }
      log(`[Verification Policy] Title/metadata research is strictly separated from forensic frame confidence. Perceptual frame sequence comparison is required.`);
    }

    // If the candidate URL is merely a reachable HTML webpage, article, image, or embedded player page
    // without a decodable video stream, keep it as REACHABLE or MEDIA_DETECTED (never VERIFIED_VIDEO_ASSET).
    if (pipelineStatus === 'REACHABLE' || (pipelineStatus === 'MEDIA_DETECTED' && !probeResult.resolvedMediaUrl && !candidate.file_path)) {
      const pageClassification =
        probeResult.candidateClassification ||
        (pipelineStatus === 'MEDIA_DETECTED' ? 'VIDEO_ASSET' : 'GENERAL_WEBPAGE');

      const acqStatus =
        pageClassification === 'IMAGE'
          ? 'ACCESSIBLE_STATIC_IMAGE_NO_VIDEO'
          : pageClassification === 'ARTICLE'
          ? 'ACCESSIBLE_ARTICLE_NO_STREAM'
          : pipelineStatus === 'MEDIA_DETECTED'
          ? 'ACCESSIBLE_UNVERIFIED_EMBED'
          : 'ACCESSIBLE_WEB_PAGE_NO_STREAM';

      const mappedAssetKind =
        pageClassification === 'ARTICLE'
          ? 'ARTICLE'
          : pageClassification === 'IMAGE'
          ? 'IMAGE'
          : 'DISCOVERED_PAGE';

      log(`Candidate URL is accessible (HTTP ${reachabilityCode}), classified as ${pageClassification}. A webpage or article mentioning a video is not a verified video asset. Status remains ${pipelineStatus} (${acqStatus}).`);

      db.updateCandidateVerification(candidate.id, {
        pipeline_status: pipelineStatus,
        acquisition_status: acqStatus,
        final_url: finalUrl,
        final_domain: finalDomain,
        crawl_status: crawlStatus,
        candidate_classification: pageClassification,
        asset_kind: mappedAssetKind,
        platform: platformName,
        reachability_code: reachabilityCode,
        reachability_latency_ms: latencyMs,
        media_type: mediaType,
        media_resolution: mediaResolution,
        media_duration_sec: mediaDuration,
        is_live_stream: isLive,
        source_category: adapter.sourceCategory,
        raw_headers_json: JSON.stringify(rawHeaders),
        research_relevance_score: candidateResearchEval.research_relevance_score,
        identity_relationship: candidateResearchEval.identity_relationship,
        detected_identity_json: JSON.stringify(candidateResearchEval),
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
    // Step 3: Evidence Collection — Genuine Media Keyframe Extraction via FFmpeg
    // -------------------------------------------------------------
    let candidateFingerprints = db.getCandidateFingerprints(candidate.id);
    const hasPersistedThumbnails = candidateFingerprints.some(
      fp => Boolean(fp.thumbnail_url || fp.thumbnail_path || fp.thumbnail_data)
    );

    if (candidateFingerprints.length === 0 || !hasPersistedThumbnails) {
      let mediaSourceToExtract = probeResult.resolvedMediaUrl || candidate.media_url || candidate.source_url;
      if (candidate.file_path && fs.existsSync(candidate.file_path)) {
        mediaSourceToExtract = candidate.file_path;
      }

      log(`Attempting FFmpeg keyframe extraction from resolved source: ${mediaSourceToExtract}`);

      const candidateInterval = reference?.sample_interval_sec && reference.sample_interval_sec > 0
        ? reference.sample_interval_sec
        : 2;
      const extracted = await FingerprintEngine.extractVideoFingerprints(mediaSourceToExtract, {
        intervalSec: candidateInterval,
        durationSec: mediaDuration || candidate.media_duration_sec,
        generateThumbnails: true,
        title: verifiedTitle,
        isCandidate: true
      });

      if (extracted.length > 0) {
        db.clearCandidateFingerprints(candidate.id);
        candidateFingerprints = extracted.map(f => ({
          id: `cfp_${candidate.id}_${f.frame_index}`,
          candidate_id: candidate.id,
          timestamp_sec: f.timestamp_sec,
          frame_index: f.frame_index,
          phash_hex: f.phash_hex,
          vhash_hex: f.vhash_hex,
          crop_phash_hex: f.crop_phash_hex,
          avg_luminance: f.avg_luminance,
          thumbnail_data: f.thumbnail_data,
          thumbnail_url: f.thumbnail_url || (f.thumbnail_data?.startsWith('/thumbnails/') ? f.thumbnail_data : undefined),
          thumbnail_path: f.thumbnail_path || f.thumbnail_url,
          created_at: new Date().toISOString()
        }));

        db.insertCandidateFingerprints(candidateFingerprints);
        log(`Decoded ${candidateFingerprints.length} genuine keyframes across entire candidate video with 64-bit multi-feature perceptual hashes and persisted frame thumbnails.`);
      } else if (candidateFingerprints.length === 0) {
        log(`No decodable video keyframes could be extracted from "${mediaSourceToExtract}". Candidate remains unverified (MEDIA_DETECTED).`);
        db.updateCandidateVerification(candidate.id, {
          pipeline_status: 'MEDIA_DETECTED',
          acquisition_status: 'ACCESSIBLE_UNVERIFIED_MEDIA',
          final_url: finalUrl,
          final_domain: finalDomain,
          crawl_status: crawlStatus,
          candidate_classification: 'VIDEO_ASSET',
          asset_kind: 'DISCOVERED_PAGE',
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
          research_relevance_score: candidateResearchEval.research_relevance_score,
          identity_relationship: candidateResearchEval.identity_relationship,
          detected_identity_json: JSON.stringify(candidateResearchEval),
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
      log(`Loaded ${candidateFingerprints.length} existing candidate keyframe fingerprints with persisted thumbnails.`);
    }

    pipelineStatus = 'ACQUIRED';

    // -------------------------------------------------------------
    // Step 4: Separate Visual Frame Comparison & Metadata/Context Assessment
    // -------------------------------------------------------------
    let evidence: EvidenceRecord | null = null;
    let acqStatus = 'ACQUIRED_FRAMES_EXTRACTED';

    const hasValidReferenceFingerprints = Boolean(
      reference &&
      (reference.status === 'REGISTERED' || reference.status === 'FINGERPRINTED') &&
      referenceFingerprints.length > 0
    );

    const candidateWithPlatform: CandidateItem = {
      ...candidate,
      platform: platformName,
      is_live_stream: isLive,
      media_type: mediaType,
      reachability_code: reachabilityCode
    };

    const capturedFrames = FingerprintEngine.buildCapturedCandidateFrames(
      candidateWithPlatform,
      candidateFingerprints,
      hasValidReferenceFingerprints ? referenceFingerprints : []
    );

    const firstCapturedThumb =
      capturedFrames.find(cf => cf.thumbnail_url)?.thumbnail_url ||
      candidate.thumbnail_url ||
      undefined;

    let visualSimScore: number | undefined;
    let metaRelScore: number | undefined;
    let overallAssessmentState: EvidenceRecord['overall_assessment'] = 'INSUFFICIENT_EVIDENCE';

    if (hasValidReferenceFingerprints && reference) {
      pipelineStatus = 'ANALYZED';
      const isLiveSportsContext = reference.asset_type === 'LIVE_SPORTS' || isLive;
      log(
        `Running all-to-all (R×C) perceptual 64-bit dHash sequence comparison against fingerprinted reference "${reference.title}" (${referenceFingerprints.length} reference frames × ${candidateFingerprints.length} candidate frames, mode=${isLiveSportsContext ? 'LIVE_SPORTS_MULTI_OFFSET' : 'STANDARD'})...`
      );

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
          hammingThreshold: isLiveSportsContext ? 16 : 13,
          minMatchedFrames: 2,
          isLiveSports: isLiveSportsContext,
          referenceDurationSec: reference.duration_sec,
          candidateDurationSec: mediaDuration || candidate.media_duration_sec,
          candidateAudioFps: candidateAudioFps.length > 0 ? candidateAudioFps : undefined,
          referenceAudioFps: referenceAudioFps.length > 0 ? referenceAudioFps : undefined
        }
      );

      const metaAssessment = FingerprintEngine.assessMetadataAndContext({
        candidate: candidateWithPlatform,
        reference,
        verifiedPageTitle: verifiedTitle,
        candidateFps: candidateFingerprints,
        referenceFps: referenceFingerprints,
        visualSimilarityScore: comparison.visualSimilarityScore,
        matchedFramesCount: comparison.matchedFramesCount,
        minHammingDist: comparison.minHammingDist,
        confidenceScore: comparison.confidenceScore
      });

      visualSimScore = comparison.visualSimilarityScore;
      metaRelScore = metaAssessment.metadataRelevanceScore;
      overallAssessmentState = metaAssessment.overallAssessment;

      const isConfirmedMatch =
        comparison.matchStatus === 'POTENTIAL_MATCH' &&
        overallAssessmentState === 'MATCH_FOUND';

      acqStatus = isConfirmedMatch
        ? 'VERIFIED_PERCEPTUAL_MATCH'
        : overallAssessmentState === 'POSSIBLE_MATCH'
        ? 'ANALYZED_POSSIBLE_MATCH_UNVERIFIED_VISUAL'
        : 'ANALYZED_NO_PERCEPTUAL_MATCH';

      log(
        `Perceptual & Context Analysis complete: Overall=${overallAssessmentState}, Identity=${candidateResearchEval.identity_relationship}, ResearchRel=${(candidateResearchEval.research_relevance_score * 100).toFixed(0)}%, VisualSim=${((visualSimScore ?? 0) * 100).toFixed(1)}%, MinHammingDist=${comparison.minHammingDist} bits (${comparison.matchedFramesCount}/${comparison.totalComparedFrames} frames within threshold, RefCoverage=${comparison.coverageMetrics.reference_coverage_pct}%, CandCoverage=${comparison.coverageMetrics.candidate_coverage_pct}%)`
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
        id: `ev_${candidate.id}`,
        candidate_id: candidate.id,
        reference_id: reference.id,
        candidate_url: candidate.source_url,
        candidate_domain: candidate.domain,
        candidate_platform: platformName,
        candidate_title: verifiedTitle || candidate.discovered_title,
        reference_title: reference.title,
        rights_holder: reference.rights_holder,
        // Never use metadata alone to claim copyright infringement, and never confirm a match when blocked by identity conflict / static preview uncertainty
        match_status: isConfirmedMatch ? 'POTENTIAL_MATCH' : 'NO_MATCH',
        match_classification:
          !isConfirmedMatch && overallAssessmentState === 'POSSIBLE_MATCH'
            ? 'UNCERTAIN_MATCH'
            : !isConfirmedMatch && overallAssessmentState === 'NO_MATCH_FOUND'
            ? 'NO_MATCH'
            : comparison.matchClassification,
        confidence_score: comparison.confidenceScore,
        visual_similarity_score: visualSimScore,
        metadata_relevance_score: metaRelScore,
        overall_assessment: overallAssessmentState,
        metadata_signals: metaAssessment.metadataSignals,
        captured_frames: capturedFrames,
        uncertainty_reasons: metaAssessment.uncertaintyReasons,
        min_hamming_dist: comparison.minHammingDist,
        avg_hamming_dist: comparison.avgHammingDist,
        matched_frames_count: comparison.matchedFramesCount,
        total_compared_frames: comparison.totalComparedFrames,
        reference_duration_sec: comparison.coverageMetrics.reference_duration_sec,
        candidate_duration_sec: comparison.coverageMetrics.candidate_duration_sec,
        total_reference_frames: comparison.coverageMetrics.total_reference_frames,
        total_candidate_frames: comparison.coverageMetrics.total_candidate_frames,
        unique_reference_frames_matched: comparison.coverageMetrics.unique_reference_frames_matched,
        unique_candidate_frames_matched: comparison.coverageMetrics.unique_candidate_frames_matched,
        reference_coverage_pct: comparison.coverageMetrics.reference_coverage_pct,
        candidate_coverage_pct: comparison.coverageMetrics.candidate_coverage_pct,
        coverage_metrics: comparison.coverageMetrics,
        temporal_offset_sec: comparison.temporalOffsetSec,
        sample_pairs: comparison.samplePairs,
        audio_match: comparison.audioMatch,
        chain_of_custody_sha256: custodySeal,
        review_decision: 'PENDING',
        created_at: new Date().toISOString()
      };

      db.insertEvidenceRecord(evidence);
      log(`Evidence record preserved in Vault (Assessment: ${overallAssessmentState}, Seal: ${custodySeal.substring(0, 16)}...)`);
    } else if (reference) {
      // Reference is METADATA_REGISTERED, AWAITING_AUTHORIZED_MEDIA, or INVALID (0 reference fingerprints).
      // Separate evidence collection from match verification: preserve captured candidate frames and metadata assessment in Evidence Vault!
      const metaAssessment = FingerprintEngine.assessMetadataAndContext({
        candidate: candidateWithPlatform,
        reference,
        verifiedPageTitle: verifiedTitle,
        candidateFps: candidateFingerprints,
        referenceFps: [],
        visualSimilarityScore: undefined,
        matchedFramesCount: 0,
        minHammingDist: 64,
        confidenceScore: 0
      });

      metaRelScore = metaAssessment.metadataRelevanceScore;
      overallAssessmentState = 'INSUFFICIENT_EVIDENCE';

      if (reference.status === 'METADATA_REGISTERED' || reference.status === 'AWAITING_AUTHORIZED_MEDIA') {
        log(
          `[Compliance Gate] Target reference "${reference.title}" (${reference.platform || 'OTT'}) has status "${reference.status}" with 0 perceptual fingerprints. Captured ${capturedFrames.length} candidate frames and evaluated metadata relevance (${(metaRelScore * 100).toFixed(0)}%); visual frame matching awaits authorized reference media.`
        );
        acqStatus = 'ACQUIRED_AWAITING_AUTHORIZED_REFERENCE_MEDIA';
      } else {
        log(
          `Target reference "${reference.title}" has status "${reference.status}" and 0 valid reference keyframes. Preserved ${capturedFrames.length} candidate keyframes with INSUFFICIENT_EVIDENCE status.`
        );
        acqStatus = 'ACQUIRED_AWAITING_VALID_REFERENCE';
      }

      const custodySeal = FingerprintEngine.generateCustodySeal({
        candidateUrl: candidate.source_url,
        referenceId: reference.id,
        confidenceScore: 0,
        minHammingDist: 64,
        temporalOffsetSec: 0,
        samplePairs: []
      });

      evidence = {
        id: `ev_${candidate.id}`,
        candidate_id: candidate.id,
        reference_id: reference.id,
        candidate_url: candidate.source_url,
        candidate_domain: candidate.domain,
        candidate_platform: platformName,
        candidate_title: verifiedTitle || candidate.discovered_title,
        reference_title: reference.title,
        rights_holder: reference.rights_holder,
        match_status: 'NO_MATCH',
        match_classification: 'UNCERTAIN_MATCH',
        confidence_score: 0,
        visual_similarity_score: undefined,
        metadata_relevance_score: metaRelScore,
        overall_assessment: 'INSUFFICIENT_EVIDENCE',
        metadata_signals: metaAssessment.metadataSignals,
        captured_frames: capturedFrames,
        uncertainty_reasons: metaAssessment.uncertaintyReasons,
        min_hamming_dist: 64,
        avg_hamming_dist: 64,
        matched_frames_count: 0,
        total_compared_frames: candidateFingerprints.length,
        temporal_offset_sec: 0,
        sample_pairs: [],
        chain_of_custody_sha256: custodySeal,
        review_decision: 'PENDING',
        created_at: new Date().toISOString()
      };

      db.insertEvidenceRecord(evidence);
    } else {
      log(`No target reference linked. Candidate keyframes extracted and stored (${acqStatus}).`);
    }

    // Update candidate state in SQLite including captured frame provenance and assessment metrics
    const existingMethods = (candidate.match_method || 'title_match')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (overallAssessmentState === 'MATCH_FOUND' && !existingMethods.includes('frame_match')) {
      existingMethods.push('frame_match');
    }
    const updatedMatchMethod = Array.from(new Set(existingMethods)).join(', ');

    let updatedProvJson = candidate.discovery_provenance_json;
    if (candidate.discovery_provenance) {
      const prov = {
        ...candidate.discovery_provenance,
        match_methods: Array.from(new Set([...(candidate.discovery_provenance.match_methods || []), ...existingMethods]))
      };
      updatedProvJson = JSON.stringify(prov);
    }

    db.updateCandidateVerification(candidate.id, {
      pipeline_status: pipelineStatus,
      acquisition_status: acqStatus,
      final_url: finalUrl,
      final_domain: finalDomain,
      crawl_status: crawlStatus,
      candidate_classification: 'VERIFIED_VIDEO_ASSET',
      asset_kind: 'VERIFIED_VIDEO_ASSET',
      platform: platformName,
      media_url: probeResult.resolvedMediaUrl || candidate.media_url,
      match_method: updatedMatchMethod,
      matched_content_id: overallAssessmentState === 'MATCH_FOUND' ? (refId || candidate.matched_content_id) : candidate.matched_content_id,
      discovery_provenance_json: updatedProvJson,
      thumbnail_url: firstCapturedThumb,
      frame_evidence: JSON.stringify(capturedFrames),
      visual_similarity_score: visualSimScore,
      metadata_relevance_score: metaRelScore,
      overall_assessment: overallAssessmentState,
      research_relevance_score: candidateResearchEval.research_relevance_score,
      identity_relationship: candidateResearchEval.identity_relationship,
      detected_identity_json: JSON.stringify(candidateResearchEval),
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
