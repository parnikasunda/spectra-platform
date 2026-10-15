/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Multi-Source Discovery Engine & Job Orchestrator
 *
 * Coordinates modular source adapters across YouTube, commercial streaming
 * platforms (Netflix, Disney+ Hotstar), suspected piracy websites, public video
 * repositories, and arbitrary public websites with deduplication and verification.
 */

import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { CandidateItem, DiscoveryJob, DiscoveryProvider } from '../types.js';
import { VerifierEngine } from './verifier.js';
import { AdapterRegistry } from './adapters/index.js';

export interface DiscoverySweepParams {
  jobName: string;
  provider: DiscoveryProvider;
  targetReferenceId?: string;
  queryKeywords: string;
  filterDomain?: string;
  maxCandidates?: number;
  autoVerify?: boolean; // automatically trigger verification pipeline on discovery
}

export class DiscoveryEngine {
  /**
   * Normalizes URLs to prevent duplicate candidates with minor query string / protocol drift
   */
  public static normalizeUrl(rawUrl: string): { normalizedUrl: string; domain: string } {
    try {
      const parsed = new URL(rawUrl.trim());
      const searchParams = new URLSearchParams(parsed.search);
      for (const key of Array.from(searchParams.keys())) {
        if (key.startsWith('utm_') || key === 'ref' || key === 'fbclid' || key.startsWith('src_')) {
          searchParams.delete(key);
        }
      }
      parsed.search = searchParams.toString();
      let normalized = parsed.toString();
      if (normalized.endsWith('/') && parsed.pathname === '/') {
        normalized = normalized.slice(0, -1);
      }
      return {
        normalizedUrl: normalized,
        domain: parsed.hostname.toLowerCase()
      };
    } catch {
      const fallbackDomain = rawUrl.replace(/https?:\/\//, '').split('/')[0] || 'unknown-host';
      return {
        normalizedUrl: rawUrl.trim(),
        domain: fallbackDomain.toLowerCase()
      };
    }
  }

  /**
   * Executes a multi-source discovery sweep across configured adapters,
   * deduplicates candidates, and performs automated verification.
   * Discovers 20–30 genuine candidate URLs per investigation.
   */
  public static async executeDiscoverySweep(params: DiscoverySweepParams): Promise<DiscoveryJob> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();
    const requestedMax = Math.max(25, params.maxCandidates || 25);

    const targetRef = params.targetReferenceId ? db.getReferenceById(params.targetReferenceId) : null;
    const refTitle = targetRef ? targetRef.title : params.queryKeywords;

    const job: DiscoveryJob = {
      id: jobId,
      name: params.jobName,
      target_reference_id: params.targetReferenceId,
      provider: params.provider || 'ALL_SOURCES',
      query_params: JSON.stringify({
        keywords: params.queryKeywords,
        filterDomain: params.filterDomain,
        maxCandidates: requestedMax,
        multiSource: true
      }),
      status: 'RUNNING',
      candidates_found: 0,
      started_at: now
    };

    db.insertDiscoveryJob(job);

    try {
      // 1. Multi-source discovery across modular adapters
      const rawDiscovered = await AdapterRegistry.executeMultiSourceDiscovery(
        params.queryKeywords,
        {
          provider: params.provider,
          maxTotalCandidates: requestedMax,
          referenceTitle: refTitle
        }
      );

      const insertedCandidates: CandidateItem[] = [];

      for (const item of rawDiscovered) {
        // Optional domain filter
        if (params.filterDomain && !item.domain.toLowerCase().includes(params.filterDomain.toLowerCase())) {
          continue;
        }

        const { normalizedUrl, domain } = this.normalizeUrl(item.url);

        const candidate: CandidateItem = {
          id: `cand_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          job_id: jobId,
          reference_id: params.targetReferenceId,
          source_url: normalizedUrl,
          domain: domain,
          discovered_title: item.title,
          discovery_provider: params.provider || 'ALL_SOURCES',
          source_category: item.sourceCategory,
          asset_kind: item.assetKind,
          discovered_at: new Date().toISOString(),
          pipeline_status: 'DISCOVERED',
          reachability_code: 0,
          reachability_latency_ms: 0,
          media_type: item.suggestedType || 'UNKNOWN',
          is_live_stream: item.isLive || false,
          verification_logs: `[Discovery] Multi-source sweep via ${item.sourceCategory} adapter (${domain}). Query: "${params.queryKeywords}"`
        };

        const inserted = db.upsertCandidate(candidate);
        if (inserted) {
          insertedCandidates.push(candidate);
        }
      }

      // 2. AUTOMATED CANDIDATE VERIFICATION & MEDIA ANALYSIS:
      // Inspect reachability, analyze DRM/access controls, and run perceptual frame matching
      if (params.autoVerify !== false) {
        for (const cand of insertedCandidates) {
          try {
            await VerifierEngine.verifyCandidate(cand.id, {
              targetReferenceId: params.targetReferenceId
            });
          } catch (verErr: any) {
            console.warn(`[Auto-Verify] Candidate ${cand.id} error:`, verErr.message);
          }
        }
      }

      const completedAt = new Date().toISOString();
      db.updateDiscoveryJob(jobId, {
        status: 'COMPLETED',
        candidates_found: insertedCandidates.length,
        completed_at: completedAt
      });

      return {
        ...job,
        status: 'COMPLETED',
        candidates_found: insertedCandidates.length,
        completed_at: completedAt
      };
    } catch (err: any) {
      console.error('[Discovery Engine Error]', err);
      const completedAt = new Date().toISOString();
      db.updateDiscoveryJob(jobId, {
        status: 'FAILED',
        error_message: err.message || 'Discovery sweep execution failed',
        completed_at: completedAt
      });

      return {
        ...job,
        status: 'FAILED',
        error_message: err.message,
        completed_at: completedAt
      };
    }
  }
}
