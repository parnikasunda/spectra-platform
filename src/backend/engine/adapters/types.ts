/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Modular Source Adapter Framework — Interfaces & Protocols
 */

import { PipelineStatus } from '../../types.js';

export interface DiscoveredItem {
  url: string;
  title: string;
  sourceCategory: 'YOUTUBE' | 'STREAMING_SERVICE' | 'SUSPECTED_PIRACY' | 'PUBLIC_PLATFORM' | 'EMBEDDED_PLAYER' | 'DIRECT_STREAM' | 'OTHER';
  assetKind: 'DISCOVERED_PAGE' | 'VERIFIED_VIDEO_ASSET';
  suggestedType: 'HLS_M3U8' | 'MP4' | 'WEBM' | 'HTML_PLAYER' | 'DASH_MPD' | 'UNKNOWN';
  domain: string;
  isLive?: boolean;
  metadata?: Record<string, any>;
}

export interface MediaAcquisitionResult {
  accessible: boolean;
  pipelineStatus: PipelineStatus;
  httpStatus: number;
  latencyMs: number;
  mediaType: 'HLS_M3U8' | 'MP4' | 'WEBM' | 'HTML_PLAYER' | 'DASH_MPD' | 'UNKNOWN';
  resolvedMediaUrl?: string; // e.g. direct .m3u8, .mpd, or .mp4 extracted from embedded player
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
  discover?(query: string, options: { maxResults?: number; page?: number; referenceTitle?: string }): Promise<DiscoveredItem[]>;
  acquireAndProbe(targetUrl: string, options?: { timeoutMs?: number }): Promise<MediaAcquisitionResult>;
}
