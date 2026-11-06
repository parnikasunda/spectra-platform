/**
 * SPECTRA Source Adapter Framework — Central Registry & Multi-Source Orchestrator
 */

import { SourceAdapter, DiscoveredItem, AdapterDiagnostic } from './types.js';
import { YouTubeAdapter } from './youtube.js';
import { StreamingServicesAdapter } from './streaming.js';
import { PublicVideoPlatformsAdapter } from './public_video.js';
import { O2TvSeriesAdapter } from './o2tvseries.js';
import { SuspectedPiracyAdapter } from './suspected_piracy.js';
import { WebCrawlerAdapter } from './web_crawler.js';
import { DiscoveryProvider } from '../../types.js';
import { SourceAdapterRegistry } from '../sourceAdapters.js';
import { SearchCoverageEngine } from '../searchCoverage.js';

export * from './types.js';
export { YouTubeAdapter } from './youtube.js';
export { StreamingServicesAdapter } from './streaming.js';
export { PublicVideoPlatformsAdapter } from './public_video.js';
export { O2TvSeriesAdapter } from './o2tvseries.js';
export { SuspectedPiracyAdapter } from './suspected_piracy.js';
export { WebCrawlerAdapter } from './web_crawler.js';

export class AdapterRegistry {
  private static o2tvAdapter = new O2TvSeriesAdapter();

  private static adapters: SourceAdapter[] = [
    new YouTubeAdapter(),
    new StreamingServicesAdapter(),
    new PublicVideoPlatformsAdapter(),
    AdapterRegistry.o2tvAdapter,
    new SuspectedPiracyAdapter(),
    new WebCrawlerAdapter() // Fallback
  ];

  private static lastRunDiagnostics: AdapterDiagnostic[] = [];

  public static getO2TvSeriesAdapter(): O2TvSeriesAdapter {
    return this.o2tvAdapter;
  }

  /**
   * Returns all active source adapters
   */
  public static getAllAdapters(): SourceAdapter[] {
    return this.adapters;
  }

  /**
   * Returns diagnostics from the most recent discovery sweep
   */
  public static getLastRunDiagnostics(): AdapterDiagnostic[] {
    return this.lastRunDiagnostics;
  }

  /**
   * Resolves the most appropriate adapter for a given target URL
   */
  public static getAdapterForUrl(url: string): SourceAdapter {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(url)) {
        return adapter;
      }
    }
    return this.adapters[this.adapters.length - 1]; // WebCrawlerAdapter fallback
  }

  /**
   * Executes coordinated multi-source candidate discovery across real live endpoints:
   * - YouTube Public Search (ytInitialData + oEmbed)
   * - Public Video Platforms (Dailymotion REST API + Internet Archive Search API)
   * - Commercial Streaming Services (Live web search across Netflix / Hotstar / SonyLIV / Prime)
   * - O2TvSeries4u Persistent Discovery Source (https://o2tvseries4u.com/ catalog, pagination, episode & MP4 links)
   * - Suspected Piracy & Stream Indexers (Live web search & seed portals)
   * - General Web Search Crawler (DuckDuckGo HTML / Google Custom Search API)
   *
   * Never fabricates URLs. Records honest per-adapter diagnostics.
   */
  public static async executeMultiSourceDiscovery(
    query: string,
    options: {
      provider?: DiscoveryProvider;
      maxTotalCandidates?: number;
      referenceTitle?: string;
      targetReferenceId?: string;
      keywordCombinations?: string[];
      seedSources?: string[];
      o2tvEnabled?: boolean;
      o2tvBaseUrlOverride?: string;
    } = {}
  ): Promise<DiscoveredItem[]> {
    const provider = options.provider || 'ALL_SOURCES';
    const targetCount = Math.max(1, Math.min(1000, options.maxTotalCandidates || 250));
    const allDiscovered: DiscoveredItem[] = [];
    const diagnostics: AdapterDiagnostic[] = [];

    let selectedAdapters = this.adapters;

    if (provider === 'YOUTUBE_PUBLIC') {
      selectedAdapters = this.adapters.filter(a => a instanceof YouTubeAdapter);
    } else if (provider === 'STREAMING_SERVICES') {
      selectedAdapters = this.adapters.filter(a => a instanceof StreamingServicesAdapter);
    } else if (provider === 'SUSPECTED_PIRACY' || provider === 'STREAM_INDEXER' || provider === 'SPORTS_DIRECTORY' || provider === 'IPTV_PROBER') {
      selectedAdapters = this.adapters.filter(
        a => a instanceof O2TvSeriesAdapter || a instanceof SuspectedPiracyAdapter || a instanceof WebCrawlerAdapter
      );
    } else if (provider === 'PUBLIC_PLATFORMS') {
      selectedAdapters = this.adapters.filter(a => a instanceof PublicVideoPlatformsAdapter);
    } else if (provider === 'SEARCH_CRAWLER') {
      selectedAdapters = this.adapters.filter(a => a instanceof WebCrawlerAdapter);
    }

    if (options.o2tvEnabled === false) {
      selectedAdapters = selectedAdapters.filter(a => !(a instanceof O2TvSeriesAdapter));
    }

    // Filter out adapters disabled by investigator in SourceAdapterRegistry / SearchCoverageEngine (when running ALL_SOURCES)
    if (provider === 'ALL_SOURCES') {
      selectedAdapters = selectedAdapters.filter(a => {
        if (a instanceof YouTubeAdapter) return SourceAdapterRegistry.isAdapterEnabled('adapter_youtube');
        if (a instanceof StreamingServicesAdapter) return SourceAdapterRegistry.isAdapterEnabled('adapter_authorized_ott');
        if (a instanceof PublicVideoPlatformsAdapter) {
          return (
            SourceAdapterRegistry.isAdapterEnabled('adapter_dailymotion') ||
            SourceAdapterRegistry.isAdapterEnabled('adapter_public_video_platform')
          );
        }
        if (a instanceof O2TvSeriesAdapter || a instanceof SuspectedPiracyAdapter) {
          return SearchCoverageEngine.isEcosystemEnabled('configured_piracy_sources');
        }
        if (a instanceof WebCrawlerAdapter) {
          return SearchCoverageEngine.isEcosystemEnabled('web_search_crawler');
        }
        return true;
      });
    }

    for (const adapter of selectedAdapters) {
      if (!adapter.discover) continue;

      try {
        const perAdapterTarget =
          selectedAdapters.length === 1
            ? targetCount
            : Math.max(8, Math.ceil(targetCount / selectedAdapters.length) + 4);

        const items =
          adapter instanceof O2TvSeriesAdapter
            ? await adapter.discover(query, {
                maxResults: perAdapterTarget,
                referenceTitle: options.referenceTitle,
                targetReferenceId: options.targetReferenceId,
                keywordCombinations: options.keywordCombinations,
                baseUrlOverride: options.o2tvBaseUrlOverride
              })
            : await adapter.discover(query, {
                maxResults: perAdapterTarget,
                referenceTitle: options.referenceTitle,
                keywordCombinations: options.keywordCombinations,
                seedSources: options.seedSources
              });

        for (const it of items) {
          if (!it.originalUrl) it.originalUrl = it.url;
          if (!it.matchedKeywords || it.matchedKeywords.length === 0) {
            it.matchedKeywords = [query];
          }
          if (!it.referringPage) {
            it.referringPage = `${adapter.name}`;
          }
          if (!it.crawlStatus) {
            it.crawlStatus = 'DISCOVERED';
          }
          if (!it.sourceType) {
            it.sourceType = it.metadata?.seedSource ? 'configured_website' : 'title_search';
          }
          if (!it.matchMethod) {
            it.matchMethod = it.mediaUrl ? 'title_match, direct_media_link' : 'title_match';
          }
          if (!it.matchedContentId && options.targetReferenceId) {
            it.matchedContentId = options.targetReferenceId;
          }
          if (!it.candidateClassification) {
            it.candidateClassification =
              it.assetKind === 'VERIFIED_VIDEO_ASSET'
                ? 'VERIFIED_VIDEO_ASSET'
                : it.suggestedType === 'HLS_M3U8' || it.suggestedType === 'MP4' || it.suggestedType === 'WEBM'
                ? 'VIDEO_ASSET'
                : 'GENERAL_WEBPAGE';
          }
        }
        allDiscovered.push(...items);

        if (adapter.getLastDiagnostic) {
          const diag = adapter.getLastDiagnostic();
          if (diag) diagnostics.push(diag);
        }
      } catch (err: any) {
        console.warn(`[AdapterRegistry] Discovery error in ${adapter.name}:`, err.message);
        diagnostics.push({
          adapterId: adapter.id,
          adapterName: adapter.name,
          sourceCategory: adapter.sourceCategory,
          status: 'NETWORK_ERROR',
          candidatesFound: 0,
          message: `Adapter execution failed: ${err.message}`
        });
      }
    }

    this.lastRunDiagnostics = diagnostics;

    // Deduplicate by (normalized source_url + normalized media_url) so distinct video assets on the same webpage remain separate
    const seenMap = new Map<string, DiscoveredItem>();
    const unique: DiscoveredItem[] = [];

    for (const item of allDiscovered) {
      const normUrl = item.url.toLowerCase().trim();
      const normMedia = (item.mediaUrl || '').toLowerCase().trim();
      const dedupKey = `${normUrl}||${normMedia}`;
      const existing = seenMap.get(dedupKey);
      if (!existing) {
        seenMap.set(dedupKey, item);
        unique.push(item);
      } else {
        const mergedKw = Array.from(
          new Set([...(existing.matchedKeywords || []), ...(item.matchedKeywords || [])])
        );
        existing.matchedKeywords = mergedKw;
        if ((item.relevanceScore ?? 0) > (existing.relevanceScore ?? 0)) {
          existing.relevanceScore = item.relevanceScore;
        }
        if (item.sourceType && existing.sourceType && !existing.sourceType.includes(item.sourceType)) {
          existing.sourceType = `${existing.sourceType}, ${item.sourceType}`;
        }
        if (item.matchMethod && existing.matchMethod && !existing.matchMethod.includes(item.matchMethod)) {
          existing.matchMethod = `${existing.matchMethod}, ${item.matchMethod}`;
        }
      }
    }

    unique.sort((a, b) => {
      const aDirect = a.assetKind === 'VERIFIED_VIDEO_ASSET' || Boolean(a.mediaUrl) ? 1 : 0;
      const bDirect = b.assetKind === 'VERIFIED_VIDEO_ASSET' || Boolean(b.mediaUrl) ? 1 : 0;
      const aRel = a.relevanceScore ?? 0.5;
      const bRel = b.relevanceScore ?? 0.5;
      if (Math.abs(bRel - aRel) >= 0.08) return bRel - aRel;
      if (aDirect !== bDirect) return bDirect - aDirect;
      return bRel - aRel;
    });

    return unique.slice(0, targetCount);
  }
}
