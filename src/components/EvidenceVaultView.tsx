/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Stage D & E — Evidence Management & Side-by-Side Keyframe Forensics
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
  ExternalLink,
  ChevronRight,
  UserCheck,
  Hash,
  Eye,
  Sliders,
  X
} from 'lucide-react';
import { EvidenceRecord, MatchedKeyframePair, ReviewDecision } from '../types/client.js';
import { submitEvidenceReview, generateTakedownNotice } from '../api.js';

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
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision>('CONFIRMED');
  const [reviewerName, setReviewerName] = useState('Senior Investigator');
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [takedownModalOpen, setTakedownModalOpen] = useState(false);
  const [takedownText, setTakedownText] = useState('');
  const [copiedNotice, setCopiedNotice] = useState(false);

  const activeEvidence = selectedEvidence || (evidenceRecords.length > 0 ? evidenceRecords[0] : null);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvidence) return;
    setIsSubmittingReview(true);
    try {
      await submitEvidenceReview(activeEvidence.id, {
        decision: reviewDecision,
        reviewed_by: reviewerName,
        notes: reviewNotes
      });
      onRefresh();
      alert('Human review decision and audit trail recorded successfully.');
    } catch (err: any) {
      alert(`Review error: ${err.message}`);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleOpenTakedown = async () => {
    if (!activeEvidence) return;
    try {
      const res = await generateTakedownNotice(activeEvidence.id);
      setTakedownText(res.notice);
      setTakedownModalOpen(true);
    } catch (err: any) {
      alert(`Failed to generate takedown notice: ${err.message}`);
    }
  };

  const handleCopyNotice = () => {
    navigator.clipboard.writeText(takedownText);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  };

  const currentPair: MatchedKeyframePair | undefined = activeEvidence?.sample_pairs?.[activeFrameIndex] || activeEvidence?.sample_pairs?.[0];

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Digital Evidence Vault & Forensics</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Stage D & E: Side-by-side keyframe inspection, temporal sequence cross-correlation, and tamper-evident custody seals
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

      {evidenceRecords.length === 0 ? (
        <div className="p-12 text-center rounded-lg border border-dashed border-slate-800 bg-slate-900/20 space-y-3">
          <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto" />
          <div className="text-sm font-medium text-slate-300">No evidence dossiers created yet</div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            When candidates are verified and matched against reference fingerprints, evidence records are permanently sealed here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Evidence List */}
          <div className="lg:col-span-4 space-y-3">
            <div className="text-xs font-semibold text-slate-400 uppercase font-mono tracking-wider px-1">
              Evidence Dossiers ({evidenceRecords.length})
            </div>

            <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1">
              {evidenceRecords.map((ev) => {
                const isSelected = activeEvidence?.id === ev.id;
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
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white truncate max-w-[180px]">{ev.reference_title}</span>
                        <span className={`font-mono text-[11px] font-bold ${
                          ev.confidence_score >= 0.7 ? 'text-amber-400' : 'text-slate-400'
                        }`}>
                          {(ev.confidence_score * 100).toFixed(1)}% Match
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-cyan-400 truncate">
                        {ev.candidate_domain}
                      </div>

                      {/* Clean metadata without pill boxes */}
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono pt-1">
                        <span>Min dist: {ev.min_hamming_dist}b</span>
                        <span>·</span>
                        <span>Offset: {ev.temporal_offset_sec > 0 ? `+${ev.temporal_offset_sec}s` : `${ev.temporal_offset_sec}s`}</span>
                        <span>·</span>
                        <span className={ev.review_decision === 'CONFIRMED' ? 'text-rose-400' : 'text-slate-400'}>
                          {ev.review_decision}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detailed Forensics & Side-by-Side Keyframe Inspector */}
          {activeEvidence && (
            <div className="lg:col-span-8 space-y-6">
              {/* Evidence Overview Header Card */}
              <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                      <span>EVIDENCE RECORD</span>
                      <span>·</span>
                      <span className="text-cyan-400">{activeEvidence.id}</span>
                    </div>
                    <h2 className="text-base font-bold text-white mt-0.5">{activeEvidence.reference_title}</h2>
                    <div className="text-xs text-slate-300">
                      Rights Holder: <strong>{activeEvidence.rights_holder}</strong>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-400 font-mono">Mathematical Match Confidence</div>
                    <div className="text-2xl font-bold font-mono text-amber-400 tabular-nums">
                      {(activeEvidence.confidence_score * 100).toFixed(2)}%
                    </div>
                  </div>
                </div>

                {/* Mathematical Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">MIN HAMMING DIST</span>
                    <span className="text-slate-100 font-bold text-sm">{activeEvidence.min_hamming_dist} bits</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Threshold &le; 12</span>
                  </div>
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">AVG DISTANCE</span>
                    <span className="text-slate-100 font-bold text-sm">{activeEvidence.avg_hamming_dist.toFixed(1)} bits</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Aligned cluster</span>
                  </div>
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">BROADCAST DELAY</span>
                    <span className="text-cyan-400 font-bold text-sm">
                      {activeEvidence.temporal_offset_sec > 0 ? `+${activeEvidence.temporal_offset_sec.toFixed(1)}s` : `${activeEvidence.temporal_offset_sec.toFixed(1)}s`}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Live stream lag</span>
                  </div>
                  <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">MATCHED FRAMES</span>
                    <span className="text-emerald-400 font-bold text-sm">
                      {activeEvidence.matched_frames_count} / {activeEvidence.total_compared_frames}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Temporal consistency</span>
                  </div>
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

              {/* Side-by-Side Keyframe Forensics Comparison */}
              <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Side-by-Side Keyframe Forensic Comparison</h3>
                    <p className="text-xs text-slate-400">Ground-truth Reference Frame vs Detected Candidate Frame</p>
                  </div>

                  {activeEvidence.sample_pairs.length > 1 && (
                    <div className="flex items-center gap-1 font-mono text-xs">
                      {activeEvidence.sample_pairs.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveFrameIndex(idx)}
                          className={`w-6 h-6 rounded flex items-center justify-center font-bold transition-colors ${
                            activeFrameIndex === idx 
                              ? 'bg-cyan-400 text-slate-950' 
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {idx + 1}
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
                          <span className="text-cyan-400 font-mono text-[11px]">{currentPair.reference_timestamp_sec.toFixed(1)}s</span>
                        </div>

                        <div className="aspect-video bg-slate-900 rounded overflow-hidden flex items-center justify-center relative">
                          {currentPair.reference_thumbnail ? (
                            <img 
                              src={currentPair.reference_thumbnail} 
                              alt="Reference frame" 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="text-xs text-slate-400 font-mono">Reference Frame</span>
                          )}
                          <span className="absolute top-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono text-white">
                            REF MASTER
                          </span>
                        </div>

                        <div className="text-[10px] font-mono bg-slate-900 p-1.5 rounded border border-slate-800 text-slate-300 break-all">
                          dHash: {currentPair.reference_phash}
                        </div>
                      </div>

                      {/* Right: Candidate Frame */}
                      <div className="space-y-2 p-3 bg-slate-950 rounded border border-slate-800">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-white">Detected Candidate Stream</span>
                          <span className="text-cyan-400 font-mono text-[11px]">{currentPair.candidate_timestamp_sec.toFixed(1)}s</span>
                        </div>

                        <div className="aspect-video bg-slate-900 rounded overflow-hidden flex items-center justify-center relative">
                          {currentPair.candidate_thumbnail ? (
                            <img 
                              src={currentPair.candidate_thumbnail} 
                              alt="Candidate frame" 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="text-xs text-slate-400 font-mono">Candidate Stream Frame</span>
                          )}
                          <span className="absolute top-2 left-2 bg-amber-950/80 border border-amber-600/50 px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-300">
                            CANDIDATE
                          </span>
                        </div>

                        <div className="text-[10px] font-mono bg-slate-900 p-1.5 rounded border border-slate-800 text-slate-300 break-all">
                          dHash: {currentPair.candidate_phash}
                        </div>
                      </div>
                    </div>

                    {/* Comparison Delta Meter */}
                    <div className="p-3 bg-slate-950/70 border border-slate-800 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
                      <div className="flex items-center gap-3">
                        <Sliders className="w-4 h-4 text-cyan-400" />
                        <div>
                          <span className="text-slate-400">Hamming Distance: </span>
                          <strong className="text-white">{currentPair.hamming_distance} differing bits</strong>
                          <span className="text-slate-400"> (of 64 bits)</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Frame Similarity:</span>
                        <strong className="text-emerald-400 text-sm">{currentPair.similarity_pct.toFixed(2)}%</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    No matching keyframe pairs available for side-by-side display.
                  </div>
                )}
              </div>

              {/* Human Review & Enforcement Decision Panel */}
              <div className="p-5 rounded-lg bg-slate-900/60 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Human Review & Final Enforcement Finding</h3>
                    <p className="text-xs text-slate-400">Automated indicators do not constitute legal takedown authority until human analyst affirmation</p>
                  </div>
                  <span className={`text-xs px-2.5 py-0.5 font-mono rounded ${
                    activeEvidence.review_decision === 'CONFIRMED'
                      ? 'bg-rose-950/60 text-rose-300 border border-rose-800'
                      : 'bg-amber-950/40 text-amber-300 border border-amber-800'
                  }`}>
                    Status: {activeEvidence.review_decision}
                  </span>
                </div>

                <form onSubmit={handleReviewSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className={`p-3 rounded border text-left cursor-pointer transition-all ${
                      reviewDecision === 'CONFIRMED' 
                        ? 'bg-rose-950/40 border-rose-600 text-white' 
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}>
                      <input 
                        type="radio" 
                        name="decision" 
                        value="CONFIRMED" 
                        checked={reviewDecision === 'CONFIRMED'} 
                        onChange={() => setReviewDecision('CONFIRMED')}
                        className="sr-only" 
                      />
                      <div className="font-semibold text-xs text-rose-300">Confirm Infringement</div>
                      <div className="text-[11px] text-slate-400 mt-1">Confirmed unauthorized copy; issue DMCA notice</div>
                    </label>

                    <label className={`p-3 rounded border text-left cursor-pointer transition-all ${
                      reviewDecision === 'AUTHORIZED_LICENSEE' 
                        ? 'bg-cyan-950/40 border-cyan-500 text-white' 
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}>
                      <input 
                        type="radio" 
                        name="decision" 
                        value="AUTHORIZED_LICENSEE" 
                        checked={reviewDecision === 'AUTHORIZED_LICENSEE'} 
                        onChange={() => setReviewDecision('AUTHORIZED_LICENSEE')}
                        className="sr-only" 
                      />
                      <div className="font-semibold text-xs text-cyan-300">Authorized Licensee</div>
                      <div className="text-[11px] text-slate-400 mt-1">Legitimate broadcast affiliate or rights holder mirror</div>
                    </label>

                    <label className={`p-3 rounded border text-left cursor-pointer transition-all ${
                      reviewDecision === 'FALSE_POSITIVE' 
                        ? 'bg-slate-800 border-slate-600 text-white' 
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}>
                      <input 
                        type="radio" 
                        name="decision" 
                        value="FALSE_POSITIVE" 
                        checked={reviewDecision === 'FALSE_POSITIVE'} 
                        onChange={() => setReviewDecision('FALSE_POSITIVE')}
                        className="sr-only" 
                      />
                      <div className="font-semibold text-xs text-slate-200">False Positive</div>
                      <div className="text-[11px] text-slate-400 mt-1">Dissimilar media or coincidence collision</div>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Investigator Name / ID</label>
                      <input
                        type="text"
                        required
                        value={reviewerName}
                        onChange={(e) => setReviewerName(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Review Audit Justification</label>
                      <input
                        type="text"
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        placeholder="e.g. Broadcast graphics and commentary confirmed unauthorized"
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="text-[11px] font-mono text-slate-400">
                      {activeEvidence.reviewed_by ? `Last reviewed by ${activeEvidence.reviewed_by}` : 'Pending human review'}
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
                <p className="text-xs text-slate-400 mt-0.5">Compliant with 17 U.S.C. § 512(c) and international copyright conventions</p>
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
