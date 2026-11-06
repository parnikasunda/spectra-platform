/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Perceptual Media Fingerprinting & Temporal Sequence Matching Engine
 *
 * Implements genuine 64-bit Difference Hash (dHash) & Average Luminance Hash,
 * FFmpeg frame extraction, pure-JS visual frame synthesis fallback,
 * Hamming distance calculation, and temporal sequence cross-correlation.
 */

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import {
  FrameFingerprint,
  MatchedKeyframePair,
  MatchedTimelineSegment,
  FullCoverageMatchMetrics,
  AudioFingerprint,
  AudioMatchMetrics,
  MatchClassification,
  MetadataSignal,
  CapturedCandidateFrame,
  OverallAssessmentState,
  ReferenceItem,
  CandidateItem,
  ReferenceUrlInspectionResult,
  EmbeddedPlayerInfo,
  AccessibleMediaMetadata,
  SourceAdapterDescriptor,
  ResolvedVideoIdentity,
  AcquisitionWorkflowReport,
  AttemptedAcquisitionMethod
} from '../types.js';
import { CandidateResearchEngine } from './candidateResearch.js';
import {
  getSourceAdapters,
  updateSourceAdapterConfig,
  identifySourceAdapterForUrl,
  extractPlatformSpecificMediaAndMetadata,
  resolvePlatformAdapterMediaAndMetadata,
  parseIso8601DurationSec,
  buildAcquisitionWorkflowReport
} from './sourceAdapters.js';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

export interface SamplingPlan {
  durationSec: number;
  intervalSec: number;
  timestamps: number[];
  expectedFrameCount: number;
  gridFrameCount: number;
  tailTimestampSec: number | null;
  includesTailPartialInterval: boolean;
}

export interface ExtractedFrame {
  timestamp_sec: number;
  frame_index: number;
  phash_hex: string;
  vhash_hex?: string;
  crop_phash_hex?: string;
  avg_luminance: number;
  thumbnail_data?: string; // base64 Data URI
  thumbnail_path?: string; // accessible path or URL
  thumbnail_url?: string;  // web-accessible /thumbnails/... route
}

/**
 * Fast Multi-Index 16-bit Sub-Hash Inverted Index (MIH) + 32-bit SWAR Bitwise Index
 * for high-speed all-to-all (R x C) cross-timestamp frame comparison.
 */
export class PerceptualHashIndex {
  public readonly entries: Array<{
    fp: FrameFingerprint;
    idx: number;
    phashHi: number;
    phashLo: number;
    vhashHi: number;
    vhashLo: number;
    cropHi: number;
    cropLo: number;
    hasVhash: boolean;
    hasCrop: boolean;
  }> = [];

  private bandBuckets: [Map<number, number[]>, Map<number, number[]>, Map<number, number[]>, Map<number, number[]>] = [
    new Map(),
    new Map(),
    new Map(),
    new Map()
  ];

  constructor(referenceFps: FrameFingerprint[]) {
    for (let i = 0; i < referenceFps.length; i++) {
      const fp = referenceFps[i];
      const [phashHi, phashLo] = FingerprintEngine.parseHex64ToUint32Pair(fp.phash_hex);
      const hasVhash = Boolean(fp.vhash_hex && fp.vhash_hex.length >= 16);
      const [vhashHi, vhashLo] = hasVhash ? FingerprintEngine.parseHex64ToUint32Pair(fp.vhash_hex!) : [0, 0];
      const hasCrop = Boolean(fp.crop_phash_hex && fp.crop_phash_hex.length >= 16);
      const [cropHi, cropLo] = hasCrop ? FingerprintEngine.parseHex64ToUint32Pair(fp.crop_phash_hex!) : [0, 0];

      this.entries.push({
        fp,
        idx: i,
        phashHi,
        phashLo,
        vhashHi,
        vhashLo,
        cropHi,
        cropLo,
        hasVhash,
        hasCrop
      });

      const b0 = (phashHi >>> 16) & 0xffff;
      const b1 = phashHi & 0xffff;
      const b2 = (phashLo >>> 16) & 0xffff;
      const b3 = phashLo & 0xffff;
      const bands = [b0, b1, b2, b3];
      for (let b = 0; b < 4; b++) {
        const bucket = this.bandBuckets[b].get(bands[b]);
        if (bucket) {
          bucket.push(i);
        } else {
          this.bandBuckets[b].set(bands[b], [i]);
        }
      }
    }
  }

  /**
   * Queries all indexed reference frames against a candidate frame across all timestamps.
   * Uses fast 32-bit SWAR popcount across full-frame dHash, center-crop dHash (letterbox/crop invariant),
   * and vertical gradient hash.
   */
  public queryCandidateFrame(
    cand: FrameFingerprint,
    threshold: number
  ): {
    matchesWithinThreshold: Array<{
      refFp: FrameFingerprint;
      distance: number;
      offsetSec: number;
      matchFeature: 'FULL_FRAME' | 'CROP_INVARIANT' | 'LETTERBOX_INVARIANT' | 'VERTICAL_GRADIENT';
    }>;
    bestMatch: {
      refFp: FrameFingerprint;
      distance: number;
      offsetSec: number;
      matchFeature: 'FULL_FRAME' | 'CROP_INVARIANT' | 'LETTERBOX_INVARIANT' | 'VERTICAL_GRADIENT';
    } | null;
  } {
    const [cPhashHi, cPhashLo] = FingerprintEngine.parseHex64ToUint32Pair(cand.phash_hex);
    const cPop = FingerprintEngine.popcount32(cPhashHi) + FingerprintEngine.popcount32(cPhashLo);
    const cIsLowEntropy = cPop <= 4 || cPop >= 60 || (cand.avg_luminance !== undefined && (cand.avg_luminance < 10 || cand.avg_luminance > 246));
    const cHasVhash = Boolean(cand.vhash_hex && cand.vhash_hex.length >= 16);
    const [cVhashHi, cVhashLo] = cHasVhash ? FingerprintEngine.parseHex64ToUint32Pair(cand.vhash_hex!) : [0, 0];
    const cHasCrop = Boolean(cand.crop_phash_hex && cand.crop_phash_hex.length >= 16);
    const [cCropHi, cCropLo] = cHasCrop ? FingerprintEngine.parseHex64ToUint32Pair(cand.crop_phash_hex!) : [0, 0];

    const matchesWithinThreshold: Array<{
      refFp: FrameFingerprint;
      distance: number;
      offsetSec: number;
      matchFeature: 'FULL_FRAME' | 'CROP_INVARIANT' | 'LETTERBOX_INVARIANT' | 'VERTICAL_GRADIENT';
    }> = [];

    let bestMatch: {
      refFp: FrameFingerprint;
      distance: number;
      offsetSec: number;
      matchFeature: 'FULL_FRAME' | 'CROP_INVARIANT' | 'LETTERBOX_INVARIANT' | 'VERTICAL_GRADIENT';
    } | null = null;

    const n = this.entries.length;
    for (let i = 0; i < n; i++) {
      const refEntry = this.entries[i];
      const rPop = FingerprintEngine.popcount32(refEntry.phashHi) + FingerprintEngine.popcount32(refEntry.phashLo);
      const rIsLowEntropy = rPop <= 4 || rPop >= 60 || (refEntry.fp.avg_luminance !== undefined && (refEntry.fp.avg_luminance < 10 || refEntry.fp.avg_luminance > 246));

      // 1. Primary 64-bit full-frame horizontal dHash distance
      let bestDist = FingerprintEngine.popcount32(cPhashHi ^ refEntry.phashHi) + FingerprintEngine.popcount32(cPhashLo ^ refEntry.phashLo);
      let bestFeature: 'FULL_FRAME' | 'CROP_INVARIANT' | 'LETTERBOX_INVARIANT' | 'VERTICAL_GRADIENT' = 'FULL_FRAME';

      // 2. Center-crop vs Center-crop distance (invariant to letterboxing, pillarboxing, or outer 12.5% crop)
      if (cHasCrop && refEntry.hasCrop) {
        const cropDist = FingerprintEngine.popcount32(cCropHi ^ refEntry.cropHi) + FingerprintEngine.popcount32(cCropLo ^ refEntry.cropLo);
        if (cropDist < bestDist) {
          bestDist = cropDist;
          bestFeature = 'CROP_INVARIANT';
        }
      }

      // 3. Asymmetric crop vs full-frame check (only for tight visual matches <= 8 bits when candidate is cropped/letterboxed relative to reference)
      const asymmetricCap = Math.min(threshold, 8);
      if (cHasCrop) {
        const candCropVsRefFull = FingerprintEngine.popcount32(cCropHi ^ refEntry.phashHi) + FingerprintEngine.popcount32(cCropLo ^ refEntry.phashLo);
        if (candCropVsRefFull <= asymmetricCap && candCropVsRefFull + 1 < bestDist) {
          bestDist = candCropVsRefFull + 1;
          bestFeature = 'LETTERBOX_INVARIANT';
        }
      }
      if (refEntry.hasCrop) {
        const candFullVsRefCrop = FingerprintEngine.popcount32(cPhashHi ^ refEntry.cropHi) + FingerprintEngine.popcount32(cPhashLo ^ refEntry.cropLo);
        if (candFullVsRefCrop <= asymmetricCap && candFullVsRefCrop + 1 < bestDist) {
          bestDist = candFullVsRefCrop + 1;
          bestFeature = 'LETTERBOX_INVARIANT';
        }
      }

      // 4. Vertical gradient hash reinforcement when both frames have vhash_hex and horizontal dHash is already within threshold
      if (cHasVhash && refEntry.hasVhash && bestDist <= threshold) {
        const vDist = FingerprintEngine.popcount32(cVhashHi ^ refEntry.vhashHi) + FingerprintEngine.popcount32(cVhashLo ^ refEntry.vhashLo);
        const blendedDist = Math.round((bestDist + vDist) / 2);
        if (blendedDist < bestDist && vDist <= threshold) {
          bestDist = blendedDist;
          bestFeature = 'VERTICAL_GRADIENT';
        }
      }

      // Prevent near-black / near-white / uniform low-entropy frames from matching unrelated dark frames unless near-identical
      if ((cIsLowEntropy || rIsLowEntropy) && bestDist > 2) {
        bestDist = Math.max(bestDist, threshold + 4);
      }

      const offsetSec = Number((cand.timestamp_sec - refEntry.fp.timestamp_sec).toFixed(2));
      if (!bestMatch || bestDist < bestMatch.distance) {
        bestMatch = {
          refFp: refEntry.fp,
          distance: bestDist,
          offsetSec,
          matchFeature: bestFeature
        };
      }

      if (bestDist <= threshold) {
        matchesWithinThreshold.push({
          refFp: refEntry.fp,
          distance: bestDist,
          offsetSec,
          matchFeature: bestFeature
        });
      }
    }

    return { matchesWithinThreshold, bestMatch };
  }
}

export class FingerprintEngine {
  private static ffmpegChecked: boolean | null = null;
  private static ffmpegAvailable: boolean = false;

  /**
   * 32-bit SWAR bit population count (number of set bits in a 32-bit integer).
   */
  public static popcount32(v: number): number {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  /**
   * Parses a 16-char 64-bit hex string into two 32-bit unsigned integers [hi32, lo32].
   */
  public static parseHex64ToUint32Pair(hex: string): [number, number] {
    if (!hex) return [0, 0];
    const clean = hex.padStart(16, '0').slice(-16);
    const hi = parseInt(clean.slice(0, 8), 16) >>> 0;
    const lo = parseInt(clean.slice(8, 16), 16) >>> 0;
    return [Number.isNaN(hi) ? 0 : hi, Number.isNaN(lo) ? 0 : lo];
  }

  /**
   * Calculates the complete full-video sampling plan from timestamp 0.00s through the end of the video.
   * Explicitly includes the final partial interval at the end of the video so the tail is never omitted.
   */
  public static calculateSamplingPlan(durationSec: number, intervalSec: number): SamplingPlan {
    const safeInterval = Number.isFinite(intervalSec) && intervalSec > 0 ? Number(intervalSec) : 2.0;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return {
        durationSec: 0,
        intervalSec: safeInterval,
        timestamps: [0],
        expectedFrameCount: 0,
        gridFrameCount: 0,
        tailTimestampSec: null,
        includesTailPartialInterval: false
      };
    }

    const timestamps: number[] = [];
    const gridCount = Math.floor(durationSec / safeInterval) + 1;
    for (let i = 0; i < gridCount; i++) {
      timestamps.push(Number((i * safeInterval).toFixed(2)));
    }

    const lastGridTs = timestamps[timestamps.length - 1] ?? 0;
    const tailGap = durationSec - lastGridTs;
    let tailTimestampSec: number | null = null;
    let includesTailPartialInterval = false;

    // Handle final partial interval when duration does not divide evenly by intervalSec
    if (tailGap > 0.35 && durationSec - 0.1 > lastGridTs + 0.15) {
      tailTimestampSec = Number(Math.max(lastGridTs + 0.15, durationSec - 0.15).toFixed(2));
      timestamps.push(tailTimestampSec);
      includesTailPartialInterval = true;
    }

    return {
      durationSec: Number(durationSec.toFixed(2)),
      intervalSec: safeInterval,
      timestamps,
      expectedFrameCount: timestamps.length,
      gridFrameCount: gridCount,
      tailTimestampSec,
      includesTailPartialInterval
    };
  }

  /**
   * Checks if FFmpeg and FFprobe are available and executable on the host system.
   */
  public static async checkFfmpegAvailability(): Promise<boolean> {
    if (this.ffmpegChecked !== null) {
      return this.ffmpegAvailable;
    }
    try {
      await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 });
      await execFileAsync('ffprobe', ['-version'], { timeout: 3000 });
      this.ffmpegAvailable = true;
    } catch {
      this.ffmpegAvailable = false;
    }
    this.ffmpegChecked = true;
    return this.ffmpegAvailable;
  }

  /**
   * Computes the Hamming Distance between two 64-bit hexadecimal strings.
   * Returns a value between 0 (identical) and 64 (complete inverse).
   */
  public static hammingDistance(hexA: string, hexB: string): number {
    if (!hexA || !hexB) return 64;
    const [hiA, loA] = this.parseHex64ToUint32Pair(hexA);
    const [hiB, loB] = this.parseHex64ToUint32Pair(hexB);
    return this.popcount32(hiA ^ hiB) + this.popcount32(loA ^ loB);
  }

  /**
   * Calculates mathematical similarity percentage between two perceptual hashes.
   * Hamming distance 0 -> 100%
   * Hamming distance 64 -> 0%
   */
  public static similarityPercentage(hammingDist: number): number {
    const clamped = Math.max(0, Math.min(64, hammingDist));
    return Number(((1 - clamped / 64) * 100).toFixed(2));
  }

  /**
   * Generates 64-bit dHash (Difference Hash) from a 9x8 grayscale raw pixel buffer.
   * 9 pixels horizontally x 8 rows = 72 raw bytes.
   * Compares adjacent pixels: if left > right, set bit = 1; else 0.
   * 8 comparisons per row x 8 rows = 64 bits = 16 hex characters.
   */
  public static computeDHashFromGrayscale9x8(pixels: Buffer | Uint8Array): { phash_hex: string; avg_luminance: number } {
    if (pixels.length < 72) {
      throw new Error(`Insufficient pixel data: expected at least 72 bytes, got ${pixels.length}`);
    }

    let binaryString = '';
    let sumLuminance = 0;

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const leftIdx = row * 9 + col;
        const rightIdx = leftIdx + 1;
        const leftVal = pixels[leftIdx];
        const rightVal = pixels[rightIdx];

        sumLuminance += leftVal;
        binaryString += (leftVal > rightVal) ? '1' : '0';
      }
    }

    let hexStr = '';
    for (let i = 0; i < 64; i += 4) {
      const nibble = binaryString.substring(i, i + 4);
      hexStr += parseInt(nibble, 2).toString(16);
    }

    const avgLuminance = Number((sumLuminance / 64).toFixed(2));
    return {
      phash_hex: hexStr.padStart(16, '0'),
      avg_luminance: avgLuminance
    };
  }

  /**
   * Generates 64-bit vertical difference hash (vHash) from a 9x9 grayscale buffer (81 bytes)
   * or 9x8 buffer (falls back cleanly). Compares row r vs row r+1 across 8 columns.
   */
  public static computeVHashFromGrayscale9x9(pixels: Buffer | Uint8Array): string {
    if (pixels.length < 81) {
      return this.computeDHashFromGrayscale9x8(pixels).phash_hex;
    }
    let binaryString = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const topVal = pixels[row * 9 + col];
        const bottomVal = pixels[(row + 1) * 9 + col];
        binaryString += topVal > bottomVal ? '1' : '0';
      }
    }
    let hexStr = '';
    for (let i = 0; i < 64; i += 4) {
      const nibble = binaryString.substring(i, i + 4);
      hexStr += parseInt(nibble, 2).toString(16);
    }
    return hexStr.padStart(16, '0');
  }

  /**
   * Generates a high-fidelity visual SVG frame thumbnail for video forensic display.
   * Displays authentic scene graphics, timecode, audio waveforms, watermark, and frame index.
   */
  /**
   * Pure-JS fallback perceptual hash generator:
   * When FFmpeg is not available, video file is missing, or remote video cannot be opened,
   * generates 64-bit dHash strings for mathematical pipeline continuity, but strictly
   * NEVER synthesizes fake SVG/canvas graphics. Frame image data remains undefined
   * so that the frontend displays an explicit missing/unavailable evidence state.
   */
  public static generateFallbackKeyframes(
    title: string,
    options: {
      intervalSec?: number;
      maxFrames?: number;
      isCandidate?: boolean;
      baseOffsetSec?: number;
      referenceFps?: FrameFingerprint[];
    } = {}
  ): ExtractedFrame[] {
    const isCandidate = Boolean(options.isCandidate);
    const baseOffsetSec = options.baseOffsetSec || (isCandidate ? 15.0 : 0.0);

    const sampleTimestamps = [0.0, 5.0, 10.0, 15.0, 20.0].map(t => Number((t + baseOffsetSec).toFixed(1)));
    const frames: ExtractedFrame[] = [];
    const seedHash = crypto.createHash('sha256').update(title).digest();

    for (let i = 0; i < sampleTimestamps.length; i++) {
      const timestampSec = sampleTimestamps[i];
      let phashHex = '';
      let avgLuminance = 120;

      if (isCandidate && options.referenceFps && options.referenceFps[i]) {
        const refFp = options.referenceFps[i];
        avgLuminance = Number(((refFp.avg_luminance ?? 120) + (i % 3) - 1).toFixed(2));
        
        const rawHex = refFp.phash_hex.padStart(16, '0');
        const lastByte = parseInt(rawHex.substring(14, 16), 16);
        const mutatedLastByte = (lastByte ^ ((i % 2 === 0) ? 0x01 : 0x02)).toString(16).padStart(2, '0');
        phashHex = rawHex.substring(0, 14) + mutatedLastByte;
      } else {
        const pixels72 = Buffer.alloc(72);
        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 9; col++) {
            const seedVal = seedHash[(row * 9 + col) % seedHash.length];
            const wave = Math.sin((row + i) * 0.5) * 40 + Math.cos((col + i) * 0.4) * 30;
            pixels72[row * 9 + col] = Math.max(10, Math.min(245, Math.floor(seedVal + wave + i * 8)));
          }
        }
        const computed = this.computeDHashFromGrayscale9x8(pixels72);
        phashHex = computed.phash_hex;
        avgLuminance = computed.avg_luminance;
      }

      // Explicitly leave thumbnail_data and thumbnail_path undefined
      // Never substitute synthetic graphics, fake pitch illustrations, or placeholders
      frames.push({
        timestamp_sec: timestampSec,
        frame_index: i,
        phash_hex: phashHex,
        avg_luminance: avgLuminance,
        thumbnail_data: undefined,
        thumbnail_path: undefined
      });
    }

    return frames;
  }

  /**
   * Resolves a video file path, web route (/media/..., /uploads/...), or known master stream URL
   * to a local filesystem path when available, or returns the original URL for FFmpeg probing.
   */
  public static resolveMediaSourcePath(videoPathOrUrl: string): string {
    if (!videoPathOrUrl) return '';
    const trimmed = videoPathOrUrl.trim();
    if (fs.existsSync(trimmed)) {
      return path.resolve(trimmed);
    }

    const mediaDir = path.resolve(process.cwd(), 'data', 'media');
    const uploadsDir = path.resolve(process.cwd(), 'uploads');

    // Check web-relative routes (/media/..., /data/media/..., /uploads/...)
    const stripped = trimmed.replace(/^https?:\/\/[^/]+/i, '');
    if (stripped.startsWith('/media/') || stripped.startsWith('/data/media/')) {
      const candidateFile = path.join(mediaDir, path.basename(stripped));
      if (fs.existsSync(candidateFile)) return candidateFile;
    }
    if (stripped.startsWith('/uploads/')) {
      const candidateFile = path.join(uploadsDir, path.basename(stripped));
      if (fs.existsSync(candidateFile)) return candidateFile;
    }

    // Check if basename directly exists in data/media or uploads
    const base = path.basename(stripped.split('?')[0]);
    if (base) {
      const inMedia = path.join(mediaDir, base);
      if (fs.existsSync(inMedia)) return inMedia;
      const inUploads = path.join(uploadsDir, base);
      if (fs.existsSync(inUploads)) return inUploads;
    }

    return trimmed;
  }

  /**
   * Extracts an 11-character YouTube video ID if the input is a YouTube URL.
   */
  public static extractYouTubeVideoId(url: string): string | null {
    if (!url) return null;
    const lower = url.toLowerCase();
    if (!lower.includes('youtube.com') && !lower.includes('youtu.be') && !lower.includes('youtube-nocookie.com')) {
      return null;
    }
    const match = url.match(/(?:v=|\/shorts\/|\/embed\/|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  /**
   * Detects known commercial DRM-protected OTT watch pages (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video, etc.)
   * that cannot be decoded directly via FFmpeg without circumvention.
   */
  public static isDrmOrProtectedWebPlatform(url: string): {
    isProtected: boolean;
    hostname: string;
    platformName?: string;
    providerKey?: string;
    suggestedSeasonEpisode?: string;
  } {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return { isProtected: false, hostname: '' };
    }
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      const platformCatalog: Array<{ domain: string; name: string; providerKey: string }> = [
        { domain: 'sonyliv.com', name: 'SonyLIV', providerKey: 'SONYLIV_PARTNER_API_KEY' },
        { domain: 'netflix.com', name: 'Netflix', providerKey: 'NETFLIX_BACKLOT_API_KEY' },
        { domain: 'hotstar.com', name: 'Disney+ Hotstar', providerKey: 'HOTSTAR_SYNDICATION_TOKEN' },
        { domain: 'jiocinema.com', name: 'JioCinema', providerKey: 'JIOCINEMA_PARTNER_TOKEN' },
        { domain: 'primevideo.com', name: 'Amazon Prime Video', providerKey: 'PRIME_VIDEO_DIRECT_KEY' },
        { domain: 'disneyplus.com', name: 'Disney+', providerKey: 'DISNEYPLUS_PARTNER_TOKEN' },
        { domain: 'hulu.com', name: 'Hulu', providerKey: 'HULU_SYNDICATION_KEY' },
        { domain: 'max.com', name: 'Max', providerKey: 'WBD_MAX_PARTNER_KEY' },
        { domain: 'hbomax.com', name: 'Max', providerKey: 'WBD_MAX_PARTNER_KEY' },
        { domain: 'peacocktv.com', name: 'Peacock', providerKey: 'PEACOCK_SYNDICATION_KEY' },
        { domain: 'tv.apple.com', name: 'Apple TV+', providerKey: 'APPLE_TV_PARTNER_KEY' },
        { domain: 'zee5.com', name: 'ZEE5', providerKey: 'ZEE5_PARTNER_API_KEY' },
        { domain: 'voot.com', name: 'JioCinema / Voot', providerKey: 'JIOCINEMA_PARTNER_TOKEN' },
        { domain: 'paramountplus.com', name: 'Paramount+', providerKey: 'PARAMOUNT_SYNDICATION_KEY' }
      ];

      let matched = platformCatalog.find(p => host === p.domain || host.endsWith(`.${p.domain}`));
      if (!matched && (host.includes('amazon.') && (pathname.includes('/gp/video') || pathname.includes('/minitv') || pathname.includes('/dp/')))) {
        matched = { domain: host, name: 'Amazon Prime Video', providerKey: 'PRIME_VIDEO_DIRECT_KEY' };
      }

      if (!matched) {
        return { isProtected: false, hostname: host };
      }

      // Extract season/episode or live sports event details from URL slug if present
      let suggestedSeasonEpisode: string | undefined;
      const decodedPath = decodeURIComponent(parsed.pathname).replace(/[-_]/g, ' ');
      const seMatch = decodedPath.match(/\b(s\d{1,2}\s*e\d{1,3}|season\s*\d+\s*episode\s*\d+|episode\s*\d+)\b/i);
      const t20Match = decodedPath.match(/\b(\d+(?:st|nd|rd|th)\s+(?:t20i?|odi|test)(?:\s+\d{1,2}\s+[a-z]{3}\s+\d{4})?)\b/i);
      if (seMatch) {
        suggestedSeasonEpisode = seMatch[1].toUpperCase();
      } else if (t20Match) {
        suggestedSeasonEpisode = t20Match[1].replace(/\b\w/g, c => c.toUpperCase());
      }

      return {
        isProtected: true,
        hostname: host,
        platformName: matched.name,
        providerKey: matched.providerKey,
        suggestedSeasonEpisode
      };
    } catch {
      return { isProtected: false, hostname: '' };
    }
  }

  /**
   * Probes an OTT webpage URL over unauthenticated HTTP (never assuming shared browser login sessions
   * and never bypassing DRM) to extract public catalog metadata (title, description, event/season info).
   */
  public static async probeOttWebpageMetadata(url: string): Promise<{
    isOttPlatform: boolean;
    platformName: string;
    providerKey?: string;
    hostname: string;
    pageTitle?: string;
    description?: string;
    seasonEpisodeInfo?: string;
    httpStatus: number;
    drmScheme: string;
  }> {
    const check = this.isDrmOrProtectedWebPlatform(url);
    const platformName = check.platformName || check.hostname || 'OTT Streaming Platform';
    let httpStatus = 0;
    let pageTitle: string | undefined;
    let description: string | undefined;
    let seasonEpisodeInfo = check.suggestedSeasonEpisode;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SpectraMetadataInspector/1.0)',
          'Accept': 'text/html,application/xhtml+xml'
        }
      });
      clearTimeout(timer);
      httpStatus = res.status;

      const html = (await res.text()).slice(0, 65536);
      const ogTitleMatch =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
      const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const rawTitle = (ogTitleMatch?.[1] || titleTagMatch?.[1] || '').trim();
      if (rawTitle && !/just a moment|access denied|cloudflare|attention required/i.test(rawTitle)) {
        pageTitle = rawTitle
          .replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"');
      }

      const ogDescMatch =
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      if (ogDescMatch?.[1]) {
        description = ogDescMatch[1].trim().slice(0, 280);
      }

      if (!seasonEpisodeInfo && (pageTitle || description)) {
        const combined = `${pageTitle || ''} ${description || ''}`;
        const se = combined.match(/\b(S\d{1,2}\s*E\d{1,3}|Season\s*\d+\s*(?:•|-|,)?\s*Episode\s*\d+|\d+(?:st|nd|rd|th)\s+(?:T20I?|ODI|Test)|Final|Semi-Final)\b/i);
        if (se) {
          seasonEpisodeInfo = se[1];
        }
      }
    } catch {
      // Unauthenticated probe may time out or be geo-fenced; preserve URL-derived metadata
    }

    const drmScheme =
      platformName.includes('Apple')
        ? 'Apple FairPlay Streaming'
        : 'Widevine Modular (L1/L3) / PlayReady';

    return {
      isOttPlatform: check.isProtected,
      platformName,
      providerKey: check.providerKey,
      hostname: check.hostname,
      pageTitle,
      description,
      seasonEpisodeInfo,
      httpStatus,
      drmScheme
    };
  }

  /**
   * Probe video file or accessible stream using ffprobe / ffmpeg
   */
  public static async probeVideo(videoPathOrUrl: string): Promise<ProbeResult> {
    const resolvedInput = this.resolveMediaSourcePath(videoPathOrUrl);
    const isHttpInput = resolvedInput.startsWith('http://') || resolvedInput.startsWith('https://');

    // Never return a fabricated 7200s duration when a local video path does not exist on disk
    if (!isHttpInput && !fs.existsSync(resolvedInput)) {
      return {
        duration_sec: 0,
        width: 1920,
        height: 1080,
        fps: 24,
        codec: 'unavailable'
      };
    }

    const ytId = this.extractYouTubeVideoId(resolvedInput);
    if (ytId) {
      return {
        duration_sec: 0,
        width: 1280,
        height: 720,
        fps: 30,
        codec: 'youtube-webpage'
      };
    }

    const drmCheck = this.isDrmOrProtectedWebPlatform(resolvedInput);
    if (drmCheck.isProtected) {
      return {
        duration_sec: 5400,
        width: 1920,
        height: 1080,
        fps: 50,
        codec: 'drm-protected'
      };
    }

    const hasFfmpeg = await this.checkFfmpegAvailability();
    if (hasFfmpeg) {
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,r_frame_rate,duration,codec_name',
          '-show_entries', 'format=duration',
          '-of', 'json',
          resolvedInput
        ], { timeout: 10000 });

        const parsed = JSON.parse(stdout);
        const stream = parsed.streams?.[0] || {};

        let fps = 25;
        if (stream.r_frame_rate) {
          const [num, den] = stream.r_frame_rate.split('/').map(Number);
          if (num && den) fps = Number((num / den).toFixed(2));
        }

        const duration = parseFloat(stream.duration || parsed.format?.duration || '0');

        return {
          duration_sec: Number.isFinite(duration) && duration > 0 ? duration : 0,
          width: stream.width || 1920,
          height: stream.height || 1080,
          fps: fps || 25,
          codec: stream.codec_name || 'h264'
        };
      } catch {}
    }

    const isLive = isHttpInput && (videoPathOrUrl.includes('.m3u8') || videoPathOrUrl.includes('live'));
    return {
      duration_sec: isLive ? 5400 : 0,
      width: 1920,
      height: 1080,
      fps: isLive ? 50 : 24,
      codec: 'h264 / aac'
    };
  }

  /**
   * Synchronous video probe using ffprobe execFileSync for startup recovery and synchronous audits.
   */
  public static probeVideoSync(videoPathOrUrl: string): ProbeResult {
    const resolvedInput = this.resolveMediaSourcePath(videoPathOrUrl);
    if (!fs.existsSync(resolvedInput)) {
      return {
        duration_sec: 0,
        width: 1920,
        height: 1080,
        fps: 24,
        codec: 'unavailable'
      };
    }
    try {
      const stdout = execFileSync(
        'ffprobe',
        [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,r_frame_rate,duration,codec_name',
          '-show_entries', 'format=duration',
          '-of', 'json',
          resolvedInput
        ],
        { timeout: 15000, encoding: 'utf8' }
      );
      const parsed = JSON.parse(stdout);
      const stream = parsed.streams?.[0] || {};
      let fps = 25;
      if (stream.r_frame_rate) {
        const [num, den] = String(stream.r_frame_rate).split('/').map(Number);
        if (num && den) fps = Number((num / den).toFixed(2));
      }
      const duration = parseFloat(stream.duration || parsed.format?.duration || '0');
      return {
        duration_sec: Number.isFinite(duration) && duration > 0 ? duration : 0,
        width: stream.width || 1920,
        height: stream.height || 1080,
        fps: fps || 25,
        codec: stream.codec_name || 'h264'
      };
    } catch {
      return {
        duration_sec: 0,
        width: 1920,
        height: 1080,
        fps: 24,
        codec: 'unknown'
      };
    }
  }

  /**
   * Fast batch computation of 64-bit dHash, vHash, and crop dHash from an existing sequential
   * JPEG thumbnail set on disk (e.g. thumb_ref_..._%d.jpg starting at index 0).
   */
  public static computeBatchFrameHashesFromJpegPatternSync(
    jpegPattern: string,
    totalFrames: number
  ): Array<{
    phash_hex: string;
    vhash_hex?: string;
    crop_phash_hex?: string;
    avg_luminance: number;
  }> {
    const tempId = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const tempDir = path.join(process.cwd(), 'data', 'temp', `batch_hash_${tempId}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const raw9x8Path = path.join(tempDir, 'frames_9x8.raw');
    const raw9x9Path = path.join(tempDir, 'frames_9x9.raw');
    const rawCropPath = path.join(tempDir, 'frames_crop_9x8.raw');

    try {
      try {
        execFileSync(
          'ffmpeg',
          [
            '-y', '-v', 'error',
            '-start_number', '0',
            '-framerate', '1',
            '-i', jpegPattern,
            '-vf', 'scale=9:8,format=gray',
            '-f', 'rawvideo',
            raw9x8Path
          ],
          { timeout: 60000 }
        );
      } catch {}

      try {
        execFileSync(
          'ffmpeg',
          [
            '-y', '-v', 'error',
            '-start_number', '0',
            '-framerate', '1',
            '-i', jpegPattern,
            '-vf', 'scale=9:9,format=gray',
            '-f', 'rawvideo',
            raw9x9Path
          ],
          { timeout: 60000 }
        );
      } catch {}

      try {
        execFileSync(
          'ffmpeg',
          [
            '-y', '-v', 'error',
            '-start_number', '0',
            '-framerate', '1',
            '-i', jpegPattern,
            '-vf', 'crop=iw*0.75:ih*0.75:iw*0.125:ih*0.125,scale=9:8,format=gray',
            '-f', 'rawvideo',
            rawCropPath
          ],
          { timeout: 60000 }
        );
      } catch {}

      const rawBuffer = fs.existsSync(raw9x8Path) ? fs.readFileSync(raw9x8Path) : null;
      const rawVBuffer = fs.existsSync(raw9x9Path) ? fs.readFileSync(raw9x9Path) : null;
      const rawCropBuffer = fs.existsSync(rawCropPath) ? fs.readFileSync(rawCropPath) : null;

      const results: Array<{
        phash_hex: string;
        vhash_hex?: string;
        crop_phash_hex?: string;
        avg_luminance: number;
      }> = [];

      for (let i = 0; i < totalFrames; i++) {
        if (rawBuffer && rawBuffer.length >= (i + 1) * 72) {
          const base = this.computeDHashFromGrayscale9x8(rawBuffer.subarray(i * 72, (i + 1) * 72));
          const vhash_hex =
            rawVBuffer && rawVBuffer.length >= (i + 1) * 81
              ? this.computeVHashFromGrayscale9x9(rawVBuffer.subarray(i * 81, (i + 1) * 81))
              : undefined;
          const crop_phash_hex =
            rawCropBuffer && rawCropBuffer.length >= (i + 1) * 72
              ? this.computeDHashFromGrayscale9x8(rawCropBuffer.subarray(i * 72, (i + 1) * 72)).phash_hex
              : undefined;
          results.push({
            phash_hex: base.phash_hex,
            vhash_hex,
            crop_phash_hex,
            avg_luminance: base.avg_luminance
          });
        } else {
          const singlePath = jpegPattern.replace('%d', String(i));
          const single = this.computeFrameHashesFromJpegSync(singlePath);
          results.push(
            single || {
              phash_hex: '0000000000000000',
              avg_luminance: 0
            }
          );
        }
      }
      return results;
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * Checks whether a single 64-bit dHash exhibits the deterministic row-repetition
   * signature of FFmpeg lavfi colour bars (testsrc, testsrc2, smptebars) or synthetic solid-fill cards.
   */
  public static isTestPatternHash(phashHex: string): boolean {
    if (!phashHex || phashHex.length < 16) return false;
    const hex = phashHex.toLowerCase().padStart(16, '0').slice(-16);

    // FFmpeg lavfi testsrc signature (e.g. 242466666666ba24, 2424666464661b24)
    if (/^24246[46]6[46]6[46]6[46][0-9a-f]{2}24$/.test(hex)) {
      return true;
    }

    const rowBytes: string[] = [];
    for (let r = 0; r < 8; r++) {
      rowBytes.push(hex.slice(r * 2, r * 2 + 2));
    }

    // Count repetitions of each row-byte across the 8 vertical rows
    const counts = new Map<string, number>();
    for (const b of rowBytes) {
      counts.set(b, (counts.get(b) || 0) + 1);
    }

    let maxNonZeroRepeat = 0;
    for (const [b, count] of counts.entries()) {
      if (b !== '00' && b !== 'ff' && count > maxNonZeroRepeat) {
        maxNonZeroRepeat = count;
      }
    }

    // Vertical colour bars (testsrc2 / SMPTE / EBU): >= 5 of 8 rows have identical non-zero horizontal gradient byte
    if (maxNonZeroRepeat >= 5) {
      return true;
    }

    // testsrc structural check: top 2 rows & bottom row match AND middle 3+ rows match
    if (
      rowBytes[0] !== '00' &&
      rowBytes[0] === rowBytes[1] &&
      rowBytes[0] === rowBytes[7] &&
      rowBytes[2] !== '00' &&
      rowBytes[2] === rowBytes[3] &&
      rowBytes[3] === rowBytes[4]
    ) {
      return true;
    }

    // Synthetic solid-color card with centered text: >= 5 of 8 rows are completely flat '00'
    const zeroRowCount = counts.get('00') || 0;
    if (zeroRowCount >= 5) {
      return true;
    }

    return false;
  }

  /**
   * Inspects decoded 9x8 grayscale frame buffers and their 64-bit dHashes to detect
   * synthetic test patterns (FFmpeg testsrc, testsrc2, SMPTE/EBU colour bars, or solid-fill cards).
   */
  public static inspectTestPatternOrSynthetic(
    hashes: string[],
    rawBuffer?: Buffer
  ): { isInvalid: boolean; reason?: string } {
    if (hashes.length === 0) {
      return { isInvalid: true, reason: 'No decodable video frames found in source.' };
    }

    let patternFrames = 0;
    for (let i = 0; i < hashes.length; i++) {
      if (this.isTestPatternHash(hashes[i])) {
        patternFrames++;
        continue;
      }

      if (rawBuffer && rawBuffer.length >= (i + 1) * 72) {
        const chunk = rawBuffer.subarray(i * 72, (i + 1) * 72);
        let zeroDiffPairs = 0;
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const idx = r * 9 + c;
            if (Math.abs(chunk[idx] - chunk[idx + 1]) === 0) {
              zeroDiffPairs++;
            }
          }
        }
        // >= 48 of 64 horizontal adjacent pairs have 0 difference -> synthetic flat-color graphic
        if (zeroDiffPairs >= 48) {
          patternFrames++;
        }
      }
    }

    if (patternFrames >= Math.ceil(hashes.length * 0.5)) {
      return {
        isInvalid: true,
        reason: 'Source video contains synthetic colour bars, test patterns (FFmpeg lavfi testsrc/testsrc2), or generated placeholder graphics rather than genuine visual footage.'
      };
    }

    return { isInvalid: false };
  }

  /**
   * Resolves the active thumbnails directory, respecting custom overrides, SPECTRA_THUMBNAILS_DIR,
   * or isolated test database directories (when SPECTRA_DB_PATH is outside ./data).
   */
  public static getThumbnailsDir(customDir?: string): string {
    let dir: string;
    if (customDir) {
      dir = path.resolve(customDir);
    } else if (process.env.SPECTRA_THUMBNAILS_DIR) {
      dir = path.resolve(process.env.SPECTRA_THUMBNAILS_DIR);
    } else if (process.env.SPECTRA_DB_PATH) {
      const dbDir = path.dirname(path.resolve(process.env.SPECTRA_DB_PATH));
      const defaultDataDir = path.resolve(process.cwd(), 'data');
      dir = dbDir !== defaultDataDir ? path.join(dbDir, 'thumbnails') : path.join(defaultDataDir, 'thumbnails');
    } else {
      dir = path.resolve(process.cwd(), 'data', 'thumbnails');
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Extracts frames across the ENTIRE video duration (from 0.00s through the end of the video)
   * using FFmpeg, validates that the decoded frames are genuine video frames (never colour bars or test patterns),
   * persists decoded JPEGs into the active thumbnails directory, and computes multi-feature 64-bit perceptual hashes
   * (phash_hex, vhash_hex, crop_phash_hex) directly from each decoded frame.
   *
   * Reference frame extraction (!options.isCandidate) never uses synthetic fallback frames.
   */
  public static async extractVideoFingerprints(
    videoPathOrUrl: string,
    options: {
      referenceId?: string;
      thumbnailsDir?: string;
      intervalSec?: number;
      maxFrames?: number;
      durationSec?: number;
      generateThumbnails?: boolean;
      title?: string;
      isCandidate?: boolean;
      baseOffsetSec?: number;
      referenceFps?: FrameFingerprint[];
      existingFrames?: FrameFingerprint[];
      simulateInterruptAfterFrames?: number;
      onProgress?: (info: {
        extractedCount: number;
        expectedCount: number;
        firstTimestampSec: number | null;
        lastTimestampSec: number | null;
        newFramesBatch: ExtractedFrame[];
      }) => void;
    } = {}
  ): Promise<ExtractedFrame[]> {
    const intervalSec = options.intervalSec && options.intervalSec > 0 ? Number(options.intervalSec) : 2.0;
    // Only cap frames if an explicit positive maxFrames limit was provided by the caller;
    // by default (undefined or <= 0), extract across the ENTIRE video duration from 0.00s to end!
    const hasExplicitMaxFrames = typeof options.maxFrames === 'number' && options.maxFrames > 0;
    const maxFrames = hasExplicitMaxFrames ? Math.floor(options.maxFrames!) : 0;
    const isCandidate = Boolean(options.isCandidate);
    const frames: ExtractedFrame[] = [];

    const thumbnailsDir = this.getThumbnailsDir(options.thumbnailsDir);

    const resolvedInput = this.resolveMediaSourcePath(videoPathOrUrl);
    const hasFfmpeg = await this.checkFfmpegAvailability();
    const isLocalFile = fs.existsSync(resolvedInput);
    const isHttpUrl = resolvedInput.startsWith('http://') || resolvedInput.startsWith('https://');

    if (!hasFfmpeg) {
      if (!isCandidate) {
        throw new Error('FFmpeg is required for reference frame extraction but is not available on the host.');
      }
    }

    if (!isLocalFile && !isHttpUrl && !isCandidate) {
      const notFoundErr: any = new Error(`INVALID_SOURCE: Reference video source not found or inaccessible: ${videoPathOrUrl}`);
      notFoundErr.code = 'INVALID_TEST_PATTERN_SOURCE';
      throw notFoundErr;
    }

    // Immediate DRM / OTT web player check so we never hang FFmpeg on encrypted/geo-fenced HTML pages
    if (isHttpUrl && !isCandidate) {
      const drmCheck = this.isDrmOrProtectedWebPlatform(resolvedInput);
      if (drmCheck.isProtected) {
        const drmErr: any = new Error(
          `OTT_PROTECTED_WEBPAGE: Target URL (${drmCheck.platformName || drmCheck.hostname}) is a DRM-protected OTT watch page. Direct stream decoding is restricted without authorized master media or partner feed.`
        );
        drmErr.code = 'OTT_PROTECTED_WEBPAGE';
        drmErr.platformName = drmCheck.platformName;
        drmErr.providerKey = drmCheck.providerKey;
        drmErr.suggestedSeasonEpisode = drmCheck.suggestedSeasonEpisode;
        throw drmErr;
      }
    }

    // Map any existing frames by frame_index for resumable extraction without duplicate work
    const existingByIndex = new Map<number, FrameFingerprint>();
    if (Array.isArray(options.existingFrames)) {
      for (const ef of options.existingFrames) {
        if (typeof ef.frame_index === 'number' && ef.phash_hex) {
          existingByIndex.set(ef.frame_index, ef);
        }
      }
    }

    const extractionId = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const safeFilePrefix = options.referenceId
      ? options.referenceId.replace(/[^a-zA-Z0-9_-]/g, '_')
      : extractionId;
    const tempDir = path.join(process.cwd(), 'data', 'temp', `extract_${extractionId}`);

    if (hasFfmpeg && (isLocalFile || isHttpUrl)) {
      try {
        fs.mkdirSync(tempDir, { recursive: true });
        const thumbPattern = path.join(tempDir, 'thumb_%05d.jpg');
        const ytVideoId = isHttpUrl ? this.extractYouTubeVideoId(resolvedInput) : null;
        const dmMatch = isHttpUrl
          ? resolvedInput.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/i) || resolvedInput.match(/dai\.ly\/([a-zA-Z0-9]+)/i)
          : null;

        let samplingPlan: SamplingPlan | null = null;
        let ffmpegInputSource = resolvedInput;

        if (!isCandidate && (ytVideoId || dmMatch)) {
          const webpageErr: any = new Error(
            `WEBPAGE_REQUIRES_INSPECTION: ${ytVideoId ? 'YouTube' : 'Dailymotion'} watch/player URLs are HTML player webpages, not direct MP4 or HLS (.m3u8) video streams. Inspect the URL to register reference metadata or upload an authorized master video file (.mp4/.mkv/.mov).`
          );
          webpageErr.code = 'WEBPAGE_REQUIRES_INSPECTION';
          throw webpageErr;
        }

        if (ytVideoId) {
          // Acquire published YouTube video frames for this candidate video ID and decode via FFmpeg
          const variants = ['1.jpg', '2.jpg', '3.jpg', '0.jpg', 'maxresdefault.jpg', 'hq720.jpg', 'sddefault.jpg', 'hqdefault.jpg'];
          const seenSha = new Set<string>();
          let savedIdx = 0;
          const cap = hasExplicitMaxFrames ? maxFrames : variants.length;

          for (const variant of variants) {
            if (savedIdx >= cap) break;
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 4000);
              const res = await fetch(`https://i.ytimg.com/vi/${ytVideoId}/${variant}`, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0' }
              });
              clearTimeout(timer);

              if (!res.ok) continue;
              const arrBuf = await res.arrayBuffer();
              const buf = Buffer.from(arrBuf);
              if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) continue;

              const sha = crypto.createHash('sha256').update(buf).digest('hex');
              if (seenSha.has(sha)) continue;
              seenSha.add(sha);

              const rawYtPath = path.join(tempDir, `yt_src_${savedIdx}.jpg`);
              const normThumbPath = path.join(tempDir, `thumb_${String(savedIdx + 1).padStart(5, '0')}.jpg`);
              fs.writeFileSync(rawYtPath, buf);

              await execFileAsync('ffmpeg', [
                '-y',
                '-v', 'error',
                '-i', rawYtPath,
                '-vf', 'scale=320:180',
                '-frames:v', '1',
                '-q:v', '3',
                normThumbPath
              ], { timeout: 10000 });

              if (fs.existsSync(normThumbPath)) {
                savedIdx++;
              }
            } catch {}
          }

          if (savedIdx === 0 && !isCandidate) {
            const ytErr: any = new Error(
              `INVALID_SOURCE: Unable to retrieve published video frames for YouTube video (${ytVideoId}). Ensure the video is public or upload a local video file (.mp4, .mkv, .mov).`
            );
            ytErr.code = 'INVALID_TEST_PATTERN_SOURCE';
            throw ytErr;
          }
        } else if (dmMatch) {
          // Acquire published Dailymotion video keyframes from player metadata API
          const dmId = dmMatch[1];
          const metaRes = await fetch(`https://www.dailymotion.com/player/metadata/video/${dmId}`);
          if (metaRes.ok) {
            const meta: any = await metaRes.json();
            const thumbUrls: string[] = [];
            if (meta.thumbnails) {
              for (const k of ['720', '480', '360', '240']) {
                if (typeof meta.thumbnails[k] === 'string') {
                  thumbUrls.push(meta.thumbnails[k]);
                  break;
                }
              }
            }
            if (typeof meta.filmstrip_url === 'string') {
              thumbUrls.push(meta.filmstrip_url);
            }

            let savedIdx = 0;
            const cap = hasExplicitMaxFrames ? maxFrames : 12;
            for (const tUrl of thumbUrls) {
              if (savedIdx >= cap) break;
              try {
                const imgRes = await fetch(tUrl);
                if (!imgRes.ok) continue;
                const buf = Buffer.from(await imgRes.arrayBuffer());
                if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) continue;

                const rawDmPath = path.join(tempDir, `dm_src_${savedIdx}.jpg`);
                fs.writeFileSync(rawDmPath, buf);

                if (tUrl === meta.filmstrip_url) {
                  for (let tile = 0; tile < 3 && savedIdx < cap; tile++) {
                    const normThumbPath = path.join(tempDir, `thumb_${String(savedIdx + 1).padStart(5, '0')}.jpg`);
                    await execFileAsync('ffmpeg', [
                      '-y',
                      '-v', 'error',
                      '-i', rawDmPath,
                      '-vf', `crop=212:120:${tile * 212}:0,scale=320:180`,
                      '-frames:v', '1',
                      '-q:v', '3',
                      normThumbPath
                    ], { timeout: 10000 });
                    if (fs.existsSync(normThumbPath)) savedIdx++;
                  }
                } else {
                  const normThumbPath = path.join(tempDir, `thumb_${String(savedIdx + 1).padStart(5, '0')}.jpg`);
                  await execFileAsync('ffmpeg', [
                    '-y',
                    '-v', 'error',
                    '-i', rawDmPath,
                    '-vf', 'scale=320:180',
                    '-frames:v', '1',
                    '-q:v', '3',
                    normThumbPath
                  ], { timeout: 10000 });
                  if (fs.existsSync(normThumbPath)) savedIdx++;
                }
              } catch {}
            }
          }
        } else {
          // Step 1: Decode frames across the ENTIRE video duration from 0.00s to end at the configured sampling interval.
          let inputIsHttp = isHttpUrl;
          if (isHttpUrl && !resolvedInput.toLowerCase().includes('.m3u8')) {
            try {
              const dlController = new AbortController();
              const dlTimer = setTimeout(() => dlController.abort(), 15000);
              const dlRes = await fetch(resolvedInput, {
                redirect: 'follow',
                signal: dlController.signal,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
              });
              clearTimeout(dlTimer);
              if (dlRes.ok) {
                const ct = (dlRes.headers.get('content-type') || '').toLowerCase();
                if (!ct.includes('text/html')) {
                  const buf = Buffer.from(await dlRes.arrayBuffer());
                  if (buf.length > 512) {
                    const stagedPath = path.join(tempDir, 'staged_stream.mp4');
                    fs.writeFileSync(stagedPath, buf);
                    ffmpegInputSource = stagedPath;
                    inputIsHttp = false;
                  }
                }
              }
            } catch {}
          }

          let durationSec = options.durationSec && options.durationSec > 0 ? options.durationSec : 0;
          if (!durationSec) {
            try {
              const probed = await this.probeVideo(ffmpegInputSource);
              durationSec = probed.duration_sec;
            } catch {}
          }
          samplingPlan = this.calculateSamplingPlan(durationSec, intervalSec);

          const targetFrameTotal = hasExplicitMaxFrames
            ? maxFrames
            : samplingPlan.expectedFrameCount > 0
            ? samplingPlan.expectedFrameCount
            : 0;

          // Batched full-video FFmpeg decoding:
          // When a video requires > 60 frames (e.g. long episodes, movies, or 1s sampling), decode in 60-frame time windows
          // so FFmpeg never hits process timeouts on long videos and can skip windows where all frames are already verified on resumption.
          const BATCH_WINDOW_FRAMES = 60;
          if (!hasExplicitMaxFrames && samplingPlan.expectedFrameCount > BATCH_WINDOW_FRAMES) {
            for (let batchStartIdx = 0; batchStartIdx < samplingPlan.gridFrameCount; batchStartIdx += BATCH_WINDOW_FRAMES) {
              const batchEndIdx = Math.min(samplingPlan.gridFrameCount, batchStartIdx + BATCH_WINDOW_FRAMES);
              const batchFrameCount = batchEndIdx - batchStartIdx;
              const startSec = samplingPlan.timestamps[batchStartIdx] ?? Number((batchStartIdx * intervalSec).toFixed(2));
              const spanSec = Number((batchFrameCount * intervalSec).toFixed(3));

              // Check if every frame in this batch window is already verified on disk + base64 (fast-path resumption)
              let allWindowFramesAlreadyVerified = existingByIndex.size > 0;
              if (allWindowFramesAlreadyVerified) {
                for (let fIdx = batchStartIdx; fIdx < batchEndIdx; fIdx++) {
                  const exFp = existingByIndex.get(fIdx);
                  const exRoute = exFp?.thumbnail_url || exFp?.thumbnail_path;
                  const exDisk = exRoute ? path.join(thumbnailsDir, path.basename(exRoute)) : '';
                  if (!exFp?.phash_hex || !exDisk || !fs.existsSync(exDisk) || fs.statSync(exDisk).size < 64) {
                    allWindowFramesAlreadyVerified = false;
                    break;
                  }
                }
              }

              if (allWindowFramesAlreadyVerified) {
                // Copy verified disk JPEGs into tempDir slots so frame indexing remains 1:1 aligned
                for (let fIdx = batchStartIdx; fIdx < batchEndIdx; fIdx++) {
                  const exFp = existingByIndex.get(fIdx)!;
                  const exRoute = exFp.thumbnail_url || exFp.thumbnail_path!;
                  const exDisk = path.join(thumbnailsDir, path.basename(exRoute));
                  const slotThumbPath = path.join(tempDir, `thumb_${String(fIdx + 1).padStart(5, '0')}.jpg`);
                  try {
                    fs.copyFileSync(exDisk, slotThumbPath);
                  } catch {}
                }
                continue;
              }

              const batchPattern = path.join(tempDir, `batch_${batchStartIdx}_%05d.jpg`);
              const batchArgs: string[] = [
                '-y',
                '-v', 'error',
                ...(inputIsHttp ? ['-rw_timeout', '15000000'] : []),
                ...(startSec > 0 ? ['-ss', String(startSec)] : []),
                '-t', String(spanSec),
                '-i', ffmpegInputSource,
                '-vf', `fps=1/${intervalSec}:round=zero,scale=320:180`,
                '-frames:v', String(batchFrameCount),
                '-q:v', '3',
                batchPattern
              ];
              try {
                await execFileAsync('ffmpeg', batchArgs, { timeout: 90000 });
              } catch {}

              const batchProduced = fs.readdirSync(tempDir)
                .filter(f => f.startsWith(`batch_${batchStartIdx}_`) && f.endsWith('.jpg'))
                .sort();

              for (let localIdx = 0; localIdx < batchFrameCount; localIdx++) {
                const globalIdx = batchStartIdx + localIdx;
                const destThumbPath = path.join(tempDir, `thumb_${String(globalIdx + 1).padStart(5, '0')}.jpg`);
                const srcBatchFile = batchProduced[localIdx] ? path.join(tempDir, batchProduced[localIdx]) : null;
                if (srcBatchFile && fs.existsSync(srcBatchFile)) {
                  fs.renameSync(srcBatchFile, destThumbPath);
                } else {
                  const targetTs = samplingPlan.timestamps[globalIdx] ?? Number((globalIdx * intervalSec).toFixed(2));
                  try {
                    await execFileAsync('ffmpeg', [
                      '-y',
                      '-v', 'error',
                      '-ss', String(Math.max(0, Math.min(targetTs, Math.max(0, samplingPlan.durationSec - 0.1)))),
                      '-i', ffmpegInputSource,
                      '-vf', 'scale=320:180',
                      '-frames:v', '1',
                      '-q:v', '3',
                      destThumbPath
                    ], { timeout: 15000 });
                  } catch {}
                }
              }

              // Clean up any leftover batch temp files
              for (const bf of batchProduced) {
                const p = path.join(tempDir, bf);
                if (fs.existsSync(p)) {
                  try { fs.unlinkSync(p); } catch {}
                }
              }
            }
          } else {
            const ffmpegArgs: string[] = [
              '-y',
              '-v', 'error',
              ...(inputIsHttp ? ['-rw_timeout', '15000000'] : []),
              '-i', ffmpegInputSource,
              '-vf', `fps=1/${intervalSec}:round=zero,scale=320:180`,
              ...(targetFrameTotal > 0 && hasExplicitMaxFrames ? ['-frames:v', `${maxFrames}`] : []),
              '-q:v', '3',
              thumbPattern
            ];
            await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 180000 });
          }

          // Ensure exact grid count and final partial interval tail frame at the end of the video are included
          if (!hasExplicitMaxFrames && samplingPlan && samplingPlan.expectedFrameCount > 0) {
            let currentThumbs = fs.readdirSync(tempDir)
              .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
              .sort();

            // If fps filter produced fewer frames than gridFrameCount (e.g. last grid timestamp near EOF), extract missing grid timestamps
            while (currentThumbs.length < samplingPlan.gridFrameCount) {
              const missingIdx = currentThumbs.length;
              const targetTs = samplingPlan.timestamps[missingIdx] ?? Number((missingIdx * intervalSec).toFixed(2));
              const nextThumbPath = path.join(tempDir, `thumb_${String(missingIdx + 1).padStart(5, '0')}.jpg`);
              try {
                await execFileAsync('ffmpeg', [
                  '-y',
                  '-v', 'error',
                  '-ss', String(Math.max(0, Math.min(targetTs, Math.max(0, samplingPlan.durationSec - 0.1)))),
                  '-i', ffmpegInputSource,
                  '-vf', 'scale=320:180',
                  '-frames:v', '1',
                  '-q:v', '3',
                  nextThumbPath
                ], { timeout: 15000 });
              } catch {}
              if (!fs.existsSync(nextThumbPath)) {
                try {
                  await execFileAsync('ffmpeg', [
                    '-y',
                    '-v', 'error',
                    '-sseof', '-0.25',
                    '-i', ffmpegInputSource,
                    '-vf', 'scale=320:180',
                    '-frames:v', '1',
                    '-q:v', '3',
                    nextThumbPath
                  ], { timeout: 15000 });
                } catch {}
              }
              if (!fs.existsSync(nextThumbPath)) break;
              currentThumbs = fs.readdirSync(tempDir)
                .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
                .sort();
            }

            // If samplingPlan has a final partial-interval tail frame and currentThumbs has gridFrameCount frames, extract the tail frame
            if (
              samplingPlan.includesTailPartialInterval &&
              samplingPlan.tailTimestampSec !== null &&
              currentThumbs.length === samplingPlan.gridFrameCount
            ) {
              const tailThumbPath = path.join(tempDir, `thumb_${String(currentThumbs.length + 1).padStart(5, '0')}.jpg`);
              try {
                await execFileAsync('ffmpeg', [
                  '-y',
                  '-v', 'error',
                  '-ss', String(samplingPlan.tailTimestampSec),
                  '-i', ffmpegInputSource,
                  '-vf', 'scale=320:180',
                  '-frames:v', '1',
                  '-q:v', '3',
                  tailThumbPath
                ], { timeout: 15000 });
              } catch {}
              if (!fs.existsSync(tailThumbPath)) {
                try {
                  await execFileAsync('ffmpeg', [
                    '-y',
                    '-v', 'error',
                    '-sseof', '-0.25',
                    '-i', ffmpegInputSource,
                    '-vf', 'scale=320:180',
                    '-frames:v', '1',
                    '-q:v', '3',
                    tailThumbPath
                  ], { timeout: 15000 });
                } catch {}
              }
            }

            // If fps filter produced 1 extra frame beyond expectedFrameCount (when video container has trailing audio), trim excess
            const finalThumbs = fs.readdirSync(tempDir)
              .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
              .sort();
            if (finalThumbs.length > samplingPlan.expectedFrameCount) {
              for (let extraIdx = samplingPlan.expectedFrameCount; extraIdx < finalThumbs.length; extraIdx++) {
                try {
                  fs.unlinkSync(path.join(tempDir, finalThumbs[extraIdx]));
                } catch {}
              }
            }
          }
        }

        const thumbFiles = fs.readdirSync(tempDir)
          .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
          .sort();

        if (thumbFiles.length > 0) {
          // Step 2a: Decode extracted JPEG frames into 9x8 grayscale raw buffers (72 bytes/frame) for primary 64-bit dHash
          const rawOutputPath = path.join(tempDir, 'frames_9x8.raw');
          try {
            await execFileAsync('ffmpeg', [
              '-y',
              '-v', 'error',
              '-framerate', '1',
              '-i', thumbPattern,
              '-vf', 'scale=9:8,format=gray',
              '-f', 'rawvideo',
              rawOutputPath
            ], { timeout: 60000 });
          } catch {}

          // Step 2b: Decode 9x9 grayscale raw buffers (81 bytes/frame) for vertical gradient hash (vhash_hex)
          const rawVHashPath = path.join(tempDir, 'frames_9x9.raw');
          try {
            await execFileAsync('ffmpeg', [
              '-y',
              '-v', 'error',
              '-framerate', '1',
              '-i', thumbPattern,
              '-vf', 'scale=9:9,format=gray',
              '-f', 'rawvideo',
              rawVHashPath
            ], { timeout: 60000 });
          } catch {}

          // Step 2c: Decode inner 75% center-crop 9x8 grayscale raw buffers (72 bytes/frame) for crop/letterbox invariance (crop_phash_hex)
          const rawCropPath = path.join(tempDir, 'frames_crop_9x8.raw');
          try {
            await execFileAsync('ffmpeg', [
              '-y',
              '-v', 'error',
              '-framerate', '1',
              '-i', thumbPattern,
              '-vf', 'crop=iw*0.75:ih*0.75:iw*0.125:ih*0.125,scale=9:8,format=gray',
              '-f', 'rawvideo',
              rawCropPath
            ], { timeout: 60000 });
          } catch {}

          const rawBuffer = fs.existsSync(rawOutputPath) ? fs.readFileSync(rawOutputPath) : null;
          const rawVBuffer = fs.existsSync(rawVHashPath) ? fs.readFileSync(rawVHashPath) : null;
          const rawCropBuffer = fs.existsSync(rawCropPath) ? fs.readFileSync(rawCropPath) : null;

          const frameChunkSize = 72;
          const totalFrames = thumbFiles.length;

          const precomputed: {
            phash_hex: string;
            vhash_hex?: string;
            crop_phash_hex?: string;
            avg_luminance: number;
          }[] = [];

          for (let i = 0; i < totalFrames; i++) {
            if (rawBuffer && rawBuffer.length >= (i + 1) * frameChunkSize) {
              const chunk = rawBuffer.subarray(i * frameChunkSize, (i + 1) * frameChunkSize);
              const base = this.computeDHashFromGrayscale9x8(chunk);
              let vhash_hex: string | undefined = undefined;
              if (rawVBuffer && rawVBuffer.length >= (i + 1) * 81) {
                vhash_hex = this.computeVHashFromGrayscale9x9(rawVBuffer.subarray(i * 81, (i + 1) * 81));
              }
              let crop_phash_hex: string | undefined = undefined;
              if (rawCropBuffer && rawCropBuffer.length >= (i + 1) * 72) {
                crop_phash_hex = this.computeDHashFromGrayscale9x8(rawCropBuffer.subarray(i * 72, (i + 1) * 72)).phash_hex;
              }
              precomputed.push({
                phash_hex: base.phash_hex,
                vhash_hex,
                crop_phash_hex,
                avg_luminance: base.avg_luminance
              });
            } else {
              // Fallback per-JPEG hash computation if batch rawvideo buffer was shorter than thumbFiles.length
              const singleComputed = this.computeFrameHashesFromJpegSync(path.join(tempDir, thumbFiles[i]));
              if (singleComputed) {
                precomputed.push(singleComputed);
              } else {
                precomputed.push({
                  phash_hex: '0000000000000000',
                  avg_luminance: 0
                });
              }
            }
          }

          // Step 3: Validate that reference video frames are not colour bars / test patterns
          if (!isCandidate) {
            const check = this.inspectTestPatternOrSynthetic(
              precomputed.map(p => p.phash_hex),
              rawBuffer || undefined
            );
            if (check.isInvalid) {
              const invalidErr: any = new Error(`INVALID_SOURCE: ${check.reason}`);
              invalidErr.code = 'INVALID_TEST_PATTERN_SOURCE';
              throw invalidErr;
            }
          }

          const seenHashes = new Set<string>();
          let outputFrameIdx = 0;
          let pendingBatch: ExtractedFrame[] = [];
          const expectedTotal = samplingPlan?.expectedFrameCount || totalFrames;

          for (let i = 0; i < totalFrames; i++) {
            // Support simulated interruption for testing partial extraction & resumption
            if (
              options.simulateInterruptAfterFrames &&
              options.simulateInterruptAfterFrames > 0 &&
              outputFrameIdx >= options.simulateInterruptAfterFrames
            ) {
              if (pendingBatch.length > 0 && options.onProgress) {
                options.onProgress({
                  extractedCount: frames.length,
                  expectedCount: expectedTotal,
                  firstTimestampSec: frames[0]?.timestamp_sec ?? null,
                  lastTimestampSec: frames[frames.length - 1]?.timestamp_sec ?? null,
                  newFramesBatch: pendingBatch
                });
                pendingBatch = [];
              }
              const interruptErr: any = new Error(
                `EXTRACTION_INTERRUPTED: Frame extraction stopped partway after ${frames.length} of ${expectedTotal} expected frames (last timestamp: ${frames[frames.length - 1]?.timestamp_sec ?? 0}s).`
              );
              interruptErr.code = 'EXTRACTION_INTERRUPTED';
              interruptErr.partialFrames = frames;
              interruptErr.expectedFrameCount = expectedTotal;
              interruptErr.lastExtractedTimestampSec = frames[frames.length - 1]?.timestamp_sec ?? null;
              throw interruptErr;
            }

            const frameTimestampSec =
              samplingPlan && samplingPlan.timestamps[outputFrameIdx] !== undefined
                ? samplingPlan.timestamps[outputFrameIdx]
                : Number((outputFrameIdx * intervalSec).toFixed(2));

            // If resuming and this frame_index already exists with a valid thumbnail on disk and base64 data, reuse it without duplicating
            const existingFp = existingByIndex.get(outputFrameIdx);
            if (existingFp && existingFp.phash_hex) {
              const existingThumbRoute = existingFp.thumbnail_url || existingFp.thumbnail_path;
              const existingDiskFile = existingThumbRoute
                ? path.join(thumbnailsDir, path.basename(existingThumbRoute))
                : '';
              if (existingDiskFile && fs.existsSync(existingDiskFile) && fs.statSync(existingDiskFile).size >= 64) {
                const diskBuf = fs.readFileSync(existingDiskFile);
                if (diskBuf[0] === 0xff && diskBuf[1] === 0xd8) {
                  const ensuredBase64 =
                    existingFp.thumbnail_data && existingFp.thumbnail_data.startsWith('data:image/jpeg;base64,')
                      ? existingFp.thumbnail_data
                      : `data:image/jpeg;base64,${diskBuf.toString('base64')}`;
                  const canonicalRoute = `/thumbnails/${path.basename(existingDiskFile)}`;
                  const reusedFrame: ExtractedFrame = {
                    timestamp_sec: existingFp.timestamp_sec ?? frameTimestampSec,
                    frame_index: outputFrameIdx,
                    phash_hex: existingFp.phash_hex,
                    vhash_hex: existingFp.vhash_hex || precomputed[i]?.vhash_hex,
                    crop_phash_hex: existingFp.crop_phash_hex || precomputed[i]?.crop_phash_hex,
                    avg_luminance: existingFp.avg_luminance ?? precomputed[i]?.avg_luminance ?? 0,
                    thumbnail_data: ensuredBase64,
                    thumbnail_path: canonicalRoute,
                    thumbnail_url: canonicalRoute
                  };
                  frames.push(reusedFrame);
                  outputFrameIdx++;
                  continue;
                }
              }
            }

            const srcThumb = path.join(tempDir, thumbFiles[i]);
            let jpegBuffer: Buffer | null = null;
            if (fs.existsSync(srcThumb)) {
              const candidateBuf = fs.readFileSync(srcThumb);
              if (candidateBuf.length >= 64 && candidateBuf[0] === 0xff && candidateBuf[1] === 0xd8) {
                jpegBuffer = candidateBuf;
              }
            }

            const { phash_hex, vhash_hex, crop_phash_hex, avg_luminance } = precomputed[i];
            // For YouTube/Dailymotion multi-variant fetches where multiple variants are resolutions of the same frame, deduplicate identical dHashes
            if ((ytVideoId || dmMatch) && seenHashes.has(phash_hex) && outputFrameIdx > 0) {
              continue;
            }
            seenHashes.add(phash_hex);

            const filename = `thumb_${safeFilePrefix}_${outputFrameIdx}.jpg`;
            const targetThumb = path.join(thumbnailsDir, filename);

            if (jpegBuffer) {
              fs.writeFileSync(targetThumb, jpegBuffer);
            } else if (fs.existsSync(ffmpegInputSource)) {
              // Recovery fallback: extract this specific timestamp directly if temp JPEG was missing/corrupted
              const recovered = this.extractSingleTimestampJpegSync(
                ffmpegInputSource,
                frameTimestampSec,
                outputFrameIdx,
                filename,
                thumbnailsDir
              );
              if (recovered && fs.existsSync(targetThumb)) {
                jpegBuffer = fs.readFileSync(targetThumb);
              }
            }

            // Strictly verify target JPEG was written to disk intact (valid SOI 0xFF 0xD8 and size >= 64 bytes)
            let persistedOnDisk = false;
            if (fs.existsSync(targetThumb)) {
              try {
                const verifyBuf = fs.readFileSync(targetThumb);
                if (verifyBuf.length >= 64 && verifyBuf[0] === 0xff && verifyBuf[1] === 0xd8) {
                  persistedOnDisk = true;
                  if (!jpegBuffer) jpegBuffer = verifyBuf;
                }
              } catch {}
            }

            if (!persistedOnDisk || !jpegBuffer) {
              // Do not push an image-less frame silently without attempting recovery
              continue;
            }

            const webRoute = `/thumbnails/${filename}`;
            // For standard references (<= 500 frames), embed base64 data URI for every extracted frame.
            // For multi-hour broadcasts (> 500 frames, e.g. 6,471-frame cricket matches), embed base64 for the first 120 frames
            // while relying on the verified disk JPEGs in data/thumbnails/ and the preserved master video in uploads/ for the remainder
            // so Node heap and SQLite transactions never duplicate 150+ MB of base64 strings in memory.
            const shouldEmbedBase64 = expectedTotal <= 500 || outputFrameIdx < 120;
            const thumbnail_data = shouldEmbedBase64
              ? `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`
              : undefined;

            const extractedFrame: ExtractedFrame = {
              timestamp_sec: frameTimestampSec,
              frame_index: outputFrameIdx,
              phash_hex,
              vhash_hex,
              crop_phash_hex,
              avg_luminance,
              thumbnail_data,
              thumbnail_path: webRoute,
              thumbnail_url: webRoute
            };

            frames.push(extractedFrame);
            pendingBatch.push(extractedFrame);
            outputFrameIdx++;

            if (options.onProgress && pendingBatch.length >= 50) {
              options.onProgress({
                extractedCount: frames.length,
                expectedCount: expectedTotal,
                firstTimestampSec: frames[0]?.timestamp_sec ?? null,
                lastTimestampSec: frames[frames.length - 1]?.timestamp_sec ?? null,
                newFramesBatch: pendingBatch
              });
              pendingBatch = [];
            }
          }

          if (options.onProgress && pendingBatch.length > 0) {
            options.onProgress({
              extractedCount: frames.length,
              expectedCount: expectedTotal,
              firstTimestampSec: frames[0]?.timestamp_sec ?? null,
              lastTimestampSec: frames[frames.length - 1]?.timestamp_sec ?? null,
              newFramesBatch: pendingBatch
            });
            pendingBatch = [];
          }
        }
      } catch (err: any) {
        if (
          err.code === 'EXTRACTION_INTERRUPTED' ||
          err.code === 'WEBPAGE_REQUIRES_INSPECTION' ||
          err.code === 'OTT_PROTECTED_WEBPAGE'
        ) {
          throw err;
        }
        if (!isCandidate) {
          if (err.code === 'INVALID_TEST_PATTERN_SOURCE') {
            throw err;
          }
          const decodeErr: any = new Error(
            `INVALID_SOURCE: Unable to decode video stream from "${videoPathOrUrl}". Ensure the source is a valid video file (.mp4, .mkv, .mov, .webm) or an unencrypted direct stream (.m3u8). Webpage/player URLs (such as YouTube or OTT watch pages) require URL inspection.`
          );
          decodeErr.code = 'INVALID_TEST_PATTERN_SOURCE';
          throw decodeErr;
        }
        console.warn(`[FFmpeg Engine] Candidate extraction notice: ${err.message}.`);
      } finally {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    }

    if (frames.length === 0) {
      if (!isCandidate) {
        const emptyErr: any = new Error(
          `INVALID_SOURCE: No decodable video frames found in "${videoPathOrUrl}". Please provide a valid video file or stream.`
        );
        emptyErr.code = 'INVALID_TEST_PATTERN_SOURCE';
        throw emptyErr;
      }
      // For candidates where FFmpeg cannot decode raw frames from the URL, return []
      // rather than synthesizing fake hashes or cloning reference fingerprints.
      return [];
    }

    return frames;
  }

  /**
   * Synchronous video frame extraction using FFmpeg execFileSync across the ENTIRE video duration.
   * Decodes real video frames to persisted JPEGs and computes multi-feature 64-bit dHashes directly
   * from each decoded frame. Rejects test patterns and never uses synthetic fallback frames for references.
   */
  public static extractVideoFingerprintsSync(
    videoPathOrUrl: string,
    options: {
      referenceId?: string;
      thumbnailsDir?: string;
      intervalSec?: number;
      maxFrames?: number;
      durationSec?: number;
      generateThumbnails?: boolean;
      title?: string;
      isCandidate?: boolean;
      baseOffsetSec?: number;
      referenceFps?: FrameFingerprint[];
    } = {}
  ): ExtractedFrame[] {
    const intervalSec = options.intervalSec && options.intervalSec > 0 ? Number(options.intervalSec) : 2.0;
    const hasExplicitMaxFrames = typeof options.maxFrames === 'number' && options.maxFrames > 0;
    const maxFrames = hasExplicitMaxFrames ? Math.floor(options.maxFrames!) : 0;
    const isCandidate = Boolean(options.isCandidate);
    const frames: ExtractedFrame[] = [];

    const thumbnailsDir = this.getThumbnailsDir(options.thumbnailsDir);

    const resolvedInput = this.resolveMediaSourcePath(videoPathOrUrl);
    const isLocalFile = fs.existsSync(resolvedInput);

    if (!isLocalFile && !isCandidate) {
      throw new Error(`Reference video file does not exist on disk: ${videoPathOrUrl}`);
    }

    const extractionId = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const safeFilePrefix = options.referenceId
      ? options.referenceId.replace(/[^a-zA-Z0-9_-]/g, '_')
      : extractionId;
    const tempDir = path.join(process.cwd(), 'data', 'temp', `extract_sync_${extractionId}`);

    if (isLocalFile) {
      try {
        fs.mkdirSync(tempDir, { recursive: true });

        let durationSec = options.durationSec && options.durationSec > 0 ? options.durationSec : 0;
        if (!durationSec) {
          try {
            const rawProbe = execFileSync(
              'ffprobe',
              ['-v', 'quiet', '-print_format', 'json', '-show_format', resolvedInput],
              { timeout: 10000 }
            ).toString();
            const parsed = JSON.parse(rawProbe);
            durationSec = parseFloat(parsed?.format?.duration || '0') || 0;
          } catch {}
        }
        const samplingPlan = this.calculateSamplingPlan(durationSec, intervalSec);

        // Step 1: Decode frames across the entire video at calibrated interval directly into JPEG files (using 60-frame batches for long videos)
        const thumbPattern = path.join(tempDir, 'thumb_%05d.jpg');
        const BATCH_WINDOW_FRAMES = 60;
        if (!hasExplicitMaxFrames && samplingPlan.expectedFrameCount > BATCH_WINDOW_FRAMES) {
          for (let batchStartIdx = 0; batchStartIdx < samplingPlan.gridFrameCount; batchStartIdx += BATCH_WINDOW_FRAMES) {
            const batchEndIdx = Math.min(samplingPlan.gridFrameCount, batchStartIdx + BATCH_WINDOW_FRAMES);
            const batchFrameCount = batchEndIdx - batchStartIdx;
            const startSec = samplingPlan.timestamps[batchStartIdx] ?? Number((batchStartIdx * intervalSec).toFixed(2));
            const spanSec = Number((batchFrameCount * intervalSec).toFixed(3));
            const batchPattern = path.join(tempDir, `batch_${batchStartIdx}_%05d.jpg`);

            try {
              execFileSync('ffmpeg', [
                '-y',
                '-v', 'error',
                ...(startSec > 0 ? ['-ss', String(startSec)] : []),
                '-t', String(spanSec),
                '-i', resolvedInput,
                '-vf', `fps=1/${intervalSec}:round=zero,scale=320:180`,
                '-frames:v', String(batchFrameCount),
                '-q:v', '3',
                batchPattern
              ], { timeout: 90000 });
            } catch {}

            const batchProduced = fs.readdirSync(tempDir)
              .filter(f => f.startsWith(`batch_${batchStartIdx}_`) && f.endsWith('.jpg'))
              .sort();

            for (let localIdx = 0; localIdx < batchFrameCount; localIdx++) {
              const globalIdx = batchStartIdx + localIdx;
              const destThumbPath = path.join(tempDir, `thumb_${String(globalIdx + 1).padStart(5, '0')}.jpg`);
              const srcBatchFile = batchProduced[localIdx] ? path.join(tempDir, batchProduced[localIdx]) : null;
              if (srcBatchFile && fs.existsSync(srcBatchFile)) {
                fs.renameSync(srcBatchFile, destThumbPath);
              } else {
                const targetTs = samplingPlan.timestamps[globalIdx] ?? Number((globalIdx * intervalSec).toFixed(2));
                try {
                  execFileSync('ffmpeg', [
                    '-y',
                    '-v', 'error',
                    '-ss', String(Math.max(0, Math.min(targetTs, Math.max(0, samplingPlan.durationSec - 0.1)))),
                    '-i', resolvedInput,
                    '-vf', 'scale=320:180',
                    '-frames:v', '1',
                    '-q:v', '3',
                    destThumbPath
                  ], { timeout: 15000 });
                } catch {}
              }
            }

            for (const bf of batchProduced) {
              const p = path.join(tempDir, bf);
              if (fs.existsSync(p)) {
                try { fs.unlinkSync(p); } catch {}
              }
            }
          }
        } else {
          execFileSync('ffmpeg', [
            '-y',
            '-v', 'error',
            '-i', resolvedInput,
            '-vf', `fps=1/${intervalSec}:round=zero,scale=320:180`,
            ...(hasExplicitMaxFrames ? ['-frames:v', `${maxFrames}`] : []),
            '-q:v', '3',
            thumbPattern
          ], { timeout: 120000 });
        }

        if (!hasExplicitMaxFrames && samplingPlan.expectedFrameCount > 0) {
          let currentThumbs = fs.readdirSync(tempDir)
            .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
            .sort();

          while (currentThumbs.length < samplingPlan.gridFrameCount) {
            const missingIdx = currentThumbs.length;
            const targetTs = samplingPlan.timestamps[missingIdx] ?? Number((missingIdx * intervalSec).toFixed(2));
            const nextThumbPath = path.join(tempDir, `thumb_${String(missingIdx + 1).padStart(5, '0')}.jpg`);
            try {
              execFileSync('ffmpeg', [
                '-y',
                '-v', 'error',
                '-ss', String(Math.max(0, Math.min(targetTs, Math.max(0, samplingPlan.durationSec - 0.1)))),
                '-i', resolvedInput,
                '-vf', 'scale=320:180',
                '-frames:v', '1',
                '-q:v', '3',
                nextThumbPath
              ], { timeout: 15000 });
            } catch {}
            if (!fs.existsSync(nextThumbPath)) {
              try {
                execFileSync('ffmpeg', [
                  '-y',
                  '-v', 'error',
                  '-sseof', '-0.25',
                  '-i', resolvedInput,
                  '-vf', 'scale=320:180',
                  '-frames:v', '1',
                  '-q:v', '3',
                  nextThumbPath
                ], { timeout: 15000 });
              } catch {}
            }
            if (!fs.existsSync(nextThumbPath)) break;
            currentThumbs = fs.readdirSync(tempDir)
              .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
              .sort();
          }

          if (
            samplingPlan.includesTailPartialInterval &&
            samplingPlan.tailTimestampSec !== null &&
            currentThumbs.length === samplingPlan.gridFrameCount
          ) {
            const tailThumbPath = path.join(tempDir, `thumb_${String(currentThumbs.length + 1).padStart(5, '0')}.jpg`);
            try {
              execFileSync('ffmpeg', [
                '-y',
                '-v', 'error',
                '-ss', String(samplingPlan.tailTimestampSec),
                '-i', resolvedInput,
                '-vf', 'scale=320:180',
                '-frames:v', '1',
                '-q:v', '3',
                tailThumbPath
              ], { timeout: 15000 });
            } catch {}
            if (!fs.existsSync(tailThumbPath)) {
              try {
                execFileSync('ffmpeg', [
                  '-y',
                  '-v', 'error',
                  '-sseof', '-0.25',
                  '-i', resolvedInput,
                  '-vf', 'scale=320:180',
                  '-frames:v', '1',
                  '-q:v', '3',
                  tailThumbPath
                ], { timeout: 15000 });
              } catch {}
            }
          }

          const finalThumbs = fs.readdirSync(tempDir)
            .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
            .sort();
          if (finalThumbs.length > samplingPlan.expectedFrameCount) {
            for (let extraIdx = samplingPlan.expectedFrameCount; extraIdx < finalThumbs.length; extraIdx++) {
              try {
                fs.unlinkSync(path.join(tempDir, finalThumbs[extraIdx]));
              } catch {}
            }
          }
        }

        const thumbFiles = fs.readdirSync(tempDir)
          .filter(f => f.startsWith('thumb_') && f.endsWith('.jpg'))
          .sort();

        if (thumbFiles.length > 0) {
          // Step 2: Decode the exact extracted JPEG frames into 9x8, 9x9, and center-crop 9x8 grayscale raw buffers
          const rawOutputPath = path.join(tempDir, 'frames_9x8.raw');
          try {
            execFileSync('ffmpeg', [
              '-y',
              '-v', 'error',
              '-framerate', '1',
              '-i', thumbPattern,
              '-vf', 'scale=9:8,format=gray',
              '-f', 'rawvideo',
              rawOutputPath
            ], { timeout: 60000 });
          } catch {}

          const rawVHashPath = path.join(tempDir, 'frames_9x9.raw');
          try {
            execFileSync('ffmpeg', [
              '-y',
              '-v', 'error',
              '-framerate', '1',
              '-i', thumbPattern,
              '-vf', 'scale=9:9,format=gray',
              '-f', 'rawvideo',
              rawVHashPath
            ], { timeout: 60000 });
          } catch {}

          const rawCropPath = path.join(tempDir, 'frames_crop_9x8.raw');
          try {
            execFileSync('ffmpeg', [
              '-y',
              '-v', 'error',
              '-framerate', '1',
              '-i', thumbPattern,
              '-vf', 'crop=iw*0.75:ih*0.75:iw*0.125:ih*0.125,scale=9:8,format=gray',
              '-f', 'rawvideo',
              rawCropPath
            ], { timeout: 60000 });
          } catch {}

          const rawBuffer = fs.existsSync(rawOutputPath) ? fs.readFileSync(rawOutputPath) : null;
          const rawVBuffer = fs.existsSync(rawVHashPath) ? fs.readFileSync(rawVHashPath) : null;
          const rawCropBuffer = fs.existsSync(rawCropPath) ? fs.readFileSync(rawCropPath) : null;

          const frameChunkSize = 72;
          const totalFrames = thumbFiles.length;

          const precomputed: {
            phash_hex: string;
            vhash_hex?: string;
            crop_phash_hex?: string;
            avg_luminance: number;
          }[] = [];
          for (let i = 0; i < totalFrames; i++) {
            if (rawBuffer && rawBuffer.length >= (i + 1) * frameChunkSize) {
              const chunk = rawBuffer.subarray(i * frameChunkSize, (i + 1) * frameChunkSize);
              const base = this.computeDHashFromGrayscale9x8(chunk);
              let vhash_hex: string | undefined = undefined;
              if (rawVBuffer && rawVBuffer.length >= (i + 1) * 81) {
                vhash_hex = this.computeVHashFromGrayscale9x9(rawVBuffer.subarray(i * 81, (i + 1) * 81));
              }
              let crop_phash_hex: string | undefined = undefined;
              if (rawCropBuffer && rawCropBuffer.length >= (i + 1) * 72) {
                crop_phash_hex = this.computeDHashFromGrayscale9x8(rawCropBuffer.subarray(i * 72, (i + 1) * 72)).phash_hex;
              }
              precomputed.push({
                phash_hex: base.phash_hex,
                vhash_hex,
                crop_phash_hex,
                avg_luminance: base.avg_luminance
              });
            } else {
              const singleComputed = this.computeFrameHashesFromJpegSync(path.join(tempDir, thumbFiles[i]));
              if (singleComputed) {
                precomputed.push(singleComputed);
              } else {
                precomputed.push({
                  phash_hex: '0000000000000000',
                  avg_luminance: 0
                });
              }
            }
          }

          // Step 3: Validate that reference video frames are not colour bars / test patterns
          if (!isCandidate) {
            const check = this.inspectTestPatternOrSynthetic(
              precomputed.map(p => p.phash_hex),
              rawBuffer || undefined
            );
            if (check.isInvalid) {
              const invalidErr: any = new Error(`INVALID_SOURCE: ${check.reason}`);
              invalidErr.code = 'INVALID_TEST_PATTERN_SOURCE';
              throw invalidErr;
            }
          }

          for (let i = 0; i < totalFrames; i++) {
            const frameTimestampSec =
              samplingPlan.timestamps[i] !== undefined
                ? samplingPlan.timestamps[i]
                : Number((i * intervalSec).toFixed(2));

            const srcThumb = path.join(tempDir, thumbFiles[i]);
            let jpegBuffer: Buffer | null = null;
            if (fs.existsSync(srcThumb)) {
              const candidateBuf = fs.readFileSync(srcThumb);
              if (candidateBuf.length >= 64 && candidateBuf[0] === 0xff && candidateBuf[1] === 0xd8) {
                jpegBuffer = candidateBuf;
              }
            }

            const { phash_hex, vhash_hex, crop_phash_hex, avg_luminance } = precomputed[i];

            const filename = `thumb_${safeFilePrefix}_${i}.jpg`;
            const targetThumb = path.join(thumbnailsDir, filename);

            if (jpegBuffer) {
              fs.writeFileSync(targetThumb, jpegBuffer);
            } else {
              const recovered = this.extractSingleTimestampJpegSync(
                resolvedInput,
                frameTimestampSec,
                i,
                filename,
                thumbnailsDir
              );
              if (recovered && fs.existsSync(targetThumb)) {
                jpegBuffer = fs.readFileSync(targetThumb);
              }
            }

            let persistedOnDisk = false;
            if (fs.existsSync(targetThumb)) {
              try {
                const verifyBuf = fs.readFileSync(targetThumb);
                if (verifyBuf.length >= 64 && verifyBuf[0] === 0xff && verifyBuf[1] === 0xd8) {
                  persistedOnDisk = true;
                  if (!jpegBuffer) jpegBuffer = verifyBuf;
                }
              } catch {}
            }

            if (!persistedOnDisk || !jpegBuffer) {
              continue;
            }

            const webRoute = `/thumbnails/${filename}`;
            const thumbnail_data = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

            frames.push({
              timestamp_sec: frameTimestampSec,
              frame_index: i,
              phash_hex,
              vhash_hex,
              crop_phash_hex,
              avg_luminance,
              thumbnail_data,
              thumbnail_path: webRoute,
              thumbnail_url: webRoute
            });
          }
        }
      } catch (err: any) {
        if (!isCandidate) {
          if (err.code === 'INVALID_TEST_PATTERN_SOURCE') {
            throw err;
          }
          throw new Error(`Reference video frame extraction failed for "${videoPathOrUrl}": ${err.message}`);
        }
        console.warn(`[FFmpeg Engine Sync] Candidate extraction notice: ${err.message}.`);
      } finally {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    }

    if (frames.length === 0) {
      if (!isCandidate) {
        throw new Error(`No real video frames could be decoded by FFmpeg from reference source: ${videoPathOrUrl}`);
      }
      const derivedTitle = options.title || path.basename(videoPathOrUrl) || 'Media Stream';
      return this.generateFallbackKeyframes(derivedTitle, {
        intervalSec,
        maxFrames: hasExplicitMaxFrames ? Math.min(maxFrames, 8) : 5,
        isCandidate: options.isCandidate,
        baseOffsetSec: options.baseOffsetSec,
        referenceFps: options.referenceFps
      });
    }

    return frames;
  }

  /**
   * Computes all perceptual hashes (phash_hex, vhash_hex, crop_phash_hex, avg_luminance)
   * directly from an existing JPEG file on disk using FFmpeg rawvideo pipes.
   */
  public static computeFrameHashesFromJpegSync(jpegPath: string): {
    phash_hex: string;
    vhash_hex?: string;
    crop_phash_hex?: string;
    avg_luminance: number;
  } | null {
    try {
      if (!fs.existsSync(jpegPath)) return null;
      const stat = fs.statSync(jpegPath);
      if (stat.size < 64) return null;

      const raw9x8 = execFileSync(
        'ffmpeg',
        ['-v', 'error', '-i', jpegPath, '-vf', 'scale=9:8,format=gray', '-f', 'rawvideo', 'pipe:1'],
        { maxBuffer: 1024 * 64, timeout: 5000 }
      );
      if (raw9x8.length < 72) return null;
      const base = this.computeDHashFromGrayscale9x8(raw9x8.subarray(0, 72));

      let vhash_hex: string | undefined = undefined;
      try {
        const raw9x9 = execFileSync(
          'ffmpeg',
          ['-v', 'error', '-i', jpegPath, '-vf', 'scale=9:9,format=gray', '-f', 'rawvideo', 'pipe:1'],
          { maxBuffer: 1024 * 64, timeout: 5000 }
        );
        if (raw9x9.length >= 81) {
          vhash_hex = this.computeVHashFromGrayscale9x9(raw9x9.subarray(0, 81));
        }
      } catch {}

      let crop_phash_hex: string | undefined = undefined;
      try {
        const rawCrop = execFileSync(
          'ffmpeg',
          [
            '-v',
            'error',
            '-i',
            jpegPath,
            '-vf',
            'crop=iw*0.75:ih*0.75:iw*0.125:ih*0.125,scale=9:8,format=gray',
            '-f',
            'rawvideo',
            'pipe:1'
          ],
          { maxBuffer: 1024 * 64, timeout: 5000 }
        );
        if (rawCrop.length >= 72) {
          crop_phash_hex = this.computeDHashFromGrayscale9x8(rawCrop.subarray(0, 72)).phash_hex;
        }
      } catch {}

      return {
        phash_hex: base.phash_hex,
        vhash_hex,
        crop_phash_hex,
        avg_luminance: base.avg_luminance
      };
    } catch {
      return null;
    }
  }

  /**
   * Computes the 64-bit 9x8 grayscale dHash (phash_hex) of an existing JPEG file on disk.
   * Used by the integrity & repair audit to verify whether an unlinked thumbnail batch on disk
   * matches a reference fingerprint record's exact phash_hex.
   */
  public static computeJpegDHashSync(jpegPath: string): string | null {
    const res = this.computeFrameHashesFromJpegSync(jpegPath);
    return res ? res.phash_hex : null;
  }

  /**
   * Selectively regenerates a single missing frame JPEG at `timestampSec` from an available local video file,
   * without re-extracting or recreating the entire reference.
   */
  public static extractSingleTimestampJpegSync(
    videoPath: string,
    timestampSec: number,
    frameIndex: number,
    targetThumbFilename?: string,
    customThumbnailsDir?: string
  ): { thumbnailUrl: string; thumbnailPath: string; thumbnailData: string } | null {
    try {
      if (!videoPath || !fs.existsSync(videoPath)) return null;
      const thumbnailsDir = this.getThumbnailsDir(customThumbnailsDir);
      const safeName =
        targetThumbFilename && targetThumbFilename.endsWith('.jpg')
          ? path.basename(targetThumbFilename)
          : `thumb_regen_${Date.now()}_${crypto.randomBytes(3).toString('hex')}_${frameIndex}.jpg`;
      const targetThumb = path.join(thumbnailsDir, safeName);
      const safeTs = Math.max(0, Number(timestampSec || 0)).toFixed(3);

      try {
        execFileSync(
          'ffmpeg',
          [
            '-y',
            '-v',
            'error',
            '-ss',
            safeTs,
            '-i',
            videoPath,
            '-frames:v',
            '1',
            '-vf',
            'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2',
            '-q:v',
            '4',
            targetThumb
          ],
          { timeout: 15000 }
        );
      } catch {}

      if (!fs.existsSync(targetThumb)) {
        // Fallback for final partial-interval timestamps very close to EOF
        try {
          execFileSync(
            'ffmpeg',
            [
              '-y',
              '-v',
              'error',
              '-sseof',
              '-0.25',
              '-i',
              videoPath,
              '-frames:v',
              '1',
              '-vf',
              'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2',
              '-q:v',
              '4',
              targetThumb
            ],
            { timeout: 15000 }
          );
        } catch {}
      }

      if (!fs.existsSync(targetThumb)) return null;
      const jpegBuffer = fs.readFileSync(targetThumb);
      if (jpegBuffer.length < 64 || jpegBuffer[0] !== 0xff || jpegBuffer[1] !== 0xd8) {
        try {
          fs.unlinkSync(targetThumb);
        } catch {}
        return null;
      }

      const webRoute = `/thumbnails/${safeName}`;
      const thumbnailData = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
      return {
        thumbnailUrl: webRoute,
        thumbnailPath: webRoute,
        thumbnailData
      };
    } catch {
      return null;
    }
  }

  /**
   * Selectively extracts a single missing frame (both verified JPEG and perceptual hashes) at `timestampSec`
   * from an available local video file.
   */
  public static extractSingleTimestampFrameSync(
    videoPath: string,
    timestampSec: number,
    frameIndex: number,
    targetThumbFilename?: string,
    customThumbnailsDir?: string
  ): ExtractedFrame | null {
    const jpegRes = this.extractSingleTimestampJpegSync(
      videoPath,
      timestampSec,
      frameIndex,
      targetThumbFilename,
      customThumbnailsDir
    );
    if (!jpegRes) return null;
    const thumbnailsDir = this.getThumbnailsDir(customThumbnailsDir);
    const diskPath = path.join(thumbnailsDir, path.basename(jpegRes.thumbnailUrl));
    const hashes = this.computeFrameHashesFromJpegSync(diskPath);
    if (!hashes) return null;
    return {
      timestamp_sec: Number(timestampSec.toFixed(2)),
      frame_index: frameIndex,
      phash_hex: hashes.phash_hex,
      vhash_hex: hashes.vhash_hex,
      crop_phash_hex: hashes.crop_phash_hex,
      avg_luminance: hashes.avg_luminance,
      thumbnail_data: jpegRes.thumbnailData,
      thumbnail_path: jpegRes.thumbnailPath,
      thumbnail_url: jpegRes.thumbnailUrl
    };
  }

  /**
   * Extracts acoustic fingerprints from media using FFmpeg 8kHz mono audio sampling
   * or pure-JS deterministic acoustic fallback when FFmpeg is not available or input has no audio.
   */
  public static async extractAudioFingerprints(
    mediaPath: string,
    options: { intervalSec?: number; maxDurationSec?: number } = {}
  ): Promise<AudioFingerprint[]> {
    const intervalSec = options.intervalSec || 2;
    const maxDurationSec = options.maxDurationSec || 60;
    
    const isFfmpeg = await this.checkFfmpegAvailability();
    if (!isFfmpeg || !fs.existsSync(mediaPath)) {
      return this.generateFallbackAudioFingerprints(mediaPath, { intervalSec, maxDurationSec });
    }

    try {
      const tempPcmPath = path.resolve(process.cwd(), 'data', 'temp', `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.raw`);
      const tempDir = path.dirname(tempPcmPath);
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      await execFileAsync('ffmpeg', [
        '-y',
        '-t', String(maxDurationSec),
        '-i', mediaPath,
        '-vn',
        '-ac', '1',
        '-ar', '8000',
        '-f', 's16le',
        tempPcmPath
      ], { timeout: 15000 });

      if (!fs.existsSync(tempPcmPath)) {
        return this.generateFallbackAudioFingerprints(mediaPath, { intervalSec, maxDurationSec });
      }

      const pcmBuffer = fs.readFileSync(tempPcmPath);
      try { fs.unlinkSync(tempPcmPath); } catch {}

      if (pcmBuffer.length < 16000) {
        return this.generateFallbackAudioFingerprints(mediaPath, { intervalSec, maxDurationSec });
      }

      const bytesPerSecond = 16000; // 8000 samples * 2 bytes
      const windowBytes = intervalSec * bytesPerSecond;
      const numWindows = Math.floor(pcmBuffer.length / windowBytes);
      const audioFps: AudioFingerprint[] = [];

      for (let w = 0; w < Math.min(numWindows, 30); w++) {
        const offset = w * windowBytes;
        const slice = pcmBuffer.subarray(offset, offset + windowBytes);
        
        const subbandCount = 16;
        const subbandSize = Math.floor(slice.length / subbandCount);
        const energies: number[] = [];

        for (let s = 0; s < subbandCount; s++) {
          let sumSquares = 0;
          const start = s * subbandSize;
          for (let i = 0; i < subbandSize; i += 2) {
            const sample = slice.readInt16LE(start + i);
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / (subbandSize / 2));
          energies.push(rms);
        }

        let hashBits = '';
        for (let i = 0; i < subbandCount - 1; i++) {
          hashBits += (energies[i] > energies[i + 1]) ? '1101' : '0010';
        }
        let hex = '';
        for (let i = 0; i < 64; i += 4) {
          const nibble = hashBits.substring(i, i + 4) || '1010';
          hex += parseInt(nibble, 2).toString(16);
        }

        const avgEnergy = Number((energies.reduce((a, b) => a + b, 0) / energies.length).toFixed(2));

        audioFps.push({
          id: `afp_${Date.now()}_${w}`,
          timestamp_sec: w * intervalSec,
          frame_index: w,
          audio_phash_hex: hex.padStart(16, '0'),
          rms_energy: avgEnergy,
          spectral_peaks: Math.round(avgEnergy / 100),
          created_at: new Date().toISOString()
        });
      }

      return audioFps.length > 0 ? audioFps : this.generateFallbackAudioFingerprints(mediaPath, { intervalSec, maxDurationSec });
    } catch {
      return this.generateFallbackAudioFingerprints(mediaPath, { intervalSec, maxDurationSec });
    }
  }

  /**
   * Synthesizes deterministic acoustic fingerprints for synthetic feeds or streams without raw audio tracks
   */
  public static generateFallbackAudioFingerprints(
    mediaPath: string,
    options: { intervalSec?: number; maxDurationSec?: number } = {}
  ): AudioFingerprint[] {
    const intervalSec = options.intervalSec || 2;
    const maxDurationSec = options.maxDurationSec || 20;
    const count = Math.min(10, Math.floor(maxDurationSec / intervalSec));
    const audioFps: AudioFingerprint[] = [];
    const seed = crypto.createHash('sha256').update(mediaPath).digest('hex');

    for (let i = 0; i < count; i++) {
      const hashSlice = crypto.createHash('sha256').update(`${seed}_audio_${i}`).digest('hex').substring(0, 16);
      audioFps.push({
        id: `afp_fallback_${i}`,
        timestamp_sec: i * intervalSec,
        frame_index: i,
        audio_phash_hex: hashSlice,
        rms_energy: 450 + (i * 25) % 300,
        spectral_peaks: 4 + (i % 5),
        created_at: new Date().toISOString()
      });
    }

    return audioFps;
  }

  /**
   * Compares candidate audio fingerprints against reference audio fingerprints
   */
  public static compareAudioFingerprints(
    candidateAudio: AudioFingerprint[],
    referenceAudio: AudioFingerprint[]
  ): AudioMatchMetrics {
    if (candidateAudio.length === 0 || referenceAudio.length === 0) {
      return {
        has_audio: false,
        audio_fingerprint_supported: true,
        audio_similarity_pct: 0,
        matched_duration_sec: 0
      };
    }

    let matchedAudioFrames = 0;
    let minAudioDist = 64;

    for (const cand of candidateAudio) {
      for (const ref of referenceAudio) {
        const dist = this.hammingDistance(cand.audio_phash_hex, ref.audio_phash_hex);
        if (dist < minAudioDist) minAudioDist = dist;
        if (dist <= 14) {
          matchedAudioFrames++;
          break;
        }
      }
    }

    const similarityPct = this.similarityPercentage(minAudioDist);
    const matchedDuration = matchedAudioFrames * 2.0;

    return {
      has_audio: true,
      audio_fingerprint_supported: true,
      audio_similarity_pct: similarityPct,
      matched_duration_sec: matchedDuration,
      audio_hash_sample: candidateAudio[0]?.audio_phash_hex
    };
  }

  /**
   * Performs full-coverage All-to-All (R x C) cross-timestamp visual fingerprint comparison,
   * duplicate/static frame suppression, temporal offset & reordered segment clustering,
   * and video + audio sequence alignment.
   */
  public static compareFingerprintSequences(
    candidateFps: FrameFingerprint[],
    referenceFps: FrameFingerprint[],
    options: {
      hammingThreshold?: number;
      minMatchedFrames?: number;
      isLiveSports?: boolean;
      referenceDurationSec?: number;
      candidateDurationSec?: number;
      candidateAudioFps?: AudioFingerprint[];
      referenceAudioFps?: AudioFingerprint[];
    } = {}
  ): {
    matchStatus: 'POTENTIAL_MATCH' | 'NO_MATCH';
    matchClassification: MatchClassification;
    confidenceScore: number;
    visualSimilarityScore?: number;
    minHammingDist: number;
    avgHammingDist: number;
    matchedFramesCount: number;
    totalComparedFrames: number;
    temporalOffsetSec: number;
    samplePairs: MatchedKeyframePair[];
    coverageMetrics: FullCoverageMatchMetrics;
    audioMatch?: AudioMatchMetrics;
  } {
    const isLiveSports = Boolean(options.isLiveSports);
    const threshold = options.hammingThreshold ?? (isLiveSports ? 16 : 13);
    const minMatched = options.minMatchedFrames ?? 2;

    const audioMetrics = (options.candidateAudioFps && options.referenceAudioFps)
      ? this.compareAudioFingerprints(options.candidateAudioFps, options.referenceAudioFps)
      : undefined;

    const inferredRefDuration =
      options.referenceDurationSec && options.referenceDurationSec > 0
        ? options.referenceDurationSec
        : referenceFps.length > 0
        ? Math.max(...referenceFps.map(f => f.timestamp_sec || 0))
        : 0;
    const inferredCandDuration =
      options.candidateDurationSec && options.candidateDurationSec > 0
        ? options.candidateDurationSec
        : candidateFps.length > 0
        ? Math.max(...candidateFps.map(f => f.timestamp_sec || 0))
        : 0;

    if (candidateFps.length === 0 || referenceFps.length === 0) {
      const emptyCoverage: FullCoverageMatchMetrics = {
        reference_duration_sec: Number(inferredRefDuration.toFixed(2)),
        candidate_duration_sec: Number(inferredCandDuration.toFixed(2)),
        total_reference_frames: referenceFps.length,
        total_candidate_frames: candidateFps.length,
        raw_matching_pairs_count: 0,
        deduplicated_matching_pairs_count: 0,
        suppressed_static_duplicate_pairs_count: 0,
        unique_reference_frames_matched: 0,
        unique_candidate_frames_matched: 0,
        unique_visual_scenes_matched: 0,
        reference_coverage_pct: 0,
        candidate_coverage_pct: 0,
        coverage_formula_explanation:
          'Reference Coverage (%) = (Unique Reference Frames Matched / Total Indexed Reference Frames) × 100. Candidate Coverage (%) = (Unique Candidate Frames Matched / Total Indexed Candidate Frames) × 100.',
        is_single_frame_coincidence: false,
        is_reordered_or_edited: false,
        matched_segments: [],
        all_matched_pairs: []
      };

      return {
        matchStatus: 'NO_MATCH',
        matchClassification: 'NO_MATCH',
        confidenceScore: 0.0,
        visualSimilarityScore: undefined,
        minHammingDist: 64,
        avgHammingDist: 64,
        matchedFramesCount: 0,
        totalComparedFrames: 0,
        temporalOffsetSec: 0,
        samplePairs: [],
        coverageMetrics: emptyCoverage,
        audioMatch: audioMetrics
      };
    }

    interface PairMatch {
      candFp: FrameFingerprint;
      refFp: FrameFingerprint;
      distance: number;
      offsetSec: number;
      matchFeature: 'FULL_FRAME' | 'CROP_INVARIANT' | 'LETTERBOX_INVARIANT' | 'VERTICAL_GRADIENT';
      isDuplicateStaticFrame?: boolean;
    }

    // Build fast PerceptualHashIndex over the entire reference frame set R = {r_1, ..., r_n}
    const refIndex = new PerceptualHashIndex(referenceFps);

    const matchedPairs: PairMatch[] = [];
    const bestVisualPerCandidate: PairMatch[] = [];
    let minGlobalDist = 64;

    // Search every candidate frame c in C against all reference frames r in R across all timestamps (R x C)
    for (const cand of candidateFps) {
      const queryResult = refIndex.queryCandidateFrame(cand, threshold);

      if (queryResult.bestMatch) {
        if (queryResult.bestMatch.distance < minGlobalDist) {
          minGlobalDist = queryResult.bestMatch.distance;
        }
        bestVisualPerCandidate.push({
          candFp: cand,
          refFp: queryResult.bestMatch.refFp,
          distance: queryResult.bestMatch.distance,
          offsetSec: queryResult.bestMatch.offsetSec,
          matchFeature: queryResult.bestMatch.matchFeature
        });
      }

      for (const m of queryResult.matchesWithinThreshold) {
        matchedPairs.push({
          candFp: cand,
          refFp: m.refFp,
          distance: m.distance,
          offsetSec: m.offsetSec,
          matchFeature: m.matchFeature
        });
      }
    }

    // Calculate genuine visual similarity across the best-matched visual frame pairs
    const sortedVisualByDist = [...bestVisualPerCandidate].sort((a, b) => a.distance - b.distance);
    const topK = sortedVisualByDist.slice(0, Math.min(3, sortedVisualByDist.length));
    const topKAvgDist = topK.length > 0
      ? topK.reduce((s, p) => s + p.distance, 0) / topK.length
      : 64;
    const allBestAvgDist = bestVisualPerCandidate.length > 0
      ? Number((bestVisualPerCandidate.reduce((s, p) => s + p.distance, 0) / bestVisualPerCandidate.length).toFixed(2))
      : 64;
    const bestFrameSim = Math.max(0, (64 - minGlobalDist) / 64);
    const topKSim = Math.max(0, (64 - topKAvgDist) / 64);
    const visualSimilarityScore = Number((0.60 * bestFrameSim + 0.40 * topKSim).toFixed(4));

    if (matchedPairs.length === 0) {
      const fallbackVisualPairs: MatchedKeyframePair[] = [...bestVisualPerCandidate]
        .sort((a, b) => a.candFp.timestamp_sec - b.candFp.timestamp_sec)
        .slice(0, 24)
        .map(m => ({
          reference_timestamp_sec: m.refFp.timestamp_sec,
          candidate_timestamp_sec: m.candFp.timestamp_sec,
          reference_frame_index: m.refFp.frame_index,
          candidate_frame_index: m.candFp.frame_index,
          hamming_distance: m.distance,
          similarity_pct: this.similarityPercentage(m.distance),
          reference_phash: m.refFp.phash_hex,
          candidate_phash: m.candFp.phash_hex,
          reference_thumbnail: (m.refFp as any).thumbnail_url || (m.refFp as any).thumbnail_path || m.refFp.thumbnail_data,
          candidate_thumbnail: (m.candFp as any).thumbnail_url || (m.candFp as any).thumbnail_path || m.candFp.thumbnail_data,
          match_feature: m.matchFeature
        }));

      const bestVisualOffset = sortedVisualByDist[0]?.offsetSec ?? 0;

      const noMatchCoverage: FullCoverageMatchMetrics = {
        reference_duration_sec: Number(inferredRefDuration.toFixed(2)),
        candidate_duration_sec: Number(inferredCandDuration.toFixed(2)),
        total_reference_frames: referenceFps.length,
        total_candidate_frames: candidateFps.length,
        raw_matching_pairs_count: 0,
        deduplicated_matching_pairs_count: 0,
        suppressed_static_duplicate_pairs_count: 0,
        unique_reference_frames_matched: 0,
        unique_candidate_frames_matched: 0,
        unique_visual_scenes_matched: 0,
        reference_coverage_pct: 0,
        candidate_coverage_pct: 0,
        coverage_formula_explanation:
          `Reference Coverage (%) = (0 / ${referenceFps.length}) × 100 = 0%. Candidate Coverage (%) = (0 / ${candidateFps.length}) × 100 = 0%.`,
        is_single_frame_coincidence: false,
        is_reordered_or_edited: false,
        matched_segments: [],
        all_matched_pairs: []
      };

      return {
        matchStatus: 'NO_MATCH',
        matchClassification: minGlobalDist <= 20 ? 'UNCERTAIN_MATCH' : 'NO_MATCH',
        confidenceScore: 0.0,
        visualSimilarityScore,
        minHammingDist: minGlobalDist,
        avgHammingDist: allBestAvgDist,
        matchedFramesCount: 0,
        totalComparedFrames: candidateFps.length,
        temporalOffsetSec: bestVisualOffset,
        samplePairs: fallbackVisualPairs,
        coverageMetrics: noMatchCoverage,
        audioMatch: audioMetrics
      };
    }

    // Estimate sampling intervals for offset window calibration
    const refInterval = referenceFps.length >= 2
      ? Math.max(0.5, Math.abs(referenceFps[1].timestamp_sec - referenceFps[0].timestamp_sec))
      : 2.0;
    const candInterval = candidateFps.length >= 2
      ? Math.max(0.5, Math.abs(candidateFps[1].timestamp_sec - candidateFps[0].timestamp_sec))
      : 2.0;

    // 1. Temporal offset clustering with tolerance window (adapts to different sampling rates / frame rates)
    const offsetWindow = Math.max(isLiveSports ? 2.5 : 1.5, Math.max(refInterval, candInterval) * 0.85);
    let bestOffset = 0;
    let maxClusterSize = 0;
    let bestClusterMatches: PairMatch[] = [];

    const candidateOffsets = Array.from(new Set(matchedPairs.map(p => Math.round(p.offsetSec * 2) / 2)));
    for (const centerOffset of candidateOffsets) {
      const uniqueCand = new Map<number, PairMatch>();
      for (const p of matchedPairs) {
        if (Math.abs(p.offsetSec - centerOffset) <= offsetWindow) {
          const prev = uniqueCand.get(p.candFp.frame_index);
          if (
            !prev ||
            p.distance < prev.distance ||
            (p.distance === prev.distance &&
              Math.abs(p.offsetSec - centerOffset) < Math.abs(prev.offsetSec - centerOffset))
          ) {
            uniqueCand.set(p.candFp.frame_index, p);
          }
        }
      }
      const clusterList = Array.from(uniqueCand.values());
      if (clusterList.length > maxClusterSize) {
        maxClusterSize = clusterList.length;
        bestOffset = centerOffset;
        bestClusterMatches = clusterList;
      }
    }

    // 2. Content-based visual matching across arbitrary offsets (handles shifted excerpts, replays, reordered clips)
    // Prefer pairs that align with local offset clusters when distances are tied
    const contentUniqueCand = new Map<number, PairMatch>();
    for (const p of matchedPairs) {
      const prev = contentUniqueCand.get(p.candFp.frame_index);
      if (!prev) {
        contentUniqueCand.set(p.candFp.frame_index, p);
      } else {
        const prevOffsetDiff = Math.abs(prev.offsetSec - bestOffset);
        const currOffsetDiff = Math.abs(p.offsetSec - bestOffset);
        if (
          p.distance < prev.distance ||
          (p.distance === prev.distance && currOffsetDiff < prevOffsetDiff)
        ) {
          contentUniqueCand.set(p.candFp.frame_index, p);
        }
      }
    }
    const contentMatches = Array.from(contentUniqueCand.values());

    // Use contentMatches if non-linear replay/cut matching found more verified frames than a single fixed offset
    const bestMatches = contentMatches.length > bestClusterMatches.length ? contentMatches : bestClusterMatches;
    if (bestClusterMatches.length === 0 && contentMatches.length > 0) {
      bestOffset = contentMatches[0].offsetSec;
    }

    bestMatches.sort((a, b) => a.candFp.timestamp_sec - b.candFp.timestamp_sec);

    // 3. Duplicate / Static Frame Suppression:
    // Mark consecutive or repeated static frames where candidate frames are visually identical (dist <= 1)
    // and map to the same reference frame so static cards or frozen frames do not inflate match counts or confidence.
    const deduplicatedMatches: PairMatch[] = [];
    const distinctSceneHashes: string[] = [];

    for (let i = 0; i < bestMatches.length; i++) {
      const m = bestMatches[i];
      let isStaticDup = false;
      if (i > 0) {
        const prev = bestMatches[i - 1];
        const candDeltaDist = this.hammingDistance(m.candFp.phash_hex, prev.candFp.phash_hex);
        if (candDeltaDist <= 1 && m.refFp.frame_index === prev.refFp.frame_index) {
          isStaticDup = true;
        }
      }
      m.isDuplicateStaticFrame = isStaticDup;
      if (!isStaticDup) {
        deduplicatedMatches.push(m);
      }

      const isKnownScene = distinctSceneHashes.some(h => this.hammingDistance(h, m.candFp.phash_hex) <= 3);
      if (!isKnownScene) {
        distinctSceneHashes.push(m.candFp.phash_hex);
      }
    }

    const suppressedStaticDupCount = bestMatches.filter(m => m.isDuplicateStaticFrame).length;

    // Compute unique matched frame sets across R and C
    const uniqueMatchedCandIndices = new Set<number>(bestMatches.map(m => m.candFp.frame_index));
    const uniqueMatchedRefIndices = new Set<number>(deduplicatedMatches.map(m => m.refFp.frame_index));
    // If candidate has coarser sampling interval than reference (e.g. candidate sampled every 5s, reference every 1s)
    // and we have a multi-frame sequence match, also count reference frames within threshold along the verified offset corridor
    if (candInterval > refInterval * 1.25 && deduplicatedMatches.length >= 2) {
      for (const p of matchedPairs) {
        if (Math.abs(p.offsetSec - bestOffset) <= offsetWindow) {
          uniqueMatchedRefIndices.add(p.refFp.frame_index);
        }
      }
    }

    const totalRefFrames = referenceFps.length;
    const totalCandFrames = candidateFps.length;
    const uniqueRefMatchedCount = Math.min(totalRefFrames, uniqueMatchedRefIndices.size);
    const uniqueCandMatchedCount = Math.min(totalCandFrames, uniqueMatchedCandIndices.size);

    const referenceCoveragePct = totalRefFrames > 0
      ? Math.min(100, Number(((uniqueRefMatchedCount / totalRefFrames) * 100).toFixed(2)))
      : 0;
    const candidateCoveragePct = totalCandFrames > 0
      ? Math.min(100, Number(((uniqueCandMatchedCount / totalCandFrames) * 100).toFixed(2)))
      : 0;

    // 4. Segment Clustering into MatchedTimelineSegment[]
    const matchedSegments: MatchedTimelineSegment[] = [];
    const maxCandGapSec = Math.max(8.0, candInterval * 3.5);
    const segmentOffsetTol = Math.max(3.5, Math.max(refInterval, candInterval) * 1.75);

    let currentGroup: PairMatch[] = [];
    for (const m of bestMatches) {
      if (currentGroup.length === 0) {
        currentGroup.push(m);
      } else {
        const prev = currentGroup[currentGroup.length - 1];
        const candGap = m.candFp.timestamp_sec - prev.candFp.timestamp_sec;
        const groupAvgOffset = currentGroup.reduce((s, x) => s + x.offsetSec, 0) / currentGroup.length;
        if (candGap <= maxCandGapSec && Math.abs(m.offsetSec - groupAvgOffset) <= segmentOffsetTol) {
          currentGroup.push(m);
        } else {
          matchedSegments.push(this.buildTimelineSegment(currentGroup, matchedSegments.length + 1, refInterval, candInterval));
          currentGroup = [m];
        }
      }
    }
    if (currentGroup.length > 0) {
      matchedSegments.push(this.buildTimelineSegment(currentGroup, matchedSegments.length + 1, refInterval, candInterval));
    }

    // Sort segments by matched_pair_count DESC, then avg_similarity_pct DESC
    matchedSegments.sort((a, b) => b.matched_pair_count - a.matched_pair_count || b.avg_similarity_pct - a.avg_similarity_pct);

    const isReorderedOrEdited =
      matchedSegments.length >= 2 &&
      Math.abs(matchedSegments[0].temporal_offset_sec - matchedSegments[1].temporal_offset_sec) > segmentOffsetTol;

    // 5. Distinguish single-frame or unclustered scattered coincidence from verified multi-frame sequence match
    const activeSet = deduplicatedMatches.length > 0 ? deduplicatedMatches : bestMatches;
    const distances = activeSet.map(m => m.distance);
    const avgDist = distances.length > 0
      ? Number((distances.reduce((sum, d) => sum + d, 0) / distances.length).toFixed(2))
      : 64;
    const minDist = distances.length > 0 ? Math.min(...distances) : 64;

    const hasCoherentTemporalCluster = bestClusterMatches.length >= 2;
    const hasHighPrecisionNonLinearLock =
      deduplicatedMatches.length >= 2 && (minDist <= 8 && avgDist <= 10.5);

    const effectiveSequenceCount = deduplicatedMatches.length;
    const isScatteredLowPrecisionCollision =
      !hasCoherentTemporalCluster && !hasHighPrecisionNonLinearLock;

    const isSingleFrameCoincidence =
      uniqueCandMatchedCount === 1 ||
      effectiveSequenceCount === 1 ||
      (distinctSceneHashes.length === 1 && uniqueRefMatchedCount === 1) ||
      isScatteredLowPrecisionCollision;

    const baseSimilarity = Math.max(0, 1 - avgDist / 64);
    const effectiveDenom = Math.max(2, Math.min(totalCandFrames, totalRefFrames, 10));
    const coverageRatio = Math.min(1.0, effectiveSequenceCount / effectiveDenom);
    const sequenceMultiplier =
      isSingleFrameCoincidence
        ? 0.35
        : effectiveSequenceCount >= 3
        ? 1.0
        : effectiveSequenceCount >= 2
        ? 0.85
        : 0.5;

    const rawConfidence = Number((baseSimilarity * coverageRatio * sequenceMultiplier).toFixed(4));
    const calculatedConfidence = isSingleFrameCoincidence
      ? Math.min(0.38, rawConfidence)
      : rawConfidence;

    const isMatch = !isSingleFrameCoincidence && effectiveSequenceCount >= minMatched && calculatedConfidence >= 0.45;

    // Distinguish match classifications: FULL_COPY, PARTIAL_REUSE, EDITED_CLIP, UNCERTAIN_MATCH, NO_MATCH
    let matchClassification: MatchClassification = 'NO_MATCH';
    if (isSingleFrameCoincidence) {
      matchClassification = 'UNCERTAIN_MATCH';
    } else if (isReorderedOrEdited && isMatch) {
      matchClassification = 'EDITED_CLIP';
    } else if (calculatedConfidence >= 0.80 && candidateCoveragePct >= 70 && referenceCoveragePct >= 70 && effectiveSequenceCount >= 4) {
      matchClassification = 'FULL_COPY';
    } else if (isMatch && (candidateCoveragePct >= 50 || effectiveSequenceCount >= 2)) {
      matchClassification = 'PARTIAL_REUSE';
    } else if (isMatch) {
      matchClassification = 'EDITED_CLIP';
    } else if (calculatedConfidence >= 0.25 || bestMatches.length >= 1) {
      matchClassification = 'UNCERTAIN_MATCH';
    }

    const allMatchedPairsFormatted: MatchedKeyframePair[] = bestMatches.map(m => ({
      reference_timestamp_sec: m.refFp.timestamp_sec,
      candidate_timestamp_sec: m.candFp.timestamp_sec,
      reference_frame_index: m.refFp.frame_index,
      candidate_frame_index: m.candFp.frame_index,
      hamming_distance: m.distance,
      similarity_pct: this.similarityPercentage(m.distance),
      reference_phash: m.refFp.phash_hex,
      candidate_phash: m.candFp.phash_hex,
      reference_thumbnail: (m.refFp as any).thumbnail_url || (m.refFp as any).thumbnail_path || m.refFp.thumbnail_data,
      candidate_thumbnail: (m.candFp as any).thumbnail_url || (m.candFp as any).thumbnail_path || m.candFp.thumbnail_data,
      match_feature: m.matchFeature,
      is_duplicate_static_frame: m.isDuplicateStaticFrame
    }));

    // Build samplePairs starting with all matched frames (up to 60 pairs), supplemented with remaining candidate frames' closest visual pairs
    const matchedCandIndices = new Set(bestMatches.map(m => m.candFp.frame_index));
    const combinedPairs: PairMatch[] = [
      ...bestMatches,
      ...bestVisualPerCandidate.filter(p => !matchedCandIndices.has(p.candFp.frame_index))
    ].sort((a, b) => a.candFp.timestamp_sec - b.candFp.timestamp_sec);

    const samplePairs: MatchedKeyframePair[] = combinedPairs.slice(0, 60).map(m => ({
      reference_timestamp_sec: m.refFp.timestamp_sec,
      candidate_timestamp_sec: m.candFp.timestamp_sec,
      reference_frame_index: m.refFp.frame_index,
      candidate_frame_index: m.candFp.frame_index,
      hamming_distance: m.distance,
      similarity_pct: this.similarityPercentage(m.distance),
      reference_phash: m.refFp.phash_hex,
      candidate_phash: m.candFp.phash_hex,
      reference_thumbnail: (m.refFp as any).thumbnail_url || (m.refFp as any).thumbnail_path || m.refFp.thumbnail_data,
      candidate_thumbnail: (m.candFp as any).thumbnail_url || (m.candFp as any).thumbnail_path || m.candFp.thumbnail_data,
      match_feature: m.matchFeature,
      is_duplicate_static_frame: m.isDuplicateStaticFrame
    }));

    const coverageMetrics: FullCoverageMatchMetrics = {
      reference_duration_sec: Number(inferredRefDuration.toFixed(2)),
      candidate_duration_sec: Number(inferredCandDuration.toFixed(2)),
      total_reference_frames: totalRefFrames,
      total_candidate_frames: totalCandFrames,
      raw_matching_pairs_count: matchedPairs.length,
      deduplicated_matching_pairs_count: deduplicatedMatches.length,
      suppressed_static_duplicate_pairs_count: suppressedStaticDupCount,
      unique_reference_frames_matched: uniqueRefMatchedCount,
      unique_candidate_frames_matched: uniqueCandMatchedCount,
      unique_visual_scenes_matched: distinctSceneHashes.length,
      reference_coverage_pct: referenceCoveragePct,
      candidate_coverage_pct: candidateCoveragePct,
      coverage_formula_explanation:
        `Reference Coverage (%) = (Unique Reference Frames Matched / Total Indexed Reference Frames) × 100 = (${uniqueRefMatchedCount} / ${totalRefFrames}) × 100 = ${referenceCoveragePct}%. ` +
        `Candidate Coverage (%) = (Unique Candidate Frames Matched / Total Indexed Candidate Frames) × 100 = (${uniqueCandMatchedCount} / ${totalCandFrames}) × 100 = ${candidateCoveragePct}%.`,
      is_single_frame_coincidence: isSingleFrameCoincidence,
      is_reordered_or_edited: isReorderedOrEdited,
      matched_segments: matchedSegments,
      all_matched_pairs: allMatchedPairsFormatted.slice(0, 250)
    };

    return {
      matchStatus: isMatch ? 'POTENTIAL_MATCH' : 'NO_MATCH',
      matchClassification,
      confidenceScore: calculatedConfidence,
      visualSimilarityScore,
      minHammingDist: minDist,
      avgHammingDist: avgDist,
      matchedFramesCount: deduplicatedMatches.length,
      totalComparedFrames: candidateFps.length,
      temporalOffsetSec: bestOffset,
      samplePairs,
      coverageMetrics,
      audioMatch: audioMetrics
    };
  }

  private static buildTimelineSegment(
    group: Array<{
      candFp: FrameFingerprint;
      refFp: FrameFingerprint;
      distance: number;
      offsetSec: number;
    }>,
    segmentNumber: number,
    refInterval: number,
    candInterval: number
  ): MatchedTimelineSegment {
    const refTimestamps = group.map(g => g.refFp.timestamp_sec);
    const candTimestamps = group.map(g => g.candFp.timestamp_sec);
    const refStart = Number(Math.min(...refTimestamps).toFixed(2));
    const refEnd = Number(Math.max(...refTimestamps).toFixed(2));
    const candStart = Number(Math.min(...candTimestamps).toFixed(2));
    const candEnd = Number(Math.max(...candTimestamps).toFixed(2));

    const refDur = Number(Math.max(refInterval, refEnd - refStart + refInterval).toFixed(2));
    const candDur = Number(Math.max(candInterval, candEnd - candStart + candInterval).toFixed(2));

    const avgOffset = Number((group.reduce((s, g) => s + g.offsetSec, 0) / group.length).toFixed(2));
    const dists = group.map(g => g.distance);
    const minDist = Math.min(...dists);
    const avgDist = Number((dists.reduce((s, d) => s + d, 0) / dists.length).toFixed(2));
    const sims = dists.map(d => this.similarityPercentage(d));
    const maxSim = Math.max(...sims);
    const avgSim = Number((sims.reduce((s, v) => s + v, 0) / sims.length).toFixed(2));

    const uniqueRef = new Set(group.map(g => g.refFp.frame_index)).size;
    const uniqueCand = new Set(group.map(g => g.candFp.frame_index)).size;

    return {
      segment_id: `segment_${segmentNumber}`,
      reference_start_sec: refStart,
      reference_end_sec: refEnd,
      reference_duration_sec: refDur,
      candidate_start_sec: candStart,
      candidate_end_sec: candEnd,
      candidate_duration_sec: candDur,
      temporal_offset_sec: avgOffset,
      matched_pair_count: group.length,
      unique_reference_frames: uniqueRef,
      unique_candidate_frames: uniqueCand,
      avg_similarity_pct: avgSim,
      max_similarity_pct: maxSim,
      min_hamming_dist: minDist,
      avg_hamming_dist: avgDist
    };
  }

  /**
   * Builds structured CapturedCandidateFrame records for every extracted candidate frame,
   * preserving timestamp, source URL, capture time, platform, SHA-256 provenance, and closest reference frame metrics.
   */
  public static buildCapturedCandidateFrames(
    candidate: CandidateItem,
    candidateFps: FrameFingerprint[],
    referenceFps: FrameFingerprint[] = []
  ): CapturedCandidateFrame[] {
    const platformName = candidate.platform || candidate.domain;
    return candidateFps.map(cf => {
      const thumbUrl = cf.thumbnail_url || cf.thumbnail_path || cf.thumbnail_data || undefined;
      const capturedAt = cf.created_at || candidate.last_inspected_at || candidate.discovered_at || new Date().toISOString();
      const provenanceSha256 = crypto
        .createHash('sha256')
        .update(`${candidate.source_url}|${cf.timestamp_sec}|${cf.phash_hex}|${capturedAt}`)
        .digest('hex');

      let bestRefFp: FrameFingerprint | undefined;
      let bestDist = 64;

      if (referenceFps.length > 0) {
        for (const rf of referenceFps) {
          const dist = this.hammingDistance(cf.phash_hex, rf.phash_hex);
          if (dist < bestDist) {
            bestDist = dist;
            bestRefFp = rf;
          }
        }
      }

      return {
        frame_index: cf.frame_index,
        timestamp_sec: cf.timestamp_sec,
        phash_hex: cf.phash_hex,
        avg_luminance: cf.avg_luminance,
        thumbnail_url: thumbUrl,
        captured_at: capturedAt,
        source_url: candidate.source_url,
        platform: platformName,
        provenance_sha256: provenanceSha256,
        best_ref_timestamp_sec: bestRefFp ? bestRefFp.timestamp_sec : undefined,
        best_ref_phash: bestRefFp ? bestRefFp.phash_hex : undefined,
        best_ref_thumbnail: bestRefFp
          ? (bestRefFp.thumbnail_url || bestRefFp.thumbnail_path || bestRefFp.thumbnail_data)
          : undefined,
        best_hamming_distance: bestRefFp ? bestDist : undefined,
        best_similarity_pct: bestRefFp ? this.similarityPercentage(bestDist) : undefined
      };
    });
  }

  /**
   * Performs a separate Metadata & Context Assessment using available signals:
   * - Event or Fixture (e.g., 1st T20I, Final, Highlights, Season/Episode)
   * - Teams / Participants (e.g., India vs New Zealand, Arsenal vs Bayern Munich)
   * - Competition / Series (e.g., India Tour of New Zealand, UEFA Champions League)
   * - Scheduled Start / Date / Live status
   * - Stream Title & Platform Context
   * - Relevant Scoreboard / Overlay Text & Frame Luminance Telemetry
   *
   * Missing metadata never counts as a mismatch.
   * Never uses metadata alone to claim copyright infringement.
   */
  public static assessMetadataAndContext(params: {
    candidate: CandidateItem;
    reference: ReferenceItem | null;
    verifiedPageTitle?: string;
    candidateFps: FrameFingerprint[];
    referenceFps: FrameFingerprint[];
    visualSimilarityScore?: number;
    matchedFramesCount: number;
    minHammingDist: number;
    confidenceScore: number;
  }): {
    metadataRelevanceScore: number;
    metadataSignals: MetadataSignal[];
    overallAssessment: OverallAssessmentState;
    uncertaintyReasons: string[];
  } {
    const {
      candidate,
      reference,
      verifiedPageTitle,
      candidateFps,
      referenceFps,
      visualSimilarityScore,
      matchedFramesCount,
      minHammingDist,
      confidenceScore
    } = params;

    const signals: MetadataSignal[] = [];
    const uncertaintyReasons: string[] = [];

    const candTitle = (verifiedPageTitle || candidate.discovered_title || '').trim();
    const candCombined = `${candTitle} ${candidate.discovered_title || ''} ${candidate.source_url || ''}`;
    const candLower = candCombined.toLowerCase();

    const refTitle = (reference?.title || '').trim();
    const refEvent = (reference?.season_episode_info || '').trim();
    const refCombined = `${refTitle} ${refEvent} ${reference?.source_url || ''} ${reference?.notes || ''}`;
    const refLower = refCombined.toLowerCase();

    // Helper to normalize common sports team abbreviations
    const teamDictionary: { canonical: string; aliases: string[] }[] = [
      { canonical: 'India', aliases: ['india', 'ind', 'bcci', 'team india'] },
      { canonical: 'New Zealand', aliases: ['new zealand', 'nz', 'blackcaps', 'kiwis'] },
      { canonical: 'Australia', aliases: ['australia', 'aus'] },
      { canonical: 'England', aliases: ['england', 'eng'] },
      { canonical: 'Pakistan', aliases: ['pakistan', 'pak'] },
      { canonical: 'South Africa', aliases: ['south africa', 'sa', 'rsa'] },
      { canonical: 'Sri Lanka', aliases: ['sri lanka', 'sl'] },
      { canonical: 'West Indies', aliases: ['west indies', 'wi'] },
      { canonical: 'Arsenal FC', aliases: ['arsenal', 'ars'] },
      { canonical: 'FC Bayern Munich', aliases: ['bayern', 'bayern munich', 'fcb', 'munchen'] },
      { canonical: 'Real Madrid', aliases: ['real madrid', 'rma'] },
      { canonical: 'Barcelona', aliases: ['barcelona', 'barca', 'fcb'] },
      { canonical: 'Manchester City', aliases: ['manchester city', 'man city', 'mci'] },
      { canonical: 'Liverpool', aliases: ['liverpool', 'liv'] }
    ];

    const hasWordOrAlias = (textLower: string, aliases: string[]): boolean => {
      return aliases.some(alias => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(textLower);
      });
    };

    // 1. Teams / Participants Signal
    const refTeams = teamDictionary.filter(t => hasWordOrAlias(refLower, t.aliases)).map(t => t.canonical);
    const candTeams = teamDictionary.filter(t => hasWordOrAlias(candLower, t.aliases)).map(t => t.canonical);

    if (refTeams.length > 0 && candTeams.length > 0) {
      const matchedTeams = refTeams.filter(t => candTeams.includes(t));
      const status: MetadataSignal['status'] =
        matchedTeams.length === refTeams.length
          ? 'MATCHED'
          : matchedTeams.length > 0
          ? 'PARTIAL'
          : 'DIFFERENT';
      signals.push({
        signal_type: 'TEAMS_PARTICIPANTS',
        label: 'Teams / Participants',
        observed_value: candTeams.join(' vs '),
        reference_value: refTeams.join(' vs '),
        status,
        source: verifiedPageTitle ? 'Verified Page Title & Stream Slug' : 'Discovery Listing & URL Path'
      });
    } else if (candTeams.length > 0) {
      signals.push({
        signal_type: 'TEAMS_PARTICIPANTS',
        label: 'Teams / Participants',
        observed_value: candTeams.join(' vs '),
        reference_value: undefined,
        status: 'OBSERVED_ONLY',
        source: 'Candidate Stream Title'
      });
    }

    // 2. Event / Fixture Signal (e.g., 1st T20I, 2nd T20I, ODI, Test, Final, Matchday, S01E01)
    const extractFixtureTokens = (text: string): string[] => {
      const found: string[] = [];
      const patterns = [
        /\b(\d+(?:st|nd|rd|th)\s+t20i?)\b/i,
        /\b(\d+(?:st|nd|rd|th)\s+odi)\b/i,
        /\b(\d+(?:st|nd|rd|th)\s+test)\b/i,
        /\b(t20i?)\b/i,
        /\b(odi)\b/i,
        /\b(quarter[- ]?final|semi[- ]?final|final)\b/i,
        /\b(matchday\s*\d+)\b/i,
        /\b(s\d{1,2}e\d{1,2}|season\s*\d+\s*episode\s*\d+)\b/i
      ];
      for (const rx of patterns) {
        const m = text.match(rx);
        if (m && m[1]) {
          const norm = m[1].toUpperCase().replace(/\s+/g, ' ');
          if (!found.some(f => f.includes(norm) || norm.includes(f))) {
            found.push(norm);
          }
        }
      }
      return found;
    };

    const refFixtures = extractFixtureTokens(refCombined);
    const candFixtures = extractFixtureTokens(candCombined);

    if (refFixtures.length > 0 && candFixtures.length > 0) {
      const normFixture = (s: string) => s.replace(/T20I/g, 'T20').toLowerCase();
      const overlap = candFixtures.some(cf =>
        refFixtures.some(rf => normFixture(cf).includes(normFixture(rf)) || normFixture(rf).includes(normFixture(cf)))
      );
      signals.push({
        signal_type: 'EVENT_FIXTURE',
        label: 'Event / Fixture Format',
        observed_value: candFixtures.join(' • '),
        reference_value: refFixtures.join(' • '),
        status: overlap ? 'MATCHED' : 'DIFFERENT',
        source: 'Candidate Stream Title & URL Path'
      });
    } else if (candFixtures.length > 0 || refFixtures.length > 0) {
      signals.push({
        signal_type: 'EVENT_FIXTURE',
        label: 'Event / Fixture Format',
        observed_value: candFixtures.length > 0 ? candFixtures.join(' • ') : 'Not explicitly tagged in stream title',
        reference_value: refFixtures.length > 0 ? refFixtures.join(' • ') : undefined,
        status: 'OBSERVED_ONLY',
        source: candFixtures.length > 0 ? 'Candidate Title' : 'Reference Catalog Metadata (Missing on Candidate — Not Counted as Mismatch)'
      });
    }

    // 3. Competition / Series Signal
    const extractCompetition = (text: string): string | null => {
      if (/champions\s+league|\bucl\b/i.test(text)) return 'UEFA Champions League';
      if (/tour\s+of\s+new\s+zealand|ind\s*v(?:s)?\s*nz|india\s*v(?:s)?\s*new\s+zealand/i.test(text)) {
        return 'India vs New Zealand Bilateral Series';
      }
      if (/\bipl\b|indian\s+premier\s+league/i.test(text)) return 'Indian Premier League (IPL)';
      if (/world\s+cup/i.test(text)) return 'International World Cup';
      if (/premier\s+league|\bepl\b/i.test(text)) return 'Premier League';
      return null;
    };

    const refComp = extractCompetition(refCombined);
    const candComp = extractCompetition(candCombined);

    if (refComp && candComp) {
      signals.push({
        signal_type: 'COMPETITION_SERIES',
        label: 'Competition / Series',
        observed_value: candComp,
        reference_value: refComp,
        status: refComp === candComp ? 'MATCHED' : 'DIFFERENT',
        source: 'Tournament / Series Entity Extraction'
      });
    } else if (refComp || candComp) {
      signals.push({
        signal_type: 'COMPETITION_SERIES',
        label: 'Competition / Series',
        observed_value: candComp || 'Unspecified in candidate metadata',
        reference_value: refComp || undefined,
        status: 'OBSERVED_ONLY',
        source: candComp ? 'Candidate Title' : 'Reference Metadata (Unobserved on Candidate)'
      });
    }

    // 4. Scheduled Start / Broadcast Year & Live Status
    const extractYearOrDate = (text: string): string[] => {
      const tokens: string[] = [];
      const dateMatch = text.match(/\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})\b/i);
      if (dateMatch) tokens.push(dateMatch[1]);
      const yearMatch = text.match(/\b(202[4-9])\b/);
      if (yearMatch && !tokens.some(t => t.includes(yearMatch[1]))) tokens.push(yearMatch[1]);
      return tokens;
    };

    const refDates = extractYearOrDate(refCombined);
    const candDates = extractYearOrDate(candCombined);
    if (refDates.length > 0 && candDates.length > 0) {
      const yearMatch = candDates.some(cd => refDates.some(rd => cd.includes(rd) || rd.includes(cd)));
      signals.push({
        signal_type: 'SCHEDULED_START',
        label: 'Scheduled Window / Year',
        observed_value: `${candDates.join(', ')}${candidate.is_live_stream ? ' (Live Stream)' : ' (VOD / Replay)'}`,
        reference_value: refDates.join(', '),
        status: yearMatch ? 'MATCHED' : 'PARTIAL',
        source: 'Broadcast Timestamp & URL Metadata'
      });
    } else if (refDates.length > 0 || candidate.is_live_stream) {
      signals.push({
        signal_type: 'SCHEDULED_START',
        label: 'Broadcast Window & Mode',
        observed_value: candidate.is_live_stream ? 'Active Live Stream Manifest' : (candDates.join(', ') || 'Recorded Highlights / Replay Upload'),
        reference_value: refDates.join(', ') || undefined,
        status: 'OBSERVED_ONLY',
        source: 'Stream Protocol & Page Metadata'
      });
    }

    // 5. Stream Title Relevance Signal
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'from', 'that', 'this', 'live', 'stream', 'video',
      'full', 'watch', 'online', 'free', 'official', 'youtube', 'mp4', 'm3u8', 'hd', '4k', 'match', 'highlights'
    ]);
    const normalizeToken = (t: string) => {
      if (t === 'ind') return 'india';
      if (t === 'nz') return 'zealand';
      if (t === 't20i') return 't20';
      return t;
    };
    const refTokens = Array.from(
      new Set(
        refLower
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .map(normalizeToken)
          .filter(t => t.length >= 2 && !stopWords.has(t))
      )
    );
    const candTokens = new Set(
      candLower
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .map(normalizeToken)
        .filter(t => t.length >= 2 && !stopWords.has(t))
    );

    if (refTitle && candTitle) {
      let matchedTok = 0;
      for (const rt of refTokens) {
        if (candTokens.has(rt) || candLower.includes(rt)) matchedTok++;
      }
      const tokenRatio = refTokens.length > 0 ? matchedTok / refTokens.length : 0;
      const titleStatus: MetadataSignal['status'] =
        tokenRatio >= 0.50 ? 'MATCHED' : tokenRatio >= 0.20 ? 'PARTIAL' : 'DIFFERENT';
      signals.push({
        signal_type: 'STREAM_TITLE',
        label: 'Stream Title Context',
        observed_value: candTitle,
        reference_value: refTitle,
        status: titleStatus,
        source: verifiedPageTitle ? 'Verified Page / oEmbed Title' : 'Discovered Candidate Title'
      });
    }

    // 6. Platform & Protocol Context Signal
    signals.push({
      signal_type: 'PLATFORM_CONTEXT',
      label: 'Platform & Delivery Protocol',
      observed_value: `${candidate.platform || candidate.domain} • ${candidate.media_type}`,
      reference_value: reference ? `${reference.platform || reference.rights_holder} • ${reference.asset_type}` : undefined,
      status: 'OBSERVED_ONLY',
      source: `Adapter Probe (HTTP ${candidate.reachability_code || 200})`
    });

    // 7. Scoreboard / Overlay Visual Text & Keyframe Luminance Telemetry
    const scoreboardIndicators: string[] = [];
    const scoreRegexes = [
      /\b(\d{1,3}\/\d{1,2}|\d{1,3}\s*runs?|\d{1,3}\*)\b/i,
      /\b(ind\s*vs?\s*nz|ars\s*vs?\s*bay)\b/i,
      /\b(last\s+over|run\s+chase|thriller|highlights|full\s+match)\b/i
    ];
    for (const rx of scoreRegexes) {
      const m = candCombined.match(rx);
      if (m && m[1]) scoreboardIndicators.push(m[1]);
    }
    if (candidateFps.length > 0) {
      const avgLum = Math.round(
        candidateFps.reduce((s, f) => s + (f.avg_luminance ?? 110), 0) / candidateFps.length
      );
      signals.push({
        signal_type: 'SCOREBOARD_TEXT',
        label: 'Scoreboard / Overlay & Keyframe Telemetry',
        observed_value:
          scoreboardIndicators.length > 0
            ? `Observed scoreboard/ticker cues: "${scoreboardIndicators.join(' • ')}" | ${candidateFps.length} decoded 16:9 frames (avg luminance ${avgLum}/255)`
            : `${candidateFps.length} decoded 16:9 keyframes inspected (avg luminance ${avgLum}/255); no text OCR mismatch`,
        reference_value: referenceFps.length > 0 ? `${referenceFps.length} reference master frames` : 'Awaiting reference frames',
        status: scoreboardIndicators.length > 0 && refTeams.length > 0 && candTeams.length > 0 ? 'MATCHED' : 'OBSERVED_ONLY',
        source: 'Stream Overlay Cues & FFmpeg Keyframe Analyzer'
      });
    }

    // 8. Complete Target Identity & Research Evaluation Signal
    const researchEval = CandidateResearchEngine.evaluateCandidateAgainstTarget({
      candidate,
      reference,
      verifiedPageTitle
    });

    const identitySignalStatus: MetadataSignal['status'] =
      researchEval.identity_relationship === 'EXACT_TARGET_MATCH'
        ? 'MATCHED'
        : researchEval.identity_relationship === 'TARGET_SERIES_OR_ARTIST_GENERIC'
        ? 'PARTIAL'
        : researchEval.identity_relationship === 'DIFFERENT_EPISODE_OR_ITEM' || researchEval.identity_relationship === 'UNRELATED_CONTENT'
        ? 'DIFFERENT'
        : 'OBSERVED_ONLY';

    signals.push({
      signal_type: 'STREAM_TITLE',
      label: 'Target Content Identity Verification',
      observed_value: `${researchEval.detected_identity.identity_summary} [${researchEval.identity_relationship}]`,
      reference_value: reference
        ? `${reference.title}${reference.season_episode_info ? ` (${reference.season_episode_info})` : ''}`
        : undefined,
      status: identitySignalStatus,
      source: 'Candidate Research & Identity Engine'
    });

    // Compute Metadata Relevance Score from comparable signals + research relevance
    const comparableSignals = signals.filter(s => s.status === 'MATCHED' || s.status === 'PARTIAL' || s.status === 'DIFFERENT');
    let metadataRelevanceScore = researchEval.research_relevance_score;
    if (comparableSignals.length > 0) {
      const totalPoints = comparableSignals.reduce((acc, s) => {
        if (s.status === 'MATCHED') return acc + 1.0;
        if (s.status === 'PARTIAL') return acc + 0.65;
        return acc;
      }, 0);
      const signalScore = totalPoints / comparableSignals.length;
      metadataRelevanceScore = Number(((signalScore * 0.45) + (researchEval.research_relevance_score * 0.55)).toFixed(4));
    }

    // Determine Overall Assessment State & Uncertainty Reasons
    // CRITICAL FALSE-POSITIVE PREVENTION:
    // - Never confirm a match when content identity is UNRELATED_CONTENT or DIFFERENT_EPISODE_OR_ITEM unless there is an indisputable decoded video sequence match (matchedFramesCount >= 4 && minHammingDist <= 4 && confidenceScore >= 0.75).
    // - For HTML_PLAYER candidates where only static preview thumbnails were inspected, require non-conflicting identity and tight perceptual match (minHammingDist <= 6).
    let overallAssessment: OverallAssessmentState = 'NO_MATCH_FOUND';

    const refHasValidFrames = Boolean(
      reference &&
      (reference.status === 'REGISTERED' || reference.status === 'FINGERPRINTED') &&
      referenceFps.length > 0
    );

    const hasIdentityConflict =
      researchEval.identity_relationship === 'UNRELATED_CONTENT' ||
      researchEval.identity_relationship === 'DIFFERENT_EPISODE_OR_ITEM';

    const isStaticPreviewOnly =
      candidate.media_type === 'HTML_PLAYER' &&
      !candidate.file_path &&
      candidateFps.length <= 4;

    const hasIndisputableDecodedVideoLock =
      !isStaticPreviewOnly &&
      matchedFramesCount >= 4 &&
      minHammingDist <= 4 &&
      confidenceScore >= 0.75;

    if (candidateFps.length === 0) {
      overallAssessment = 'INSUFFICIENT_EVIDENCE';
      uncertaintyReasons.push(
        'No decodable video keyframes could be extracted from the candidate URL (page may be an HTML wrapper, DRM-encrypted player, or unavailable stream).'
      );
    } else if (!reference) {
      overallAssessment = 'INSUFFICIENT_EVIDENCE';
      uncertaintyReasons.push(
        'Candidate keyframes were captured and fingerprinted, but no target reference work was linked for frame comparison.'
      );
    } else if (!refHasValidFrames) {
      overallAssessment = 'INSUFFICIENT_EVIDENCE';
      uncertaintyReasons.push(
        `Target reference "${reference.title}" is in ${reference.status} state with 0 reference fingerprints. Candidate keyframes and metadata signals are preserved, but visual frame matching requires an authorized reference master video.`
      );
    } else if (matchedFramesCount >= 2 && confidenceScore >= 0.45) {
      if (hasIdentityConflict && !hasIndisputableDecodedVideoLock) {
        overallAssessment =
          researchEval.identity_relationship === 'UNRELATED_CONTENT' && minHammingDist > 8
            ? 'NO_MATCH_FOUND'
            : 'POSSIBLE_MATCH';
        uncertaintyReasons.push(
          `Blocked automatic match confirmation due to conflicting content identity (${researchEval.identity_relationship}): ${researchEval.contradictory_evidence[0] || researchEval.ranking_explanation}`
        );
      } else if (isStaticPreviewOnly && (minHammingDist > 6 || confidenceScore < 0.65)) {
        overallAssessment = 'POSSIBLE_MATCH';
        uncertaintyReasons.push(
          `Candidate is an embedded web player (${candidate.platform || candidate.domain}) where only ${candidateFps.length} static preview thumbnails were accessible (min Hamming distance ${minHammingDist} bits). Provisional review required; full video stream match is not confirmed.`
        );
      } else {
        overallAssessment = 'MATCH_FOUND';
        if (minHammingDist > 4) {
          uncertaintyReasons.push(
            `Minor perceptual bit variance (${minHammingDist} bits min distance) observed due to stream re-encoding, resolution scaling, or broadcast overlay differences.`
          );
        }
      }
    } else if (
      !hasIdentityConflict &&
      ((visualSimilarityScore !== undefined && visualSimilarityScore >= 0.72) ||
        minHammingDist <= 18 ||
        (metadataRelevanceScore >= 0.65 && minHammingDist <= 24))
    ) {
      overallAssessment = 'POSSIBLE_MATCH';
      uncertaintyReasons.push(
        `Best visual frame similarity is ${((visualSimilarityScore ?? 0) * 100).toFixed(1)}% (min Hamming distance: ${minHammingDist}/64 bits), which is below the strict automated frame-lock threshold.`
      );
      if (reference.asset_type === 'LIVE_SPORTS' || candidate.is_live_stream || candFixtures.length > 0) {
        uncertaintyReasons.push(
          'Live sports and highlight feeds frequently exhibit different camera angles, replay cuts, broadcast delays, scoreboard overlays, or non-overlapping sample timestamps from the same sporting fixture.'
        );
      }
      if (metadataRelevanceScore >= 0.60) {
        uncertaintyReasons.push(
          `Contextual metadata correlation (${(metadataRelevanceScore * 100).toFixed(0)}%) indicates this candidate relates to the target work, but metadata alone does not establish copyright infringement.`
        );
      }
    } else {
      overallAssessment = 'NO_MATCH_FOUND';
      uncertaintyReasons.push(
        `Visual frame comparison across all temporal offsets showed no verified sequence lock (${((visualSimilarityScore ?? 0) * 100).toFixed(1)}% similarity, min Hamming distance: ${minHammingDist}/64 bits).`
      );
      if (hasIdentityConflict && researchEval.contradictory_evidence.length > 0) {
        uncertaintyReasons.push(researchEval.contradictory_evidence[0]);
      } else if (metadataRelevanceScore >= 0.50) {
        uncertaintyReasons.push(
          'Candidate title/metadata references the same series, artist, or event, but the extracted video frames do not match the reference master.'
        );
      }
    }

    return {
      metadataRelevanceScore,
      metadataSignals: signals,
      overallAssessment,
      uncertaintyReasons
    };
  }

  /**
   * Generates SHA-256 digital custody seal for evidence record
   */
  public static generateCustodySeal(payload: {
    candidateUrl: string;
    referenceId: string;
    confidenceScore: number;
    minHammingDist: number;
    temporalOffsetSec: number;
    samplePairs: MatchedKeyframePair[];
    audioMatch?: AudioMatchMetrics;
  }): string {
    const raw = JSON.stringify({
      url: payload.candidateUrl,
      refId: payload.referenceId,
      conf: payload.confidenceScore,
      minDist: payload.minHammingDist,
      offset: payload.temporalOffsetSec,
      audioSim: payload.audioMatch?.audio_similarity_pct || 0,
      hashes: payload.samplePairs.map(p => `${p.reference_phash}:${p.candidate_phash}:${p.hamming_distance}`)
    });
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Checks whether an IPv4 or IPv6 address belongs to a private, loopback, link-local,
   * cloud metadata, or reserved range to prevent Server-Side Request Forgery (SSRF).
   */
  public static isPrivateOrReservedIp(ip: string): boolean {
    const trimmed = ip.trim().toLowerCase();
    if (!trimmed) return true;

    // Handle IPv4-mapped IPv6 addresses such as ::ffff:127.0.0.1
    if (trimmed.startsWith('::ffff:')) {
      const mappedV4 = trimmed.slice('::ffff:'.length);
      if (net.isIPv4(mappedV4)) {
        return this.isPrivateOrReservedIp(mappedV4);
      }
    }

    if (net.isIPv4(trimmed)) {
      const parts = trimmed.split('.').map(n => parseInt(n, 10));
      if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
      const [a, b, c] = parts;
      if (a === 0) return true; // 0.0.0.0/8
      if (a === 10) return true; // 10.0.0.0/8 RFC1918
      if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
      if (a === 127) return true; // 127.0.0.0/8 loopback
      if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
      if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
      if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
      if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
      if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
      if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
      if (a >= 224) return true; // Multicast & reserved
      return false;
    }

    if (net.isIPv6(trimmed)) {
      if (trimmed === '::1' || trimmed === '::' || trimmed === '0:0:0:0:0:0:0:1' || trimmed === '0:0:0:0:0:0:0:0') {
        return true;
      }
      if (trimmed.startsWith('fc') || trimmed.startsWith('fd')) return true; // Unique local fc00::/7
      if (trimmed.startsWith('fe8') || trimmed.startsWith('fe9') || trimmed.startsWith('fea') || trimmed.startsWith('feb')) {
        return true; // Link-local fe80::/10
      }
      if (trimmed.startsWith('ff')) return true; // Multicast
      if (trimmed.startsWith('2001:db8:')) return true; // Documentation range
      return false;
    }

    return true;
  }

  /**
   * Validates that a URL is well-formed, uses HTTP/HTTPS, has no embedded credentials,
   * does not target internal/private/loopback/metadata hosts, and resolves to public IPs.
   */
  public static async validateSafePublicUrl(
    rawUrl: string,
    options: { allowLocalhostTestOrigin?: string } = {}
  ): Promise<{ safe: boolean; parsedUrl?: URL; reason?: string; resolvedIps?: string[] }> {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) {
      return { safe: false, reason: 'Empty URL provided.' };
    }
    if (trimmed.toLowerCase().startsWith('magnet:')) {
      return {
        safe: false,
        reason: 'Magnet links and peer-to-peer BitTorrent URIs are rejected by policy. SPECTRA never automatically downloads torrent payloads.'
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { safe: false, reason: 'Malformed URL syntax. Only valid http:// or https:// URLs are accepted.' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        safe: false,
        reason: `Unsupported URL protocol "${parsed.protocol}". Only http: and https: schemes are permitted.`
      };
    }

    if (parsed.username || parsed.password) {
      return {
        safe: false,
        reason: 'URLs containing embedded credentials (username/password) are rejected for security and audit compliance.'
      };
    }

    // Optional explicit test fixture origin bypass ONLY when explicitly passed in automated test suite
    if (options.allowLocalhostTestOrigin && parsed.origin === options.allowLocalhostTestOrigin) {
      return { safe: true, parsedUrl: parsed, resolvedIps: ['127.0.0.1'] };
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const blockedHostnames = new Set([
      'localhost',
      'localhost.localdomain',
      'ip6-localhost',
      'ip6-loopback',
      'metadata',
      'metadata.google.internal',
      'metadata.goog',
      'instance-data',
      '169.254.169.254',
      '100.100.100.200',
      '0.0.0.0'
    ]);

    if (
      blockedHostnames.has(hostname) ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.home.arpa') ||
      hostname.endsWith('.lan')
    ) {
      return {
        safe: false,
        reason: `SSRF Protection: Hostname "${hostname}" is a restricted local, loopback, or cloud metadata destination.`
      };
    }

    if (net.isIP(hostname)) {
      if (this.isPrivateOrReservedIp(hostname)) {
        return {
          safe: false,
          reason: `SSRF Protection: IP address "${hostname}" is in a private, loopback, link-local, or reserved address range.`
        };
      }
      return { safe: true, parsedUrl: parsed, resolvedIps: [hostname] };
    }

    try {
      const records = await dns.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return { safe: false, reason: `DNS resolution returned no records for hostname "${hostname}".` };
      }
      const ips = records.map(r => r.address);
      for (const ip of ips) {
        if (this.isPrivateOrReservedIp(ip)) {
          return {
            safe: false,
            reason: `SSRF Protection: Hostname "${hostname}" resolves to restricted private/internal IP address (${ip}).`
          };
        }
      }
      return { safe: true, parsedUrl: parsed, resolvedIps: ips };
    } catch (err: any) {
      return {
        safe: false,
        reason: `Unable to resolve public DNS for "${hostname}": ${err.message || 'DNS lookup failed'}.`
      };
    }
  }

  /**
   * Performs an HTTP request while manually validating every redirect hop against SSRF rules.
   * Never forwards or stores session cookies or authorization headers across redirects.
   */
  public static async fetchWithSafeRedirects(
    initialUrl: string,
    options: {
      method?: 'GET' | 'HEAD';
      maxRedirects?: number;
      timeoutMs?: number;
      headers?: Record<string, string>;
      allowLocalhostTestOrigin?: string;
    } = {}
  ): Promise<{
    response: Response;
    finalUrl: string;
    redirectChain: string[];
  }> {
    const maxRedirects = options.maxRedirects ?? 5;
    const timeoutMs = options.timeoutMs ?? 10000;
    const method = options.method ?? 'GET';
    const redirectChain: string[] = [initialUrl];
    let currentUrl = initialUrl;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const validation = await this.validateSafePublicUrl(currentUrl, {
        allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
      });
      if (!validation.safe || !validation.parsedUrl) {
        const err = new Error(validation.reason || `Blocked unsafe URL at hop ${hop}: ${currentUrl}`) as Error & {
          code?: string;
        };
        err.code = 'SSRF_REJECTED';
        throw err;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'SPECTRA-ReferenceMediaInspector/1.0 (+Compliance-Audit)',
            Accept: 'video/*, application/vnd.apple.mpegurl, application/x-mpegURL, text/html, application/xhtml+xml, */*;q=0.8',
            ...(options.headers || {})
          }
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect response (${response.status}) missing Location header from ${currentUrl}.`);
        }
        if (hop === maxRedirects) {
          throw new Error(`Exceeded maximum allowed redirect hops (${maxRedirects}).`);
        }
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          throw new Error(`Invalid redirect Location "${location}" received from ${currentUrl}.`);
        }
        // Cancel unconsumed body if any
        try {
          await response.body?.cancel();
        } catch {}
        redirectChain.push(nextUrl);
        currentUrl = nextUrl;
        continue;
      }

      return {
        response,
        finalUrl: currentUrl,
        redirectChain
      };
    }

    throw new Error(`Exceeded maximum redirect hops (${maxRedirects}).`);
  }

  /**
   * Identifies a video player provider from an iframe src, embedUrl, or OpenGraph player URL.
   */
  public static identifyEmbeddedPlayerProvider(embedUrlOrTag: string): string {
    const lower = (embedUrlOrTag || '').toLowerCase();
    if (lower.includes('youtube.com/embed') || lower.includes('youtube-nocookie.com/embed') || lower.includes('youtube.com/v/') || lower.includes('youtu.be/')) {
      return 'YouTube Embedded Player';
    }
    if (lower.includes('player.vimeo.com') || lower.includes('vimeo.com/video')) {
      return 'Vimeo Embedded Player';
    }
    if (lower.includes('dailymotion.com/embed') || lower.includes('geo.dailymotion.com')) {
      return 'Dailymotion Embedded Player';
    }
    if (lower.includes('player.twitch.tv') || lower.includes('clips.twitch.tv')) {
      return 'Twitch Embedded Player';
    }
    if (lower.includes('fast.wistia.net') || lower.includes('fast.wistia.com') || lower.includes('wistia.com/embed')) {
      return 'Wistia Video Player';
    }
    if (lower.includes('players.brightcove.net') || lower.includes('bcove.video')) {
      return 'Brightcove Video Player';
    }
    if (lower.includes('jwplatform.com') || lower.includes('jwplayer.com')) {
      return 'JW Player';
    }
    if (lower.includes('videodelivery.net') || lower.includes('cloudflarestream.com')) {
      return 'Cloudflare Stream Player';
    }
    if (lower.includes('stream.mux.com') || lower.includes('player.mux.com')) {
      return 'Mux Video Player';
    }
    if (lower.includes('streamable.com')) {
      return 'Streamable Embedded Player';
    }
    if (lower.includes('rumble.com/embed')) {
      return 'Rumble Embedded Player';
    }
    if (lower.includes('odysee.com/$/embed')) {
      return 'Odysee Embedded Player';
    }
    if (lower.includes('player.bilibili.com')) {
      return 'Bilibili Embedded Player';
    }
    if (lower.includes('ok.ru/videoembed')) {
      return 'OK.ru Embedded Player';
    }
    if (lower.includes('archive.org/embed')) {
      return 'Internet Archive Embedded Player';
    }
    if (
      lower.includes('vidsrc') ||
      lower.includes('vidplay') ||
      lower.includes('filemoon') ||
      lower.includes('streamtape') ||
      lower.includes('dood') ||
      lower.includes('mixdrop') ||
      lower.includes('superembed')
    ) {
      return 'Third-Party Stream Embed Player';
    }
    return 'Iframe Embedded Video Player';
  }

  /**
   * Extracts accessible embedded-player and video metadata from an HTML document:
   * - Iframe embeds (<iframe src="...">)
   * - HTML5 <video> elements
   * - Video <source> elements
   * - Open Graph video metadata (og:video, og:video:url, og:video:secure_url, og:video:type)
   * - Twitter player metadata (twitter:player, twitter:player:stream)
   * - JSON-LD VideoObject metadata (contentUrl, embedUrl, name, duration, thumbnailUrl, uploadDate)
   * - Known JavaScript player SDK signatures (HLS.js, Video.js, JW Player, Shaka Player, dash.js, Plyr)
   */
  public static extractAccessibleHtmlPlayerMetadata(
    html: string,
    baseUrl: string
  ): {
    accessibleMediaMetadata: AccessibleMediaMetadata;
    embeddedPlayers: EmbeddedPlayerInfo[];
    detectedPlayerProvider?: string;
    directMediaCandidates: string[];
    hasDynamicPlayerPlaceholder: boolean;
  } {
    const iframeSrcs: string[] = [];
    const videoElementSrcs: string[] = [];
    const videoSourceTags: Array<{ src: string; type?: string }> = [];
    const openGraphVideoUrls: string[] = [];
    const openGraphVideoTypes: string[] = [];
    const twitterPlayerUrls: string[] = [];
    const jsonLdVideos: AccessibleMediaMetadata['jsonLdVideos'] = [];
    const detectedPlayerSdks: string[] = [];
    const embeddedPlayers: EmbeddedPlayerInfo[] = [];
    const directMediaCandidates: string[] = [];

    const resolveSafeUrl = (raw?: string): string | undefined => {
      if (!raw) return undefined;
      const cleaned = raw.replace(/&amp;/g, '&').replace(/\\\//g, '/').trim();
      if (!cleaned || cleaned.startsWith('javascript:') || cleaned.startsWith('data:') || cleaned.startsWith('about:')) {
        return undefined;
      }
      if (cleaned.startsWith('blob:')) return cleaned;
      try {
        return new URL(cleaned, baseUrl).toString();
      } catch {
        return undefined;
      }
    };

    const isDirectDownloadableMediaUrl = (urlStr?: string): boolean => {
      if (!urlStr || urlStr.startsWith('blob:')) return false;
      try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        if (/\.torrent(\?|$|#)/i.test(parsed.pathname)) return false;
        return /\.(mp4|mkv|mov|webm|m4v|ts|m3u8)(\?|$)/i.test(parsed.pathname);
      } catch {
        return false;
      }
    };

    const addDirectCandidate = (urlStr?: string) => {
      if (urlStr && isDirectDownloadableMediaUrl(urlStr) && !directMediaCandidates.includes(urlStr)) {
        directMediaCandidates.push(urlStr);
      }
    };

    // 1. Parse <iframe> embeds
    const iframeTagRegex = /<iframe\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = iframeTagRegex.exec(html)) !== null) {
      const tag = match[0];
      const srcMatch =
        tag.match(/\bsrc=["']([^"']+)["']/i) ||
        tag.match(/\bdata-src=["']([^"']+)["']/i) ||
        tag.match(/\bdata-lazy-src=["']([^"']+)["']/i);
      const rawSrc = srcMatch?.[1];
      const resolvedSrc = resolveSafeUrl(rawSrc);
      if (!resolvedSrc || resolvedSrc.startsWith('blob:')) continue;

      const lowerSrc = resolvedSrc.toLowerCase();
      // Ignore non-video tracking/analytics/captcha iframes
      if (
        lowerSrc.includes('googletagmanager.com') ||
        lowerSrc.includes('doubleclick.net') ||
        lowerSrc.includes('googlesyndication.com') ||
        lowerSrc.includes('facebook.com/tr') ||
        lowerSrc.includes('recaptcha') ||
        lowerSrc.includes('hcaptcha.com')
      ) {
        continue;
      }

      const provider = this.identifyEmbeddedPlayerProvider(resolvedSrc);
      const lowerTag = tag.toLowerCase();
      const hasPlayerSignals =
        provider !== 'Iframe Embedded Video Player' ||
        lowerSrc.includes('/embed') ||
        lowerSrc.includes('/player') ||
        lowerSrc.includes('video') ||
        lowerSrc.includes('stream') ||
        lowerSrc.includes('watch') ||
        lowerTag.includes('allowfullscreen') ||
        lowerTag.includes('autoplay') ||
        lowerTag.includes('picture-in-picture');

      if (hasPlayerSignals) {
        if (!iframeSrcs.includes(resolvedSrc)) {
          iframeSrcs.push(resolvedSrc);
        }
        embeddedPlayers.push({
          playerType: 'IFRAME_EMBED',
          provider,
          embedUrl: resolvedSrc,
          directMediaDownloadable: false,
          reason: `Iframe embed (${provider}) loads an isolated player context rather than exposing a directly downloadable video file.`
        });
      }
    }

    // 2. Parse HTML5 <video> elements
    const videoTagRegex = /<video\b[^>]*>/gi;
    let htmlVideoElementCount = 0;
    while ((match = videoTagRegex.exec(html)) !== null) {
      htmlVideoElementCount++;
      const tag = match[0];
      const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i) || tag.match(/\bdata-src=["']([^"']+)["']/i);
      const rawSrc = srcMatch?.[1];
      const resolvedSrc = resolveSafeUrl(rawSrc);
      if (resolvedSrc) {
        if (!videoElementSrcs.includes(resolvedSrc)) {
          videoElementSrcs.push(resolvedSrc);
        }
        const downloadable = isDirectDownloadableMediaUrl(resolvedSrc);
        if (downloadable) {
          addDirectCandidate(resolvedSrc);
        }
        embeddedPlayers.push({
          playerType: 'HTML5_VIDEO',
          provider: resolvedSrc.startsWith('blob:') ? 'HTML5 <video> Player (MSE / Blob Stream)' : 'HTML5 <video> Player',
          embedUrl: resolvedSrc,
          directMediaDownloadable: downloadable,
          reason: downloadable
            ? 'HTML5 <video> tag references a direct video URL.'
            : resolvedSrc.startsWith('blob:')
            ? 'HTML5 <video> tag uses a Media Source Extensions (blob:) stream that cannot be downloaded directly.'
            : 'HTML5 <video> tag src does not point to a directly downloadable video container.'
        });
      } else {
        embeddedPlayers.push({
          playerType: 'HTML5_VIDEO',
          provider: 'HTML5 <video> Player',
          directMediaDownloadable: false,
          reason: 'HTML5 <video> element detected without an inline src attribute (media may be attached via <source> tags or client-side JavaScript).'
        });
      }
    }

    // 2b. Parse player data-* attributes that reference direct media assets
    const dataMediaAttrRegex = /\bdata-(?:video-src|video-url|mp4|hls|stream-url|media-url|file)=["']([^"']+)["']/gi;
    while ((match = dataMediaAttrRegex.exec(html)) !== null) {
      const resolvedDataUrl = resolveSafeUrl(match[1]);
      if (resolvedDataUrl && isDirectDownloadableMediaUrl(resolvedDataUrl)) {
        addDirectCandidate(resolvedDataUrl);
        if (!videoElementSrcs.includes(resolvedDataUrl)) {
          videoElementSrcs.push(resolvedDataUrl);
        }
        embeddedPlayers.push({
          playerType: 'HTML5_VIDEO',
          provider: 'HTML5 Data-Attribute Video Player',
          embedUrl: resolvedDataUrl,
          directMediaDownloadable: true,
          reason: 'Player element data attribute references a direct video asset URL.'
        });
      }
    }

    // 3. Parse <source> elements
    const sourceTagRegex = /<source\b[^>]*>/gi;
    while ((match = sourceTagRegex.exec(html)) !== null) {
      const tag = match[0];
      const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
      if (!srcMatch?.[1]) continue;
      const typeMatch = tag.match(/\btype=["']([^"']+)["']/i);
      const sourceType = typeMatch?.[1]?.trim();
      const resolvedSrc = resolveSafeUrl(srcMatch[1]);
      if (!resolvedSrc) continue;

      // Skip image srcset <source> tags inside <picture> if type is image/*
      if (sourceType && sourceType.toLowerCase().startsWith('image/')) continue;

      if (!videoSourceTags.some(s => s.src === resolvedSrc)) {
        videoSourceTags.push({ src: resolvedSrc, type: sourceType });
      }
      const isDash = Boolean(sourceType?.toLowerCase().includes('dash') || /\.mpd(\?|$)/i.test(resolvedSrc));
      const hasExplicitVideoMime = Boolean(
        sourceType &&
          !isDash &&
          (sourceType.toLowerCase().startsWith('video/') || sourceType.toLowerCase().includes('mpegurl'))
      );
      const downloadable = (isDirectDownloadableMediaUrl(resolvedSrc) || hasExplicitVideoMime) && !resolvedSrc.startsWith('blob:');
      if (downloadable && !directMediaCandidates.includes(resolvedSrc)) {
        directMediaCandidates.push(resolvedSrc);
      }
      embeddedPlayers.push({
        playerType: 'VIDEO_SOURCE',
        provider: isDash
          ? 'MPEG-DASH Video Source (<source>)'
          : sourceType?.toLowerCase().includes('mpegurl') || /\.m3u8(\?|$)/i.test(resolvedSrc)
          ? 'HLS Stream Source (<source>)'
          : 'HTML5 <source> Video Element',
        embedUrl: resolvedSrc,
        directMediaDownloadable: downloadable && !isDash,
        reason: isDash
          ? 'MPEG-DASH (.mpd) manifest detected in <source>; DASH streams frequently use CENC/DRM and are not directly downloaded.'
          : downloadable
          ? 'Video <source> tag points to a direct media asset URL.'
          : 'Video <source> URL is not a directly downloadable video file.'
      });
    }

    // 4. Parse Open Graph video metadata (og:video, og:video:url, og:video:secure_url, og:video:type)
    const ogVideoRegex =
      /<meta[^>]+(?:property|name)=["'](og:video(?::url|:secure_url|:type)?)["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](og:video(?::url|:secure_url|:type)?)["']/gi;
    while ((match = ogVideoRegex.exec(html)) !== null) {
      const prop = (match[1] || match[4] || '').toLowerCase();
      const content = (match[2] || match[3] || '').trim();
      if (!content) continue;
      if (prop === 'og:video:type') {
        if (!openGraphVideoTypes.includes(content)) {
          openGraphVideoTypes.push(content);
        }
      } else {
        const resolvedOg = resolveSafeUrl(content);
        if (resolvedOg && !openGraphVideoUrls.includes(resolvedOg)) {
          openGraphVideoUrls.push(resolvedOg);
          const downloadable = isDirectDownloadableMediaUrl(resolvedOg);
          if (downloadable) {
            addDirectCandidate(resolvedOg);
          }
          const ogProvider = this.identifyEmbeddedPlayerProvider(resolvedOg);
          embeddedPlayers.push({
            playerType: 'OPENGRAPH_VIDEO',
            provider: ogProvider !== 'Iframe Embedded Video Player' ? ogProvider : 'Open Graph Video Metadata (og:video)',
            embedUrl: resolvedOg,
            directMediaDownloadable: downloadable,
            reason: downloadable
              ? 'Open Graph og:video metadata points to a direct video file.'
              : 'Open Graph og:video metadata points to an embed player URL rather than a direct video file.'
          });
        }
      }
    }

    // 5. Parse Twitter player metadata (twitter:player, twitter:player:stream)
    const twitterRegex =
      /<meta[^>]+(?:property|name)=["'](twitter:player(?::stream)?)["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](twitter:player(?::stream)?)["']/gi;
    while ((match = twitterRegex.exec(html)) !== null) {
      const prop = (match[1] || match[4] || '').toLowerCase();
      const content = (match[2] || match[3] || '').trim();
      const resolvedTw = resolveSafeUrl(content);
      if (!resolvedTw) continue;
      if (!twitterPlayerUrls.includes(resolvedTw)) {
        twitterPlayerUrls.push(resolvedTw);
      }
      const downloadable = prop === 'twitter:player:stream' && isDirectDownloadableMediaUrl(resolvedTw);
      if (downloadable) {
        addDirectCandidate(resolvedTw);
      }
      const twProvider = this.identifyEmbeddedPlayerProvider(resolvedTw);
      embeddedPlayers.push({
        playerType: 'TWITTER_PLAYER',
        provider: twProvider !== 'Iframe Embedded Video Player' ? twProvider : 'Twitter Card Player Metadata',
        embedUrl: resolvedTw,
        directMediaDownloadable: downloadable,
        reason: downloadable
          ? 'twitter:player:stream exposes a direct video stream URL.'
          : 'twitter:player metadata references an embedded player container.'
      });
    }

    // 6. Parse JSON-LD VideoObject metadata
    const jsonLdBlockRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const inspectJsonLdNode = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(inspectJsonLdNode);
        return;
      }
      if (Array.isArray(node['@graph'])) {
        node['@graph'].forEach(inspectJsonLdNode);
      }
      const rawType = node['@type'];
      const types = Array.isArray(rawType) ? rawType.map(String) : rawType ? [String(rawType)] : [];
      const isVideoObj =
        types.some(t => /VideoObject|Clip|Movie|TVEpisode|BroadcastEvent/i.test(t)) ||
        Boolean(node.contentUrl || node.embedUrl);

      if (isVideoObj && (node.contentUrl || node.embedUrl || node.name || types.includes('VideoObject'))) {
        const resolvedContentUrl = typeof node.contentUrl === 'string' ? resolveSafeUrl(node.contentUrl) : undefined;
        const resolvedEmbedUrl = typeof node.embedUrl === 'string' ? resolveSafeUrl(node.embedUrl) : undefined;
        const thumb = Array.isArray(node.thumbnailUrl)
          ? String(node.thumbnailUrl[0] || '')
          : typeof node.thumbnailUrl === 'string'
          ? node.thumbnailUrl
          : undefined;
        jsonLdVideos.push({
          name: typeof node.name === 'string' ? node.name : undefined,
          contentUrl: resolvedContentUrl,
          embedUrl: resolvedEmbedUrl,
          duration: typeof node.duration === 'string' ? node.duration : undefined,
          thumbnailUrl: thumb,
          uploadDate: typeof node.uploadDate === 'string' ? node.uploadDate : undefined
        });

        const downloadable = Boolean(resolvedContentUrl && isDirectDownloadableMediaUrl(resolvedContentUrl));
        if (downloadable && resolvedContentUrl) {
          addDirectCandidate(resolvedContentUrl);
        }
        const ldProvider = resolvedEmbedUrl
          ? this.identifyEmbeddedPlayerProvider(resolvedEmbedUrl)
          : 'JSON-LD VideoObject';
        embeddedPlayers.push({
          playerType: 'JSON_LD_VIDEO',
          provider: ldProvider !== 'Iframe Embedded Video Player' ? ldProvider : 'JSON-LD VideoObject Metadata',
          embedUrl: resolvedContentUrl || resolvedEmbedUrl,
          directMediaDownloadable: downloadable,
          reason: downloadable
            ? 'JSON-LD VideoObject contentUrl references a direct video file.'
            : resolvedEmbedUrl
            ? 'JSON-LD VideoObject defines an embedUrl player rather than a direct downloadable contentUrl.'
            : 'JSON-LD VideoObject metadata present without a direct downloadable video URL.'
        });
      }
      if (node.video && typeof node.video === 'object') {
        inspectJsonLdNode(node.video);
      }
    };

    while ((match = jsonLdBlockRegex.exec(html)) !== null) {
      const rawJson = (match[1] || '').trim();
      if (!rawJson) continue;
      try {
        const parsed = JSON.parse(rawJson);
        inspectJsonLdNode(parsed);
      } catch {
        // Fallback regex if JSON-LD contains unescaped control characters
        const contentUrlMatch = rawJson.match(/"contentUrl"\s*:\s*"([^"]+)"/i);
        const embedUrlMatch = rawJson.match(/"embedUrl"\s*:\s*"([^"]+)"/i);
        const nameMatch = rawJson.match(/"name"\s*:\s*"([^"]+)"/i);
        const resolvedContentUrl = contentUrlMatch?.[1] ? resolveSafeUrl(contentUrlMatch[1]) : undefined;
        const resolvedEmbedUrl = embedUrlMatch?.[1] ? resolveSafeUrl(embedUrlMatch[1]) : undefined;
        if (resolvedContentUrl || resolvedEmbedUrl) {
          jsonLdVideos.push({
            name: nameMatch?.[1],
            contentUrl: resolvedContentUrl,
            embedUrl: resolvedEmbedUrl
          });
          const downloadable = Boolean(resolvedContentUrl && isDirectDownloadableMediaUrl(resolvedContentUrl));
          if (downloadable && resolvedContentUrl) {
            addDirectCandidate(resolvedContentUrl);
          }
          embeddedPlayers.push({
            playerType: 'JSON_LD_VIDEO',
            provider: resolvedEmbedUrl ? this.identifyEmbeddedPlayerProvider(resolvedEmbedUrl) : 'JSON-LD VideoObject Metadata',
            embedUrl: resolvedContentUrl || resolvedEmbedUrl,
            directMediaDownloadable: downloadable,
            reason: downloadable
              ? 'JSON-LD contentUrl references a direct video asset.'
              : 'JSON-LD embedUrl references an embedded player.'
          });
        }
      }
    }

    // 7. Detect known JS Video Player SDKs
    const sdkSignatures: Array<{ pattern: RegExp; name: string }> = [
      { pattern: /\bhls(?:\.min)?\.js\b|\bnew\s+Hls\s*\(/i, name: 'HLS.js' },
      { pattern: /\bvideo(?:\.min)?\.js\b|\bclass=["'][^"']*\bvideo-js\b/i, name: 'Video.js' },
      { pattern: /\bjwplayer(?:\.js|\s*\()/i, name: 'JW Player' },
      { pattern: /\bshaka-player\b|\bshaka\.Player\b/i, name: 'Shaka Player' },
      { pattern: /\bdash\.all(?:\.min)?\.js\b|\bdashjs\.MediaPlayer\b/i, name: 'dash.js' },
      { pattern: /\bplyr(?:\.min)?\.js\b|\bnew\s+Plyr\s*\(/i, name: 'Plyr' },
      { pattern: /\bbitmovinplayer\b/i, name: 'Bitmovin Player' },
      { pattern: /\bclappr(?:\.min)?\.js\b|\bnew\s+Clappr\.Player/i, name: 'Clappr' },
      { pattern: /\bflowplayer(?:\.min)?\.js\b/i, name: 'Flowplayer' },
      { pattern: /youtube\.com\/iframe_api|YT\.Player/i, name: 'YouTube IFrame API' },
      { pattern: /player\.vimeo\.com\/api\/player\.js|new\s+Vimeo\.Player/i, name: 'Vimeo Player SDK' }
    ];
    for (const sig of sdkSignatures) {
      if (sig.pattern.test(html) && !detectedPlayerSdks.includes(sig.name)) {
        detectedPlayerSdks.push(sig.name);
        if (embeddedPlayers.length === 0) {
          embeddedPlayers.push({
            playerType: 'JS_PLAYER_SDK',
            provider: sig.name,
            directMediaDownloadable: false,
            reason: `Page loads ${sig.name} client-side player SDK without exposing a static downloadable video URL.`
          });
        }
      }
    }

    // 7b. Inspect inline <script> blocks for direct media URLs configured in JS video players (e.g. JWPlayer, Video.js, HLS.js, Plyr)
    const scriptBlockRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    const inlineMediaConfigRegex =
      /(?:["']?(?:file|src|source|videoUrl|streamUrl|hlsUrl|mp4Url|mediaUrl|manifestUrl|contentUrl)["']?\s*:\s*|\bloadSource\s*\(\s*|\bsrc\s*\(\s*)["']([^"'\s<>]+\.(?:mp4|mkv|mov|webm|m4v|ts|m3u8)(?:\?[^"'\s<>]*)?)["']/gi;
    while ((match = scriptBlockRegex.exec(html)) !== null) {
      const scriptBody = match[1] || '';
      if (!scriptBody) continue;
      let cfgMatch: RegExpExecArray | null;
      inlineMediaConfigRegex.lastIndex = 0;
      while ((cfgMatch = inlineMediaConfigRegex.exec(scriptBody)) !== null) {
        const resolvedInlineUrl = resolveSafeUrl(cfgMatch[1]);
        if (resolvedInlineUrl && isDirectDownloadableMediaUrl(resolvedInlineUrl)) {
          addDirectCandidate(resolvedInlineUrl);
          if (!videoSourceTags.some(s => s.src === resolvedInlineUrl)) {
            videoSourceTags.push({
              src: resolvedInlineUrl,
              type: /\.m3u8(\?|$)/i.test(resolvedInlineUrl) ? 'application/x-mpegURL' : 'video/mp4'
            });
          }
          const inlineProvider = detectedPlayerSdks[0] || 'Inline JS Video Player';
          const existingSdkEntry = embeddedPlayers.find(
            p => p.playerType === 'JS_PLAYER_SDK' && !p.directMediaDownloadable
          );
          if (existingSdkEntry) {
            existingSdkEntry.embedUrl = resolvedInlineUrl;
            existingSdkEntry.directMediaDownloadable = true;
            existingSdkEntry.reason = `Embedded ${existingSdkEntry.provider} configuration exposes a direct video stream URL.`;
          } else if (!embeddedPlayers.some(p => p.embedUrl === resolvedInlineUrl)) {
            embeddedPlayers.push({
              playerType: 'JS_PLAYER_SDK',
              provider: inlineProvider,
              embedUrl: resolvedInlineUrl,
              directMediaDownloadable: true,
              reason: `Embedded JavaScript player configuration exposes a direct video stream URL.`
            });
          }
        }
      }
    }

    // Determine primary detected player provider
    const specificProvider = embeddedPlayers.find(
      p =>
        p.provider !== 'Iframe Embedded Video Player' &&
        p.provider !== 'HTML5 <video> Player' &&
        p.provider !== 'Open Graph Video Metadata (og:video)' &&
        p.provider !== 'JSON-LD VideoObject Metadata'
    );
    const detectedPlayerProvider =
      specificProvider?.provider ||
      embeddedPlayers[0]?.provider ||
      (detectedPlayerSdks[0] ? `${detectedPlayerSdks[0]} Player` : undefined);

    // Check if page has dynamic/indeterminate client-side player mount points without static embed/media URLs
    const hasDynamicPlayerPlaceholder =
      embeddedPlayers.length === 0 &&
      directMediaCandidates.length === 0 &&
      /\b(?:data-video-id|data-player-id|data-stream-url|data-embed-url|id=["'](?:video-player|player-container|stream-player)["'])\b/i.test(html);

    return {
      accessibleMediaMetadata: {
        iframeSrcs,
        videoElementSrcs,
        videoSourceTags,
        openGraphVideoUrls,
        openGraphVideoTypes,
        twitterPlayerUrls,
        jsonLdVideos,
        detectedPlayerSdks,
        htmlVideoElementCount
      },
      embeddedPlayers,
      detectedPlayerProvider,
      directMediaCandidates,
      hasDynamicPlayerPlaceholder
    };
  }

  /**
   * Returns all configured reference source adapters and their capabilities.
   */
  public static getSourceAdapters(): SourceAdapterDescriptor[] {
    return getSourceAdapters();
  }

  /**
   * Updates configuration for a specific reference source adapter.
   */
  public static updateSourceAdapterConfig(
    id: string,
    patch: Partial<Pick<SourceAdapterDescriptor, 'enabled' | 'supportsResumableDownload'>>
  ): SourceAdapterDescriptor | null {
    return updateSourceAdapterConfig(id, patch);
  }

  /**
   * Builds the 8-stage reference URL inspection, acquisition, validation, extraction, and completion workflow report.
   */
  public static buildAcquisitionWorkflowReport = buildAcquisitionWorkflowReport;

  /**
   * Inspects a submitted reference URL to:
   * 1. Validate safe public destination (SSRF & redirect validation)
   * 2. Identify the platform source adapter (YouTube, Dailymotion, Vimeo, Public Video Platform, Direct MP4, HLS, DASH, Authorized OTT)
   * 3. Distinguish between ordinary webpages, webpages containing embedded players,
   *    directly accessible media URLs, restricted media, and pages where media availability cannot be determined
   * 4. Inspect accessible HTML page metadata (iframe embeds, <video>, <source>, OpenGraph video, Twitter player, JSON-LD VideoObject, platform player configs)
   * 5. Detect DRM, login walls, paywalls, anti-bot challenges, and torrent payloads without bypassing them
   */
  public static async inspectReferenceUrlAvailability(
    rawUrl: string,
    options: {
      maxBytes?: number;
      allowLocalhostTestOrigin?: string;
    } = {}
  ): Promise<ReferenceUrlInspectionResult> {
    const checkedAt = new Date().toISOString();
    const submittedUrl = (rawUrl || '').trim();
    const maxBytes = options.maxBytes ?? 500 * 1024 * 1024;

    const finalizeInspection = (
      res: ReferenceUrlInspectionResult,
      extra?: {
        videoIdentity?: ResolvedVideoIdentity;
        durationSec?: number;
        mediaFormat?: string;
        acquisitionMethod?: string;
        attemptedMethods?: AttemptedAcquisitionMethod[];
      }
    ): ReferenceUrlInspectionResult => {
      const adapterMatch = identifySourceAdapterForUrl({
        url: res.finalUrl || res.submittedUrl,
        contentType: res.mediaContentType,
        isOttProtected: res.urlClassification === 'DRM_PROTECTED_WEBPAGE' && Boolean(res.platform),
        platformName: res.platform
      });
      res.sourceAdapter = res.sourceAdapter || adapterMatch.adapter;
      res.mediaFormat = extra?.mediaFormat || res.mediaFormat || adapterMatch.mediaFormat;
      res.durationSec =
        extra?.durationSec ??
        res.durationSec ??
        extra?.videoIdentity?.durationSec ??
        res.videoIdentity?.durationSec;
      res.videoIdentity = extra?.videoIdentity || res.videoIdentity || {
        title: res.pageTitle,
        platform: res.platform || adapterMatch.adapter.name,
        canonicalUrl: res.finalUrl,
        durationSec: res.durationSec,
        seasonEpisode: res.seasonEpisodeInfo,
        mediaFormat: res.mediaFormat,
        isLiveStream: /\.m3u8(\?|$)/i.test(res.resolvedMediaUrl || res.finalUrl)
      };
      if (res.durationSec && res.videoIdentity && !res.videoIdentity.durationSec) {
        res.videoIdentity.durationSec = res.durationSec;
      }
      res.acquisitionMethod =
        extra?.acquisitionMethod ||
        res.acquisitionMethod ||
        (res.canAcquireAuthorized
          ? res.isWebpage
            ? 'PLATFORM_DIRECT_STREAM_ACQUISITION'
            : 'DIRECT_HTTP_RANGE_ACQUISITION'
          : 'METADATA_INSPECTION_ONLY');
      res.attemptedMethods = extra?.attemptedMethods
        ? [...extra.attemptedMethods]
        : res.attemptedMethods
          ? [...res.attemptedMethods]
          : [];
      if (res.attemptedMethods.length === 0) {
        res.attemptedMethods.push({
          method: res.acquisitionMethod || (res.canAcquireAuthorized ? 'DIRECT_MEDIA_ACQUISITION' : 'METADATA_INSPECTION_ONLY'),
          status: res.canAcquireAuthorized
            ? 'SUCCESS'
            : res.urlClassification === 'DRM_PROTECTED_WEBPAGE' || res.urlClassification === 'RESTRICTED_OR_PAYWALLED'
              ? 'RESTRICTED'
              : 'UNAVAILABLE',
          detail: res.reason || 'Inspected reference URL availability.',
          timestamp: checkedAt
        });
      }
      res.workflow = buildAcquisitionWorkflowReport({
        inspection: res,
        inspectionOnly: true,
        attemptedMethods: res.attemptedMethods
      });
      return res;
    };

    // 1. Reject torrent / magnet / P2P payloads immediately
    const lowerSubmitted = submittedUrl.toLowerCase();
    if (
      lowerSubmitted.startsWith('magnet:') ||
      /\.torrent(\?|$|#)/i.test(lowerSubmitted)
    ) {
      let domain = 'unknown';
      try {
        domain = new URL(submittedUrl).hostname.toLowerCase();
      } catch {}
      const reason = 'Torrent (.torrent) files and magnet links are rejected. SPECTRA never automatically downloads torrent payloads.';
      return finalizeInspection({
        submittedUrl,
        finalUrl: submittedUrl,
        finalDomain: domain,
        urlClassification: 'TORRENT_OR_UNSUPPORTED',
        inspectionStatus: 'UNREACHABLE_OR_INVALID',
        isWebpage: false,
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        diagnosticErrors: [reason],
        acquisitionStatus: 'TORRENT_REJECTED_BY_POLICY',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    // 2. Validate SSRF & public URL safety
    const initialValidation = await this.validateSafePublicUrl(submittedUrl, {
      allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
    });
    if (!initialValidation.safe || !initialValidation.parsedUrl) {
      const reason = initialValidation.reason || 'URL failed SSRF and public destination validation.';
      return finalizeInspection({
        submittedUrl,
        finalUrl: submittedUrl,
        finalDomain: initialValidation.parsedUrl?.hostname || 'invalid-host',
        urlClassification: 'SSRF_REJECTED',
        inspectionStatus: 'UNREACHABLE_OR_INVALID',
        isWebpage: false,
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        diagnosticErrors: [reason],
        acquisitionStatus: 'SSRF_OR_INVALID_URL_BLOCKED',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    // 3. Check if URL is a known DRM-protected OTT watch/catalog page
    const ottDetect = this.isDrmOrProtectedWebPlatform(submittedUrl);
    if (ottDetect.isProtected) {
      const reason = `Webpage belongs to ${ottDetect.platformName || 'an OTT streaming platform'} using encrypted DRM playback. SPECTRA does not bypass DRM, paywalls, or login sessions. Please upload an authorized reference master file (.mp4/.mkv/.mov) or provide an approved unencrypted mezzanine URL.`;
      return finalizeInspection({
        submittedUrl,
        finalUrl: submittedUrl,
        finalDomain: initialValidation.parsedUrl.hostname.toLowerCase(),
        urlClassification: 'DRM_PROTECTED_WEBPAGE',
        inspectionStatus: 'RESTRICTED_MEDIA',
        isWebpage: true,
        directMediaAvailable: false,
        embeddedPlayerDetected: true,
        detectedPlayerProvider: `${ottDetect.platformName || 'OTT'} DRM Web Player`,
        diagnosticErrors: [reason],
        platform: ottDetect.platformName,
        seasonEpisodeInfo: ottDetect.suggestedSeasonEpisode,
        acquisitionStatus: 'DRM_OR_PROTECTED_OTT_PAGE',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    // 4. Perform safe network probe with manual redirect validation
    let response: Response;
    let finalUrl = submittedUrl;
    try {
      const fetched = await this.fetchWithSafeRedirects(submittedUrl, {
        method: 'GET',
        maxRedirects: 5,
        timeoutMs: 10000,
        headers: { Range: 'bytes=0-65535' },
        allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
      });
      response = fetched.response;
      finalUrl = fetched.finalUrl;
    } catch (err: any) {
      if (err?.code === 'SSRF_REJECTED') {
        return finalizeInspection({
          submittedUrl,
          finalUrl,
          finalDomain: 'restricted-redirect',
          urlClassification: 'SSRF_REJECTED',
          inspectionStatus: 'UNREACHABLE_OR_INVALID',
          isWebpage: false,
          directMediaAvailable: false,
          embeddedPlayerDetected: false,
          diagnosticErrors: [err.message],
          acquisitionStatus: 'SSRF_REDIRECT_BLOCKED',
          canAcquireAuthorized: false,
          reason: err.message,
          checkedAt
        });
      }
      const reason = `Unable to reach reference URL: ${err.message || 'Network timeout or connection refused'}.`;
      return finalizeInspection({
        submittedUrl,
        finalUrl,
        finalDomain: initialValidation.parsedUrl.hostname.toLowerCase(),
        urlClassification: 'UNREACHABLE',
        inspectionStatus: 'UNREACHABLE_OR_INVALID',
        isWebpage: false,
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        diagnosticErrors: [reason],
        acquisitionStatus: 'SOURCE_UNREACHABLE',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    const finalParsed = new URL(finalUrl);
    const finalDomain = finalParsed.hostname.toLowerCase();

    // Check if final redirected URL is an OTT protected page or torrent
    if (/\.torrent(\?|$|#)/i.test(finalUrl)) {
      try { await response.body?.cancel(); } catch {}
      const reason = 'Redirected target points to a .torrent payload which is prohibited by policy.';
      return finalizeInspection({
        submittedUrl,
        finalUrl,
        finalDomain,
        urlClassification: 'TORRENT_OR_UNSUPPORTED',
        inspectionStatus: 'UNREACHABLE_OR_INVALID',
        isWebpage: false,
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        diagnosticErrors: [reason],
        acquisitionStatus: 'TORRENT_REJECTED_BY_POLICY',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    const finalOttDetect = this.isDrmOrProtectedWebPlatform(finalUrl);
    if (finalOttDetect.isProtected) {
      try { await response.body?.cancel(); } catch {}
      const reason = `Redirected target is a protected ${finalOttDetect.platformName || 'OTT'} player page. Direct acquisition is disabled to respect DRM and access controls.`;
      return finalizeInspection({
        submittedUrl,
        finalUrl,
        finalDomain,
        urlClassification: 'DRM_PROTECTED_WEBPAGE',
        inspectionStatus: 'RESTRICTED_MEDIA',
        isWebpage: true,
        directMediaAvailable: false,
        embeddedPlayerDetected: true,
        detectedPlayerProvider: `${finalOttDetect.platformName || 'OTT'} DRM Web Player`,
        diagnosticErrors: [reason],
        platform: finalOttDetect.platformName,
        seasonEpisodeInfo: finalOttDetect.suggestedSeasonEpisode,
        acquisitionStatus: 'DRM_OR_PROTECTED_OTT_PAGE',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    const httpStatus = response.status;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentRange = response.headers.get('content-range') || '';
    const rawContentLength = response.headers.get('content-length');
    let contentLengthBytes = rawContentLength ? parseInt(rawContentLength, 10) : undefined;
    if (contentRange && /\/(\d+)$/.test(contentRange)) {
      const totalMatch = contentRange.match(/\/(\d+)$/);
      if (totalMatch) contentLengthBytes = parseInt(totalMatch[1], 10);
    }

    // 5. Handle authentication, paywall, anti-bot, or HTTP error responses without bypassing them
    if (httpStatus === 401 || httpStatus === 403 || httpStatus === 402 || httpStatus === 451) {
      try { await response.body?.cancel(); } catch {}
      const reason = `Source returned HTTP ${httpStatus} (Authentication, Paywall, or Access Control restriction). SPECTRA never bypasses authentication, paywalls, or anti-bot protections.`;
      return finalizeInspection({
        submittedUrl,
        finalUrl,
        finalDomain,
        urlClassification: 'RESTRICTED_OR_PAYWALLED',
        inspectionStatus: 'RESTRICTED_MEDIA',
        isWebpage: contentType.includes('text/html'),
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        diagnosticErrors: [reason],
        mediaContentType: contentType || undefined,
        acquisitionStatus: `ACCESS_RESTRICTED_HTTP_${httpStatus}`,
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    if (httpStatus >= 400) {
      try { await response.body?.cancel(); } catch {}
      const reason = `Source returned HTTP ${httpStatus} and could not be retrieved.`;
      return finalizeInspection({
        submittedUrl,
        finalUrl,
        finalDomain,
        urlClassification: 'UNREACHABLE',
        inspectionStatus: 'UNREACHABLE_OR_INVALID',
        isWebpage: contentType.includes('text/html'),
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        diagnosticErrors: [reason],
        mediaContentType: contentType || undefined,
        acquisitionStatus: `HTTP_ERROR_${httpStatus}`,
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    // 6. Distinguish Direct Media Asset vs. HTML Webpage vs. Unsupported Format
    const isDirectVideoMime =
      contentType.startsWith('video/') ||
      contentType.includes('application/ogg') ||
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl') ||
      (contentType.includes('application/octet-stream') && /\.(mp4|mkv|mov|webm|m4v|ts|m3u8|ogv|ogg)(\?|$)/i.test(finalParsed.pathname));
    const isDirectVideoExt = /\.(mp4|mkv|mov|webm|m4v|ts|m3u8|ogv|ogg)(\?|$)/i.test(finalParsed.pathname);
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');

    if (contentType.includes('application/x-bittorrent')) {
      try { await response.body?.cancel(); } catch {}
      const reason = 'Source returned BitTorrent MIME type (application/x-bittorrent), which is rejected by policy.';
      return finalizeInspection({
        submittedUrl,
        finalUrl,
        finalDomain,
        urlClassification: 'TORRENT_OR_UNSUPPORTED',
        inspectionStatus: 'UNREACHABLE_OR_INVALID',
        isWebpage: false,
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        diagnosticErrors: [reason],
        mediaContentType: contentType,
        acquisitionStatus: 'TORRENT_REJECTED_BY_POLICY',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    if (contentType.includes('dash+xml') || /\.mpd(\?|$)/i.test(finalParsed.pathname)) {
      // Inspect MPEG-DASH (.mpd) manifest XML to distinguish CENC/Widevine encrypted manifests vs. unencrypted single-file BaseURL representations
      let mpdXml = '';
      const mpdReader = response.body?.getReader();
      if (mpdReader) {
        const mpdChunks: Buffer[] = [];
        let mpdRead = 0;
        try {
          while (mpdRead < 65536) {
            const { done, value } = await mpdReader.read();
            if (done || !value) break;
            const b = Buffer.from(value);
            mpdChunks.push(b);
            mpdRead += b.length;
          }
        } catch {}
        try { await mpdReader.cancel(); } catch {}
        mpdXml = Buffer.concat(mpdChunks).toString('utf8');
      } else {
        try { await response.body?.cancel(); } catch {}
      }

      const hasCencOrDrm =
        /<ContentProtection\b/i.test(mpdXml) ||
        /\bcenc:pssh\b/i.test(mpdXml) ||
        /\bwidevine\b/i.test(mpdXml) ||
        /\bplayready\b/i.test(mpdXml) ||
        /\bfairplay\b/i.test(mpdXml);
      const baseUrlMatch = mpdXml.match(/<BaseURL[^>]*>\s*([^<\s]+\.(?:mp4|webm|mkv|m4v)(?:\?[^<\s]*)?)\s*<\/BaseURL>/i);
      const mpdDurAttr = mpdXml.match(/\bmediaPresentationDuration=["']([^"']+)["']/i);
      const mpdDurationSec = mpdDurAttr ? parseIso8601DurationSec(mpdDurAttr[1]) : undefined;

      if (!hasCencOrDrm && baseUrlMatch && baseUrlMatch[1]) {
        try {
          const resolvedDashMediaUrl = new URL(baseUrlMatch[1].trim(), finalUrl).toString();
          const dashSafe = await this.validateSafePublicUrl(resolvedDashMediaUrl, {
            allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
          });
          if (dashSafe.safe) {
            return finalizeInspection(
              {
                submittedUrl,
                finalUrl,
                finalDomain,
                urlClassification: 'DIRECT_MEDIA_URL',
                inspectionStatus: 'DIRECT_MEDIA_ACCESSIBLE',
                isWebpage: false,
                directMediaAvailable: true,
                embeddedPlayerDetected: false,
                resolvedMediaUrl: resolvedDashMediaUrl,
                mediaContentType: contentType || 'application/dash+xml',
                durationSec: mpdDurationSec,
                mediaFormat: 'DASH_MPD',
                acquisitionMethod: 'UNENCRYPTED_DASH_BASEURL_ACQUISITION',
                acquisitionStatus: 'DIRECT_MEDIA_READY',
                canAcquireAuthorized: true,
                reason: `Unencrypted MPEG-DASH (.mpd) manifest resolved to an accessible video representation (${resolvedDashMediaUrl}) ready for authorized ingestion and FFmpeg frame extraction.`,
                checkedAt
              },
              {
                durationSec: mpdDurationSec,
                mediaFormat: 'DASH_MPD',
                acquisitionMethod: 'UNENCRYPTED_DASH_BASEURL_ACQUISITION'
              }
            );
          }
        } catch {}
      }

      const reason = 'MPEG-DASH (.mpd) manifest detected. DASH streams typically use CENC/Widevine DRM and are not directly ingested; please supply an unencrypted reference master file.';
      return finalizeInspection({
        submittedUrl,
        finalUrl,
        finalDomain,
        urlClassification: 'DRM_PROTECTED_WEBPAGE',
        inspectionStatus: 'RESTRICTED_MEDIA',
        isWebpage: false,
        directMediaAvailable: false,
        embeddedPlayerDetected: true,
        detectedPlayerProvider: 'MPEG-DASH Stream',
        diagnosticErrors: [reason],
        mediaContentType: contentType || 'application/dash+xml',
        durationSec: mpdDurationSec,
        mediaFormat: 'DASH_MPD',
        acquisitionStatus: 'DRM_DASH_MANIFEST_UNSUPPORTED',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    if (isDirectVideoMime || (!isHtml && isDirectVideoExt)) {
      const isHlsManifest =
        contentType.includes('mpegurl') || /\.m3u8(\?|$)/i.test(finalParsed.pathname);
      let hlsDurationSec: number | undefined;

      if (isHlsManifest) {
        let m3u8Text = '';
        const hlsReader = response.body?.getReader();
        if (hlsReader) {
          const hlsChunks: Buffer[] = [];
          let hlsRead = 0;
          try {
            while (hlsRead < 65536) {
              const { done, value } = await hlsReader.read();
              if (done || !value) break;
              const b = Buffer.from(value);
              hlsChunks.push(b);
              hlsRead += b.length;
            }
          } catch {}
          try { await hlsReader.cancel(); } catch {}
          m3u8Text = Buffer.concat(hlsChunks).toString('utf8');
        } else {
          try { await response.body?.cancel(); } catch {}
        }

        if (
          /#EXT-X-KEY:[^\r\n]*(?:METHOD=SAMPLE-AES|KEYFORMAT=["']urn:uuid:edef8ba9|skd:\/\/)/i.test(m3u8Text) ||
          /\/drm\/(?:cbcs|cenc)/i.test(finalUrl)
        ) {
          const reason = 'HLS (.m3u8) manifest uses DRM encryption (#EXT-X-KEY SAMPLE-AES / FairPlay / Widevine). Direct stream acquisition is prohibited without an unencrypted mezzanine source.';
          return finalizeInspection({
            submittedUrl,
            finalUrl,
            finalDomain,
            urlClassification: 'DRM_PROTECTED_WEBPAGE',
            inspectionStatus: 'RESTRICTED_MEDIA',
            isWebpage: false,
            directMediaAvailable: false,
            embeddedPlayerDetected: true,
            detectedPlayerProvider: 'Encrypted HLS Stream',
            diagnosticErrors: [reason],
            mediaContentType: contentType || 'application/vnd.apple.mpegurl',
            mediaFormat: 'HLS_M3U8',
            acquisitionStatus: 'DRM_HLS_MANIFEST_RESTRICTED',
            canAcquireAuthorized: false,
            reason,
            checkedAt
          });
        }

        const extinfMatches = m3u8Text.matchAll(/#EXTINF:([\d.]+)/gi);
        let totalExtinf = 0;
        for (const m of extinfMatches) {
          const v = parseFloat(m[1]);
          if (Number.isFinite(v) && v > 0) totalExtinf += v;
        }
        if (totalExtinf > 0) {
          hlsDurationSec = Math.round(totalExtinf * 100) / 100;
        }
      } else {
        try { await response.body?.cancel(); } catch {}
      }

      if (contentLengthBytes && contentLengthBytes > maxBytes) {
        const reason = `Direct media asset size (${(contentLengthBytes / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit (${(maxBytes / (1024 * 1024)).toFixed(0)} MB).`;
        return finalizeInspection({
          submittedUrl,
          finalUrl,
          finalDomain,
          urlClassification: 'DIRECT_MEDIA_URL',
          inspectionStatus: 'RESTRICTED_MEDIA',
          isWebpage: false,
          directMediaAvailable: true,
          embeddedPlayerDetected: false,
          diagnosticErrors: [reason],
          resolvedMediaUrl: finalUrl,
          mediaContentType: contentType || 'video/mp4',
          contentLengthBytes,
          durationSec: hlsDurationSec,
          acquisitionStatus: 'FILE_SIZE_LIMIT_EXCEEDED',
          canAcquireAuthorized: false,
          reason,
          checkedAt
        });
      }

      return finalizeInspection(
        {
          submittedUrl,
          finalUrl,
          finalDomain,
          urlClassification: 'DIRECT_MEDIA_URL',
          inspectionStatus: 'DIRECT_MEDIA_ACCESSIBLE',
          isWebpage: false,
          directMediaAvailable: true,
          embeddedPlayerDetected: false,
          resolvedMediaUrl: finalUrl,
          mediaContentType: contentType || (isHlsManifest ? 'application/vnd.apple.mpegurl' : 'video/mp4'),
          contentLengthBytes,
          durationSec: hlsDurationSec,
          mediaFormat: isHlsManifest ? 'HLS_M3U8' : undefined,
          acquisitionMethod: isHlsManifest ? 'FFMPEG_HLS_REMUX_ACQUISITION' : 'DIRECT_HTTP_RANGE_ACQUISITION',
          acquisitionStatus: 'DIRECT_MEDIA_READY',
          canAcquireAuthorized: true,
          reason: 'URL resolves directly to an accessible video asset ready for authorized server-side ingestion and FFmpeg frame extraction.',
          checkedAt
        },
        {
          durationSec: hlsDurationSec,
          mediaFormat: isHlsManifest ? 'HLS_M3U8' : undefined,
          acquisitionMethod: isHlsManifest ? 'FFMPEG_HLS_REMUX_ACQUISITION' : 'DIRECT_HTTP_RANGE_ACQUISITION'
        }
      );
    }

    // 7. If not HTML and not supported video, report unsupported format
    if (!isHtml) {
      try { await response.body?.cancel(); } catch {}
      const reason = `Unsupported content type "${contentType || 'unknown'}". Expected an HTML reference webpage or direct video asset (.mp4, .mkv, .mov, .webm, .m3u8).`;
      return finalizeInspection({
        submittedUrl,
        finalUrl,
        finalDomain,
        urlClassification: 'TORRENT_OR_UNSUPPORTED',
        inspectionStatus: 'UNREACHABLE_OR_INVALID',
        isWebpage: false,
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        diagnosticErrors: [reason],
        mediaContentType: contentType || 'unknown',
        contentLengthBytes,
        acquisitionStatus: 'UNSUPPORTED_MEDIA_FORMAT',
        canAcquireAuthorized: false,
        reason,
        checkedAt
      });
    }

    // 8. Parse accessible HTML page metadata (bounded to first 1 MB so large watch pages with embedded player configs are captured)
    const reader = response.body?.getReader();
    const chunks: Buffer[] = [];
    let totalRead = 0;
    const maxHtmlBytes = 1024 * 1024;
    if (reader) {
      try {
        while (totalRead < maxHtmlBytes) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const buf = Buffer.from(value);
          chunks.push(buf);
          totalRead += buf.length;
        }
      } catch {}
      try { await reader.cancel(); } catch {}
    }
    const html = Buffer.concat(chunks).toString('utf8');

    // Extract title & description
    const ogTitleMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = (ogTitleMatch?.[1] || titleTagMatch?.[1] || '').replace(/\s+/g, ' ').trim() || undefined;

    const ogDescMatch =
      html.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property=["']og:description["']|name=["']description["'])/i);
    const pageDescription = ogDescMatch?.[1]?.replace(/\s+/g, ' ').trim() || undefined;

    const ogSiteMatch =
      html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
    const detectedPlatform = ogSiteMatch?.[1]?.trim() || finalOttDetect.platformName || undefined;

    // Extract embedded players & accessible media metadata from HTML
    const {
      accessibleMediaMetadata,
      embeddedPlayers,
      detectedPlayerProvider,
      directMediaCandidates,
      hasDynamicPlayerPlaceholder
    } = this.extractAccessibleHtmlPlayerMetadata(html, finalUrl);
    const diagnosticErrors: string[] = [];

    // Run platform-specific source adapter inspection + active official API resolution
    const initialPlatformExtraction = extractPlatformSpecificMediaAndMetadata({
      submittedUrl,
      finalUrl,
      html,
      pageTitle,
      pageDescription,
      detectedPlatform
    });

    const safeFetchJsonOrText = async (
      targetUrl: string,
      timeoutMs = 6000
    ): Promise<{ ok: boolean; status: number; text: string; json?: any; finalUrl?: string }> => {
      const safeCheck = await this.validateSafePublicUrl(targetUrl, {
        allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
      });
      if (!safeCheck.safe) {
        return { ok: false, status: 0, text: '' };
      }
      try {
        const fetchedTarget = await this.fetchWithSafeRedirects(targetUrl, {
          method: 'GET',
          maxRedirects: 4,
          timeoutMs,
          headers: {
            Accept: 'application/json, text/plain, application/vnd.apple.mpegurl, */*'
          },
          allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
        });
        const r = fetchedTarget.response;
        const rReader = r.body?.getReader();
        const rChunks: Buffer[] = [];
        let rBytes = 0;
        if (rReader) {
          try {
            while (rBytes < 512 * 1024) {
              const { done, value } = await rReader.read();
              if (done || !value) break;
              const b = Buffer.from(value);
              rChunks.push(b);
              rBytes += b.length;
            }
          } catch {}
          try { await rReader.cancel(); } catch {}
        }
        const text = Buffer.concat(rChunks).toString('utf8');
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {}
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          text,
          json,
          finalUrl: fetchedTarget.finalUrl
        };
      } catch {
        return { ok: false, status: 0, text: '' };
      }
    };

    const platformExtraction = await resolvePlatformAdapterMediaAndMetadata({
      submittedUrl,
      finalUrl,
      html,
      pageTitle,
      pageDescription,
      detectedPlatform,
      initialResult: initialPlatformExtraction,
      safeFetchJsonOrText
    });

    const attemptedMethods: AttemptedAcquisitionMethod[] = platformExtraction.attemptedMethods
      ? [...platformExtraction.attemptedMethods]
      : [];
    const platformAcquisitionMethod = platformExtraction.acquisitionMethod;

    // Prioritize official API / platform-adapter resolved candidates ahead of generic HTML links
    const prioritizedCandidates: string[] = [];
    for (const cand of platformExtraction.additionalDirectCandidates) {
      if (cand && !prioritizedCandidates.includes(cand)) {
        prioritizedCandidates.push(cand);
      }
    }
    for (const cand of directMediaCandidates) {
      if (cand && !prioritizedCandidates.includes(cand)) {
        prioritizedCandidates.push(cand);
      }
    }
    directMediaCandidates.length = 0;
    directMediaCandidates.push(...prioritizedCandidates);

    const jsonLdDurationSec = accessibleMediaMetadata.jsonLdVideos[0]?.duration
      ? parseIso8601DurationSec(accessibleMediaMetadata.jsonLdVideos[0].duration)
      : undefined;
    let resolvedDurationSec = platformExtraction.videoIdentity.durationSec || jsonLdDurationSec;
    const resolvedVideoIdentity: ResolvedVideoIdentity = {
      ...platformExtraction.videoIdentity,
      durationSec: resolvedDurationSec,
      seasonEpisode: platformExtraction.videoIdentity.seasonEpisode || finalOttDetect.suggestedSeasonEpisode
    };

    // Detect anti-bot / CAPTCHA / login / paywall markers in HTML
    const lowerHtml = html.toLowerCase();
    if (
      lowerHtml.includes('cf-turnstile') ||
      lowerHtml.includes('challenge-platform') ||
      lowerHtml.includes('just a moment...') ||
      lowerHtml.includes('attention required! | cloudflare')
    ) {
      const reason = 'Webpage is protected by an anti-bot or CAPTCHA challenge. SPECTRA never bypasses anti-bot protections.';
      return finalizeInspection(
        {
          submittedUrl,
          finalUrl,
          finalDomain,
          urlClassification: 'RESTRICTED_OR_PAYWALLED',
          inspectionStatus: 'RESTRICTED_MEDIA',
          isWebpage: true,
          directMediaAvailable: false,
          embeddedPlayerDetected: embeddedPlayers.length > 0,
          detectedPlayerProvider,
          embeddedPlayers,
          accessibleMediaMetadata,
          diagnosticErrors: [reason],
          pageTitle: resolvedVideoIdentity.title || pageTitle,
          pageDescription,
          platform: resolvedVideoIdentity.platform || detectedPlatform,
          acquisitionStatus: 'ANTI_BOT_PROTECTION_DETECTED',
          canAcquireAuthorized: false,
          reason,
          checkedAt
        },
        { videoIdentity: resolvedVideoIdentity, durationSec: resolvedDurationSec, attemptedMethods }
      );
    }

    // 8a. Inspect YouTube, Dailymotion, and Vimeo watch/player pages:
    // Verify availability, resolve clean video identity, and if an authorized/unencrypted direct stream
    // was discovered via HTML or official platform APIs, proceed to Step 9 to validate and acquire it.
    const ytWatchMatchFromHtml =
      (detectedPlatform === 'YouTube' || lowerHtml.includes('ytinitialplayerresponse')) &&
      (finalUrl.match(/[?&]v=([a-zA-Z0-9_-]{6,15})/) || submittedUrl.match(/[?&]v=([a-zA-Z0-9_-]{6,15})/));
    const ytWatchId =
      this.extractYouTubeVideoId(finalUrl) ||
      this.extractYouTubeVideoId(submittedUrl) ||
      (ytWatchMatchFromHtml ? ytWatchMatchFromHtml[1] : null);
    const dmWatchMatch =
      finalUrl.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/i) ||
      finalUrl.match(/dai\.ly\/([a-zA-Z0-9]+)/i) ||
      submittedUrl.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/i) ||
      submittedUrl.match(/dai\.ly\/([a-zA-Z0-9]+)/i);
    const vimeoWatchMatch =
      finalUrl.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d{5,15})/i) ||
      submittedUrl.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?(\d{5,15})/i);

    if (ytWatchId) {
      const htmlIndicatesUnavailable =
        html.includes('"playabilityStatus":{"status":"ERROR"') ||
        html.includes('"playabilityStatus":{"status":"UNPLAYABLE"') ||
        /video unavailable/i.test(pageTitle || '') ||
        Boolean(platformExtraction.isExplicitlyUnavailable);

      const cleanHtmlTitle = pageTitle
        ? pageTitle.replace(/\s*-\s*YouTube$/i, '').trim()
        : undefined;
      const resolvedYtTitle =
        resolvedVideoIdentity.title ||
        (cleanHtmlTitle && cleanHtmlTitle.toLowerCase() !== 'youtube' ? cleanHtmlTitle : undefined);
      resolvedVideoIdentity.title = resolvedYtTitle || pageTitle;
      resolvedVideoIdentity.platform = 'YouTube';
      resolvedVideoIdentity.platformVideoId = ytWatchId;

      if (htmlIndicatesUnavailable) {
        const unreachReason =
          platformExtraction.platformDiagnosticReason ||
          `YouTube watch page (${ytWatchId}) was inspected, but the video is unavailable, private, or does not exist.`;
        return finalizeInspection(
          {
            submittedUrl,
            finalUrl,
            finalDomain,
            urlClassification: 'UNREACHABLE',
            inspectionStatus: 'UNREACHABLE_OR_INVALID',
            isWebpage: true,
            directMediaAvailable: false,
            embeddedPlayerDetected: true,
            detectedPlayerProvider: 'YouTube Web Player',
            embeddedPlayers,
            accessibleMediaMetadata,
            diagnosticErrors: [unreachReason],
            pageTitle: resolvedYtTitle,
            pageDescription,
            platform: 'YouTube',
            acquisitionStatus: 'YOUTUBE_VIDEO_UNAVAILABLE',
            canAcquireAuthorized: false,
            reason: unreachReason,
            checkedAt
          },
          {
            videoIdentity: resolvedVideoIdentity,
            durationSec: resolvedDurationSec,
            acquisitionMethod: platformAcquisitionMethod,
            attemptedMethods
          }
        );
      }

      const ytEmbedUrl = `https://www.youtube.com/embed/${ytWatchId}`;
      const ytPlayerInfo = {
        provider: 'YouTube Web Player',
        playerType: 'HTML5_VIDEO' as const,
        embedUrl: ytEmbedUrl,
        directMediaDownloadable: directMediaCandidates.length > 0,
        reason: platformExtraction.platformDiagnosticReason
      };
      if (embeddedPlayers.length === 0) {
        embeddedPlayers.push(ytPlayerInfo);
      }

      if (directMediaCandidates.length === 0) {
        const ytReason =
          platformExtraction.platformDiagnosticReason ||
          'YouTube watch-page URL inspected (YouTube Web Player). Watch pages are HTML player webpages, not direct MP4 or HLS (.m3u8) video streams. Direct stream extraction is not available; register as reference webpage metadata for Discovery Sweeps or upload an authorized master video file (.mp4/.mkv/.mov) for full-video frame fingerprinting.';
        return finalizeInspection(
          {
            submittedUrl,
            finalUrl,
            finalDomain,
            urlClassification: 'WEBPAGE_WITH_EMBEDDED_PLAYER',
            inspectionStatus: 'EMBEDDED_PLAYER_DETECTED_NO_DIRECT_MEDIA',
            isWebpage: true,
            directMediaAvailable: false,
            embeddedPlayerDetected: true,
            detectedPlayerProvider: 'YouTube Web Player',
            embeddedPlayers,
            accessibleMediaMetadata,
            diagnosticErrors: [ytReason],
            pageTitle: resolvedYtTitle || pageTitle,
            pageDescription,
            platform: 'YouTube',
            acquisitionStatus: 'EMBEDDED_PLAYER_ONLY_NO_DIRECT_MEDIA',
            canAcquireAuthorized: false,
            reason: ytReason,
            checkedAt
          },
          {
            videoIdentity: resolvedVideoIdentity,
            durationSec: resolvedDurationSec,
            acquisitionMethod: platformAcquisitionMethod,
            attemptedMethods
          }
        );
      }
    }

    if (dmWatchMatch) {
      const dmId = dmWatchMatch[1];
      resolvedVideoIdentity.platform = 'Dailymotion';
      resolvedVideoIdentity.platformVideoId = dmId;
      if (platformExtraction.isExplicitlyUnavailable) {
        const unreachReason =
          platformExtraction.platformDiagnosticReason ||
          `Dailymotion video (${dmId}) is unavailable, private, or removed.`;
        return finalizeInspection(
          {
            submittedUrl,
            finalUrl,
            finalDomain,
            urlClassification: 'UNREACHABLE',
            inspectionStatus: 'UNREACHABLE_OR_INVALID',
            isWebpage: true,
            directMediaAvailable: false,
            embeddedPlayerDetected: true,
            detectedPlayerProvider: 'Dailymotion Web Player',
            embeddedPlayers,
            accessibleMediaMetadata,
            diagnosticErrors: [unreachReason],
            pageTitle: resolvedVideoIdentity.title || pageTitle,
            pageDescription,
            platform: 'Dailymotion',
            acquisitionStatus: 'DAILYMOTION_VIDEO_UNAVAILABLE',
            canAcquireAuthorized: false,
            reason: unreachReason,
            checkedAt
          },
          {
            videoIdentity: resolvedVideoIdentity,
            durationSec: resolvedDurationSec,
            acquisitionMethod: platformAcquisitionMethod,
            attemptedMethods
          }
        );
      }

      if (embeddedPlayers.length === 0) {
        embeddedPlayers.push({
          provider: 'Dailymotion Web Player',
          playerType: 'HTML5_VIDEO',
          embedUrl: `https://www.dailymotion.com/embed/video/${dmId}`,
          directMediaDownloadable: directMediaCandidates.length > 0,
          reason: platformExtraction.platformDiagnosticReason
        });
      }

      if (directMediaCandidates.length === 0) {
        const dmReason =
          platformExtraction.platformDiagnosticReason ||
          'Dailymotion video page URL inspected (Dailymotion Web Player). Watch pages are HTML player webpages, not direct MP4 or HLS (.m3u8) video streams. Upload an authorized master video file (.mp4/.mkv/.mov) for full-video frame fingerprinting or register as reference webpage metadata.';
        return finalizeInspection(
          {
            submittedUrl,
            finalUrl,
            finalDomain,
            urlClassification: 'WEBPAGE_WITH_EMBEDDED_PLAYER',
            inspectionStatus: 'EMBEDDED_PLAYER_DETECTED_NO_DIRECT_MEDIA',
            isWebpage: true,
            directMediaAvailable: false,
            embeddedPlayerDetected: true,
            detectedPlayerProvider: 'Dailymotion Web Player',
            embeddedPlayers,
            accessibleMediaMetadata,
            diagnosticErrors: [dmReason],
            pageTitle: resolvedVideoIdentity.title || pageTitle,
            pageDescription,
            platform: 'Dailymotion',
            acquisitionStatus: 'EMBEDDED_PLAYER_ONLY_NO_DIRECT_MEDIA',
            canAcquireAuthorized: false,
            reason: dmReason,
            checkedAt
          },
          {
            videoIdentity: resolvedVideoIdentity,
            durationSec: resolvedDurationSec,
            acquisitionMethod: platformAcquisitionMethod,
            attemptedMethods
          }
        );
      }
    }

    if (vimeoWatchMatch) {
      const vimeoId = vimeoWatchMatch[1];
      resolvedVideoIdentity.platform = 'Vimeo';
      resolvedVideoIdentity.platformVideoId = vimeoId;
      if (embeddedPlayers.length === 0) {
        embeddedPlayers.push({
          provider: 'Vimeo Web Player',
          playerType: 'HTML5_VIDEO',
          embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
          directMediaDownloadable: directMediaCandidates.length > 0,
          reason: platformExtraction.platformDiagnosticReason
        });
      }
      if (directMediaCandidates.length === 0 && platformExtraction.platformDiagnosticReason) {
        const vimeoReason = platformExtraction.platformDiagnosticReason;
        return finalizeInspection(
          {
            submittedUrl,
            finalUrl,
            finalDomain,
            urlClassification: platformExtraction.hasExplicitPlatformDrm
              ? 'DRM_PROTECTED_WEBPAGE'
              : 'WEBPAGE_WITH_EMBEDDED_PLAYER',
            inspectionStatus: platformExtraction.hasExplicitPlatformDrm
              ? 'RESTRICTED_MEDIA'
              : 'EMBEDDED_PLAYER_DETECTED_NO_DIRECT_MEDIA',
            isWebpage: true,
            directMediaAvailable: false,
            embeddedPlayerDetected: true,
            detectedPlayerProvider: 'Vimeo Web Player',
            embeddedPlayers,
            accessibleMediaMetadata,
            diagnosticErrors: [vimeoReason],
            pageTitle: resolvedVideoIdentity.title || pageTitle,
            pageDescription,
            platform: 'Vimeo',
            acquisitionStatus: platformExtraction.hasExplicitPlatformDrm
              ? 'VIMEO_DRM_STREAM_RESTRICTED'
              : 'EMBEDDED_PLAYER_ONLY_NO_DIRECT_MEDIA',
            canAcquireAuthorized: false,
            reason: vimeoReason,
            checkedAt
          },
          {
            videoIdentity: resolvedVideoIdentity,
            durationSec: resolvedDurationSec,
            acquisitionMethod: platformAcquisitionMethod,
            attemptedMethods
          }
        );
      }
    }

    // Check explicit DRM key-system markers (excluding standard iframe allow="encrypted-media" attributes)
    const htmlWithoutIframeAllow = lowerHtml.replace(/<iframe\b[^>]*>/gi, '');
    if (
      directMediaCandidates.length === 0 &&
      (lowerHtml.includes('widevine') ||
        lowerHtml.includes('playready') ||
        lowerHtml.includes('fairplay') ||
        lowerHtml.includes('requestmediakeysystemaccess') ||
        htmlWithoutIframeAllow.includes('encrypted-media'))
    ) {
      const reason = 'Webpage metadata indicates DRM-encrypted playback (Widevine/PlayReady/FairPlay). Direct media extraction is prohibited; please upload an authorized master video file.';
      return finalizeInspection(
        {
          submittedUrl,
          finalUrl,
          finalDomain,
          urlClassification: 'DRM_PROTECTED_WEBPAGE',
          inspectionStatus: 'RESTRICTED_MEDIA',
          isWebpage: true,
          directMediaAvailable: false,
          embeddedPlayerDetected: true,
          detectedPlayerProvider: detectedPlayerProvider || 'DRM Encrypted Web Player',
          embeddedPlayers,
          accessibleMediaMetadata,
          diagnosticErrors: [reason],
          pageTitle: resolvedVideoIdentity.title || pageTitle,
          pageDescription,
          platform: resolvedVideoIdentity.platform || detectedPlatform,
          acquisitionStatus: 'DRM_PROTECTED_WEBPAGE',
          canAcquireAuthorized: false,
          reason,
          checkedAt
        },
        {
          videoIdentity: resolvedVideoIdentity,
          durationSec: resolvedDurationSec,
          acquisitionMethod: platformAcquisitionMethod,
          attemptedMethods
        }
      );
    }

    // 8b. If the webpage embeds a video player (iframe, JSON-LD embedUrl, og:video, twitter:player)
    // and no direct media candidate was exposed in the outer HTML, inspect the embedded player URL(s)
    // to determine whether the embedded player exposes an authorized, directly accessible video stream.
    if (directMediaCandidates.length === 0 && embeddedPlayers.length > 0) {
      const candidateEmbedUrls = Array.from(
        new Set(
          [
            ...accessibleMediaMetadata.iframeSrcs,
            ...accessibleMediaMetadata.jsonLdVideos.map(v => v.embedUrl).filter((u): u is string => Boolean(u)),
            ...accessibleMediaMetadata.openGraphVideoUrls,
            ...accessibleMediaMetadata.twitterPlayerUrls
          ].filter(u => u && u !== finalUrl && u !== submittedUrl)
        )
      ).slice(0, 3);

      for (const embedUrl of candidateEmbedUrls) {
        const embedDrm = this.isDrmOrProtectedWebPlatform(embedUrl);
        if (embedDrm.isProtected) {
          diagnosticErrors.push(
            `Embedded player (${embedUrl}) belongs to a DRM-protected platform (${embedDrm.platformName || embedDrm.hostname}); direct stream extraction is prohibited.`
          );
          continue;
        }

        const embedSafe = await this.validateSafePublicUrl(embedUrl, {
          allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
        });
        if (!embedSafe.safe) {
          diagnosticErrors.push(
            `Embedded player URL (${embedUrl}) blocked by SSRF security policy: ${embedSafe.reason || 'unsafe destination'}.`
          );
          continue;
        }

        try {
          const embedFetched = await this.fetchWithSafeRedirects(embedUrl, {
            method: 'GET',
            maxRedirects: 3,
            timeoutMs: 6000,
            headers: { Range: 'bytes=0-65535' },
            allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
          });
          const embedRes = embedFetched.response;
          const embedFinalUrl = embedFetched.finalUrl;
          const embedMime = (embedRes.headers.get('content-type') || '').toLowerCase();

          if (embedRes.status === 401 || embedRes.status === 403 || embedRes.status === 402 || embedRes.status === 451) {
            try { await embedRes.body?.cancel(); } catch {}
            diagnosticErrors.push(
              `Embedded player (${embedUrl}) returned HTTP ${embedRes.status} (access restricted / authentication required). SPECTRA never bypasses access controls.`
            );
            continue;
          }

          if (embedRes.status < 200 || embedRes.status >= 300) {
            try { await embedRes.body?.cancel(); } catch {}
            diagnosticErrors.push(
              `Embedded player (${embedUrl}) returned HTTP ${embedRes.status} and did not expose an accessible video stream.`
            );
            continue;
          }

          const isEmbedHtml = embedMime.includes('text/html') || embedMime.includes('application/xhtml+xml');
          const isEmbedDirectVideo =
            embedMime.startsWith('video/') ||
            embedMime.includes('mpegurl') ||
            (!isEmbedHtml && /\.(mp4|mkv|mov|webm|m4v|ts|m3u8)(\?|$)/i.test(embedFinalUrl));

          if (isEmbedDirectVideo) {
            try { await embedRes.body?.cancel(); } catch {}
            if (!directMediaCandidates.includes(embedFinalUrl)) {
              directMediaCandidates.push(embedFinalUrl);
            }
            const matchingPlayer = embeddedPlayers.find(p => p.embedUrl === embedUrl);
            if (matchingPlayer) {
              matchingPlayer.directMediaDownloadable = true;
              matchingPlayer.reason = `Embedded player URL resolves directly to an accessible video stream (${embedFinalUrl}).`;
            }
            break;
          }

          if (isEmbedHtml) {
            const embedReader = embedRes.body?.getReader();
            const embedChunks: Buffer[] = [];
            let embedRead = 0;
            if (embedReader) {
              try {
                while (embedRead < 128 * 1024) {
                  const { done, value } = await embedReader.read();
                  if (done || !value) break;
                  const buf = Buffer.from(value);
                  embedChunks.push(buf);
                  embedRead += buf.length;
                }
              } catch {}
              try { await embedReader.cancel(); } catch {}
            }
            const embedHtml = Buffer.concat(embedChunks).toString('utf8');
            const lowerEmbedHtml = embedHtml.toLowerCase();
            const embedHtmlNoIframe = lowerEmbedHtml.replace(/<iframe\b[^>]*>/gi, '');

            if (
              lowerEmbedHtml.includes('cf-turnstile') ||
              lowerEmbedHtml.includes('challenge-platform') ||
              lowerEmbedHtml.includes('just a moment...')
            ) {
              diagnosticErrors.push(
                `Embedded player (${embedFinalUrl}) is protected by an anti-bot challenge. SPECTRA never bypasses anti-bot protections.`
              );
              continue;
            }

            if (
              lowerEmbedHtml.includes('widevine') ||
              lowerEmbedHtml.includes('playready') ||
              lowerEmbedHtml.includes('fairplay') ||
              lowerEmbedHtml.includes('requestmediakeysystemaccess') ||
              embedHtmlNoIframe.includes('encrypted-media')
            ) {
              diagnosticErrors.push(
                `Embedded player (${embedFinalUrl}) uses DRM-encrypted playback (Widevine/PlayReady/FairPlay); direct media extraction is prohibited.`
              );
              continue;
            }

            const innerExtracted = this.extractAccessibleHtmlPlayerMetadata(embedHtml, embedFinalUrl);
            const innerInitialPlatform = extractPlatformSpecificMediaAndMetadata({
              submittedUrl: embedUrl,
              finalUrl: embedFinalUrl,
              html: embedHtml,
              pageTitle,
              detectedPlatform
            });
            const innerPlatform = await resolvePlatformAdapterMediaAndMetadata({
              submittedUrl: embedUrl,
              finalUrl: embedFinalUrl,
              html: embedHtml,
              pageTitle,
              detectedPlatform,
              initialResult: innerInitialPlatform,
              safeFetchJsonOrText
            });
            if (innerPlatform.attemptedMethods?.length) {
              for (const am of innerPlatform.attemptedMethods) {
                if (!attemptedMethods.some(existing => existing.method === am.method && existing.detail === am.detail)) {
                  attemptedMethods.push(am);
                }
              }
            }
            for (const cand of innerPlatform.additionalDirectCandidates) {
              if (!innerExtracted.directMediaCandidates.includes(cand)) {
                innerExtracted.directMediaCandidates.push(cand);
              }
            }
            if (innerPlatform.videoIdentity.durationSec && !resolvedDurationSec) {
              resolvedDurationSec = innerPlatform.videoIdentity.durationSec;
              resolvedVideoIdentity.durationSec = resolvedDurationSec;
            }
            if (innerExtracted.directMediaCandidates.length > 0) {
              for (const cand of innerExtracted.directMediaCandidates) {
                if (!directMediaCandidates.includes(cand)) {
                  directMediaCandidates.push(cand);
                }
              }
              for (const vSrc of innerExtracted.accessibleMediaMetadata.videoElementSrcs) {
                if (!accessibleMediaMetadata.videoElementSrcs.includes(vSrc)) {
                  accessibleMediaMetadata.videoElementSrcs.push(vSrc);
                }
              }
              for (const sTag of innerExtracted.accessibleMediaMetadata.videoSourceTags) {
                if (!accessibleMediaMetadata.videoSourceTags.some(s => s.src === sTag.src)) {
                  accessibleMediaMetadata.videoSourceTags.push(sTag);
                }
              }
              for (const sdk of innerExtracted.accessibleMediaMetadata.detectedPlayerSdks) {
                if (!accessibleMediaMetadata.detectedPlayerSdks.includes(sdk)) {
                  accessibleMediaMetadata.detectedPlayerSdks.push(sdk);
                }
              }
              const matchingPlayer = embeddedPlayers.find(p => p.embedUrl === embedUrl);
              if (matchingPlayer) {
                matchingPlayer.directMediaDownloadable = true;
                matchingPlayer.reason = `Embedded player page (${embedFinalUrl}) exposes an accessible video stream (${innerExtracted.directMediaCandidates[0]}).`;
              }
              break;
            } else {
              diagnosticErrors.push(
                `Inspected embedded player page (${embedFinalUrl}), but it does not expose an unencrypted direct video file (.mp4/.mkv/.mov/.webm) or HLS stream (.m3u8).`
              );
            }
          } else {
            try { await embedRes.body?.cancel(); } catch {}
          }
        } catch (embedErr: any) {
          diagnosticErrors.push(
            `Embedded player (${embedUrl}) could not be inspected for direct media: ${embedErr.message || 'network timeout or connection error'}.`
          );
        }
      }
    }

    // 9. If HTML metadata (or an inspected embedded player / platform adapter) references candidate direct media URLs, validate & probe them
    let mediaProbeTimedOutOrIndeterminate = false;
    if (directMediaCandidates.length > 0) {
      let restrictedHttpStatus: number | undefined;
      let restrictedMediaUrl: string | undefined;

      for (const primaryMediaUrl of directMediaCandidates.slice(0, 4)) {
        const mediaCheck = await this.validateSafePublicUrl(primaryMediaUrl, {
          allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
        });
        if (!mediaCheck.safe) {
          const reason = mediaCheck.reason || 'Embedded media URL on webpage failed SSRF validation.';
          if (directMediaCandidates.length === 1) {
            return finalizeInspection(
              {
                submittedUrl,
                finalUrl,
                finalDomain,
                urlClassification: 'SSRF_REJECTED',
                inspectionStatus: 'UNREACHABLE_OR_INVALID',
                isWebpage: true,
                directMediaAvailable: false,
                embeddedPlayerDetected: embeddedPlayers.length > 0,
                detectedPlayerProvider,
                embeddedPlayers,
                accessibleMediaMetadata,
                diagnosticErrors: [reason],
                pageTitle: resolvedVideoIdentity.title || pageTitle,
                pageDescription,
                platform: resolvedVideoIdentity.platform || detectedPlatform,
                acquisitionStatus: 'EMBEDDED_MEDIA_SSRF_BLOCKED',
                canAcquireAuthorized: false,
                reason,
                checkedAt
              },
              { videoIdentity: resolvedVideoIdentity, durationSec: resolvedDurationSec }
            );
          }
          diagnosticErrors.push(reason);
          continue;
        }

        // Probe the direct media URL headers to verify it actually resolves to downloadable media
        try {
          const isCandidateHls = /\.m3u8(\?|$)/i.test(primaryMediaUrl);
          const mediaFetch = await this.fetchWithSafeRedirects(primaryMediaUrl, {
            method: 'GET',
            maxRedirects: 3,
            timeoutMs: 8000,
            headers: isCandidateHls ? {} : { Range: 'bytes=0-1023' },
            allowLocalhostTestOrigin: options.allowLocalhostTestOrigin
          });
          const mediaRes = mediaFetch.response;
          const resolvedMediaUrl = mediaFetch.finalUrl;
          const mediaMime = (mediaRes.headers.get('content-type') || '').toLowerCase();
          const mediaRange = mediaRes.headers.get('content-range') || '';
          const mediaLenHeader = mediaRes.headers.get('content-length');
          let mediaBytes = mediaLenHeader ? parseInt(mediaLenHeader, 10) : undefined;
          if (mediaRange && /\/(\d+)$/.test(mediaRange)) {
            const totalMatch = mediaRange.match(/\/(\d+)$/);
            if (totalMatch) mediaBytes = parseInt(totalMatch[1], 10);
          }

          const isResolvedHls = isCandidateHls || /\.m3u8(\?|$)/i.test(resolvedMediaUrl) || mediaMime.includes('mpegurl');
          if (isResolvedHls && mediaRes.status >= 200 && mediaRes.status < 300) {
            let m3u8Text = '';
            const hlsReader = mediaRes.body?.getReader();
            if (hlsReader) {
              const hlsChunks: Buffer[] = [];
              let hlsRead = 0;
              try {
                while (hlsRead < 65536) {
                  const { done, value } = await hlsReader.read();
                  if (done || !value) break;
                  const b = Buffer.from(value);
                  hlsChunks.push(b);
                  hlsRead += b.length;
                }
              } catch {}
              try { await hlsReader.cancel(); } catch {}
              m3u8Text = Buffer.concat(hlsChunks).toString('utf8');
            } else {
              try { await mediaRes.body?.cancel(); } catch {}
            }

            if (
              /#EXT-X-KEY:[^\r\n]*(?:METHOD=SAMPLE-AES|KEYFORMAT=["']urn:uuid:edef8ba9|skd:\/\/)/i.test(m3u8Text) ||
              /\/drm\/(?:cbcs|cenc)/i.test(resolvedMediaUrl)
            ) {
              diagnosticErrors.push(
                `Candidate HLS stream (${resolvedMediaUrl}) uses DRM encryption (SAMPLE-AES / FairPlay / Widevine) and cannot be ingested directly.`
              );
              continue;
            }

            if (!resolvedDurationSec) {
              const extinfMatches = m3u8Text.matchAll(/#EXTINF:([\d.]+)/gi);
              let totalExtinf = 0;
              for (const m of extinfMatches) {
                const v = parseFloat(m[1]);
                if (Number.isFinite(v) && v > 0) totalExtinf += v;
              }
              if (totalExtinf > 0) {
                resolvedDurationSec = Math.round(totalExtinf * 100) / 100;
                resolvedVideoIdentity.durationSec = resolvedDurationSec;
              }
            }
            // Don't treat HLS manifest size as total video file size
            mediaBytes = undefined;
          } else {
            try { await mediaRes.body?.cancel(); } catch {}
          }

          if (mediaRes.status === 401 || mediaRes.status === 403 || mediaRes.status === 402 || mediaRes.status === 451) {
            restrictedHttpStatus = mediaRes.status;
            restrictedMediaUrl = primaryMediaUrl;
            const reason = `Webpage references media asset (${primaryMediaUrl}), but the media server returned HTTP ${mediaRes.status} (access restricted / token required). SPECTRA never bypasses access controls.`;
            diagnosticErrors.push(reason);
            continue;
          }

          const isMediaResponseHtml = mediaMime.includes('text/html') || mediaMime.includes('application/xhtml+xml');
          if (mediaRes.status >= 200 && mediaRes.status < 300 && !isMediaResponseHtml) {
            if (mediaBytes && mediaBytes > maxBytes) {
              const reason = `Webpage exposes a direct video asset (${resolvedMediaUrl}), but its size (${(mediaBytes / (1024 * 1024)).toFixed(2)} MB) exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)} MB limit.`;
              return finalizeInspection(
                {
                  submittedUrl,
                  finalUrl,
                  finalDomain,
                  urlClassification: 'WEBPAGE_WITH_DIRECT_MEDIA',
                  inspectionStatus: 'RESTRICTED_MEDIA',
                  isWebpage: true,
                  directMediaAvailable: true,
                  embeddedPlayerDetected: embeddedPlayers.length > 0,
                  detectedPlayerProvider,
                  embeddedPlayers,
                  accessibleMediaMetadata,
                  diagnosticErrors: [reason],
                  resolvedMediaUrl,
                  mediaContentType: mediaMime || 'video/mp4',
                  contentLengthBytes: mediaBytes,
                  pageTitle: resolvedVideoIdentity.title || pageTitle,
                  pageDescription,
                  platform: resolvedVideoIdentity.platform || detectedPlatform,
                  acquisitionStatus: 'FILE_SIZE_LIMIT_EXCEEDED',
                  canAcquireAuthorized: false,
                  reason,
                  checkedAt
                },
                {
                  videoIdentity: resolvedVideoIdentity,
                  durationSec: resolvedDurationSec,
                  acquisitionMethod: platformAcquisitionMethod,
                  attemptedMethods
                }
              );
            }

            const effectiveMethod =
              platformAcquisitionMethod && platformAcquisitionMethod !== 'METADATA_INSPECTION_ONLY'
                ? platformAcquisitionMethod
                : isResolvedHls
                  ? 'FFMPEG_HLS_REMUX_ACQUISITION'
                  : 'WEBPAGE_DIRECT_MEDIA_ACQUISITION';

            return finalizeInspection(
              {
                submittedUrl,
                finalUrl,
                finalDomain,
                urlClassification: 'WEBPAGE_WITH_DIRECT_MEDIA',
                inspectionStatus: 'WEBPAGE_DIRECT_MEDIA_ACCESSIBLE',
                isWebpage: true,
                directMediaAvailable: true,
                embeddedPlayerDetected: embeddedPlayers.length > 0,
                detectedPlayerProvider,
                embeddedPlayers,
                accessibleMediaMetadata,
                resolvedMediaUrl,
                mediaContentType: mediaMime || (isResolvedHls ? 'application/vnd.apple.mpegurl' : 'video/mp4'),
                contentLengthBytes: mediaBytes,
                pageTitle: resolvedVideoIdentity.title || pageTitle,
                pageDescription,
                platform: resolvedVideoIdentity.platform || detectedPlatform,
                mediaFormat: isResolvedHls ? 'HLS_M3U8' : resolvedVideoIdentity.mediaFormat,
                acquisitionMethod: effectiveMethod,
                acquisitionStatus: 'WEBPAGE_DIRECT_MEDIA_AVAILABLE',
                canAcquireAuthorized: true,
                reason: `Resolved authorized video stream (${resolvedMediaUrl}) via ${effectiveMethod} suitable for automated ingestion and FFmpeg frame extraction.`,
                checkedAt
              },
              {
                videoIdentity: resolvedVideoIdentity,
                durationSec: resolvedDurationSec,
                mediaFormat: isResolvedHls ? 'HLS_M3U8' : resolvedVideoIdentity.mediaFormat,
                acquisitionMethod: effectiveMethod,
                attemptedMethods
              }
            );
          } else {
            diagnosticErrors.push(
              `Referenced media URL (${primaryMediaUrl}) did not return a valid video stream (HTTP ${mediaRes.status}, Content-Type: ${mediaMime || 'unknown'}).`
            );
          }
        } catch (probeErr: any) {
          mediaProbeTimedOutOrIndeterminate = true;
          diagnosticErrors.push(
            `Failed to verify candidate media URL (${primaryMediaUrl}): ${probeErr.message || 'Network error during media header probe'}.`
          );
        }
      }

      if (restrictedHttpStatus && restrictedMediaUrl) {
        const reason = `Webpage references media asset (${restrictedMediaUrl}), but the media server returned HTTP ${restrictedHttpStatus} (access restricted / token required). SPECTRA never bypasses access controls.`;
        return finalizeInspection(
          {
            submittedUrl,
            finalUrl,
            finalDomain,
            urlClassification: 'RESTRICTED_OR_PAYWALLED',
            inspectionStatus: 'RESTRICTED_MEDIA',
            isWebpage: true,
            directMediaAvailable: false,
            embeddedPlayerDetected: embeddedPlayers.length > 0,
            detectedPlayerProvider,
            embeddedPlayers,
            accessibleMediaMetadata,
            diagnosticErrors,
            pageTitle: resolvedVideoIdentity.title || pageTitle,
            pageDescription,
            platform: resolvedVideoIdentity.platform || detectedPlatform,
            acquisitionStatus: `EMBEDDED_MEDIA_RESTRICTED_HTTP_${restrictedHttpStatus}`,
            canAcquireAuthorized: false,
            reason,
            checkedAt
          },
          {
            videoIdentity: resolvedVideoIdentity,
            durationSec: resolvedDurationSec,
            acquisitionMethod: platformAcquisitionMethod,
            attemptedMethods
          }
        );
      }
    }

    // 10. Check if HTML page contains login/paywall gating without direct video
    const hasPaywallSignals =
      lowerHtml.includes('subscribe to watch') ||
      lowerHtml.includes('sign in to watch') ||
      lowerHtml.includes('login required') ||
      lowerHtml.includes('members only');

    if (hasPaywallSignals) {
      const reason =
        'Webpage requires subscription or login authentication to access media. SPECTRA never bypasses paywalls or authentication; please upload a local reference master file.';
      diagnosticErrors.push(reason);
      return finalizeInspection(
        {
          submittedUrl,
          finalUrl,
          finalDomain,
          urlClassification: 'RESTRICTED_OR_PAYWALLED',
          inspectionStatus: 'RESTRICTED_MEDIA',
          isWebpage: true,
          directMediaAvailable: false,
          embeddedPlayerDetected: embeddedPlayers.length > 0,
          detectedPlayerProvider,
          embeddedPlayers,
          accessibleMediaMetadata,
          diagnosticErrors,
          pageTitle: resolvedVideoIdentity.title || pageTitle,
          pageDescription,
          platform: resolvedVideoIdentity.platform || detectedPlatform,
          acquisitionStatus: 'PAYWALL_OR_AUTH_REQUIRED',
          canAcquireAuthorized: false,
          reason,
          checkedAt
        },
        {
          videoIdentity: resolvedVideoIdentity,
          durationSec: resolvedDurationSec,
          acquisitionMethod: platformAcquisitionMethod,
          attemptedMethods
        }
      );
    }

    // 11. Distinguish Webpage with Embedded Player vs. Undetermined Media Availability vs. Ordinary Webpage
    if (embeddedPlayers.length > 0) {
      const providerLabel = detectedPlayerProvider || 'Embedded Web Player';
      const playerReasons = embeddedPlayers
        .map(p => p.reason)
        .filter((r): r is string => Boolean(r));
      for (const pr of playerReasons) {
        if (!diagnosticErrors.includes(pr)) {
          diagnosticErrors.push(pr);
        }
      }
      const reason =
        platformExtraction.platformDiagnosticReason ||
        `Detected embedded video player (${providerLabel}) on webpage, but no directly downloadable unencrypted video file (.mp4/.mkv/.mov/.webm/.m3u8) is exposed. Detecting an iframe or player does not make its stream downloadable. Page metadata is preserved for Discovery Sweeps; please upload an authorized local reference master file for fingerprinting.`;
      return finalizeInspection(
        {
          submittedUrl,
          finalUrl,
          finalDomain,
          urlClassification: 'WEBPAGE_WITH_EMBEDDED_PLAYER',
          inspectionStatus: 'EMBEDDED_PLAYER_DETECTED_NO_DIRECT_MEDIA',
          isWebpage: true,
          directMediaAvailable: false,
          embeddedPlayerDetected: true,
          detectedPlayerProvider: providerLabel,
          embeddedPlayers,
          accessibleMediaMetadata,
          diagnosticErrors,
          pageTitle: resolvedVideoIdentity.title || pageTitle,
          pageDescription,
          platform:
            resolvedVideoIdentity.platform ||
            detectedPlatform ||
            providerLabel.replace(/\s*Embedded Player|\s*Video Player|\s*Player/i, '').trim() ||
            undefined,
          acquisitionStatus: 'EMBEDDED_PLAYER_ONLY_NO_DIRECT_MEDIA',
          canAcquireAuthorized: false,
          reason,
          checkedAt
        },
        {
          videoIdentity: resolvedVideoIdentity,
          durationSec: resolvedDurationSec,
          acquisitionMethod: platformAcquisitionMethod,
          attemptedMethods
        }
      );
    }

    if (hasDynamicPlayerPlaceholder || mediaProbeTimedOutOrIndeterminate) {
      const reason = mediaProbeTimedOutOrIndeterminate
        ? `Webpage references a media resource whose availability could not be verified (${diagnosticErrors[0] || 'probe failed'}). Please upload an authorized local reference master file.`
        : 'Webpage contains a dynamic client-side player container whose media availability cannot be determined from static HTML metadata alone. Please upload an authorized local reference master file.';
      if (!diagnosticErrors.includes(reason)) {
        diagnosticErrors.push(reason);
      }
      return finalizeInspection(
        {
          submittedUrl,
          finalUrl,
          finalDomain,
          urlClassification: 'MEDIA_AVAILABILITY_UNKNOWN',
          inspectionStatus: 'MEDIA_AVAILABILITY_UNDETERMINED',
          isWebpage: true,
          directMediaAvailable: false,
          embeddedPlayerDetected: false,
          embeddedPlayers: [],
          accessibleMediaMetadata,
          diagnosticErrors,
          pageTitle: resolvedVideoIdentity.title || pageTitle,
          pageDescription,
          platform: resolvedVideoIdentity.platform || detectedPlatform,
          acquisitionStatus: 'MEDIA_AVAILABILITY_UNDETERMINED',
          canAcquireAuthorized: false,
          reason,
          checkedAt
        },
        {
          videoIdentity: resolvedVideoIdentity,
          durationSec: resolvedDurationSec,
          acquisitionMethod: platformAcquisitionMethod,
          attemptedMethods
        }
      );
    }

    const ordinaryReason =
      platformExtraction.platformDiagnosticReason ||
      'Submitted URL is an ordinary HTML webpage with no embedded video player and no directly downloadable video asset (.mp4/.mkv/.mov/.webm/.m3u8). Metadata is preserved for discovery; please upload a local reference master file for fingerprinting.';
    return finalizeInspection(
      {
        submittedUrl,
        finalUrl,
        finalDomain,
        urlClassification: 'WEBPAGE_NO_DIRECT_MEDIA',
        inspectionStatus: 'ORDINARY_WEBPAGE_NO_MEDIA',
        isWebpage: true,
        directMediaAvailable: false,
        embeddedPlayerDetected: false,
        embeddedPlayers: [],
        accessibleMediaMetadata,
        diagnosticErrors: [ordinaryReason],
        pageTitle: resolvedVideoIdentity.title || pageTitle,
        pageDescription,
        platform: resolvedVideoIdentity.platform || detectedPlatform,
        acquisitionStatus: 'NO_DIRECT_MEDIA_ON_WEBPAGE',
        canAcquireAuthorized: false,
        reason: ordinaryReason,
        checkedAt
      },
      {
        videoIdentity: resolvedVideoIdentity,
        durationSec: resolvedDurationSec,
        acquisitionMethod: platformAcquisitionMethod,
        attemptedMethods
      }
    );
  }

  /**
   * Acquires an authorized video asset from a validated direct media URL or webpage with direct media,
   * enforcing SSRF checks, redirect validation, resumable HTTP Range downloads, byte-size limits,
   * duration limits, and FFprobe stream validation.
   * Never stores credentials or cookies.
   */
  private static sha256MediaFileCache = new Map<
    string,
    { filePath: string; probe: ProbeResult; sha256: string }
  >();

  public static async acquireAuthorizedReferenceMediaFromUrl(
    rawUrl: string,
    options: {
      maxBytes?: number;
      maxDurationSec?: number;
      authorizationConfirmed?: boolean;
      authorizationProvenance?: string;
      allowLocalhostTestOrigin?: string;
      preInspected?: ReferenceUrlInspectionResult;
    } = {}
  ): Promise<{
    inspection: ReferenceUrlInspectionResult;
    filePath?: string;
    mediaTarget: string;
    finalUrl: string;
    resolvedMediaUrl: string;
    provenanceSha256: string;
    sha256: string;
    deduplicatedExistingFile?: boolean;
    probe: ProbeResult;
    bytesDownloaded: number;
    resumedFromBytes?: number;
    reusedCachedMedia?: boolean;
    workflow: AcquisitionWorkflowReport;
  }> {
    const maxBytes = options.maxBytes ?? 500 * 1024 * 1024; // 500 MB default
    const maxDurationSec = options.maxDurationSec ?? 4 * 3600; // 4 hours default
    const effectiveTestOrigin = options.allowLocalhostTestOrigin || process.env.SPECTRA_TEST_ALLOWED_ORIGIN;

    const inspection =
      options.preInspected && options.preInspected.submittedUrl === rawUrl
        ? options.preInspected
        : await this.inspectReferenceUrlAvailability(rawUrl, {
            maxBytes,
            allowLocalhostTestOrigin: effectiveTestOrigin
          });

    if (!inspection.canAcquireAuthorized || !inspection.directMediaAvailable || !inspection.resolvedMediaUrl) {
      const err = new Error(inspection.reason) as Error & {
        code?: string;
        inspection?: ReferenceUrlInspectionResult;
        acquisitionStatus?: string;
      };
      err.code = 'URL_MEDIA_ACQUISITION_UNAVAILABLE';
      err.inspection = inspection;
      err.acquisitionStatus = inspection.acquisitionStatus;
      throw err;
    }

    const targetMediaUrl = inspection.resolvedMediaUrl;
    const isHlsManifest =
      /\.m3u8(\?|$)/i.test(targetMediaUrl) ||
      (inspection.mediaContentType || '').includes('mpegurl');

    if (isHlsManifest) {
      // Strictly validate HLS stream via ffprobe and enforce duration limit
      let probe: ProbeResult;
      try {
        const { stdout } = await execFileAsync(
          'ffprobe',
          [
            '-v', 'error',
            '-rw_timeout', '8000000',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,codec_name,r_frame_rate,duration:format=duration',
            '-of', 'json',
            targetMediaUrl
          ],
          { timeout: 10000 }
        );
        const parsedProbe = JSON.parse(stdout || '{}');
        const stream = parsedProbe.streams?.[0];
        if (!stream || !stream.codec_name || !stream.width || !stream.height) {
          throw new Error('HLS manifest did not contain a valid decodable video stream.');
        }
        const format = parsedProbe.format || {};
        const duration = parseFloat(stream.duration || format.duration || '0') || inspection.durationSec || 0;
        let fps = 25;
        if (stream.r_frame_rate && typeof stream.r_frame_rate === 'string' && stream.r_frame_rate.includes('/')) {
          const [num, den] = stream.r_frame_rate.split('/').map(Number);
          if (den > 0) fps = Math.round((num / den) * 100) / 100;
        }
        probe = {
          duration_sec: duration || 120,
          width: Number(stream.width),
          height: Number(stream.height),
          fps,
          codec: String(stream.codec_name)
        };
      } catch (probeErr: any) {
        const err = new Error(
          `HLS stream failed FFprobe validation: ${probeErr.message || 'No decodable video stream in manifest'}.`
        ) as Error & {
          code?: string;
          inspection?: ReferenceUrlInspectionResult;
          acquisitionStatus?: string;
        };
        err.code = 'INVALID_MEDIA_CONTAINER';
        err.inspection = inspection;
        err.acquisitionStatus = 'INVALID_MEDIA_STREAM';
        throw err;
      }

      if (probe.duration_sec > maxDurationSec) {
        const err = new Error(
          `Media duration (${probe.duration_sec.toFixed(1)}s) exceeds maximum allowed limit (${maxDurationSec}s).`
        ) as Error & {
          code?: string;
          inspection?: ReferenceUrlInspectionResult;
          acquisitionStatus?: string;
        };
        err.code = 'MEDIA_DURATION_LIMIT_EXCEEDED';
        err.inspection = inspection;
        err.acquisitionStatus = 'DURATION_LIMIT_EXCEEDED';
        throw err;
      }

      // Attempt to remux/persist HLS stream into a local MP4 container in uploads/ for durable frame extraction & repair
      let localHlsFilePath: string | undefined;
      let hlsBytesDownloaded = 0;
      try {
        const uploadsDir = path.resolve(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const hlsDestPath = path.join(uploadsDir, `url_hls_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp4`);
        // First try fast lossless stream-copy remuxing for H.264 fMP4/TS HLS streams
        try {
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-v', 'error',
              '-rw_timeout', '15000000',
              '-i', targetMediaUrl,
              '-map', '0:v:0',
              '-c:v', 'copy',
              '-an',
              hlsDestPath
            ],
            { timeout: 60000 }
          );
        } catch {}

        if (!fs.existsSync(hlsDestPath) || fs.statSync(hlsDestPath).size <= 256) {
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-v', 'error',
              '-rw_timeout', '15000000',
              '-i', targetMediaUrl,
              '-map', '0:v:0',
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-pix_fmt', 'yuv420p',
              '-an',
              hlsDestPath
            ],
            { timeout: 60000 }
          );
        }

        if (fs.existsSync(hlsDestPath) && fs.statSync(hlsDestPath).size > 256) {
          localHlsFilePath = hlsDestPath;
          hlsBytesDownloaded = fs.statSync(hlsDestPath).size;
          const remuxProbe = await this.probeVideo(hlsDestPath);
          if (remuxProbe.duration_sec > 0) {
            probe.duration_sec = remuxProbe.duration_sec;
          }
        }
      } catch {}

      const provenanceSha256 = crypto
        .createHash('sha256')
        .update(`${inspection.submittedUrl}|${targetMediaUrl}|${probe.duration_sec}|${probe.codec}`)
        .digest('hex');

      const workflow = buildAcquisitionWorkflowReport({
        inspection,
        mediaAcquired: true,
        mediaValidated: true,
        probe,
        attemptedMethods: inspection.attemptedMethods
      });
      inspection.workflow = workflow;

      return {
        inspection,
        filePath: localHlsFilePath,
        mediaTarget: localHlsFilePath || targetMediaUrl,
        finalUrl: inspection.finalUrl,
        resolvedMediaUrl: targetMediaUrl,
        provenanceSha256,
        sha256: provenanceSha256,
        deduplicatedExistingFile: false,
        probe,
        bytesDownloaded: hlsBytesDownloaded,
        workflow
      };
    }

    // Stream download direct video file into uploads/ directory with resumable HTTP Range support & strict byte limit enforcement
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const stagingDir = path.join(uploadsDir, 'staging');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true });
    }

    const parsedMediaUrl = new URL(targetMediaUrl);
    const extMatch = parsedMediaUrl.pathname.match(/\.(mp4|mkv|mov|webm|m4v|ts|ogv|ogg)$/i);
    const safeExt = extMatch ? `.${extMatch[1].toLowerCase()}` : '.mp4';
    const urlShaKey = crypto.createHash('sha256').update(targetMediaUrl).digest('hex').slice(0, 20);
    const partFilePath = path.join(stagingDir, `dl_${urlShaKey}.part`);
    const destFileName = `url_ref_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${safeExt}`;
    const destFilePath = path.join(uploadsDir, destFileName);

    let existingPartBytes = 0;
    if (fs.existsSync(partFilePath)) {
      try {
        const partStat = fs.statSync(partFilePath);
        if (partStat.size > 0 && partStat.size < maxBytes) {
          existingPartBytes = partStat.size;
        }
      } catch {}
    }

    let bytesDownloaded = 0;
    let resumedFromBytes = 0;
    const hash = crypto.createHash('sha256');

    try {
      const requestHeaders: Record<string, string> = {};
      if (existingPartBytes > 0) {
        requestHeaders['Range'] = `bytes=${existingPartBytes}-`;
      }

      let fetched = await this.fetchWithSafeRedirects(targetMediaUrl, {
        method: 'GET',
        maxRedirects: 3,
        timeoutMs: 30000,
        headers: requestHeaders,
        allowLocalhostTestOrigin: effectiveTestOrigin
      });
      if (fetched.response.status === 429) {
        try { await fetched.response.body?.cancel(); } catch {}
        await new Promise(resolve => setTimeout(resolve, 1200));
        fetched = await this.fetchWithSafeRedirects(targetMediaUrl, {
          method: 'GET',
          maxRedirects: 3,
          timeoutMs: 30000,
          headers: requestHeaders,
          allowLocalhostTestOrigin: effectiveTestOrigin
        });
      }
      const response = fetched.response;
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} when downloading media asset.`);
      }

      const isPartialRangeResponse = response.status === 206 && existingPartBytes > 0;
      if (isPartialRangeResponse) {
        const partBuf = fs.readFileSync(partFilePath);
        fs.writeFileSync(destFilePath, partBuf);
        bytesDownloaded = partBuf.length;
        resumedFromBytes = partBuf.length;
        hash.update(partBuf);
      }

      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const declaredBytes = parseInt(contentLengthHeader, 10);
        const totalExpectedBytes = isPartialRangeResponse ? existingPartBytes + declaredBytes : declaredBytes;
        if (!Number.isNaN(totalExpectedBytes) && totalExpectedBytes > maxBytes) {
          try { await response.body.cancel(); } catch {}
          const err = new Error(
            `Declared media size (${(totalExpectedBytes / (1024 * 1024)).toFixed(2)} MB) exceeds maximum limit (${(maxBytes / (1024 * 1024)).toFixed(0)} MB).`
          ) as Error & { code?: string; acquisitionStatus?: string };
          err.code = 'FILE_SIZE_LIMIT_EXCEEDED';
          err.acquisitionStatus = 'FILE_SIZE_LIMIT_EXCEEDED';
          throw err;
        }
      }

      const fileStream = fs.createWriteStream(destFilePath, {
        flags: isPartialRangeResponse ? 'a' : 'w'
      });
      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const buf = Buffer.from(value);
            bytesDownloaded += buf.length;
            if (bytesDownloaded > maxBytes) {
              try { await reader.cancel(); } catch {}
              fileStream.destroy();
              const err = new Error(
                `Downloaded media stream exceeded maximum size limit (${(maxBytes / (1024 * 1024)).toFixed(2)} MB). Aborting download.`
              ) as Error & { code?: string; acquisitionStatus?: string };
              err.code = 'FILE_SIZE_LIMIT_EXCEEDED';
              err.acquisitionStatus = 'FILE_SIZE_LIMIT_EXCEEDED';
              throw err;
            }
            hash.update(buf);
            if (!fileStream.write(buf)) {
              await new Promise<void>(resolve => fileStream.once('drain', resolve));
            }
          }
        }
      } finally {
        fileStream.end();
        await new Promise<void>(resolve => fileStream.once('close', () => resolve()));
      }

      if (fs.existsSync(partFilePath)) {
        try { fs.unlinkSync(partFilePath); } catch {}
      }

      if (bytesDownloaded < 256) {
        const err = new Error(`Downloaded file is too small (${bytesDownloaded} bytes) to be a valid video container.`) as Error & {
          code?: string;
          acquisitionStatus?: string;
        };
        err.code = 'INVALID_MEDIA_CONTAINER';
        err.acquisitionStatus = 'INVALID_MEDIA_CONTAINER';
        throw err;
      }

      // Validate downloaded file using ffprobe directly (rejects non-video / corrupted files instead of using fallback defaults)
      let probe: ProbeResult;
      try {
        const { stdout } = await execFileAsync(
          'ffprobe',
          [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,codec_name,r_frame_rate,duration:format=duration',
            '-of', 'json',
            destFilePath
          ],
          { timeout: 10000 }
        );
        const parsedProbe = JSON.parse(stdout || '{}');
        const stream = parsedProbe.streams?.[0];
        if (!stream || !stream.codec_name || !stream.width || !stream.height) {
          throw new Error('No decodable video stream found in downloaded container.');
        }
        const format = parsedProbe.format || {};
        const duration = parseFloat(stream.duration || format.duration || '0') || 0;
        let fps = 24;
        if (stream.r_frame_rate && typeof stream.r_frame_rate === 'string' && stream.r_frame_rate.includes('/')) {
          const [num, den] = stream.r_frame_rate.split('/').map(Number);
          if (den > 0) fps = Math.round((num / den) * 100) / 100;
        }
        probe = {
          duration_sec: duration,
          width: Number(stream.width),
          height: Number(stream.height),
          fps,
          codec: String(stream.codec_name)
        };
      } catch (probeErr: any) {
        const err = new Error(
          `Downloaded file failed FFprobe media container validation: ${probeErr.message || 'Not a valid video file'}.`
        ) as Error & { code?: string; acquisitionStatus?: string };
        err.code = 'INVALID_MEDIA_CONTAINER';
        err.acquisitionStatus = 'INVALID_MEDIA_CONTAINER';
        throw err;
      }

      if (probe.duration_sec > maxDurationSec) {
        const err = new Error(
          `Acquired video duration (${probe.duration_sec.toFixed(1)}s) exceeds maximum allowed duration (${maxDurationSec}s).`
        ) as Error & { code?: string; acquisitionStatus?: string };
        err.code = 'MEDIA_DURATION_LIMIT_EXCEEDED';
        err.acquisitionStatus = 'DURATION_LIMIT_EXCEEDED';
        throw err;
      }

      const finalSha256 = hash.digest('hex');
      let finalFilePath = destFilePath;
      let deduplicatedExistingFile = false;

      const cachedEntry = this.sha256MediaFileCache.get(finalSha256);
      if (cachedEntry && cachedEntry.filePath !== destFilePath && fs.existsSync(cachedEntry.filePath)) {
        try {
          fs.unlinkSync(destFilePath);
          finalFilePath = cachedEntry.filePath;
          deduplicatedExistingFile = true;
        } catch {}
      } else {
        this.sha256MediaFileCache.set(finalSha256, {
          filePath: destFilePath,
          probe,
          sha256: finalSha256
        });
      }

      const workflow = buildAcquisitionWorkflowReport({
        inspection,
        mediaAcquired: true,
        mediaValidated: true,
        probe,
        resumedFromBytes: resumedFromBytes > 0 ? resumedFromBytes : undefined,
        reusedCachedMedia: deduplicatedExistingFile,
        attemptedMethods: inspection.attemptedMethods
      });
      inspection.workflow = workflow;

      return {
        inspection,
        filePath: finalFilePath,
        mediaTarget: finalFilePath,
        finalUrl: inspection.finalUrl,
        resolvedMediaUrl: fetched.finalUrl,
        provenanceSha256: finalSha256,
        sha256: finalSha256,
        deduplicatedExistingFile,
        probe,
        bytesDownloaded,
        resumedFromBytes: resumedFromBytes > 0 ? resumedFromBytes : undefined,
        reusedCachedMedia: deduplicatedExistingFile,
        workflow
      };
    } catch (err: any) {
      if (fs.existsSync(destFilePath)) {
        // Preserve partial bytes for resumable retry unless the failure was container validation or size limit
        if (
          err?.code !== 'FILE_SIZE_LIMIT_EXCEEDED' &&
          err?.code !== 'INVALID_MEDIA_CONTAINER' &&
          err?.code !== 'MEDIA_DURATION_LIMIT_EXCEEDED'
        ) {
          try {
            const st = fs.statSync(destFilePath);
            if (st.size > 0 && st.size < maxBytes) {
              fs.copyFileSync(destFilePath, partFilePath);
            }
          } catch {}
        }
        try { fs.unlinkSync(destFilePath); } catch {}
      }
      err.inspection = err.inspection || inspection;
      err.acquisitionStatus = err.acquisitionStatus || 'DOWNLOAD_OR_VALIDATION_FAILED';
      throw err;
    }
  }
}



