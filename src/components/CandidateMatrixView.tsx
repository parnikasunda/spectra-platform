/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
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
  onRefresh: () => void;
  onVerifyCandidate: (candidateId: string, targetReferenceId?: string) => Promise<any>;
  onQuickInspect: (payload: { url: string; title?: string; target_reference_id?: string }) => Promise<any>;
  onNavigateToEvidence: (evidenceId?: string) => void;
}

export const CandidateMatrixView: React.FC<CandidateMatrixViewProps> = ({
  candidates,
  references,
  onRefresh,
  onVerifyCandidate,
  onQuickInspect,
  onNavigateToEvidence
}) => {
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [candidateDetails, setCandidateDetails] = useState<(CandidateItem & { fingerprints?: FrameFingerprint[] }) | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});

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
  const [quickRefId, setQuickRefId] = useState(references[0]?.id || '');
  const [isQuickInspecting, setIsQuickInspecting] = useState(false);
  const [quickInspectResult, setQuickInspectResult] = useState<any | null>(null);

  const handleVerify = async (cand: CandidateItem) => {
    setVerifyingId(cand.id);
    try {
      const res = await onVerifyCandidate(cand.id, cand.reference_id || undefined);
      if (res?.candidate) {
        setSelectedCandidate(res.candidate);
      }
      onRefresh();
    } catch (err: any) {
      alert(`Verification error: ${err.message}`);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleQuickInspectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickUrl) return;

    setIsQuickInspecting(true);
    setQuickInspectResult(null);

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
      alert(`Inspection failed: ${err.message}`);
    } finally {
      setIsQuickInspecting(false);
    }
  };

  const filteredCandidates = candidates.filter(c => {
    if (filterStatus !== 'ALL' && c.pipeline_status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        c.source_url.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q) ||
        c.discovered_title.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getStatusBadge = (status: PipelineStatus) => {
    switch (status) {
      case 'ANALYZED':
        return <span className="text-emerald-400 font-mono text-[11px] font-semibold">ANALYZED</span>;
      case 'ACQUIRED':
        return <span className="text-cyan-400 font-mono text-[11px]">ACQUIRED</span>;
      case 'MEDIA_DETECTED':
        return <span className="text-blue-400 font-mono text-[11px]">MEDIA_DETECTED</span>;
      case 'REACHABLE':
        return <span className="text-slate-300 font-mono text-[11px]">REACHABLE</span>;
      case 'DRM_PROTECTED':
        return <span className="text-amber-400 font-mono text-[11px] flex items-center gap-1"><Lock className="w-3 h-3" /> DRM_PROTECTED</span>;
      case 'UNREACHABLE':
        return <span className="text-rose-400 font-mono text-[11px]">UNREACHABLE</span>;
      default:
        return <span className="text-slate-400 font-mono text-[11px]">DISCOVERED</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Candidate Source Verification Matrix</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Stage C: Network reachability testing, stream container inspection, DRM detection, and pipeline state transitions
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

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded overflow-x-auto">
          {['ALL', 'DISCOVERED', 'REACHABLE', 'MEDIA_DETECTED', 'ANALYZED', 'DRM_PROTECTED', 'UNREACHABLE'].map(s => (
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

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search domain or URL..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
          />
        </div>
      </div>

      {/* Candidate Matrix Table */}
      <div className="rounded-lg bg-slate-900/40 border border-slate-800/80 overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Surveillance Candidate Inventory</h2>
          <span className="text-xs text-slate-400 font-mono">Found: {filteredCandidates.length}</span>
        </div>

        {filteredCandidates.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-2">
            <p>No candidate sources match current criteria.</p>
            <p className="text-slate-400">Launch a discovery sweep or paste a stream URL into the Quick Inspector.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Candidate Source & Page</th>
                  <th className="py-2.5 px-4 font-medium">Type / Platform</th>
                  <th className="py-2.5 px-4 font-medium">Pipeline Status</th>
                  <th className="py-2.5 px-4 font-medium">HTTP Code</th>
                  <th className="py-2.5 px-4 font-medium">Latency</th>
                  <th className="py-2.5 px-4 font-medium">Stream Resource</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredCandidates.map((cand) => (
                  <tr key={cand.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 max-w-md">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white truncate" title={cand.discovered_title || cand.domain}>
                          {cand.discovered_title || cand.domain}
                        </span>
                        {cand.platform && (
                          <span className="px-1.5 py-0.2 bg-slate-800 text-[10px] text-cyan-300 font-mono rounded">
                            {cand.platform}
                          </span>
                        )}
                      </div>
                      <div className="mt-1">
                        <CandidateSourceLink
                          url={cand.source_url}
                          mediaUrl={cand.media_url}
                          canonicalUrl={cand.canonical_url}
                          domain={cand.domain}
                          compact={true}
                          truncateLength={36}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 mt-0.5">
                        <span>ID: {cand.id}</span>
                        {cand.reference_id && (
                          <>
                            <span>·</span>
                            <span className="text-slate-400">Ref: {cand.reference_id}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px]">
                      <div className="text-cyan-400 font-semibold">{cand.source_category || cand.discovery_provider}</div>
                      <div className="text-[10px] text-slate-500">{cand.asset_kind || 'DISCOVERED_PAGE'}</div>
                    </td>
                    <td className="py-3 px-4">
                      {getStatusBadge(cand.pipeline_status)}
                      {cand.acquisition_status && cand.acquisition_status !== 'PENDING' && (
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          {cand.acquisition_status}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {cand.reachability_code > 0 ? (
                        <span className={cand.reachability_code === 200 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {cand.reachability_code}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400 tabular-nums">
                      {cand.reachability_latency_ms > 0 ? `${cand.reachability_latency_ms.toFixed(1)}ms` : '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300 text-[11px]">
                      <div>{cand.media_type}</div>
                      {cand.media_resolution && (
                        <div className="text-[10px] text-slate-500">{cand.media_resolution}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      {cand.source_url && (
                        <a
                          href={cand.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/40 rounded transition-colors"
                          title="Open discovered source webpage"
                        >
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}

                      <button
                        onClick={() => setSelectedCandidate(cand)}
                        className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                        title="View inspection diagnostics"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleVerify(cand)}
                        disabled={verifyingId === cand.id}
                        className="px-2.5 py-1 text-[11px] font-medium text-slate-900 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors disabled:opacity-50 cursor-pointer font-sans"
                      >
                        {verifyingId === cand.id ? 'Verifying...' : 'Verify'}
                      </button>
                    </td>
                  </tr>
                ))}
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
