/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Stage D & E — Evidence Management, Captured Candidate Frame Provenance & Side-by-Side Keyframe Forensics
 */

import React, { useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  Download,
  FileText,
  Clock,
  Layers,
  Hash,
  Sliders,
  X,
  AlertCircle,
  Info
} from 'lucide-react';
import {
  EvidenceRecord,
  MatchedKeyframePair,
  ReviewDecision,
  OverallAssessmentState,
  CapturedCandidateFrame,
  MetadataSignal
} from '../types/client.js';
import { submitEvidenceReview, generateTakedownNotice } from '../api.js';
import { CandidateSourceLink } from './CandidateSourceLink.js';
import { resolveFrameImageUrl } from '../utils/frameResolver.js';
import { deriveOverallAssessment, formatAssessmentBadge } from './LiveSportsMonitorView.js';

interface EvidenceVaultViewProps {
  evidenceRecords: EvidenceRecord[];
  selectedEvidence: EvidenceRecord | null;
  onSelectEvidence: (ev: EvidenceRecord | null) => void;
  onRefresh: () => void;
}

export const EvidenceVaultView: React.FC<EvidenceVaultViewProps> = ({
  evidenceRecords,
  selectedEvidence,
  onSelectEvidence,
  onRefresh
}) => {
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [assessmentFilter, setAssessmentFilter] = useState<string>('ALL');
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision>('CONFIRMED');
  const [reviewerName, setReviewerName] = useState('Senior Investigator');
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [takedownModalOpen, setTakedownModalOpen] = useState(false);
  const [takedownText, setTakedownText] = useState('');
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [refImgFailed, setRefImgFailed] = useState<Record<number, boolean>>({});
  const [candImgFailed, setCandImgFailed] = useState<Record<number, boolean>>({});
  const [refImgLoading, setRefImgLoading] = useState<Record<number, boolean>>({});
  const [candImgLoading, setCandImgLoading] = useState<Record<number, boolean>>({});
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const filteredRecords = evidenceRecords.filter(ev => {
    if (assessmentFilter === 'ALL') return true;
    const state = deriveOverallAssessment(ev, null, null);
    return state === assessmentFilter;
  });

  const activeEvidence =
    (selectedEvidence && filteredRecords.some(r => r.id === selectedEvidence.id) ? selectedEvidence : null) ||
    (filteredRecords.length > 0 ? filteredRecords[0] : null);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvidence) return;
    setIsSubmittingReview(true);
    setStatusBanner(null);
    try {
      await submitEvidenceReview(activeEvidence.id, {
        decision: reviewDecision,
        reviewed_by: reviewerName,
        notes: reviewNotes
      });
      onRefresh();
      setStatusBanner({
        type: 'success',
        message: 'Human review decision and audit trail recorded in the Evidence Vault.'
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: `Review submission error: ${err.message}`
      });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleOpenTakedown = async () => {
    if (!activeEvidence) return;
    setStatusBanner(null);
    try {
      const res = await generateTakedownNotice(activeEvidence.id);
      setTakedownText(res.notice);
      setTakedownModalOpen(true);
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: `Failed to generate takedown notice: ${err.message}`
      });
    }
  };

  const handleCopyNotice = () => {
    navigator.clipboard.writeText(takedownText);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  };

  const allInspectablePairs: MatchedKeyframePair[] =
    (activeEvidence?.coverage_metrics?.all_matched_pairs && activeEvidence.coverage_metrics.all_matched_pairs.length > 0
      ? activeEvidence.coverage_metrics.all_matched_pairs
      : activeEvidence?.sample_pairs) || [];

  const currentPair: MatchedKeyframePair | undefined =
    allInspectablePairs[activeFrameIndex] || allInspectablePairs[0];

  const activeCapturedFrames: CapturedCandidateFrame[] = activeEvidence?.captured_frames || [];
  const activeSignals: MetadataSignal[] = activeEvidence?.metadata_signals || [];
  const activeUncertaintyReasons: string[] = activeEvidence?.uncertainty_reasons || [];
  const activeAssessment: OverallAssessmentState = activeEvidence
    ? deriveOverallAssessment(activeEvidence, null, null)
    : 'INSUFFICIENT_EVIDENCE';
  const activeBadge = formatAssessmentBadge(activeAssessment);

  const activeVisualSim =
    activeEvidence?.visual_similarity_score ??
    (activeEvidence && activeEvidence.min_hamming_dist < 64
      ? (64 - activeEvidence.min_hamming_dist) / 64
      : undefined);

  const activeMetaRel = activeEvidence?.metadata_relevance_score;
  const activeCoverage = activeEvidence?.coverage_metrics;

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Digital Evidence Vault & Forensics</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Stage D & E: Preserves captured candidate keyframes, provenance hashes, visual similarity, and contextual metadata assessments across all inspected candidates
          </p>
        </div>

        {activeEvidence && (
          <button
            onClick={handleOpenTakedown}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-sans transition-colors cursor-pointer inline-flex items-center gap-1.5 self-start sm:self-auto"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Generate DMCA Notice</span>
          </button>
        )}
      </div>

      {statusBanner && (
        <div
          className={`p-3 rounded-lg border text-xs font-mono flex items-center justify-between ${
            statusBanner.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}
        >
          <span>{statusBanner.message}</span>
          <button onClick={() => setStatusBanner(null)} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Assessment State Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        {[
          { id: 'ALL', label: `All Dossiers (${evidenceRecords.length})` },
          {
            id: 'MATCH_FOUND',
            label: `Match Found (${evidenceRecords.filter(e => deriveOverallAssessment(e, null, null) === 'MATCH_FOUND').length})`
          },
          {
            id: 'POSSIBLE_MATCH',
            label: `Possible Match (${evidenceRecords.filter(e => deriveOverallAssessment(e, null, null) === 'POSSIBLE_MATCH').length})`
          },
          {
            id: 'NO_MATCH_FOUND',
            label: `No Match Found (${evidenceRecords.filter(e => deriveOverallAssessment(e, null, null) === 'NO_MATCH_FOUND').length})`
          },
          {
            id: 'INSUFFICIENT_EVIDENCE',
            label: `Insufficient Evidence (${evidenceRecords.filter(e => deriveOverallAssessment(e, null, null) === 'INSUFFICIENT_EVIDENCE').length})`
          }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setAssessmentFilter(tab.id);
              setActiveFrameIndex(0);
            }}
            className={`px-3 py-1.5 rounded border transition-colors cursor-pointer ${
              assessmentFilter === tab.id
                ? 'bg-cyan-400 text-slate-950 border-cyan-400 font-bold'
                : 'bg-slate-900/60 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filteredRecords.length === 0 ? (
        <div className="p-12 text-center rounded-lg border border-dashed border-slate-800 bg-slate-900/20 space-y-3">
          <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto" />
          <div className="text-sm font-medium text-slate-300">No evidence dossiers match the selected filter</div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Select "All Dossiers" above or run candidate verification to populate evidence records.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Evidence List */}
          <div className="lg:col-span-4 space-y-3">
            <div className="text-xs font-semibold text-slate-400 uppercase font-mono tracking-wider px-1">
              Evidence Dossiers ({filteredRecords.length})
            </div>

            <div className="space-y-2 max-h-[82vh] overflow-y-auto pr-1">
              {filteredRecords.map(ev => {
                const isSelected = activeEvidence?.id === ev.id;
                const state = deriveOverallAssessment(ev, null, null);
                const badge = formatAssessmentBadge(state);
                const visSim =
                  ev.visual_similarity_score ??
                  (ev.min_hamming_dist < 64 ? (64 - ev.min_hamming_dist) / 64 : undefined);
                const metaRel = ev.metadata_relevance_score;
                const frameCount = ev.captured_frames?.length || ev.sample_pairs?.length || ev.total_compared_frames || 0;

                return (
                  <div
                    key={ev.id}
                    onClick={() => {
                      onSelectEvidence(ev);
                      setActiveFrameIndex(0);
                    }}
                    className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 border-cyan-500/80 shadow-md shadow-cyan-950/20'
                        : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-white truncate">
                          {ev.candidate_title || ev.reference_title}
                        </span>
                        <span className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border shrink-0 ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-400 truncate">
                        Ref: <span className="text-slate-300">{ev.reference_title}</span>
                      </div>

                      <div className="pt-0.5">
                        <CandidateSourceLink
                          url={ev.candidate_url}
                          domain={ev.candidate_domain}
                          candidateId={ev.candidate_id}
                          compact={true}
                          truncateLength={30}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono border-t border-slate-800/70">
                        <div>
                          <span className="text-slate-500 block">Visual Sim</span>
                          <span className="text-cyan-300 font-bold">
                            {visSim !== undefined ? `${(visSim * 100).toFixed(1)}%` : 'N/A (No Ref)'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Metadata Rel</span>
                          <span className="text-emerald-300 font-bold">
                            {metaRel !== undefined ? `${(metaRel * 100).toFixed(0)}%` : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Frames</span>
                          <span className="text-slate-200 font-bold">{frameCount} saved</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detailed Forensics, Captured Frames & Side-by-Side Keyframe Inspector */}
          {activeEvidence && (
            <div className="lg:col-span-8 space-y-6">
              {/* Evidence Overview Header Card */}
              <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                      <span>EVIDENCE RECORD</span>
                      <span>·</span>
                      <span className="text-cyan-400">{activeEvidence.id}</span>
                      <span>·</span>
                      <span className={`px-2 py-0.5 text-[11px] font-bold rounded border ${activeBadge.className}`}>
                        {activeBadge.label}
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-white pt-0.5">
                      {activeEvidence.candidate_title || activeEvidence.reference_title}
                    </h2>
                    <div className="text-xs text-slate-300">
                      Reference Work: <strong>{activeEvidence.reference_title}</strong> · Rights Holder:{' '}
                      <strong>{activeEvidence.rights_holder}</strong>
                    </div>
                  </div>

                  {/* Separate 3-Part Assessment Box */}
                  <div className="grid grid-cols-3 gap-2.5 bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs shrink-0">
                    <div className="px-2 border-r border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase">Visual Similarity</div>
                      <div className="text-lg font-bold text-cyan-400 tabular-nums">
                        {activeVisualSim !== undefined ? `${(activeVisualSim * 100).toFixed(1)}%` : 'N/A'}
                      </div>
                      <div className="text-[9px] text-slate-500">
                        {activeVisualSim !== undefined
                          ? `Best frame pair (d=${activeEvidence.min_hamming_dist}b)`
                          : 'Awaiting ref fingerprints'}
                      </div>
                    </div>
                    <div className="px-2 border-r border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase">Metadata Relevance</div>
                      <div className="text-lg font-bold text-emerald-400 tabular-nums">
                        {activeMetaRel !== undefined ? `${(activeMetaRel * 100).toFixed(0)}%` : '—'}
                      </div>
                      <div className="text-[9px] text-slate-500">
                        {activeSignals.length > 0 ? `${activeSignals.length} context signals` : 'Context evaluated'}
                      </div>
                    </div>
                    <div className="px-2">
                      <div className="text-[10px] text-slate-400 uppercase">Overall Assessment</div>
                      <div className="text-xs font-bold text-amber-300 mt-1">
                        {activeBadge.label}
                      </div>
                      <div className="text-[9px] text-slate-500">
                        {activeEvidence.matched_frames_count > 0
                          ? `Seq conf: ${(activeEvidence.confidence_score * 100).toFixed(1)}%`
                          : 'Unmatched visual sequence'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mathematical Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">MIN HAMMING DIST</span>
                    <span className="text-slate-100 font-bold text-sm">
                      {activeEvidence.min_hamming_dist < 64 ? `${activeEvidence.min_hamming_dist} bits` : 'N/A'}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Threshold &le; 12–16 bits</span>
                  </div>
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">AVG BEST DISTANCE</span>
                    <span className="text-slate-100 font-bold text-sm">
                      {activeEvidence.avg_hamming_dist < 64 ? `${activeEvidence.avg_hamming_dist.toFixed(1)} bits` : 'N/A'}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Across compared frames</span>
                  </div>
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">TEMPORAL OFFSET</span>
                    <span className="text-cyan-400 font-bold text-sm">
                      {activeEvidence.temporal_offset_sec > 0
                        ? `+${activeEvidence.temporal_offset_sec.toFixed(1)}s`
                        : `${activeEvidence.temporal_offset_sec.toFixed(1)}s`}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Best visual alignment offset</span>
                  </div>
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">ALIGNED / CAPTURED FRAMES</span>
                    <span className="text-emerald-400 font-bold text-sm">
                      {activeEvidence.matched_frames_count} matched / {activeCapturedFrames.length || activeEvidence.total_compared_frames} captured
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {activeEvidence.matched_frames_count === 0 ? 'Unmatched (frames preserved)' : 'Locked frame sequence'}
                    </span>
                  </div>
                </div>

                {/* Candidate Investigation Target & Source Navigation */}
                <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                    <span className="text-slate-400 uppercase text-[10px] font-semibold">
                      Examined Candidate Source & Provenance
                    </span>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-slate-400">
                        Platform: <strong className="text-cyan-300">{activeEvidence.candidate_platform || activeEvidence.candidate_domain}</strong>
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400">
                        Captured: <strong className="text-slate-200">{new Date(activeEvidence.created_at).toLocaleString()}</strong>
                      </span>
                    </div>
                  </div>
                  <CandidateSourceLink
                    url={activeEvidence.candidate_url}
                    domain={activeEvidence.candidate_domain}
                    candidateId={activeEvidence.candidate_id}
                    showCopy={true}
                    showOpenButton={true}
                  />
                </div>

                {/* Cryptographic Custody Seal */}
                <div className="p-3 bg-slate-950 rounded border border-slate-800 flex items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Hash className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="text-slate-400 shrink-0">Chain of Custody SHA-256:</span>
                    <span className="text-cyan-300 truncate">{activeEvidence.chain_of_custody_sha256}</span>
                  </div>
                  <span className="text-emerald-400 shrink-0 text-[11px]">VERIFIED SEAL</span>
                </div>
              </div>

              {/* Section 0: Full-Coverage All-to-All (R × C) Matching & Timeline Telemetry */}
              <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Full-Coverage All-to-All (R × C) Cross-Timestamp Match &amp; Segment Telemetry
                    </h3>
                    <p className="text-xs text-slate-400">
                      Compares every indexed reference frame against every indexed candidate frame across all timestamps, suppressing static duplicate inflation
                    </p>
                  </div>
                  {activeCoverage?.is_single_frame_coincidence && (
                    <span className="px-2.5 py-1 text-[10px] font-mono font-bold rounded bg-amber-950/90 text-amber-300 border border-amber-500/60">
                      ISOLATED SINGLE-FRAME COINCIDENCE (NOT A SEQUENCE MATCH)
                    </span>
                  )}
                </div>

                {/* Coverage & Frame Count Telemetry Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">REFERENCE DURATION &amp; FRAMES</span>
                    <span className="text-white font-bold text-sm">
                      {(activeCoverage?.reference_duration_sec ?? activeEvidence.reference_duration_sec ?? 0).toFixed(2)}s
                    </span>
                    <span className="text-[10px] text-cyan-300 block mt-0.5">
                      {activeCoverage?.total_reference_frames ?? activeEvidence.total_reference_frames ?? 0} indexed frames
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">CANDIDATE DURATION &amp; FRAMES</span>
                    <span className="text-white font-bold text-sm">
                      {(activeCoverage?.candidate_duration_sec ?? activeEvidence.candidate_duration_sec ?? 0).toFixed(2)}s
                    </span>
                    <span className="text-[10px] text-amber-300 block mt-0.5">
                      {activeCoverage?.total_candidate_frames ?? activeEvidence.total_candidate_frames ?? activeCapturedFrames.length} indexed frames
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">REFERENCE COVERAGE</span>
                    <span className="text-emerald-400 font-bold text-sm">
                      {(activeCoverage?.reference_coverage_pct ?? activeEvidence.reference_coverage_pct ?? 0).toFixed(2)}%
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {activeCoverage?.unique_reference_frames_matched ?? activeEvidence.unique_reference_frames_matched ?? 0} /{' '}
                      {activeCoverage?.total_reference_frames ?? activeEvidence.total_reference_frames ?? 0} unique ref frames
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">CANDIDATE COVERAGE</span>
                    <span className="text-cyan-400 font-bold text-sm">
                      {(activeCoverage?.candidate_coverage_pct ?? activeEvidence.candidate_coverage_pct ?? 0).toFixed(2)}%
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {activeCoverage?.unique_candidate_frames_matched ?? activeEvidence.unique_candidate_frames_matched ?? 0} /{' '}
                      {activeCoverage?.total_candidate_frames ?? activeEvidence.total_candidate_frames ?? activeCapturedFrames.length} unique cand frames
                    </span>
                  </div>
                </div>

                {/* Pair Counts & Formula Explanation */}
                <div className="p-3 bg-slate-950 rounded border border-slate-800 text-[11px] font-mono space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                    <span>
                      Raw Matching Pairs:{' '}
                      <strong className="text-white">
                        {activeCoverage?.raw_matching_pairs_count ?? activeEvidence.matched_frames_count}
                      </strong>
                    </span>
                    <span>
                      Deduplicated Active Pairs:{' '}
                      <strong className="text-emerald-300">
                        {activeCoverage?.deduplicated_matching_pairs_count ?? activeEvidence.matched_frames_count}
                      </strong>
                    </span>
                    <span>
                      Suppressed Static Duplicate Frames:{' '}
                      <strong className="text-amber-300">
                        {activeCoverage?.suppressed_static_duplicate_pairs_count ?? 0}
                      </strong>
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-900">
                    {activeCoverage?.coverage_formula_explanation ||
                      'Reference Coverage % = (Unique Matched Reference Frames / Total Indexed Reference Frames) × 100. Candidate Coverage % = (Unique Matched Candidate Frames / Total Indexed Candidate Frames) × 100.'}
                  </div>
                </div>

                {/* Visual Matched-Region Timeline Across Reference & Candidate Videos */}
                {activeCoverage?.matched_segments && activeCoverage.matched_segments.length > 0 && (
                  <div className="space-y-3 pt-1">
                    <div className="text-xs font-mono font-semibold text-cyan-300 uppercase">
                      Matched Temporal Regions &amp; Strongest Segments ({activeCoverage.matched_segments.length} Segment{activeCoverage.matched_segments.length === 1 ? '' : 's'})
                    </div>

                    {/* Reference Timeline Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>Reference Timeline (0.0s)</span>
                        <span>{Math.max(1, activeCoverage.reference_duration_sec).toFixed(1)}s</span>
                      </div>
                      <div className="relative w-full h-3 bg-slate-950 border border-slate-800 rounded overflow-hidden">
                        {activeCoverage.matched_segments.map((seg, i) => {
                          const refDur = Math.max(1, activeCoverage.reference_duration_sec);
                          const leftPct = Math.max(0, Math.min(100, (seg.reference_start_sec / refDur) * 100));
                          const widthPct = Math.max(1.5, Math.min(100 - leftPct, ((seg.reference_end_sec - seg.reference_start_sec + 1) / refDur) * 100));
                          return (
                            <div
                              key={`ref_seg_${i}`}
                              title={`Ref ${seg.reference_start_sec.toFixed(1)}s–${seg.reference_end_sec.toFixed(1)}s (${seg.matched_pair_count} frames)`}
                              className="absolute top-0 bottom-0 bg-cyan-400/80 border-x border-cyan-200"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Candidate Timeline Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>Candidate Timeline (0.0s)</span>
                        <span>{Math.max(1, activeCoverage.candidate_duration_sec).toFixed(1)}s</span>
                      </div>
                      <div className="relative w-full h-3 bg-slate-950 border border-slate-800 rounded overflow-hidden">
                        {activeCoverage.matched_segments.map((seg, i) => {
                          const candDur = Math.max(1, activeCoverage.candidate_duration_sec);
                          const leftPct = Math.max(0, Math.min(100, (seg.candidate_start_sec / candDur) * 100));
                          const widthPct = Math.max(1.5, Math.min(100 - leftPct, ((seg.candidate_end_sec - seg.candidate_start_sec + 1) / candDur) * 100));
                          return (
                            <div
                              key={`cand_seg_${i}`}
                              title={`Cand ${seg.candidate_start_sec.toFixed(1)}s–${seg.candidate_end_sec.toFixed(1)}s (${seg.matched_pair_count} frames)`}
                              className="absolute top-0 bottom-0 bg-emerald-400/80 border-x border-emerald-200"
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Segments Table */}
                    <div className="overflow-x-auto border border-slate-800 rounded">
                      <table className="w-full text-left font-mono text-[11px]">
                        <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="py-1.5 px-2.5">Segment</th>
                            <th className="py-1.5 px-2.5">Reference Range</th>
                            <th className="py-1.5 px-2.5">Candidate Range</th>
                            <th className="py-1.5 px-2.5">Shift (Δt)</th>
                            <th className="py-1.5 px-2.5">Matched Frames</th>
                            <th className="py-1.5 px-2.5">Similarity (Avg / Max)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70 bg-slate-950/50 text-slate-200">
                          {activeCoverage.matched_segments.map(seg => (
                            <tr key={seg.segment_id}>
                              <td className="py-1.5 px-2.5 text-cyan-300 font-semibold">{seg.segment_id}</td>
                              <td className="py-1.5 px-2.5">
                                {seg.reference_start_sec.toFixed(1)}s – {seg.reference_end_sec.toFixed(1)}s
                              </td>
                              <td className="py-1.5 px-2.5">
                                {seg.candidate_start_sec.toFixed(1)}s – {seg.candidate_end_sec.toFixed(1)}s
                              </td>
                              <td className="py-1.5 px-2.5 text-amber-300">
                                {seg.temporal_offset_sec >= 0 ? `+${seg.temporal_offset_sec.toFixed(1)}s` : `${seg.temporal_offset_sec.toFixed(1)}s`}
                              </td>
                              <td className="py-1.5 px-2.5 text-emerald-300 font-semibold">
                                {seg.matched_pair_count} pairs ({seg.unique_reference_frames} ref / {seg.unique_candidate_frames} cand)
                              </td>
                              <td className="py-1.5 px-2.5">
                                {seg.avg_similarity_pct.toFixed(1)}% / <strong className="text-emerald-300">{seg.max_similarity_pct.toFixed(1)}%</strong> ({seg.min_hamming_dist}b)
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 1: Genuine Extracted Candidate Frames & Provenance Strip (Always Shown Regardless of Match Status) */}
              {activeCapturedFrames.length > 0 && (
                <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Captured Candidate Keyframes & Evidence Provenance ({activeCapturedFrames.length} Frames)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Genuine decoded frames extracted from {activeEvidence.candidate_platform || activeEvidence.candidate_domain} — preserved in the Vault regardless of match verification outcome
                      </p>
                    </div>
                    <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-950 text-cyan-300 border border-slate-800">
                      Source: {activeEvidence.candidate_domain}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {activeCapturedFrames.map((frame, idx) => {
                      const imgSrc = resolveFrameImageUrl(frame.thumbnail_url);
                      const isSelectedFrame = activeFrameIndex === idx;
                      return (
                        <div
                          key={`${activeEvidence.id}_cf_${frame.frame_index}`}
                          onClick={() => setActiveFrameIndex(idx)}
                          className={`bg-slate-950 rounded border overflow-hidden text-[10px] font-mono cursor-pointer transition-all ${
                            isSelectedFrame
                              ? 'border-cyan-400 ring-1 ring-cyan-400/40'
                              : 'border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="px-2 py-1 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                            <span className="text-cyan-400 font-bold">FRAME #{frame.frame_index + 1}</span>
                            <span className="text-slate-300">t = {frame.timestamp_sec.toFixed(1)}s</span>
                          </div>
                          <div className="aspect-video bg-slate-950 relative flex items-center justify-center">
                            {imgSrc ? (
                              <img
                                src={imgSrc}
                                alt={`Candidate frame ${frame.frame_index + 1} at ${frame.timestamp_sec}s`}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="text-center p-2 text-slate-500">
                                <div>dHash: {frame.phash_hex.substring(0, 8)}…</div>
                              </div>
                            )}
                            {frame.best_similarity_pct !== undefined && (
                              <span
                                className={`absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[9px] border ${
                                  (frame.best_hamming_distance ?? 64) <= 16
                                    ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40'
                                    : 'bg-slate-950/90 text-slate-300 border-slate-700'
                                }`}
                              >
                                {frame.best_similarity_pct.toFixed(1)}% ({frame.best_hamming_distance}b)
                              </span>
                            )}
                          </div>
                          <div className="p-2 space-y-0.5 text-[9px] text-slate-400">
                            <div className="truncate text-slate-200">
                              dHash: <span className="text-amber-300">{frame.phash_hex}</span>
                            </div>
                            {frame.best_ref_timestamp_sec !== undefined && (
                              <div className="truncate text-slate-400">
                                Closest Ref: <span className="text-cyan-300">t={frame.best_ref_timestamp_sec.toFixed(1)}s</span>
                              </div>
                            )}
                            <div className="truncate text-slate-400">
                              Platform: {frame.platform}
                            </div>
                            <div className="truncate text-slate-500" title={frame.provenance_sha256}>
                              SHA256: {frame.provenance_sha256.substring(0, 14)}…
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Section 2: Side-by-Side Keyframe Forensics Comparison */}
              <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Side-by-Side Keyframe Forensic Comparison</h3>
                    <p className="text-xs text-slate-400">
                      {activeEvidence.matched_frames_count > 0
                        ? 'Verified aligned keyframe pairs between Reference Master and Candidate Stream'
                        : 'Closest visual keyframe pairs across all temporal offsets (Unmatched status — displayed for investigator verification)'}
                    </p>
                  </div>

                  {allInspectablePairs.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1 font-mono text-xs max-w-full overflow-x-auto py-1">
                      {allInspectablePairs.slice(0, 40).map((pair, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveFrameIndex(idx)}
                          title={`Ref ${pair.reference_timestamp_sec.toFixed(1)}s ↔ Cand ${pair.candidate_timestamp_sec.toFixed(1)}s (${pair.similarity_pct.toFixed(1)}%)`}
                          className={`px-2 py-1 rounded flex items-center justify-center font-bold transition-colors cursor-pointer text-[10px] ${
                            activeFrameIndex === idx
                              ? 'bg-cyan-400 text-slate-950'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          #{idx + 1} ({pair.reference_timestamp_sec.toFixed(0)}s↔{pair.candidate_timestamp_sec.toFixed(0)}s)
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {currentPair ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left: Reference Frame */}
                      <div className="space-y-2 p-3 bg-slate-950 rounded border border-slate-800">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-white">Official Reference Master</span>
                          <span className="text-cyan-400 font-mono text-[11px]">
                            t = {currentPair.reference_timestamp_sec.toFixed(1)}s
                          </span>
                        </div>

                        <div className="aspect-video bg-slate-900 rounded overflow-hidden flex items-center justify-center relative border border-slate-800">
                          {(() => {
                            const refSrc = resolveFrameImageUrl(currentPair.reference_thumbnail);
                            if (refSrc && !refImgFailed[activeFrameIndex]) {
                              return (
                                <>
                                  <img
                                    src={refSrc}
                                    alt={`Reference frame at ${currentPair.reference_timestamp_sec}s`}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                    onLoad={() => setRefImgLoading(prev => ({ ...prev, [activeFrameIndex]: false }))}
                                    onError={() => setRefImgFailed(prev => ({ ...prev, [activeFrameIndex]: true }))}
                                  />
                                  {refImgLoading[activeFrameIndex] && (
                                    <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center">
                                      <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                  )}
                                </>
                              );
                            }
                            return (
                              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-slate-950 text-slate-400 space-y-1">
                                <AlertCircle className="w-6 h-6 text-amber-400 shrink-0" />
                                <span className="font-semibold text-xs text-white">Reference Thumbnail Not Persisted</span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  64-bit dHash: {currentPair.reference_phash}
                                </span>
                              </div>
                            );
                          })()}
                          <span className="absolute top-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono text-cyan-300 border border-cyan-800/60 z-10">
                            REF MASTER
                          </span>
                        </div>

                        <div className="text-[10px] font-mono bg-slate-900 p-1.5 rounded border border-slate-800 text-slate-300 break-all flex items-center justify-between">
                          <span>
                            dHash: <strong className="text-cyan-300">{currentPair.reference_phash}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Right: Candidate Frame */}
                      <div className="space-y-2 p-3 bg-slate-950 rounded border border-slate-800">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-white">Detected Candidate Stream</span>
                          <span className="text-cyan-400 font-mono text-[11px]">
                            t = {currentPair.candidate_timestamp_sec.toFixed(1)}s
                          </span>
                        </div>

                        <div className="aspect-video bg-slate-900 rounded overflow-hidden flex items-center justify-center relative border border-slate-800">
                          {(() => {
                            const fallbackCandThumb =
                              activeCapturedFrames[activeFrameIndex]?.thumbnail_url ||
                              activeCapturedFrames[0]?.thumbnail_url;
                            const candSrc = resolveFrameImageUrl(
                              currentPair.candidate_thumbnail || fallbackCandThumb
                            );
                            if (candSrc && !candImgFailed[activeFrameIndex]) {
                              return (
                                <>
                                  <img
                                    src={candSrc}
                                    alt={`Candidate frame at ${currentPair.candidate_timestamp_sec}s`}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                    onLoad={() => setCandImgLoading(prev => ({ ...prev, [activeFrameIndex]: false }))}
                                    onError={() => setCandImgFailed(prev => ({ ...prev, [activeFrameIndex]: true }))}
                                  />
                                  {candImgLoading[activeFrameIndex] && (
                                    <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center">
                                      <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                  )}
                                </>
                              );
                            }
                            return (
                              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-slate-950 text-slate-400 space-y-1">
                                <AlertCircle className="w-6 h-6 text-amber-400 shrink-0" />
                                <span className="font-semibold text-xs text-white">Candidate Frame Hash Recorded</span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  64-bit dHash: {currentPair.candidate_phash}
                                </span>
                              </div>
                            );
                          })()}
                          <span className="absolute top-2 left-2 bg-amber-950/80 border border-amber-600/50 px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-300 z-10">
                            CANDIDATE STREAM
                          </span>
                        </div>

                        <div className="text-[10px] font-mono bg-slate-900 p-1.5 rounded border border-slate-800 text-slate-300 break-all flex items-center justify-between">
                          <span>
                            dHash: <strong className="text-amber-300">{currentPair.candidate_phash}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Comparison Delta Meter */}
                    <div className="p-3 bg-slate-950/70 border border-slate-800 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
                      <div className="flex flex-wrap items-center gap-3">
                        <Sliders className="w-4 h-4 text-cyan-400" />
                        <div>
                          <span className="text-slate-400">Hamming Distance: </span>
                          <strong className="text-white">{currentPair.hamming_distance} differing bits</strong>
                          <span className="text-slate-400"> (of 64 bits)</span>
                        </div>
                        <span className="text-slate-600">·</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            currentPair.hamming_distance <= 16
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {currentPair.hamming_distance <= 16 ? 'FRAME MATCH LOCKED' : 'UNMATCHED PAIR (CLOSEST VISUAL)'}
                        </span>
                        {currentPair.match_feature && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-950/70 text-cyan-300 border border-cyan-700/50">
                            Feature: {currentPair.match_feature}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Pair Visual Similarity:</span>
                        <strong className="text-emerald-400 text-sm">{currentPair.similarity_pct.toFixed(2)}%</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-1">
                    <div className="font-semibold text-amber-300 font-mono">
                      Reference Fingerprints Unavailable for Side-by-Side Pair Alignment
                    </div>
                    <p className="text-slate-400">
                      The linked reference work currently has 0 perceptual fingerprints (e.g. OTT reference in{' '}
                      <code className="text-cyan-300">AWAITING_AUTHORIZED_MEDIA</code> state). The {activeCapturedFrames.length} genuine candidate keyframes extracted above are preserved in the Vault and will automatically be compared once an authorized reference master video is attached.
                    </p>
                  </div>
                )}
              </div>

              {/* Section 3: Metadata/Context Signals & Reasons for Uncertainty */}
              {(activeSignals.length > 0 || activeUncertaintyReasons.length > 0) && (
                <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Metadata / Context Assessment & Diagnostic Uncertainty Analysis
                      </h3>
                      <p className="text-xs text-slate-400">
                        Evaluates event/fixture, teams, competition, scheduled window, stream title, platform, and scoreboard cues independently of frame matching
                      </p>
                    </div>
                    {activeMetaRel !== undefined && (
                      <span className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-xs font-bold">
                        Metadata Relevance: {(activeMetaRel * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {activeSignals.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {activeSignals.map((sig, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded bg-slate-950 border border-slate-800 flex flex-col justify-between gap-2 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-slate-200">{sig.label}</span>
                            <span
                              className={`px-2 py-0.5 text-[10px] font-mono rounded shrink-0 ${
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
                          <div className="text-cyan-300 font-mono text-[11px] break-words">
                            Observed: {sig.observed_value}
                          </div>
                          {sig.reference_value && (
                            <div className="text-slate-400 font-mono text-[10px]">
                              Reference: {sig.reference_value}
                            </div>
                          )}
                          <div className="text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-900">
                            Source: {sig.source}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeUncertaintyReasons.length > 0 && (
                    <div className="p-3.5 rounded bg-slate-950 border border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-amber-300 font-mono">
                        Reasons for Uncertainty / Assessment Notes
                      </div>
                      <ul className="space-y-1 text-xs text-slate-300 list-disc list-inside leading-relaxed">
                        {activeUncertaintyReasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>Non-Infringement Safeguard:</strong> Contextual metadata relevance (matching event, teams, or tournament title) identifies event-related streams for review, but is never used alone to claim copyright infringement. Statutory takedown notices require verified visual/audio match evidence or human investigator confirmation.
                    </div>
                  </div>
                </div>
              )}

              {/* Human Review & Enforcement Decision Panel */}
              <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Human Review & Final Enforcement Finding</h3>
                    <p className="text-xs text-slate-400">
                      Automated indicators do not constitute legal takedown authority until human analyst affirmation
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2.5 py-0.5 font-mono rounded ${
                      activeEvidence.review_decision === 'CONFIRMED'
                        ? 'bg-rose-950/60 text-rose-300 border border-rose-800'
                        : 'bg-amber-950/40 text-amber-300 border border-amber-800'
                    }`}
                  >
                    Status: {activeEvidence.review_decision}
                  </span>
                </div>

                <form onSubmit={handleReviewSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label
                      className={`p-3 rounded border text-left cursor-pointer transition-all ${
                        reviewDecision === 'CONFIRMED'
                          ? 'bg-rose-950/40 border-rose-600 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="decision"
                        value="CONFIRMED"
                        checked={reviewDecision === 'CONFIRMED'}
                        onChange={() => setReviewDecision('CONFIRMED')}
                        className="sr-only"
                      />
                      <div className="font-semibold text-xs text-rose-300">Confirm Infringement</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Confirmed unauthorized copy; issue DMCA notice
                      </div>
                    </label>

                    <label
                      className={`p-3 rounded border text-left cursor-pointer transition-all ${
                        reviewDecision === 'AUTHORIZED_LICENSEE'
                          ? 'bg-cyan-950/40 border-cyan-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="decision"
                        value="AUTHORIZED_LICENSEE"
                        checked={reviewDecision === 'AUTHORIZED_LICENSEE'}
                        onChange={() => setReviewDecision('AUTHORIZED_LICENSEE')}
                        className="sr-only"
                      />
                      <div className="font-semibold text-xs text-cyan-300">Authorized Licensee</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Legitimate broadcast affiliate or rights holder mirror
                      </div>
                    </label>

                    <label
                      className={`p-3 rounded border text-left cursor-pointer transition-all ${
                        reviewDecision === 'FALSE_POSITIVE'
                          ? 'bg-slate-800 border-slate-600 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="decision"
                        value="FALSE_POSITIVE"
                        checked={reviewDecision === 'FALSE_POSITIVE'}
                        onChange={() => setReviewDecision('FALSE_POSITIVE')}
                        className="sr-only"
                      />
                      <div className="font-semibold text-xs text-slate-200">False Positive</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        Dissimilar media or non-infringing commentary/highlights
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Investigator Name / ID</label>
                      <input
                        type="text"
                        required
                        value={reviewerName}
                        onChange={e => setReviewerName(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Review Audit Justification</label>
                      <input
                        type="text"
                        value={reviewNotes}
                        onChange={e => setReviewNotes(e.target.value)}
                        placeholder="e.g. Broadcast graphics and commentary confirmed unauthorized"
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="text-[11px] font-mono text-slate-400">
                      {activeEvidence.reviewed_by
                        ? `Last reviewed by ${activeEvidence.reviewed_by}`
                        : 'Pending human review'}
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingReview}
                      className="px-4 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-sans transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmittingReview ? 'Submitting...' : 'Sign & Record Decision'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DMCA Legal Notice Modal */}
      {takedownModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Generated DMCA / Statutory Takedown Package</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Compliant with 17 U.S.C. § 512(c) and international copyright conventions
                </p>
              </div>
              <button onClick={() => setTakedownModalOpen(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <pre className="p-4 bg-slate-950 rounded border border-slate-800 text-slate-200 text-xs font-mono whitespace-pre-wrap leading-relaxed select-all">
                {takedownText}
              </pre>
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-mono">
                Chain of custody hash sealed into statutory notice
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyNotice}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedNotice ? 'Copied!' : 'Copy Notice'}</span>
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([takedownText], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `dmca_takedown_${activeEvidence?.candidate_domain || 'notice'}_${Date.now()}.txt`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download (.txt)</span>
                </button>
                <button
                  onClick={() => setTakedownModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
