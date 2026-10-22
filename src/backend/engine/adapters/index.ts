/**
 * SPECTRA Source Adapter Framework — Central Registry & Multi-Source Orchestrator
 */

import { SourceAdapter, DiscoveredItem, AdapterDiagnostic } from './types.js';
import { YouTubeAdapter } from './youtube.js';
import { StreamingServicesAdapter } from './streaming.js';
import { PublicVideoPlatformsAdapter } from './public_video.js';
import { SuspectedPiracyAdapter } from './suspected_piracy.js';
import { WebCrawlerAdapter } from './web_crawler.js';
import { DiscoveryProvider } from '../../types.js';

export * from './types.js';
export { YouTubeAdapter } from './youtube.js';
export { StreamingServicesAdapter } from './streaming.js';
export { PublicVideoPlatformsAdapter } from './public_video.js';
export { SuspectedPiracyAdapter } from './suspected_piracy.js';
export { WebCrawlerAdapter } from './web_crawler.js';

export class AdapterRegistry {
  private static adapters: SourceAdapter[] = [
    new YouTubeAdapter(),
    new StreamingServicesAdapter(),
    new PublicVideoPlatformsAdapter(),
    new SuspectedPiracyAdapter(),
    new WebCrawlerAdapter() // Fallback
  ];

  private static lastRunDiagnostics: AdapterDiagnostic[] = [];

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
   * - Suspected Piracy & Stream Indexers (Live web search for third-party stream pages)
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
    } = {}
  ): Promise<DiscoveredItem[]> {
    const provider = options.provider || 'ALL_SOURCES';
    const targetCount = options.maxTotalCandidates || 15;
    const allDiscovered: DiscoveredItem[] = [];
    const diagnostics: AdapterDiagnostic[] = [];

    let selectedAdapters = this.adapters;

    if (provider === 'YOUTUBE_PUBLIC') {
      selectedAdapters = this.adapters.filter(a => a instanceof YouTubeAdapter);
    } else if (provider === 'STREAMING_SERVICES') {
      selectedAdapters = this.adapters.filter(a => a instanceof StreamingServicesAdapter);
    } else if (provider === 'SUSPECTED_PIRACY' || provider === 'STREAM_INDEXER' || provider === 'SPORTS_DIRECTORY' || provider === 'IPTV_PROBER') {
      selectedAdapters = this.adapters.filter(a => a instanceof SuspectedPiracyAdapter || a instanceof WebCrawlerAdapter);
    } else if (provider === 'PUBLIC_PLATFORMS') {
      selectedAdapters = this.adapters.filter(a => a instanceof PublicVideoPlatformsAdapter);
    } else if (provider === 'SEARCH_CRAWLER') {
      selectedAdapters = this.adapters.filter(a => a instanceof WebCrawlerAdapter);
    }

    for (const adapter of selectedAdapters) {
      if (!adapter.discover) continue;

      try {
        const perAdapterTarget =
          selectedAdapters.length === 1
            ? targetCount
            : Math.max(5, Math.ceil(targetCount / selectedAdapters.length) + 2);

        const items = await adapter.discover(query, {
          maxResults: perAdapterTarget,
          referenceTitle: options.referenceTitle
        });
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

    // Deduplicate by normalized URL
    const seen = new Set<string>();
    const unique: DiscoveredItem[] = [];

    for (const item of allDiscovered) {
      const normalized = item.url.toLowerCase().trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(item);
      }
    }

    return unique.slice(0, targetCount);
  }
}
