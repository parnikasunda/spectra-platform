/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Modular Source Adapter Framework — Interfaces & Protocols
 */

import { PipelineStatus, CandidateClassification } from '../../types.js';

export interface DiscoveredItem {
  url: string;
  mediaUrl?: string;
  sourceType?: 'configured_website' | 'frame_search' | 'title_search' | 'candidate_expansion' | string;
  matchedContentId?: string;
  matchMethod?: string;
  originalUrl?: string;
  finalUrl?: string;
  finalDomain?: string;
  referringPage?: string;
  matchedKeywords?: string[];
  crawlStatus?: string;
  candidateClassification?: CandidateClassification;
  title: string;
  platform: string;
  sourceCategory: 'YOUTUBE' | 'STREAMING_SERVICE' | 'SUSPECTED_PIRACY' | 'PUBLIC_PLATFORM' | 'EMBEDDED_PLAYER' | 'DIRECT_STREAM' | 'OTHER';
  assetKind: 'DISCOVERED_PAGE' | 'VERIFIED_VIDEO_ASSET' | 'VIDEO_ASSET' | 'ARTICLE' | 'IMAGE' | 'GENERAL_WEBPAGE';
  suggestedType: 'HLS_M3U8' | 'MP4' | 'WEBM' | 'HTML_PLAYER' | 'DASH_MPD' | 'UNKNOWN';
  domain: string;
  isLive?: boolean;
  relevanceScore?: number;
  metadata?: Record<string, any>;
}

export interface AdapterDiagnostic {
  adapterId: string;
  adapterName: string;
  sourceCategory: string;
  status: 'LIVE_OK' | 'NO_RESULTS' | 'REQUIRES_API_KEY' | 'NETWORK_ERROR';
  candidatesFound: number;
  message: string;
  requiresCredentials?: boolean;
}

export interface MediaAcquisitionResult {
  accessible: boolean;
  pipelineStatus: PipelineStatus;
  httpStatus: number;
  latencyMs: number;
  mediaType: 'HLS_M3U8' | 'MP4' | 'WEBM' | 'HTML_PLAYER' | 'DASH_MPD' | 'UNKNOWN';
  resolvedMediaUrl?: string; // e.g. direct .m3u8, .mpd, or .mp4 extracted from embedded player
  finalUrl?: string; // final resolved URL after HTTP redirects
  finalDomain?: string; // final resolved domain after HTTP redirects
  redirected?: boolean;
  crawlStatus?: string;
  candidateClassification?: CandidateClassification;
  pageTitle?: string;
  platform?: string;
  resolution?: string;
  durationSec?: number;
  drmScheme?: string; // 'Widevine' | 'PlayReady' | 'FairPlay' | 'None'
  headers: Record<string, string>;
  technicalLogs: string[];
  extractionNotice?: string;
}

export interface SourceAdapter {
  id: string;
  name: string;
  description: string;
  sourceCategory: 'YOUTUBE' | 'STREAMING_SERVICE' | 'SUSPECTED_PIRACY' | 'PUBLIC_PLATFORM' | 'EMBEDDED_PLAYER' | 'DIRECT_STREAM' | 'OTHER';
  canHandle(url: string): boolean;
  discover?(query: string, options: { maxResults?: number; page?: number; referenceTitle?: string; keywordCombinations?: string[]; seedSources?: string[] }): Promise<DiscoveredItem[]>;
  getLastDiagnostic?(): AdapterDiagnostic | null;
  acquireAndProbe(targetUrl: string, options?: { timeoutMs?: number }): Promise<MediaAcquisitionResult>;
}
