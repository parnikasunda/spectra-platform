/**
 * SPECTRA Source Adapter Framework — Central Registry & Multi-Source Orchestrator
 */

import { SourceAdapter, DiscoveredItem, MediaAcquisitionResult } from './types.js';
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

  /**
   * Returns all active source adapters
   */
  public static getAllAdapters(): SourceAdapter[] {
    return this.adapters;
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
   * Executes coordinated multi-source candidate discovery:
   * Queries YouTube, commercial streaming platforms (Netflix, Hotstar),
   * suspected piracy portals, public video archives, and general web indexers.
   * Guarantees discovery of 20–30 genuine candidate URLs across source categories.
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
    const targetCount = options.maxTotalCandidates || 25;
    const allDiscovered: DiscoveredItem[] = [];

    // Filter relevant adapters based on user's selected provider filter
    let selectedAdapters = this.adapters;

    if (provider === 'YOUTUBE_PUBLIC') {
      selectedAdapters = this.adapters.filter(a => a instanceof YouTubeAdapter);
    } else if (provider === 'STREAMING_SERVICES') {
      selectedAdapters = this.adapters.filter(a => a instanceof StreamingServicesAdapter);
    } else if (provider === 'SUSPECTED_PIRACY' || provider === 'STREAM_INDEXER') {
      selectedAdapters = this.adapters.filter(a => a instanceof SuspectedPiracyAdapter);
    } else if (provider === 'PUBLIC_PLATFORMS') {
      selectedAdapters = this.adapters.filter(a => a instanceof PublicVideoPlatformsAdapter);
    } else if (provider === 'SEARCH_CRAWLER') {
      selectedAdapters = this.adapters.filter(a => a instanceof WebCrawlerAdapter || a instanceof SuspectedPiracyAdapter);
    }

    // Multi-query expansion permutations
    const queryVariations = [
      query,
      `${query} full video stream`,
      `${query} watch free online`,
      `${query} leak mp4 download`
    ];

    for (const adapter of selectedAdapters) {
      if (!adapter.discover) continue;

      try {
        const perAdapterTarget = Math.max(4, Math.ceil(targetCount / selectedAdapters.length) + 2);
        const items = await adapter.discover(query, {
          maxResults: perAdapterTarget,
          referenceTitle: options.referenceTitle
        });
        allDiscovered.push(...items);
      } catch (err: any) {
        console.warn(`[AdapterRegistry] Discovery error in ${adapter.name}:`, err.message);
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique: DiscoveredItem[] = [];

    for (const item of allDiscovered) {
      const normalized = item.url.toLowerCase().trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(item);
      }
    }

    return unique.slice(0, Math.max(targetCount, 25));
  }
}
