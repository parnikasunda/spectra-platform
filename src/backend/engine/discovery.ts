/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Multi-Source Discovery Engine & Job Orchestrator
 *
 * Coordinates modular source adapters across YouTube, commercial streaming
 * platforms (Netflix, Disney+ Hotstar, SonyLIV), suspected piracy websites, public video
 * repositories (Dailymotion, Internet Archive), and general web search with deduplication,
 * diagnostic reporting, and genuine verification.
 */

import { db } from '../db/database.js';
import {
  CandidateItem,
  DiscoveryJob,
  DiscoveryPresetMode,
  DiscoveryProvider,
  DiscoverySourceRecord,
  SearchCoverageReport
} from '../types.js';
import { VerifierEngine } from './verifier.js';
import { FingerprintEngine } from './fingerprint.js';
import { CandidateResearchEngine } from './candidateResearch.js';
import { SearchCoverageEngine } from './searchCoverage.js';
import { AdapterRegistry, SuspectedPiracyAdapter, O2TvSeriesAdapter, DiscoveredItem } from './adapters/index.js';

export interface DiscoverySweepParams {
  jobName: string;
  provider: DiscoveryProvider;
  targetReferenceId?: string;
  queryKeywords: string;
  filterDomain?: string;
  presetMode?: DiscoveryPresetMode;
  maxCandidates?: number;
  maxUniqueCandidates?: number;
  deepResearchLimit?: number;
  forensicComparisonLimit?: number;
  autoVerify?: boolean;
  keywordVariations?: string[];
  seedSources?: string[];
  o2tvBaseUrlOverride?: string;
  additionalDiscoveredItems?: DiscoveredItem[];
  expandedFromJobId?: string;
}

export class DiscoveryEngine {
  /**
   * Standard configurable piracy/broadcast search-term variations (Step 4)
   */
  public static readonly STANDARD_KEYWORD_VARIATIONS: string[] = [
    'HD',
    '1080p',
    '4K',
    '2160p',
    'WEB-DL',
    'WEBRip',
    'LIVE',
    'LIVE STREAM',
    'FULL MATCH',
    'FULL MOVIE',
    'SEASON',
    'EPISODE',
    'S01E01'
  ];

  /**
   * Generates configurable search-term combinations using a content item's title,
   * alternate titles, event names, participating teams, season and episode identifiers,
   * and standard piracy/broadcast quality & format variations.
   */
  public static generateKeywordCombinations(options: {
    title: string;
    queryKeywords?: string;
    alternateTitles?: string[];
    seasonEpisodeInfo?: string;
    assetType?: string;
    customVariations?: string[];
  }): string[] {
    const rawBase = (options.queryKeywords || options.title || '').trim();
    if (!rawBase) return [];

    const baseTerms = new Set<string>([rawBase]);
    if (options.title && options.title.trim() && options.title.trim() !== rawBase) {
      baseTerms.add(options.title.trim());
    }
    if (options.alternateTitles) {
      for (const alt of options.alternateTitles) {
        if (alt && alt.trim()) baseTerms.add(alt.trim());
      }
    }

    // Extract alternate title segments separated by —, -, |, or :
    const splitParts = (options.title || rawBase)
      .split(/\s*(?:—|–|\||:)\s*/)
      .map(s => s.trim())
      .filter(s => s.length >= 4);
    if (splitParts.length > 1) {
      baseTerms.add(splitParts.join(' '));
      baseTerms.add(splitParts[0]);
    }

    // Extract participating teams (e.g. "India vs New Zealand" or "India Tour of New Zealand" -> "India vs New Zealand", "IND vs NZ")
    const vsMatch =
      rawBase.match(/([A-Za-z\s]{2,25}?)\s+(?:vs?\.?|v)\s+([A-Za-z\s]{2,25}?)(?:\s+\d|\s*[-|—:]|$)/i) ||
      rawBase.match(/([A-Za-z\s]{2,25}?)\s+tour\s+of\s+([A-Za-z\s]{2,25}?)(?:\s+\d|\s*[-|—:]|$)/i);
    const teamAbbr: Record<string, string> = {
      india: 'IND',
      'new zealand': 'NZ',
      australia: 'AUS',
      england: 'ENG',
      pakistan: 'PAK',
      'south africa': 'SA',
      arsenal: 'ARS',
      'bayern munich': 'BAY',
      'real madrid': 'RMA',
      barcelona: 'BAR'
    };
    if (vsMatch) {
      const teamA = vsMatch[1].trim();
      const teamB = vsMatch[2].trim();
      baseTerms.add(`${teamA} vs ${teamB}`);
      const abbrA = teamAbbr[teamA.toLowerCase()];
      const abbrB = teamAbbr[teamB.toLowerCase()];
      if (abbrA && abbrB) {
        baseTerms.add(`${abbrA} vs ${abbrB}`);
      }
    }

    // Extract season/episode identifiers (e.g. Season 1 Episode 1 -> S01E01)
    const seText = `${rawBase} ${options.seasonEpisodeInfo || ''}`.trim();
    const sMatch = seText.match(/season\s*(\d{1,2})/i);
    const eMatch = seText.match(/episode\s*(\d{1,2})/i);
    const codeMatch = seText.match(/\bS(\d{1,2})E(\d{1,2})\b/i);
    let seasonEpCode = 'S01E01';
    if (codeMatch) {
      seasonEpCode = `S${codeMatch[1].padStart(2, '0')}E${codeMatch[2].padStart(2, '0')}`;
    } else if (sMatch && eMatch) {
      seasonEpCode = `S${sMatch[1].padStart(2, '0')}E${eMatch[1].padStart(2, '0')}`;
    }

    const variations =
      options.customVariations && options.customVariations.length > 0
        ? options.customVariations
        : this.STANDARD_KEYWORD_VARIATIONS;

    const primaryTitle = Array.from(baseTerms)[0];
    const prioritizedMods: string[] = [];

    if (options.assetType === 'LIVE_SPORTS' || /\b(vs|t20|t20i|odi|match|league|cup|final)\b/i.test(seText)) {
      prioritizedMods.push('LIVE', 'LIVE STREAM', 'FULL MATCH', '1080p', 'HD', '4K');
    } else if (options.assetType === 'EPISODIC' || sMatch || eMatch || codeMatch) {
      prioritizedMods.push(seasonEpCode, 'SEASON', 'EPISODE', '1080p', 'WEB-DL', 'WEBRip', 'HD');
    } else {
      prioritizedMods.push('FULL MOVIE', '1080p', '4K', '2160p', 'WEB-DL', 'WEBRip', 'HD');
    }

    for (const v of variations) {
      const mod = v === 'S01E01' ? seasonEpCode : v;
      if (!prioritizedMods.includes(mod)) {
        prioritizedMods.push(mod);
      }
    }

    const combinations: string[] = [];
    const targetedFromResearch = CandidateResearchEngine.generateTargetedQueries({
      title: options.title,
      queryKeywords: options.queryKeywords,
      seasonEpisodeInfo: options.seasonEpisodeInfo,
      assetType: options.assetType
    });
    for (const tq of targetedFromResearch) {
      combinations.push(tq);
    }
    for (const base of Array.from(baseTerms)) {
      combinations.push(base);
    }
    if (options.seasonEpisodeInfo && !primaryTitle.toLowerCase().includes(options.seasonEpisodeInfo.toLowerCase())) {
      combinations.push(`${primaryTitle} ${options.seasonEpisodeInfo}`);
    }
    for (const mod of prioritizedMods) {
      combinations.push(`${primaryTitle} ${mod}`);
    }

    return Array.from(new Set(combinations.map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean)));
  }

  /**
   * Normalizes URLs to prevent duplicate candidates with minor query string / protocol drift
   * while preserving distinct video asset identifiers (v, video, id, clip, episode, stream).
   */
  public static normalizeUrl(rawUrl: string): { normalizedUrl: string; domain: string } {
    try {
      const parsed = new URL(rawUrl.trim());
      const searchParams = new URLSearchParams(parsed.search);
      for (const key of Array.from(searchParams.keys())) {
        const kLower = key.toLowerCase();
        if (
          kLower.startsWith('utm_') ||
          kLower === 'ref' ||
          kLower === 'fbclid' ||
          kLower === 'gclid' ||
          kLower === 'si' ||
          kLower === 'feature' ||
          kLower.startsWith('src_')
        ) {
          searchParams.delete(key);
        }
      }
      parsed.search = searchParams.toString();
      parsed.hash = '';
      let normalized = parsed.toString();
      if (normalized.endsWith('/') && parsed.pathname === '/') {
        normalized = normalized.slice(0, -1);
      }
      return {
        normalizedUrl: normalized,
        domain: parsed.hostname.replace(/^www\./, '').toLowerCase()
      };
    } catch {
      const fallbackDomain = rawUrl.replace(/https?:\/\//, '').split('/')[0] || 'unknown-host';
      return {
        normalizedUrl: rawUrl.trim(),
        domain: fallbackDomain.replace(/^www\./, '').toLowerCase()
      };
    }
  }

  /**
   * Executes a visual frame & perceptual fingerprint search across indexed candidate keyframes
   * for a fingerprinted reference item, returning matching candidates with sourceType: 'frame_search'.
   */
  public static executeFrameFingerprintSearch(referenceId: string): DiscoveredItem[] {
    const refFps = db.getReferenceFingerprints(referenceId);
    if (!refFps || refFps.length === 0) return [];

    const allCandidates = db.getCandidates();
    const matchedItems: DiscoveredItem[] = [];

    for (const cand of allCandidates) {
      const candFps = db.getCandidateFingerprints(cand.id);
      if (!candFps || candFps.length === 0) continue;

      const seqComp = FingerprintEngine.compareFingerprintSequences(candFps, refFps, {
        hammingThreshold: 12,
        minMatchedFrames: 2
      });

      if (seqComp.matchStatus === 'POTENTIAL_MATCH' && seqComp.matchedFramesCount >= 2 && seqComp.minHammingDist <= 12) {
        const similarityScore = seqComp.visualSimilarityScore ?? Number(((64 - seqComp.minHammingDist) / 64).toFixed(4));
        matchedItems.push({
          url: cand.source_url,
          mediaUrl: cand.media_url,
          sourceType: 'frame_search',
          matchedContentId: referenceId,
          matchMethod: 'frame_match',
          originalUrl: cand.original_url || cand.source_url,
          finalUrl: cand.final_url || cand.source_url,
          finalDomain: cand.final_domain || cand.domain,
          referringPage: `Perceptual Frame Hash Index (${seqComp.matchedFramesCount} aligned frames, min dHash dist=${seqComp.minHammingDist})`,
          matchedKeywords: [`phash_match:${referenceId}`],
          crawlStatus: cand.crawl_status || 'CRAWLED_OK',
          candidateClassification: cand.candidate_classification || 'VERIFIED_VIDEO_ASSET',
          title: cand.discovered_title,
          platform: cand.platform || cand.domain,
          sourceCategory: cand.source_category || 'SUSPECTED_PIRACY',
          assetKind: cand.asset_kind || 'VERIFIED_VIDEO_ASSET',
          suggestedType: (cand.media_type as any) || 'MP4',
          domain: cand.domain,
          isLive: cand.is_live_stream,
          relevanceScore: similarityScore,
          metadata: {
            frameSearchMatchedFrames: seqComp.matchedFramesCount,
            minHammingDistance: seqComp.minHammingDist,
            visualSimilarityScore: similarityScore
          }
        });
      }
    }

    return matchedItems;
  }

  /**
   * Executes a multi-source discovery sweep across:
   * 1. Frame and visual-fingerprint-based searches ('frame_search')
   * 2. Persistent configured discovery sources including https://o2tvseries4u.com/ ('configured_website')
   * 3. Content-title, episode, and event searches across modular adapters ('title_search')
   *
   * Intelligently deduplicates and merges candidates while keeping distinct video assets on the same
   * webpage separate, runs FFmpeg verification on accessible media, and records source telemetry.
   */
  public static async executeDiscoverySweep(params: DiscoverySweepParams): Promise<DiscoveryJob> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    const resolvedLimits = SearchCoverageEngine.resolveDiscoveryLimits({
      presetMode: params.presetMode,
      maxUniqueCandidates: params.maxUniqueCandidates ?? (typeof params.maxCandidates === 'number' ? params.maxCandidates : undefined),
      deepResearchLimit: params.deepResearchLimit,
      forensicComparisonLimit: params.forensicComparisonLimit
    });

    const requestedMax = resolvedLimits.max_unique_candidates;
    const deepResearchLimit = resolvedLimits.deep_research_limit;
    const forensicComparisonLimit = resolvedLimits.forensic_comparison_limit;

    const targetRef = params.targetReferenceId ? db.getReferenceById(params.targetReferenceId) : null;
    const parsedTargetIdentity = CandidateResearchEngine.parseReferenceTargetIdentity(targetRef, params.queryKeywords);
    const derivedEpisodeTag =
      targetRef?.season_episode_info ||
      parsedTargetIdentity.episodeCode ||
      parsedTargetIdentity.fixtureOrFormat ||
      undefined;
    const refTitle = targetRef
      ? `${targetRef.title}${derivedEpisodeTag && !targetRef.title.toLowerCase().includes(derivedEpisodeTag.toLowerCase()) ? ` ${derivedEpisodeTag}` : ''}`.trim()
      : params.queryKeywords;
    const effectiveKeywords = params.queryKeywords?.trim() || refTitle;
    const referenceSourceUrl = targetRef?.source_url
      ? this.normalizeUrl(targetRef.source_url).normalizedUrl.toLowerCase()
      : null;

    const generatedCombinations = CandidateResearchEngine.generateTargetedQueries({
      reference: targetRef,
      title: targetRef?.title || effectiveKeywords,
      queryKeywords: effectiveKeywords,
      seasonEpisodeInfo: derivedEpisodeTag,
      assetType: targetRef?.asset_type,
      customVariations: params.keywordVariations
    });

    // Scale number of search combinations executed based on preset / requestedMax
    const maxCombinationsToRun =
      requestedMax >= 1000
        ? Math.min(24, generatedCombinations.length)
        : requestedMax >= 500
        ? Math.min(16, generatedCombinations.length)
        : Math.min(10, generatedCombinations.length);
    const activeCombinations = generatedCombinations.slice(0, Math.max(1, maxCombinationsToRun));

    const configuredSeedSources = SuspectedPiracyAdapter.getConfiguredSeedSources(params.seedSources);
    const o2tvSourceRecord = db.getDiscoverySourceById(O2TvSeriesAdapter.SOURCE_ID);
    const isO2TvEnabled = o2tvSourceRecord ? o2tvSourceRecord.enabled : true;

    const job: DiscoveryJob = {
      id: jobId,
      name: params.jobName,
      target_reference_id: params.targetReferenceId,
      provider: params.provider || 'ALL_SOURCES',
      query_params: JSON.stringify({
        keywords: effectiveKeywords,
        keywordCombinations: activeCombinations,
        seedSources: configuredSeedSources,
        configuredDiscoverySources: db.getDiscoverySources().map(s => ({ id: s.id, url: s.url, enabled: s.enabled })),
        referenceStatus: targetRef?.status,
        platform: targetRef?.platform,
        seasonEpisodeInfo: targetRef?.season_episode_info,
        filterDomain: params.filterDomain,
        presetMode: resolvedLimits.preset_mode,
        maxCandidates: requestedMax,
        maxUniqueCandidates: requestedMax,
        deepResearchLimit,
        forensicComparisonLimit,
        expandedFromJobId: params.expandedFromJobId,
        multiSource: true
      }),
      status: 'RUNNING',
      candidates_found: 0,
      started_at: now
    };

    db.insertDiscoveryJob(job);

    if (isO2TvEnabled && o2tvSourceRecord) {
      db.updateDiscoverySourceTelemetry(o2tvSourceRecord.id, {
        last_scan_at: now,
        last_scan_status: 'RUNNING'
      });
    }

    try {
      // 1a. Visual frame & fingerprint-based discovery search ('frame_search')
      const frameSearchItems: DiscoveredItem[] = params.targetReferenceId
        ? this.executeFrameFingerprintSearch(params.targetReferenceId)
        : [];

      // 1b. Live multi-source discovery across modular adapters (including O2TvSeriesAdapter 'configured_website' & 'title_search')
      const adapterDiscovered = await AdapterRegistry.executeMultiSourceDiscovery(
        effectiveKeywords,
        {
          provider: params.provider,
          maxTotalCandidates: requestedMax,
          referenceTitle: refTitle,
          targetReferenceId: params.targetReferenceId,
          keywordCombinations: activeCombinations,
          seedSources: configuredSeedSources,
          o2tvEnabled: isO2TvEnabled,
          o2tvBaseUrlOverride: params.o2tvBaseUrlOverride
        }
      );

      // Combine all discovery mechanisms into the same unified run
      const rawDiscovered: DiscoveredItem[] = [
        ...adapterDiscovered,
        ...frameSearchItems,
        ...(params.additionalDiscoveredItems || [])
      ];

      const diagnostics = AdapterRegistry.getLastRunDiagnostics();
      const seedProbes = SuspectedPiracyAdapter.getLastSeedProbeResults();
      const o2tvTelemetry = AdapterRegistry.getO2TvSeriesAdapter().getLastTelemetry();

      // Step 1c: Deduplicate across all sources BEFORE counting unique candidates toward requestedMax
      const deduplicatedRawMap = new Map<string, DiscoveredItem>();
      let inMemoryDuplicatesMerged = 0;

      for (const item of rawDiscovered) {
        if (params.filterDomain && !item.domain.toLowerCase().includes(params.filterDomain.toLowerCase())) {
          continue;
        }
        const { normalizedUrl } = this.normalizeUrl(item.url);
        const normalizedMediaUrl = item.mediaUrl ? this.normalizeUrl(item.mediaUrl).normalizedUrl : '';
        if (referenceSourceUrl && normalizedUrl.toLowerCase() === referenceSourceUrl && !normalizedMediaUrl) {
          continue;
        }
        const dedupKey = `${normalizedUrl.toLowerCase()}||${normalizedMediaUrl.toLowerCase()}`;
        const existingItem = deduplicatedRawMap.get(dedupKey);
        if (!existingItem) {
          deduplicatedRawMap.set(dedupKey, item);
        } else {
          inMemoryDuplicatesMerged++;
          existingItem.matchedKeywords = Array.from(
            new Set([...(existingItem.matchedKeywords || []), ...(item.matchedKeywords || [])])
          );
          if (item.sourceType) {
            existingItem.sourceType = existingItem.sourceType
              ? existingItem.sourceType.includes(item.sourceType)
                ? existingItem.sourceType
                : `${existingItem.sourceType}, ${item.sourceType}`
              : item.sourceType;
          }
          if (item.matchMethod) {
            existingItem.matchMethod = existingItem.matchMethod
              ? existingItem.matchMethod.includes(item.matchMethod)
                ? existingItem.matchMethod
                : `${existingItem.matchMethod}, ${item.matchMethod}`
              : item.matchMethod;
          }
          if (item.referringPage) {
            existingItem.referringPage = existingItem.referringPage
              ? existingItem.referringPage.includes(item.referringPage)
                ? existingItem.referringPage
                : `${existingItem.referringPage}, ${item.referringPage}`
              : item.referringPage;
          }
          if (item.metadata) {
            existingItem.metadata = { ...(existingItem.metadata || {}), ...item.metadata };
          }
        }
      }

      const rejectedCandidates: Array<{
        url: string;
        title: string;
        platform: string;
        sourceCategory: string;
        referringPage?: string;
        identityRelationship: string;
        researchRelevanceScore: number;
        rejectionReason: string;
      }> = [];

      // Pre-evaluate and filter generic test / completely unrelated items, then rank before enforcing requestedMax
      const preEvaluatedItems: Array<{
        rawItem: DiscoveredItem;
        candidate: CandidateItem;
        preliminaryEval: ReturnType<typeof CandidateResearchEngine.evaluateCandidateAgainstTarget>;
      }> = [];

      for (const item of Array.from(deduplicatedRawMap.values())) {
        const { normalizedUrl, domain } = this.normalizeUrl(item.url);
        const normalizedMediaUrl = item.mediaUrl ? this.normalizeUrl(item.mediaUrl).normalizedUrl : undefined;

        const providerLabel: DiscoveryProvider =
          params.provider && params.provider !== 'ALL_SOURCES'
            ? params.provider
            : item.sourceCategory === 'YOUTUBE'
            ? 'YOUTUBE_PUBLIC'
            : item.sourceCategory === 'PUBLIC_PLATFORM'
            ? 'PUBLIC_PLATFORMS'
            : item.sourceCategory === 'STREAMING_SERVICE'
            ? 'STREAMING_SERVICES'
            : item.sourceCategory === 'SUSPECTED_PIRACY'
            ? 'SUSPECTED_PIRACY'
            : 'SEARCH_CRAWLER';

        const matchedKeywordsStr =
          item.matchedKeywords && item.matchedKeywords.length > 0
            ? item.matchedKeywords.join(', ')
            : effectiveKeywords;

        const sourceTypeVal = item.sourceType || (item.metadata?.configuredSource || item.metadata?.seedSource ? 'configured_website' : 'title_search');
        const matchMethodVal = item.matchMethod || (normalizedMediaUrl ? 'title_match, direct_media_link' : 'title_match');
        const matchedContentIdVal = item.matchedContentId || params.targetReferenceId;

        const candidate: CandidateItem = {
          id: `cand_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          job_id: jobId,
          reference_id: params.targetReferenceId,
          matched_content_id: matchedContentIdVal,
          source_type: sourceTypeVal,
          match_method: matchMethodVal,
          source_url: normalizedUrl,
          media_url: normalizedMediaUrl,
          original_url: item.originalUrl || item.url,
          final_url: item.finalUrl || normalizedUrl,
          final_domain: item.finalDomain || domain,
          referring_page: item.referringPage || `${item.platform || item.sourceCategory}`,
          matched_keywords: matchedKeywordsStr,
          crawl_status: item.crawlStatus || 'DISCOVERED',
          duplicate_count: 0,
          candidate_classification: item.candidateClassification || (item.assetKind === 'VERIFIED_VIDEO_ASSET' ? 'VERIFIED_VIDEO_ASSET' : 'GENERAL_WEBPAGE'),
          canonical_url: normalizedUrl,
          platform: item.platform || domain,
          acquisition_status: 'DISCOVERED_UNVERIFIED',
          domain,
          discovered_title: item.title,
          discovery_provider: providerLabel,
          source_category: item.sourceCategory,
          asset_kind: item.assetKind,
          discovered_at: new Date().toISOString(),
          pipeline_status: 'DISCOVERED',
          reachability_code: 0,
          reachability_latency_ms: 0,
          media_type: item.suggestedType || 'UNKNOWN',
          is_live_stream: item.isLive || false,
          verification_logs: `[Discovery] Unified sweep via ${sourceTypeVal} (${item.platform || item.sourceCategory}, domain=${domain}). Source URL: ${normalizedUrl}${normalizedMediaUrl ? ` | Media URL: ${normalizedMediaUrl}` : ''}. Match method: ${matchMethodVal}. Matched keywords: "${matchedKeywordsStr}". Referring source: ${item.referringPage || 'Live Index'}.`
        };

        const preliminaryEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
          candidate,
          reference: targetRef,
          fallbackQuery: effectiveKeywords,
          pageDescription: item.metadata?.descriptionSnippet || item.metadata?.description || undefined
        });

        const genericTestCheck = CandidateResearchEngine.isGenericPlatformTestVideo(
          `${item.title || ''} ${normalizedUrl}`,
          `${refTitle || ''} ${effectiveKeywords}`
        );

        // Reject generic platform test videos and completely unrelated search items from being promoted as relevant candidates
        if (
          genericTestCheck.isGenericTest ||
          (preliminaryEval.identity_relationship === 'UNRELATED_CONTENT' &&
            !sourceTypeVal.includes('frame_search') &&
            !sourceTypeVal.includes('configured_website') &&
            !item.metadata?.configuredSource)
        ) {
          rejectedCandidates.push({
            url: normalizedUrl,
            title: item.title,
            platform: item.platform || domain,
            sourceCategory: item.sourceCategory,
            referringPage: item.referringPage || `${item.platform || item.sourceCategory}`,
            identityRelationship: preliminaryEval.identity_relationship,
            researchRelevanceScore: preliminaryEval.research_relevance_score,
            rejectionReason:
              genericTestCheck.reason ||
              preliminaryEval.contradictory_evidence[0] ||
              preliminaryEval.ranking_explanation ||
              'Candidate is unrelated to the registered target investigation.'
          });
          continue;
        }

        candidate.research_relevance_score = preliminaryEval.research_relevance_score;
        candidate.identity_relationship = preliminaryEval.identity_relationship;
        preEvaluatedItems.push({ rawItem: item, candidate, preliminaryEval });
      }

      // Sort deduplicated candidates by target relevance before applying the unique candidate limit (requestedMax)
      preEvaluatedItems.sort((a, b) => {
        const ranked = CandidateResearchEngine.rankCandidates([a.candidate, b.candidate]);
        return ranked[0] === a.candidate ? -1 : 1;
      });

      const cappedUniqueItems = preEvaluatedItems.slice(0, requestedMax);

      const processedCandidateIds = new Set<string>();
      const processedCandidates: CandidateItem[] = [];
      let o2tvDuplicatesMerged = 0;
      let totalDuplicatesMerged = inMemoryDuplicatesMerged;
      let reusedCachedResearchCount = 0;
      let newlyResearchedCount = 0;
      let awaitingResearchRetainedCount = 0;
      const o2tvCandidateIds = new Set<string>();

      // Persist unique candidates and prioritize top deepResearchLimit for Deep Research
      for (let idx = 0; idx < cappedUniqueItems.length; idx++) {
        const { rawItem: item, candidate, preliminaryEval } = cappedUniqueItems[idx];
        const isWithinResearchBudget = idx < deepResearchLimit;

        if (isWithinResearchBudget) {
          candidate.candidate_research = preliminaryEval;
          candidate.detected_identity_json = JSON.stringify(preliminaryEval);
          candidate.research_stage = 'RESEARCHED';
          candidate.verification_logs = `${candidate.verification_logs}\n[Target Relevance] ${preliminaryEval.ranking_explanation}`;
        } else {
          // Retain lower-ranked candidates beyond deepResearchLimit without discarding them!
          candidate.research_stage = 'AWAITING_RESEARCH';
          candidate.comparison_stage = 'DEFERRED_BY_LIMIT';
          candidate.verification_logs = `${candidate.verification_logs}\n[Research Prioritization] Retained in AWAITING_RESEARCH (rank #${idx + 1} exceeds Deep Research Limit of ${deepResearchLimit}). Expand investigation or continue research to evaluate.`;
        }

        const upsertRes = db.upsertCandidateWithResult(candidate);
        if (upsertRes.merged) {
          totalDuplicatesMerged++;
        }

        const isFromO2Tv =
          candidate.domain.includes('o2tvseries') ||
          Boolean(item.metadata?.configuredSource) ||
          (params.o2tvBaseUrlOverride && candidate.source_url.startsWith(params.o2tvBaseUrlOverride.replace(/\/+$/, '')));

        if (isFromO2Tv) {
          o2tvCandidateIds.add(upsertRes.candidateId);
          if (upsertRes.merged) {
            o2tvDuplicatesMerged++;
          }
        }

        if (!processedCandidateIds.has(upsertRes.candidateId)) {
          processedCandidateIds.add(upsertRes.candidateId);
          const stored = db.getCandidateById(upsertRes.candidateId);
          if (stored) {
            if (upsertRes.merged && stored.research_stage === 'RESEARCHED' && stored.detected_identity_json) {
              reusedCachedResearchCount++;
            } else if (isWithinResearchBudget) {
              db.updateCandidateVerification(stored.id, {
                research_stage: 'RESEARCHED',
                candidate_research: preliminaryEval,
                detected_identity_json: JSON.stringify(preliminaryEval),
                research_relevance_score: preliminaryEval.research_relevance_score,
                identity_relationship: preliminaryEval.identity_relationship
              });
              newlyResearchedCount++;
            } else if (stored.research_stage !== 'RESEARCHED') {
              db.updateCandidateVerification(stored.id, {
                research_stage: 'AWAITING_RESEARCH',
                comparison_stage: 'DEFERRED_BY_LIMIT'
              });
              awaitingResearchRetainedCount++;
            }
            const refreshed = db.getCandidateById(upsertRes.candidateId);
            if (refreshed) processedCandidates.push(refreshed);
          }
        }
      }

      // Rank processedCandidates by relevance and prioritize top forensicComparisonLimit for Forensic Verification
      const rankedForComparison = CandidateResearchEngine.rankCandidates(processedCandidates);
      let comparedInRunOrCached = 0;
      let reusedCachedComparisonCount = 0;
      let newlyComparedCount = 0;
      let queuedForComparisonCount = 0;

      for (const cand of rankedForComparison) {
        if (cand.research_stage === 'AWAITING_RESEARCH') {
          continue;
        }
        const isAlreadyCompared =
          cand.comparison_stage === 'COMPARED' &&
          (cand.pipeline_status === 'ANALYZED' || Boolean(cand.last_inspected_at));

        if (isAlreadyCompared) {
          comparedInRunOrCached++;
          reusedCachedComparisonCount++;
          continue;
        }

        if (params.autoVerify !== false && comparedInRunOrCached < forensicComparisonLimit) {
          comparedInRunOrCached++;
          try {
            await VerifierEngine.verifyCandidate(cand.id, {
              targetReferenceId: params.targetReferenceId
            });
            db.updateCandidateVerification(cand.id, {
              comparison_stage: 'COMPARED'
            });
            newlyComparedCount++;
          } catch (verErr: any) {
            console.warn(`[Auto-Verify] Candidate ${cand.id} error:`, verErr.message);
            db.updateCandidateVerification(cand.id, {
              comparison_stage: 'COMPARED'
            });
          }
        } else {
          // Retain candidate in QUEUED_FOR_COMPARISON so expanding or continuing the investigation processes it
          db.updateCandidateVerification(cand.id, {
            comparison_stage: 'QUEUED_FOR_COMPARISON'
          });
          queuedForComparisonCount++;
        }
      }

      // 3. Update Persistent Discovery Source Telemetry (https://o2tvseries4u.com/ and seed sources)
      if (isO2TvEnabled && o2tvSourceRecord && o2tvTelemetry) {
        let acqSucceeded = 0;
        let acqRestricted = 0;
        let framesExtracted = 0;
        let fingerprintedCount = 0;
        const failureReasons = [...o2tvTelemetry.failureReasons];

        for (const cid of Array.from(o2tvCandidateIds)) {
          const verifiedCand = db.getCandidateById(cid);
          if (!verifiedCand) continue;
          if (verifiedCand.pipeline_status === 'ACQUIRED' || verifiedCand.pipeline_status === 'ANALYZED') {
            acqSucceeded++;
          } else if (
            verifiedCand.pipeline_status === 'BLOCKED' ||
            verifiedCand.pipeline_status === 'DRM_PROTECTED' ||
            verifiedCand.pipeline_status === 'REQUIRES_AUTHENTICATION' ||
            verifiedCand.pipeline_status === 'UNREACHABLE'
          ) {
            acqRestricted++;
            const lastLogLine = verifiedCand.verification_logs?.split('\n').find(l => l.includes('CAPTCHA') || l.includes('restriction') || l.includes('HTTP 403') || l.includes('Not acquirable'));
            if (lastLogLine && !failureReasons.includes(lastLogLine)) {
              failureReasons.push(lastLogLine);
            }
          }
          const frameCount = verifiedCand.captured_frames?.length || db.getCandidateFingerprints(cid).length;
          if (frameCount > 0) {
            framesExtracted += frameCount;
            fingerprintedCount++;
          }
        }

        const outcomeSummary = `${o2tvTelemetry.scanOutcome} Merged ${o2tvDuplicatesMerged} duplicate(s). Media acquisition: ${acqSucceeded} acquired (${framesExtracted} frame(s) extracted across ${fingerprintedCount} fingerprinted asset(s)), ${acqRestricted} restricted/blocked.`;

        db.updateDiscoverySourceTelemetry(o2tvSourceRecord.id, {
          last_scan_at: new Date().toISOString(),
          last_scan_status: o2tvTelemetry.scanStatus,
          last_scan_outcome: outcomeSummary,
          pages_inspected: o2tvTelemetry.pagesInspected,
          inspected_urls_json: JSON.stringify(o2tvTelemetry.inspectedUrls),
          candidates_discovered: o2tvTelemetry.candidatesDiscovered,
          direct_media_found: o2tvTelemetry.directMediaFound,
          duplicates_merged: o2tvDuplicatesMerged,
          acquisitions_succeeded: acqSucceeded,
          acquisitions_restricted: acqRestricted,
          frames_extracted: framesExtracted,
          fingerprinted_count: fingerprintedCount,
          failure_reasons_json: JSON.stringify(failureReasons)
        });
      }

      // Also update telemetry for other seed sources (kickasstorrents.io, unblockit.li)
      for (const probe of seedProbes) {
        const srcRec = db.getDiscoverySourceByUrl(probe.seedUrl);
        if (srcRec && srcRec.id !== O2TvSeriesAdapter.SOURCE_ID) {
          db.updateDiscoverySourceTelemetry(srcRec.id, {
            last_scan_at: probe.checkedAt,
            last_scan_status:
              probe.crawlStatus === 'ACCESSIBLE' || probe.crawlStatus === 'REDIRECTED_ACCESSIBLE'
                ? 'COMPLETED'
                : probe.crawlStatus === 'ACCESS_RESTRICTED' || probe.crawlStatus === 'BLOCKED'
                ? 'RESTRICTED'
                : 'FAILED',
            last_scan_outcome: `${probe.seedUrl} -> ${probe.finalDomain} [${probe.crawlStatus}${probe.httpStatus ? ` HTTP ${probe.httpStatus}` : ''}]${probe.restrictionReason ? `: ${probe.restrictionReason}` : ''}`,
            pages_inspected: 1,
            inspected_urls_json: JSON.stringify([probe.finalUrl || probe.seedUrl]),
            failure_reasons_json: probe.restrictionReason ? JSON.stringify([probe.restrictionReason]) : JSON.stringify([])
          });
        }
      }

      const diagnosticSummary = diagnostics
        .map(d => `[${d.sourceCategory}] ${d.message}`)
        .join(' • ');

      const updatedQueryParams = JSON.stringify({
        keywords: effectiveKeywords,
        keywordCombinations: activeCombinations,
        seedSources: configuredSeedSources,
        seedProbes,
        o2tvTelemetry,
        frameSearchMatches: frameSearchItems.length,
        filterDomain: params.filterDomain,
        presetMode: resolvedLimits.preset_mode,
        maxCandidates: requestedMax,
        maxUniqueCandidates: requestedMax,
        deepResearchLimit,
        forensicComparisonLimit,
        expandedFromJobId: params.expandedFromJobId,
        rawDiscoveredCount: rawDiscovered.length,
        duplicatesMergedCount: totalDuplicatesMerged,
        uniqueCandidatesCount: processedCandidates.length,
        reusedCachedResearchCount,
        newlyResearchedCount,
        awaitingResearchRetainedCount,
        reusedCachedComparisonCount,
        newlyComparedCount,
        queuedForComparisonCount,
        rejectedCandidatesCount: rejectedCandidates.length,
        rejectedCandidates,
        diagnostics
      });

      const completedAt = new Date().toISOString();
      const diagnosticMessage =
        processedCandidates.length === 0
          ? `0 candidates found. ${diagnosticSummary || 'No matching public results returned by live providers.'}`
          : diagnosticSummary || undefined;

      db.updateDiscoveryJob(jobId, {
        status: 'COMPLETED',
        query_params: updatedQueryParams,
        candidates_found: processedCandidates.length,
        completed_at: completedAt,
        error_message: diagnosticMessage
      });

      // Persist a SearchCoverageSnapshot for historical comparison across investigations and over time
      try {
        SearchCoverageEngine.recordCoverageSnapshot({
          jobId,
          referenceId: params.targetReferenceId,
          limits: resolvedLimits
        });
      } catch (snapErr: any) {
        console.warn('[Coverage Snapshot Notice]', snapErr.message);
      }

      return {
        ...job,
        query_params: updatedQueryParams,
        status: 'COMPLETED',
        candidates_found: processedCandidates.length,
        completed_at: completedAt,
        error_message: diagnosticMessage
      };
    } catch (err: any) {
      console.error('[Discovery Engine Error]', err);
      const completedAt = new Date().toISOString();
      db.updateDiscoveryJob(jobId, {
        status: 'FAILED',
        error_message: err.message || 'Discovery sweep execution failed',
        completed_at: completedAt
      });

      return {
        ...job,
        status: 'FAILED',
        error_message: err.message,
        completed_at: completedAt
      };
    }
  }

  /**
   * Triggers a scan or retry of a specific configured discovery source (e.g. src_o2tvseries4u)
   * and returns the updated DiscoverySourceRecord along with the discovery job.
   */
  public static async scanConfiguredSource(
    sourceId: string,
    options: {
      targetReferenceId?: string;
      queryKeywords?: string;
      baseUrlOverride?: string;
      autoVerify?: boolean;
    } = {}
  ): Promise<{ source: DiscoverySourceRecord; job: DiscoveryJob; candidates: CandidateItem[] }> {
    const src = db.getDiscoverySourceById(sourceId);
    if (!src) {
      throw new Error(`Discovery source "${sourceId}" not found.`);
    }

    const refs = db.getReferences();
    const targetRef = options.targetReferenceId
      ? db.getReferenceById(options.targetReferenceId)
      : refs.find(r => r.title.toLowerCase().includes('modern family')) || refs[0] || null;

    const queryKeywords =
      options.queryKeywords?.trim() ||
      (targetRef ? `${targetRef.title}${targetRef.season_episode_info ? ` ${targetRef.season_episode_info}` : ''}` : 'Modern Family S01E01');

    // Temporarily ensure the source is enabled for this explicit scan/retry
    if (!src.enabled) {
      db.toggleDiscoverySource(src.id, true);
    }

    const job = await this.executeDiscoverySweep({
      jobName: `Configured Source Scan: ${src.name} (${queryKeywords})`,
      provider: 'SUSPECTED_PIRACY',
      targetReferenceId: targetRef?.id,
      queryKeywords,
      maxCandidates: 15,
      autoVerify: options.autoVerify !== false,
      o2tvBaseUrlOverride: options.baseUrlOverride || (src.id === O2TvSeriesAdapter.SOURCE_ID ? src.url : undefined)
    });

    const updatedSource = db.getDiscoverySourceById(src.id)!;
    const candidates = db.getCandidates(targetRef ? { referenceId: targetRef.id } : undefined);

    return {
      source: updatedSource,
      job,
      candidates
    };
  }

  /**
   * Expands an existing investigation or continues incomplete research/forensic comparison:
   * - Reuses cached research (RESEARCHED) and cached forensic comparisons (COMPARED) so completed work is never repeated.
   * - Processes previously deferred AWAITING_RESEARCH candidates up to the new deepResearchLimit.
   * - Processes previously deferred QUEUED_FOR_COMPARISON / DEFERRED_BY_LIMIT candidates up to the new forensicComparisonLimit.
   * - Optionally runs additional multi-source discovery queries when maxUniqueCandidates is increased.
   */
  public static async expandInvestigation(options: {
    jobId?: string;
    referenceId?: string;
    presetMode?: DiscoveryPresetMode;
    maxUniqueCandidates?: number;
    deepResearchLimit?: number;
    forensicComparisonLimit?: number;
    runAdditionalDiscovery?: boolean;
    autoVerify?: boolean;
    additionalDiscoveredItems?: DiscoveredItem[];
  }): Promise<{
    job: DiscoveryJob | null;
    reusedResearchCount: number;
    newlyResearchedCount: number;
    reusedComparisonCount: number;
    newlyComparedCount: number;
    awaitingResearchRemaining: number;
    queuedComparisonRemaining: number;
    coverageReport: SearchCoverageReport;
  }> {
    const existingJobs = db.getDiscoveryJobs();
    const baseJob = options.jobId
      ? db.getDiscoveryJobById(options.jobId)
      : options.referenceId
      ? existingJobs.find(j => j.target_reference_id === options.referenceId) || null
      : existingJobs[0] || null;

    let baseParams: any = {};
    if (baseJob?.query_params) {
      try {
        baseParams = JSON.parse(baseJob.query_params);
      } catch {}
    }

    const targetRefId = options.referenceId || baseJob?.target_reference_id;
    const targetRef = targetRefId ? db.getReferenceById(targetRefId) : null;

    const resolvedLimits = SearchCoverageEngine.resolveDiscoveryLimits({
      presetMode: options.presetMode || baseParams.presetMode || 'DEEP',
      maxUniqueCandidates: options.maxUniqueCandidates ?? baseParams.maxUniqueCandidates ?? baseParams.maxCandidates ?? 500,
      deepResearchLimit: options.deepResearchLimit ?? baseParams.deepResearchLimit ?? 200,
      forensicComparisonLimit: options.forensicComparisonLimit ?? baseParams.forensicComparisonLimit ?? 100
    });

    let updatedJob: DiscoveryJob | null = baseJob;

    // 1. If requested or if additionalDiscoveredItems are provided, execute expanded discovery sweep
    if (options.runAdditionalDiscovery || (options.additionalDiscoveredItems && options.additionalDiscoveredItems.length > 0)) {
      const kw =
        baseParams.keywords ||
        (targetRef ? `${targetRef.title}${targetRef.season_episode_info ? ` ${targetRef.season_episode_info}` : ''}` : 'Modern Family');
      updatedJob = await this.executeDiscoverySweep({
        jobName: `Expanded Sweep (${resolvedLimits.preset_mode} • ${resolvedLimits.max_unique_candidates}): ${targetRef?.title || kw}`,
        provider: baseJob?.provider || 'ALL_SOURCES',
        targetReferenceId: targetRefId,
        queryKeywords: kw,
        filterDomain: baseParams.filterDomain,
        presetMode: resolvedLimits.preset_mode,
        maxUniqueCandidates: resolvedLimits.max_unique_candidates,
        deepResearchLimit: resolvedLimits.deep_research_limit,
        forensicComparisonLimit: resolvedLimits.forensic_comparison_limit,
        autoVerify: options.autoVerify !== false,
        expandedFromJobId: baseJob?.id,
        additionalDiscoveredItems: options.additionalDiscoveredItems
      });
    }

    // 2. Process existing candidates in SQLite for this reference/investigation without repeating completed work
    const batchResult = await this.researchAndCompareCandidates({
      referenceId: targetRefId,
      deepResearchLimit: resolvedLimits.deep_research_limit,
      forensicComparisonLimit: resolvedLimits.forensic_comparison_limit,
      runDeepResearch: true,
      runForensicComparison: options.autoVerify !== false
    });

    // Update the job record with the new limits if we didn't spawn a new job
    if (updatedJob && !options.runAdditionalDiscovery) {
      const nextParams = {
        ...baseParams,
        presetMode: resolvedLimits.preset_mode,
        maxCandidates: resolvedLimits.max_unique_candidates,
        maxUniqueCandidates: resolvedLimits.max_unique_candidates,
        deepResearchLimit: resolvedLimits.deep_research_limit,
        forensicComparisonLimit: resolvedLimits.forensic_comparison_limit,
        lastExpandedAt: new Date().toISOString()
      };
      db.updateDiscoveryJob(updatedJob.id, {
        query_params: JSON.stringify(nextParams)
      });
      updatedJob = db.getDiscoveryJobById(updatedJob.id);
    }

    // Record a fresh coverage snapshot
    SearchCoverageEngine.recordCoverageSnapshot({
      jobId: updatedJob?.id,
      referenceId: targetRefId,
      limits: resolvedLimits
    });

    const coverageReport = SearchCoverageEngine.generateCoverageReport({
      referenceId: targetRefId,
      jobId: updatedJob?.id,
      limitsOverride: resolvedLimits
    });

    return {
      job: updatedJob,
      reusedResearchCount: batchResult.reusedResearchCount,
      newlyResearchedCount: batchResult.newlyResearchedCount,
      reusedComparisonCount: batchResult.reusedComparisonCount,
      newlyComparedCount: batchResult.newlyComparedCount,
      awaitingResearchRemaining: coverageReport.candidate_lifecycle.awaiting_research_count,
      queuedComparisonRemaining: coverageReport.candidate_lifecycle.queued_for_comparison_count,
      coverageReport
    };
  }

  /**
   * Researches and/or forensically compares selected or awaiting candidates, reusing cached
   * research and comparison results so completed work is never repeated.
   */
  public static async researchAndCompareCandidates(options: {
    candidateIds?: string[];
    referenceId?: string;
    deepResearchLimit?: number;
    forensicComparisonLimit?: number;
    runDeepResearch?: boolean;
    runForensicComparison?: boolean;
  }): Promise<{
    reusedResearchCount: number;
    newlyResearchedCount: number;
    reusedComparisonCount: number;
    newlyComparedCount: number;
    processedCandidates: CandidateItem[];
  }> {
    const deepLimit = Math.max(1, Math.min(1000, options.deepResearchLimit ?? 200));
    const compareLimit = Math.max(1, Math.min(1000, options.forensicComparisonLimit ?? 100));
    const explicitSelection = Array.isArray(options.candidateIds) && options.candidateIds.length > 0;

    let candidates = db.getCandidates(
      options.referenceId ? { referenceId: options.referenceId } : undefined
    );
    if (explicitSelection) {
      const idSet = new Set(options.candidateIds);
      candidates = candidates.filter(c => idSet.has(c.id));
    }

    candidates = CandidateResearchEngine.rankCandidates(candidates);

    let reusedResearchCount = 0;
    let newlyResearchedCount = 0;
    let reusedComparisonCount = 0;
    let newlyComparedCount = 0;

    // 1. Deep Research pass
    if (options.runDeepResearch !== false) {
      let totalResearchedSoFar = candidates.filter(c => SearchCoverageEngine.isCandidateResearched(c)).length;

      for (const cand of candidates) {
        const alreadyResearched = SearchCoverageEngine.isCandidateResearched(cand);
        if (alreadyResearched) {
          reusedResearchCount++;
          continue;
        }
        if (!explicitSelection && totalResearchedSoFar >= deepLimit) {
          continue;
        }

        const refId = cand.reference_id || cand.matched_content_id || options.referenceId;
        const targetRef = refId ? db.getReferenceById(refId) : null;
        let webpageMeta = null;
        if (cand.source_url && /^https?:\/\//i.test(cand.source_url)) {
          try {
            webpageMeta = await CandidateResearchEngine.fetchWebpageResearchMetadata(cand.source_url, 2500);
          } catch {}
        }

        const evalRes = CandidateResearchEngine.evaluateCandidateAgainstTarget({
          candidate: cand,
          reference: targetRef,
          webpageMetadata: webpageMeta
        });

        db.updateCandidateVerification(cand.id, {
          research_stage: 'RESEARCHED',
          comparison_stage: cand.comparison_stage === 'DEFERRED_BY_LIMIT' ? 'QUEUED_FOR_COMPARISON' : cand.comparison_stage,
          candidate_research: evalRes,
          detected_identity_json: JSON.stringify(evalRes),
          research_relevance_score: evalRes.research_relevance_score,
          identity_relationship: evalRes.identity_relationship,
          verification_logs: `${cand.verification_logs || ''}\n[Deep Research Completed] ${evalRes.ranking_explanation}`
        });

        totalResearchedSoFar++;
        newlyResearchedCount++;
      }
    }

    // Reload and re-rank after research
    let refreshedCandidates = db.getCandidates(
      options.referenceId ? { referenceId: options.referenceId } : undefined
    );
    if (explicitSelection) {
      const idSet = new Set(options.candidateIds);
      refreshedCandidates = refreshedCandidates.filter(c => idSet.has(c.id));
    }
    refreshedCandidates = CandidateResearchEngine.rankCandidates(refreshedCandidates);

    // 2. Forensic Comparison pass
    if (options.runForensicComparison !== false) {
      let totalComparedSoFar = refreshedCandidates.filter(c =>
        SearchCoverageEngine.isCandidateForensicallyCompared(c)
      ).length;

      for (const cand of refreshedCandidates) {
        if (!explicitSelection && !SearchCoverageEngine.isCandidateRelevant(cand)) {
          continue;
        }
        if (!explicitSelection && !SearchCoverageEngine.isCandidateResearched(cand)) {
          continue;
        }

        const alreadyCompared = SearchCoverageEngine.isCandidateForensicallyCompared(cand);
        if (alreadyCompared) {
          reusedComparisonCount++;
          continue;
        }

        if (!explicitSelection && totalComparedSoFar >= compareLimit) {
          if (cand.comparison_stage !== 'QUEUED_FOR_COMPARISON') {
            db.updateCandidateVerification(cand.id, {
              comparison_stage: 'QUEUED_FOR_COMPARISON'
            });
          }
          continue;
        }

        try {
          await VerifierEngine.verifyCandidate(cand.id, {
            targetReferenceId: cand.reference_id || options.referenceId
          });
          db.updateCandidateVerification(cand.id, {
            comparison_stage: 'COMPARED'
          });
          totalComparedSoFar++;
          newlyComparedCount++;
        } catch (err: any) {
          db.updateCandidateVerification(cand.id, {
            comparison_stage: 'COMPARED'
          });
          totalComparedSoFar++;
          newlyComparedCount++;
        }
      }
    }

    const finalCandidates = db.getCandidates(
      options.referenceId ? { referenceId: options.referenceId } : undefined
    );

    return {
      reusedResearchCount,
      newlyResearchedCount,
      reusedComparisonCount,
      newlyComparedCount,
      processedCandidates: explicitSelection
        ? finalCandidates.filter(c => options.candidateIds!.includes(c.id))
        : finalCandidates
    };
  }
}
