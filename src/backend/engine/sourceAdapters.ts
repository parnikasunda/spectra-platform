/**
 * SPECTRA Configurable Multi-Platform Source Adapter & Acquisition Workflow Engine
 *
 * Supports:
 * 1. YouTube (watch pages, shorts, embeds, progressive/authorized feeds)
 * 2. Dailymotion (video pages, embeds, player stream metadata)
 * 3. Vimeo (video pages, player.vimeo.com embeds, progressive MP4 / HLS streams)
 * 4. Public Video Platforms (Internet Archive, Wikimedia Commons, Wistia, JW Player, Video.js, HTML5 <video>/<source>/og:video/JSON-LD)
 * 5. Direct Media Assets (.mp4, .mkv, .mov, .webm, .m4v, .ts) with HTTP Range resumable downloads
 * 6. HLS Streams (.m3u8) with DRM key inspection and FFmpeg remuxing
 * 7. MPEG-DASH Streams (.mpd) with CENC/Widevine DRM detection vs. unencrypted BaseURL acquisition
 * 8. Authorized OTT & Broadcaster Feeds (SonyLIV, Disney+ Hotstar, Netflix, JioCinema, Prime Video, ZEE5, Apple TV+, Max, Peacock)
 */

import {
  SourceAdapterCategory,
  SourceAdapterDescriptor,
  ResolvedVideoIdentity,
  AcquisitionWorkflowStage,
  AcquisitionWorkflowStageName,
  AcquisitionWorkflowReport,
  AttemptedAcquisitionMethod,
  ReferenceUrlInspectionResult
} from '../types.js';

const adapterEnabledState = new Map<string, boolean>();
const adapterResumableState = new Map<string, boolean>();

export function parseIso8601DurationSec(raw?: string | number | null): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  const str = String(raw).trim();
  if (!str) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(str)) {
    const val = parseFloat(str);
    return val > 0 ? val : undefined;
  }
  const isoMatch = str.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (isoMatch) {
    const days = parseInt(isoMatch[1] || '0', 10);
    const hours = parseInt(isoMatch[2] || '0', 10);
    const mins = parseInt(isoMatch[3] || '0', 10);
    const secs = parseFloat(isoMatch[4] || '0');
    const total = days * 86400 + hours * 3600 + mins * 60 + secs;
    return total > 0 ? total : undefined;
  }
  const colonMatch = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    const hours = parseInt(colonMatch[1] || '0', 10);
    const mins = parseInt(colonMatch[2] || '0', 10);
    const secs = parseInt(colonMatch[3] || '0', 10);
    const total = hours * 3600 + mins * 60 + secs;
    return total > 0 ? total : undefined;
  }
  return undefined;
}

export function getSourceAdapters(): SourceAdapterDescriptor[] {
  const baseAdapters: SourceAdapterDescriptor[] = [
    {
      id: 'YOUTUBE_ADAPTER',
      name: 'YouTube Source Adapter',
      category: 'YOUTUBE',
      platforms: ['YouTube', 'YouTube Shorts', 'YouTube Live', 'youtu.be'],
      enabled: adapterEnabledState.get('YOUTUBE_ADAPTER') ?? true,
      acquisitionCapability: 'CONDITIONAL_AUTHORIZED',
      supportedMethods: [
        'YOUTUBE_OEMBED_METADATA_RESOLUTION',
        'YOUTUBE_PROGRESSIVE_STREAM_ACQUISITION',
        'YOUTUBE_AUTHORIZED_PARTNER_FEED'
      ],
      supportedProtocols: ['HTTPS Watch/Shorts/Embed', 'Progressive MP4', 'Partner Mezzanine'],
      supportsResumableDownload: adapterResumableState.get('YOUTUBE_ADAPTER') ?? true,
      requiresCredentials: false,
      envVar: 'YOUTUBE_PARTNER_FEED_TOKEN',
      credentialsConfigured: Boolean(process.env.YOUTUBE_PARTNER_FEED_TOKEN),
      description:
        'Identifies YouTube watch/short/embed URLs, resolves video ID, title, author, and duration via oEmbed and player response metadata, and automatically acquires unencrypted progressive streams or authorized partner feeds when exposed.',
      fallbackGuidance:
        'When a YouTube watch page serves only ciphered or Widevine DRM adaptive streams without an unencrypted progressive URL, SPECTRA preserves the reference metadata and URL for Discovery Sweeps; upload an authorized master file (.mp4/.mkv/.mov) or supply an approved partner mezzanine URL to extract frames.'
    },
    {
      id: 'DAILYMOTION_ADAPTER',
      name: 'Dailymotion Source Adapter',
      category: 'DAILYMOTION',
      platforms: ['Dailymotion', 'dai.ly'],
      enabled: adapterEnabledState.get('DAILYMOTION_ADAPTER') ?? true,
      acquisitionCapability: 'CONDITIONAL_AUTHORIZED',
      supportedMethods: [
        'DAILYMOTION_OEMBED_METADATA',
        'DAILYMOTION_PLAYER_QUALITIES_STREAM',
        'DAILYMOTION_HLS_MP4_ACQUISITION'
      ],
      supportedProtocols: ['HTTPS Video/Embed', 'MP4 Stream', 'HLS (.m3u8)'],
      supportsResumableDownload: adapterResumableState.get('DAILYMOTION_ADAPTER') ?? true,
      requiresCredentials: false,
      envVar: 'DAILYMOTION_PARTNER_API_KEY',
      credentialsConfigured: Boolean(process.env.DAILYMOTION_PARTNER_API_KEY),
      description:
        'Inspects Dailymotion video and embed URLs, resolves video identity and duration, and automatically acquires unencrypted MP4 or HLS streams exposed in accessible player metadata.',
      fallbackGuidance:
        'If a Dailymotion video restricts direct stream URLs or is geo/access-restricted, SPECTRA preserves the reference metadata and URL; attach an authorized master video file or partner feed for full-video fingerprinting.'
    },
    {
      id: 'VIMEO_ADAPTER',
      name: 'Vimeo Source Adapter',
      category: 'VIMEO',
      platforms: ['Vimeo', 'Vimeo Player'],
      enabled: adapterEnabledState.get('VIMEO_ADAPTER') ?? true,
      acquisitionCapability: 'CONDITIONAL_AUTHORIZED',
      supportedMethods: [
        'VIMEO_OEMBED_METADATA',
        'VIMEO_PROGRESSIVE_MP4_DOWNLOAD',
        'VIMEO_UNENCRYPTED_HLS_STREAM'
      ],
      supportedProtocols: ['HTTPS Vimeo/Player', 'Progressive MP4', 'HLS (.m3u8)'],
      supportsResumableDownload: adapterResumableState.get('VIMEO_ADAPTER') ?? true,
      requiresCredentials: false,
      envVar: 'VIMEO_ACCESS_TOKEN',
      credentialsConfigured: Boolean(process.env.VIMEO_ACCESS_TOKEN),
      description:
        'Resolves Vimeo video pages and player.vimeo.com embeds, extracts title, duration, and creator metadata, and automatically downloads progressive MP4 files or unencrypted HLS streams when enabled by the video owner.',
      fallbackGuidance:
        'When a Vimeo video disables progressive downloads or requires private domain/password authentication, SPECTRA preserves the video identity and URL; provide an authorized Vimeo download link or upload the master video file.'
    },
    {
      id: 'PUBLIC_VIDEO_PLATFORM_ADAPTER',
      name: 'Public Video Platform & Web Player Adapter',
      category: 'PUBLIC_VIDEO_PLATFORM',
      platforms: [
        'Internet Archive (archive.org)',
        'Wikimedia Commons',
        'Wistia',
        'JW Player',
        'Video.js / Plyr / HLS.js',
        'HTML5 <video> / OpenGraph / JSON-LD Webpages'
      ],
      enabled: adapterEnabledState.get('PUBLIC_VIDEO_PLATFORM_ADAPTER') ?? true,
      acquisitionCapability: 'AUTOMATIC_WHEN_PERMITTED',
      supportedMethods: [
        'ARCHIVE_ORG_DIRECT_DOWNLOAD',
        'HTML5_VIDEO_AND_SOURCE_EXTRACTION',
        'OPENGRAPH_AND_JSONLD_CONTENT_URL',
        'INLINE_JS_PLAYER_CONFIG_RESOLUTION',
        'EMBEDDED_IFRAME_STREAM_INSPECTION'
      ],
      supportedProtocols: ['HTML5 <video>/<source>', 'og:video', 'JSON-LD VideoObject', 'Archive MP4/MKV'],
      supportsResumableDownload: adapterResumableState.get('PUBLIC_VIDEO_PLATFORM_ADAPTER') ?? true,
      requiresCredentials: false,
      credentialsConfigured: true,
      description:
        'Inspects public video platforms, open archives, and broadcaster press/screener pages to resolve HTML5 <video>, <source>, og:video, JSON-LD VideoObject.contentUrl, inline JS player streams, and platform download links for automatic acquisition.',
      fallbackGuidance:
        'If the webpage embeds a client-side player without exposing an unencrypted video URL, upload an authorized master file or provide a direct mezzanine stream URL.'
    },
    {
      id: 'DIRECT_MEDIA_ADAPTER',
      name: 'Direct Media File Adapter (.mp4 / .mkv / .mov / .webm)',
      category: 'DIRECT_MP4',
      platforms: ['Direct MP4/MKV/MOV/WebM URL', 'S3 / GCS Pre-Signed URL', 'CDN Mezzanine Asset'],
      enabled: adapterEnabledState.get('DIRECT_MEDIA_ADAPTER') ?? true,
      acquisitionCapability: 'AUTOMATIC_WHEN_PERMITTED',
      supportedMethods: [
        'HTTP_RANGE_RESUMABLE_DOWNLOAD',
        'SHA256_DEDUPLICATION_CACHE',
        'FFPROBE_STREAM_VALIDATION'
      ],
      supportedProtocols: ['MP4', 'MKV', 'MOV', 'WebM', 'M4V', 'MPEG-TS'],
      supportsResumableDownload: adapterResumableState.get('DIRECT_MEDIA_ADAPTER') ?? true,
      requiresCredentials: false,
      credentialsConfigured: true,
      description:
        'Automatically downloads direct video containers (.mp4, .mkv, .mov, .webm, .m4v, .ts) with HTTP Range resumption, SHA-256 duplicate detection, and FFprobe validation.',
      fallbackGuidance:
        'If the remote server returns HTTP 401/403 or an expired pre-signed URL, generate a fresh pre-signed URL or upload the local master file.'
    },
    {
      id: 'HLS_STREAM_ADAPTER',
      name: 'HLS Transport Stream Adapter (.m3u8)',
      category: 'HLS_STREAM',
      platforms: ['Apple HLS (.m3u8)', 'Broadcast Live/VOD HLS'],
      enabled: adapterEnabledState.get('HLS_STREAM_ADAPTER') ?? true,
      acquisitionCapability: 'AUTOMATIC_WHEN_PERMITTED',
      supportedMethods: [
        'HLS_MANIFEST_DRM_INSPECTION',
        'FFMPEG_HLS_REMUX_ACQUISITION',
        'FFPROBE_STREAM_VALIDATION'
      ],
      supportedProtocols: ['HLS Master/Media (.m3u8)', 'MPEG-TS Segments'],
      supportsResumableDownload: adapterResumableState.get('HLS_STREAM_ADAPTER') ?? false,
      requiresCredentials: false,
      credentialsConfigured: true,
      description:
        'Inspects HLS (.m3u8) master and media playlists, verifies absence of SAMPLE-AES/FairPlay/Widevine encryption, and automatically acquires and validates the video stream via FFmpeg/FFprobe.',
      fallbackGuidance:
        'If the HLS playlist uses SAMPLE-AES or FairPlay DRM encryption (#EXT-X-KEY), supply an unencrypted clean-feed HLS URL or upload an authorized master file.'
    },
    {
      id: 'DASH_STREAM_ADAPTER',
      name: 'MPEG-DASH Manifest Adapter (.mpd)',
      category: 'DASH_STREAM',
      platforms: ['MPEG-DASH (.mpd)'],
      enabled: adapterEnabledState.get('DASH_STREAM_ADAPTER') ?? true,
      acquisitionCapability: 'CONDITIONAL_AUTHORIZED',
      supportedMethods: [
        'MPD_XML_CONTENT_PROTECTION_INSPECTION',
        'UNENCRYPTED_DASH_BASEURL_ACQUISITION'
      ],
      supportedProtocols: ['MPEG-DASH XML (.mpd)', 'Unencrypted BaseURL MP4'],
      supportsResumableDownload: adapterResumableState.get('DASH_STREAM_ADAPTER') ?? true,
      requiresCredentials: false,
      credentialsConfigured: true,
      description:
        'Inspects MPEG-DASH (.mpd) XML manifests: automatically acquires unencrypted DASH representations when exposed, and blocks encrypted CENC/Widevine/PlayReady streams without bypassing DRM.',
      fallbackGuidance:
        'When a DASH (.mpd) manifest contains <ContentProtection> (Widevine/PlayReady/CENC DRM), upload an unencrypted reference master file (.mp4/.mkv/.mov).'
    },
    {
      id: 'AUTHORIZED_OTT_ADAPTER',
      name: 'Authorized OTT & Broadcaster Partner Feed Adapter',
      category: 'AUTHORIZED_OTT',
      platforms: [
        'SonyLIV',
        'Disney+ Hotstar',
        'Netflix',
        'JioCinema',
        'Amazon Prime Video',
        'Disney+',
        'ZEE5',
        'Apple TV+',
        'Hulu',
        'Max',
        'Peacock'
      ],
      enabled: adapterEnabledState.get('AUTHORIZED_OTT_ADAPTER') ?? true,
      acquisitionCapability: 'METADATA_ONLY_REQUIRES_AUTH',
      supportedMethods: [
        'OTT_CATALOG_METADATA_INGEST',
        'PARTNER_SYNDICATION_MEZZANINE_INGEST',
        'AUTHORIZED_MASTER_ATTACHMENT'
      ],
      supportedProtocols: ['OTT Watch URL Metadata', 'Authorized Partner Mezzanine (.mp4/.m3u8)'],
      supportsResumableDownload: adapterResumableState.get('AUTHORIZED_OTT_ADAPTER') ?? true,
      requiresCredentials: true,
      envVar: 'SONYLIV_PARTNER_API_KEY / HOTSTAR_SYNDICATION_TOKEN / NETFLIX_BACKLOT_API_KEY',
      credentialsConfigured: Boolean(
        process.env.SONYLIV_PARTNER_API_KEY ||
          process.env.HOTSTAR_SYNDICATION_TOKEN ||
          process.env.NETFLIX_BACKLOT_API_KEY ||
          process.env.JIOCINEMA_PARTNER_TOKEN ||
          process.env.PRIME_VIDEO_DIRECT_KEY
      ),
      description:
        'Identifies commercial DRM-protected OTT watch pages, preserves title/platform/episode metadata for Discovery Sweeps without bypassing DRM or login walls, and automatically acquires video when an authorized mezzanine/partner feed URL is supplied.',
      fallbackGuidance:
        'Commercial OTT consumer watch pages use hardware/browser DRM (Widevine/PlayReady/FairPlay). Provide an approved unencrypted partner mezzanine URL or attach an authorized reference master video file.'
    }
  ];

  return baseAdapters;
}

const ADAPTER_ID_ALIASES: Record<string, string> = {
  adapter_youtube: 'YOUTUBE_ADAPTER',
  youtube: 'YOUTUBE_ADAPTER',
  eco_youtube: 'YOUTUBE_ADAPTER',
  adapter_dailymotion: 'DAILYMOTION_ADAPTER',
  dailymotion: 'DAILYMOTION_ADAPTER',
  eco_dailymotion: 'DAILYMOTION_ADAPTER',
  adapter_vimeo: 'VIMEO_ADAPTER',
  vimeo: 'VIMEO_ADAPTER',
  eco_vimeo: 'VIMEO_ADAPTER',
  adapter_public_video_platform: 'PUBLIC_VIDEO_PLATFORM_ADAPTER',
  public_video_hosting: 'PUBLIC_VIDEO_PLATFORM_ADAPTER',
  eco_public_video_hosting: 'PUBLIC_VIDEO_PLATFORM_ADAPTER',
  adapter_direct_media: 'DIRECT_MEDIA_ADAPTER',
  adapter_hls_stream: 'HLS_STREAM_ADAPTER',
  adapter_dash_stream: 'DASH_STREAM_ADAPTER',
  adapter_authorized_ott: 'AUTHORIZED_OTT_ADAPTER',
  commercial_ott: 'AUTHORIZED_OTT_ADAPTER',
  eco_commercial_ott: 'AUTHORIZED_OTT_ADAPTER'
};

export function normalizeSourceAdapterId(adapterId: string): string {
  const raw = String(adapterId || '').trim();
  return ADAPTER_ID_ALIASES[raw.toLowerCase()] || raw;
}

export function updateSourceAdapterConfig(
  adapterId: string,
  patch: { enabled?: boolean; supportsResumableDownload?: boolean }
): SourceAdapterDescriptor | null {
  const normalizedId = normalizeSourceAdapterId(adapterId);
  const all = getSourceAdapters();
  const target = all.find(a => a.id === normalizedId);
  if (!target) return null;
  if (typeof patch.enabled === 'boolean') {
    adapterEnabledState.set(normalizedId, patch.enabled);
  }
  if (typeof patch.supportsResumableDownload === 'boolean') {
    adapterResumableState.set(normalizedId, patch.supportsResumableDownload);
  }
  return getSourceAdapters().find(a => a.id === normalizedId) || null;
}

export const SourceAdapterRegistry = {
  getSourceAdapters,
  getAdapters: getSourceAdapters,
  isAdapterEnabled(adapterId: string): boolean {
    const normalizedId = normalizeSourceAdapterId(adapterId);
    const found = getSourceAdapters().find(a => a.id === normalizedId);
    return found ? found.enabled : true;
  },
  setAdapterEnabled(adapterId: string, enabled: boolean): SourceAdapterDescriptor | null {
    return updateSourceAdapterConfig(adapterId, { enabled });
  }
};

export function identifySourceAdapterForUrl(params: {
  url?: string;
  submittedUrl?: string;
  finalUrl?: string;
  contentType?: string;
  detectedPlatform?: string;
  platformName?: string;
  isOttProtected?: boolean;
  ottPlatformName?: string;
}): {
  adapter: SourceAdapterDescriptor;
  platform: string;
  videoId?: string;
  mediaFormat?: string;
} {
  const adapters = getSourceAdapters();
  const byId = (id: string) => adapters.find(a => a.id === id)!;

  const url = (params.finalUrl || params.submittedUrl || params.url || '').trim();
  const lowerUrl = url.toLowerCase();
  const mime = (params.contentType || '').toLowerCase();
  const detectedPlat = params.ottPlatformName || params.detectedPlatform || params.platformName;

  // 1. Commercial DRM OTT Platforms
  if (params.isOttProtected) {
    return {
      adapter: byId('AUTHORIZED_OTT_ADAPTER'),
      platform: detectedPlat || 'OTT Streaming Platform',
      mediaFormat: 'DRM_PROTECTED'
    };
  }

  // 2. YouTube
  const ytIdMatch =
    url.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{6,15})/i) ||
    (detectedPlat?.toLowerCase() === 'youtube' ? url.match(/[?&]v=([a-zA-Z0-9_-]{6,15})/i) : null);
  if (ytIdMatch || lowerUrl.includes('youtube.com/') || lowerUrl.includes('youtu.be/')) {
    return {
      adapter: byId('YOUTUBE_ADAPTER'),
      platform: 'YouTube',
      videoId: ytIdMatch?.[1],
      mediaFormat: 'YOUTUBE_STREAM'
    };
  }

  // 3. Dailymotion
  const dmIdMatch =
    url.match(/dailymotion\.com\/(?:video|embed\/video)\/([a-zA-Z0-9]+)/i) ||
    url.match(/dai\.ly\/([a-zA-Z0-9]+)/i) ||
    (detectedPlat?.toLowerCase() === 'dailymotion' ? url.match(/\/video\/([a-zA-Z0-9]+)/i) : null);
  if (dmIdMatch || lowerUrl.includes('dailymotion.com/') || lowerUrl.includes('dai.ly/')) {
    return {
      adapter: byId('DAILYMOTION_ADAPTER'),
      platform: 'Dailymotion',
      videoId: dmIdMatch?.[1],
      mediaFormat: 'DAILYMOTION_STREAM'
    };
  }

  // 4. Vimeo
  const vimeoIdMatch =
    url.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d{5,15})/i) ||
    url.match(/player\.vimeo\.com\/video\/(\d{5,15})/i) ||
    (detectedPlat?.toLowerCase() === 'vimeo' ? url.match(/\/(?:vimeo|video)\/([a-zA-Z0-9_-]{4,15})/i) : null);
  if (vimeoIdMatch || lowerUrl.includes('vimeo.com/')) {
    return {
      adapter: byId('VIMEO_ADAPTER'),
      platform: 'Vimeo',
      videoId: vimeoIdMatch?.[1],
      mediaFormat: 'VIMEO_STREAM'
    };
  }

  // 5. Public Video Platforms (Internet Archive, Wikimedia, Wistia)
  const archiveMatch = url.match(/archive\.org\/(?:details|download|embed)\/([^/?#]+)/i);
  if (archiveMatch) {
    return {
      adapter: byId('PUBLIC_VIDEO_PLATFORM_ADAPTER'),
      platform: 'Internet Archive',
      videoId: archiveMatch[1],
      mediaFormat: 'ARCHIVE_VIDEO'
    };
  }
  const wikimediaFileMatch = url.match(/commons\.wikimedia\.org\/wiki\/(?:File:|Special:FilePath\/)([^/?#]+)/i);
  if (wikimediaFileMatch || lowerUrl.includes('commons.wikimedia.org')) {
    return {
      adapter: byId('PUBLIC_VIDEO_PLATFORM_ADAPTER'),
      platform: 'Wikimedia Commons',
      videoId: wikimediaFileMatch ? decodeURIComponent(wikimediaFileMatch[1]) : undefined,
      mediaFormat: 'WIKIMEDIA_VIDEO'
    };
  }
  const wistiaMatch = url.match(/(?:wistia\.(?:com|net)\/(?:medias|embed\/iframe)\/|[?&]wvideo=)([a-zA-Z0-9]+)/i);
  if (wistiaMatch || lowerUrl.includes('wistia.com') || lowerUrl.includes('wistia.net')) {
    return {
      adapter: byId('PUBLIC_VIDEO_PLATFORM_ADAPTER'),
      platform: 'Wistia',
      videoId: wistiaMatch?.[1],
      mediaFormat: 'WISTIA_VIDEO'
    };
  }

  // 6. HLS (.m3u8)
  if (
    mime.includes('application/vnd.apple.mpegurl') ||
    mime.includes('application/x-mpegurl') ||
    /\.m3u8(\?|$|#)/i.test(lowerUrl)
  ) {
    return {
      adapter: byId('HLS_STREAM_ADAPTER'),
      platform: detectedPlat || 'HLS Stream (.m3u8)',
      mediaFormat: 'HLS_M3U8'
    };
  }

  // 7. MPEG-DASH (.mpd)
  if (mime.includes('dash+xml') || /\.mpd(\?|$|#)/i.test(lowerUrl)) {
    return {
      adapter: byId('DASH_STREAM_ADAPTER'),
      platform: detectedPlat || 'MPEG-DASH Stream (.mpd)',
      mediaFormat: 'DASH_MPD'
    };
  }

  // 8. Direct Media File (.mp4, .mkv, .mov, .webm, .m4v, .ts, .ogv, .ogg)
  const directExtMatch = lowerUrl.match(/\.(mp4|mkv|mov|webm|m4v|ts|ogv|ogg)(\?|$|#)/i);
  if (
    Boolean(directExtMatch) ||
    (mime.startsWith('video/') && !lowerUrl.includes('/details/') && !lowerUrl.includes('/watch'))
  ) {
    const ext = directExtMatch?.[1]?.toUpperCase() || mime.replace('video/', '').toUpperCase() || 'MP4';
    return {
      adapter: byId('DIRECT_MEDIA_ADAPTER'),
      platform: detectedPlat || 'Direct Media Stream',
      mediaFormat: ext
    };
  }

  return {
    adapter: byId('PUBLIC_VIDEO_PLATFORM_ADAPTER'),
    platform: detectedPlat || 'Web Video Platform',
    mediaFormat: 'HTML_WEBPAGE'
  };
}

/**
 * Extracts a balanced JSON array `[...]` or object `{...}` following a regex match in HTML/script text
 * so nested arrays/objects (such as `drmFamilies: [...]` inside `formats: [...]` or `auto: [...]` inside `qualities: {...}`)
 * never truncate prematurely at the first inner closing bracket.
 */
function extractBalancedJsonBlock(
  text: string,
  keyPattern: RegExp,
  openChar: '[' | '{',
  closeChar: ']' | '}'
): string | null {
  const match = keyPattern.exec(text);
  if (!match) return null;
  const startIdx = match.index + match[0].length - 1;
  if (text[startIdx] !== openChar) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  const maxScan = Math.min(text.length, startIdx + 250000);
  for (let i = startIdx; i < maxScan; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx + 1, i);
        }
      }
    }
  }
  return null;
}

/**
 * Extracts platform-specific metadata (videoId, title, durationSec, author, progressive/HLS stream URLs)
 * from accessible HTML and embedded JSON configurations for YouTube, Dailymotion, Vimeo, Internet Archive,
 * and public video webpages without bypassing DRM or authentication.
 */
export function extractPlatformSpecificMediaAndMetadata(params: {
  submittedUrl: string;
  finalUrl: string;
  html: string;
  pageTitle?: string;
  pageDescription?: string;
  detectedPlatform?: string;
}): {
  videoId?: string;
  platform?: string;
  title?: string;
  durationSec?: number;
  authorOrRightsHolder?: string;
  mediaFormat?: string;
  seasonEpisodeInfo?: string;
  acquisitionMethod?: string;
  attemptedMethods: AttemptedAcquisitionMethod[];
  videoIdentity: ResolvedVideoIdentity;
  additionalDirectCandidates: string[];
  hasExplicitPlatformDrm: boolean;
  isExplicitlyUnavailable: boolean;
} {
  const { submittedUrl, finalUrl, html, pageTitle, detectedPlatform } = params;
  const additionalDirectCandidates: string[] = [];
  const attemptedMethods: AttemptedAcquisitionMethod[] = [];
  const now = new Date().toISOString();
  let videoId: string | undefined;
  let platform = detectedPlatform;
  let title = pageTitle;
  let durationSec: number | undefined;
  let authorOrRightsHolder: string | undefined;
  let mediaFormat: string | undefined;
  let seasonEpisodeInfo: string | undefined;
  let acquisitionMethod: string | undefined;
  let hasExplicitPlatformDrm = false;
  let isExplicitlyUnavailable = false;

  const resolveCandidateUrl = (raw: string): string | null => {
    try {
      const unescaped = raw
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&')
        .trim();
      const resolved = new URL(unescaped, finalUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        return resolved.toString();
      }
    } catch {}
    return null;
  };

  const addCandidate = (raw: string) => {
    const resolved = resolveCandidateUrl(raw);
    if (resolved && !additionalDirectCandidates.includes(resolved)) {
      additionalDirectCandidates.push(resolved);
    }
  };

  // 1. Generic OpenGraph / meta duration & author extraction
  const ogDurationMatch =
    html.match(/<meta[^>]+(?:property|name)=["'](?:og:video:duration|video:duration)["'][^>]+content=["'](\d+(?:\.\d+)?)["']/i) ||
    html.match(/<meta[^>]+content=["'](\d+(?:\.\d+)?)["'][^>]+(?:property|name)=["'](?:og:video:duration|video:duration)["']/i) ||
    html.match(/<meta[^>]+itemprop=["']duration["'][^>]+content=["']([^"']+)["']/i);
  if (ogDurationMatch?.[1]) {
    durationSec = parseIso8601DurationSec(ogDurationMatch[1]);
  }

  const authorMetaMatch =
    html.match(/<meta[^>]+(?:name|property)=["'](?:author|article:author|og:video:director)["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+itemprop=["']name["'][^>]+content=["']([^"']+)["']/i);
  if (authorMetaMatch?.[1]) {
    authorOrRightsHolder = authorMetaMatch[1].trim();
  }

  // 2. YouTube-specific player response inspection
  const ytMatch =
    finalUrl.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,15})/i) ||
    submittedUrl.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,15})/i) ||
    ((platform?.toLowerCase() === 'youtube' || html.includes('ytInitialPlayerResponse'))
      ? finalUrl.match(/[?&]v=([a-zA-Z0-9_-]{6,15})/i) || submittedUrl.match(/[?&]v=([a-zA-Z0-9_-]{6,15})/i)
      : null);

  if (ytMatch || html.includes('ytInitialPlayerResponse')) {
    platform = 'YouTube';
    videoId = ytMatch?.[1] || html.match(/"videoId"\s*:\s*"([a-zA-Z0-9_-]{6,15})"/)?.[1];
    const lenMatch = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (lenMatch?.[1]) {
      durationSec = parseInt(lenMatch[1], 10) || durationSec;
    }
    const ytAuthorMatch = html.match(/"author"\s*:\s*"([^"]+)"/);
    if (ytAuthorMatch?.[1]) {
      authorOrRightsHolder = ytAuthorMatch[1].trim();
    }
    const ytTitleMatch = html.match(/"videoDetails"\s*:\s*\{[^}]*"title"\s*:\s*"([^"]+)"/);
    if (ytTitleMatch?.[1]) {
      title = ytTitleMatch[1].trim();
    } else if (title) {
      title = title.replace(/\s*-\s*YouTube$/i, '').trim();
    }

    const playabilityStatusMatch = html.match(/"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"([^"]+)"(?:\s*,\s*"reason"\s*:\s*"([^"]+)")?/);
    const playabilityStatus = playabilityStatusMatch?.[1];
    const playabilityReason = playabilityStatusMatch?.[2];

    if (
      playabilityStatus === 'ERROR' ||
      playabilityStatus === 'UNPLAYABLE' ||
      /video unavailable/i.test(pageTitle || '')
    ) {
      isExplicitlyUnavailable = true;
    }

    if (html.includes('"drmFamilies"')) {
      hasExplicitPlatformDrm = true;
    }

    // Check if ytInitialPlayerResponse.streamingData.formats exposes an unencrypted progressive stream URL
    const formatsBlock =
      extractBalancedJsonBlock(html, /"formats"\s*:\s*\[/, '[', ']') ||
      html.match(/"formats"\s*:\s*\[([\s\S]*?)\]/)?.[1];
    let foundDirectYtStream = false;
    if (formatsBlock) {
      if (!formatsBlock.includes('"drmFamilies"') && !formatsBlock.includes('"signatureCipher"')) {
        const urlRegex = /"url"\s*:\s*"(https?:[^"]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = urlRegex.exec(formatsBlock)) !== null) {
          addCandidate(m[1]);
          mediaFormat = 'MP4';
          acquisitionMethod = 'YOUTUBE_PROGRESSIVE_STREAM_ACQUISITION';
          foundDirectYtStream = true;
        }
      }
    }

    if (foundDirectYtStream) {
      attemptedMethods.push({
        method: 'YOUTUBE_PROGRESSIVE_STREAM_ACQUISITION',
        status: 'SUCCESS',
        detail: `Resolved unencrypted progressive MP4 stream URL from ytInitialPlayerResponse.streamingData.formats (${additionalDirectCandidates[0]}).`,
        timestamp: now
      });
    } else if (html.includes('ytInitialPlayerResponse')) {
      const ciphered = Boolean(formatsBlock && formatsBlock.includes('"signatureCipher"')) || html.includes('"signatureCipher"');
      const drmProtected = hasExplicitPlatformDrm;
      const loginRequired = playabilityStatus === 'LOGIN_REQUIRED';
      attemptedMethods.push({
        method: 'YOUTUBE_PROGRESSIVE_STREAM_ACQUISITION',
        status: 'RESTRICTED',
        detail: drmProtected
          ? 'ytInitialPlayerResponse.streamingData indicates Widevine/DRM encrypted playback (drmFamilies).'
          : ciphered
          ? 'ytInitialPlayerResponse.streamingData formats use signatureCipher rolling player protection without an unencrypted direct MP4 URL.'
          : loginRequired
          ? `YouTube watch player returned playabilityStatus="LOGIN_REQUIRED" (${playabilityReason || 'bot/session check'}) and did not expose an unencrypted stream URL.`
          : 'YouTube watch page HTML did not expose an unencrypted progressive MP4 or HLS stream URL in streamingData.',
        timestamp: now
      });
    }
  }

  // 3. Vimeo-specific inspection (vimeo.com / player.vimeo.com)
  const vimeoMatch =
    finalUrl.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d{5,15})/i) ||
    submittedUrl.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d{5,15})/i) ||
    (platform?.toLowerCase() === 'vimeo' ? finalUrl.match(/\/(?:vimeo|video)\/([a-zA-Z0-9_-]{4,15})/i) : null);

  if (vimeoMatch || platform?.toLowerCase() === 'vimeo' || html.includes('player.vimeo.com')) {
    platform = 'Vimeo';
    videoId = vimeoMatch?.[1] || html.match(/"clip_id"\s*:\s*(\d+)/)?.[1] || html.match(/"id"\s*:\s*(\d{5,15})/)?.[1] || videoId;
    const vimeoDurMatch = html.match(/"duration"\s*:\s*(\d+)/);
    if (vimeoDurMatch?.[1] && !durationSec) {
      durationSec = parseInt(vimeoDurMatch[1], 10) || undefined;
    }
    const vimeoOwnerMatch = html.match(/"owner"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
    if (vimeoOwnerMatch?.[1] && !authorOrRightsHolder) {
      authorOrRightsHolder = vimeoOwnerMatch[1].trim();
    }
    if (title) {
      title = title.replace(/\s*on\s+Vimeo$/i, '').trim();
    }

    // Extract Vimeo progressive MP4 download streams if exposed in player config
    const progressiveBlock =
      extractBalancedJsonBlock(html, /"progressive"\s*:\s*\[/, '[', ']') ||
      html.match(/"progressive"\s*:\s*\[([\s\S]*?)\]/)?.[1];
    if (progressiveBlock) {
      const urlRegex = /"url"\s*:\s*"(https?:[^"]+\.(?:mp4|webm|mov)[^"]*)"/gi;
      let m: RegExpExecArray | null;
      let foundVimeoProg = false;
      while ((m = urlRegex.exec(progressiveBlock)) !== null) {
        addCandidate(m[1]);
        mediaFormat = 'MP4';
        acquisitionMethod = 'VIMEO_PROGRESSIVE_MP4_DOWNLOAD';
        foundVimeoProg = true;
      }
      if (foundVimeoProg) {
        attemptedMethods.push({
          method: 'VIMEO_PROGRESSIVE_MP4_DOWNLOAD',
          status: 'SUCCESS',
          detail: `Resolved progressive MP4 stream from inline Vimeo player config (${additionalDirectCandidates[0]}).`,
          timestamp: now
        });
      }
    }
  }

  // 4. Dailymotion-specific inspection
  const dmMatch =
    finalUrl.match(/dailymotion\.com\/(?:video|embed\/video)\/([a-zA-Z0-9]+)/i) ||
    finalUrl.match(/dai\.ly\/([a-zA-Z0-9]+)/i) ||
    submittedUrl.match(/dailymotion\.com\/(?:video|embed\/video)\/([a-zA-Z0-9]+)/i) ||
    submittedUrl.match(/dai\.ly\/([a-zA-Z0-9]+)/i) ||
    (platform?.toLowerCase() === 'dailymotion' ? finalUrl.match(/\/video\/([a-zA-Z0-9]+)/i) : null);

  if (dmMatch || platform?.toLowerCase() === 'dailymotion') {
    platform = 'Dailymotion';
    videoId = dmMatch?.[1] || videoId;
    const dmDurMatch = html.match(/"duration"\s*:\s*(\d+)/);
    if (dmDurMatch?.[1] && !durationSec) {
      durationSec = parseInt(dmDurMatch[1], 10) || undefined;
    }
    if (title) {
      title = title.replace(/\s*-\s*video\s+Dailymotion$/i, '').replace(/\s*-\s*Dailymotion$/i, '').trim();
    }

    const qualitiesBlock =
      extractBalancedJsonBlock(html, /"qualities"\s*:\s*\{/, '{', '}') ||
      html.match(/"qualities"\s*:\s*\{([\s\S]*?)\}\s*(?:,|\})/)?.[1];
    if (qualitiesBlock) {
      const urlRegex = /"url"\s*:\s*"(https?:[^"]+\.(?:mp4|m3u8)[^"]*)"/gi;
      let m: RegExpExecArray | null;
      let foundDmQual = false;
      while ((m = urlRegex.exec(qualitiesBlock)) !== null) {
        addCandidate(m[1]);
        mediaFormat = m[1].includes('.m3u8') ? 'HLS_M3U8' : 'MP4';
        acquisitionMethod = 'DAILYMOTION_PLAYER_QUALITIES_STREAM';
        foundDmQual = true;
      }
      if (foundDmQual) {
        attemptedMethods.push({
          method: 'DAILYMOTION_PLAYER_QUALITIES_STREAM',
          status: 'SUCCESS',
          detail: `Resolved stream URL from inline Dailymotion qualities config (${additionalDirectCandidates[0]}).`,
          timestamp: now
        });
      }
    }
  }

  // 5. Internet Archive & Public Video Platform explicit download links (<a href="...mp4" download> or /download/...mp4)
  const archiveMatch = finalUrl.match(/archive\.org\/(?:details|download|embed)\/([^/?#]+)/i);
  if (archiveMatch) {
    platform = 'Internet Archive';
    videoId = archiveMatch[1];
  }

  const downloadAnchorRegex =
    /<a\b[^>]*href=["']([^"'?#]+\.(?:mp4|mkv|mov|webm|ogv|ogg)(?:\?[^"']*)?)["'][^>]*>/gi;
  let anchorMatch: RegExpExecArray | null;
  let foundAnchorDownload = false;
  while ((anchorMatch = downloadAnchorRegex.exec(html)) !== null) {
    const href = anchorMatch[1];
    if (
      !href ||
      /hdmp4mania|doubleclick|googlesyndication|adserver/i.test(href) ||
      /\/wiki\/(?:File|TimedText|Special|Category|Talk|File_talk):/i.test(href) ||
      /\/w\/index\.php/i.test(href)
    ) {
      continue;
    }
    addCandidate(href);
    foundAnchorDownload = true;
    if (!mediaFormat) {
      const ext = href.match(/\.(mp4|mkv|mov|webm|ogv|ogg)/i)?.[1]?.toUpperCase();
      if (ext) mediaFormat = ext;
    }
    if (!acquisitionMethod) {
      acquisitionMethod = archiveMatch ? 'ARCHIVE_ORG_DIRECT_DOWNLOAD' : 'PUBLIC_PLATFORM_DIRECT_DOWNLOAD';
    }
  }
  if (foundAnchorDownload && additionalDirectCandidates.length > 0) {
    attemptedMethods.push({
      method: archiveMatch ? 'ARCHIVE_ORG_DIRECT_DOWNLOAD' : 'PUBLIC_PLATFORM_DIRECT_DOWNLOAD',
      status: 'SUCCESS',
      detail: `Resolved direct video download link from page HTML (${additionalDirectCandidates[0]}).`,
      timestamp: now
    });
  }

  // Extract season/episode code if present in title
  if (title) {
    const seMatch = title.match(/\b(S\d{1,2}\s*E\d{1,3}|Season\s*\d{1,2}\s*Episode\s*\d{1,3}|\d{1,2}x\d{2})\b/i);
    if (seMatch) {
      seasonEpisodeInfo = seMatch[1].replace(/\s+/g, '').toUpperCase();
    }
  }

  const videoIdentity: ResolvedVideoIdentity = {
    videoId,
    platformVideoId: videoId,
    title,
    platform,
    canonicalUrl: finalUrl,
    durationSec,
    mediaFormat,
    authorOrRightsHolder,
    rightsHolderOrAuthor: authorOrRightsHolder,
    seasonEpisodeInfo,
    seasonEpisode: seasonEpisodeInfo,
    isLiveStream: false
  };

  return {
    videoId,
    platform,
    title,
    durationSec,
    authorOrRightsHolder,
    mediaFormat,
    seasonEpisodeInfo,
    acquisitionMethod,
    attemptedMethods,
    videoIdentity,
    additionalDirectCandidates,
    hasExplicitPlatformDrm,
    isExplicitlyUnavailable
  };
}

/**
 * Actively executes official platform APIs, player config endpoints, archive metadata APIs,
 * and configured partner feeds for the detected source adapter (YouTube, Dailymotion, Vimeo,
 * Internet Archive, Wikimedia Commons, Wistia, and public HTML5 video platforms).
 * Never bypasses DRM, authentication, paywalls, or platform access restrictions.
 */
export async function resolvePlatformAdapterMediaAndMetadata(params: {
  submittedUrl: string;
  finalUrl: string;
  finalDomain?: string;
  html: string;
  pageTitle?: string;
  pageDescription?: string;
  detectedPlatform?: string;
  initialExtraction?: ReturnType<typeof extractPlatformSpecificMediaAndMetadata>;
  initialResult?: ReturnType<typeof extractPlatformSpecificMediaAndMetadata>;
  safeFetchJsonOrText?: (url: string, timeoutMs?: number) => Promise<{ ok: boolean; status: number; text: string; contentType?: string; finalUrl?: string; json?: any } | null>;
}): Promise<{
  videoIdentity: ResolvedVideoIdentity;
  additionalDirectCandidates: string[];
  acquisitionMethod?: string;
  attemptedMethods: AttemptedAcquisitionMethod[];
  hasExplicitPlatformDrm: boolean;
  isExplicitlyUnavailable: boolean;
  platformDiagnosticReason?: string;
}> {
  const { submittedUrl, finalUrl } = params;
  let finalDomain = (params.finalDomain || '').toLowerCase();
  if (!finalDomain) {
    try {
      finalDomain = new URL(finalUrl || submittedUrl).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      finalDomain = '';
    }
  }
  const initialExtraction =
    params.initialExtraction ||
    params.initialResult ||
    extractPlatformSpecificMediaAndMetadata({
      submittedUrl,
      finalUrl,
      html: params.html,
      pageTitle: params.pageTitle,
      pageDescription: params.pageDescription,
      detectedPlatform: params.detectedPlatform
    });
  const attemptedMethods: AttemptedAcquisitionMethod[] = [...(initialExtraction.attemptedMethods || [])];
  const additionalDirectCandidates: string[] = [...(initialExtraction.additionalDirectCandidates || [])];
  const videoIdentity: ResolvedVideoIdentity = { ...initialExtraction.videoIdentity };
  let acquisitionMethod = initialExtraction.acquisitionMethod;
  let hasExplicitPlatformDrm = initialExtraction.hasExplicitPlatformDrm;
  let isExplicitlyUnavailable = initialExtraction.isExplicitlyUnavailable;
  let platformDiagnosticReason: string | undefined;

  const defaultFetchHelper = async (url: string, timeoutMs = 6000) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SPECTRA/1.0 Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*'
        }
      });
      clearTimeout(timer);
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        text,
        contentType: (res.headers.get('content-type') || '').toLowerCase(),
        finalUrl: res.url || url
      };
    } catch {
      return null;
    }
  };

  const fetchHelper = params.safeFetchJsonOrText || defaultFetchHelper;
  const addCandidate = (url: string) => {
    if (url && /^https?:\/\//i.test(url)) {
      const existingIdx = additionalDirectCandidates.indexOf(url);
      if (existingIdx !== -1) {
        additionalDirectCandidates.splice(existingIdx, 1);
      }
      additionalDirectCandidates.unshift(url);
    }
  };

  let parsedOrigin = '';
  try {
    parsedOrigin = new URL(finalUrl).origin;
  } catch {}

  const platformLower = (videoIdentity.platform || params.detectedPlatform || '').toLowerCase();

  // ---------------------------------------------------------------------------
  // 1. YOUTUBE ADAPTER: Official oEmbed + Watch Player Response + Embed Probe + Partner Feed
  // ---------------------------------------------------------------------------
  if (platformLower === 'youtube' || finalDomain.includes('youtube.com') || finalDomain.includes('youtu.be')) {
    videoIdentity.platform = 'YouTube';
    const ytId =
      videoIdentity.videoId ||
      finalUrl.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,15})/i)?.[1] ||
      submittedUrl.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,15})/i)?.[1];
    if (ytId) {
      videoIdentity.videoId = ytId;
      videoIdentity.platformVideoId = ytId;

      const isLiveYtDomain =
        finalDomain.includes('youtube.com') ||
        finalDomain.includes('youtu.be') ||
        finalDomain.includes('youtube-nocookie.com');

      // Method 1: Official YouTube oEmbed API
      const oembedEndpoint = isLiveYtDomain
        ? `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ytId}`)}&format=json`
        : `${parsedOrigin}/oembed?url=${encodeURIComponent(finalUrl)}&format=json`;
      const oembedRes = await fetchHelper(oembedEndpoint, 4500);
      if (oembedRes && oembedRes.ok) {
        try {
          const oembedJson = JSON.parse(oembedRes.text);
          if (typeof oembedJson?.title === 'string' && oembedJson.title.trim()) {
            videoIdentity.title = oembedJson.title.trim();
          }
          if (typeof oembedJson?.author_name === 'string' && oembedJson.author_name.trim()) {
            videoIdentity.authorOrRightsHolder = oembedJson.author_name.trim();
            videoIdentity.rightsHolderOrAuthor = oembedJson.author_name.trim();
          }
          // If oEmbed succeeded (200 OK), the video exists and is public even if the watch page triggered a datacenter LOGIN_REQUIRED check
          isExplicitlyUnavailable = false;
          attemptedMethods.push({
            method: 'YOUTUBE_OEMBED_METADATA_RESOLUTION',
            status: 'SUCCESS',
            detail: `YouTube official oEmbed API resolved video identity: "${videoIdentity.title || ytId}" by ${videoIdentity.authorOrRightsHolder || 'YouTube Creator'}.`,
            timestamp: new Date().toISOString()
          });
        } catch {}
      } else if (oembedRes && (oembedRes.status === 404 || oembedRes.status === 401 || oembedRes.status === 403 || oembedRes.status === 400)) {
        if (isLiveYtDomain) {
          isExplicitlyUnavailable = true;
          attemptedMethods.push({
            method: 'YOUTUBE_OEMBED_METADATA_RESOLUTION',
            status: 'UNAVAILABLE',
            detail: `YouTube oEmbed API returned HTTP ${oembedRes.status} (video is private, deleted, or unavailable).`,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Method 2: YouTube Embed Player Config Probe (if no direct stream candidate yet and not unavailable)
      if (additionalDirectCandidates.length === 0 && !isExplicitlyUnavailable && isLiveYtDomain) {
        const embedProbeUrl = `https://www.youtube.com/embed/${ytId}`;
        const embedRes = await fetchHelper(embedProbeUrl, 5000);
        if (embedRes && embedRes.ok && embedRes.text) {
          const embedExtraction = extractPlatformSpecificMediaAndMetadata({
            submittedUrl: embedProbeUrl,
            finalUrl: embedProbeUrl,
            html: embedRes.text,
            detectedPlatform: 'YouTube'
          });
          if (embedExtraction.durationSec && !videoIdentity.durationSec) {
            videoIdentity.durationSec = embedExtraction.durationSec;
          }
          if (embedExtraction.authorOrRightsHolder && !videoIdentity.authorOrRightsHolder) {
            videoIdentity.authorOrRightsHolder = embedExtraction.authorOrRightsHolder;
            videoIdentity.rightsHolderOrAuthor = embedExtraction.authorOrRightsHolder;
          }
          if (embedExtraction.additionalDirectCandidates.length > 0) {
            for (const cand of embedExtraction.additionalDirectCandidates) {
              addCandidate(cand);
            }
            acquisitionMethod = 'YOUTUBE_EMBED_PROGRESSIVE_STREAM';
            attemptedMethods.push({
              method: 'YOUTUBE_EMBED_PLAYER_PROBE',
              status: 'SUCCESS',
              detail: `Resolved direct progressive stream from YouTube embed configuration (${embedExtraction.additionalDirectCandidates[0]}).`,
              timestamp: new Date().toISOString()
            });
          } else {
            attemptedMethods.push({
              method: 'YOUTUBE_EMBED_PLAYER_PROBE',
              status: 'RESTRICTED',
              detail: 'Inspected YouTube embed player page (/embed/' + ytId + '); embed player requires client-side cipher/Adaptive MSE playback and does not expose an unencrypted direct MP4 file.',
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      // Method 3: Authorized Partner Feed Check
      const partnerFeedTemplate = process.env.YOUTUBE_PARTNER_FEED_URL_TEMPLATE;
      if (partnerFeedTemplate && partnerFeedTemplate.includes('{videoId}')) {
        const resolvedPartnerUrl = partnerFeedTemplate.replace(/\{videoId\}/g, encodeURIComponent(ytId));
        addCandidate(resolvedPartnerUrl);
        acquisitionMethod = 'YOUTUBE_AUTHORIZED_PARTNER_FEED';
        attemptedMethods.push({
          method: 'YOUTUBE_AUTHORIZED_PARTNER_FEED',
          status: 'SUCCESS',
          detail: `Resolved authorized YouTube partner feed URL for video ${ytId}.`,
          timestamp: new Date().toISOString()
        });
      } else if (additionalDirectCandidates.length === 0) {
        attemptedMethods.push({
          method: 'YOUTUBE_AUTHORIZED_PARTNER_FEED',
          status: 'UNAVAILABLE',
          detail: 'No YOUTUBE_PARTNER_FEED_URL_TEMPLATE / YOUTUBE_PARTNER_FEED_TOKEN configured in environment.',
          timestamp: new Date().toISOString()
        });
      }

      if (additionalDirectCandidates.length === 0 && !isExplicitlyUnavailable) {
        platformDiagnosticReason =
          `YouTube watch page (${ytId}${videoIdentity.title ? ` — "${videoIdentity.title}"` : ''}) was inspected across ${attemptedMethods.length} acquisition methods (` +
          attemptedMethods.map(m => `${m.method}: ${m.status}`).join(', ') +
          `). Public YouTube watch/embed pages protect media streams with rolling signatureCipher / bot-verification challenges and do not expose unencrypted direct MP4/HLS files. Metadata and URL are preserved for Discovery Sweeps; upload an authorized master file (.mp4/.mkv/.mov) or configure an approved partner mezzanine feed for full-video frame fingerprinting.`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. DAILYMOTION ADAPTER: Official oEmbed + Public Player Metadata API (/player/metadata/video/{id})
  // ---------------------------------------------------------------------------
  if (platformLower === 'dailymotion' || finalDomain.includes('dailymotion.com') || finalDomain.includes('dai.ly')) {
    videoIdentity.platform = 'Dailymotion';
    const dmId =
      videoIdentity.videoId ||
      finalUrl.match(/dailymotion\.com\/(?:video|embed\/video)\/([a-zA-Z0-9]+)/i)?.[1] ||
      finalUrl.match(/dai\.ly\/([a-zA-Z0-9]+)/i)?.[1] ||
      submittedUrl.match(/dailymotion\.com\/(?:video|embed\/video)\/([a-zA-Z0-9]+)/i)?.[1] ||
      submittedUrl.match(/dai\.ly\/([a-zA-Z0-9]+)/i)?.[1];

    if (dmId) {
      videoIdentity.videoId = dmId;
      videoIdentity.platformVideoId = dmId;
      const isLiveDmDomain = finalDomain.includes('dailymotion.com') || finalDomain.includes('dai.ly');

      // Method 1: Dailymotion Official Player Metadata API
      if (additionalDirectCandidates.length === 0 || !videoIdentity.durationSec) {
        const dmMetaUrl = isLiveDmDomain
          ? `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(dmId)}`
          : `${parsedOrigin}/player/metadata/video/${encodeURIComponent(dmId)}`;
        const metaRes = await fetchHelper(dmMetaUrl, 6000);
        if (metaRes && metaRes.ok && metaRes.text) {
          try {
            const metaJson: any = JSON.parse(metaRes.text);
            if (metaJson?.error) {
              attemptedMethods.push({
                method: 'DAILYMOTION_PLAYER_QUALITIES_STREAM',
                status: 'RESTRICTED',
                detail: `Dailymotion player metadata API returned error: ${metaJson.error.message || metaJson.error.title || 'video unavailable or restricted'}.`,
                timestamp: new Date().toISOString()
              });
            } else {
              if (typeof metaJson?.title === 'string' && metaJson.title.trim()) {
                videoIdentity.title = metaJson.title.trim();
              }
              if (typeof metaJson?.duration === 'number' && metaJson.duration > 0) {
                videoIdentity.durationSec = metaJson.duration;
              }
              const ownerName = metaJson?.owner?.screenname || metaJson?.owner?.username;
              if (typeof ownerName === 'string' && ownerName.trim()) {
                videoIdentity.authorOrRightsHolder = ownerName.trim();
                videoIdentity.rightsHolderOrAuthor = ownerName.trim();
              }

              // Inspect qualities for direct MP4 or HLS (.m3u8) streams
              const qualities = metaJson?.qualities || {};
              const mp4Urls: string[] = [];
              const m3u8Urls: string[] = [];
              for (const qKey of Object.keys(qualities)) {
                const entries = Array.isArray(qualities[qKey]) ? qualities[qKey] : [];
                for (const entry of entries) {
                  if (typeof entry?.url === 'string' && entry.url.startsWith('http')) {
                    if (entry.type?.includes('mp4') || /\.mp4(\?|$)/i.test(entry.url)) {
                      mp4Urls.push(entry.url);
                    } else if (entry.type?.includes('mpegURL') || /\.m3u8(\?|$)/i.test(entry.url)) {
                      m3u8Urls.push(entry.url);
                    }
                  }
                }
              }

              for (const u of mp4Urls) {
                addCandidate(u);
                videoIdentity.mediaFormat = 'MP4';
                acquisitionMethod = 'DAILYMOTION_PLAYER_QUALITIES_STREAM';
              }

              // If Dailymotion provides a single-use cdndirector.dailymotion.com master .m3u8 URL,
              // resolve it once right here to extract the reusable vod*.dmcdn.net variant .m3u8 stream!
              for (const masterM3u8Url of m3u8Urls) {
                if (masterM3u8Url.includes('cdndirector.dailymotion.com')) {
                  const masterRes = await fetchHelper(masterM3u8Url, 6000);
                  if (masterRes && masterRes.ok && masterRes.text.includes('#EXTM3U')) {
                    const variantMatches = [...masterRes.text.matchAll(/^(https?:\/\/[^\r\n]+\.m3u8[^\r\n]*)/gm)].map(
                      m => m[1].replace(/#.*$/, '').trim()
                    );
                    if (variantMatches.length > 0) {
                      for (const vUrl of variantMatches) {
                        addCandidate(vUrl);
                      }
                      videoIdentity.mediaFormat = 'HLS_M3U8';
                      acquisitionMethod = 'DAILYMOTION_HLS_MP4_ACQUISITION';
                    } else {
                      addCandidate(masterM3u8Url);
                      videoIdentity.mediaFormat = 'HLS_M3U8';
                      acquisitionMethod = 'DAILYMOTION_HLS_MP4_ACQUISITION';
                    }
                  }
                } else {
                  addCandidate(masterM3u8Url);
                  if (!videoIdentity.mediaFormat) videoIdentity.mediaFormat = 'HLS_M3U8';
                  if (!acquisitionMethod) acquisitionMethod = 'DAILYMOTION_HLS_MP4_ACQUISITION';
                }
              }

              if (additionalDirectCandidates.length > 0) {
                attemptedMethods.push({
                  method: acquisitionMethod || 'DAILYMOTION_HLS_MP4_ACQUISITION',
                  status: 'SUCCESS',
                  detail: `Resolved accessible Dailymotion video stream (${additionalDirectCandidates[0]}) via official player metadata API (/player/metadata/video/${dmId}).`,
                  timestamp: new Date().toISOString()
                });
              } else {
                attemptedMethods.push({
                  method: 'DAILYMOTION_PLAYER_QUALITIES_STREAM',
                  status: 'RESTRICTED',
                  detail: `Dailymotion player metadata API (/player/metadata/video/${dmId}) resolved metadata, but no unencrypted MP4 or HLS stream was exposed in qualities (private, geo-restricted, or partner-locked).`,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch {}
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. VIMEO ADAPTER: Official oEmbed + Player Config API (player.vimeo.com/video/{id}/config)
  // ---------------------------------------------------------------------------
  if (platformLower === 'vimeo' || finalDomain.includes('vimeo.com')) {
    videoIdentity.platform = 'Vimeo';
    const vimeoId =
      videoIdentity.videoId ||
      finalUrl.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d{4,15})/i)?.[1] ||
      submittedUrl.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d{4,15})/i)?.[1];

    if (vimeoId) {
      videoIdentity.videoId = vimeoId;
      videoIdentity.platformVideoId = vimeoId;
      const isLiveVimeoDomain = finalDomain.includes('vimeo.com');

      // Method 1: Official Vimeo oEmbed API
      if (isLiveVimeoDomain && (!videoIdentity.title || !videoIdentity.durationSec)) {
        const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${vimeoId}`)}`;
        const oemRes = await fetchHelper(oembedUrl, 4500);
        if (oemRes && oemRes.ok) {
          try {
            const oemJson: any = JSON.parse(oemRes.text);
            if (typeof oemJson?.title === 'string' && oemJson.title.trim()) {
              videoIdentity.title = oemJson.title.trim();
            }
            if (typeof oemJson?.author_name === 'string' && oemJson.author_name.trim()) {
              videoIdentity.authorOrRightsHolder = oemJson.author_name.trim();
              videoIdentity.rightsHolderOrAuthor = oemJson.author_name.trim();
            }
            if (typeof oemJson?.duration === 'number' && oemJson.duration > 0) {
              videoIdentity.durationSec = oemJson.duration;
            }
            attemptedMethods.push({
              method: 'VIMEO_OEMBED_METADATA',
              status: 'SUCCESS',
              detail: `Vimeo official oEmbed API resolved "${videoIdentity.title || vimeoId}" (${videoIdentity.durationSec || 0}s) by ${videoIdentity.authorOrRightsHolder || 'Vimeo Creator'}.`,
              timestamp: new Date().toISOString()
            });
          } catch {}
        }
      }

      // Method 2: Vimeo Player Config API (player.vimeo.com/video/{id}/config)
      if (additionalDirectCandidates.length === 0) {
        const configUrl = isLiveVimeoDomain
          ? `https://player.vimeo.com/video/${encodeURIComponent(vimeoId)}/config`
          : `${parsedOrigin}/video/${encodeURIComponent(vimeoId)}/config`;
        const cfgRes = await fetchHelper(configUrl, 6000);
        if (cfgRes && cfgRes.ok && cfgRes.text) {
          try {
            const cfgJson: any = JSON.parse(cfgRes.text);
            if (typeof cfgJson?.video?.title === 'string' && cfgJson.video.title.trim()) {
              videoIdentity.title = cfgJson.video.title.trim();
            }
            if (typeof cfgJson?.video?.duration === 'number' && cfgJson.video.duration > 0) {
              videoIdentity.durationSec = cfgJson.video.duration;
            }
            if (typeof cfgJson?.video?.owner?.name === 'string' && cfgJson.video.owner.name.trim()) {
              videoIdentity.authorOrRightsHolder = cfgJson.video.owner.name.trim();
              videoIdentity.rightsHolderOrAuthor = cfgJson.video.owner.name.trim();
            }

            const progressiveList = Array.isArray(cfgJson?.request?.files?.progressive)
              ? cfgJson.request.files.progressive
              : [];
            const validProgressive = progressiveList
              .filter((p: any) => typeof p?.url === 'string' && p.url.startsWith('http'))
              .sort((a: any, b: any) => (Number(a.height) || 720) - (Number(b.height) || 720));

            if (validProgressive.length > 0) {
              for (const prog of validProgressive) {
                addCandidate(prog.url);
              }
              videoIdentity.mediaFormat = 'MP4';
              acquisitionMethod = 'VIMEO_PROGRESSIVE_MP4_DOWNLOAD';
              attemptedMethods.push({
                method: 'VIMEO_PROGRESSIVE_MP4_DOWNLOAD',
                status: 'SUCCESS',
                detail: `Resolved ${validProgressive.length} progressive MP4 stream(s) from Vimeo player config API.`,
                timestamp: new Date().toISOString()
              });
            } else {
              // Check HLS cdns in Vimeo player config
              const hlsCdns = cfgJson?.request?.files?.hls?.cdns || {};
              const hlsUrls: string[] = [];
              for (const cdnKey of Object.keys(hlsCdns)) {
                const u = hlsCdns[cdnKey]?.url || hlsCdns[cdnKey]?.avc_url;
                if (typeof u === 'string' && u.startsWith('http')) {
                  hlsUrls.push(u);
                }
              }

              const unencryptedHlsUrls = hlsUrls.filter(u => !/\/drm\/(?:cbcs|cenc)/i.test(u));
              if (unencryptedHlsUrls.length > 0) {
                for (const u of unencryptedHlsUrls) {
                  addCandidate(u);
                }
                videoIdentity.mediaFormat = 'HLS_M3U8';
                acquisitionMethod = 'VIMEO_UNENCRYPTED_HLS_STREAM';
                attemptedMethods.push({
                  method: 'VIMEO_UNENCRYPTED_HLS_STREAM',
                  status: 'SUCCESS',
                  detail: `Resolved unencrypted HLS (.m3u8) stream from Vimeo player config API.`,
                  timestamp: new Date().toISOString()
                });
              } else if (hlsUrls.length > 0) {
                hasExplicitPlatformDrm = true;
                const drmReason =
                  `Vimeo player config API (video ${vimeoId}) was inspected: progressive MP4 downloads are disabled by the video owner (progressive: []), and the adaptive HLS/DASH manifests use FairPlay CBCS (SAMPLE-AES skd://drm) / Widevine CENC DRM encryption. Direct stream extraction is prohibited without bypassing DRM; upload an authorized master file or provide an approved download link.`;
                platformDiagnosticReason = drmReason;
                attemptedMethods.push({
                  method: 'VIMEO_PROGRESSIVE_MP4_DOWNLOAD',
                  status: 'UNAVAILABLE',
                  detail: 'Vimeo player config returned progressive=[] (progressive MP4 download disabled for this video).',
                  timestamp: new Date().toISOString()
                });
                attemptedMethods.push({
                  method: 'VIMEO_UNENCRYPTED_HLS_STREAM',
                  status: 'RESTRICTED',
                  detail: 'Vimeo adaptive HLS/DASH streams use FairPlay CBCS (#EXT-X-KEY:METHOD=SAMPLE-AES, KEYFORMAT="com.apple.streamingkeydelivery") / Widevine CENC DRM.',
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch {}
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. PUBLIC VIDEO PLATFORMS: Internet Archive (archive.org), Wikimedia Commons, Wistia
  // ---------------------------------------------------------------------------
  const archiveIdMatch =
    finalUrl.match(/archive\.org\/(?:details|download|embed)\/([^/?#]+)/i) ||
    submittedUrl.match(/archive\.org\/(?:details|download|embed)\/([^/?#]+)/i);
  if (archiveIdMatch) {
    const archiveId = archiveIdMatch[1];
    videoIdentity.platform = 'Internet Archive';
    videoIdentity.videoId = archiveId;
    videoIdentity.platformVideoId = archiveId;

    if (additionalDirectCandidates.length === 0 || !videoIdentity.durationSec) {
      const isLiveArchive = finalDomain.includes('archive.org');
      const metaApiUrl = isLiveArchive
        ? `https://archive.org/metadata/${encodeURIComponent(archiveId)}`
        : `${parsedOrigin}/metadata/${encodeURIComponent(archiveId)}`;
      const archRes = await fetchHelper(metaApiUrl, 6000);
      if (archRes && archRes.ok && archRes.text) {
        try {
          const archJson: any = JSON.parse(archRes.text);
          const meta = archJson?.metadata || {};
          if (typeof meta?.title === 'string' && meta.title.trim()) {
            videoIdentity.title = meta.title.trim();
          }
          const creator = Array.isArray(meta?.creator) ? meta.creator[0] : meta?.creator;
          if (typeof creator === 'string' && creator.trim()) {
            videoIdentity.authorOrRightsHolder = creator.trim();
            videoIdentity.rightsHolderOrAuthor = creator.trim();
          }
          if (meta?.runtime && !videoIdentity.durationSec) {
            videoIdentity.durationSec = parseIso8601DurationSec(meta.runtime);
          }

          const files: any[] = Array.isArray(archJson?.files) ? archJson.files : [];
          const videoFiles = files
            .filter(
              f =>
                typeof f?.name === 'string' &&
                /\.(mp4|webm|ogv|mkv|mov)$/i.test(f.name) &&
                !f.name.includes('_thumbs')
            )
            .sort((a, b) => {
              // Prefer .mp4 over other formats, and smaller derivative (.ia.mp4 / 512kb) first for fast reliable ingestion
              const aIsMp4 = /\.mp4$/i.test(a.name) ? 0 : 1;
              const bIsMp4 = /\.mp4$/i.test(b.name) ? 0 : 1;
              if (aIsMp4 !== bIsMp4) return aIsMp4 - bIsMp4;
              const aSize = parseInt(String(a.size || '999999999'), 10) || 999999999;
              const bSize = parseInt(String(b.size || '999999999'), 10) || 999999999;
              return aSize - bSize;
            });

          if (videoFiles.length > 0) {
            const downloadBase = isLiveArchive ? 'https://archive.org' : parsedOrigin;
            for (const vf of videoFiles.slice(0, 3)) {
              const dlUrl = `${downloadBase}/download/${encodeURIComponent(archiveId)}/${ vf.name.split('/').map(encodeURIComponent).join('/') }`;
              addCandidate(dlUrl);
              if (!videoIdentity.durationSec && vf.length) {
                videoIdentity.durationSec = parseIso8601DurationSec(vf.length);
              }
            }
            const ext = videoFiles[0].name.match(/\.(mp4|webm|ogv|mkv|mov)$/i)?.[1]?.toUpperCase() || 'MP4';
            videoIdentity.mediaFormat = ext;
            acquisitionMethod = 'ARCHIVE_ORG_DIRECT_DOWNLOAD';
            attemptedMethods.push({
              method: 'ARCHIVE_ORG_DIRECT_DOWNLOAD',
              status: 'SUCCESS',
              detail: `Resolved ${videoFiles.length} open-archive video file(s) via Internet Archive Metadata API (/metadata/${archiveId}: ${videoFiles[0].name}).`,
              timestamp: new Date().toISOString()
            });
          }
        } catch {}
      }
    }
  }

  // Wikimedia Commons File Page Resolution
  const wikiMatch =
    finalUrl.match(/commons\.wikimedia\.org\/wiki\/(File:[^/?#]+)/i) ||
    submittedUrl.match(/commons\.wikimedia\.org\/wiki\/(File:[^/?#]+)/i);
  if (wikiMatch) {
    const rawFileTitle = decodeURIComponent(wikiMatch[1]);
    videoIdentity.platform = 'Wikimedia Commons';
    videoIdentity.videoId = rawFileTitle;
    videoIdentity.platformVideoId = rawFileTitle;
    if (!videoIdentity.authorOrRightsHolder) {
      videoIdentity.authorOrRightsHolder = 'Wikimedia Commons';
      videoIdentity.rightsHolderOrAuthor = 'Wikimedia Commons';
    }

    const isLiveWikimedia = finalDomain.includes('wikimedia.org');
    const wikiApiBase = isLiveWikimedia ? 'https://commons.wikimedia.org' : parsedOrigin;
    const wikiApiUrl = `${wikiApiBase}/w/api.php?action=query&titles=${encodeURIComponent(rawFileTitle)}&prop=imageinfo&iiprop=url|size|mime|mediatype&format=json`;
    const wikiRes = await fetchHelper(wikiApiUrl, 6000);
    if (wikiRes && wikiRes.ok && wikiRes.text) {
      try {
        const wikiJson: any = JSON.parse(wikiRes.text);
        const pages = Object.values(wikiJson?.query?.pages || {}) as any[];
        const page = pages[0];
        const info = page?.imageinfo?.[0];
        if (info?.url && typeof info.url === 'string') {
          const cleanMediaUrl = info.url.includes('upload.wikimedia.org')
            ? info.url.split('?')[0]
            : info.url;
          addCandidate(cleanMediaUrl);
          if (typeof page?.title === 'string') {
            videoIdentity.title = page.title.replace(/^File:/i, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
          }
          if (typeof info?.duration === 'number' && info.duration > 0) {
            videoIdentity.durationSec = Math.round(info.duration * 100) / 100;
          }
          const ext = cleanMediaUrl.match(/\.(webm|ogv|ogg|mp4|mov)/i)?.[1]?.toUpperCase() || 'WEBM';
          videoIdentity.mediaFormat = ext;
          acquisitionMethod = 'WIKIMEDIA_COMMONS_IMAGEINFO_API';
          attemptedMethods.push({
            method: 'WIKIMEDIA_COMMONS_IMAGEINFO_API',
            status: 'SUCCESS',
            detail: `Resolved direct media stream (${cleanMediaUrl}) and duration (${videoIdentity.durationSec || 0}s) via Wikimedia Commons MediaWiki API.`,
            timestamp: new Date().toISOString()
          });
        }
      } catch {}
    }
  }

  return {
    videoIdentity,
    additionalDirectCandidates,
    acquisitionMethod,
    attemptedMethods,
    hasExplicitPlatformDrm,
    isExplicitlyUnavailable,
    platformDiagnosticReason
  };
}

/**
 * Builds the standardized 8-stage workflow report:
 * URL_SUBMITTED → SOURCE_IDENTIFIED → VIDEO_INSPECTED → MEDIA_ACQUIRED → MEDIA_VALIDATED → FRAME_EXTRACTION → FINGERPRINTING → COMPLETE
 */
export function buildAcquisitionWorkflowReport(params: {
  inspection?: ReferenceUrlInspectionResult | null;
  submittedUrl?: string;
  localFileUpload?: boolean;
  mediaAcquired?: boolean;
  mediaValidated?: boolean;
  probe?: { duration_sec: number; width: number; height: number; fps: number; codec: string };
  framesExtractedCount?: number;
  extractedFrames?: number;
  expectedFrameCount?: number;
  expectedFrames?: number;
  fingerprintsPersistedCount?: number;
  verifiedImages?: number;
  isComplete?: boolean;
  resumedFromBytes?: number;
  reusedCachedMedia?: boolean;
  deduplicatedExistingReferenceId?: string;
  errorReason?: string;
  inspectionOnly?: boolean;
  attemptedMethods?: AttemptedAcquisitionMethod[];
}): AcquisitionWorkflowReport {
  const now = new Date().toISOString();
  const fallbackSubmittedUrl = params.submittedUrl || (params.localFileUpload ? 'local://master-file-upload' : '');
  const effInspection: ReferenceUrlInspectionResult = params.inspection || {
    submittedUrl: fallbackSubmittedUrl,
    finalUrl: fallbackSubmittedUrl,
    finalDomain: params.localFileUpload ? 'local-upload' : '',
    urlClassification: params.localFileUpload ? 'DIRECT_MEDIA_URL' : 'DRM_PROTECTED_WEBPAGE',
    isWebpage: !params.localFileUpload,
    directMediaAvailable: Boolean(params.localFileUpload || params.mediaAcquired),
    acquisitionStatus: params.localFileUpload
      ? 'LOCAL_MASTER_UPLOAD'
      : params.mediaAcquired
      ? 'AUTHORIZED_MEDIA_ACQUIRED'
      : 'AWAITING_AUTHORIZED_MEDIA',
    canAcquireAuthorized: Boolean(params.localFileUpload || params.mediaAcquired),
    reason:
      params.errorReason ||
      (params.localFileUpload
        ? 'Authorized master video file uploaded directly.'
        : 'Protected OTT or embedded-player webpage requires an authorized master video file or partner feed for frame extraction.'),
    checkedAt: now
  };

  const adapter =
    effInspection.sourceAdapter ||
    identifySourceAdapterForUrl({
      submittedUrl: effInspection.submittedUrl,
      finalUrl: effInspection.finalUrl,
      contentType: effInspection.mediaContentType,
      detectedPlatform: effInspection.platform,
      isOttProtected: !params.localFileUpload && !effInspection.canAcquireAuthorized && Boolean(effInspection.platform)
    }).adapter;

  const extracted = params.framesExtractedCount ?? params.extractedFrames ?? 0;
  const expected = params.expectedFrameCount ?? params.expectedFrames ?? 0;
  const persisted = params.fingerprintsPersistedCount ?? params.verifiedImages ?? extracted;
  const isWorkflowComplete = Boolean(
    params.isComplete !== undefined
      ? params.isComplete && persisted > 0 && persisted >= expected
      : params.mediaAcquired && params.mediaValidated && persisted > 0 && persisted >= expected
  );

  const videoIdentity: ResolvedVideoIdentity = {
    ...(effInspection.videoIdentity || {}),
    title: effInspection.videoIdentity?.title || effInspection.pageTitle,
    platform:
      effInspection.videoIdentity?.platform ||
      effInspection.platform ||
      effInspection.detectedPlayerProvider ||
      adapter.platforms[0],
    durationSec: params.probe?.duration_sec || effInspection.durationSec || effInspection.videoIdentity?.durationSec,
    mediaFormat:
      params.probe?.codec ||
      effInspection.mediaFormat ||
      effInspection.videoIdentity?.mediaFormat ||
      (effInspection.mediaContentType ? effInspection.mediaContentType.split(';')[0] : undefined),
    resolution: params.probe ? `${params.probe.width}x${params.probe.height}` : effInspection.videoIdentity?.resolution,
    codec: params.probe?.codec || effInspection.videoIdentity?.codec,
    seasonEpisodeInfo: effInspection.seasonEpisodeInfo || effInspection.videoIdentity?.seasonEpisodeInfo,
    seasonEpisode: effInspection.seasonEpisodeInfo || effInspection.videoIdentity?.seasonEpisode
  };

  const isUnreachableOrRejected =
    effInspection.urlClassification === 'UNREACHABLE' ||
    effInspection.urlClassification === 'SSRF_REJECTED' ||
    effInspection.urlClassification === 'TORRENT_OR_UNSUPPORTED';

  const canAutoAcquire = Boolean(effInspection.canAcquireAuthorized || params.localFileUpload || params.mediaAcquired);

  const stages: AcquisitionWorkflowStage[] = [];

  // Stage 1: URL SUBMITTED
  stages.push({
    stage: 'URL_SUBMITTED',
    label: 'URL SUBMITTED',
    status: 'COMPLETE',
    detail: params.localFileUpload
      ? 'Authorized master video file submitted'
      : `Submitted URL: ${effInspection.submittedUrl}`,
    timestamp: effInspection.checkedAt || now
  });

  // Stage 2: SOURCE IDENTIFIED
  stages.push({
    stage: 'SOURCE_IDENTIFIED',
    label: 'SOURCE IDENTIFIED',
    status: isUnreachableOrRejected && effInspection.urlClassification === 'SSRF_REJECTED' ? 'FAILED' : 'COMPLETE',
    detail: `${adapter.name} (${videoIdentity.platform || adapter.category}${videoIdentity.videoId ? ` • ID: ${videoIdentity.videoId}` : ''})`,
    timestamp: effInspection.checkedAt || now
  });

  // Stage 3: VIDEO INSPECTED
  if (isUnreachableOrRejected && !params.mediaAcquired) {
    stages.push({
      stage: 'VIDEO_INSPECTED',
      label: 'VIDEO INSPECTED',
      status: 'FAILED',
      detail: effInspection.reason,
      timestamp: now
    });
  } else {
    stages.push({
      stage: 'VIDEO_INSPECTED',
      label: 'VIDEO INSPECTED',
      status: 'COMPLETE',
      detail: canAutoAcquire
        ? `Authorized media source resolved (${effInspection.resolvedMediaUrl || effInspection.finalUrl})`
        : `Inspected webpage metadata (${effInspection.urlClassification}): ${effInspection.reason}`,
      timestamp: now
    });
  }

  // Stage 4: MEDIA ACQUIRED
  if (params.mediaAcquired) {
    const resumeNote =
      params.resumedFromBytes && params.resumedFromBytes > 0
        ? ` (resumed from ${params.resumedFromBytes} bytes)`
        : params.reusedCachedMedia
        ? ' (verified duplicate cache hit)'
        : '';
    stages.push({
      stage: 'MEDIA_ACQUIRED',
      label: 'MEDIA ACQUIRED',
      status: 'COMPLETE',
      detail: `Video acquired via ${effInspection.acquisitionMethod || adapter.supportedMethods[0] || 'authorized stream'}${resumeNote}`,
      timestamp: now
    });
  } else if (params.inspectionOnly) {
    stages.push({
      stage: 'MEDIA_ACQUIRED',
      label: 'MEDIA ACQUIRED',
      status: canAutoAcquire ? 'PENDING' : 'SKIPPED_RESTRICTED',
      detail: canAutoAcquire
        ? 'Ready for automatic server-side media acquisition upon submission.'
        : effInspection.reason,
      timestamp: now
    });
  } else if (!canAutoAcquire) {
    stages.push({
      stage: 'MEDIA_ACQUIRED',
      label: 'MEDIA ACQUIRED',
      status: isUnreachableOrRejected ? 'FAILED' : 'SKIPPED_RESTRICTED',
      detail: params.errorReason || effInspection.reason,
      timestamp: now
    });
  } else {
    stages.push({
      stage: 'MEDIA_ACQUIRED',
      label: 'MEDIA ACQUIRED',
      status: 'FAILED',
      detail: params.errorReason || 'Failed to download or acquire media stream.',
      timestamp: now
    });
  }

  // Stage 5: MEDIA VALIDATED
  if (params.mediaValidated) {
    stages.push({
      stage: 'MEDIA_VALIDATED',
      label: 'MEDIA VALIDATED',
      status: 'COMPLETE',
      detail: params.probe
        ? `FFprobe verified: ${params.probe.duration_sec.toFixed(2)}s • ${params.probe.width}x${params.probe.height} • ${params.probe.codec} @ ${params.probe.fps} fps`
        : 'FFprobe container & stream validation complete.',
      timestamp: now
    });
  } else {
    stages.push({
      stage: 'MEDIA_VALIDATED',
      label: 'MEDIA VALIDATED',
      status: params.mediaAcquired && !params.mediaValidated ? 'FAILED' : !canAutoAcquire ? 'SKIPPED_RESTRICTED' : 'PENDING',
      detail:
        params.mediaAcquired && !params.mediaValidated
          ? params.errorReason || 'FFprobe container validation failed.'
          : 'Awaiting acquired video container for FFprobe stream & duration verification.',
      timestamp: now
    });
  }

  // Stage 6: FRAME EXTRACTION
  if (extracted > 0) {
    stages.push({
      stage: 'FRAME_EXTRACTION',
      label: 'FRAME EXTRACTION',
      status: expected > 0 && extracted < expected ? 'IN_PROGRESS' : 'COMPLETE',
      detail: `Decoded ${extracted}/${expected || extracted} keyframes across full video duration (0.00s to end) via FFmpeg`,
      timestamp: now
    });
  } else {
    stages.push({
      stage: 'FRAME_EXTRACTION',
      label: 'FRAME EXTRACTION',
      status: !canAutoAcquire ? 'SKIPPED_RESTRICTED' : 'PENDING',
      detail: 'Awaiting validated media for full-duration FFmpeg frame decoding.',
      timestamp: now
    });
  }

  // Stage 7: FINGERPRINTING
  if (persisted > 0) {
    stages.push({
      stage: 'FINGERPRINTING',
      label: 'FINGERPRINTING',
      status: expected > 0 && persisted < expected ? 'IN_PROGRESS' : 'COMPLETE',
      detail: `Verified ${persisted}/${expected || persisted} JPEG frame images on disk + SQLite and computed 64-bit dHash/vHash/cropHash`,
      timestamp: now
    });
  } else {
    stages.push({
      stage: 'FINGERPRINTING',
      label: 'FINGERPRINTING',
      status: !canAutoAcquire ? 'SKIPPED_RESTRICTED' : 'PENDING',
      detail: 'Awaiting extracted frames for JPEG verification and 64-bit dHash indexing.',
      timestamp: now
    });
  }

  // Stage 8: COMPLETE
  if (isWorkflowComplete) {
    stages.push({
      stage: 'COMPLETE',
      label: 'COMPLETE',
      status: 'COMPLETE',
      detail: `Reference FINGERPRINTED with ${persisted}/${expected || persisted} verified JPEG frames and 64-bit dHashes.`,
      timestamp: now
    });
  } else {
    stages.push({
      stage: 'COMPLETE',
      label: 'COMPLETE',
      status: !canAutoAcquire ? 'SKIPPED_RESTRICTED' : 'PENDING',
      detail: !canAutoAcquire
        ? 'Reference registered as metadata-only (AWAITING_AUTHORIZED_MEDIA) until an authorized video file or feed is supplied.'
        : 'Completes only after all expected frames, JPEGs, and fingerprints are verified.',
      timestamp: now
    });
  }

  let currentStage: AcquisitionWorkflowStageName = 'VIDEO_INSPECTED';
  let overallStatus: AcquisitionWorkflowReport['overallStatus'] = 'INSPECTED_READY';

  if (isWorkflowComplete) {
    currentStage = 'COMPLETE';
    overallStatus = 'COMPLETE';
  } else if (persisted > 0 || extracted > 0) {
    currentStage = 'FINGERPRINTING';
    overallStatus = 'PARTIAL';
  } else if (params.mediaValidated) {
    currentStage = 'MEDIA_VALIDATED';
    overallStatus = 'PARTIAL';
  } else if (params.mediaAcquired) {
    currentStage = 'MEDIA_ACQUIRED';
    overallStatus = 'FAILED';
  } else if (isUnreachableOrRejected) {
    currentStage = 'VIDEO_INSPECTED';
    overallStatus = 'FAILED';
  } else if (!canAutoAcquire) {
    currentStage = 'VIDEO_INSPECTED';
    overallStatus = 'AWAITING_AUTHORIZATION';
  }

  const restrictionReason = !canAutoAcquire
    ? params.errorReason || effInspection.reason
    : undefined;
  const recommendedAlternative = !canAutoAcquire
    ? `${adapter.fallbackGuidance} Upload an authorized master file (.mp4/.mkv/.mov) or provide an approved partner mezzanine URL.`
    : undefined;

  const alternativeAction = !canAutoAcquire
    ? {
        reason: restrictionReason || effInspection.reason,
        recommendedActions: [
          adapter.fallbackGuidance,
          'Upload an authorized reference master video file (.mp4, .mkv, .mov, .webm) directly via Master File Upload.',
          'Provide an approved unencrypted partner mezzanine or pre-signed stream URL (.mp4 or .m3u8).'
        ]
      }
    : undefined;

  return {
    currentStage,
    overallStatus,
    adapter,
    sourceAdapterName: adapter.name,
    canAutoAcquire,
    restrictionReason,
    recommendedAlternative,
    videoIdentity,
    acquisitionMethod: effInspection.acquisitionMethod || adapter.supportedMethods[0],
    attemptedMethods: effInspection.attemptedMethods,
    resumedFromBytes: params.resumedFromBytes,
    reusedCachedMedia: params.reusedCachedMedia,
    deduplicatedExistingReferenceId: params.deduplicatedExistingReferenceId,
    stages,
    alternativeAction
  };
}

