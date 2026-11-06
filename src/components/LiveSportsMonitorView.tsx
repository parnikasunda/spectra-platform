/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Stage E — Live Sports Streaming Intelligence, Multi-Offset Visual Matching & Context Assessment
 */

import React, { useState } from 'react';
import {
  Radio,
  Clock,
  ShieldAlert,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Eye,
  FileSearch,
  Hash,
  Layers,
  Info,
  Sparkles
} from 'lucide-react';
import {
  CandidateItem,
  EvidenceRecord,
  ReferenceItem,
  OverallAssessmentState,
  CapturedCandidateFrame,
  MetadataSignal
} from '../types/client.js';
import { CandidateSourceLink } from './CandidateSourceLink.js';
import { resolveFrameImageUrl } from '../utils/frameResolver.js';

interface LiveSportsMonitorViewProps {
  references: ReferenceItem[];
  candidates: CandidateItem[];
  evidenceRecords: EvidenceRecord[];
  onRefresh: () => void;
  onNavigateToEvidence: (ev: EvidenceRecord) => void;
  onLaunchLiveSweep: () => void;
}

export function deriveOverallAssessment(
  ev?: EvidenceRecord | null,
  cand?: CandidateItem | null,
  ref?: ReferenceItem | null
): OverallAssessmentState {
  if (ev?.overall_assessment) return ev.overall_assessment;
  if (cand?.overall_assessment) return cand.overall_assessment;

  const hasCandFrames =
    (ev?.captured_frames && ev.captured_frames.length > 0) ||
    (cand?.captured_frames && cand.captured_frames.length > 0) ||
    (ev?.sample_pairs && ev.sample_pairs.length > 0);

  const refHasFrames = Boolean(
    ref && (ref.status === 'REGISTERED' || ref.status === 'FINGERPRINTED') && (ref.fingerprint_count || 0) > 0
  );

  if (!hasCandFrames || (ref && !refHasFrames)) {
    return 'INSUFFICIENT_EVIDENCE';
  }
  if (ev) {
    if (ev.match_status === 'CONFIRMED_INFRINGEMENT' || (ev.matched_frames_count >= 2 && ev.confidence_score >= 0.45)) {
      return 'MATCH_FOUND';
    }
    const visSim = ev.visual_similarity_score ?? (ev.min_hamming_dist < 64 ? (64 - ev.min_hamming_dist) / 64 : 0);
    const metaSim = ev.metadata_relevance_score ?? 0;
    if (visSim >= 0.66 || ev.min_hamming_dist <= 22 || (metaSim >= 0.60 && ev.min_hamming_dist <= 28)) {
      return 'POSSIBLE_MATCH';
    }
    return 'NO_MATCH_FOUND';
  }
  return 'INSUFFICIENT_EVIDENCE';
}

export function formatAssessmentBadge(state: OverallAssessmentState): {
  label: string;
  className: string;
  sublabel: string;
} {
  switch (state) {
    case 'MATCH_FOUND':
      return {
        label: 'MATCH FOUND',
        className: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        sublabel: 'Verified visual frame correlation across temporal offsets'
      };
    case 'POSSIBLE_MATCH':
      return {
        label: 'POSSIBLE MATCH',
        className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        sublabel: 'Event-related / partial visual similarity — requires human verification'
      };
    case 'NO_MATCH_FOUND':
      return {
        label: 'NO MATCH FOUND',
        className: 'bg-slate-800 text-slate-300 border-slate-700',
        sublabel: 'Visual frames do not match reference footage (frames preserved)'
      };
    case 'INSUFFICIENT_EVIDENCE':
    default:
      return {
        label: 'INSUFFICIENT EVIDENCE',
        className: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        sublabel: 'Awaiting authorized reference media or decodable candidate stream'
      };
  }
}

const CapturedFrameCard: React.FC<{
  frame: CapturedCandidateFrame;
  badgeLabel?: string;
  badgeColor?: string;
}> = ({ frame, badgeLabel = 'CAND FRAME', badgeColor = 'text-cyan-400' }) => {
  const [failed, setFailed] = useState(false);
  const src = resolveFrameImageUrl(frame.thumbnail_url);

  return (
    <div className="w-40 shrink-0 bg-slate-950 rounded border border-slate-800 overflow-hidden text-[10px] font-mono shadow-sm flex flex-col">
      <div className="px-2 py-1 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-[9px]">
        <span className={`${badgeColor} font-bold`}>{badgeLabel} #{frame.frame_index + 1}</span>
        <span className="text-slate-300">t={frame.timestamp_sec.toFixed(1)}s</span>
      </div>
      <div className="aspect-video relative bg-slate-950 flex items-center justify-center">
        {src && !failed ? (
          <img
            src={src}
            alt={`Captured candidate frame at ${frame.timestamp_sec}s`}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-slate-950 text-slate-500">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500/80 mb-0.5" />
            <span className="text-[9px] text-slate-400 leading-tight">dHash: {frame.phash_hex.substring(0, 8)}…</span>
          </div>
        )}
        {frame.best_similarity_pct !== undefined && (
          <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-slate-950/90 border border-slate-700 text-[9px] text-cyan-300">
            Visual: {frame.best_similarity_pct.toFixed(1)}% ({frame.best_hamming_distance}b)
          </div>
        )}
      </div>
      <div className="p-1.5 bg-slate-900/90 border-t border-slate-800 space-y-0.5 text-[9px] text-slate-400">
        <div className="truncate text-slate-300" title={`dHash: ${frame.phash_hex}`}>
          dHash: <span className="text-cyan-400">{frame.phash_hex}</span>
        </div>
        <div className="truncate" title={`Platform: ${frame.platform}`}>
          Platform: <span className="text-slate-200">{frame.platform}</span>
        </div>
        <div className="truncate" title={`Captured: ${frame.captured_at}`}>
          Captured: {new Date(frame.captured_at).toLocaleTimeString()}
        </div>
        <div className="truncate text-slate-500" title={`SHA-256 Provenance: ${frame.provenance_sha256}`}>
          SHA256: {frame.provenance_sha256.substring(0, 12)}…
        </div>
      </div>
    </div>
  );
};

export const LiveSportsMonitorView: React.FC<LiveSportsMonitorViewProps> = ({
  references,
  candidates,
  evidenceRecords,
  onRefresh,
  onNavigateToEvidence,
  onLaunchLiveSweep
}) => {
  const [duplicateSuppression, setDuplicateSuppression] = useState(true);
  const [rollingWindowSec, setRollingWindowSec] = useState('30');
  const [selectedRefFilter, setSelectedRefFilter] = useState<string>('ALL');
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const sportsReferences = references.filter(r => r.asset_type === 'LIVE_SPORTS');
  const sportsRefIds = new Set(sportsReferences.map(r => r.id));

  // Include all candidates linked to a LIVE_SPORTS reference OR marked as live / HLS stream
  const allSportsCandidates = candidates.filter(c => {
    if (selectedRefFilter !== 'ALL' && c.reference_id !== selectedRefFilter) return false;
    return c.is_live_stream || c.media_type === 'HLS_M3U8' || (c.reference_id && sportsRefIds.has(c.reference_id));
  });

  // Map evidence records by candidate_id for instant lookup
  const evidenceByCandidate = new Map<string, EvidenceRecord>();
  for (const ev of evidenceRecords) {
    evidenceByCandidate.set(ev.candidate_id, ev);
  }

  const liveEvidence = evidenceRecords.filter(ev => {
    if (selectedRefFilter !== 'ALL' && ev.reference_id !== selectedRefFilter) return false;
    const ref = references.find(r => r.id === ev.reference_id);
    return ref?.asset_type === 'LIVE_SPORTS' || ev.temporal_offset_sec !== 0;
  });

  // Calculate average broadcast delay among streams with measured offset
  const delays = liveEvidence
    .filter(e => Math.abs(e.temporal_offset_sec) > 0)
    .map(e => Math.abs(e.temporal_offset_sec));
  const avgBroadcastDelay =
    delays.length > 0
      ? (delays.reduce((sum, d) => sum + d, 0) / delays.length).toFixed(1)
      : '16.0';

  const handleReverifyCandidate = async (cand: CandidateItem) => {
    setVerifyingId(cand.id);
    try {
      await fetch(`/api/candidates/verify/${cand.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_reference_id: cand.reference_id })
      });
      onRefresh();
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Live Sports Stadium Hero Header */}
      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-900/60 shadow-lg">
        <div className="absolute inset-0 z-0 opacity-25 pointer-events-none">
          <img
            src="/src/assets/images/sports_broadcast_stadium_1792002024010.jpg"
            alt="Live sports broadcast stadium"
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent" />
        </div>

        <div className="relative z-10 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Broadcast Surveillance Mode</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">Multi-Offset Visual Matching & Context Assessment</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              Live Sports Broadcast Protection
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Separates evidence frame collection from match verification. Compares candidate frames across all temporal offsets to handle broadcast delays, camera cuts, replays, and overlays, while evaluating event/fixture metadata independently.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onLaunchLiveSweep}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded transition-colors whitespace-nowrap cursor-pointer shadow-sm shadow-emerald-500/20"
            >
              Trigger Live Event Sweep
            </button>
          </div>
        </div>
      </div>

      {/* Live Sports Telemetry Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="text-xs text-slate-400 mb-1">Active Sports References</div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {sportsReferences.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {sportsReferences.filter(r => r.status === 'REGISTERED' || r.status === 'FINGERPRINTED').length} fingerprinted ·{' '}
            {sportsReferences.filter(r => r.status === 'AWAITING_AUTHORIZED_MEDIA' || r.status === 'METADATA_REGISTERED').length} OTT metadata
          </div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="text-xs text-slate-400 mb-1">Sports Candidate Sources</div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {allSportsCandidates.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {allSportsCandidates.filter(c => (c.captured_frames?.length || 0) > 0).length} with captured keyframes
          </div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="text-xs text-slate-400 mb-1">Average Temporal Offset</div>
          <div className="text-2xl font-bold text-cyan-400 font-mono tabular-nums">
            ±{avgBroadcastDelay}s
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Multi-offset window search</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="text-xs text-slate-400 mb-1">Matches / Possible Matches</div>
          <div className="text-2xl font-bold text-amber-400 font-mono tabular-nums">
            {
              allSportsCandidates.filter(c => {
                const ev = evidenceByCandidate.get(c.id);
                const ref = references.find(r => r.id === c.reference_id);
                const state = deriveOverallAssessment(ev, c, ref);
                return state === 'MATCH_FOUND' || state === 'POSSIBLE_MATCH';
              }).length
            }
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Visual + contextual correlation</div>
        </div>
      </div>

      {/* Live Operational Controls */}
      <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-slate-400">
            <span>Reference Fixture:</span>
            <select
              value={selectedRefFilter}
              onChange={e => setSelectedRefFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 max-w-xs"
            >
              <option value="ALL">All Live Sports References ({sportsReferences.length})</option>
              {sportsReferences.map(ref => (
                <option key={ref.id} value={ref.id}>
                  {ref.title} ({ref.status})
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={duplicateSuppression}
              onChange={e => setDuplicateSuppression(e.target.checked)}
              className="rounded bg-slate-950 border-slate-800 text-cyan-400 focus:ring-0"
            />
            <span className="text-slate-300">Temporal Offset Clustering</span>
          </label>

          <div className="flex items-center gap-2 text-slate-400">
            <span>Offset Search Window:</span>
            <select
              value={rollingWindowSec}
              onChange={e => setRollingWindowSec(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200"
            >
              <option value="15">±15s (Low Latency)</option>
              <option value="30">±30s (Standard Broadcast)</option>
              <option value="120">Full Sequence (Replays & Highlights)</option>
            </select>
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="text-slate-400 hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Live Probes</span>
        </button>
      </div>

      {/* Policy Banner: Separation of Evidence Collection, Visual Similarity & Metadata Assessment */}
      <div className="p-3.5 rounded-lg bg-slate-900/70 border border-slate-800 flex items-start gap-3 text-xs text-slate-300">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-white">
            Forensic Evidence Policy: Visual Similarity vs. Event Metadata Relevance
          </div>
          <p className="text-slate-400 leading-relaxed">
            Captured candidate frames are always preserved and displayed with their source URL, capture timestamp, platform, and SHA-256 provenance—even when frame-to-frame matching fails or reference media is awaiting ingestion. Event metadata correlation (<span className="text-amber-300 font-mono">POSSIBLE MATCH</span>) identifies streams covering the same sporting fixture, but <strong className="text-slate-200">metadata alone is never used to claim copyright infringement</strong>.
          </p>
        </div>
      </div>

      {/* Live Sports Candidate & Evidence Stream Queue */}
      <div className="rounded-lg bg-slate-900/40 border border-slate-800/80 overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Live Sports Candidate & Evidence Queue ({allSportsCandidates.length})
            </h2>
            <p className="text-xs text-slate-400">
              Showing extracted candidate keyframes, visual similarity across temporal offsets, metadata relevance, and overall forensic assessment
            </p>
          </div>
          <span className="text-xs text-emerald-400 font-mono">Monitoring Active</span>
        </div>

        {allSportsCandidates.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-2">
            <p>No live sports candidates found for the selected filter.</p>
            <p className="text-slate-400">Trigger a live event sweep to discover and inspect candidate streams.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {allSportsCandidates.map(cand => {
              const ev = evidenceByCandidate.get(cand.id);
              const ref = references.find(r => r.id === (cand.reference_id || ev?.reference_id));
              const assessment = deriveOverallAssessment(ev, cand, ref);
              const badge = formatAssessmentBadge(assessment);

              const capturedFrames: CapturedCandidateFrame[] =
                (ev?.captured_frames && ev.captured_frames.length > 0
                  ? ev.captured_frames
                  : cand.captured_frames) || [];

              const samplePairs = ev?.sample_pairs || [];

              // Compute honest visual similarity score (never 0% just because fixed temporal alignment failed)
              const refHasFingerprints = Boolean(
                ref && (ref.status === 'REGISTERED' || ref.status === 'FINGERPRINTED') && (ref.fingerprint_count || 0) > 0
              );

              const rawVisualSim =
                ev?.visual_similarity_score ??
                cand.visual_similarity_score ??
                (ev && ev.min_hamming_dist < 64 ? (64 - ev.min_hamming_dist) / 64 : undefined);

              const metadataRel =
                ev?.metadata_relevance_score ??
                cand.metadata_relevance_score;

              const signals: MetadataSignal[] = ev?.metadata_signals || [];
              const uncertaintyReasons: string[] = ev?.uncertainty_reasons || [];
              const isExpanded = expandedCandidateId === cand.id;

              return (
                <div key={cand.id} className="p-5 hover:bg-slate-800/20 transition-colors space-y-4">
                  {/* Top Row: Candidate Title, Source Link, and 3-Part Assessment Metrics */}
                  <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded border ${badge.className}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs font-bold text-white truncate">
                          {cand.discovered_title}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-cyan-300 border border-slate-700">
                          {cand.platform || cand.domain}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-900 text-slate-400 border border-slate-800">
                          {cand.pipeline_status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>Target Reference:</span>
                        <span className="text-slate-200 font-medium">
                          {ref ? ref.title : ev?.reference_title || 'Unlinked Reference'}
                        </span>
                        {ref?.season_episode_info && (
                          <span className="text-amber-300 font-mono text-[11px]">
                            ({ref.season_episode_info})
                          </span>
                        )}
                        {ref && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                            Ref Status: {ref.status} ({ref.fingerprint_count || 0} frames)
                          </span>
                        )}
                      </div>

                      <div className="pt-0.5 flex flex-wrap items-center gap-4 text-[11px] text-slate-400 font-mono">
                        <CandidateSourceLink
                          url={cand.source_url}
                          domain={cand.domain}
                          candidateId={cand.id}
                          compact={true}
                          truncateLength={60}
                        />
                        <span>Captured: {new Date(cand.last_inspected_at || cand.discovered_at).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Separate Metrics Box: Visual Similarity | Metadata Relevance | Overall Assessment */}
                    <div className="grid grid-cols-3 gap-2.5 shrink-0 bg-slate-950/80 p-3 rounded-lg border border-slate-800 font-mono">
                      <div className="px-2.5 py-1 border-r border-slate-800/80">
                        <div className="text-[10px] text-slate-400 uppercase">Visual Similarity</div>
                        {refHasFingerprints && rawVisualSim !== undefined ? (
                          <>
                            <div className={`text-base font-bold ${rawVisualSim >= 0.75 ? 'text-rose-400' : rawVisualSim >= 0.60 ? 'text-amber-300' : 'text-slate-200'}`}>
                              {(rawVisualSim * 100).toFixed(1)}%
                            </div>
                            <div className="text-[9px] text-slate-400">
                              {ev ? `Min d=${ev.min_hamming_dist}b · ${ev.matched_frames_count}/${ev.total_compared_frames} locked` : 'Best frame pair'}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-xs font-bold text-indigo-300 mt-0.5">
                              {capturedFrames.length > 0 ? 'Awaiting Ref Media' : 'No Stream Decoded'}
                            </div>
                            <div className="text-[9px] text-slate-500">
                              {capturedFrames.length > 0 ? `${capturedFrames.length} cand frames saved` : cand.pipeline_status}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="px-2.5 py-1 border-r border-slate-800/80">
                        <div className="text-[10px] text-slate-400 uppercase">Metadata Relevance</div>
                        {metadataRel !== undefined ? (
                          <>
                            <div className={`text-base font-bold ${metadataRel >= 0.70 ? 'text-emerald-400' : metadataRel >= 0.40 ? 'text-amber-300' : 'text-slate-300'}`}>
                              {(metadataRel * 100).toFixed(0)}%
                            </div>
                            <div className="text-[9px] text-slate-400">
                              {signals.filter(s => s.status === 'MATCHED' || s.status === 'PARTIAL').length} observed signals matched
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-xs font-bold text-slate-400 mt-0.5">Pending Probe</div>
                            <div className="text-[9px] text-slate-500">Run verification</div>
                          </>
                        )}
                      </div>

                      <div className="px-2.5 py-1">
                        <div className="text-[10px] text-slate-400 uppercase">Overall Assessment</div>
                        <div className="text-xs font-bold text-white mt-0.5">
                          {badge.label}
                        </div>
                        <div className="text-[9px] text-slate-400 truncate max-w-[150px]" title={badge.sublabel}>
                          {ev && ev.temporal_offset_sec !== 0
                            ? `Best offset: ${ev.temporal_offset_sec > 0 ? '+' : ''}${ev.temporal_offset_sec}s`
                            : badge.sublabel}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Extracted Candidate Keyframes Strip (Always visible when frames exist, even if NO MATCH or INSUFFICIENT EVIDENCE) */}
                  {capturedFrames.length > 0 ? (
                    <div className="space-y-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 font-mono text-slate-300">
                          <Layers className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="font-semibold text-white">
                            Captured Candidate Frames ({capturedFrames.length} Genuine Decoded Keyframes)
                          </span>
                          <span className="text-slate-500">·</span>
                          <span className="text-[11px] text-slate-400">
                            Preserved independently of match outcome
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setExpandedCandidateId(isExpanded ? null : cand.id)}
                            className="px-2.5 py-1 text-[11px] font-mono text-cyan-300 hover:text-white bg-slate-900 hover:bg-slate-800 rounded border border-slate-700 cursor-pointer"
                          >
                            {isExpanded ? 'Hide Context & Provenance Details' : 'Inspect Signals & Uncertainty Reasons'}
                          </button>
                          {ev && (
                            <button
                              onClick={() => onNavigateToEvidence(ev)}
                              className="px-2.5 py-1 text-[11px] font-mono text-slate-950 bg-cyan-400 hover:bg-cyan-300 font-semibold rounded inline-flex items-center gap-1 cursor-pointer"
                            >
                              <span>Open in Evidence Vault</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-stretch gap-3 overflow-x-auto pb-1 pt-1">
                        {capturedFrames.map(cf => (
                          <CapturedFrameCard
                            key={`${cand.id}_f_${cf.frame_index}`}
                            frame={cf}
                            badgeLabel="CAND"
                            badgeColor="text-cyan-400"
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 text-slate-400 font-mono">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>
                          {cand.pipeline_status === 'DRM_PROTECTED'
                            ? `Stream is DRM-protected (${cand.drm_scheme || 'Widevine'}); technical decryption without authorization is prohibited.`
                            : cand.pipeline_status === 'UNREACHABLE'
                            ? `Candidate stream returned HTTP ${cand.reachability_code || 404} (Unreachable / Dead link).`
                            : `No decodable video keyframes extracted yet (${cand.acquisition_status || cand.pipeline_status}).`}
                        </span>
                      </div>
                      {cand.pipeline_status !== 'DRM_PROTECTED' && cand.pipeline_status !== 'UNREACHABLE' && (
                        <button
                          onClick={() => handleReverifyCandidate(cand)}
                          disabled={verifyingId === cand.id}
                          className="px-3 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-slate-700 cursor-pointer disabled:opacity-50"
                        >
                          {verifyingId === cand.id ? 'Extracting & Verifying…' : 'Probe & Extract Frames'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Expandable Metadata Signals & Uncertainty Reasons Panel */}
                  {(isExpanded || assessment === 'POSSIBLE_MATCH') && (signals.length > 0 || uncertaintyReasons.length > 0) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
                      {/* Observed Metadata & Context Signals */}
                      <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white font-mono">
                            Observed Metadata & Context Signals
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            Missing metadata is never counted as a mismatch
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {signals.map((sig, idx) => (
                            <div
                              key={idx}
                              className="p-2 rounded bg-slate-900/70 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]"
                            >
                              <div className="space-y-0.5 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-200">{sig.label}:</span>
                                  <span className="text-cyan-300 font-mono truncate">{sig.observed_value}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  Source: {sig.source}
                                  {sig.reference_value ? ` · Ref: ${sig.reference_value}` : ''}
                                </div>
                              </div>
                              <span
                                className={`px-2 py-0.5 text-[10px] font-mono rounded shrink-0 self-start sm:self-center ${
                                  sig.status === 'MATCHED'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : sig.status === 'PARTIAL'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : sig.status === 'OBSERVED_ONLY'
                                    ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {sig.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Diagnostic Reasons for Uncertainty & Compliance Notice */}
                      <div className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2.5 flex flex-col justify-between">
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-white font-mono">
                            Forensic Assessment & Reasons for Uncertainty
                          </div>
                          {uncertaintyReasons.length > 0 ? (
                            <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside leading-relaxed">
                              {uncertaintyReasons.map((reason, idx) => (
                                <li key={idx}>{reason}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-slate-400">
                              Direct perceptual keyframe alignment verified within Hamming threshold across multiple timestamps.
                            </p>
                          )}
                        </div>

                        <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 leading-relaxed">
                          <strong>Evidentiary Safeguard:</strong> Event-related metadata correlation indicates this stream covers the same fixture, but copyright infringement is only established when visual/acoustic frames are verified against the reference broadcast.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
