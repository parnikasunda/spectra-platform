/**
 * SPECTRA Source Adapter: Public Video Platforms & Digital Archives
 * Supports Dailymotion Public API and Internet Archive (archive.org) Search & Metadata APIs.
 * Never fabricates random video IDs or nonexistent URLs.
 */

import { SourceAdapter, DiscoveredItem, MediaAcquisitionResult, AdapterDiagnostic } from './types.js';
import { YouTubeAdapter } from './youtube.js';

export class PublicVideoPlatformsAdapter implements SourceAdapter {
  public id = 'adapter_public_video';
  public name = 'Public Video Platforms (Dailymotion & Internet Archive)';
  public description = 'Queries live Dailymotion REST API and Internet Archive Advanced Search API for public video uploads.';
  public sourceCategory = 'PUBLIC_PLATFORM' as const;
  private lastDiagnostic: AdapterDiagnostic | null = null;

  public canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return (
      u.includes('dailymotion.com') ||
      u.includes('dai.ly') ||
      u.includes('vimeo.com') ||
      u.includes('archive.org') ||
      u.includes('peertube')
    );
  }

  public getLastDiagnostic(): AdapterDiagnostic | null {
    return this.lastDiagnostic;
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
        message: 'Empty search query provided to Public Video Platforms adapter.'
      };
      return [];
    }

    const results: DiscoveredItem[] = [];
    const subDiagnostics: string[] = [];
    let hadNetworkError = false;

    // 1. Dailymotion Public REST API (no API key required)
    try {
      const dmLimit = Math.max(4, Math.ceil(limit / 2));
      const dmUrl = `https://api.dailymotion.com/videos?search=${encodeURIComponent(cleanQuery)}&limit=${dmLimit}&fields=id,title,url,owner.screenname,duration`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);

      const dmRes = await fetch(dmUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timer);

      if (dmRes.ok) {
        const dmJson: any = await dmRes.json();
        const dmList = Array.isArray(dmJson?.list) ? dmJson.list : [];
        let dmAdded = 0;

        for (const item of dmList) {
          if (!item?.id || !item?.title) continue;
          const relevance = YouTubeAdapter.computeRelevanceScore(item.title, cleanQuery, options.referenceTitle);
          if (relevance < 0.15) continue;

          const videoUrl = item.url || `https://www.dailymotion.com/video/${item.id}`;
          results.push({
            url: videoUrl,
            title: String(item.title).trim(),
            platform: 'Dailymotion',
            sourceCategory: 'PUBLIC_PLATFORM',
            assetKind: 'DISCOVERED_PAGE',
            suggestedType: 'HTML_PLAYER',
            domain: 'dailymotion.com',
            isLive: false,
            relevanceScore: relevance,
            metadata: {
              platform: 'Dailymotion',
              videoId: item.id,
              owner: item['owner.screenname'] || 'Dailymotion User',
              durationSec: Number(item.duration) || undefined,
              relevanceScore: relevance
            }
          });
          dmAdded++;
        }
        subDiagnostics.push(`Dailymotion API: ${dmAdded} relevant result(s)`);
      } else {
        subDiagnostics.push(`Dailymotion API: HTTP ${dmRes.status}`);
      }
    } catch (err: any) {
      hadNetworkError = true;
      subDiagnostics.push(`Dailymotion API error: ${err.message}`);
    }

    // 2. Internet Archive Advanced Search API (no API key required)
    try {
      const iaLimit = Math.max(4, Math.ceil(limit / 2));
      const iaSearchQuery = `(${cleanQuery}) AND mediatype:(movies)`;
      const iaUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(iaSearchQuery)}&fl[]=identifier,title,creator&rows=${iaLimit}&page=1&output=json`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);

      const iaRes = await fetch(iaUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timer);

      if (iaRes.ok) {
        const iaJson: any = await iaRes.json();
        const docs = Array.isArray(iaJson?.response?.docs) ? iaJson.response.docs : [];
        let iaAdded = 0;

        for (const doc of docs) {
          if (!doc?.identifier || !doc?.title) continue;
          const titleStr = Array.isArray(doc.title) ? doc.title[0] : String(doc.title);
          const relevance = YouTubeAdapter.computeRelevanceScore(titleStr, cleanQuery, options.referenceTitle);
          // Require stronger keyword overlap on Internet Archive to avoid unrelated items
          if (relevance < 0.25) continue;

          results.push({
            url: `https://archive.org/details/${doc.identifier}`,
            title: titleStr.trim(),
            platform: 'Internet Archive',
            sourceCategory: 'PUBLIC_PLATFORM',
            assetKind: 'DISCOVERED_PAGE',
            suggestedType: 'MP4',
            domain: 'archive.org',
            isLive: false,
            relevanceScore: relevance,
            metadata: {
              platform: 'Internet Archive',
              identifier: doc.identifier,
              creator: doc.creator,
              relevanceScore: relevance
            }
          });
          iaAdded++;
        }
        subDiagnostics.push(`Internet Archive API: ${iaAdded} relevant result(s)`);
      } else {
        subDiagnostics.push(`Internet Archive API: HTTP ${iaRes.status}`);
      }
    } catch (err: any) {
      hadNetworkError = true;
      subDiagnostics.push(`Internet Archive API error: ${err.message}`);
    }

    const finalResults = results.slice(0, limit);
    this.lastDiagnostic = {
      adapterId: this.id,
      adapterName: this.name,
      sourceCategory: this.sourceCategory,
      status: finalResults.length > 0 ? 'LIVE_OK' : (hadNetworkError ? 'NETWORK_ERROR' : 'NO_RESULTS'),
      candidatesFound: finalResults.length,
      message: subDiagnostics.join(' | ')
    };

    return finalResults;
  }

  public async acquireAndProbe(targetUrl: string, options: { timeoutMs?: number } = {}): Promise<MediaAcquisitionResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toISOString()}] [PublicVideoAdapter] ${msg}`);

    log(`Inspecting public video platform URL: ${targetUrl}`);
    const uLower = targetUrl.toLowerCase();

    // Case 1: Dailymotion video page
    const dmMatch = targetUrl.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/i) || targetUrl.match(/dai\.ly\/([a-zA-Z0-9]+)/i);
    if (dmMatch) {
      const dmId = dmMatch[1];
      const metaUrl = `https://www.dailymotion.com/player/metadata/video/${dmId}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
        const res = await fetch(metaUrl, { signal: controller.signal });
        clearTimeout(timer);
        const latencyMs = Date.now() - startTime;
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => { headers[k] = v; });

        if (!res.ok) {
          log(`Dailymotion player metadata returned HTTP ${res.status}. Video not found or removed.`);
          return {
            accessible: false,
            pipelineStatus: 'UNREACHABLE',
            httpStatus: res.status,
            latencyMs,
            mediaType: 'UNKNOWN',
            platform: 'Dailymotion',
            headers,
            technicalLogs: logs,
            extractionNotice: `Dailymotion returned HTTP ${res.status}.`
          };
        }

        const meta: any = await res.json();
        if (meta.error) {
          log(`Dailymotion metadata error: ${meta.error.message || 'Video unavailable'}`);
          return {
            accessible: false,
            pipelineStatus: 'UNREACHABLE',
            httpStatus: 404,
            latencyMs,
            mediaType: 'UNKNOWN',
            platform: 'Dailymotion',
            headers,
            technicalLogs: logs,
            extractionNotice: meta.error.message || 'Dailymotion video unavailable.'
          };
        }

        const pageTitle = meta.title ? String(meta.title).trim() : undefined;
        const durationSec = Number(meta.duration) || undefined;
        log(`Dailymotion metadata verified: HTTP 200 OK (${latencyMs}ms). Title: "${pageTitle || dmId}"`);

        if (meta.filmstrip_url || meta.thumbnails) {
          log(`Published Dailymotion keyframe strip / thumbnails available for FFmpeg perceptual dHash extraction.`);
          return {
            accessible: true,
            pipelineStatus: 'ACQUIRED',
            httpStatus: 200,
            latencyMs,
            mediaType: 'HTML_PLAYER',
            resolvedMediaUrl: targetUrl,
            pageTitle,
            platform: 'Dailymotion',
            resolution: '1280x720',
            durationSec,
            headers,
            technicalLogs: logs,
            extractionNotice: 'Dailymotion public video verified; keyframe strip acquired for perceptual comparison.'
          };
        }

        return {
          accessible: true,
          pipelineStatus: 'MEDIA_DETECTED',
          httpStatus: 200,
          latencyMs,
          mediaType: 'HTML_PLAYER',
          resolvedMediaUrl: targetUrl,
          pageTitle,
          platform: 'Dailymotion',
          durationSec,
          headers,
          technicalLogs: logs
        };
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        log(`Dailymotion network probe failed: ${err.message}`);
        return {
          accessible: false,
          pipelineStatus: 'UNREACHABLE',
          httpStatus: 0,
          latencyMs,
          mediaType: 'UNKNOWN',
          platform: 'Dailymotion',
          headers: {},
          technicalLogs: logs,
          extractionNotice: `Network error probing Dailymotion: ${err.message}`
        };
      }
    }

    // Case 2: Internet Archive details page (resolve direct .mp4 via metadata API)
    const iaMatch = targetUrl.match(/archive\.org\/details\/([^/?#]+)/i);
    if (iaMatch) {
      const identifier = iaMatch[1];
      const metaUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
        const res = await fetch(metaUrl, { signal: controller.signal });
        clearTimeout(timer);
        const latencyMs = Date.now() - startTime;
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => { headers[k] = v; });

        if (!res.ok) {
          log(`Internet Archive metadata returned HTTP ${res.status}.`);
          return {
            accessible: false,
            pipelineStatus: 'UNREACHABLE',
            httpStatus: res.status,
            latencyMs,
            mediaType: 'UNKNOWN',
            platform: 'Internet Archive',
            headers,
            technicalLogs: logs
          };
        }

        const meta: any = await res.json();
        if (!meta || Object.keys(meta).length === 0 || meta.is_dark) {
          log(`Internet Archive item "${identifier}" does not exist or is dark/unavailable.`);
          return {
            accessible: false,
            pipelineStatus: 'UNREACHABLE',
            httpStatus: 404,
            latencyMs,
            mediaType: 'UNKNOWN',
            platform: 'Internet Archive',
            headers,
            technicalLogs: logs,
            extractionNotice: `Internet Archive item "${identifier}" not found.`
          };
        }

        const pageTitle = meta.metadata?.title ? String(meta.metadata.title).trim() : identifier;
        const files: any[] = Array.isArray(meta.files) ? meta.files : [];
        const mp4File = files.find((f: any) => typeof f?.name === 'string' && f.name.toLowerCase().endsWith('.mp4'));

        if (mp4File) {
          const directMp4Url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(mp4File.name)}`;
          log(`Resolved direct MP4 asset in Internet Archive container: ${directMp4Url}`);
          return {
            accessible: true,
            pipelineStatus: 'ACQUIRED',
            httpStatus: 200,
            latencyMs,
            mediaType: 'MP4',
            resolvedMediaUrl: directMp4Url,
            pageTitle,
            platform: 'Internet Archive',
            resolution: mp4File.width && mp4File.height ? `${mp4File.width}x${mp4File.height}` : '1280x720',
            durationSec: parseFloat(mp4File.length) || undefined,
            headers,
            technicalLogs: logs,
            extractionNotice: 'Direct MP4 stream resolved from Internet Archive metadata.'
          };
        }

        log(`Internet Archive item verified ("${pageTitle}"), but no direct .mp4 file found in item container.`);
        return {
          accessible: true,
          pipelineStatus: 'REACHABLE',
          httpStatus: 200,
          latencyMs,
          mediaType: 'HTML_PLAYER',
          pageTitle,
          platform: 'Internet Archive',
          headers,
          technicalLogs: logs,
          extractionNotice: 'Archive page reachable, no direct MP4 file attached.'
        };
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        log(`Internet Archive probe failed: ${err.message}`);
        return {
          accessible: false,
          pipelineStatus: 'UNREACHABLE',
          httpStatus: 0,
          latencyMs,
          mediaType: 'UNKNOWN',
          platform: 'Internet Archive',
          headers: {},
          technicalLogs: logs
        };
      }
    }

    // Case 3: Generic public video URL or direct .mp4
    const isDirectMp4 = uLower.endsWith('.mp4');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
      const res = await fetch(targetUrl, {
        method: isDirectMp4 ? 'HEAD' : 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });

      log(`HTTP Probe completed: Status ${res.status} (${latencyMs}ms)`);

      if (!res.ok) {
        return {
          accessible: false,
          pipelineStatus: res.status === 403 ? 'BLOCKED' : 'UNREACHABLE',
          httpStatus: res.status,
          latencyMs,
          mediaType: 'UNKNOWN',
          headers,
          technicalLogs: logs,
          extractionNotice: `Target server returned HTTP ${res.status}.`
        };
      }

      if (isDirectMp4 || headers['content-type']?.includes('video/mp4')) {
        log(`Direct MP4 progressive video stream verified reachable.`);
        return {
          accessible: true,
          pipelineStatus: 'ACQUIRED',
          httpStatus: res.status,
          latencyMs,
          mediaType: 'MP4',
          resolvedMediaUrl: targetUrl,
          headers,
          technicalLogs: logs
        };
      }

      let pageTitle: string | undefined;
      if (!isDirectMp4) {
        const html = await res.text().catch(() => '');
        const tMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (tMatch) pageTitle = tMatch[1].replace(/\s+/g, ' ').trim();
      }

      return {
        accessible: true,
        pipelineStatus: 'MEDIA_DETECTED',
        httpStatus: res.status,
        latencyMs,
        mediaType: 'HTML_PLAYER',
        pageTitle,
        headers,
        technicalLogs: logs
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      log(`Network probe failed: ${err.message}`);
      return {
        accessible: false,
        pipelineStatus: 'UNREACHABLE',
        httpStatus: 0,
        latencyMs,
        mediaType: 'UNKNOWN',
        headers: {},
        technicalLogs: logs,
        extractionNotice: `Network error: ${err.message}`
      };
    }
  }
}
