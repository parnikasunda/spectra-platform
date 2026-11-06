/**
 * SPECTRA Persistent Discovery Source Adapter: O2TvSeries4u (https://o2tvseries4u.com/)
 *
 * Performs multi-page inspection across homepage, alphabetical category pages,
 * A-Z TV series catalog (/search/list_all_tv_series), series pages, season pages,
 * pagination/sort views (page1.html?sort=old, page2.html), and episode pages.
 *
 * Extracts episode metadata, embedded players, and distinct downloadable media links
 * (/download/\d+, .mp4, .m3u8, .webm) while preserving full provenance and respecting
 * anti-bot / access controls without bypass.
 */

import { SourceAdapter, DiscoveredItem, MediaAcquisitionResult, AdapterDiagnostic } from './types.js';
import { CandidateClassification } from '../../types.js';
import { YouTubeAdapter } from './youtube.js';

export interface O2TvScanTelemetry {
  sourceUrl: string;
  pagesInspected: number;
  inspectedUrls: string[];
  candidatesDiscovered: number;
  directMediaFound: number;
  failureReasons: string[];
  scanStatus: 'COMPLETED' | 'PARTIAL' | 'RESTRICTED' | 'FAILED';
  scanOutcome: string;
}

export class O2TvSeriesAdapter implements SourceAdapter {
  public id = 'adapter_o2tvseries4u';
  public name = 'O2TvSeries4u Episodic Index (o2tvseries4u.com)';
  public description = 'Persistent configured website discovery source inspecting o2tvseries4u.com catalog, alphabetical directories, season pagination, episode pages, and downloadable MP4/media links.';
  public sourceCategory = 'SUSPECTED_PIRACY' as const;

  public static readonly SOURCE_ID = 'src_o2tvseries4u';
  public static readonly DEFAULT_BASE_URL = 'https://o2tvseries4u.com/';

  private lastDiagnostic: AdapterDiagnostic | null = null;
  private lastTelemetry: O2TvScanTelemetry | null = null;

  public canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return (
      u.includes('o2tvseries4u.com') ||
      u.includes('o2tvseries') ||
      /\/download\/\d+/i.test(u) ||
      /\/season-\d+\/episode-\d+/i.test(u)
    );
  }

  public getLastDiagnostic(): AdapterDiagnostic | null {
    return this.lastDiagnostic;
  }

  public getLastTelemetry(): O2TvScanTelemetry | null {
    return this.lastTelemetry;
  }

  /**
   * Parses season and episode numbers from a query or reference string (e.g. "Modern Family S01E01", "Season 1 Episode 1").
   */
  public static parseSeasonEpisodeTarget(input: string): {
    cleanSeriesQuery: string;
    seasonNum?: number;
    episodeNum?: number;
  } {
    let text = input.trim();
    let seasonNum: number | undefined;
    let episodeNum: number | undefined;

    const seCompact = text.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);
    if (seCompact) {
      seasonNum = parseInt(seCompact[1], 10);
      episodeNum = parseInt(seCompact[2], 10);
    } else {
      const sVerbose = text.match(/\bSeason\s*(\d{1,2})\b/i);
      const eVerbose = text.match(/\bEpisode\s*(\d{1,3})\b/i);
      if (sVerbose) {
        seasonNum = parseInt(sVerbose[1], 10);
      }
      if (eVerbose) {
        episodeNum = parseInt(eVerbose[1], 10);
      }
    }

    // Strip all season/episode tokens and common noise words from series title query
    const cleanSeriesQuery = text
      .replace(/\bS\d{1,2}\s*E\d{1,3}\b/gi, ' ')
      .replace(/\bSeason\s*\d{1,2}\b/gi, ' ')
      .replace(/\bEpisode\s*\d{1,3}\b/gi, ' ')
      .replace(/\b(full\s+episode|pilot|official|hd|1080p|720p|mp4|download|free|watch|online|stream)\b/gi, ' ')
      .replace(/[-–—:|()[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      cleanSeriesQuery: cleanSeriesQuery || input.trim(),
      seasonNum,
      episodeNum
    };
  }

  /**
   * Filters out navigation, footer, social, and external ad links so non-video noise is never misclassified as a candidate.
   */
  public static isExcludedNoiseLink(href: string, baseDomain: string): boolean {
    const lower = href.toLowerCase();
    if (
      lower.startsWith('javascript:') ||
      lower.startsWith('mailto:') ||
      lower.startsWith('#') ||
      lower.includes('/pages/about') ||
      lower.includes('/pages/privacy') ||
      lower.includes('/pages/terms') ||
      lower.includes('/pages/contact') ||
      lower.includes('/pages/dmca') ||
      lower.includes('t.me/') ||
      lower.includes('telegram.') ||
      lower.includes('facebook.com') ||
      lower.includes('twitter.com') ||
      lower.includes('instagram.com') ||
      lower.includes('hdmp4mania') ||
      lower.includes('imdb.com') ||
      /\.(css|js|ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf)(\?|$)/i.test(lower)
    ) {
      return true;
    }

    try {
      const parsed = new URL(href);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      const expected = baseDomain.replace(/^www\./, '').toLowerCase();
      if (host !== expected && !host.endsWith(`.${expected}`)) {
        return true;
      }
    } catch {
      return true;
    }

    return false;
  }

  private async fetchPageHtml(
    url: string,
    inspectedUrls: string[],
    failureReasons: string[],
    timeoutMs: number = 5500
  ): Promise<{ ok: boolean; status: number; finalUrl: string; html: string }> {
    if (!inspectedUrls.includes(url)) {
      inspectedUrls.push(url);
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      const finalUrl = res.url || url;
      if (res.status === 401 || res.status === 403 || res.status === 451 || res.status === 503) {
        failureReasons.push(`HTTP ${res.status} restriction on ${url} (final: ${finalUrl})`);
        return { ok: false, status: res.status, finalUrl, html: '' };
      }
      if (res.status >= 400) {
        failureReasons.push(`HTTP ${res.status} on ${url}`);
        return { ok: false, status: res.status, finalUrl, html: '' };
      }
      const html = await res.text().catch(() => '');
      if (
        html.includes('cf-browser-verification') ||
        (html.includes('Attention Required!') && html.includes('Cloudflare'))
      ) {
        failureReasons.push(`Cloudflare anti-bot challenge encountered on ${finalUrl}`);
        return { ok: false, status: 403, finalUrl, html: '' };
      }
      return { ok: true, status: res.status, finalUrl, html };
    } catch (err: any) {
      failureReasons.push(`Fetch error on ${url}: ${err.message}`);
      return { ok: false, status: 0, finalUrl: url, html: '' };
    }
  }

  private extractAnchors(html: string, baseUrl: string, baseDomain: string): Array<{ href: string; text: string }> {
    const out: Array<{ href: string; text: string }> = [];
    const regex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      const rawHref = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!rawHref) continue;
      let resolved: string;
      try {
        resolved = new URL(rawHref, baseUrl).toString();
      } catch {
        continue;
      }
      if (O2TvSeriesAdapter.isExcludedNoiseLink(resolved, baseDomain)) continue;
      out.push({ href: resolved, text });
    }
    return out;
  }

  /**
   * Inspects an episode page for downloadable media links (/download/\d+, direct .mp4/.m3u8/.webm),
   * HTML5 <video>/<source> elements, and embedded players.
   * Keeps distinct video assets separate even when they originate from the same episode webpage.
   */
  private extractCandidatesFromEpisodePage(params: {
    episodeUrl: string;
    episodeHtml: string;
    referringSeasonUrl: string;
    seriesTitle: string;
    seasonLabel: string;
    episodeLabel: string;
    baseDomain: string;
    matchedKeywords: string[];
    matchedContentId?: string;
  }): { items: DiscoveredItem[]; directMediaCount: number } {
    const {
      episodeUrl,
      episodeHtml,
      referringSeasonUrl,
      seriesTitle,
      seasonLabel,
      episodeLabel,
      baseDomain,
      matchedKeywords,
      matchedContentId
    } = params;

    const titleMatch = episodeHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawPageTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
    const canonicalTitle =
      rawPageTitle ||
      [seriesTitle, seasonLabel, episodeLabel].filter(Boolean).join(' - ') ||
      episodeUrl;

    const anchors = this.extractAnchors(episodeHtml, episodeUrl, baseDomain);

    // 1. Collect distinct direct/downloadable media assets on this episode page
    const mediaAssets: Array<{
      mediaUrl: string;
      label: string;
      suggestedType: 'MP4' | 'HLS_M3U8' | 'WEBM';
      matchMethod: string;
    }> = [];
    const seenMediaUrls = new Set<string>();

    for (const a of anchors) {
      const lowerHref = a.href.toLowerCase();
      const lowerText = a.text.toLowerCase();
      const isDownloadRoute = /\/download\/\d+/i.test(lowerHref);
      const isDirectVideoExt = /\.(mp4|m3u8|webm)(\?|$)/i.test(lowerHref);

      if (isDownloadRoute || isDirectVideoExt) {
        const normMedia = a.href.toLowerCase();
        if (seenMediaUrls.has(normMedia)) continue;
        seenMediaUrls.add(normMedia);

        const suggestedType: 'MP4' | 'HLS_M3U8' | 'WEBM' = lowerHref.includes('.m3u8')
          ? 'HLS_M3U8'
          : lowerHref.includes('.webm')
          ? 'WEBM'
          : 'MP4';

        const formatTag = lowerText.includes('3gp')
          ? '3GP'
          : lowerText.includes('mp4')
          ? 'MP4'
          : lowerText.includes('hd') || lowerHref.includes('720p') || lowerHref.includes('1080p')
          ? 'HD MP4'
          : suggestedType;

        mediaAssets.push({
          mediaUrl: a.href,
          label: a.text || `${canonicalTitle} (${formatTag})`,
          suggestedType,
          matchMethod: 'title_match, episode_metadata, direct_media_link'
        });
      }
    }

    // Also inspect <video src="..."> and <source src="..."> tags on the episode page
    const videoSrcRegex = /<(?:video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let vm: RegExpExecArray | null;
    while ((vm = videoSrcRegex.exec(episodeHtml)) !== null) {
      try {
        const resolvedMedia = new URL(vm[1].trim(), episodeUrl).toString();
        const normMedia = resolvedMedia.toLowerCase();
        if (!seenMediaUrls.has(normMedia)) {
          seenMediaUrls.add(normMedia);
          mediaAssets.push({
            mediaUrl: resolvedMedia,
            label: `HTML5 Video Stream (${resolvedMedia.split('/').pop() || 'stream'})`,
            suggestedType: normMedia.includes('.m3u8') ? 'HLS_M3U8' : normMedia.includes('.webm') ? 'WEBM' : 'MP4',
            matchMethod: 'title_match, episode_metadata, direct_media_link, embedded_player_metadata'
          });
        }
      } catch {}
    }

    const items: DiscoveredItem[] = [];

    if (mediaAssets.length > 0) {
      // Emit a separate candidate per distinct video asset while keeping source_url as the episode page
      for (const asset of mediaAssets) {
        items.push({
          url: episodeUrl,
          mediaUrl: asset.mediaUrl,
          sourceType: 'configured_website',
          matchedContentId,
          matchMethod: asset.matchMethod,
          originalUrl: episodeUrl,
          finalUrl: episodeUrl,
          finalDomain: baseDomain,
          referringPage: referringSeasonUrl,
          matchedKeywords,
          crawlStatus: 'CRAWLED_OK',
          candidateClassification: 'VIDEO_ASSET',
          title: `${seriesTitle ? `${seriesTitle} ` : ''}${seasonLabel ? `${seasonLabel} ` : ''}${episodeLabel ? `${episodeLabel} — ` : ''}${asset.label}`.replace(/\s+/g, ' ').trim(),
          platform: baseDomain,
          sourceCategory: 'SUSPECTED_PIRACY',
          assetKind: 'VIDEO_ASSET',
          suggestedType: asset.suggestedType,
          domain: baseDomain,
          isLive: asset.suggestedType === 'HLS_M3U8',
          relevanceScore: 0.92,
          metadata: {
            configuredSource: O2TvSeriesAdapter.DEFAULT_BASE_URL,
            seriesTitle,
            seasonLabel,
            episodeLabel,
            episodePageUrl: episodeUrl,
            directMediaUrl: asset.mediaUrl,
            downloadLinkLabel: asset.label
          }
        });
      }
      return { items, directMediaCount: mediaAssets.length };
    }

    // Check if the episode page has an iframe or embedded player without a direct media link
    const iframeMatch = episodeHtml.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/i);
    if (iframeMatch) {
      items.push({
        url: episodeUrl,
        sourceType: 'configured_website',
        matchedContentId,
        matchMethod: 'title_match, episode_metadata, embedded_player_metadata',
        originalUrl: episodeUrl,
        finalUrl: episodeUrl,
        finalDomain: baseDomain,
        referringPage: referringSeasonUrl,
        matchedKeywords,
        crawlStatus: 'CRAWLED_OK',
        candidateClassification: 'VIDEO_ASSET',
        title: canonicalTitle,
        platform: baseDomain,
        sourceCategory: 'EMBEDDED_PLAYER',
        assetKind: 'VIDEO_ASSET',
        suggestedType: 'HTML_PLAYER',
        domain: baseDomain,
        isLive: false,
        relevanceScore: 0.8,
        metadata: {
          configuredSource: O2TvSeriesAdapter.DEFAULT_BASE_URL,
          seriesTitle,
          seasonLabel,
          episodeLabel,
          embeddedIframeSrc: iframeMatch[1]
        }
      });
      return { items, directMediaCount: 0 };
    }

    // Otherwise record the episode page as a discovered webpage candidate
    items.push({
      url: episodeUrl,
      sourceType: 'configured_website',
      matchedContentId,
      matchMethod: 'title_match, episode_metadata',
      originalUrl: episodeUrl,
      finalUrl: episodeUrl,
      finalDomain: baseDomain,
      referringPage: referringSeasonUrl,
      matchedKeywords,
      crawlStatus: 'CRAWLED_OK',
      candidateClassification: 'GENERAL_WEBPAGE',
      title: canonicalTitle,
      platform: baseDomain,
      sourceCategory: 'SUSPECTED_PIRACY',
      assetKind: 'DISCOVERED_PAGE',
      suggestedType: 'HTML_PLAYER',
      domain: baseDomain,
      isLive: false,
      relevanceScore: 0.65,
      metadata: {
        configuredSource: O2TvSeriesAdapter.DEFAULT_BASE_URL,
        seriesTitle,
        seasonLabel,
        episodeLabel
      }
    });
    return { items, directMediaCount: 0 };
  }

  /**
   * Executes a multi-page discovery crawl on https://o2tvseries4u.com/ (or a custom base URL override).
   */
  public async discover(
    query: string,
    options: {
      maxResults?: number;
      referenceTitle?: string;
      targetReferenceId?: string;
      keywordCombinations?: string[];
      baseUrlOverride?: string;
    } = {}
  ): Promise<DiscoveredItem[]> {
    const limit = options.maxResults || 12;
    const baseUrl = (options.baseUrlOverride || process.env.O2TV_BASE_URL || O2TvSeriesAdapter.DEFAULT_BASE_URL).replace(/\/+$/, '') + '/';
    let baseDomain = 'o2tvseries4u.com';
    try {
      baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {}

    const rawSearchInput = options.referenceTitle || query || '';
    const { cleanSeriesQuery, seasonNum, episodeNum } = O2TvSeriesAdapter.parseSeasonEpisodeTarget(
      `${rawSearchInput} ${query}`
    );

    const inspectedUrls: string[] = [];
    const failureReasons: string[] = [];
    const discoveredItems: DiscoveredItem[] = [];
    let directMediaFound = 0;

    // Step 1: Inspect Homepage
    const homeResp = await this.fetchPageHtml(baseUrl, inspectedUrls, failureReasons);
    const candidateSeriesPages = new Map<string, { url: string; title: string; referringUrl: string; score: number }>();

    const evaluateSeriesAnchors = (anchors: Array<{ href: string; text: string }>, referringUrl: string) => {
      for (const a of anchors) {
        if (!a.text || a.text.length < 2) continue;
        // Skip direct season/episode/pagination links at the series-matching stage unless they are series root pages
        const rel = YouTubeAdapter.computeRelevanceScore(a.text, cleanSeriesQuery, options.referenceTitle || cleanSeriesQuery);
        const slugText = a.href.split('/').slice(-2).join(' ').replace(/[-_]/g, ' ');
        const slugRel = YouTubeAdapter.computeRelevanceScore(slugText, cleanSeriesQuery, options.referenceTitle || cleanSeriesQuery);
        const bestRel = Math.max(rel, slugRel);

        if (bestRel >= 0.35) {
          // If link is already an Episode page directly on homepage, we can also queue it
          const norm = a.href.toLowerCase();
          if (!candidateSeriesPages.has(norm)) {
            candidateSeriesPages.set(norm, {
              url: a.href,
              title: a.text,
              referringUrl,
              score: bestRel
            });
          }
        }
      }
    };

    if (homeResp.ok && homeResp.html) {
      const homeAnchors = this.extractAnchors(homeResp.html, homeResp.finalUrl, baseDomain);
      evaluateSeriesAnchors(homeAnchors, homeResp.finalUrl);
    }

    // Step 2: Inspect Alphabetical Category Page (e.g. /m for Modern Family) and Catalog (/search/list_all_tv_series)
    const firstChar = cleanSeriesQuery.charAt(0).toLowerCase();
    if (/[a-z]/.test(firstChar) && candidateSeriesPages.size === 0) {
      const alphaUrl = new URL(firstChar, baseUrl).toString();
      const alphaResp = await this.fetchPageHtml(alphaUrl, inspectedUrls, failureReasons);
      if (alphaResp.ok && alphaResp.html) {
        const alphaAnchors = this.extractAnchors(alphaResp.html, alphaResp.finalUrl, baseDomain);
        evaluateSeriesAnchors(alphaAnchors, alphaResp.finalUrl);
      }
    }

    if (candidateSeriesPages.size === 0) {
      const catalogUrl = new URL('search/list_all_tv_series', baseUrl).toString();
      const catalogResp = await this.fetchPageHtml(catalogUrl, inspectedUrls, failureReasons, 6500);
      if (catalogResp.ok && catalogResp.html) {
        const catalogAnchors = this.extractAnchors(catalogResp.html, catalogResp.finalUrl, baseDomain);
        evaluateSeriesAnchors(catalogAnchors, catalogResp.finalUrl);
      }
    }

    // Sort matched series pages by relevance score descending
    const matchedSeriesList = Array.from(candidateSeriesPages.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    // Step 3: Traverse Series Page -> Season Page (& Pagination) -> Episode Page
    for (const seriesEntry of matchedSeriesList) {
      if (discoveredItems.length >= limit) break;

      const seriesResp = await this.fetchPageHtml(seriesEntry.url, inspectedUrls, failureReasons);
      if (!seriesResp.ok || !seriesResp.html) continue;

      const seriesAnchors = this.extractAnchors(seriesResp.html, seriesResp.finalUrl, baseDomain);

      // Check if this page itself is already an Episode page with /download/ links
      if (/\/Episode-\d+/i.test(seriesResp.finalUrl) || seriesAnchors.some(a => /\/download\/\d+/i.test(a.href))) {
        const extracted = this.extractCandidatesFromEpisodePage({
          episodeUrl: seriesResp.finalUrl,
          episodeHtml: seriesResp.html,
          referringSeasonUrl: seriesEntry.referringUrl,
          seriesTitle: seriesEntry.title,
          seasonLabel: seasonNum ? `Season ${String(seasonNum).padStart(2, '0')}` : '',
          episodeLabel: episodeNum ? `Episode ${String(episodeNum).padStart(2, '0')}` : '',
          baseDomain,
          matchedKeywords: [cleanSeriesQuery, query].filter(Boolean),
          matchedContentId: options.targetReferenceId
        });
        discoveredItems.push(...extracted.items);
        directMediaFound += extracted.directMediaCount;
        continue;
      }

      // Identify Season links on the Series page (e.g. Season-01/index.html)
      let seasonAnchors = seriesAnchors.filter(a => /\/Season-\d+/i.test(a.href) && !/sort=/i.test(a.href));

      // If season Links are on a subsequent pagination page of the series (e.g. when Series has >10 seasons and Season-01 is on page1.html?sort=old)
      const targetSeasonToken = seasonNum ? `season-${String(seasonNum).padStart(2, '0')}` : undefined;
      const targetSeasonAltToken = seasonNum ? `season-${seasonNum}/` : undefined;

      const matchesTargetSeason = (href: string) => {
        const l = href.toLowerCase();
        if (!targetSeasonToken) return true;
        return l.includes(targetSeasonToken) || (targetSeasonAltToken ? l.includes(targetSeasonAltToken) : false);
      };

      if (targetSeasonToken && !seasonAnchors.some(a => matchesTargetSeason(a.href))) {
        const sortOldLink = seriesAnchors.find(a => /sort=old/i.test(a.href));
        if (sortOldLink) {
          const sortResp = await this.fetchPageHtml(sortOldLink.href, inspectedUrls, failureReasons);
          if (sortResp.ok && sortResp.html) {
            const moreAnchors = this.extractAnchors(sortResp.html, sortResp.finalUrl, baseDomain);
            seasonAnchors.push(...moreAnchors.filter(a => /\/Season-\d+/i.test(a.href)));
          }
        }
      }

      // Prioritize target season if specified; otherwise take up to 2 seasons
      const prioritizedSeasons = targetSeasonToken
        ? seasonAnchors.filter(a => matchesTargetSeason(a.href))
        : seasonAnchors.slice(0, 2);

      const seasonsToInspect = (prioritizedSeasons.length > 0 ? prioritizedSeasons : seasonAnchors).slice(0, 2);

      for (const seasonLink of seasonsToInspect) {
        if (discoveredItems.length >= limit) break;

        const seasonResp = await this.fetchPageHtml(seasonLink.href, inspectedUrls, failureReasons);
        if (!seasonResp.ok || !seasonResp.html) continue;

        const seasonAnchorsList = this.extractAnchors(seasonResp.html, seasonResp.finalUrl, baseDomain);
        let episodeLinks = seasonAnchorsList.filter(a => /\/Episode-\d+/i.test(a.href));

        const targetEpisodeToken = episodeNum ? `episode-${String(episodeNum).padStart(2, '0')}` : undefined;
        const targetEpisodeAltToken = episodeNum ? `episode-${episodeNum}/` : undefined;

        const matchesTargetEpisode = (href: string) => {
          const l = href.toLowerCase();
          if (!targetEpisodeToken) return true;
          return l.includes(targetEpisodeToken) || (targetEpisodeAltToken ? l.includes(targetEpisodeAltToken) : false);
        };

        // Step 3b: Handle Season Pagination / Sort Order if target episode (e.g. Episode-01) is on page1.html?sort=old or page2.html/page3.html
        if (targetEpisodeToken && !episodeLinks.some(a => matchesTargetEpisode(a.href))) {
          const paginationCandidates = seasonAnchorsList.filter(
            a => /sort=old/i.test(a.href) || /\/page\d+\.html/i.test(a.href)
          );
          // Prioritize ?sort=old since Episode 01 is always first in oldest-first order
          paginationCandidates.sort((a, b) => (/sort=old/i.test(b.href) ? 1 : 0) - (/sort=old/i.test(a.href) ? 1 : 0));

          for (const pageLink of paginationCandidates.slice(0, 2)) {
            const pageResp = await this.fetchPageHtml(pageLink.href, inspectedUrls, failureReasons);
            if (pageResp.ok && pageResp.html) {
              const pageAnchors = this.extractAnchors(pageResp.html, pageResp.finalUrl, baseDomain);
              const foundEps = pageAnchors.filter(a => /\/Episode-\d+/i.test(a.href));
              episodeLinks.push(...foundEps);
              if (episodeLinks.some(a => matchesTargetEpisode(a.href))) {
                break;
              }
            }
          }
        }

        // Deduplicate episode links
        const uniqueEpisodeMap = new Map<string, { href: string; text: string }>();
        for (const ep of episodeLinks) {
          const k = ep.href.toLowerCase();
          if (!uniqueEpisodeMap.has(k)) uniqueEpisodeMap.set(k, ep);
        }
        const allUniqueEpisodes = Array.from(uniqueEpisodeMap.values());

        const prioritizedEpisodes = targetEpisodeToken
          ? allUniqueEpisodes.filter(e => matchesTargetEpisode(e.href))
          : allUniqueEpisodes.slice(0, 3);

        const episodesToInspect = (prioritizedEpisodes.length > 0 ? prioritizedEpisodes : allUniqueEpisodes).slice(0, 3);

        for (const epLink of episodesToInspect) {
          if (discoveredItems.length >= limit) break;

          const epResp = await this.fetchPageHtml(epLink.href, inspectedUrls, failureReasons);
          if (!epResp.ok || !epResp.html) continue;

          const extracted = this.extractCandidatesFromEpisodePage({
            episodeUrl: epResp.finalUrl,
            episodeHtml: epResp.html,
            referringSeasonUrl: seasonResp.finalUrl,
            seriesTitle: seriesEntry.title,
            seasonLabel: seasonLink.text || (seasonNum ? `Season ${String(seasonNum).padStart(2, '0')}` : ''),
            episodeLabel: epLink.text || (episodeNum ? `Episode ${String(episodeNum).padStart(2, '0')}` : ''),
            baseDomain,
            matchedKeywords: [
              cleanSeriesQuery,
              seasonNum ? `S${String(seasonNum).padStart(2, '0')}` : '',
              episodeNum ? `E${String(episodeNum).padStart(2, '0')}` : ''
            ].filter(Boolean),
            matchedContentId: options.targetReferenceId
          });

          discoveredItems.push(...extracted.items);
          directMediaFound += extracted.directMediaCount;
        }
      }
    }

    const scanStatus: O2TvScanTelemetry['scanStatus'] =
      inspectedUrls.length === 0 || (!homeResp.ok && discoveredItems.length === 0)
        ? 'FAILED'
        : failureReasons.length > 0 && discoveredItems.length === 0
        ? 'RESTRICTED'
        : 'COMPLETED';

    const scanOutcome =
      discoveredItems.length > 0
        ? `Inspected ${inspectedUrls.length} page(s) on ${baseDomain}; discovered ${discoveredItems.length} candidate(s) (${directMediaFound} direct/downloadable media reference(s)).`
        : `Inspected ${inspectedUrls.length} page(s) on ${baseDomain}; 0 matching series/episode candidates found for "${cleanSeriesQuery}".`;

    this.lastTelemetry = {
      sourceUrl: baseUrl,
      pagesInspected: inspectedUrls.length,
      inspectedUrls,
      candidatesDiscovered: discoveredItems.length,
      directMediaFound,
      failureReasons,
      scanStatus,
      scanOutcome
    };

    this.lastDiagnostic = {
      adapterId: this.id,
      adapterName: this.name,
      sourceCategory: this.sourceCategory,
      status: discoveredItems.length > 0 ? 'LIVE_OK' : scanStatus === 'FAILED' ? 'NETWORK_ERROR' : 'NO_RESULTS',
      candidatesFound: discoveredItems.length,
      message: scanOutcome
    };

    return discoveredItems.slice(0, limit);
  }

  /**
   * Probes a candidate page or downloadable media link on o2tvseries4u.com (or test fixture server).
   * Validates redirects, Content-Type, and MP4/media headers.
   * Respects anti-bot CAPTCHA walls (e.g. /areyouhuman.php HTTP 403 Cloudflare) without bypassing them.
   */
  public async acquireAndProbe(targetUrl: string, options: { timeoutMs?: number } = {}): Promise<MediaAcquisitionResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toISOString()}] [O2TvSeriesAdapter] ${msg}`);

    log(`Probing o2tvseries4u candidate URL: ${targetUrl}`);
    let domain = 'o2tvseries4u.com';
    try {
      domain = new URL(targetUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {}

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 6000);
      const res = await fetch(targetUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'video/mp4,video/*;q=0.9,application/vnd.apple.mpegurl;q=0.8,text/html;q=0.7,*/*;q=0.5',
          'Range': 'bytes=0-4095'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      const httpStatus = res.status;
      const latencyMs = Date.now() - startTime;
      const finalUrl = res.url || targetUrl;
      let finalDomain = domain;
      try {
        finalDomain = new URL(finalUrl).hostname.replace(/^www\./, '').toLowerCase();
      } catch {}

      const redirected = Boolean(
        res.redirected || finalUrl.replace(/\/$/, '').toLowerCase() !== targetUrl.replace(/\/$/, '').toLowerCase()
      );
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });

      log(
        `HTTP ${httpStatus} in ${latencyMs}ms${redirected ? ` (Redirected: ${targetUrl} -> ${finalUrl})` : ''}`
      );

      const isHumanVerificationGate = /areyouhuman\.php|captcha|cf-chl|turnstile/i.test(finalUrl);

      if (httpStatus === 401 || httpStatus === 403 || httpStatus === 451 || httpStatus === 503 || isHumanVerificationGate) {
        const gateReason = isHumanVerificationGate
          ? `Download link (${targetUrl}) redirected to human-verification CAPTCHA gate (${finalUrl}, HTTP ${httpStatus}). Anti-bot protection respected without bypass.`
          : `Target host returned HTTP ${httpStatus} access restriction on ${finalUrl}. Restriction respected without bypass.`;
        log(gateReason);
        return {
          accessible: false,
          pipelineStatus: 'BLOCKED',
          httpStatus: httpStatus >= 400 ? httpStatus : 403,
          latencyMs,
          mediaType: /\/download\/\d+|\.mp4/i.test(targetUrl) ? 'MP4' : 'HTML_PLAYER',
          finalUrl,
          finalDomain,
          redirected,
          crawlStatus: 'ACCESS_RESTRICTED',
          candidateClassification: /\/download\/\d+|\.mp4/i.test(targetUrl) ? 'VIDEO_ASSET' : 'GENERAL_WEBPAGE',
          platform: finalDomain,
          headers,
          technicalLogs: logs,
          extractionNotice: gateReason
        };
      }

      if (httpStatus >= 400) {
        log(`Target returned HTTP ${httpStatus}.`);
        return {
          accessible: false,
          pipelineStatus: 'UNREACHABLE',
          httpStatus,
          latencyMs,
          mediaType: 'UNKNOWN',
          finalUrl,
          finalDomain,
          redirected,
          crawlStatus: 'UNREACHABLE',
          candidateClassification: 'GENERAL_WEBPAGE',
          platform: finalDomain,
          headers,
          technicalLogs: logs,
          extractionNotice: `Target returned HTTP ${httpStatus}.`
        };
      }

      const contentType = (headers['content-type'] || '').toLowerCase();

      // Check if response is binary video or MP4
      const arrayBuf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
      const buf = Buffer.from(arrayBuf);
      const hasMp4Ftyp =
        buf.length >= 12 &&
        buf[4] === 0x66 && // 'f'
        buf[5] === 0x74 && // 't'
        buf[6] === 0x79 && // 'y'
        buf[7] === 0x70;   // 'p'
      const hasWebmEbml =
        buf.length >= 4 &&
        buf[0] === 0x1a &&
        buf[1] === 0x45 &&
        buf[2] === 0xdf &&
        buf[3] === 0xa3;

      if (
        hasMp4Ftyp ||
        hasWebmEbml ||
        contentType.includes('video/mp4') ||
        contentType.includes('video/webm') ||
        contentType.includes('video/3gpp')
      ) {
        const mediaType = hasWebmEbml || contentType.includes('webm') ? 'WEBM' : 'MP4';
        log(`Validated real ${mediaType} video stream (${contentType || 'binary magic bytes'}, ${buf.length} probe bytes).`);
        return {
          accessible: true,
          pipelineStatus: 'ACQUIRED',
          httpStatus,
          latencyMs,
          mediaType,
          resolvedMediaUrl: finalUrl,
          finalUrl,
          finalDomain,
          redirected,
          crawlStatus: redirected ? 'REDIRECTED_ACCESSIBLE' : 'CRAWLED_OK',
          candidateClassification: 'VERIFIED_VIDEO_ASSET',
          platform: finalDomain,
          headers,
          technicalLogs: logs,
          extractionNotice: `Direct ${mediaType} video stream validated (${finalUrl}); ready for FFmpeg frame extraction and perceptual hashing.`
        };
      }

      if (contentType.includes('mpegurl') || finalUrl.toLowerCase().includes('.m3u8')) {
        const text = buf.toString('utf8');
        if (text.includes('#EXTM3U')) {
          log(`Validated HLS manifest (.m3u8) at ${finalUrl}.`);
          return {
            accessible: true,
            pipelineStatus: 'ACQUIRED',
            httpStatus,
            latencyMs,
            mediaType: 'HLS_M3U8',
            resolvedMediaUrl: finalUrl,
            finalUrl,
            finalDomain,
            redirected,
            crawlStatus: redirected ? 'REDIRECTED_ACCESSIBLE' : 'CRAWLED_OK',
            candidateClassification: 'VERIFIED_VIDEO_ASSET',
            platform: finalDomain,
            headers,
            technicalLogs: logs,
            extractionNotice: `Direct HLS manifest validated (${finalUrl}).`
          };
        }
      }

      // Otherwise inspect HTML response
      const html = buf.toString('utf8');
      if (html.includes('areyouhuman.php') || (html.includes('Attention Required!') && html.includes('Cloudflare'))) {
        const msg = `Anti-bot challenge detected in HTML response from ${finalUrl}. Access restriction respected.`;
        log(msg);
        return {
          accessible: false,
          pipelineStatus: 'BLOCKED',
          httpStatus: 403,
          latencyMs,
          mediaType: 'HTML_PLAYER',
          finalUrl,
          finalDomain,
          redirected,
          crawlStatus: 'ACCESS_RESTRICTED',
          candidateClassification: 'VIDEO_ASSET',
          platform: finalDomain,
          headers,
          technicalLogs: logs,
          extractionNotice: msg
        };
      }

      // Check if the HTML page contains a direct .mp4 / .m3u8 stream URL
      const directMp4Match = html.match(/https?:\/\/[^"'\\\s<>]+?\.(?:mp4|m3u8|webm)(?:\?[^"'\\\s<>]*)?/i);
      if (directMp4Match) {
        const streamUrl = directMp4Match[0];
        log(`Found embedded direct video URL on episode page: ${streamUrl}`);
        return {
          accessible: true,
          pipelineStatus: 'ACQUIRED',
          httpStatus,
          latencyMs,
          mediaType: streamUrl.toLowerCase().includes('.m3u8') ? 'HLS_M3U8' : 'MP4',
          resolvedMediaUrl: streamUrl,
          finalUrl,
          finalDomain,
          redirected,
          crawlStatus: redirected ? 'REDIRECTED_ACCESSIBLE' : 'CRAWLED_OK',
          candidateClassification: 'VERIFIED_VIDEO_ASSET',
          platform: finalDomain,
          headers,
          technicalLogs: logs,
          extractionNotice: `Extracted direct media URL (${streamUrl}) from episode page.`
        };
      }

      // Check if HTML page has /download/\d+ links
      const downloadLinkMatch = html.match(/https?:\/\/[^"'\\\s<>]*\/download\/\d+/i);
      if (downloadLinkMatch) {
        log(`Episode page contains download gateway link (${downloadLinkMatch[0]}), probing gateway...`);
        return this.acquireAndProbe(downloadLinkMatch[0], options);
      }

      return {
        accessible: true,
        pipelineStatus: 'MEDIA_DETECTED',
        httpStatus,
        latencyMs,
        mediaType: 'HTML_PLAYER',
        finalUrl,
        finalDomain,
        redirected,
        crawlStatus: redirected ? 'REDIRECTED_ACCESSIBLE' : 'CRAWLED_OK',
        candidateClassification: 'GENERAL_WEBPAGE',
        platform: finalDomain,
        headers,
        technicalLogs: logs,
        extractionNotice: 'Episode webpage reachable; no directly downloadable video stream exposed without interactive session.'
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      log(`Probe error on ${targetUrl}: ${err.message}`);
      return {
        accessible: false,
        pipelineStatus: 'UNREACHABLE',
        httpStatus: 0,
        latencyMs,
        mediaType: 'UNKNOWN',
        finalUrl: targetUrl,
        finalDomain: domain,
        redirected: false,
        crawlStatus: 'UNREACHABLE',
        candidateClassification: 'GENERAL_WEBPAGE',
        platform: domain,
        headers: {},
        technicalLogs: logs,
        extractionNotice: `Network error probing ${targetUrl}: ${err.message}`
      };
    }
  }
}
