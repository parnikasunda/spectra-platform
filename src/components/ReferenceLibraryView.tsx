/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Stage A — Reference Content Registration & Fingerprint Library
 */

import React, { useState } from 'react';
import { 
  Film, 
  Upload, 
  Link as LinkIcon, 
  Trash2, 
  Eye, 
  AlertCircle,
  X,
  FileVideo,
  Loader2,
  Copy,
  Check
} from 'lucide-react';
import { ReferenceItem } from '../types/client.js';
import { fetchReferenceDetails } from '../api.js';

interface ReferenceLibraryViewProps {
  references: ReferenceItem[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onRegisterUpload: (formData: FormData) => Promise<ReferenceItem | any>;
  onRegisterUrl: (payload: any) => Promise<ReferenceItem | any>;
  isRegisterModalOpen: boolean;
  onCloseRegisterModal: () => void;
  onOpenRegisterModal: () => void;
}

export const ReferenceLibraryView: React.FC<ReferenceLibraryViewProps> = ({
  references,
  onRefresh,
  onDelete,
  onRegisterUpload,
  onRegisterUrl,
  isRegisterModalOpen,
  onCloseRegisterModal,
  onOpenRegisterModal
}) => {
  const [selectedRef, setSelectedRef] = useState<ReferenceItem | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Register Modal Form state with clean field naming
  const [regMode, setRegMode] = useState<'upload' | 'url'>('upload');
  const [title, setTitle] = useState('');
  const [rightsHolder, setRightsHolder] = useState('');
  const [assetType, setAssetType] = useState('VOD_FEATURE');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sampleInterval, setSampleInterval] = useState('2');
  const [auditNotes, setAuditNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleOpenDetails = async (ref: ReferenceItem) => {
    setIsLoadingDetails(true);
    setSelectedRef(ref);
    try {
      const full = await fetchReferenceDetails(ref.id);
      setSelectedRef(full);
    } catch (err: any) {
      console.error('Failed to load reference details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      let createdItem: ReferenceItem | null = null;

      if (regMode === 'upload') {
        if (!selectedFile) {
          throw new Error('Please select a video file to upload (MP4, MKV, MOV, WebM)');
        }
        // 1. FRONTEND FORM ENCODING: Construct a true FormData object with exact field names
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('title', title);
        formData.append('rightsHolder', rightsHolder);
        formData.append('assetType', assetType);
        formData.append('auditNotes', auditNotes);
        formData.append('sampleInterval', sampleInterval);

        // Include alias field names for comprehensive backend compatibility
        formData.append('rights_holder', rightsHolder);
        formData.append('asset_type', assetType);
        formData.append('notes', auditNotes);
        formData.append('sample_interval_sec', sampleInterval);
        formData.append('mediaFile', selectedFile);

        const result = await onRegisterUpload(formData);
        createdItem = result && result.id ? result : null;
      } else {
        if (!sourceUrl || !sourceUrl.trim()) {
          throw new Error('Please enter a valid media stream or video source URL');
        }
        const result = await onRegisterUrl({
          title,
          rightsHolder,
          rights_holder: rightsHolder,
          assetType,
          asset_type: assetType,
          sourceUrl: sourceUrl.trim(),
          source_url: sourceUrl.trim(),
          sampleInterval: parseFloat(sampleInterval),
          sample_interval_sec: parseFloat(sampleInterval),
          auditNotes,
          notes: auditNotes
        });
        createdItem = result && result.id ? result : null;
      }

      // Reset form on success
      setTitle('');
      setRightsHolder('');
      setSourceUrl('');
      setSelectedFile(null);
      setAuditNotes('');
      onCloseRegisterModal();
      onRefresh();

      // Open Keyframe Timeline drawer for the newly registered reference for immediate visual verification
      if (createdItem && createdItem.id) {
        handleOpenDetails(createdItem);
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Reference registration and fingerprinting failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredReferences = references.filter(r => {
    if (filterType === 'ALL') return true;
    return r.asset_type === filterType;
  });

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Reference Content Library</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Registered ground-truth media assets with perceptual frame fingerprints (64-bit dHash) and cryptographic provenance records
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded">
            {['ALL', 'LIVE_SPORTS', 'VOD_FEATURE', 'EPISODIC'].map(type => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-2.5 py-1 text-xs font-mono transition-colors rounded cursor-pointer ${
                  filterType === type 
                    ? 'bg-slate-800 text-white font-medium shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>

          <button
            onClick={onOpenRegisterModal}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-sans transition-colors cursor-pointer"
          >
            Register Reference
          </button>
        </div>
      </div>

      {/* Reference Library Table / Cards */}
      {filteredReferences.length === 0 ? (
        <div className="p-12 text-center rounded-lg border border-dashed border-slate-800 bg-slate-900/20 space-y-3">
          <Film className="w-10 h-10 text-slate-600 mx-auto" />
          <div className="text-sm font-medium text-slate-300">No reference media registered yet</div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Upload reference video footage (up to 500MB) or register a media stream URL to extract 64-bit dHash fingerprints for candidate matching.
          </p>
          <button
            onClick={onOpenRegisterModal}
            className="px-4 py-2 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors cursor-pointer"
          >
            Register First Reference
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredReferences.map((ref) => (
            <div 
              key={ref.id}
              className="p-5 rounded-lg bg-slate-900/50 border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col md:flex-row md:items-center justify-between gap-5"
            >
              <div className="flex items-start gap-4">
                {/* Thumbnail or fallback */}
                <div className="w-28 h-18 rounded bg-slate-950 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center relative">
                  {ref.thumbnail_url ? (
                    <img 
                      src={ref.thumbnail_url} 
                      alt={ref.title}
                      className="w-full h-full object-cover" 
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <FileVideo className="w-6 h-6 text-slate-600" />
                  )}
                  <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-0.2 text-[9px] font-mono text-slate-300 rounded">
                    {Math.floor(ref.duration_sec / 60)}:{(ref.duration_sec % 60).toString().padStart(2, '0')}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{ref.title}</h3>
                    <span className="text-slate-600">·</span>
                    <span className="text-xs text-cyan-400 font-mono">{ref.asset_type}</span>
                  </div>

                  {/* Clean unboxed metadata with · separators */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>Rights Holder: <strong className="text-slate-300 font-normal">{ref.rights_holder}</strong></span>
                    <span className="text-slate-700">·</span>
                    <span className="font-mono">{ref.resolution}</span>
                    <span className="text-slate-700">·</span>
                    <span className="font-mono">{ref.fps} fps</span>
                    <span className="text-slate-700">·</span>
                    <span className="font-mono">{ref.codec}</span>
                    <span className="text-slate-700">·</span>
                    <span className="text-emerald-400 font-mono font-medium">{ref.fingerprint_count} Keyframe Hashes</span>
                  </div>

                  <div className="text-[11px] font-mono text-slate-400 truncate max-w-lg">
                    Provenance SHA-256: {ref.provenance_sha256}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleOpenDetails(ref)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Inspect Keyframe Hashes</span>
                </button>
                <button
                  onClick={() => onDelete(ref.id)}
                  title="Delete reference"
                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded border border-transparent hover:border-rose-900/40 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Frame Fingerprints Inspection Drawer / Modal */}
      {selectedRef && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Temporal Fingerprint Sequence — {selectedRef.title}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  64-bit dHash perceptual values and visual thumbnails extracted across temporal timeline
                </p>
              </div>
              <button 
                onClick={() => setSelectedRef(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {isLoadingDetails ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs font-mono">
                  <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                  <span>Loading perceptual frame hashes from database...</span>
                </div>
              ) : selectedRef.fingerprints && selectedRef.fingerprints.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {selectedRef.fingerprints.map((fp) => (
                    <div key={fp.id} className="p-3 bg-slate-950/70 border border-slate-800 rounded space-y-2">
                      <div className="aspect-video bg-slate-900 rounded overflow-hidden flex items-center justify-center relative border border-slate-800/60">
                        {fp.thumbnail_data ? (
                          <img 
                            src={fp.thumbnail_data} 
                            alt={`Frame ${fp.frame_index}`}
                            className="w-full h-full object-cover" 
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono">Frame #{fp.frame_index}</span>
                        )}
                        <span className="absolute bottom-1 right-1 bg-black/80 px-1 text-[9px] font-mono text-cyan-400 rounded">
                          {fp.timestamp_sec.toFixed(1)}s
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                          <span>Frame #{fp.frame_index}</span>
                          <span>Lum: {fp.avg_luminance}</span>
                        </div>
                        <div className="flex items-center justify-between gap-1 bg-slate-900 p-1.5 rounded border border-slate-800/80">
                          <code className="text-[10px] font-mono text-cyan-300 break-all select-all">
                            {fp.phash_hex}
                          </code>
                          <button
                            onClick={() => handleCopyHash(fp.phash_hex)}
                            title="Copy 64-bit dHash"
                            className="text-slate-400 hover:text-white p-0.5 shrink-0 cursor-pointer"
                          >
                            {copiedHash === fp.phash_hex ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-400 text-xs">
                  No frame hashes extracted yet. (Processing or empty video)
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs text-slate-400">
              <span className="font-mono">Total Verified Keyframes: {selectedRef.fingerprints?.length || selectedRef.fingerprint_count || 0}</span>
              <button
                onClick={() => setSelectedRef(null)}
                className="px-3 py-1.5 text-xs text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Reference Modal */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-xl w-full shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Register Reference Ground Truth</h3>
                <p className="text-xs text-slate-400 mt-0.5">Stage A: Media ingestion and perceptual fingerprint extraction</p>
              </div>
              <button 
                onClick={onCloseRegisterModal}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-white p-1 cursor-pointer disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {submitError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Source Mode Toggle */}
              <div className="flex items-center gap-2 p-1 bg-slate-950 border border-slate-800 rounded">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setRegMode('upload')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    regMode === 'upload' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Direct Video Upload</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setRegMode('url')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    regMode === 'url' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Direct Stream / Media URL</span>
                </button>
              </div>

              {/* Form Fields */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Content Title</label>
                <input
                  type="text"
                  required
                  disabled={isSubmitting}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. UEFA Champions League Final / Film Master"
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Rights Holder</label>
                  <input
                    type="text"
                    required
                    disabled={isSubmitting}
                    value={rightsHolder}
                    onChange={(e) => setRightsHolder(e.target.value)}
                    placeholder="e.g. UEFA / Warner Bros"
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Asset Type</label>
                  <select
                    value={assetType}
                    disabled={isSubmitting}
                    onChange={(e) => setAssetType(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                  >
                    <option value="VOD_FEATURE">VOD Feature Film</option>
                    <option value="LIVE_SPORTS">Live Sports Broadcast</option>
                    <option value="EPISODIC">Episodic Television</option>
                    <option value="COMMERCIAL">Commercial / Short-form</option>
                    <option value="TRAILER">Promotional Trailer</option>
                  </select>
                </div>
              </div>

              {regMode === 'upload' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Select Video File (MP4, MKV, MOV up to 500MB)</label>
                  <div className="border border-dashed border-slate-800 rounded-lg p-4 bg-slate-950/40 text-center hover:border-slate-700 transition-colors">
                    <input
                      type="file"
                      accept="video/*,.mp4,.mkv,.mov,.webm"
                      disabled={isSubmitting}
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="hidden"
                      id="video-upload-input"
                    />
                    <label htmlFor="video-upload-input" className="cursor-pointer block space-y-1">
                      <Upload className="w-6 h-6 text-slate-500 mx-auto" />
                      <div className="text-xs text-slate-300">
                        {selectedFile ? selectedFile.name : 'Click to select reference video file'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : 'FFmpeg will probe codecs and extract frame hashes (up to 500MB)'}
                      </div>
                    </label>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Direct Source URL (HLS .m3u8 / Direct MP4 link)</label>
                  <input
                    type="url"
                    required
                    disabled={isSubmitting}
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://broadcast-cdn.example.com/master.m3u8"
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Fingerprint Temporal Sampling</label>
                  <select
                    value={sampleInterval}
                    disabled={isSubmitting}
                    onChange={(e) => setSampleInterval(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                  >
                    <option value="1">1 Frame / 1 sec (Ultra-dense)</option>
                    <option value="2">1 Frame / 2 sec (Recommended)</option>
                    <option value="5">1 Frame / 5 sec (Long-form)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Internal Audit Notes</label>
                  <input
                    type="text"
                    disabled={isSubmitting}
                    value={auditNotes}
                    onChange={(e) => setAuditNotes(e.target.value)}
                    placeholder="e.g. Master clean feed rights package"
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                  />
                </div>
              </div>

              {/* In-flight Processing Banner */}
              {isSubmitting && (
                <div className="p-3 bg-cyan-950/30 border border-cyan-800/60 rounded flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-cyan-400 animate-spin shrink-0" />
                  <div className="space-y-0.5">
                    <div className="text-xs font-medium text-cyan-200">
                      Extracting Keyframes &amp; Calculating Perceptual Hashes...
                    </div>
                    <div className="text-[11px] text-cyan-400/80 font-mono">
                      Running temporal sampling, probe metrics, and 64-bit dHash computation
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onCloseRegisterModal}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded font-sans transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmitting ? 'Extracting Keyframes & Calculating Perceptual Hashes...' : 'Register & Fingerprint'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
