/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Stage C — Candidate Verification Matrix & Diagnostic Inspector
 */

import React, { useState } from 'react';
import { 
  Radio, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Lock, 
  ExternalLink, 
  RefreshCw, 
  Search, 
  Eye, 
  Terminal, 
  X,
  Play,
  Globe,
  AlertCircle,
  Loader2,
  FileVideo
} from 'lucide-react';
import { CandidateItem, PipelineStatus, ReferenceItem, FrameFingerprint } from '../types/client.js';
import { fetchCandidateById } from '../api.js';
import { CandidateSourceLink } from './CandidateSourceLink.js';

import { resolveFrameImageUrl, isAuthenticDecodedFrame } from '../utils/frameResolver.js';

interface CandidateMatrixViewProps {
  candidates: CandidateItem[];
  references: ReferenceItem[];
  initialReferenceId?: string;
  onRefresh: () => void;
  onVerifyCandidate: (candidateId: string, targetReferenceId?: string) => Promise<any>;
  onQuickInspect: (payload: { url: string; title?: string; target_reference_id?: string }) => Promise<any>;
  onNavigateToEvidence: (evidenceId?: string) => void;
}

export const CandidateMatrixView: React.FC<CandidateMatrixViewProps> = ({
  candidates,
  references,
  initialReferenceId,
  onRefresh,
  onVerifyCandidate,
  onQuickInspect,
  onNavigateToEvidence
}) => {
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterReferenceId, setFilterReferenceId] = useState<string>(initialReferenceId || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [candidateDetails, setCandidateDetails] = useState<(CandidateItem & { fingerprints?: FrameFingerprint[] }) | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (initialReferenceId !== undefined) {
      setFilterReferenceId(initialReferenceId);
    }
  }, [initialReferenceId]);

  React.useEffect(() => {
    if (selectedCandidate) {
      setIsLoadingDetails(true);
      fetchCandidateById(selectedCandidate.id)
        .then(data => setCandidateDetails(data))
        .catch(() => setCandidateDetails(selectedCandidate))
        .finally(() => setIsLoadingDetails(false));
    } else {
      setCandidateDetails(null);
      setFailedThumbnails({});
    }
  }, [selectedCandidate?.id]);

  // Quick inspect state
  const [quickUrl, setQuickUrl] = useState('');
  const [quickRefId, setQuickRefId] = useState(
    references.find(r => (r.status === 'FINGERPRINTED' || r.status === 'REGISTERED') && (r.fingerprint_count || 0) > 0)?.id ||
    references[0]?.id ||
    ''
  );
  const [isQuickInspecting, setIsQuickInspecting] = useState(false);
  const [quickInspectResult, setQuickInspectResult] = useState<any | null>(null);

  const handleVerify = async (cand: CandidateItem) => {
    setVerifyingId(cand.id);
    setErrorBanner(null);
    try {
      const res = await onVerifyCandidate(cand.id, cand.reference_id || undefined);
      if (res?.candidate) {
        setSelectedCandidate(res.candidate);
      }
      onRefresh();
    } catch (err: any) {
      setErrorBanner(`Verification error: ${err.message}`);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleQuickInspectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickUrl) return;

    setIsQuickInspecting(true);
    setQuickInspectResult(null);
    setErrorBanner(null);

    try {
      const result = await onQuickInspect({
        url: quickUrl,
        target_reference_id: quickRefId || undefined
      });
      setQuickInspectResult(result);
      if (result?.candidate) {
        setSelectedCandidate(result.candidate);
      }
      onRefresh();
    } catch (err: any) {
      setErrorBanner(`Inspection failed: ${err.message}`);
    } finally {
      setIsQuickInspecting(false);
    }
  };

  const [filterIdentity, setFilterIdentity] = useState<string>('ALL');

  const getIdentityRelationship = (c: CandidateItem) =>
    c.identity_relationship || c.candidate_research?.identity_relationship || 'INSUFFICIENT_METADATA';

  const getResearchScore = (c: CandidateItem) =>
    c.research_relevance_score ?? c.candidate_research?.research_relevance_score ?? c.metadata_relevance_score ?? 0.5;

  const isConfirmedMatch = (c: CandidateItem) => {
    const acq = c.acquisition_status || '';
    const rel = getIdentityRelationship(c);
    return (
      c.pipeline_status === 'ANALYZED' &&
      (acq === 'VERIFIED_PERCEPTUAL_MATCH' || acq === 'ACQUIRED_AND_VERIFIED') &&
      c.overall_assessment === 'MATCH_FOUND' &&
      rel !== 'UNRELATED_CONTENT' &&
      rel !== 'DIFFERENT_EPISODE_OR_ITEM'
    );
  };

  const filteredCandidates = candidates.filter(c => {
    if (filterReferenceId && c.reference_id !== filterReferenceId) return false;
    if (filterStatus === 'INACCESSIBLE') {
      if (!['UNREACHABLE', 'BLOCKED', 'DRM_PROTECTED', 'REQUIRES_AUTHENTICATION'].includes(c.pipeline_status)) return false;
    } else if (filterStatus === 'DUPLICATES') {
      if ((c.duplicate_count || 1) <= 1) return false;
    } else if (filterStatus !== 'ALL' && c.pipeline_status !== filterStatus) {
      return false;
    }

    const rel = getIdentityRelationship(c);
    const research = c.candidate_research;
    if (filterIdentity === 'STRONG_IDENTITY') {
      if (rel !== 'EXACT_TARGET_MATCH') return false;
    } else if (filterIdentity === 'POSSIBLE_MATCH') {
      if (
        c.overall_assessment !== 'POSSIBLE_MATCH' &&
        rel !== 'TARGET_SERIES_OR_ARTIST_GENERIC' &&
        !isConfirmedMatch(c)
      ) {
        return false;
      }
    } else if (filterIdentity === 'INCOMPLETE_RESEARCH') {
      if (
        rel !== 'INSUFFICIENT_METADATA' &&
        (!research?.missing_metadata || research.missing_metadata.length === 0)
      ) {
        return false;
      }
    } else if (filterIdentity === 'CONFLICTING_EVIDENCE') {
      if (
        rel !== 'DIFFERENT_EPISODE_OR_ITEM' &&
        (!research?.contradictory_evidence || research.contradictory_evidence.length === 0)
      ) {
        return false;
      }
    } else if (filterIdentity === 'REJECTED_UNRELATED') {
      if (rel !== 'UNRELATED_CONTENT' && c.overall_assessment !== 'NO_MATCH_FOUND') return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        c.source_url.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q) ||
        c.discovered_title.toLowerCase().includes(q) ||
        (c.final_domain || '').toLowerCase().includes(q) ||
        (c.matched_keywords || '').toLowerCase().includes(q) ||
        (c.candidate_research?.detected_identity?.identity_summary || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getIdentityBadge = (cand: CandidateItem) => {
    const rel = getIdentityRelationship(cand);
    switch (rel) {
      case 'EXACT_TARGET_MATCH':
        return (
          <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/70 text-emerald-300 text-[10px] font-mono font-semibold">
            EXACT TARGET IDENTITY
          </span>
        );
      case 'TARGET_SERIES_OR_ARTIST_GENERIC':
        return (
          <span className="px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-700/70 text-cyan-300 text-[10px] font-mono">
            GENERIC SERIES / ARTIST
          </span>
        );
      case 'DIFFERENT_EPISODE_OR_ITEM':
        return (
          <span className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-700/70 text-amber-300 text-[10px] font-mono font-semibold">
            CONFLICTING ITEM / EPISODE
          </span>
        );
      case 'UNRELATED_CONTENT':
        return (
          <span className="px-1.5 py-0.5 rounded bg-rose-950/70 border border-rose-800/70 text-rose-300 text-[10px] font-mono">
            UNRELATED / REJECTED
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-mono">
            INCOMPLETE METADATA
          </span>
        );
    }
  };

  const getClassificationBadge = (cand: CandidateItem) => {
    const cls = cand.candidate_classification || 'GENERAL_WEBPAGE';
    switch (cls) {
      case 'VERIFIED_VIDEO_ASSET':
        return <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-[10px] font-mono">VERIFIED_VIDEO_ASSET</span>;
      case 'VIDEO_ASSET':
        return <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 text-[10px] font-mono">VIDEO_ASSET</span>;
      case 'ARTICLE':
        return <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-mono">ARTICLE (NO_VIDEO)</span>;
      case 'IMAGE':
        return <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-mono">IMAGE (NO_VIDEO)</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/80 text-slate-400 text-[10px] font-mono">GENERAL_WEBPAGE</span>;
    }
  };

  const getStatusBadge = (cand: CandidateItem) => {
    const status = cand.pipeline_status;
    const acq = cand.acquisition_status || '';
    switch (status) {
      case 'ANALYZED':
        if (isConfirmedMatch(cand)) {
          return (
            <span className="text-rose-400 font-mono text-[11px] font-semibold flex items-center gap-1 break-words">
              <AlertTriangle className="w-3 h-3 shrink-0" /> <span>CONFIRMED_MATCH</span>
            </span>
          );
        }
        if (cand.overall_assessment === 'POSSIBLE_MATCH' || acq === 'ANALYZED_POSSIBLE_MATCH_UNVERIFIED_VISUAL') {
          return (
            <span className="text-amber-300 font-mono text-[11px] font-semibold flex items-center gap-1 break-words">
              <AlertCircle className="w-3 h-3 shrink-0" /> <span>POSSIBLE_MATCH (REVIEW)</span>
            </span>
          );
        }
        return (
          <span className="text-emerald-400 font-mono text-[11px] font-semibold flex items-center gap-1 break-words">
            <CheckCircle2 className="w-3 h-3 shrink-0" /> <span>ANALYZED (NO_MATCH)</span>
          </span>
        );
      case 'ACQUIRED':
        if (acq === 'ACQUIRED_AWAITING_AUTHORIZED_REFERENCE_MEDIA') {
          return <span className="text-amber-300 font-mono text-[11px] break-words block">ACQUIRED (AWAITING_REFERENCE_MASTER)</span>;
        }
        return <span className="text-cyan-400 font-mono text-[11px] break-words block">ACQUIRED (FRAMES_EXTRACTED)</span>;
      case 'MEDIA_DETECTED':
        return <span className="text-blue-400 font-mono text-[11px] break-words block">ACCESSIBLE (UNVERIFIED_MEDIA)</span>;
      case 'REACHABLE':
        return <span className="text-slate-300 font-mono text-[11px] break-words block">ACCESSIBLE (WEB_PAGE)</span>;
      case 'DRM_PROTECTED':
        return <span className="text-amber-400 font-mono text-[11px] flex items-center gap-1 break-words"><Lock className="w-3 h-3 shrink-0" /> <span>INACCESSIBLE (DRM_PROTECTED)</span></span>;
      case 'BLOCKED':
        return <span className="text-amber-500 font-mono text-[11px] break-words block">INACCESSIBLE (BLOCKED)</span>;
      case 'REQUIRES_AUTHENTICATION':
        return <span className="text-amber-300 font-mono text-[11px] break-words block">INACCESSIBLE (AUTH_REQUIRED)</span>;
      case 'UNREACHABLE':
        return <span className="text-rose-400 font-mono text-[11px] break-words block">INACCESSIBLE (UNREACHABLE)</span>;
      default:
        return <span className="text-slate-400 font-mono text-[11px] break-words block">DISCOVERED (UNVERIFIED)</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Candidate Source Verification Matrix</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Stage C: Target identity research, relevance ranking, network reachability, and separate forensic frame verification
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="p-1.5 text-slate-400 hover:text-white rounded border border-slate-800 hover:bg-slate-900 transition-colors self-start sm:self-auto"
          title="Refresh table"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {errorBanner && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded text-rose-300 text-xs flex items-center justify-between">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="text-rose-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Ad-hoc Quick Inspect Console */}
      <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
              Ad-Hoc Source Inspector (Live Probe)
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">Probe any candidate URL on demand</span>
        </div>

        <form onSubmit={handleQuickInspectSubmit} className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            required
            value={quickUrl}
            onChange={(e) => setQuickUrl(e.target.value)}
            placeholder="Paste candidate stream or webpage URL (e.g. https://domain.tv/live/stream.m3u8)"
            className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
          />

          <select
            value={quickRefId}
            onChange={(e) => setQuickRefId(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-sans"
          >
            <option value="">Compare against (Reference)</option>
            {references.map(r => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>

          <button
            type="submit"
            disabled={isQuickInspecting}
            className="px-4 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-sans transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            {isQuickInspecting ? 'Inspecting...' : 'Quick Inspect'}
          </button>
        </form>
      </div>

      {/* Investigator Identity & Evidence Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-900/70 border border-slate-800 rounded">
        <span className="text-[10px] font-mono uppercase text-slate-400 px-2">Identity &amp; Research Filter:</span>
        {[
          { id: 'ALL', label: 'All Candidates' },
          { id: 'STRONG_IDENTITY', label: 'Strong Identity Match' },
          { id: 'POSSIBLE_MATCH', label: 'Possible / Series Match' },
          { id: 'INCOMPLETE_RESEARCH', label: 'Incomplete Metadata' },
          { id: 'CONFLICTING_EVIDENCE', label: 'Conflicting Evidence' },
          { id: 'REJECTED_UNRELATED', label: 'Rejected / Unrelated' }
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterIdentity(f.id)}
            className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors cursor-pointer ${
              filterIdentity === f.id
                ? 'bg-cyan-500/20 border border-cyan-500/60 text-cyan-300 font-semibold'
                : 'bg-slate-950/60 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Pipeline Status Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded overflow-x-auto">
          {['ALL', 'DISCOVERED', 'REACHABLE', 'MEDIA_DETECTED', 'ACQUIRED', 'ANALYZED', 'INACCESSIBLE', 'DUPLICATES', 'DRM_PROTECTED', 'BLOCKED', 'UNREACHABLE'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 text-xs font-mono transition-colors rounded whitespace-nowrap ${
                filterStatus === s ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <select
            value={filterReferenceId}
            onChange={(e) => setFilterReferenceId(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
          >
            <option value="">All Reference Items</option>
            {references.map(r => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search domain, title, identity, or URL..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
            />
          </div>
        </div>
      </div>

      {/* Candidate Matrix Table */}
      <div className="rounded-lg bg-slate-900/40 border border-slate-800/80 overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Surveillance Candidate Inventory (Ranked by Target Identity Relevance)</h2>
            <p className="text-[11px] text-slate-400">
              Research Relevance evaluates target metadata identity; Forensic Similarity measures decoded perceptual frame sequence correlation.
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">Found: {filteredCandidates.length}</span>
        </div>

        {filteredCandidates.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-2">
            <p>No candidate sources match current criteria.</p>
            <p className="text-slate-400">Launch a discovery sweep or paste a stream URL into the Quick Inspector.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full lg:table-fixed min-w-[960px] lg:min-w-0 text-left text-xs border-collapse">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono text-[11px] leading-snug">
                <tr>
                  <th className="py-2.5 px-3 font-medium lg:w-[25%] align-middle">Candidate Source &amp; Detected Identity</th>
                  <th className="py-2.5 px-3 font-medium lg:w-[25%] align-middle">Research &amp; Ranking Evidence</th>
                  <th className="py-2.5 px-2.5 font-medium lg:w-[15%] align-middle">Discovery &amp; Classification</th>
                  <th className="py-2.5 px-2.5 font-medium lg:w-[15%] align-middle">Forensic Match &amp; Status</th>
                  <th className="py-2.5 px-2.5 font-medium lg:w-[9%] align-middle">Stream / HTTP</th>
                  <th className="py-2.5 px-3 font-medium lg:w-[11%] text-right align-middle">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredCandidates.map((cand, rankIdx) => {
                  const research = cand.candidate_research;
                  const detectedIdentity = research?.detected_identity;
                  const researchScorePct = Math.round(getResearchScore(cand) * 100);
                  const visualSimPct =
                    cand.visual_similarity_score !== undefined && cand.visual_similarity_score !== null
                      ? Math.round(cand.visual_similarity_score * 100)
                      : null;

                  return (
                    <tr key={cand.id} className="hover:bg-slate-800/30 transition-colors align-top">
                      <td className="py-3 px-3 min-w-0 align-top">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] shrink-0">
                            #{rankIdx + 1}
                          </span>
                          <span className="font-semibold text-white break-words min-w-0" title={cand.discovered_title || cand.domain}>
                            {cand.discovered_title || cand.domain}
                          </span>
                          {cand.platform && (
                            <span className="px-1.5 py-0.2 bg-slate-800 text-[10px] text-cyan-300 font-mono rounded shrink-0">
                              {cand.platform}
                            </span>
                          )}
                          {(cand.duplicate_count || 0) >= 1 && (
                            <span className="px-1.5 py-0.2 bg-purple-950/60 border border-purple-800/50 text-[10px] text-purple-300 font-mono rounded shrink-0" title="Merged across multiple discovery routes">
                              Merged (+{cand.duplicate_count})
                            </span>
                          )}
                        </div>

                        {/* Detected Identity Details */}
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          {getIdentityBadge(cand)}
                          {detectedIdentity?.identity_summary && (
                            <span className="text-[11px] font-mono text-slate-200 bg-slate-900/90 border border-slate-800 px-1.5 py-0.5 rounded break-words">
                              Detected: {detectedIdentity.identity_summary}
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 min-w-0">
                          <CandidateSourceLink
                            url={cand.source_url}
                            mediaUrl={cand.media_url}
                            canonicalUrl={cand.canonical_url}
                            domain={cand.final_domain || cand.domain}
                            compact={true}
                            truncateLength={34}
                          />
                        </div>
                        {cand.media_url && cand.media_url !== cand.source_url && (
                          <div className="text-[10px] font-mono text-emerald-300/90 mt-0.5 truncate max-w-full" title={cand.media_url}>
                            Media URL: {cand.media_url}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono text-slate-500 mt-1 break-all">
                          <span>ID: {cand.id}</span>
                          {(cand.matched_content_id || cand.reference_id) && (
                            <>
                              <span>·</span>
                              <span className="text-slate-400">Target Ref: {cand.matched_content_id || cand.reference_id}</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Research Relevance & Supporting / Contradictory / Missing Evidence */}
                      <td className="py-3 px-3 min-w-0 align-top space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono text-slate-400 uppercase">Research Relevance:</span>
                          <span
                            className={`font-mono text-xs font-bold shrink-0 ${
                              researchScorePct >= 80
                                ? 'text-emerald-400'
                                : researchScorePct >= 50
                                ? 'text-cyan-300'
                                : researchScorePct >= 30
                                ? 'text-amber-300'
                                : 'text-rose-400'
                            }`}
                          >
                            {researchScorePct}%
                          </span>
                        </div>

                        {research?.ranking_explanation && (
                          <div className="text-[11px] text-slate-300 leading-snug bg-slate-950/70 border border-slate-800/80 rounded p-1.5 break-words">
                            {research.ranking_explanation}
                          </div>
                        )}

                        {research?.supporting_evidence && research.supporting_evidence.length > 0 && (
                          <div className="text-[10px] text-emerald-300/90 font-mono leading-tight break-words" title={research.supporting_evidence.join(' • ')}>
                            + Supporting: {research.supporting_evidence[0]}
                          </div>
                        )}

                        {research?.contradictory_evidence && research.contradictory_evidence.length > 0 && (
                          <div className="text-[10px] text-rose-300 font-mono leading-tight break-words" title={research.contradictory_evidence.join(' • ')}>
                            ! Conflict: {research.contradictory_evidence[0]}
                          </div>
                        )}

                        {research?.missing_metadata && research.missing_metadata.length > 0 && (
                          <div className="text-[10px] text-amber-300/80 font-mono leading-tight break-words" title={research.missing_metadata.join(' • ')}>
                            ? Unknown: {research.missing_metadata[0]}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-2.5 min-w-0 align-top font-mono text-[11px] space-y-1">
                        <div className="text-cyan-400 font-semibold break-words leading-snug">{cand.source_category || cand.discovery_provider}</div>
                        {cand.source_type && (
                          <div className="text-[10px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 px-1.5 py-0.5 rounded inline-block max-w-full break-all">
                            source_type: {cand.source_type}
                          </div>
                        )}
                        {cand.match_method && (
                          <div className="text-[10px] text-slate-300 break-words leading-tight" title={cand.match_method}>
                            method: {cand.match_method}
                          </div>
                        )}
                        <div className="max-w-full overflow-hidden">{getClassificationBadge(cand)}</div>
                        <div className="text-[10px] text-slate-500 break-words">Crawl: {cand.crawl_status || 'DISCOVERED'}</div>
                      </td>

                      {/* Separate Forensic Confidence & Verification Status */}
                      <td className="py-3 px-2.5 min-w-0 align-top space-y-1">
                        {getStatusBadge(cand)}
                        <div className="flex items-center justify-between gap-1.5 flex-wrap pt-1 border-t border-slate-800/60 font-mono text-[11px]">
                          <span className="text-slate-400 text-[10px]">Forensic Visual Sim:</span>
                          {visualSimPct !== null ? (
                            <span
                              className={`font-bold ${
                                isConfirmedMatch(cand)
                                  ? 'text-rose-400'
                                  : visualSimPct >= 70
                                  ? 'text-amber-300'
                                  : 'text-slate-300'
                              }`}
                            >
                              {visualSimPct}%
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[10px]">Unverified</span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 break-words leading-tight">
                          Acq: <span className="text-slate-300">{cand.acquisition_status || 'PENDING'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-2.5 min-w-0 align-top font-mono text-slate-300 text-[11px] space-y-0.5">
                        <div className="break-words">{cand.media_type}</div>
                        {cand.media_resolution && (
                          <div className="text-[10px] text-slate-500 break-words">{cand.media_resolution}</div>
                        )}
                        <div className="text-[10px] tabular-nums break-words">
                          HTTP:{' '}
                          {cand.reachability_code > 0 ? (
                            <span className={cand.reachability_code === 200 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                              {cand.reachability_code}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                          {cand.reachability_latency_ms > 0 ? ` (${cand.reachability_latency_ms.toFixed(0)}ms)` : ''}
                        </div>
                      </td>

                      <td className="py-3 px-3 min-w-0 align-top text-right">
                        <div className="inline-flex items-center justify-end gap-1 flex-wrap">
                          {cand.source_url && (
                            <a
                              href={cand.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/40 rounded transition-colors shrink-0"
                              title="Open discovered source webpage"
                            >
                              <span>Open</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}

                          <button
                            onClick={() => setSelectedCandidate(cand)}
                            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                            title="View inspection diagnostics & research evidence"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleVerify(cand)}
                            disabled={verifyingId === cand.id}
                            className="px-2 py-1 text-[11px] font-medium text-slate-900 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors disabled:opacity-50 cursor-pointer font-sans shrink-0"
                          >
                            {verifyingId === cand.id ? 'Verifying...' : 'Verify'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Diagnostics Drawer / Modal */}
      {selectedCandidate && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Candidate Diagnostics: {selectedCandidate.discovered_title || selectedCandidate.domain}
                </h3>
                <div className="text-xs text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                  <span>Candidate ID: {selectedCandidate.id}</span>
                  {selectedCandidate.reference_id && (
                    <>
                      <span>·</span>
                      <span className="text-cyan-400">Content Ref: {selectedCandidate.reference_id}</span>
                    </>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedCandidate(null)} className="text-slate-400 hover:text-white p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1 font-mono text-xs">
              {/* Comprehensive Clickable Source Link Section */}
              <div className="space-y-1.5">
                <div className="text-[11px] text-slate-400 font-semibold uppercase">Source Investigation Endpoints</div>
                <CandidateSourceLink
                  url={selectedCandidate.source_url}
                  mediaUrl={selectedCandidate.media_url}
                  canonicalUrl={selectedCandidate.canonical_url}
                  domain={selectedCandidate.domain}
                  title={selectedCandidate.discovered_title}
                  candidateId={selectedCandidate.id}
                  showCopy={true}
                  showOpenButton={true}
                />
              </div>

              {/* Candidate Research & Identity Verification Breakdown */}
              {selectedCandidate.candidate_research && (
                <div className="p-3.5 bg-slate-950 rounded border border-slate-800 space-y-2.5 text-[11px]">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 flex-wrap gap-2">
                    <span className="text-cyan-400 font-semibold uppercase">
                      Target Identity Research &amp; Ranking Breakdown
                    </span>
                    <div className="flex items-center gap-2">
                      {getIdentityBadge(selectedCandidate)}
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
                        Research Relevance: {Math.round(getResearchScore(selectedCandidate) * 100)}%
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
                        Forensic Visual Sim:{' '}
                        {selectedCandidate.visual_similarity_score !== undefined && selectedCandidate.visual_similarity_score !== null
                          ? `${Math.round(selectedCandidate.visual_similarity_score * 100)}%`
                          : 'Unverified'}
                      </span>
                    </div>
                  </div>

                  <div className="text-slate-200">
                    <span className="text-slate-400">Detected Identity: </span>
                    <span className="font-semibold text-white">
                      {selectedCandidate.candidate_research.detected_identity.identity_summary}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-slate-900/80 border border-slate-800 text-slate-300">
                    <span className="text-slate-400 font-semibold">Ranking Explanation: </span>
                    {selectedCandidate.candidate_research.ranking_explanation}
                  </div>

                  {selectedCandidate.candidate_research.supporting_evidence.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-emerald-400 uppercase font-semibold">Supporting Identity Evidence</div>
                      <ul className="list-disc list-inside text-emerald-300/90 space-y-0.5 text-[10px]">
                        {selectedCandidate.candidate_research.supporting_evidence.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedCandidate.candidate_research.contradictory_evidence.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-rose-400 uppercase font-semibold">Contradictory Evidence (Penalized)</div>
                      <ul className="list-disc list-inside text-rose-300 space-y-0.5 text-[10px]">
                        {selectedCandidate.candidate_research.contradictory_evidence.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedCandidate.candidate_research.missing_metadata.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-amber-400 uppercase font-semibold">Missing Metadata &amp; Uncertainty (Treated as Unknown)</div>
                      <ul className="list-disc list-inside text-amber-300/90 space-y-0.5 text-[10px]">
                        {selectedCandidate.candidate_research.missing_metadata.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-400">PIPELINE STATUS</div>
                  <div className="text-slate-200 font-bold mt-0.5">{selectedCandidate.pipeline_status}</div>
                </div>
                <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-400">HTTP CODE</div>
                  <div className="text-slate-200 font-bold mt-0.5">{selectedCandidate.reachability_code || 'None'}</div>
                </div>
                <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-400">LATENCY</div>
                  <div className="text-slate-200 font-bold mt-0.5">{selectedCandidate.reachability_latency_ms.toFixed(1)} ms</div>
                </div>
                <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-400">ACQUISITION STATUS</div>
                  <div className="text-cyan-300 font-bold mt-0.5">{selectedCandidate.acquisition_status || 'PENDING'}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-500">PLATFORM / DOMAIN</div>
                  <div className="text-slate-300 mt-0.5">{selectedCandidate.platform || selectedCandidate.domain}</div>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-500">MEDIA RESOLUTION & FPS</div>
                  <div className="text-slate-300 mt-0.5">{selectedCandidate.media_resolution || 'N/A'} {selectedCandidate.media_fps ? `@ ${selectedCandidate.media_fps}fps` : ''}</div>
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-500">DISCOVERED TIMESTAMP</div>
                  <div className="text-slate-300 mt-0.5">{new Date(selectedCandidate.discovered_at).toLocaleString()}</div>
                </div>
              </div>

              {/* Discovery Provenance & Asset Classification */}
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2 text-[11px]">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                  <span className="text-slate-400 font-semibold uppercase">Discovery Provenance &amp; Asset Classification</span>
                  <div className="flex items-center gap-2">
                    {getClassificationBadge(selectedCandidate)}
                    <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 text-[10px]">
                      Crawl: {selectedCandidate.crawl_status || 'DISCOVERED'}
                    </span>
                    {(selectedCandidate.duplicate_count || 1) > 1 && (
                      <span className="px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-800/60 text-purple-300 text-[10px]">
                        Deduplicated ({selectedCandidate.duplicate_count}x)
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-500">Original URL: </span>
                    <span className="text-slate-300 break-all">{selectedCandidate.original_url || selectedCandidate.source_url}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Final Resolved URL / Domain: </span>
                    <span className="text-slate-300 break-all">
                      {selectedCandidate.final_url || selectedCandidate.source_url} ({selectedCandidate.final_domain || selectedCandidate.domain})
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Referring Page / Seed: </span>
                    <span className="text-slate-300 break-all">{selectedCandidate.referring_page || 'Direct / Search Provider'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Matched Keywords: </span>
                    <span className="text-cyan-300 break-all">{selectedCandidate.matched_keywords || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Discovery Source Type: </span>
                    <span className="text-emerald-300 font-mono">{selectedCandidate.source_type || 'title_search'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Match Method: </span>
                    <span className="text-slate-200 font-mono">{selectedCandidate.match_method || 'title_match'}</span>
                  </div>
                  {selectedCandidate.media_url && (
                    <div>
                      <span className="text-slate-500">Direct Media URL: </span>
                      <span className="text-emerald-300 font-mono break-all">{selectedCandidate.media_url}</span>
                    </div>
                  )}
                  {(selectedCandidate.matched_content_id || selectedCandidate.reference_id) && (
                    <div>
                      <span className="text-slate-500">Matched Reference Content ID: </span>
                      <span className="text-cyan-300 font-mono">{selectedCandidate.matched_content_id || selectedCandidate.reference_id}</span>
                    </div>
                  )}
                  {selectedCandidate.discovery_provenance && selectedCandidate.discovery_provenance.source_urls.length > 1 && (
                    <div>
                      <span className="text-slate-500">Merged Source URLs: </span>
                      <span className="text-purple-300 font-mono break-all">{selectedCandidate.discovery_provenance.source_urls.join(' • ')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Candidate Keyframes Forensic Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-slate-400 font-semibold uppercase flex items-center gap-1.5">
                    <FileVideo className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Candidate Visual Keyframes &amp; Hashes</span>
                  </div>
                  {candidateDetails?.fingerprints && candidateDetails.fingerprints.length > 0 && (
                    <span className="text-[10px] text-cyan-400 font-mono">
                      {candidateDetails.fingerprints.length} keyframes extracted
                    </span>
                  )}
                </div>

                {isLoadingDetails ? (
                  <div className="p-6 bg-slate-950 rounded border border-slate-800 flex items-center justify-center gap-2 text-slate-400 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                    <span>Loading extracted video frames...</span>
                  </div>
                ) : candidateDetails?.fingerprints && candidateDetails.fingerprints.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto p-2 bg-slate-950 rounded border border-slate-800">
                    {candidateDetails.fingerprints.map((fp, idx) => {
                      const frameSrc = resolveFrameImageUrl(fp.thumbnail_data || (fp as any).thumbnail_url || (fp as any).thumbnail_path);
                      const key = fp.id || `${idx}`;
                      const isFailed = failedThumbnails[key];
                      return (
                        <div key={key} className="bg-slate-900 border border-slate-800 rounded p-1.5 space-y-1">
                          <div className="relative aspect-video bg-slate-950 rounded overflow-hidden flex items-center justify-center">
                            {frameSrc && !isFailed ? (
                              <img
                                src={frameSrc}
                                alt={`Candidate keyframe at ${fp.timestamp_sec}s`}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={() => setFailedThumbnails(prev => ({ ...prev, [key]: true }))}
                              />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-center p-1">
                                <AlertCircle className="w-4 h-4 text-amber-400 mb-0.5 shrink-0" />
                                <span className="text-[8px] font-mono text-amber-300">Frame Unavailable</span>
                              </div>
                            )}
                            <span className="absolute bottom-1 right-1 px-1 bg-black/80 font-mono text-[9px] text-slate-300 rounded">
                              t = {fp.timestamp_sec.toFixed(1)}s
                            </span>
                          </div>
                          <div className="text-[9px] font-mono text-slate-400 truncate flex items-center justify-between">
                            <span className="text-cyan-400">#{fp.frame_index ?? idx}</span>
                            <span className="truncate max-w-[90px]">{fp.phash_hex}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-950 rounded border border-slate-800 flex items-center gap-2.5 text-xs text-slate-400">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <span className="font-semibold text-slate-300">
                        {selectedCandidate.pipeline_status === 'DRM_PROTECTED'
                          ? 'DRM Protection Verified (Widevine / FairPlay)'
                          : selectedCandidate.pipeline_status === 'BLOCKED'
                          ? 'Bot Protection Enforced (Cloudflare Turnstile)'
                          : selectedCandidate.pipeline_status === 'UNREACHABLE'
                          ? 'Origin Stream Endpoint Unreachable (HTTP 404)'
                          : 'Keyframe Extraction Pending'}
                      </span>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        {selectedCandidate.pipeline_status === 'DRM_PROTECTED'
                          ? 'Encrypted video feed. Direct frame acquisition restricted without licensing keys.'
                          : selectedCandidate.pipeline_status === 'BLOCKED'
                          ? 'Access blocked by target edge security. Frames unavailable.'
                          : selectedCandidate.pipeline_status === 'UNREACHABLE'
                          ? 'Candidate media stream missing or offline.'
                          : 'Awaiting candidate stream chunk ingestion and decoder pass.'}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Logs */}
              <div className="space-y-1">
                <div className="text-[11px] text-slate-400 font-semibold uppercase">Inspection Logs</div>
                <pre className="p-3 bg-slate-950 rounded border border-slate-800 text-slate-300 whitespace-pre-wrap leading-relaxed text-[11px]">
                  {selectedCandidate.verification_logs || 'No execution logs recorded yet.'}
                </pre>
              </div>

              {/* Raw Headers */}
              {selectedCandidate.raw_headers_json && (
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-400 font-semibold uppercase">HTTP Response Headers</div>
                  <pre className="p-3 bg-slate-950 rounded border border-slate-800 text-cyan-300 whitespace-pre-wrap text-[10px]">
                    {JSON.stringify(JSON.parse(selectedCandidate.raw_headers_json), null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs text-slate-400">
              <span className="font-mono">Candidate ID: {selectedCandidate.id}</span>
              <div className="flex items-center gap-2">
                {selectedCandidate.pipeline_status === 'ANALYZED' && (
                  <button
                    onClick={() => {
                      setSelectedCandidate(null);
                      onNavigateToEvidence();
                    }}
                    className="px-3 py-1.5 text-xs text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-medium transition-colors cursor-pointer"
                  >
                    View Forensic Evidence
                  </button>
                )}
                <button
                  onClick={() => setSelectedCandidate(null)}
                  className="px-3 py-1.5 text-xs text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
                >
                  Close Diagnostics
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
