/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Deep Candidate Research, Multi-Content Identity Resolution & Target Relevance Ranking Engine
 *
 * Evaluates candidates against the COMPLETE registered reference target across all content types:
 * - Episodic TV / Series (series title, season, episode number, episode title, naming aliases)
 * - Movies / VOD Features (title, release year, edition, full feature vs trailer/clip)
 * - Live Sports (participating teams, fixture/match number, competition/tournament, live/replay)
 * - Music Videos (artist/creator, track title, official video vs cover/remix/different song)
 * - General Video Assets
 *
 * Strictly separates Research Relevance Score (target identity correlation) from
 * Forensic Match Confidence (perceptual frame/audio comparison).
 */

import path from 'node:path';
import {
  CandidateDetectedIdentity,
  CandidateItem,
  CandidateResearchEvaluation,
  IdentityRelationship,
  ReferenceItem
} from '../types.js';

export interface ReferenceTargetIdentity {
  referenceId?: string;
  contentType: 'EPISODIC' | 'MOVIE' | 'LIVE_SPORTS' | 'MUSIC_VIDEO' | 'GENERAL';
  rawTitle: string;
  primaryTitle: string;
  normalizedPrimaryTitle: string;
  subTitleOrEpisodeTitle?: string;
  normalizedSubTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeCode?: string;
  episodeAliases: string[];
  artistOrCreator?: string;
  trackTitle?: string;
  participants: string[];
  fixtureOrFormat?: string;
  competition?: string;
  releaseYear?: number;
  rightsHolder?: string;
  platform?: string;
  coreTitleTokens: string[];
  subTitleTokens: string[];
  alternateTitles: string[];
  identitySummary: string;
}

interface WebpageResearchMetadata {
  fetchedAt: number;
  pageTitle?: string;
  ogTitle?: string;
  description?: string;
  canonicalUrl?: string;
  jsonLdTitle?: string;
  jsonLdSeriesName?: string;
  jsonLdSeasonNumber?: number;
  jsonLdEpisodeNumber?: number;
  jsonLdReleaseYear?: number;
  breadcrumbText?: string;
  discoveredIdentifiers: string[];
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'live', 'stream', 'streaming',
  'video', 'full', 'watch', 'online', 'free', 'official', 'youtube', 'mp4', 'm3u8',
  'webm', 'mkv', 'hd', '4k', '1080p', '720p', '480p', '2160p', 'web', 'dl', 'webrip',
  'bluray', 'hdtv', 'x264', 'x265', 'hevc', 'aac', 'download', 'index', 'html', 'php',
  'com', 'org', 'net', 'tv', 'episode', 'season', 'series', 'movie', 'music', 'clip',
  'o2tvseries', 'o2tvseries4u', 'upl'
]);

const GENERIC_CLIP_OR_NOISE_PATTERNS = [
  /\b(interview|cast\s+interview|behind\s+the\s+scenes|bloopers|gag\s+reel|outtakes)\b/i,
  /\b(funny\s+moments|best\s+moments|top\s+\d+|compilation|montage|mashup|fan\s+edit)\b/i,
  /\b(reaction|review|explained|ending\s+explained|breakdown|recap|promo|teaser|preview|trailer)\b/i,
  /\b(shorts|tiktok|reels|soundtrack|lyrics|lyric\s+video|karaoke|instrumental|cover)\b/i
];

const SPORTS_TEAMS_DICTIONARY: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'India', aliases: ['india', 'ind', 'bcci', 'team india'] },
  { canonical: 'New Zealand', aliases: ['new zealand', 'nz', 'blackcaps', 'kiwis'] },
  { canonical: 'Australia', aliases: ['australia', 'aus'] },
  { canonical: 'England', aliases: ['england', 'eng'] },
  { canonical: 'Pakistan', aliases: ['pakistan', 'pak'] },
  { canonical: 'South Africa', aliases: ['south africa', 'sa', 'rsa', 'proteas'] },
  { canonical: 'Sri Lanka', aliases: ['sri lanka', 'sl'] },
  { canonical: 'West Indies', aliases: ['west indies', 'wi', 'windies'] },
  { canonical: 'Arsenal FC', aliases: ['arsenal', 'ars', 'arsenal fc'] },
  { canonical: 'FC Bayern Munich', aliases: ['bayern', 'bayern munich', 'fcb', 'munchen', 'fc bayern'] },
  { canonical: 'Real Madrid', aliases: ['real madrid', 'rma'] },
  { canonical: 'Barcelona', aliases: ['barcelona', 'barca'] },
  { canonical: 'Manchester City', aliases: ['manchester city', 'man city', 'mci'] },
  { canonical: 'Liverpool', aliases: ['liverpool', 'liv', 'lfc'] },
  { canonical: 'Manchester United', aliases: ['manchester united', 'man utd', 'mun'] },
  { canonical: 'Chelsea', aliases: ['chelsea', 'che'] }
];

export class CandidateResearchEngine {
  private static webpageCache = new Map<string, WebpageResearchMetadata>();
  private static readonly MAX_CACHE_ENTRIES = 250;
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000;
  private static lastFetchTimestampMs = 0;
  private static readonly MIN_FETCH_INTERVAL_MS = 75;

  private static readonly GENERIC_PLATFORM_TEST_VIDEOS: Array<{
    label: string;
    patterns: RegExp[];
    targetAllowRegex: RegExp;
  }> = [
    {
      label: 'YouTube generic test video ("Me at the zoo" / jNQXAC9IVRw)',
      patterns: [/\bme\s+at\s+the\s+zoo\b/i, /\bjnqxac9ivrw\b/i],
      targetAllowRegex: /\bme\s+at\s+the\s+zoo\b|\bjnqxac9ivrw\b/i
    },
    {
      label: 'Vimeo generic demo video ("The New Vimeo Player" / vimeo.com/76979871)',
      patterns: [/\bthe\s+new\s+vimeo\s+player\b/i, /vimeo\.com\/76979871\b/i],
      targetAllowRegex: /\bthe\s+new\s+vimeo\s+player\b|\b76979871\b/i
    },
    {
      label: 'Wikimedia Commons generic sample clip ("Cat lapping water off ground in slow motion")',
      patterns: [/\bcat[\s_]+lapping[\s_]+water[\s_]+off[\s_]+ground\b/i],
      targetAllowRegex: /\bcat[\s_]+lapping[\s_]+water\b/i
    },
    {
      label: 'Internet Archive generic test clip ("point-opinion : Center for Accessible Technology in Sign")',
      patterns: [/\bpoint-opinionasl\b/i, /\bcenter\s+for\s+accessible\s+technology\s+in\s+sign\b/i],
      targetAllowRegex: /\bpoint-opinion\b|\baccessible\s+technology\s+in\s+sign\b/i
    },
    {
      label: 'Dailymotion unrelated news clip ("Zelenskyy Calls for European Involvement" / xbs9dle)',
      patterns: [/dailymotion\.com\/video\/xbs9dle\b/i, /\bzelenskyy\s+calls\s+for\s+european\s+involvement\b/i],
      targetAllowRegex: /\bzelenskyy\b|\bxbs9dle\b/i
    },
    {
      label: 'Open-source generic test video ("Big Buck Bunny" / "Tears of Steel" / "Elephants Dream")',
      patterns: [
        /\bbig[\s_]+buck[\s_]+bunny\b/i,
        /\btears[\s_]+of[\s_]+steel\b/i,
        /\belephants[\s_]+dream\b/i,
        /\bforbigger(?:blazes|escapes|fun|joyrides|meltdowns)\b/i
      ],
      targetAllowRegex: /\bbig\s+buck\s+bunny\b|\btears\s+of\s+steel\b|\belephants\s+dream\b|\bforbigger/i
    }
  ];

  /**
   * Detects generic platform test/sample videos ("Me at the zoo", "The New Vimeo Player",
   * Wikimedia cat sample, Internet Archive sign-language test clip, Big Buck Bunny, etc.)
   * so they are rejected when evaluating candidates for an unrelated investigation target.
   */
  public static isGenericPlatformTestVideo(
    candidateTitleAndUrl: string,
    targetReferenceTitleOrQuery?: string
  ): { isGenericTest: boolean; matchedFixture?: string; reason?: string } {
    if (!candidateTitleAndUrl) return { isGenericTest: false };
    const targetText = (targetReferenceTitleOrQuery || '').trim();
    for (const entry of this.GENERIC_PLATFORM_TEST_VIDEOS) {
      if (entry.patterns.some(rx => rx.test(candidateTitleAndUrl))) {
        if (targetText && entry.targetAllowRegex.test(targetText)) {
          return { isGenericTest: false };
        }
        return {
          isGenericTest: true,
          matchedFixture: entry.label,
          reason: `Rejected generic platform test/sample video (${entry.label}) with no relationship to target investigation "${targetText || 'Registered Target'}".`
        };
      }
    }
    return { isGenericTest: false };
  }

  /**
   * Extracts season and episode numbers from any title, URL, filename, or metadata text.
   * Supports S01E01, S1E1, S01.E01, Season 1 Episode 1, Season-01/Episode-01, 1x01, Ep 1, etc.
   */
  public static extractSeasonEpisode(text: string): {
    seasonNumber?: number;
    episodeNumber?: number;
    episodeCode?: string;
    matchedRaw?: string;
  } {
    if (!text) return {};
    const decoded = (() => {
      try {
        return decodeURIComponent(text);
      } catch {
        return text;
      }
    })();

    // 1. Standard S01E01 / S1E1 / S01.E01 / S01_E01 / S01-E01 / S01 E01
    const seCompact = decoded.match(/\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i);
    if (seCompact) {
      const s = parseInt(seCompact[1], 10);
      const e = parseInt(seCompact[2], 10);
      if (s > 0 && s <= 60 && e >= 0 && e <= 500) {
        return {
          seasonNumber: s,
          episodeNumber: e,
          episodeCode: `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`,
          matchedRaw: seCompact[0]
        };
      }
    }

    // 2. URL path or verbose Season-01/Episode-01 or Season 1 Episode 1
    const sePathOrVerbose = decoded.match(/\bSeason[\s._/-]*(\d{1,2})(?:[\s._/|,-]+|\/index\.html\s*)Episode[\s._/-]*(\d{1,3})\b/i);
    if (sePathOrVerbose) {
      const s = parseInt(sePathOrVerbose[1], 10);
      const e = parseInt(sePathOrVerbose[2], 10);
      if (s > 0 && s <= 60 && e >= 0 && e <= 500) {
        return {
          seasonNumber: s,
          episodeNumber: e,
          episodeCode: `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`,
          matchedRaw: sePathOrVerbose[0]
        };
      }
    }

    // 3. 1x01 / 01x01 convention (avoiding resolutions like 1920x1080 or 320x180)
    const xMatch = decoded.match(/\b(\d{1,2})x(\d{2,3})\b/i);
    if (xMatch) {
      const s = parseInt(xMatch[1], 10);
      const e = parseInt(xMatch[2], 10);
      if (s > 0 && s <= 35 && e > 0 && e <= 99 && s !== 16 && e !== 9) {
        return {
          seasonNumber: s,
          episodeNumber: e,
          episodeCode: `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`,
          matchedRaw: xMatch[0]
        };
      }
    }

    // 4. Separate Season X and Episode Y anywhere in the same string
    const sOnly = decoded.match(/\bSeason[\s._/-]*(\d{1,2})\b/i) || decoded.match(/\bS(\d{1,2})\b(?!\s*E\d)/i);
    const eOnly =
      decoded.match(/\bEpisode[\s._/-]*(\d{1,3})\b/i) ||
      decoded.match(/\bEp\.?[\s._-]*(\d{1,3})\b/i) ||
      decoded.match(/\bE(\d{2,3})\b/i);

    const seasonNumber = sOnly ? parseInt(sOnly[1], 10) : undefined;
    const episodeNumber = eOnly ? parseInt(eOnly[1], 10) : undefined;

    if (seasonNumber !== undefined && episodeNumber !== undefined && seasonNumber > 0 && seasonNumber <= 60 && episodeNumber <= 500) {
      return {
        seasonNumber,
        episodeNumber,
        episodeCode: `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
      };
    }

    return {
      seasonNumber: seasonNumber && seasonNumber > 0 && seasonNumber <= 60 ? seasonNumber : undefined,
      episodeNumber: episodeNumber !== undefined && episodeNumber >= 0 && episodeNumber <= 500 ? episodeNumber : undefined
    };
  }

  /**
   * Normalizes a title phrase for clean comparison (stripping upload prefixes, file extensions, S01E01 tags, domain tags).
   */
  public static cleanWorkTitlePhrase(raw: string): string {
    if (!raw) return '';
    let cleaned = raw
      // Strip upload hash prefix like upl_1793160894057_fddb48ae-
      .replace(/\bupl_\d+_[a-f0-9]+[-_]/gi, ' ')
      // Strip file extensions
      .replace(/\.(mp4|mkv|mov|webm|avi|m3u8|mpd|html|php|jpg|png)\b/gi, ' ')
      // Strip domain watermarks like (O2TvSeries.Com) or [O2TvSeries4u.com]
      .replace(/[\[(]?\b(?:o2tvseries(?:4u)?|hdmp4mania|netnaija|fzmovies|yts|rarbg)(?:\.[a-z]{2,4})?\b[\])]?/gi, ' ')
      // Strip season/episode codes
      .replace(/\bS\d{1,2}[\s._-]*E\d{1,3}\b/gi, ' ')
      .replace(/\bSeason[\s._/-]*\d{1,2}(?:[\s._/-]*Episode[\s._/-]*\d{1,3})?\b/gi, ' ')
      .replace(/\bEpisode[\s._/-]*\d{1,3}\b/gi, ' ')
      .replace(/\b\d{1,2}x\d{2,3}\b/gi, ' ')
      // Strip quality/format tags
      .replace(/\b(official\s+music\s+video|official\s+video|official\s+audio|full\s+episode|full\s+movie|full\s+match|live\s+stream|1080p|720p|480p|2160p|4k|hd|web[-_]?dl|webrip|bluray|hdtv|x264|x265|hevc|mp4|3gp|download)\b/gi, ' ')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    cleaned = cleaned.replace(/^[-–—:|()[\]\s]+|[-–—:|()[\]\s]+$/g, '').trim();
    return cleaned;
  }

  public static tokenizeMeaningful(text: string): string[] {
    if (!text) return [];
    return Array.from(
      new Set(
        text
          .toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .map(t => t.trim())
          .filter(t => t.length >= 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t))
      )
    );
  }

  private static detectTeams(text: string): string[] {
    const lower = text.toLowerCase();
    const matched: string[] = [];
    for (const entry of SPORTS_TEAMS_DICTIONARY) {
      const found = entry.aliases.some(alias => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(lower);
      });
      if (found) matched.push(entry.canonical);
    }
    return matched;
  }

  private static detectSportsFixture(text: string): string | undefined {
    const patterns = [
      /\b(\d+(?:st|nd|rd|th)\s+t20i?)\b/i,
      /\b(\d+(?:st|nd|rd|th)\s+odi)\b/i,
      /\b(\d+(?:st|nd|rd|th)\s+test)\b/i,
      /\b(quarter[- ]?final|semi[- ]?final|grand\s+final|final)\b/i,
      /\b(matchday\s*\d+|game\s*\d+)\b/i,
      /\b(t20i?|odi)\b/i
    ];
    for (const rx of patterns) {
      const m = text.match(rx);
      if (m && m[1]) {
        return m[1].toUpperCase().replace(/\s+/g, ' ').replace(/\bT20\b/, 'T20I');
      }
    }
    return undefined;
  }

  private static detectCompetition(text: string): string | undefined {
    if (/champions\s+league|\bucl\b/i.test(text)) return 'UEFA Champions League';
    if (/tour\s+of\s+new\s+zealand|ind\s*v(?:s)?\s*nz|india\s*v(?:s)?\s*new\s+zealand/i.test(text)) {
      return 'India vs New Zealand Series';
    }
    if (/\bipl\b|indian\s+premier\s+league/i.test(text)) return 'Indian Premier League';
    if (/world\s+cup/i.test(text)) return 'World Cup';
    if (/premier\s+league|\bepl\b/i.test(text)) return 'Premier League';
    return undefined;
  }

  private static extractReleaseYear(text: string): number | undefined {
    const m = text.match(/\b(19[7-9]\d|20[0-2]\d)\b/);
    if (m) {
      return parseInt(m[1], 10);
    }
    return undefined;
  }

  /**
   * Parses the complete registered reference metadata into a structured ReferenceTargetIdentity.
   */
  public static parseReferenceTargetIdentity(
    reference?:
      | ReferenceItem
      | {
          id?: string;
          title?: string;
          season_episode_info?: string;
          asset_type?: string;
          rights_holder?: string;
          platform?: string;
          notes?: string;
          source_url?: string;
          media_url?: string;
          file_path?: string;
        }
      | null,
    fallbackQuery?: string
  ): ReferenceTargetIdentity & { fixtureLabel?: string } {
    const refObj = reference || { title: fallbackQuery || '' };
    const rawTitle = (refObj.title || fallbackQuery || '').trim();
    const fileBasename = refObj.file_path ? path.basename(refObj.file_path) : '';
    const combinedMetadataText = [
      rawTitle,
      refObj.season_episode_info || '',
      refObj.notes || '',
      refObj.source_url || '',
      refObj.media_url || '',
      fileBasename.replace(/_/g, ' '),
      fallbackQuery || ''
    ]
      .filter(Boolean)
      .join(' ');

    // 1. Check Season / Episode across title, season_episode_info, notes, source_url, and uploaded filename
    const se = this.extractSeasonEpisode(combinedMetadataText);

    // 2. Check Sports Teams / Fixture
    const participants = this.detectTeams(combinedMetadataText);
    const fixtureOrFormat = this.detectSportsFixture(combinedMetadataText);
    const competition = this.detectCompetition(combinedMetadataText);

    // 3. Check Release Year
    const releaseYear = this.extractReleaseYear(`${rawTitle} ${refObj.season_episode_info || ''}`);

    // 4. Split title on —, –, |, or : to identify Artist — Track or Series : Episode Title
    const titleParts = rawTitle
      .split(/\s*(?:—|–|\||:)\s*|\s+-\s+/)
      .map(s => this.cleanWorkTitlePhrase(s))
      .filter(Boolean);

    const isMusicHint =
      /music\s+video|official\s+audio|vevo|records|song|single/i.test(combinedMetadataText) ||
      (refObj.asset_type as string) === 'MUSIC_VIDEO' ||
      (titleParts.length === 2 &&
        !se.seasonNumber &&
        !se.episodeNumber &&
        participants.length === 0 &&
        refObj.asset_type !== 'LIVE_SPORTS' &&
        !/\b(season|episode|feature|release|movie|vs)\b/i.test(rawTitle));

    const isSportsHint =
      refObj.asset_type === 'LIVE_SPORTS' ||
      participants.length >= 2 ||
      /\b(vs\.?|v\.|matchday|t20i?|odi|champions\s+league|world\s+cup)\b/i.test(rawTitle);

    const isEpisodicHint =
      refObj.asset_type === 'EPISODIC' ||
      (refObj.asset_type as string) === 'EPISODIC_TV' ||
      se.seasonNumber !== undefined ||
      se.episodeNumber !== undefined;

    let contentType: ReferenceTargetIdentity['contentType'] = 'GENERAL';
    if (isSportsHint) {
      contentType = 'LIVE_SPORTS';
    } else if (isEpisodicHint) {
      contentType = 'EPISODIC';
    } else if (isMusicHint) {
      contentType = 'MUSIC_VIDEO';
    } else if (refObj.asset_type === 'VOD_FEATURE' || /\b(movie|feature|film)\b/i.test(combinedMetadataText) || releaseYear) {
      contentType = 'MOVIE';
    }

    let primaryTitle = this.cleanWorkTitlePhrase(titleParts[0] || rawTitle) || rawTitle;
    let subTitleOrEpisodeTitle: string | undefined = titleParts.length > 1 ? titleParts.slice(1).join(' ') : undefined;
    let artistOrCreator: string | undefined;
    let trackTitle: string | undefined;

    if (contentType === 'EPISODIC' && se.matchedRaw && rawTitle.toLowerCase().includes(se.matchedRaw.toLowerCase())) {
      const idx = rawTitle.toLowerCase().indexOf(se.matchedRaw.toLowerCase());
      const beforeSe = this.cleanWorkTitlePhrase(rawTitle.slice(0, idx));
      const afterSe = this.cleanWorkTitlePhrase(rawTitle.slice(idx + se.matchedRaw.length));
      if (beforeSe) {
        primaryTitle = beforeSe;
        if (afterSe && !subTitleOrEpisodeTitle) {
          subTitleOrEpisodeTitle = afterSe;
        }
      }
    }

    if (contentType === 'MUSIC_VIDEO' && titleParts.length >= 2) {
      artistOrCreator = titleParts[0];
      trackTitle = titleParts.slice(1).join(' ');
      primaryTitle = artistOrCreator;
      subTitleOrEpisodeTitle = trackTitle;
    } else if (contentType === 'EPISODIC') {
      // Check if season_episode_info has an episode title (e.g. "S01E01 - Pilot" or "Pilot")
      if (!subTitleOrEpisodeTitle && refObj.season_episode_info) {
        const cleanedEpTitle = this.cleanWorkTitlePhrase(refObj.season_episode_info);
        if (cleanedEpTitle && cleanedEpTitle.toLowerCase() !== primaryTitle.toLowerCase()) {
          subTitleOrEpisodeTitle = cleanedEpTitle;
        }
      }
      // For S01E01, "Pilot" is a standard canonical episode title alias if none was explicitly provided
      if (!subTitleOrEpisodeTitle && se.seasonNumber === 1 && se.episodeNumber === 1) {
        subTitleOrEpisodeTitle = 'Pilot';
      }
    }

    const episodeAliases: string[] = [];
    if (se.seasonNumber !== undefined && se.episodeNumber !== undefined) {
      const sPad = String(se.seasonNumber).padStart(2, '0');
      const ePad = String(se.episodeNumber).padStart(2, '0');
      episodeAliases.push(
        `S${sPad}E${ePad}`,
        `S${se.seasonNumber}E${se.episodeNumber}`,
        `${se.seasonNumber}x${ePad}`,
        `Season ${se.seasonNumber} Episode ${se.episodeNumber}`,
        `Season ${sPad} Episode ${ePad}`,
        `Season-${sPad}/Episode-${ePad}`,
        `Season-${se.seasonNumber}/Episode-${se.episodeNumber}`
      );
      if (subTitleOrEpisodeTitle) {
        episodeAliases.push(subTitleOrEpisodeTitle);
      }
    }

    const alternateTitles: string[] = [rawTitle, primaryTitle];
    if (subTitleOrEpisodeTitle) {
      alternateTitles.push(`${primaryTitle} ${subTitleOrEpisodeTitle}`);
    }
    if (se.episodeCode) {
      alternateTitles.push(`${primaryTitle} ${se.episodeCode}`);
    }

    const coreTitleTokens = this.tokenizeMeaningful(primaryTitle);
    const subTitleTokens = subTitleOrEpisodeTitle ? this.tokenizeMeaningful(subTitleOrEpisodeTitle) : [];

    let identitySummary = primaryTitle;
    if (contentType === 'EPISODIC') {
      identitySummary = `${primaryTitle}${se.episodeCode ? ` ${se.episodeCode}` : ''}${subTitleOrEpisodeTitle ? ` ("${subTitleOrEpisodeTitle}")` : ''}`;
    } else if (contentType === 'MUSIC_VIDEO') {
      identitySummary = `${artistOrCreator || primaryTitle}${trackTitle ? ` — "${trackTitle}"` : ''} (Music Video)`;
    } else if (contentType === 'LIVE_SPORTS') {
      identitySummary = `${participants.length >= 2 ? participants.join(' vs ') : primaryTitle}${fixtureOrFormat ? ` (${fixtureOrFormat})` : ''}${competition ? ` • ${competition}` : ''}`;
    } else if (contentType === 'MOVIE') {
      identitySummary = `${primaryTitle}${releaseYear ? ` (${releaseYear})` : ''} (Feature)`;
    }

    return {
      referenceId: refObj.id,
      contentType,
      rawTitle,
      primaryTitle,
      normalizedPrimaryTitle: primaryTitle.toLowerCase(),
      subTitleOrEpisodeTitle,
      normalizedSubTitle: subTitleOrEpisodeTitle?.toLowerCase(),
      seasonNumber: se.seasonNumber,
      episodeNumber: se.episodeNumber,
      episodeCode: se.episodeCode,
      episodeAliases,
      artistOrCreator,
      trackTitle,
      participants,
      fixtureOrFormat,
      fixtureLabel: fixtureOrFormat,
      competition,
      releaseYear,
      rightsHolder: refObj.rights_holder,
      platform: refObj.platform,
      coreTitleTokens,
      subTitleTokens,
      alternateTitles: Array.from(new Set(alternateTitles.filter(Boolean))),
      identitySummary
    };
  }

  /**
   * Generates targeted query variations for a reference work using its complete identity metadata.
   */
  public static generateTargetedQueries(
    targetOrOptions:
      | ReferenceTargetIdentity
      | {
          reference?: ReferenceItem | null;
          title?: string;
          queryKeywords?: string;
          seasonEpisodeInfo?: string;
          assetType?: string;
          customVariations?: string[];
        },
    userKeywords?: string,
    customVariations?: string[]
  ): string[] {
    let target: ReferenceTargetIdentity;
    let effectiveUserKeywords = userKeywords;
    let effectiveCustomVariations = customVariations;

    if ('contentType' in targetOrOptions && 'primaryTitle' in targetOrOptions) {
      target = targetOrOptions;
    } else {
      const opts = targetOrOptions;
      effectiveUserKeywords = effectiveUserKeywords ?? opts.queryKeywords;
      effectiveCustomVariations = effectiveCustomVariations ?? opts.customVariations;
      if (opts.reference) {
        target = this.parseReferenceTargetIdentity(
          {
            ...opts.reference,
            season_episode_info: opts.seasonEpisodeInfo || opts.reference.season_episode_info
          },
          opts.queryKeywords
        );
      } else {
        target = this.parseReferenceTargetIdentity(
          {
            title: opts.title || opts.queryKeywords || '',
            season_episode_info: opts.seasonEpisodeInfo,
            asset_type: opts.assetType
          },
          opts.queryKeywords
        );
      }
    }

    const queries: string[] = [];
    const base = target.primaryTitle || target.rawTitle || effectiveUserKeywords || '';

    if (target.contentType === 'EPISODIC') {
      if (target.episodeCode) {
        queries.push(`${base} ${target.episodeCode}`);
        if (target.subTitleOrEpisodeTitle) {
          queries.push(`${base} ${target.episodeCode} ${target.subTitleOrEpisodeTitle}`);
        }
        if (target.seasonNumber !== undefined && target.episodeNumber !== undefined) {
          queries.push(`${base} Season ${target.seasonNumber} Episode ${target.episodeNumber}`);
          queries.push(`${base} ${target.seasonNumber}x${String(target.episodeNumber).padStart(2, '0')}`);
        }
        queries.push(`${base} ${target.episodeCode} full episode`);
        queries.push(`${base} ${target.episodeCode} mp4`);
      }
      if (target.subTitleOrEpisodeTitle) {
        queries.push(`${base} ${target.subTitleOrEpisodeTitle}`);
      }
      queries.push(base);
    } else if (target.contentType === 'MUSIC_VIDEO') {
      const artist = target.artistOrCreator || base;
      const track = target.trackTitle || target.subTitleOrEpisodeTitle || '';
      if (track) {
        queries.push(`${artist} ${track}`);
        queries.push(`${artist} - ${track} Official Music Video`);
        queries.push(`${artist} ${track} HD`);
      } else {
        queries.push(target.rawTitle);
      }
    } else if (target.contentType === 'LIVE_SPORTS') {
      if (target.participants.length >= 2) {
        const matchup = `${target.participants[0]} vs ${target.participants[1]}`;
        if (target.fixtureOrFormat) {
          queries.push(`${matchup} ${target.fixtureOrFormat}`);
          queries.push(`${matchup} ${target.fixtureOrFormat} live stream`);
        }
        if (target.competition) {
          queries.push(`${matchup} ${target.competition}`);
        }
        queries.push(`${matchup} full match`);
      }
      queries.push(target.rawTitle);
    } else if (target.contentType === 'MOVIE') {
      if (target.releaseYear) {
        queries.push(`${base} ${target.releaseYear}`);
        queries.push(`${base} ${target.releaseYear} full movie`);
        queries.push(`${base} ${target.releaseYear} 1080p`);
      }
      queries.push(`${base} full movie`);
      queries.push(target.rawTitle);
    } else {
      queries.push(target.rawTitle);
      if (base !== target.rawTitle) queries.push(base);
    }

    if (effectiveUserKeywords && effectiveUserKeywords.trim()) {
      queries.unshift(effectiveUserKeywords.trim());
    }

    if (effectiveCustomVariations && effectiveCustomVariations.length > 0) {
      for (const v of effectiveCustomVariations) {
        if (!v) continue;
        const mod = v === 'S01E01' && target.episodeCode ? target.episodeCode : v;
        queries.push(`${base} ${mod}`);
      }
    }

    return Array.from(
      new Set(
        queries
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .map(q => q.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
      )
    );
  }

  /**
   * Optionally fetches and caches accessible HTML metadata (OpenGraph, JSON-LD, meta description, breadcrumbs)
   * for deeper candidate research with strict caching and rate limiting.
   */
  public static async fetchWebpageResearchMetadata(
    url: string,
    optionsOrTimeout: { timeoutMs?: number; skipNetwork?: boolean } | number = {}
  ): Promise<(WebpageResearchMetadata & { structuredMetadata?: Record<string, any> }) | null> {
    const options =
      typeof optionsOrTimeout === 'number'
        ? { timeoutMs: optionsOrTimeout }
        : optionsOrTimeout;
    if (!url || options.skipNetwork) return null;
    const normUrl = url.trim();
    if (!/^https?:\/\//i.test(normUrl)) return null;
    if (/\.(mp4|m3u8|webm|mkv|mov|avi|ts)(\?|$)/i.test(normUrl)) return null;

    const cached = this.webpageCache.get(normUrl);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      return cached;
    }

    // Rate limiting guard
    const elapsed = Date.now() - this.lastFetchTimestampMs;
    if (elapsed < this.MIN_FETCH_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, this.MIN_FETCH_INTERVAL_MS - elapsed));
    }
    this.lastFetchTimestampMs = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || 3500);
      const res = await fetch(normUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
        }
      });
      clearTimeout(timer);

      if (!res.ok) return null;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;

      const html = (await res.text()).slice(0, 120000);
      const meta = this.parseHtmlResearchSignals(html);

      if (this.webpageCache.size >= this.MAX_CACHE_ENTRIES) {
        const oldestKey = this.webpageCache.keys().next().value;
        if (oldestKey) this.webpageCache.delete(oldestKey);
      }
      this.webpageCache.set(normUrl, meta);
      return meta;
    } catch {
      return null;
    }
  }

  public static parseHtmlResearchSignals(html: string): WebpageResearchMetadata {
    const decodeEntities = (s: string) =>
      s
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? decodeEntities(titleMatch[1]) : undefined;

    const ogTitleMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const ogTitle = ogTitleMatch ? decodeEntities(ogTitleMatch[1]) : undefined;

    const descMatch =
      html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:og:)?description["']/i);
    const description = descMatch ? decodeEntities(descMatch[1]) : undefined;

    const canonMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const canonicalUrl = canonMatch ? canonMatch[1].trim() : undefined;

    let jsonLdTitle: string | undefined;
    let jsonLdSeriesName: string | undefined;
    let jsonLdSeasonNumber: number | undefined;
    let jsonLdEpisodeNumber: number | undefined;
    let jsonLdReleaseYear: number | undefined;
    const discoveredIdentifiers: string[] = [];

    const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of ldMatches) {
      try {
        const parsed = JSON.parse(m[1].trim());
        const nodes = Array.isArray(parsed) ? parsed : parsed['@graph'] ? parsed['@graph'] : [parsed];
        for (const node of nodes) {
          if (!node || typeof node !== 'object') continue;
          if (node.name && !jsonLdTitle) jsonLdTitle = String(node.name).trim();
          if (node.headline && !jsonLdTitle) jsonLdTitle = String(node.headline).trim();
          if (node.partOfSeries?.name) jsonLdSeriesName = String(node.partOfSeries.name).trim();
          if (node.partOfSeason?.seasonNumber !== undefined) {
            const sn = parseInt(String(node.partOfSeason.seasonNumber), 10);
            if (!Number.isNaN(sn)) jsonLdSeasonNumber = sn;
          }
          if (node.episodeNumber !== undefined) {
            const en = parseInt(String(node.episodeNumber), 10);
            if (!Number.isNaN(en)) jsonLdEpisodeNumber = en;
          }
          if (node.datePublished || node.uploadDate) {
            const yr = this.extractReleaseYear(String(node.datePublished || node.uploadDate));
            if (yr) jsonLdReleaseYear = yr;
          }
          if (node['@id']) discoveredIdentifiers.push(String(node['@id']));
        }
      } catch {}
    }

    // Extract IMDb ID or YouTube/Dailymotion IDs if present on page
    const imdbMatches = html.match(/\btt\d{7,8}\b/gi);
    if (imdbMatches) {
      for (const id of imdbMatches.slice(0, 3)) {
        if (!discoveredIdentifiers.includes(id)) discoveredIdentifiers.push(id);
      }
    }

    return {
      fetchedAt: Date.now(),
      pageTitle,
      ogTitle,
      description,
      canonicalUrl,
      jsonLdTitle,
      jsonLdSeriesName,
      jsonLdSeasonNumber,
      jsonLdEpisodeNumber,
      jsonLdReleaseYear,
      discoveredIdentifiers
    };
  }

  /**
   * Evaluates a candidate against the complete registered reference target,
   * extracting its detected content identity, supporting evidence, contradictory evidence,
   * missing metadata, research relevance score, and ranking explanation.
   */
  public static evaluateCandidateAgainstTarget(params: {
    candidate: Partial<CandidateItem> & { source_url: string; discovered_title: string; domain?: string };
    reference?: ReferenceItem | null;
    targetIdentity?: ReferenceTargetIdentity | null;
    fallbackQuery?: string;
    verifiedPageTitle?: string;
    pageDescription?: string;
    structuredMetadata?: Record<string, any>;
    webpageMetadata?: WebpageResearchMetadata | null;
  }): CandidateResearchEvaluation {
    const { candidate, reference, verifiedPageTitle } = params;
    const webpageMetadata: WebpageResearchMetadata | null =
      params.webpageMetadata ||
      (params.pageDescription || params.structuredMetadata
        ? {
            fetchedAt: Date.now(),
            description: params.pageDescription,
            jsonLdTitle: params.structuredMetadata?.name || params.structuredMetadata?.headline,
            jsonLdSeriesName: params.structuredMetadata?.partOfSeries,
            jsonLdSeasonNumber: params.structuredMetadata?.seasonNumber,
            jsonLdEpisodeNumber: params.structuredMetadata?.episodeNumber,
            discoveredIdentifiers: []
          }
        : null);

    const target =
      params.targetIdentity ||
      (reference || params.fallbackQuery
        ? this.parseReferenceTargetIdentity(reference, params.fallbackQuery)
        : null);

    const candTitleRaw = (
      verifiedPageTitle ||
      webpageMetadata?.ogTitle ||
      webpageMetadata?.pageTitle ||
      candidate.discovered_title ||
      ''
    ).trim();

    const urlSignals = [
      candidate.source_url,
      candidate.final_url,
      candidate.media_url,
      candidate.original_url,
      candidate.referring_page,
      webpageMetadata?.canonicalUrl
    ]
      .filter((v): v is string => Boolean(v && v.trim()))
      .join(' ');

    const fullCandidateText = [
      candTitleRaw,
      candidate.discovered_title || '',
      webpageMetadata?.jsonLdTitle || '',
      webpageMetadata?.jsonLdSeriesName || '',
      webpageMetadata?.description || '',
      urlSignals.replace(/[-_/]/g, ' ')
    ]
      .filter(Boolean)
      .join(' ');

    const candLower = fullCandidateText.toLowerCase();
    const titleAndUrlText = `${candTitleRaw} ${candidate.discovered_title || ''} ${urlSignals.replace(/[-_/]/g, ' ')}`;
    const titleAndUrlLower = titleAndUrlText.toLowerCase();

    // 1. Detect candidate's own content identity
    const candSE = this.extractSeasonEpisode(titleAndUrlText);
    if (candSE.seasonNumber === undefined && webpageMetadata?.jsonLdSeasonNumber !== undefined) {
      candSE.seasonNumber = webpageMetadata.jsonLdSeasonNumber;
    }
    if (candSE.episodeNumber === undefined && webpageMetadata?.jsonLdEpisodeNumber !== undefined) {
      candSE.episodeNumber = webpageMetadata.jsonLdEpisodeNumber;
    }
    if (candSE.seasonNumber !== undefined && candSE.episodeNumber !== undefined && !candSE.episodeCode) {
      candSE.episodeCode = `S${String(candSE.seasonNumber).padStart(2, '0')}E${String(candSE.episodeNumber).padStart(2, '0')}`;
    }

    const candTeams = this.detectTeams(titleAndUrlText);
    const candFixture = this.detectSportsFixture(titleAndUrlText);
    const candCompetition = this.detectCompetition(titleAndUrlText);
    const candYear = webpageMetadata?.jsonLdReleaseYear || this.extractReleaseYear(candTitleRaw);
    const isGenericClip = GENERIC_CLIP_OR_NOISE_PATTERNS.some(rx => rx.test(candTitleRaw));
    const isArticleOrImage =
      candidate.candidate_classification === 'ARTICLE' ||
      candidate.candidate_classification === 'IMAGE' ||
      candidate.asset_kind === 'ARTICLE' ||
      candidate.asset_kind === 'IMAGE';

    const candSplitParts = candTitleRaw
      .split(/\s*(?:—|–|\||:)\s*|\s+-\s+/)
      .map(s => this.cleanWorkTitlePhrase(s))
      .filter(Boolean);

    const detectedWorkTitle =
      webpageMetadata?.jsonLdSeriesName ||
      this.cleanWorkTitlePhrase(candSplitParts[0] || candTitleRaw) ||
      undefined;
    const detectedSubTitle =
      candSplitParts.length > 1 ? candSplitParts.slice(1).join(' ') : undefined;

    let detectedContentType: CandidateDetectedIdentity['detected_content_type'] = 'GENERAL';
    if (isArticleOrImage) {
      detectedContentType = 'ARTICLE_OR_NEWS';
    } else if (candTeams.length >= 2 || candFixture || candCompetition) {
      detectedContentType = 'LIVE_SPORTS';
    } else if (candSE.seasonNumber !== undefined || candSE.episodeNumber !== undefined) {
      detectedContentType = 'EPISODIC';
    } else if (isGenericClip) {
      detectedContentType = 'CLIP_OR_COMPILATION';
    } else if (/official\s+music\s+video|official\s+audio|music\s+video|lyric/i.test(candTitleRaw)) {
      detectedContentType = 'MUSIC_VIDEO';
    } else if (candYear || /\b(full\s+movie|feature\s+film|web-dl|bluray)\b/i.test(titleAndUrlText)) {
      detectedContentType = 'MOVIE';
    }

    let detectedIdentitySummary = detectedWorkTitle || candTitleRaw || candidate.domain || 'Unknown Candidate';
    if (candSE.episodeCode) {
      detectedIdentitySummary = `${detectedWorkTitle || candTitleRaw} • ${candSE.episodeCode}${detectedSubTitle && detectedSubTitle.toLowerCase() !== (detectedWorkTitle || '').toLowerCase() ? ` ("${detectedSubTitle}")` : ''}`;
    } else if (candTeams.length >= 2) {
      detectedIdentitySummary = `${candTeams.join(' vs ')}${candFixture ? ` • ${candFixture}` : ''}${candCompetition ? ` (${candCompetition})` : ''}`;
    } else if (isGenericClip) {
      detectedIdentitySummary = `${candTitleRaw} (Clip / Compilation / Commentary)`;
    }

    const detectedIdentity: CandidateDetectedIdentity = {
      detected_content_type: detectedContentType,
      detected_work_title: detectedWorkTitle,
      detected_subtitle_or_episode_title: detectedSubTitle,
      detected_season: candSE.seasonNumber,
      detected_episode: candSE.episodeNumber,
      detected_episode_code: candSE.episodeCode,
      detected_artist: detectedContentType === 'MUSIC_VIDEO' ? candSplitParts[0] : undefined,
      detected_track: detectedContentType === 'MUSIC_VIDEO' ? candSplitParts[1] : undefined,
      detected_participants: candTeams.length > 0 ? candTeams : undefined,
      detected_fixture: candFixture,
      detected_competition: candCompetition,
      detected_year: candYear,
      is_generic_compilation_or_clip: isGenericClip,
      identity_summary: detectedIdentitySummary
    };

    const corroboratingSources = Array.from(
      new Set(
        [
          candidate.source_url,
          candidate.media_url,
          candidate.referring_page,
          ...(candidate.discovery_provenance?.source_urls || []),
          ...(candidate.discovery_provenance?.media_urls || [])
        ].filter((v): v is string => Boolean(v && v.trim() && v.startsWith('http')))
      )
    );

    const discoveredIdentifiers = Array.from(
      new Set([
        ...(candSE.episodeCode ? [candSE.episodeCode] : []),
        ...(webpageMetadata?.discoveredIdentifiers || [])
      ])
    );

    if (!target) {
      return {
        target_identity_summary: 'Unlinked Reference',
        detected_identity: detectedIdentity,
        identity_relationship: 'INSUFFICIENT_METADATA',
        research_relevance_score: 0.4,
        supporting_evidence: ['Candidate discovered via ad-hoc inspection without a linked target reference.'],
        contradictory_evidence: [],
        missing_metadata: ['No target reference linked for identity comparison.'],
        ranking_explanation: 'Candidate is unlinked to a specific reference work; ranked by discovery status.',
        corroborating_sources: corroboratingSources,
        discovered_identifiers: discoveredIdentifiers,
        research_status: 'INCOMPLETE_METADATA',
        researched_at: new Date().toISOString()
      };
    }

    const supportingEvidence: string[] = [];
    const contradictoryEvidence: string[] = [];
    const missingMetadata: string[] = [];

    // Check if candidate has virtually no title metadata (e.g., raw stream URL or generic manifest filename)
    const isOpaqueStream =
      !candTitleRaw ||
      /^https?:\/\//i.test(candTitleRaw) ||
      /^(index|master|playlist|stream|video|chunklist|manifest|live)\.(m3u8|mp4|mpd|ts|webm)$/i.test(candTitleRaw);

    // Check primary title phrase match & token match with word boundaries
    const hasWord = (haystack: string, word: string): boolean => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
    };

    const normalizedTargetPhrase = target.normalizedPrimaryTitle;
    const exactPrimaryPhraseInTitleOrUrl =
      normalizedTargetPhrase.length >= 3 &&
      (titleAndUrlLower.includes(normalizedTargetPhrase) ||
        titleAndUrlLower.replace(/[-_.]/g, ' ').includes(normalizedTargetPhrase));

    const matchedCoreTokens = target.coreTitleTokens.filter(t => hasWord(titleAndUrlLower, t));
    const coreTokenRatio =
      target.coreTitleTokens.length > 0 ? matchedCoreTokens.length / target.coreTitleTokens.length : 0;

    // A primary work match requires either the exact primary title phrase OR all core tokens (for 2-word titles like "Modern Family")
    const matchesPrimaryWork =
      exactPrimaryPhraseInTitleOrUrl ||
      (target.coreTitleTokens.length >= 2 ? coreTokenRatio >= 0.99 : coreTokenRatio >= 0.75);

    const partialPrimaryOverlap = !matchesPrimaryWork && coreTokenRatio >= 0.5;

    let identityRelationship: IdentityRelationship = 'UNRELATED_CONTENT';
    let score = 0.05;

    const genericTestCheck = this.isGenericPlatformTestVideo(
      titleAndUrlText,
      `${target.rawTitle} ${target.primaryTitle} ${params.fallbackQuery || ''}`
    );

    // ------------------------------------------------------------------
    // Content-Type-Specific Identity Evaluation
    // ------------------------------------------------------------------
    if (genericTestCheck.isGenericTest) {
      identityRelationship = 'UNRELATED_CONTENT';
      score = 0.01;
      contradictoryEvidence.push(
        genericTestCheck.reason ||
          `Candidate is a generic platform test/sample video unrelated to "${target.identitySummary}".`
      );
    } else if (isOpaqueStream && !matchesPrimaryWork && candSE.episodeCode === undefined && candTeams.length === 0) {
      identityRelationship = 'INSUFFICIENT_METADATA';
      score = 0.34;
      missingMetadata.push('Candidate URL/stream does not expose a descriptive program title or episode identifier.');
    } else if (target.contentType === 'EPISODIC') {
      // 1. Evaluate Series Title
      if (matchesPrimaryWork) {
        supportingEvidence.push(`Matches target series title "${target.primaryTitle}".`);
      } else if (partialPrimaryOverlap) {
        contradictoryEvidence.push(
          `Partial keyword overlap (${matchedCoreTokens.join(', ')}) without matching the complete series title "${target.primaryTitle}".`
        );
      } else {
        contradictoryEvidence.push(
          `Candidate title "${detectedWorkTitle || candTitleRaw}" does not match target series "${target.primaryTitle}".`
        );
      }

      // 2. Evaluate Season & Episode Numbers + Episode Title
      const hasTargetSE = target.seasonNumber !== undefined && target.episodeNumber !== undefined;
      const hasCandSE = candSE.seasonNumber !== undefined || candSE.episodeNumber !== undefined;

      const matchesEpisodeSubtitle =
        Boolean(target.normalizedSubTitle && target.normalizedSubTitle.length >= 4) &&
        hasWord(titleAndUrlLower, target.normalizedSubTitle!);

      if (!matchesPrimaryWork) {
        // Different show altogether (even if it happens to be S01E01 of another show!)
        identityRelationship = 'UNRELATED_CONTENT';
        score = partialPrimaryOverlap ? 0.12 : 0.04;
        if (candSE.episodeCode && candSE.episodeCode === target.episodeCode) {
          contradictoryEvidence.push(
            `Candidate shares episode code ${candSE.episodeCode} but belongs to a different series ("${detectedWorkTitle || candTitleRaw}").`
          );
        }
      } else if (hasTargetSE) {
        const seasonMatches = candSE.seasonNumber === target.seasonNumber;
        const episodeMatches = candSE.episodeNumber === target.episodeNumber;

        if (seasonMatches && episodeMatches) {
          // Exact Series + Exact Season + Exact Episode!
          identityRelationship = 'EXACT_TARGET_MATCH';
          score = 0.90;
          supportingEvidence.push(
            `Matches exact target season and episode: ${target.episodeCode} (Season ${target.seasonNumber}, Episode ${target.episodeNumber}).`
          );
          if (/\/season-0*\d+\/episode-0*\d+/i.test(urlSignals) || /s0*\d+e0*\d+/i.test(urlSignals)) {
            supportingEvidence.push('URL path / media filename independently corroborates the target season and episode.');
            score += 0.04;
          }
          if (matchesEpisodeSubtitle) {
            supportingEvidence.push(`Matches episode title "${target.subTitleOrEpisodeTitle}".`);
            score += 0.03;
          }
          if (candidate.media_url || candidate.candidate_classification === 'VERIFIED_VIDEO_ASSET' || candidate.candidate_classification === 'VIDEO_ASSET') {
            supportingEvidence.push('Candidate exposes a direct or downloadable video asset reference.');
            score += 0.02;
          }
          if (isGenericClip) {
            contradictoryEvidence.push('Candidate title indicates a short clip, promo, or commentary rather than a full episode.');
            score -= 0.12;
          }
        } else if (hasCandSE && (!seasonMatches || !episodeMatches)) {
          // Contradictory Season or Episode of the same series!
          identityRelationship = 'DIFFERENT_EPISODE_OR_ITEM';
          score = 0.22;
          const observedCode =
            candSE.episodeCode ||
            `${candSE.seasonNumber !== undefined ? `Season ${candSE.seasonNumber} ` : ''}${candSE.episodeNumber !== undefined ? `Episode ${candSE.episodeNumber}` : ''}`.trim();
          contradictoryEvidence.push(
            `Candidate identifies ${observedCode}, which contradicts the registered target episode ${target.episodeCode} (Season ${target.seasonNumber}, Episode ${target.episodeNumber}).`
          );
        } else if (matchesEpisodeSubtitle && !isGenericClip) {
          // Matches series + exact episode title (e.g. "Modern Family - Pilot") without numeric S01E01 tag
          identityRelationship = 'EXACT_TARGET_MATCH';
          score = 0.84;
          supportingEvidence.push(
            `Matches series "${target.primaryTitle}" and episode title "${target.subTitleOrEpisodeTitle}".`
          );
          missingMetadata.push(`Numeric season/episode code (${target.episodeCode}) not explicitly stated in title.`);
        } else {
          // Generic series mention without episode specificity (e.g. "Modern Family Funny Moments" or series index page)
          identityRelationship = 'TARGET_SERIES_OR_ARTIST_GENERIC';
          score = isGenericClip ? 0.44 : 0.54;
          missingMetadata.push(
            `Candidate mentions series "${target.primaryTitle}" generally but does not specify target episode ${target.episodeCode}.`
          );
          if (isGenericClip) {
            contradictoryEvidence.push(
              'Candidate appears to be a generic series clip, interview, or compilation rather than the target episode.'
            );
          }
        }
      } else {
        // Target is episodic without a specific S/E number
        identityRelationship = isGenericClip ? 'TARGET_SERIES_OR_ARTIST_GENERIC' : 'EXACT_TARGET_MATCH';
        score = isGenericClip ? 0.52 : 0.82;
      }
    } else if (target.contentType === 'MUSIC_VIDEO') {
      const artist = (target.artistOrCreator || target.primaryTitle).toLowerCase();
      const track = (target.trackTitle || target.subTitleOrEpisodeTitle || '').toLowerCase();
      const hasArtist = artist.length >= 2 && titleAndUrlLower.includes(artist);
      const hasTrack = track.length >= 2 && titleAndUrlLower.includes(track);

      if (hasArtist && hasTrack) {
        supportingEvidence.push(`Matches artist "${target.artistOrCreator || target.primaryTitle}" and track "${target.trackTitle || target.subTitleOrEpisodeTitle}".`);
        if (/\b(cover|karaoke|instrumental|reaction|parody|remix)\b/i.test(candTitleRaw) && !/\b(cover|remix)\b/i.test(target.rawTitle)) {
          identityRelationship = 'TARGET_SERIES_OR_ARTIST_GENERIC';
          score = 0.48;
          contradictoryEvidence.push('Candidate is a cover, reaction, or derivative version rather than the original master.');
        } else {
          identityRelationship = 'EXACT_TARGET_MATCH';
          score = 0.93;
          if (/official\s+music\s+video|official\s+video/i.test(candTitleRaw)) {
            supportingEvidence.push('Identified as Official Music Video.');
            score += 0.04;
          }
        }
      } else if (hasArtist && !hasTrack) {
        // Same artist, but different song or generic artist page!
        if (candSplitParts.length >= 2 && candSplitParts[1].toLowerCase() !== track) {
          identityRelationship = 'DIFFERENT_EPISODE_OR_ITEM';
          score = 0.24;
          contradictoryEvidence.push(
            `Matches artist "${target.artistOrCreator || target.primaryTitle}" but identifies a different track ("${candSplitParts.slice(1).join(' ')}" vs target "${target.trackTitle}").`
          );
        } else {
          identityRelationship = 'TARGET_SERIES_OR_ARTIST_GENERIC';
          score = 0.48;
          missingMetadata.push(`Mentions artist "${target.artistOrCreator || target.primaryTitle}" without specifying target track "${target.trackTitle}".`);
        }
      } else if (!hasArtist && hasTrack && track.split(/\s+/).length >= 2) {
        identityRelationship = 'TARGET_SERIES_OR_ARTIST_GENERIC';
        score = 0.42;
        supportingEvidence.push(`Matches track title "${target.trackTitle}".`);
        missingMetadata.push(`Artist "${target.artistOrCreator}" not confirmed in candidate title.`);
      } else {
        identityRelationship = 'UNRELATED_CONTENT';
        score = 0.05;
        contradictoryEvidence.push(
          `Candidate does not match artist "${target.artistOrCreator || target.primaryTitle}" or track "${target.trackTitle || target.rawTitle}".`
        );
      }
    } else if (target.contentType === 'LIVE_SPORTS') {
      const matchedTeams = target.participants.filter(t => candTeams.includes(t));
      const hasExtraContradictoryTeam = candTeams.some(t => target.participants.length > 0 && !target.participants.includes(t));

      if (target.participants.length >= 2 && matchedTeams.length === target.participants.length && !hasExtraContradictoryTeam) {
        supportingEvidence.push(`Matches participating teams: ${target.participants.join(' vs ')}.`);
        if (target.fixtureOrFormat && candFixture && target.fixtureOrFormat !== candFixture) {
          identityRelationship = 'DIFFERENT_EPISODE_OR_ITEM';
          score = 0.28;
          contradictoryEvidence.push(
            `Candidate fixture (${candFixture}) contradicts target fixture (${target.fixtureOrFormat}).`
          );
        } else {
          identityRelationship = 'EXACT_TARGET_MATCH';
          score = 0.90;
          if (target.fixtureOrFormat && candFixture === target.fixtureOrFormat) {
            supportingEvidence.push(`Matches exact fixture format: ${candFixture}.`);
            score += 0.05;
          } else if (target.fixtureOrFormat && !candFixture) {
            missingMetadata.push(`Specific fixture (${target.fixtureOrFormat}) not explicitly tagged in candidate title.`);
            score -= 0.06;
          }
          if (target.competition && candCompetition === target.competition) {
            supportingEvidence.push(`Matches competition: ${candCompetition}.`);
            score += 0.03;
          }
        }
      } else if (matchedTeams.length === 1 && hasExtraContradictoryTeam) {
        identityRelationship = 'DIFFERENT_EPISODE_OR_ITEM';
        score = 0.20;
        contradictoryEvidence.push(
          `Candidate matchup (${candTeams.join(' vs ')}) contradicts target matchup (${target.participants.join(' vs ')}).`
        );
      } else if (matchedTeams.length >= 1 || (target.competition && candCompetition === target.competition)) {
        identityRelationship = 'TARGET_SERIES_OR_ARTIST_GENERIC';
        score = 0.50;
        supportingEvidence.push(
          `Shares partial tournament/team context (${matchedTeams.join(', ') || candCompetition}).`
        );
        missingMetadata.push(`Full matchup (${target.participants.join(' vs ')}) not confirmed in candidate metadata.`);
      } else if (matchesPrimaryWork) {
        identityRelationship = 'EXACT_TARGET_MATCH';
        score = 0.85;
        supportingEvidence.push(`Matches event title "${target.primaryTitle}".`);
      } else {
        identityRelationship = 'UNRELATED_CONTENT';
        score = 0.05;
        contradictoryEvidence.push(
          `Candidate sports/event identity does not match "${target.identitySummary}".`
        );
      }
    } else {
      // MOVIE / VOD_FEATURE / GENERAL
      if (matchesPrimaryWork) {
        supportingEvidence.push(`Matches target work title "${target.primaryTitle}".`);
        if (target.releaseYear && candYear && Math.abs(target.releaseYear - candYear) > 1) {
          identityRelationship = 'DIFFERENT_EPISODE_OR_ITEM';
          score = 0.26;
          contradictoryEvidence.push(
            `Candidate release year (${candYear}) contradicts target release year (${target.releaseYear}).`
          );
        } else if (isGenericClip) {
          identityRelationship = 'TARGET_SERIES_OR_ARTIST_GENERIC';
          score = 0.52;
          contradictoryEvidence.push(
            'Candidate is a trailer, review, or clip rather than the full target feature.'
          );
        } else {
          identityRelationship = 'EXACT_TARGET_MATCH';
          score = 0.90;
          if (target.releaseYear && candYear === target.releaseYear) {
            supportingEvidence.push(`Matches release year (${target.releaseYear}).`);
            score += 0.05;
          } else if (target.releaseYear && !candYear) {
            missingMetadata.push(`Release year (${target.releaseYear}) not specified in candidate metadata.`);
          }
        }
      } else if (partialPrimaryOverlap) {
        identityRelationship = 'UNRELATED_CONTENT';
        score = 0.12;
        contradictoryEvidence.push(
          `Candidate only shares partial word overlap (${matchedCoreTokens.join(', ')}) with "${target.primaryTitle}".`
        );
      } else {
        identityRelationship = 'UNRELATED_CONTENT';
        score = 0.04;
        contradictoryEvidence.push(
          `Candidate title "${detectedWorkTitle || candTitleRaw}" is unrelated to target "${target.primaryTitle}".`
        );
      }
    }

    // Penalize non-video articles or static images so they rank below actual video candidates
    if (isArticleOrImage) {
      contradictoryEvidence.push(`Candidate is classified as ${candidate.candidate_classification || candidate.asset_kind} (no video stream).`);
      score = Math.min(score, 0.35);
    }

    const clampedScore = Number(Math.max(0.0, Math.min(0.99, score)).toFixed(2));

    let researchStatus: CandidateResearchEvaluation['research_status'] = 'COMPLETE';
    if (identityRelationship === 'UNRELATED_CONTENT') {
      researchStatus = 'REJECTED_UNRELATED';
    } else if (identityRelationship === 'DIFFERENT_EPISODE_OR_ITEM') {
      researchStatus = 'CONFLICTING_IDENTITY';
    } else if (identityRelationship === 'INSUFFICIENT_METADATA' || missingMetadata.length > 0) {
      researchStatus = 'INCOMPLETE_METADATA';
    }

    const pct = Math.round(clampedScore * 100);
    let rankingExplanation = '';
    if (identityRelationship === 'EXACT_TARGET_MATCH') {
      rankingExplanation = `High priority (${pct}% research relevance): Credibly identifies exact target "${target.identitySummary}" (${supportingEvidence.slice(0, 2).join(' ')})`;
    } else if (identityRelationship === 'TARGET_SERIES_OR_ARTIST_GENERIC') {
      rankingExplanation = `Ranked below exact matches (${pct}% research relevance): Relates to "${target.primaryTitle}" generally, but lacks specific episode/item identity (${missingMetadata[0] || contradictoryEvidence[0] || 'generic mention'}).`;
    } else if (identityRelationship === 'DIFFERENT_EPISODE_OR_ITEM') {
      rankingExplanation = `Demoted for conflicting identity (${pct}% research relevance): ${contradictoryEvidence[0] || 'Identifies a different episode, track, or fixture than the registered target.'}`;
    } else if (identityRelationship === 'INSUFFICIENT_METADATA') {
      rankingExplanation = `Held for inspection (${pct}% research relevance): ${missingMetadata[0] || 'Insufficient metadata in URL/title; requires stream verification.'}`;
    } else {
      rankingExplanation = `Low rank / Rejected (${pct}% research relevance): ${contradictoryEvidence[0] || 'Candidate content appears unrelated to the registered target.'}`;
    }

    return {
      target_reference_id: target.referenceId,
      target_identity_summary: target.identitySummary,
      detected_identity: detectedIdentity,
      identity_relationship: identityRelationship,
      research_relevance_score: clampedScore,
      supporting_evidence: supportingEvidence,
      contradictory_evidence: contradictoryEvidence,
      missing_metadata: missingMetadata,
      ranking_explanation: rankingExplanation,
      corroborating_sources: corroboratingSources,
      discovered_identifiers: discoveredIdentifiers,
      research_status: researchStatus,
      researched_at: new Date().toISOString()
    };
  }

  /**
   * Computes a multi-factor relevance score (0.00 - 0.99) for adapter discovery filtering & ranking.
   * Replaces naive bag-of-words token overlap so exact target matches rank highest and contradictory
   * episodes or unrelated works are penalized.
   */
  public static computeTargetRelevanceScore(
    candidateTitleAndUrl: string,
    query: string,
    reference?: ReferenceItem | { title: string; season_episode_info?: string; asset_type?: string } | string
  ): number {
    const refObj =
      typeof reference === 'string'
        ? { title: reference || query }
        : reference || { title: query };
    const target = this.parseReferenceTargetIdentity({
      title: refObj.title || query,
      season_episode_info: (refObj as any).season_episode_info || query
    });
    const isUrlInput = /^https?:\/\//i.test((candidateTitleAndUrl || '').trim());
    const evalResult = this.evaluateCandidateAgainstTarget({
      candidate: {
        source_url: isUrlInput ? candidateTitleAndUrl : '',
        discovered_title: candidateTitleAndUrl
      },
      targetIdentity: target
    });
    return evalResult.research_relevance_score;
  }

  /**
   * Ranks a list of CandidateItems by justified relevance to the complete registered target,
   * keeping research relevance separate from forensic match confidence.
   */
  public static rankCandidates(
    candidates: CandidateItem[],
    referencesById?: Map<string, ReferenceItem>
  ): CandidateItem[] {
    const relationshipPriority: Record<IdentityRelationship, number> = {
      EXACT_TARGET_MATCH: 5,
      TARGET_SERIES_OR_ARTIST_GENERIC: 4,
      INSUFFICIENT_METADATA: 3,
      DIFFERENT_EPISODE_OR_ITEM: 2,
      UNRELATED_CONTENT: 1
    };

    return [...candidates].sort((a, b) => {
      // 1. Confirmed forensic + non-contradictory identity match first
      const aConfirmed =
        a.overall_assessment === 'MATCH_FOUND' &&
        a.acquisition_status === 'VERIFIED_PERCEPTUAL_MATCH' &&
        a.identity_relationship !== 'UNRELATED_CONTENT' &&
        a.identity_relationship !== 'DIFFERENT_EPISODE_OR_ITEM'
          ? 1
          : 0;
      const bConfirmed =
        b.overall_assessment === 'MATCH_FOUND' &&
        b.acquisition_status === 'VERIFIED_PERCEPTUAL_MATCH' &&
        b.identity_relationship !== 'UNRELATED_CONTENT' &&
        b.identity_relationship !== 'DIFFERENT_EPISODE_OR_ITEM'
          ? 1
          : 0;
      if (aConfirmed !== bConfirmed) return bConfirmed - aConfirmed;

      // 2. Identity relationship tier (EXACT_TARGET_MATCH > GENERIC > INSUFFICIENT_METADATA > DIFFERENT_EPISODE > UNRELATED)
      const aRelTier = relationshipPriority[a.identity_relationship || 'INSUFFICIENT_METADATA'] || 3;
      const bRelTier = relationshipPriority[b.identity_relationship || 'INSUFFICIENT_METADATA'] || 3;
      if (aRelTier !== bRelTier) return bRelTier - aRelTier;

      // 3. Research relevance score descending
      const aScore = a.research_relevance_score ?? a.metadata_relevance_score ?? 0;
      const bScore = b.research_relevance_score ?? b.metadata_relevance_score ?? 0;
      if (Math.abs(bScore - aScore) >= 0.02) return bScore - aScore;

      // 4. Prefer verified/direct video assets over general webpages
      const aVideo = a.media_url || a.candidate_classification === 'VERIFIED_VIDEO_ASSET' || a.candidate_classification === 'VIDEO_ASSET' ? 1 : 0;
      const bVideo = b.media_url || b.candidate_classification === 'VERIFIED_VIDEO_ASSET' || b.candidate_classification === 'VIDEO_ASSET' ? 1 : 0;
      if (aVideo !== bVideo) return bVideo - aVideo;

      // 5. Fallback to visual similarity score if analyzed
      const aVis = a.visual_similarity_score ?? 0;
      const bVis = b.visual_similarity_score ?? 0;
      if (Math.abs(bVis - aVis) >= 0.02) return bVis - aVis;

      return (b.discovered_at || '').localeCompare(a.discovered_at || '');
    });
  }
}
