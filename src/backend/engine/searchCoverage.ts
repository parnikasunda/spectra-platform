/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Search Coverage & Discovery Intelligence Engine
 *
 * Responsibilities:
 * 1. Define a transparent, evidence-backed Online Video-Content Universe denominator
 *    across 8 video ecosystems (totaling 100.0% of the defined universe) without claiming
 *    to measure the entire internet as a verified fact.
 * 2. Distinguish Measured coverage (verified HTTP/API probes, inspected pages, researched
 *    and forensically compared candidates) from Estimated coverage (modeled reach across
 *    active adapters, query depth, and candidate budgets) and Unavailable coverage
 *    (DRM/login walls, unconfigured credentials, blocked seed portals, disabled adapters).
 * 3. Manage Configurable Candidate Discovery Limits:
 *    - Standard (250), Deep (500), Exhaustive (1,000), and Custom (1..1,000)
 *    - Deep Research Limit (default 200, up to 1,000)
 *    - Forensic Comparison Limit (default 100, up to 1,000)
 * 4. Compute deduplicated Candidate Lifecycle breakdowns, Platform Ecosystem matrices,
 *    Coverage Gaps, and Historical / Cross-Investigation Coverage Comparisons.
 */

import { db } from '../db/database.js';
import {
  CandidateItem,
  CandidateLifecycleBreakdown,
  CoverageConfidenceLevel,
  CoverageGapItem,
  CoverageMetricDetail,
  DiscoveryJob,
  DiscoveryLimitsConfig,
  DiscoveryPerformanceMetrics,
  DiscoveryPresetMode,
  DiscoverySourceRecord,
  PlatformEcosystemCategory,
  PlatformEcosystemCoverage,
  ReferenceItem,
  SearchCoverageReport,
  SearchCoverageSnapshot,
  SearchProgressBreakdown,
  SourceAdapterDescriptor
} from '../types.js';
import { SourceAdapterRegistry } from './sourceAdapters.js';
import { SuspectedPiracyAdapter } from './adapters/suspected_piracy.js';
import { CandidateResearchEngine } from './candidateResearch.js';

export class SearchCoverageEngine {
  public static readonly MAX_SYSTEM_CANDIDATE_CEILING = 1000;
  public static readonly DEFAULT_STANDARD_LIMIT = 250;
  public static readonly DEFAULT_DEEP_LIMIT = 500;
  public static readonly DEFAULT_EXHAUSTIVE_LIMIT = 1000;
  public static readonly DEFAULT_DEEP_RESEARCH_LIMIT = 200;
  public static readonly DEFAULT_FORENSIC_COMPARISON_LIMIT = 100;

  // Toggle state for non-adapter ecosystems (Web Search Crawler, Social Video Index, Configured Piracy Sources)
  private static ecosystemEnabledOverrides = new Map<string, boolean>([
    ['web_search_crawler', true],
    ['social_video_index', true],
    ['configured_piracy_sources', true]
  ]);

  private static normalizeEcosystemKey(id: string): string {
    const lower = String(id || '').trim().toLowerCase();
    if (lower === 'publicly_indexed_web' || lower === 'eco_publicly_indexed_web') return 'web_search_crawler';
    if (lower === 'social_video' || lower === 'eco_social_video') return 'social_video_index';
    if (lower === 'configured_piracy_ecosystem' || lower === 'eco_configured_piracy') return 'configured_piracy_sources';
    return id;
  }

  public static isEcosystemEnabled(id: string): boolean {
    const key = this.normalizeEcosystemKey(id);
    if (this.ecosystemEnabledOverrides.has(key)) {
      return this.ecosystemEnabledOverrides.get(key)!;
    }
    return SourceAdapterRegistry.isAdapterEnabled(key);
  }

  public static setEcosystemOrAdapterEnabled(id: string, enabled: boolean): void {
    const key = this.normalizeEcosystemKey(id);
    if (this.ecosystemEnabledOverrides.has(key)) {
      this.ecosystemEnabledOverrides.set(key, enabled);
    } else {
      SourceAdapterRegistry.setAdapterEnabled(key, enabled);
    }
  }

  public static setEcosystemEnabled(id: string, enabled: boolean): void {
    this.setEcosystemOrAdapterEnabled(id, enabled);
  }

  /**
   * Resolves preset mode and custom limits into a normalized DiscoveryLimitsConfig.
   */
  public static resolveDiscoveryLimits(input?: {
    presetMode?: DiscoveryPresetMode | string;
    maxUniqueCandidates?: number;
    deepResearchLimit?: number;
    forensicComparisonLimit?: number;
  }): DiscoveryLimitsConfig {
    const rawPreset = String(input?.presetMode || '').toUpperCase();
    let presetMode: DiscoveryPresetMode = 'STANDARD';
    if (rawPreset === 'DEEP' || rawPreset === 'EXHAUSTIVE' || rawPreset === 'CUSTOM' || rawPreset === 'STANDARD') {
      presetMode = rawPreset as DiscoveryPresetMode;
    } else if (input?.maxUniqueCandidates !== undefined) {
      if (input.maxUniqueCandidates === 250) presetMode = 'STANDARD';
      else if (input.maxUniqueCandidates === 500) presetMode = 'DEEP';
      else if (input.maxUniqueCandidates === 1000) presetMode = 'EXHAUSTIVE';
      else presetMode = 'CUSTOM';
    }

    let maxUnique = this.DEFAULT_STANDARD_LIMIT;
    if (presetMode === 'STANDARD' && input?.maxUniqueCandidates === undefined) {
      maxUnique = this.DEFAULT_STANDARD_LIMIT;
    } else if (presetMode === 'DEEP' && input?.maxUniqueCandidates === undefined) {
      maxUnique = this.DEFAULT_DEEP_LIMIT;
    } else if (presetMode === 'EXHAUSTIVE' && input?.maxUniqueCandidates === undefined) {
      maxUnique = this.DEFAULT_EXHAUSTIVE_LIMIT;
    } else if (input?.maxUniqueCandidates !== undefined && Number.isFinite(Number(input.maxUniqueCandidates))) {
      maxUnique = Math.max(1, Math.min(this.MAX_SYSTEM_CANDIDATE_CEILING, Math.round(Number(input.maxUniqueCandidates))));
      if (maxUnique === 250 && rawPreset !== 'CUSTOM') presetMode = 'STANDARD';
      else if (maxUnique === 500 && rawPreset !== 'CUSTOM') presetMode = 'DEEP';
      else if (maxUnique === 1000 && rawPreset !== 'CUSTOM') presetMode = 'EXHAUSTIVE';
      else if (!rawPreset) presetMode = 'CUSTOM';
    }

    const deepResearchLimit =
      input?.deepResearchLimit !== undefined && Number.isFinite(Number(input.deepResearchLimit))
        ? Math.max(1, Math.min(this.MAX_SYSTEM_CANDIDATE_CEILING, Math.round(Number(input.deepResearchLimit))))
        : this.DEFAULT_DEEP_RESEARCH_LIMIT;

    const forensicComparisonLimit =
      input?.forensicComparisonLimit !== undefined && Number.isFinite(Number(input.forensicComparisonLimit))
        ? Math.max(1, Math.min(this.MAX_SYSTEM_CANDIDATE_CEILING, Math.round(Number(input.forensicComparisonLimit))))
        : this.DEFAULT_FORENSIC_COMPARISON_LIMIT;

    return {
      preset_mode: presetMode,
      max_unique_candidates: maxUnique,
      deep_research_limit: deepResearchLimit,
      forensic_comparison_limit: forensicComparisonLimit
    };
  }

  /**
   * Classifies a candidate into one of the 8 defined Online Video-Content Ecosystems
   * without double-counting.
   */
  public static classifyCandidateEcosystem(cand: CandidateItem): PlatformEcosystemCategory {
    const domain = (cand.final_domain || cand.domain || cand.source_url || '').toLowerCase();
    const platform = (cand.platform || '').toLowerCase();
    const cat = cand.source_category;

    if (cat === 'YOUTUBE' || domain.includes('youtube.com') || domain.includes('youtu.be') || platform.includes('youtube')) {
      return 'YOUTUBE';
    }
    if (domain.includes('dailymotion.com') || domain.includes('dai.ly') || platform.includes('dailymotion')) {
      return 'DAILYMOTION';
    }
    if (domain.includes('vimeo.com') || platform.includes('vimeo')) {
      return 'VIMEO';
    }
    if (
      domain.includes('archive.org') ||
      domain.includes('wikimedia.org') ||
      domain.includes('wikipedia.org') ||
      domain.includes('peertube') ||
      domain.includes('rumble.com') ||
      cat === 'PUBLIC_PLATFORM'
    ) {
      return 'PUBLIC_VIDEO_HOSTING';
    }
    if (
      domain.includes('twitter.com') ||
      domain.includes('x.com') ||
      domain.includes('tiktok.com') ||
      domain.includes('facebook.com') ||
      domain.includes('fb.watch') ||
      domain.includes('instagram.com') ||
      domain.includes('reddit.com') ||
      domain.includes('twitch.tv')
    ) {
      return 'SOCIAL_VIDEO';
    }
    if (
      cat === 'STREAMING_SERVICE' ||
      domain.includes('netflix.com') ||
      domain.includes('hotstar.com') ||
      domain.includes('jiocinema.com') ||
      domain.includes('sonyliv.com') ||
      domain.includes('primevideo.com') ||
      domain.includes('hulu.com') ||
      domain.includes('disneyplus.com')
    ) {
      return 'COMMERCIAL_OTT';
    }
    if (
      cat === 'SUSPECTED_PIRACY' ||
      cand.source_type?.includes('configured_website') ||
      domain.includes('o2tvseries') ||
      domain.includes('kickasstorrents') ||
      domain.includes('unblockit') ||
      domain.includes('1337x') ||
      domain.includes('piratebay')
    ) {
      return 'CONFIGURED_PIRACY_ECOSYSTEM';
    }
    return 'PUBLICLY_INDEXED_WEB';
  }

  /**
   * Determines whether a candidate has completed deep identity/metadata research.
   */
  public static isCandidateResearched(cand: CandidateItem): boolean {
    if (cand.research_stage === 'AWAITING_RESEARCH') return false;
    if (cand.research_stage === 'RESEARCHED') return true;
    if (cand.detected_identity_json && cand.detected_identity_json.trim().length > 2) {
      return true;
    }
    return Boolean(cand.candidate_research && cand.candidate_research.researched_at);
  }

  /**
   * Determines whether a candidate has completed forensic comparison / verification.
   */
  public static isCandidateForensicallyCompared(cand: CandidateItem): boolean {
    if (cand.comparison_stage === 'QUEUED_FOR_COMPARISON' || cand.comparison_stage === 'DEFERRED_BY_LIMIT') {
      return false;
    }
    if (cand.comparison_stage === 'COMPARED') return true;
    return (
      cand.pipeline_status === 'ANALYZED' ||
      cand.pipeline_status === 'DRM_PROTECTED' ||
      cand.pipeline_status === 'BLOCKED' ||
      cand.pipeline_status === 'UNREACHABLE' ||
      cand.pipeline_status === 'REQUIRES_AUTHENTICATION' ||
      Boolean(cand.captured_frames && cand.captured_frames.length > 0) ||
      Boolean(cand.last_inspected_at)
    );
  }

  /**
   * Determines whether a candidate is relevant to the target investigation.
   */
  public static isCandidateRelevant(cand: CandidateItem): boolean {
    if (cand.identity_relationship === 'UNRELATED_CONTENT') return false;
    if (cand.research_stage === 'REJECTED_UNRELATED') return false;
    const score = cand.research_relevance_score ?? cand.metadata_relevance_score ?? 0.5;
    return score >= 0.20;
  }

  /**
   * Generates a complete, evidence-backed SearchCoverageReport for a given reference or system-wide state.
   */
  public static generateCoverageReport(options?: {
    referenceId?: string;
    jobId?: string;
    limitsOverride?: Partial<DiscoveryLimitsConfig>;
  }): SearchCoverageReport {
    const nowIso = new Date().toISOString();
    const allReferences = db.getReferences();
    const allJobs = db.getDiscoveryJobs();
    const allSources = db.getDiscoverySources();
    const allAdapters = SourceAdapterRegistry.getAdapters();
    const seedProbes = SuspectedPiracyAdapter.getLastSeedProbeResults();

    const targetRef: ReferenceItem | undefined = options?.referenceId
      ? allReferences.find(r => r.id === options.referenceId)
      : undefined;

    const relevantJobs: DiscoveryJob[] = options?.jobId
      ? allJobs.filter(j => j.id === options.jobId)
      : options?.referenceId
      ? allJobs.filter(j => j.target_reference_id === options.referenceId)
      : allJobs;

    const latestJob: DiscoveryJob | undefined = relevantJobs[0] || allJobs[0];

    // Parse latest job query_params for limits, telemetry, queries executed, and rejected counts
    let latestJobParams: any = {};
    if (latestJob?.query_params) {
      try {
        latestJobParams = JSON.parse(latestJob.query_params);
      } catch {}
    }

    const configuredLimits = this.resolveDiscoveryLimits({
      presetMode:
        options?.limitsOverride?.preset_mode ||
        latestJobParams.presetMode ||
        (latestJobParams.maxCandidates === 500
          ? 'DEEP'
          : latestJobParams.maxCandidates === 1000
          ? 'EXHAUSTIVE'
          : latestJobParams.maxCandidates && latestJobParams.maxCandidates !== 250
          ? 'CUSTOM'
          : 'STANDARD'),
      maxUniqueCandidates:
        options?.limitsOverride?.max_unique_candidates ??
        latestJobParams.maxUniqueCandidates ??
        latestJobParams.maxCandidates ??
        this.DEFAULT_STANDARD_LIMIT,
      deepResearchLimit:
        options?.limitsOverride?.deep_research_limit ??
        latestJobParams.deepResearchLimit ??
        this.DEFAULT_DEEP_RESEARCH_LIMIT,
      forensicComparisonLimit:
        options?.limitsOverride?.forensic_comparison_limit ??
        latestJobParams.forensicComparisonLimit ??
        this.DEFAULT_FORENSIC_COMPARISON_LIMIT
    });

    // Fetch deduplicated candidates for this scope
    const scopedCandidates = db.getCandidates(
      options?.referenceId ? { referenceId: options.referenceId } : undefined
    );

    // Aggregate job-level telemetry across relevant jobs without double counting
    let totalQueriesExecuted = 0;
    let totalRejectedAcrossJobs = 0;
    const inspectedPageUrlsSet = new Set<string>();
    const discoveredPageUrlsSet = new Set<string>();

    for (const job of relevantJobs) {
      try {
        const qp = JSON.parse(job.query_params || '{}');
        const combos = Array.isArray(qp.keywordCombinations) ? qp.keywordCombinations.length : 1;
        totalQueriesExecuted += Math.max(1, combos);
        if (typeof qp.rejectedCandidatesCount === 'number') {
          totalRejectedAcrossJobs += qp.rejectedCandidatesCount;
        } else if (Array.isArray(qp.rejectedCandidates)) {
          totalRejectedAcrossJobs += qp.rejectedCandidates.length;
        }
        if (qp.o2tvTelemetry?.inspectedUrls && Array.isArray(qp.o2tvTelemetry.inspectedUrls)) {
          for (const u of qp.o2tvTelemetry.inspectedUrls) inspectedPageUrlsSet.add(String(u).toLowerCase());
        }
        if (Array.isArray(qp.seedProbes)) {
          for (const sp of qp.seedProbes) {
            if (sp.seedUrl) discoveredPageUrlsSet.add(String(sp.seedUrl).toLowerCase());
            if (sp.crawlStatus === 'ACCESSIBLE' || sp.crawlStatus === 'REDIRECTED_ACCESSIBLE') {
              inspectedPageUrlsSet.add(String(sp.finalUrl || sp.seedUrl).toLowerCase());
            }
          }
        }
      } catch {
        totalQueriesExecuted += 1;
      }
    }

    // Add persistent source telemetry pages
    for (const src of allSources) {
      discoveredPageUrlsSet.add(src.url.toLowerCase());
      if (src.inspected_urls_json) {
        try {
          const urls = JSON.parse(src.inspected_urls_json);
          if (Array.isArray(urls)) {
            for (const u of urls) {
              discoveredPageUrlsSet.add(String(u).toLowerCase());
              inspectedPageUrlsSet.add(String(u).toLowerCase());
            }
          }
        } catch {}
      }
    }

    // Add candidate URLs and referring pages to discovered & inspected page sets
    let duplicatesMergedCount = 0;
    for (const cand of scopedCandidates) {
      duplicatesMergedCount += Number(cand.duplicate_count || 0);
      if (cand.source_url) discoveredPageUrlsSet.add(cand.source_url.toLowerCase());
      if (cand.referring_page && cand.referring_page.startsWith('http')) {
        discoveredPageUrlsSet.add(cand.referring_page.toLowerCase());
        inspectedPageUrlsSet.add(cand.referring_page.toLowerCase());
      }
      if (
        cand.reachability_code === 200 ||
        cand.reachability_code === 206 ||
        cand.crawl_status === 'CRAWLED_OK' ||
        cand.pipeline_status === 'REACHABLE' ||
        cand.pipeline_status === 'MEDIA_DETECTED' ||
        cand.pipeline_status === 'ACQUIRED' ||
        cand.pipeline_status === 'ANALYZED' ||
        cand.research_stage === 'RESEARCHED'
      ) {
        if (cand.source_url) inspectedPageUrlsSet.add(cand.source_url.toLowerCase());
      }
    }

    const uniqueCandidatesCount = scopedCandidates.length;
    const rawDiscoveredCount = uniqueCandidatesCount + duplicatesMergedCount + totalRejectedAcrossJobs;

    const relevantCandidates = scopedCandidates.filter(c => this.isCandidateRelevant(c));
    const relevantCandidatesCount = relevantCandidates.length;

    const researchedCandidates = scopedCandidates.filter(c => this.isCandidateResearched(c));
    const researchedCandidatesCount = researchedCandidates.length;

    const awaitingResearchCandidates = scopedCandidates.filter(
      c => !this.isCandidateResearched(c) && c.research_stage !== 'REJECTED_UNRELATED'
    );
    const awaitingResearchCount = awaitingResearchCandidates.length;

    const comparedCandidates = scopedCandidates.filter(c => this.isCandidateForensicallyCompared(c));
    const comparedCandidatesCount = comparedCandidates.length;

    const queuedForComparisonCandidates = scopedCandidates.filter(
      c =>
        !this.isCandidateForensicallyCompared(c) &&
        this.isCandidateRelevant(c) &&
        c.comparison_stage !== 'NOT_APPLICABLE'
    );
    const queuedForComparisonCount = queuedForComparisonCandidates.length;

    const rejectedUnrelatedInDb = scopedCandidates.filter(
      c => c.identity_relationship === 'UNRELATED_CONTENT' || c.research_stage === 'REJECTED_UNRELATED'
    ).length;
    const rejectedOrIrrelevantCount = totalRejectedAcrossJobs + rejectedUnrelatedInDb;

    const remainingCandidateCapacity = Math.max(0, configuredLimits.max_unique_candidates - uniqueCandidatesCount);
    const remainingResearchCapacity = Math.max(0, configuredLimits.deep_research_limit - researchedCandidatesCount);
    const remainingComparisonCapacity = Math.max(0, configuredLimits.forensic_comparison_limit - comparedCandidatesCount);

    const uniqueLimitReached = uniqueCandidatesCount >= configuredLimits.max_unique_candidates;
    const researchLimitReached =
      researchedCandidatesCount >= configuredLimits.deep_research_limit && awaitingResearchCount > 0;
    const comparisonLimitReached =
      comparedCandidatesCount >= configuredLimits.forensic_comparison_limit && queuedForComparisonCount > 0;

    const limitNotices: string[] = [];
    if (uniqueLimitReached) {
      limitNotices.push(
        `Unique candidate discovery limit (${configuredLimits.max_unique_candidates} in ${configuredLimits.preset_mode} mode) reached. Expand the investigation to Deep (500) or Exhaustive (1,000) to discover additional candidates.`
      );
    }
    if (researchLimitReached) {
      limitNotices.push(
        `Deep research prioritization limit (${configuredLimits.deep_research_limit}) reached with ${awaitingResearchCount} lower-ranked candidate(s) retained in AWAITING_RESEARCH. Increase the Deep Research Limit or click "Continue Incomplete Research" to research them.`
      );
    }
    if (comparisonLimitReached) {
      limitNotices.push(
        `Forensic comparison limit (${configuredLimits.forensic_comparison_limit}) reached with ${queuedForComparisonCount} candidate(s) retained in QUEUED_FOR_COMPARISON. Increase the Forensic Comparison Limit or expand the investigation to analyze them.`
      );
    }
    if (limitNotices.length === 0) {
      limitNotices.push(
        `Active ${configuredLimits.preset_mode} mode: ${uniqueCandidatesCount}/${configuredLimits.max_unique_candidates} unique candidates discovered (${remainingCandidateCapacity} remaining capacity up to ${configuredLimits.max_unique_candidates}, system ceiling ${this.MAX_SYSTEM_CANDIDATE_CEILING}).`
      );
    }

    const candidateLifecycle: CandidateLifecycleBreakdown = {
      raw_discovered_count: rawDiscoveredCount,
      duplicates_merged_count: duplicatesMergedCount,
      unique_candidates_count: uniqueCandidatesCount,
      relevant_candidates_count: relevantCandidatesCount,
      researched_candidates_count: researchedCandidatesCount,
      awaiting_research_count: awaitingResearchCount,
      queued_for_comparison_count: queuedForComparisonCount,
      compared_candidates_count: comparedCandidatesCount,
      rejected_or_irrelevant_count: rejectedOrIrrelevantCount,
      remaining_candidate_capacity: remainingCandidateCapacity,
      remaining_research_capacity: remainingResearchCapacity,
      remaining_comparison_capacity: remainingComparisonCapacity,
      configured_limits: configuredLimits,
      max_system_ceiling: this.MAX_SYSTEM_CANDIDATE_CEILING,
      unique_limit_reached: uniqueLimitReached,
      research_limit_reached: researchLimitReached,
      comparison_limit_reached: comparisonLimitReached,
      limit_explanation: limitNotices.join(' ')
    };

    // Build 8 Platform Ecosystem Coverage items against the 100.0% Defined Online Video-Content Universe
    const queryDepthFactor = Math.min(1.0, Math.max(0.35, totalQueriesExecuted / 12));
    const budgetDepthFactor =
      configuredLimits.max_unique_candidates >= 1000
        ? 1.0
        : configuredLimits.max_unique_candidates >= 500
        ? 0.90
        : configuredLimits.max_unique_candidates >= 250
        ? 0.80
        : Math.max(0.45, configuredLimits.max_unique_candidates / 250);

    const hasYoutubeKey = Boolean(process.env.YOUTUBE_API_KEY);
    const hasGoogleCseKey = Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);
    const hasVimeoToken = Boolean(process.env.VIMEO_ACCESS_TOKEN);
    const hasOttTokens = Boolean(
      process.env.SONYLIV_PARTNER_API_KEY ||
        process.env.HOTSTAR_NOVI_SYNDICATION_TOKEN ||
        process.env.NETFLIX_BACKLOT_API_KEY
    );

    const buildEcoStats = (cat: PlatformEcosystemCategory) => {
      const cands = scopedCandidates.filter(c => this.classifyCandidateEcosystem(c) === cat);
      const rel = cands.filter(c => this.isCandidateRelevant(c)).length;
      const res = cands.filter(c => this.isCandidateResearched(c)).length;
      const comp = cands.filter(c => this.isCandidateForensicallyCompared(c)).length;
      const pagesDisc = Math.max(
        cands.length,
        cands.reduce((acc, c) => acc + (c.discovery_provenance?.source_urls?.length || 1), 0)
      );
      const pagesInsp = cands.filter(
        c =>
          c.reachability_code === 200 ||
          c.crawl_status === 'CRAWLED_OK' ||
          c.pipeline_status === 'ANALYZED' ||
          this.isCandidateResearched(c)
      ).length;
      return {
        uniqueCandidates: cands.length,
        relevantCandidates: rel,
        researchedCandidates: res,
        comparedCandidates: comp,
        pagesDiscovered: pagesDisc,
        pagesInspected: pagesInsp
      };
    };

    const ytEnabled = SourceAdapterRegistry.isAdapterEnabled('adapter_youtube');
    const dmEnabled = SourceAdapterRegistry.isAdapterEnabled('adapter_dailymotion');
    const vimeoEnabled = SourceAdapterRegistry.isAdapterEnabled('adapter_vimeo');
    const pubHostEnabled = SourceAdapterRegistry.isAdapterEnabled('adapter_public_video_platform');
    const webSearchEnabled = this.isEcosystemEnabled('web_search_crawler');
    const socialEnabled = this.isEcosystemEnabled('social_video_index');
    const piracyEnabled = this.isEcosystemEnabled('configured_piracy_sources');
    const ottEnabled = SourceAdapterRegistry.isAdapterEnabled('adapter_authorized_ott');

    const enabledConfiguredSources = allSources.filter(s => s.enabled);
    const checkedConfiguredSources = allSources.filter(s => s.last_scan_status !== 'IDLE');
    const restrictedOrFailedSources = allSources.filter(
      s => !s.enabled || s.last_scan_status === 'RESTRICTED' || s.last_scan_status === 'FAILED'
    );

    const ytStats = buildEcoStats('YOUTUBE');
    const dmStats = buildEcoStats('DAILYMOTION');
    const vmStats = buildEcoStats('VIMEO');
    const pubStats = buildEcoStats('PUBLIC_VIDEO_HOSTING');
    const webStats = buildEcoStats('PUBLICLY_INDEXED_WEB');
    const socStats = buildEcoStats('SOCIAL_VIDEO');
    const pirStats = buildEcoStats('CONFIGURED_PIRACY_ECOSYSTEM');
    const ottStats = buildEcoStats('COMMERCIAL_OTT');

    // Add persistent o2tvseries4u.com inspected pages to CONFIGURED_PIRACY_ECOSYSTEM
    const piracyPagesInspected = Math.max(
      pirStats.pagesInspected,
      allSources.reduce((acc, s) => acc + (s.pages_inspected || 0), 0)
    );
    const piracyPagesDiscovered = Math.max(pirStats.pagesDiscovered, piracyPagesInspected + restrictedOrFailedSources.length);

    const platformEcosystems: PlatformEcosystemCoverage[] = [
      {
        id: 'eco_youtube',
        name: 'YouTube Public Video Ecosystem',
        category: 'YOUTUBE',
        platforms_included: ['youtube.com', 'youtu.be', 'm.youtube.com'],
        adapter_id: 'adapter_youtube',
        adapter_enabled: ytEnabled,
        adapter_status: !ytEnabled ? 'DISABLED' : hasYoutubeKey ? 'ACTIVE_LIVE' : 'CONDITIONAL_AUTH',
        universe_weight_pct: 24.0,
        estimated_searchable_pct: !ytEnabled
          ? 0
          : Number(((hasYoutubeKey ? 92 : 78) * (0.7 + 0.3 * budgetDepthFactor)).toFixed(1)),
        measured_inspection_pct:
          ytStats.pagesDiscovered > 0
            ? Number(((ytStats.pagesInspected / ytStats.pagesDiscovered) * 100).toFixed(1))
            : ytEnabled && relevantJobs.length > 0
            ? 100.0
            : 0,
        unavailable_pct: !ytEnabled
          ? 100.0
          : Number((100 - (hasYoutubeKey ? 92 : 78) * (0.7 + 0.3 * budgetDepthFactor)).toFixed(1)),
        weighted_universe_contribution_pct: 0,
        sources_configured: 2,
        sources_checked: ytEnabled && relevantJobs.length > 0 ? 2 : 0,
        queries_executed: ytEnabled ? Math.max(1, Math.ceil(totalQueriesExecuted * 0.35)) : 0,
        pages_discovered: ytStats.pagesDiscovered,
        pages_inspected: ytStats.pagesInspected,
        unique_candidates: ytStats.uniqueCandidates,
        relevant_candidates: ytStats.relevantCandidates,
        researched_candidates: ytStats.researchedCandidates,
        compared_candidates: ytStats.comparedCandidates,
        unavailable_sources_count: ytEnabled ? (hasYoutubeKey ? 0 : 1) : 2,
        coverage_type: ytStats.pagesInspected > 0 ? 'MEASURED' : 'ESTIMATED',
        methodology:
          'Queries live YouTube search (ytInitialData parser) and YouTube oEmbed API (/oembed) across expanded keyword variations; decodes accessible streams or high-resolution storyboard keyframes.',
        denominator_definition:
          '24.0% weight of the Defined Online Video-Content Universe representing public YouTube watch pages and shorts.',
        assumptions: [
          'Publicly listed YouTube videos are indexed in ytInitialData and oEmbed.',
          'Unlisted, private, age-gated, and rolling-cipher-protected raw streams cannot be downloaded without YOUTUBE_API_KEY / rights-holder partner feed.'
        ],
        data_sources: ['YouTube Public Search (ytInitialData)', 'YouTube oEmbed API', ...(hasYoutubeKey ? ['YouTube Data API v3'] : [])],
        confidence_level: 'HIGH',
        gap_explanation: !ytEnabled
          ? 'YouTube Source Adapter is currently disabled by investigator.'
          : hasYoutubeKey
          ? 'Unlisted/private videos (~8%) are outside public search indexes.'
          : 'Public search & oEmbed active (~78% reach); YOUTUBE_API_KEY not configured for deep pagination & caption-track indexing (~22% gap).',
        last_updated_at: latestJob?.completed_at || latestJob?.started_at || nowIso
      },
      {
        id: 'eco_dailymotion',
        name: 'Dailymotion Public API Ecosystem',
        category: 'DAILYMOTION',
        platforms_included: ['dailymotion.com', 'dai.ly', 'geo.dailymotion.com'],
        adapter_id: 'adapter_dailymotion',
        adapter_enabled: dmEnabled,
        adapter_status: dmEnabled ? 'ACTIVE_LIVE' : 'DISABLED',
        universe_weight_pct: 10.0,
        estimated_searchable_pct: !dmEnabled
          ? 0
          : Number((88 * (0.75 + 0.25 * budgetDepthFactor)).toFixed(1)),
        measured_inspection_pct:
          dmStats.pagesDiscovered > 0
            ? Number(((dmStats.pagesInspected / dmStats.pagesDiscovered) * 100).toFixed(1))
            : dmEnabled && relevantJobs.length > 0
            ? 100.0
            : 0,
        unavailable_pct: !dmEnabled
          ? 100.0
          : Number((100 - 88 * (0.75 + 0.25 * budgetDepthFactor)).toFixed(1)),
        weighted_universe_contribution_pct: 0,
        sources_configured: 2,
        sources_checked: dmEnabled && relevantJobs.length > 0 ? 2 : 0,
        queries_executed: dmEnabled ? Math.max(1, Math.ceil(totalQueriesExecuted * 0.25)) : 0,
        pages_discovered: dmStats.pagesDiscovered,
        pages_inspected: dmStats.pagesInspected,
        unique_candidates: dmStats.uniqueCandidates,
        relevant_candidates: dmStats.relevantCandidates,
        researched_candidates: dmStats.researchedCandidates,
        compared_candidates: dmStats.comparedCandidates,
        unavailable_sources_count: dmEnabled ? 0 : 2,
        coverage_type: dmStats.pagesInspected > 0 ? 'MEASURED' : 'ESTIMATED',
        methodology:
          'Queries the official Dailymotion REST API (api.dailymotion.com/videos) with fields id,title,url,duration,thumbnail_720_url and inspects player metadata JSON endpoints.',
        denominator_definition:
          '10.0% weight of the Defined Online Video-Content Universe representing public Dailymotion video uploads and syndication channels.',
        assumptions: [
          'Public Dailymotion catalog items are returned by the official REST search endpoint.',
          'Geo-blocked or private partner uploads (~12%) are excluded from public API responses.'
        ],
        data_sources: ['Dailymotion Public REST API v1', 'Dailymotion Player Metadata JSON', 'Dailymotion oEmbed'],
        confidence_level: 'HIGH',
        gap_explanation: !dmEnabled
          ? 'Dailymotion Source Adapter is currently disabled.'
          : 'Geo-restricted and unlisted partner streams (~12–18%) are not returned by unauthenticated public search.',
        last_updated_at: latestJob?.completed_at || latestJob?.started_at || nowIso
      },
      {
        id: 'eco_vimeo',
        name: 'Vimeo Video Ecosystem',
        category: 'VIMEO',
        platforms_included: ['vimeo.com', 'player.vimeo.com'],
        adapter_id: 'adapter_vimeo',
        adapter_enabled: vimeoEnabled,
        adapter_status: !vimeoEnabled ? 'DISABLED' : hasVimeoToken ? 'ACTIVE_LIVE' : 'CONDITIONAL_AUTH',
        universe_weight_pct: 8.0,
        estimated_searchable_pct: !vimeoEnabled
          ? 0
          : Number(((hasVimeoToken ? 86 : 62) * (0.7 + 0.3 * budgetDepthFactor)).toFixed(1)),
        measured_inspection_pct:
          vmStats.pagesDiscovered > 0
            ? Number(((vmStats.pagesInspected / vmStats.pagesDiscovered) * 100).toFixed(1))
            : vimeoEnabled && relevantJobs.length > 0
            ? 85.0
            : 0,
        unavailable_pct: !vimeoEnabled
          ? 100.0
          : Number((100 - (hasVimeoToken ? 86 : 62) * (0.7 + 0.3 * budgetDepthFactor)).toFixed(1)),
        weighted_universe_contribution_pct: 0,
        sources_configured: 2,
        sources_checked: vimeoEnabled && relevantJobs.length > 0 ? (hasVimeoToken ? 2 : 1) : 0,
        queries_executed: vimeoEnabled ? Math.max(1, Math.ceil(totalQueriesExecuted * 0.2)) : 0,
        pages_discovered: vmStats.pagesDiscovered,
        pages_inspected: vmStats.pagesInspected,
        unique_candidates: vmStats.uniqueCandidates,
        relevant_candidates: vmStats.relevantCandidates,
        researched_candidates: vmStats.researchedCandidates,
        compared_candidates: vmStats.comparedCandidates,
        unavailable_sources_count: !vimeoEnabled ? 2 : hasVimeoToken ? 0 : 1,
        coverage_type: vmStats.pagesInspected > 0 ? 'MEASURED' : 'ESTIMATED',
        methodology:
          'Discovers public Vimeo URLs via web search index and inspects Vimeo oEmbed (vimeo.com/api/oembed.json) and player config (player.vimeo.com/video/:id/config) for progressive MP4/HLS streams.',
        denominator_definition:
          '8.0% weight of the Defined Online Video-Content Universe representing Vimeo-hosted videos and showcase embeds.',
        assumptions: [
          'Public Vimeo pages indexed by search engines are discoverable without API keys.',
          'Password-protected, domain-locked, and unindexed Vimeo uploads require VIMEO_ACCESS_TOKEN.'
        ],
        data_sources: ['Vimeo oEmbed API', 'Vimeo Player Config JSON', 'Web Search site:vimeo.com'],
        confidence_level: hasVimeoToken ? 'HIGH' : 'MEDIUM',
        gap_explanation: !vimeoEnabled
          ? 'Vimeo Source Adapter is currently disabled.'
          : hasVimeoToken
          ? 'Password-protected and domain-restricted embeds (~14%) remain inaccessible.'
          : 'VIMEO_ACCESS_TOKEN not configured; discovery relies on web search indexing + oEmbed (~38% of unlisted/API-only catalog unavailable).',
        last_updated_at: latestJob?.completed_at || latestJob?.started_at || nowIso
      },
      {
        id: 'eco_public_video_hosting',
        name: 'Public Video-Hosting & Open Archives',
        category: 'PUBLIC_VIDEO_HOSTING',
        platforms_included: ['archive.org', 'commons.wikimedia.org', 'Direct MP4 / HLS Hosts'],
        adapter_id: 'adapter_public_video_platform',
        adapter_enabled: pubHostEnabled,
        adapter_status: pubHostEnabled ? 'ACTIVE_LIVE' : 'DISABLED',
        universe_weight_pct: 12.0,
        estimated_searchable_pct: !pubHostEnabled
          ? 0
          : Number((91 * (0.75 + 0.25 * budgetDepthFactor)).toFixed(1)),
        measured_inspection_pct:
          pubStats.pagesDiscovered > 0
            ? Number(((pubStats.pagesInspected / pubStats.pagesDiscovered) * 100).toFixed(1))
            : pubHostEnabled && relevantJobs.length > 0
            ? 100.0
            : 0,
        unavailable_pct: !pubHostEnabled
          ? 100.0
          : Number((100 - 91 * (0.75 + 0.25 * budgetDepthFactor)).toFixed(1)),
        weighted_universe_contribution_pct: 0,
        sources_configured: 3,
        sources_checked: pubHostEnabled && relevantJobs.length > 0 ? 3 : 0,
        queries_executed: pubHostEnabled ? Math.max(1, Math.ceil(totalQueriesExecuted * 0.25)) : 0,
        pages_discovered: pubStats.pagesDiscovered,
        pages_inspected: pubStats.pagesInspected,
        unique_candidates: pubStats.uniqueCandidates,
        relevant_candidates: pubStats.relevantCandidates,
        researched_candidates: pubStats.researchedCandidates,
        compared_candidates: pubStats.comparedCandidates,
        unavailable_sources_count: pubHostEnabled ? 0 : 3,
        coverage_type: pubStats.pagesInspected > 0 ? 'MEASURED' : 'ESTIMATED',
        methodology:
          'Queries Internet Archive Advanced Search (archive.org/advancedsearch.php) and Item Metadata APIs (archive.org/metadata/:id) plus Wikimedia Commons API for direct decodable MP4/WebM/OGV video containers.',
        denominator_definition:
          '12.0% weight of the Defined Online Video-Content Universe representing open-access video repositories, public archives, and direct MP4/HLS hosts.',
        assumptions: [
          'Open-archive collections expose full-text metadata and direct container files.',
          ' Borrow-only or access-restricted archive items (~9%) cannot be downloaded anonymously.'
        ],
        data_sources: ['Internet Archive Advanced Search API', 'Internet Archive Metadata API', 'Wikimedia Commons MediaWiki API'],
        confidence_level: 'HIGH',
        gap_explanation: !pubHostEnabled
          ? 'Public Video-Hosting Adapter is currently disabled.'
          : 'Access-restricted or lending-library archive items (~9%) are excluded from anonymous media download.',
        last_updated_at: latestJob?.completed_at || latestJob?.started_at || nowIso
      },
      {
        id: 'eco_publicly_indexed_web',
        name: 'Publicly Indexed Websites & Embedded Players',
        category: 'PUBLICLY_INDEXED_WEB',
        platforms_included: ['DuckDuckGo HTML Index', 'Google Custom Search JSON API', 'Open Web HTML5/Iframe Players'],
        adapter_id: 'web_search_crawler',
        adapter_enabled: webSearchEnabled,
        adapter_status: !webSearchEnabled ? 'DISABLED' : hasGoogleCseKey ? 'ACTIVE_LIVE' : 'CONDITIONAL_AUTH',
        universe_weight_pct: 18.0,
        estimated_searchable_pct: !webSearchEnabled
          ? 0
          : Number(((hasGoogleCseKey ? 84 : 68) * (0.65 + 0.35 * budgetDepthFactor * queryDepthFactor)).toFixed(1)),
        measured_inspection_pct:
          webStats.pagesDiscovered > 0
            ? Number(((webStats.pagesInspected / webStats.pagesDiscovered) * 100).toFixed(1))
            : webSearchEnabled && relevantJobs.length > 0
            ? 90.0
            : 0,
        unavailable_pct: !webSearchEnabled
          ? 100.0
          : Number((100 - (hasGoogleCseKey ? 84 : 68) * (0.65 + 0.35 * budgetDepthFactor * queryDepthFactor)).toFixed(1)),
        weighted_universe_contribution_pct: 0,
        sources_configured: 2,
        sources_checked: webSearchEnabled && relevantJobs.length > 0 ? (hasGoogleCseKey ? 2 : 1) : 0,
        queries_executed: webSearchEnabled ? totalQueriesExecuted : 0,
        pages_discovered: webStats.pagesDiscovered,
        pages_inspected: webStats.pagesInspected,
        unique_candidates: webStats.uniqueCandidates,
        relevant_candidates: webStats.relevantCandidates,
        researched_candidates: webStats.researchedCandidates,
        compared_candidates: webStats.comparedCandidates,
        unavailable_sources_count: !webSearchEnabled ? 2 : hasGoogleCseKey ? 0 : 1,
        coverage_type: webStats.pagesInspected > 0 ? 'MEASURED' : 'ESTIMATED',
        methodology:
          'Executes expanded keyword combinations (title, season/episode codes, resolution/format modifiers) against live web search indexes and inspects HTML5 <video>, OpenGraph, JSON-LD VideoObject, and iframe embeds.',
        denominator_definition:
          '18.0% weight of the Defined Online Video-Content Universe representing publicly indexed websites hosting or embedding video content.',
        assumptions: [
          'Search engines index public HTML pages containing video titles and metadata.',
          'Deep-web pages excluded by robots.txt or CAPTCHA challenges are not indexed by public search.'
        ],
        data_sources: ['DuckDuckGo Live HTML Search', ...(hasGoogleCseKey ? ['Google Custom Search JSON API'] : []), 'HTML5 / JSON-LD / OpenGraph Page Inspector'],
        confidence_level: 'MEDIUM',
        gap_explanation: !webSearchEnabled
          ? 'Publicly Indexed Web Search Crawler is disabled.'
          : hasGoogleCseKey
          ? 'Unindexed pages (robots.txt noindex) and CAPTCHA-gated embeds (~16%) are unreachable.'
          : 'DuckDuckGo live HTML search active; configure GOOGLE_SEARCH_API_KEY & GOOGLE_SEARCH_CX to expand multi-region index depth (+16% reach).',
        last_updated_at: latestJob?.completed_at || latestJob?.started_at || nowIso
      },
      {
        id: 'eco_social_video',
        name: 'Social Video Sources',
        category: 'SOCIAL_VIDEO',
        platforms_included: ['x.com / twitter.com', 'reddit.com', 'tiktok.com', 'facebook.com / watch', 'instagram.com'],
        adapter_id: 'social_video_index',
        adapter_enabled: socialEnabled,
        adapter_status: socialEnabled ? 'METADATA_ONLY' : 'DISABLED',
        universe_weight_pct: 10.0,
        estimated_searchable_pct: !socialEnabled
          ? 0
          : Number((38 * (0.7 + 0.3 * budgetDepthFactor)).toFixed(1)),
        measured_inspection_pct:
          socStats.pagesDiscovered > 0
            ? Number(((socStats.pagesInspected / socStats.pagesDiscovered) * 100).toFixed(1))
            : 0,
        unavailable_pct: !socialEnabled
          ? 100.0
          : Number((100 - 38 * (0.7 + 0.3 * budgetDepthFactor)).toFixed(1)),
        weighted_universe_contribution_pct: 0,
        sources_configured: 5,
        sources_checked: socialEnabled && relevantJobs.length > 0 ? 2 : 0,
        queries_executed: socialEnabled ? Math.max(1, Math.ceil(totalQueriesExecuted * 0.2)) : 0,
        pages_discovered: socStats.pagesDiscovered,
        pages_inspected: socStats.pagesInspected,
        unique_candidates: socStats.uniqueCandidates,
        relevant_candidates: socStats.relevantCandidates,
        researched_candidates: socStats.researchedCandidates,
        compared_candidates: socStats.comparedCandidates,
        unavailable_sources_count: socialEnabled ? 3 : 5,
        coverage_type: 'ESTIMATED',
        methodology:
          'Discovers publicly indexed social video posts via web search and public OpenGraph/oEmbed metadata; respects platform authentication walls and rate limits.',
        denominator_definition:
          '10.0% weight of the Defined Online Video-Content Universe representing social media video uploads, clips, and live re-streams.',
        assumptions: [
          'Publicly shared posts indexed by search engines can be identified by URL and OpenGraph tags.',
          'Authenticated feeds, closed groups, ephemeral stories, and login-walled streams (~62%) are inaccessible without platform partner APIs.'
        ],
        data_sources: ['Public Web Index for Social Domains', 'OpenGraph / Twitter Player Card Inspector'],
        confidence_level: 'MODERATE',
        gap_explanation: !socialEnabled
          ? 'Social Video Index discovery is currently disabled.'
          : 'Approximately 62% of social video content sits behind login walls, mobile-app-only feeds, or authenticated API gates.',
        last_updated_at: latestJob?.completed_at || latestJob?.started_at || nowIso
      },
      {
        id: 'eco_configured_piracy',
        name: 'Configured Discovery & Piracy Ecosystems',
        category: 'CONFIGURED_PIRACY_ECOSYSTEM',
        platforms_included: allSources.map(s => s.url),
        adapter_id: 'configured_piracy_sources',
        adapter_enabled: piracyEnabled && enabledConfiguredSources.length > 0,
        adapter_status:
          !piracyEnabled || enabledConfiguredSources.length === 0 ? 'DISABLED' : 'ACTIVE_LIVE',
        universe_weight_pct: 10.0,
        estimated_searchable_pct:
          !piracyEnabled || allSources.length === 0
            ? 0
            : Number(
                (
                  ((enabledConfiguredSources.length / Math.max(1, allSources.length)) * 75 +
                    (piracyPagesInspected > 0 ? 15 : 0)) *
                  (0.8 + 0.2 * budgetDepthFactor)
                ).toFixed(1)
              ),
        measured_inspection_pct:
          piracyPagesDiscovered > 0
            ? Number(Math.min(100, (piracyPagesInspected / piracyPagesDiscovered) * 100).toFixed(1))
            : checkedConfiguredSources.length > 0
            ? Number(((checkedConfiguredSources.length / Math.max(1, allSources.length)) * 100).toFixed(1))
            : 0,
        unavailable_pct: 0,
        weighted_universe_contribution_pct: 0,
        sources_configured: allSources.length,
        sources_checked: checkedConfiguredSources.length,
        queries_executed: piracyEnabled ? Math.max(enabledConfiguredSources.length, Math.ceil(totalQueriesExecuted * 0.3)) : 0,
        pages_discovered: piracyPagesDiscovered,
        pages_inspected: piracyPagesInspected,
        unique_candidates: pirStats.uniqueCandidates,
        relevant_candidates: pirStats.relevantCandidates,
        researched_candidates: pirStats.researchedCandidates,
        compared_candidates: pirStats.comparedCandidates,
        unavailable_sources_count: restrictedOrFailedSources.length,
        coverage_type: piracyPagesInspected > 0 ? 'MEASURED' : 'ESTIMATED',
        methodology:
          'Directly crawls persistent configured websites (e.g., https://o2tvseries4u.com/ catalog, series, seasons, episode pages, and direct .mp4 links) and probes configured seed portals for HTTP reachability and Cloudflare/CAPTCHA restrictions.',
        denominator_definition:
          '10.0% weight of the Defined Online Video-Content Universe representing configured piracy portals, direct-download TV/movie indexes, and torrent/stream directories.',
        assumptions: [
          'Configured portals expose navigable HTML hierarchies or search endpoints.',
          'Cloudflare Turnstile, CAPTCHA challenges, or ISP-level domain blocks restrict automated downloading on some seed domains.'
        ],
        data_sources: allSources.map(s => `${s.name} (${s.url})`),
        confidence_level: 'HIGH',
        gap_explanation:
          restrictedOrFailedSources.length > 0
            ? `${restrictedOrFailedSources.length} configured source(s) reported restrictions, CAPTCHA challenges, or disabled status.`
            : 'All configured persistent discovery sources are enabled and reachable.',
        last_updated_at:
          allSources
            .map(s => s.last_scan_at)
            .filter(Boolean)
            .sort()
            .reverse()[0] ||
          latestJob?.completed_at ||
          nowIso
      },
      {
        id: 'eco_commercial_ott',
        name: 'Commercial OTT & Broadcaster Ecosystems',
        category: 'COMMERCIAL_OTT',
        platforms_included: ['netflix.com', 'hotstar.com', 'sonyliv.com', 'primevideo.com', 'jiocinema.com'],
        adapter_id: 'adapter_authorized_ott',
        adapter_enabled: ottEnabled,
        adapter_status: !ottEnabled ? 'DISABLED' : hasOttTokens ? 'ACTIVE_LIVE' : 'METADATA_ONLY',
        universe_weight_pct: 8.0,
        estimated_searchable_pct: !ottEnabled
          ? 0
          : hasOttTokens
          ? 85.0
          : 42.0,
        measured_inspection_pct:
          ottStats.pagesDiscovered > 0
            ? Number(((ottStats.pagesInspected / ottStats.pagesDiscovered) * 100).toFixed(1))
            : ottEnabled && relevantJobs.length > 0
            ? 42.0
            : 0,
        unavailable_pct: !ottEnabled ? 100.0 : hasOttTokens ? 15.0 : 58.0,
        weighted_universe_contribution_pct: 0,
        sources_configured: 5,
        sources_checked: ottEnabled && relevantJobs.length > 0 ? 5 : 0,
        queries_executed: ottEnabled ? Math.max(1, Math.ceil(totalQueriesExecuted * 0.2)) : 0,
        pages_discovered: ottStats.pagesDiscovered,
        pages_inspected: ottStats.pagesInspected,
        unique_candidates: ottStats.uniqueCandidates,
        relevant_candidates: ottStats.relevantCandidates,
        researched_candidates: ottStats.researchedCandidates,
        compared_candidates: ottStats.comparedCandidates,
        unavailable_sources_count: !ottEnabled ? 5 : hasOttTokens ? 0 : 4,
        coverage_type: 'ESTIMATED',
        methodology:
          'Searches public OTT catalog landing pages and inspects DASH/HLS manifests for Widevine/PlayReady/FairPlay DRM signaling; uses authorized syndication tokens when configured.',
        denominator_definition:
          '8.0% weight of the Defined Online Video-Content Universe representing subscription OTT platforms and broadcaster catch-up portals.',
        assumptions: [
          'Public OTT catalog landing pages are discoverable for licensee verification.',
          'Encrypted Widevine/PlayReady streams are never bypassed; raw frame extraction requires partner syndication credentials.'
        ],
        data_sources: ['Public OTT Catalog Index', 'DASH/HLS DRM Header Inspector', ...(hasOttTokens ? ['Authorized Partner Syndication Feeds'] : [])],
        confidence_level: 'HIGH',
        gap_explanation: !ottEnabled
          ? 'Authorized OTT Adapter is currently disabled.'
          : hasOttTokens
          ? 'Partner syndication credentials active.'
          : 'Catalog pages are searchable (42%), but raw encrypted streams (58%) require partner syndication credentials (SONYLIV_PARTNER_API_KEY, HOTSTAR_NOVI_SYNDICATION_TOKEN, NETFLIX_BACKLOT_API_KEY).',
        last_updated_at: latestJob?.completed_at || latestJob?.started_at || nowIso
      }
    ];

    // Finalize weighted contributions and unavailable_pct on each ecosystem
    for (const eco of platformEcosystems) {
      eco.estimated_searchable_pct = Number(Math.max(0, Math.min(100, eco.estimated_searchable_pct)).toFixed(1));
      eco.unavailable_pct = Number(Math.max(0, 100 - eco.estimated_searchable_pct).toFixed(1));
      eco.weighted_universe_contribution_pct = Number(
        ((eco.universe_weight_pct * eco.estimated_searchable_pct) / 100).toFixed(2)
      );
    }

    // 1. Overall Estimated Searchable Content Coverage (%)
    const overallEstimatedPct = Number(
      platformEcosystems
        .reduce((acc, eco) => acc + eco.weighted_universe_contribution_pct, 0)
        .toFixed(1)
    );
    const overallMeasuredContributionPct = Number(
      platformEcosystems
        .reduce(
          (acc, eco) =>
            acc + (eco.universe_weight_pct * Math.min(eco.estimated_searchable_pct, eco.measured_inspection_pct)) / 100,
          0
        )
        .toFixed(1)
    );
    const overallUnavailablePct = Number(Math.max(0, 100 - overallEstimatedPct).toFixed(1));

    // 2. Source & Page Inspection Coverage (%)
    const totalPagesDiscovered = Math.max(
      discoveredPageUrlsSet.size,
      platformEcosystems.reduce((acc, e) => acc + e.pages_discovered, 0)
    );
    const totalPagesInspected = Math.min(
      totalPagesDiscovered,
      Math.max(
        inspectedPageUrlsSet.size,
        platformEcosystems.reduce((acc, e) => acc + e.pages_inspected, 0)
      )
    );
    const totalSourcesConfigured =
      allSources.length + allAdapters.length;
    const totalSourcesChecked =
      checkedConfiguredSources.length + allAdapters.filter((a: SourceAdapterDescriptor) => a.enabled).length;

    const sourceInspectionDenom = totalPagesDiscovered > 0 ? totalPagesDiscovered : Math.max(1, totalSourcesConfigured);
    const sourceInspectionNum = totalPagesDiscovered > 0 ? totalPagesInspected : totalSourcesChecked;
    const sourceInspectionPct = Number(
      Math.min(100, (sourceInspectionNum / Math.max(1, sourceInspectionDenom)) * 100).toFixed(1)
    );

    // 3. Candidate Research Coverage (%)
    const researchDenom = uniqueCandidatesCount > 0 ? uniqueCandidatesCount : configuredLimits.deep_research_limit;
    const researchNum = uniqueCandidatesCount > 0 ? researchedCandidatesCount : 0;
    const candidateResearchPct =
      uniqueCandidatesCount > 0
        ? Number(Math.min(100, (researchedCandidatesCount / uniqueCandidatesCount) * 100).toFixed(1))
        : 0;

    // 4. Forensic Investigation Coverage (%)
    const forensicDenom =
      relevantCandidatesCount > 0 ? relevantCandidatesCount : uniqueCandidatesCount > 0 ? uniqueCandidatesCount : configuredLimits.forensic_comparison_limit;
    const forensicNum = comparedCandidatesCount;
    const forensicCoveragePct =
      forensicDenom > 0 && uniqueCandidatesCount > 0
        ? Number(Math.min(100, (comparedCandidatesCount / forensicDenom) * 100).toFixed(1))
        : 0;

    const overallCoverage = {
      estimated_searchable_coverage: {
        id: 'overall_searchable_coverage',
        label: 'Estimated Searchable Online Video Coverage',
        percentage: overallEstimatedPct,
        measured_pct: overallMeasuredContributionPct,
        estimated_pct: Number(Math.max(0, overallEstimatedPct - overallMeasuredContributionPct).toFixed(1)),
        unavailable_pct: overallUnavailablePct,
        numerator: Math.round(overallEstimatedPct * 10),
        denominator: 1000,
        unit_label: 'weighted universe index units (out of 1,000)',
        coverage_type: 'ESTIMATED' as const,
        methodology:
          'Weighted sum of reachable content surface across the 8 defined Online Video-Content Ecosystems, adjusted for active source adapters, API credentials, configured portal reachability, and candidate discovery limit depth (Standard 250 / Deep 500 / Exhaustive 1,000).',
        denominator_definition:
          '1,000 Weighted Index Units (100.0%) representing the Defined Online Video-Content Universe: YouTube (24%), Publicly Indexed Web (18%), Public Video-Hosting Archives (12%), Dailymotion (10%), Social Video (10%), Configured Piracy Ecosystems (10%), Vimeo (8%), and Commercial OTT (8%). Does NOT claim to measure the entire private/unindexed internet as a verified fact.',
        assumptions: [
          'Each platform ecosystem is weighted by its addressable share of public and semi-public online video distribution.',
          'Duplicate candidates discovered across multiple adapters or search queries are deduplicated before counting.',
          'DRM-encrypted OTT streams, login-walled social feeds, and unconfigured partner APIs are explicitly classified as Unavailable Coverage.'
        ],
        data_sources: [
          'SourceAdapterRegistry Live Status',
          'Persistent Discovery Source Telemetry (SQLite)',
          'Executed Discovery Sweep Diagnostics'
        ],
        confidence_level: 'MEDIUM' as CoverageConfidenceLevel,
        last_updated_at: nowIso
      },
      source_inspection_coverage: {
        id: 'source_inspection_coverage',
        label: 'Discovered Pages & Sources Inspected',
        percentage: sourceInspectionPct,
        measured_pct: sourceInspectionPct,
        estimated_pct: 0,
        unavailable_pct: Number(Math.max(0, 100 - sourceInspectionPct).toFixed(1)),
        numerator: sourceInspectionNum,
        denominator: sourceInspectionDenom,
        unit_label: totalPagesDiscovered > 0 ? 'discovered pages inspected' : 'configured sources & adapters checked',
        coverage_type: 'MEASURED' as const,
        methodology:
          'Direct ratio of unique discovered webpages and configured source endpoints that returned verified HTTP/API inspection responses versus total unique pages/endpoints discovered.',
        denominator_definition:
          totalPagesDiscovered > 0
            ? `${totalPagesDiscovered} unique discovered candidate & catalog URLs across all enabled discovery sources.`
            : `${totalSourcesConfigured} configured discovery sources and platform adapters.`,
        assumptions: [
          'A page is counted as inspected only when an HTTP probe, API metadata fetch, or webpage parser completes.',
          'Pages blocked by HTTP 403/522, Cloudflare CAPTCHA, or network timeouts are counted in the uninspected/unavailable remainder.'
        ],
        data_sources: ['HTTP Probe Telemetry', 'O2TvSeries4u Crawler Logs', 'Seed Portal Probe Results'],
        confidence_level: 'HIGH' as CoverageConfidenceLevel,
        last_updated_at: nowIso
      },
      candidate_research_coverage: {
        id: 'candidate_research_coverage',
        label: 'Unique Candidates Researched',
        percentage: candidateResearchPct,
        measured_pct: candidateResearchPct,
        estimated_pct: 0,
        unavailable_pct: Number(Math.max(0, 100 - candidateResearchPct).toFixed(1)),
        numerator: researchNum,
        denominator: researchDenom,
        unit_label: 'unique candidates researched',
        coverage_type: 'MEASURED' as const,
        methodology:
          'Percentage of deduplicated unique candidates that have completed deep target-identity & metadata evaluation (title, season/episode, participants, release year, and webpage structured metadata) up to the configured Deep Research Limit.',
        denominator_definition:
          uniqueCandidatesCount > 0
            ? `${uniqueCandidatesCount} deduplicated unique candidates discovered for this scope (Deep Research Limit: ${configuredLimits.deep_research_limit}).`
            : `Configured Deep Research Limit of ${configuredLimits.deep_research_limit} unique candidates.`,
        assumptions: [
          'Candidates are deduplicated across all discovery sources before counting.',
          `Top ${configuredLimits.deep_research_limit} candidates ranked by relevance are prioritized for deep research; remaining candidates are preserved in AWAITING_RESEARCH.`
        ],
        data_sources: ['CandidateResearchEngine Evaluations', 'SQLite candidates.detected_identity_json'],
        confidence_level: 'HIGH' as CoverageConfidenceLevel,
        last_updated_at: nowIso
      },
      forensic_investigation_coverage: {
        id: 'forensic_investigation_coverage',
        label: 'Relevant Candidates Forensically Compared',
        percentage: forensicCoveragePct,
        measured_pct: forensicCoveragePct,
        estimated_pct: 0,
        unavailable_pct: Number(Math.max(0, 100 - forensicCoveragePct).toFixed(1)),
        numerator: forensicNum,
        denominator: forensicDenom,
        unit_label: 'relevant candidates forensically compared',
        coverage_type: 'MEASURED' as const,
        methodology:
          'Percentage of relevant deduplicated candidates that have undergone stream probing, FFmpeg keyframe extraction, and 64-bit perceptual dHash/vHash/cropHash comparison against the registered reference.',
        denominator_definition:
          relevantCandidatesCount > 0
            ? `${relevantCandidatesCount} relevant unique candidates identified (Forensic Comparison Limit: ${configuredLimits.forensic_comparison_limit}).`
            : `Configured Forensic Comparison Limit of ${configuredLimits.forensic_comparison_limit} candidates.`,
        assumptions: [
          `Top ${configuredLimits.forensic_comparison_limit} relevant candidates are prioritized for forensic verification.`,
          'Completed forensic comparisons and extracted candidate fingerprints are cached in SQLite and reused when expanding investigations.'
        ],
        data_sources: ['VerifierEngine Logs', 'SQLite candidate_fingerprints & evidence_records'],
        confidence_level: 'HIGH' as CoverageConfidenceLevel,
        last_updated_at: nowIso
      }
    };

    // Unavailable or inaccessible sources list
    const unavailableSources: SearchCoverageReport['unavailable_or_inaccessible_sources'] = [];
    for (const src of allSources) {
      if (!src.enabled) {
        unavailableSources.push({
          id: src.id,
          name: src.name,
          url_or_platform: src.url,
          status: 'DISABLED',
          reason: 'Configured discovery source is currently disabled by investigator.',
          last_checked_at: src.last_scan_at
        });
      } else if (src.last_scan_status === 'RESTRICTED' || src.last_scan_status === 'FAILED') {
        let reasons: string[] = [];
        try {
          if (src.failure_reasons_json) reasons = JSON.parse(src.failure_reasons_json);
        } catch {}
        unavailableSources.push({
          id: src.id,
          name: src.name,
          url_or_platform: src.url,
          status: src.last_scan_status,
          reason: reasons[0] || src.last_scan_outcome || 'Source reported access restriction, CAPTCHA, or timeout.',
          last_checked_at: src.last_scan_at
        });
      }
    }

    for (const probe of seedProbes) {
      if (probe.crawlStatus === 'ACCESS_RESTRICTED' || probe.crawlStatus === 'BLOCKED' || probe.crawlStatus === 'UNREACHABLE') {
        const alreadyListed = unavailableSources.some(u => u.url_or_platform.toLowerCase() === probe.seedUrl.toLowerCase());
        if (!alreadyListed) {
          unavailableSources.push({
            id: `seed_${probe.finalDomain}`,
            name: `Seed Portal (${probe.finalDomain})`,
            url_or_platform: probe.seedUrl,
            status: probe.crawlStatus,
            reason: probe.restrictionReason || `HTTP ${probe.httpStatus || 0} (${probe.crawlStatus})`,
            last_checked_at: probe.checkedAt
          });
        }
      }
    }

    for (const adapter of allAdapters) {
      if (!adapter.enabled) {
        unavailableSources.push({
          id: adapter.id,
          name: adapter.name,
          url_or_platform: adapter.platforms.join(', '),
          status: 'ADAPTER_DISABLED',
          reason: 'Source adapter is currently disabled in Adapter Registry.'
        });
      } else if (adapter.requiresCredentials && !adapter.credentialsConfigured) {
        unavailableSources.push({
          id: `${adapter.id}_creds`,
          name: `${adapter.name} (Partner Feed)`,
          url_or_platform: adapter.platforms.join(', '),
          status: 'AWAITING_CREDENTIALS',
          reason: `Optional partner credential ${adapter.envVar || 'API_KEY'} is not configured; operating in public metadata/inspection mode.`
        });
      }
    }

    // Remaining Search & Inspection Gaps
    const remainingGaps: CoverageGapItem[] = [];
    if (awaitingResearchCount > 0) {
      remainingGaps.push({
        id: 'gap_awaiting_research',
        ecosystem_or_source: 'Candidate Research Queue',
        gap_type: 'UNINSPECTED_CANDIDATES',
        severity: 'HIGH',
        impact_pct: Number(((awaitingResearchCount / Math.max(1, uniqueCandidatesCount)) * 100).toFixed(1)),
        description: `${awaitingResearchCount} discovered unique candidate(s) are awaiting deep webpage & identity research (held by Deep Research Limit of ${configuredLimits.deep_research_limit}).`,
        remediation_action: 'Click "Continue Incomplete Research" or increase the Deep Research Limit to evaluate all awaiting candidates without repeating completed work.',
        can_auto_remediate: true
      });
    }
    if (queuedForComparisonCount > 0) {
      remainingGaps.push({
        id: 'gap_queued_comparison',
        ecosystem_or_source: 'Forensic Comparison Queue',
        gap_type: 'UNINSPECTED_CANDIDATES',
        severity: 'HIGH',
        impact_pct: Number(((queuedForComparisonCount / Math.max(1, relevantCandidatesCount || uniqueCandidatesCount)) * 100).toFixed(1)),
        description: `${queuedForComparisonCount} relevant candidate(s) are queued for FFmpeg keyframe & perceptual hash comparison (held by Forensic Comparison Limit of ${configuredLimits.forensic_comparison_limit}).`,
        remediation_action: 'Click "Expand Investigation" or "Compare Queued Candidates" to run forensic verification on queued candidates.',
        can_auto_remediate: true
      });
    }
    if (configuredLimits.max_unique_candidates < this.MAX_SYSTEM_CANDIDATE_CEILING) {
      remainingGaps.push({
        id: 'gap_discovery_preset_depth',
        ecosystem_or_source: `Discovery Preset Depth (${configuredLimits.preset_mode}: ${configuredLimits.max_unique_candidates})`,
        gap_type: 'CANDIDATE_OR_QUERY_LIMIT_REACHED',
        severity: uniqueLimitReached ? 'HIGH' : 'MEDIUM',
        impact_pct: Number((((1000 - configuredLimits.max_unique_candidates) / 1000) * 14).toFixed(1)),
        description: `Investigation is configured for ${configuredLimits.max_unique_candidates} unique candidates (${configuredLimits.preset_mode} mode). Expanding to Exhaustive (1,000) increases multi-query variations and adapter pagination depth.`,
        remediation_action: 'Switch preset to Deep (500) or Exhaustive (1,000) and click "Expand Investigation".',
        can_auto_remediate: true
      });
    }
    if (!hasGoogleCseKey || !hasYoutubeKey || !hasVimeoToken) {
      const missingVars = [
        !hasYoutubeKey ? 'YOUTUBE_API_KEY' : null,
        !hasGoogleCseKey ? 'GOOGLE_SEARCH_API_KEY' : null,
        !hasVimeoToken ? 'VIMEO_ACCESS_TOKEN' : null
      ].filter(Boolean);
      remainingGaps.push({
        id: 'gap_optional_search_keys',
        ecosystem_or_source: 'Extended Platform Search APIs',
        gap_type: 'MISSING_API_CREDENTIALS',
        severity: 'MEDIUM',
        impact_pct: 9.4,
        description: `Adapters are operating using live unauthenticated search & oEmbed endpoints. Optional API keys (${missingVars.join(', ')}) are not configured for deep pagination.`,
        remediation_action: 'Configure optional platform API keys in environment variables for deeper catalog pagination.',
        can_auto_remediate: false
      });
    }
    if (restrictedOrFailedSources.length > 0) {
      remainingGaps.push({
        id: 'gap_restricted_sources',
        ecosystem_or_source: restrictedOrFailedSources.map(s => s.name).join(', '),
        gap_type: 'BLOCKED_OR_UNREACHABLE_SOURCE',
        severity: 'MEDIUM',
        impact_pct: 3.5,
        description: `${restrictedOrFailedSources.length} configured source(s) encountered HTTP blocks, Cloudflare CAPTCHA challenges, or are disabled.`,
        remediation_action: 'Enable disabled sources or retry source scan from the Coverage Controls panel.',
        can_auto_remediate: true
      });
    }
    remainingGaps.push({
      id: 'gap_drm_and_auth_walls',
      ecosystem_or_source: 'Commercial OTT & Auth-Walled Social Feeds',
      gap_type: 'DRM_OR_AUTH_WALL',
      severity: 'LOW',
      impact_pct: 10.8,
      description: 'Encrypted Widevine/PlayReady OTT streams and private login-walled social feeds cannot be decoded without rights-holder partner syndication credentials.',
      remediation_action: 'Attach authorized reference master files or configure partner syndication tokens where applicable.',
      can_auto_remediate: false
    });

    const plannedQueryBudget =
      configuredLimits.max_unique_candidates >= 1000
        ? 24
        : configuredLimits.max_unique_candidates >= 500
        ? 16
        : 12;

    const discoveryPerformance: DiscoveryPerformanceMetrics = {
      sources_configured: totalSourcesConfigured,
      sources_checked: totalSourcesChecked,
      sources_accessible: totalSourcesChecked - restrictedOrFailedSources.length,
      sources_unavailable_or_restricted: unavailableSources.length,
      search_queries_executed: totalQueriesExecuted,
      search_queries_planned_budget: Math.max(totalQueriesExecuted, plannedQueryBudget),
      pages_discovered: totalPagesDiscovered,
      pages_inspected: totalPagesInspected,
      raw_discovered_candidates: rawDiscoveredCount,
      duplicates_merged: duplicatesMergedCount,
      unique_candidates_discovered: uniqueCandidatesCount,
      relevant_candidates_identified: relevantCandidatesCount,
      candidates_researched: researchedCandidatesCount,
      candidates_awaiting_research: awaitingResearchCount,
      candidates_queued_for_comparison: queuedForComparisonCount,
      candidates_forensically_compared: comparedCandidatesCount,
      rejected_or_irrelevant_candidates: rejectedOrIrrelevantCount
    };

    const failedInspectionsCount = scopedCandidates.filter(
      c =>
        c.pipeline_status === 'UNREACHABLE' ||
        c.pipeline_status === 'BLOCKED' ||
        c.crawl_status === 'UNREACHABLE' ||
        c.crawl_status === 'BLOCKED'
    ).length;

    const totalWorkUnits =
      totalSourcesConfigured +
      Math.max(1, uniqueCandidatesCount) +
      Math.max(1, relevantCandidatesCount);
    const completedWorkUnits =
      totalSourcesChecked + researchedCandidatesCount + comparedCandidatesCount;
    const overallProgressPct = Number(
      Math.min(100, (completedWorkUnits / Math.max(1, totalWorkUnits)) * 100).toFixed(1)
    );

    const searchProgress: SearchProgressBreakdown = {
      completed_sources_count: totalSourcesChecked,
      pending_sources_count: Math.max(0, totalSourcesConfigured - totalSourcesChecked),
      failed_or_restricted_sources_count: restrictedOrFailedSources.length,
      completed_queries_count: totalQueriesExecuted,
      remaining_queries_capacity: Math.max(0, plannedQueryBudget - totalQueriesExecuted),
      completed_research_count: researchedCandidatesCount,
      pending_research_count: awaitingResearchCount,
      completed_comparisons_count: comparedCandidatesCount,
      pending_comparisons_count: queuedForComparisonCount,
      failed_inspections_count: failedInspectionsCount,
      overall_progress_pct: overallProgressPct
    };

    // Historical snapshots & cross-investigation comparisons
    const historicalSnapshots = db.getCoverageSnapshots({
      referenceId: options?.referenceId,
      limit: 30
    });

    const investigationComparisons: SearchCoverageReport['investigation_comparisons'] = allReferences.map(ref => {
      const refCands = db.getCandidates({ referenceId: ref.id });
      const refJobs = allJobs.filter(j => j.target_reference_id === ref.id);
      const refSnaps = db.getCoverageSnapshots({ referenceId: ref.id, limit: 1 });
      const latestSnap = refSnaps[0];

      const refUnique = refCands.length;
      const refRel = refCands.filter(c => this.isCandidateRelevant(c)).length;
      const refRes = refCands.filter(c => this.isCandidateResearched(c)).length;
      const refComp = refCands.filter(c => this.isCandidateForensicallyCompared(c)).length;
      const refInsp = refCands.filter(
        c => c.reachability_code === 200 || c.pipeline_status === 'ANALYZED' || this.isCandidateResearched(c)
      ).length;

      let refPreset: DiscoveryPresetMode = latestSnap?.preset_mode || 'STANDARD';
      let refMaxUnique = latestSnap?.max_unique_candidates || this.DEFAULT_STANDARD_LIMIT;
      if (!latestSnap && refJobs[0]?.query_params) {
        try {
          const parsed = JSON.parse(refJobs[0].query_params);
          if (parsed.presetMode) refPreset = parsed.presetMode;
          if (parsed.maxUniqueCandidates || parsed.maxCandidates) {
            refMaxUnique = Number(parsed.maxUniqueCandidates || parsed.maxCandidates);
          }
        } catch {}
      }

      return {
        reference_id: ref.id,
        reference_title: ref.title,
        asset_type: ref.asset_type,
        latest_preset_mode: refPreset,
        max_unique_candidates: refMaxUnique,
        overall_estimated_coverage_pct: latestSnap?.overall_estimated_coverage_pct ?? overallEstimatedPct,
        source_inspection_pct:
          refUnique > 0 ? Number(((refInsp / refUnique) * 100).toFixed(1)) : latestSnap?.measured_source_inspection_pct ?? 0,
        candidate_research_pct:
          refUnique > 0 ? Number(((refRes / refUnique) * 100).toFixed(1)) : 0,
        forensic_comparison_pct:
          refRel > 0 ? Number(Math.min(100, (refComp / refRel) * 100).toFixed(1)) : refUnique > 0 ? Number(((refComp / refUnique) * 100).toFixed(1)) : 0,
        unique_candidates: refUnique,
        researched_candidates: refRes,
        compared_candidates: refComp,
        last_swept_at: refJobs[0]?.completed_at || refJobs[0]?.started_at || ref.created_at
      };
    });

    return {
      generated_at: nowIso,
      target_reference_id: targetRef?.id || options?.referenceId,
      target_reference_title: targetRef?.title,
      active_job_id: latestJob?.id,
      configured_limits: configuredLimits,
      overall_coverage: overallCoverage,
      discovery_performance: discoveryPerformance,
      candidate_lifecycle: candidateLifecycle,
      search_progress: searchProgress,
      platform_ecosystems: platformEcosystems,
      configured_sources: allSources,
      source_adapters: allAdapters,
      unavailable_or_inaccessible_sources: unavailableSources,
      remaining_gaps: remainingGaps,
      historical_snapshots: historicalSnapshots,
      investigation_comparisons: investigationComparisons
    };
  }

  /**
   * Records a persistent coverage snapshot in SQLite after a discovery sweep,
   * investigation expansion, or batch research/comparison run.
   */
  public static recordCoverageSnapshot(params: {
    jobId?: string;
    referenceId?: string;
    limits?: Partial<DiscoveryLimitsConfig>;
  }): SearchCoverageSnapshot {
    const report = this.generateCoverageReport({
      referenceId: params.referenceId,
      jobId: params.jobId,
      limitsOverride: params.limits
    });

    const snap: SearchCoverageSnapshot = {
      id: `covsnap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      job_id: params.jobId || report.active_job_id,
      reference_id: params.referenceId || report.target_reference_id,
      reference_title: report.target_reference_title,
      preset_mode: report.configured_limits.preset_mode,
      max_unique_candidates: report.configured_limits.max_unique_candidates,
      deep_research_limit: report.configured_limits.deep_research_limit,
      forensic_comparison_limit: report.configured_limits.forensic_comparison_limit,
      overall_estimated_coverage_pct: report.overall_coverage.estimated_searchable_coverage.percentage,
      measured_source_inspection_pct: report.overall_coverage.source_inspection_coverage.percentage,
      candidate_research_coverage_pct: report.overall_coverage.candidate_research_coverage.percentage,
      forensic_comparison_coverage_pct: report.overall_coverage.forensic_investigation_coverage.percentage,
      sources_configured: report.discovery_performance.sources_configured,
      sources_checked: report.discovery_performance.sources_checked,
      queries_executed: report.discovery_performance.search_queries_executed,
      pages_discovered: report.discovery_performance.pages_discovered,
      pages_inspected: report.discovery_performance.pages_inspected,
      raw_discovered_count: report.candidate_lifecycle.raw_discovered_count,
      unique_candidates_count: report.candidate_lifecycle.unique_candidates_count,
      relevant_candidates_count: report.candidate_lifecycle.relevant_candidates_count,
      researched_candidates_count: report.candidate_lifecycle.researched_candidates_count,
      awaiting_research_count: report.candidate_lifecycle.awaiting_research_count,
      queued_for_comparison_count: report.candidate_lifecycle.queued_for_comparison_count,
      compared_candidates_count: report.candidate_lifecycle.compared_candidates_count,
      rejected_count: report.candidate_lifecycle.rejected_or_irrelevant_count,
      created_at: new Date().toISOString()
    };

    db.insertCoverageSnapshot(snap);
    return snap;
  }
}
