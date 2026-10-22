/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Multi-Source Discovery Engine & Job Orchestrator
 *
 * Coordinates modular source adapters across YouTube, commercial streaming
 * platforms (Netflix, Disney+ Hotstar, SonyLIV), suspected piracy websites, public video
 * repositories (Dailymotion, Internet Archive), and general web search with deduplication,
 * diagnostic reporting, and genuine verification.
 */

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
  autoVerify?: boolean;
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
        domain: parsed.hostname.replace(/^www\./, '').toLowerCase()
      };
    } catch {
      const fallbackDomain = rawUrl.replace(/https?:\/\//, '').split('/')[0] || 'unknown-host';
      return {
        normalizedUrl: rawUrl.trim(),
        domain: fallbackDomain.replace(/^www\./, '').toLowerCase()
      };
    }
  }

  /**
   * Executes a multi-source discovery sweep across configured live adapters,
   * deduplicates candidates, records diagnostic details, and performs verification.
   */
  public static async executeDiscoverySweep(params: DiscoverySweepParams): Promise<DiscoveryJob> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();
    const requestedMax = Math.max(1, Math.min(50, params.maxCandidates || 15));

    const targetRef = params.targetReferenceId ? db.getReferenceById(params.targetReferenceId) : null;
    const refTitle = targetRef ? targetRef.title : params.queryKeywords;
    const referenceSourceUrl = targetRef?.source_url
      ? this.normalizeUrl(targetRef.source_url).normalizedUrl.toLowerCase()
      : null;

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
      // 1. Live multi-source discovery across modular adapters
      const rawDiscovered = await AdapterRegistry.executeMultiSourceDiscovery(
        params.queryKeywords,
        {
          provider: params.provider,
          maxTotalCandidates: requestedMax,
          referenceTitle: refTitle
        }
      );

      const diagnostics = AdapterRegistry.getLastRunDiagnostics();
      const insertedCandidates: CandidateItem[] = [];

      for (const item of rawDiscovered) {
        if (params.filterDomain && !item.domain.toLowerCase().includes(params.filterDomain.toLowerCase())) {
          continue;
        }

        const { normalizedUrl, domain } = this.normalizeUrl(item.url);

        // Exclude the exact registered reference URL itself so a reference isn't flagged as a candidate copy of itself
        if (referenceSourceUrl && normalizedUrl.toLowerCase() === referenceSourceUrl) {
          continue;
        }

        const providerLabel: DiscoveryProvider =
          params.provider && params.provider !== 'ALL_SOURCES'
            ? params.provider
            : item.sourceCategory === 'YOUTUBE'
            ? 'YOUTUBE_PUBLIC'
            : item.sourceCategory === 'PUBLIC_PLATFORM'
            ? 'PUBLIC_PLATFORMS'
            : item.sourceCategory === 'STREAMING_SERVICE'
            ? 'STREAMING_SERVICES'
            : item.sourceCategory === 'SUSPECTED_PIRACY'
            ? 'SUSPECTED_PIRACY'
            : 'SEARCH_CRAWLER';

        const candidate: CandidateItem = {
          id: `cand_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          job_id: jobId,
          reference_id: params.targetReferenceId,
          source_url: normalizedUrl,
          canonical_url: normalizedUrl,
          platform: item.platform || domain,
          acquisition_status: 'DISCOVERED_UNVERIFIED',
          domain,
          discovered_title: item.title,
          discovery_provider: providerLabel,
          source_category: item.sourceCategory,
          asset_kind: item.assetKind,
          discovered_at: new Date().toISOString(),
          pipeline_status: 'DISCOVERED',
          reachability_code: 0,
          reachability_latency_ms: 0,
          media_type: item.suggestedType || 'UNKNOWN',
          is_live_stream: item.isLive || false,
          verification_logs: `[Discovery] Live sweep via ${item.platform || item.sourceCategory} (${domain}). Query: "${params.queryKeywords}". Relevance score: ${item.relevanceScore ?? 'N/A'}.`
        };

        const inserted = db.upsertCandidate(candidate);
        if (inserted) {
          insertedCandidates.push(candidate);
        } else {
          // If candidate URL already exists from an earlier sweep, update its reference_id/job_id if needed and include it for verification
          const existing = db.getCandidates().find(c => c.source_url.toLowerCase() === normalizedUrl.toLowerCase());
          if (existing) {
            insertedCandidates.push(existing);
          }
        }
      }

      // 2. Automated Candidate Verification & Media Analysis
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

      const diagnosticSummary = diagnostics
        .map(d => `[${d.sourceCategory}] ${d.message}`)
        .join(' • ');

      const updatedQueryParams = JSON.stringify({
        keywords: params.queryKeywords,
        filterDomain: params.filterDomain,
        maxCandidates: requestedMax,
        diagnostics
      });

      const completedAt = new Date().toISOString();
      const diagnosticMessage =
        insertedCandidates.length === 0
          ? `0 new candidates found. ${diagnosticSummary || 'No matching public results returned by live providers.'}`
          : diagnosticSummary || undefined;

      db.updateDiscoveryJob(jobId, {
        status: 'COMPLETED',
        candidates_found: insertedCandidates.length,
        completed_at: completedAt,
        error_message: diagnosticMessage
      });

      return {
        ...job,
        query_params: updatedQueryParams,
        status: 'COMPLETED',
        candidates_found: insertedCandidates.length,
        completed_at: completedAt,
        error_message: diagnosticMessage
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
