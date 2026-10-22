/**
 * SPECTRA Source Adapter: Generic Web Crawler & Arbitrary Public Websites
 *
 * Uses Google Custom Search JSON API (when GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX are configured)
 * or live DuckDuckGo HTML Search to discover genuine, verifiable public web URLs.
 * Never fabricates domains or slug-based URLs, and never defaults failed HTTP probes to 200 OK.
 */

import { SourceAdapter, DiscoveredItem, MediaAcquisitionResult, AdapterDiagnostic } from './types.js';
import { YouTubeAdapter } from './youtube.js';

export class WebCrawlerAdapter implements SourceAdapter {
  public id = 'adapter_web_crawler';
  public name = 'General Web Search Crawler (DuckDuckGo / Google CSE)';
  public description = 'Queries live search engine indexes for public web pages, articles, and video player embeds matching the reference content.';
  public sourceCategory = 'OTHER' as const;
  private lastDiagnostic: AdapterDiagnostic | null = null;

  public canHandle(_url: string): boolean {
    return true; // Fallback handler for any arbitrary URL
  }

  public getLastDiagnostic(): AdapterDiagnostic | null {
    return this.lastDiagnostic;
  }

  /**
   * Executes a live search query via Google Custom Search API (if configured) or DuckDuckGo HTML endpoint.
   */
  public static async searchLiveWeb(
    searchQuery: string,
    maxResults: number = 8
  ): Promise<{ items: { url: string; title: string; domain: string }[]; providerUsed: string; error?: string }> {
    const googleKey = process.env.GOOGLE_SEARCH_API_KEY;
    const googleCx = process.env.GOOGLE_SEARCH_CX;

    // 1. Try Google Custom Search JSON API if credentials are configured
    if (googleKey && googleCx) {
      try {
        const cseUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googleKey)}&cx=${encodeURIComponent(googleCx)}&q=${encodeURIComponent(searchQuery)}&num=${Math.min(10, maxResults)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        const res = await fetch(cseUrl, { signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) {
          const json: any = await res.json();
          const items = (json.items || [])
            .filter((it: any) => it?.link && it?.title)
            .map((it: any) => {
              let domain = 'unknown';
              try {
                domain = new URL(it.link).hostname.replace(/^www\./, '').toLowerCase();
              } catch {}
              return { url: String(it.link), title: String(it.title).trim(), domain };
            });
          return { items, providerUsed: 'Google Custom Search API' };
        }
      } catch {}
    }

    // 2. Live DuckDuckGo HTML Search (works without API keys)
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(ddgUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { items: [], providerUsed: 'DuckDuckGo HTML Search', error: `HTTP ${res.status}` };
      }

      const html = await res.text();
      const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const items: { url: string; title: string; domain: string }[] = [];
      const seen = new Set<string>();
      let match: RegExpExecArray | null;

      while ((match = regex.exec(html)) !== null) {
        let href = match[1].trim();
        const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch) {
          try {
            href = decodeURIComponent(uddgMatch[1]);
          } catch {}
        }
        if (!href.startsWith('http://') && !href.startsWith('https://')) continue;
        // Skip DuckDuckGo internal ad/redirect links
        if (href.includes('duckduckgo.com/y.js') || href.includes('ad_domain')) continue;

        const rawTitle = match[2]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();

        if (!rawTitle) continue;

        const norm = href.toLowerCase();
        if (seen.has(norm)) continue;
        seen.add(norm);

        let domain = 'unknown';
        try {
          domain = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
          continue;
        }

        items.push({ url: href, title: rawTitle, domain });
        if (items.length >= maxResults) break;
      }

      return { items, providerUsed: 'DuckDuckGo Live Web Search' };
    } catch (err: any) {
      return { items: [], providerUsed: 'DuckDuckGo Live Web Search', error: err.message };
    }
  }

  public async discover(
    query: string,
    options: { maxResults?: number; referenceTitle?: string } = {}
  ): Promise<DiscoveredItem[]> {
    const limit = options.maxResults || 8;
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      this.lastDiagnostic = {
        adapterId: this.id,
        adapterName: this.name,
        sourceCategory: this.sourceCategory,
        status: 'NO_RESULTS',
        candidatesFound: 0,
        message: 'Empty search query.'
      };
      return [];
    }

    const searchResult = await WebCrawlerAdapter.searchLiveWeb(`${cleanQuery} watch live stream video`, limit * 2);
    const results: DiscoveredItem[] = [];

    for (const item of searchResult.items) {
      const relevance = YouTubeAdapter.computeRelevanceScore(item.title, cleanQuery, options.referenceTitle);
      if (relevance < 0.15) continue;

      const uLower = item.url.toLowerCase();
      const isDirectHls = uLower.endsWith('.m3u8');
      const isDirectMp4 = uLower.endsWith('.mp4');

      results.push({
        url: item.url,
        title: item.title,
        platform: item.domain,
        sourceCategory: isDirectHls || isDirectMp4 ? 'DIRECT_STREAM' : 'OTHER',
        assetKind: isDirectHls || isDirectMp4 ? 'VERIFIED_VIDEO_ASSET' : 'DISCOVERED_PAGE',
        suggestedType: isDirectHls ? 'HLS_M3U8' : (isDirectMp4 ? 'MP4' : 'HTML_PLAYER'),
        domain: item.domain,
        isLive: isDirectHls,
        relevanceScore: relevance,
        metadata: {
          searchQuery: cleanQuery,
          providerUsed: searchResult.providerUsed,
          relevanceScore: relevance
        }
      });

      if (results.length >= limit) break;
    }

    this.lastDiagnostic = {
      adapterId: this.id,
      adapterName: this.name,
      sourceCategory: this.sourceCategory,
      status: searchResult.error ? 'NETWORK_ERROR' : (results.length > 0 ? 'LIVE_OK' : 'NO_RESULTS'),
      candidatesFound: results.length,
      message: searchResult.error
        ? `${searchResult.providerUsed} error: ${searchResult.error}`
        : `${searchResult.providerUsed}: discovered ${results.length} relevant web page(s).`
    };

    return results;
  }

  public async acquireAndProbe(targetUrl: string, options: { timeoutMs?: number } = {}): Promise<MediaAcquisitionResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toISOString()}] [WebCrawlerAdapter] ${msg}`);

    log(`Probing web target: ${targetUrl}`);
    const uLower = targetUrl.toLowerCase();

    const isDirectHls = uLower.includes('.m3u8');
    const isDirectMp4 = uLower.includes('.mp4');

    let domain = 'web';
    try {
      domain = new URL(targetUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {}

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      const httpStatus = res.status;
      const latencyMs = Date.now() - startTime;
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });

      log(`Web target returned HTTP ${httpStatus} (${latencyMs}ms)`);

      if (httpStatus === 401 || httpStatus === 403) {
        log(`Target returned HTTP ${httpStatus} (Forbidden / Anti-bot or Auth wall).`);
        return {
          accessible: false,
          pipelineStatus: 'BLOCKED',
          httpStatus,
          latencyMs,
          mediaType: 'UNKNOWN',
          platform: domain,
          headers,
          technicalLogs: logs,
          extractionNotice: `Target server returned HTTP ${httpStatus} (Access Blocked).`
        };
      }

      if (httpStatus >= 400) {
        log(`HTTP status ${httpStatus} indicates resource is offline or not found.`);
        return {
          accessible: false,
          pipelineStatus: 'UNREACHABLE',
          httpStatus,
          latencyMs,
          mediaType: 'UNKNOWN',
          platform: domain,
          headers,
          technicalLogs: logs,
          extractionNotice: `Target server returned HTTP ${httpStatus}.`
        };
      }

      const contentType = (headers['content-type'] || '').toLowerCase();

      if (isDirectHls || contentType.includes('mpegurl')) {
        const bodyText = await res.text().catch(() => '');
        if (bodyText.includes('#EXT-X-KEY') && (bodyText.includes('SAMPLE-AES') || bodyText.includes('skd://') || bodyText.includes('widevine'))) {
          log(`Detected encrypted HLS manifest (#EXT-X-KEY DRM).`);
          return {
            accessible: false,
            pipelineStatus: 'DRM_PROTECTED',
            httpStatus,
            latencyMs,
            mediaType: 'HLS_M3U8',
            platform: domain,
            drmScheme: 'SAMPLE-AES / FairPlay / Widevine',
            headers,
            technicalLogs: logs,
            extractionNotice: 'Encrypted HLS manifest; DRM circumvention is prohibited.'
          };
        }
        log(`Verified unencrypted HLS stream manifest (.m3u8).`);
        return {
          accessible: true,
          pipelineStatus: 'ACQUIRED',
          httpStatus,
          latencyMs,
          mediaType: 'HLS_M3U8',
          resolvedMediaUrl: targetUrl,
          platform: domain,
          headers,
          technicalLogs: logs
        };
      }

      if (isDirectMp4 || contentType.includes('video/mp4') || contentType.includes('video/webm')) {
        log(`Verified direct progressive video file (${contentType || 'MP4'}).`);
        return {
          accessible: true,
          pipelineStatus: 'ACQUIRED',
          httpStatus,
          latencyMs,
          mediaType: 'MP4',
          resolvedMediaUrl: targetUrl,
          platform: domain,
          headers,
          technicalLogs: logs
        };
      }

      // Parse HTML page to inspect actual title and check for embedded video / stream links
      const html = await res.text().catch(() => '');
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const pageTitle = titleMatch
        ? titleMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
        : undefined;

      if (pageTitle) {
        log(`Verified HTML page title: "${pageTitle}"`);
      }

      // Check if HTML embeds a direct .m3u8 or .mp4 stream URL
      const embeddedStreamMatch = html.match(/https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4)(?:\?[^"'\\\s<>]*)?/i);
      const hasVideoTagOrIframe = /<(?:video|iframe|embed)\b/i.test(html);

      if (embeddedStreamMatch) {
        const streamUrl = embeddedStreamMatch[0];
        log(`Detected embedded media stream URL in HTML: ${streamUrl}`);
        return {
          accessible: true,
          pipelineStatus: 'ACQUIRED',
          httpStatus,
          latencyMs,
          mediaType: streamUrl.toLowerCase().includes('.m3u8') ? 'HLS_M3U8' : 'MP4',
          resolvedMediaUrl: streamUrl,
          pageTitle,
          platform: domain,
          headers,
          technicalLogs: logs,
          extractionNotice: `Extracted direct media stream (${streamUrl}) from HTML page.`
        };
      }

      if (hasVideoTagOrIframe) {
        log(`HTML page is reachable and contains an embedded player (<video>/<iframe>), but no direct unencrypted raw stream URL was exposed.`);
        return {
          accessible: true,
          pipelineStatus: 'MEDIA_DETECTED',
          httpStatus,
          latencyMs,
          mediaType: 'HTML_PLAYER',
          pageTitle,
          platform: domain,
          headers,
          technicalLogs: logs,
          extractionNotice: 'Reachable web page with embedded player container; unverified without direct stream extraction.'
        };
      }

      log(`HTML web page is reachable (HTTP 200), but no direct video stream or player container was detected on the page.`);
      return {
        accessible: true,
        pipelineStatus: 'REACHABLE',
        httpStatus,
        latencyMs,
        mediaType: 'UNKNOWN',
        pageTitle,
        platform: domain,
        headers,
        technicalLogs: logs,
        extractionNotice: 'Web page is reachable (HTTP 200) and references the topic, but contains no direct video stream.'
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      log(`Network probe failed (host unreachable or DNS error): ${err.message}`);
      return {
        accessible: false,
        pipelineStatus: 'UNREACHABLE',
        httpStatus: 0,
        latencyMs,
        mediaType: 'UNKNOWN',
        platform: domain,
        headers: {},
        technicalLogs: logs,
        extractionNotice: `Target host unreachable: ${err.message}`
      };
    }
  }
}
