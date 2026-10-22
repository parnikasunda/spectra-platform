/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Stage A — Reference Content Registration & Fingerprint Library
 * Equipped with Scalable Chunked Upload Architecture (bypassing 32MB proxy limits)
 */

import React, { useState, useEffect } from 'react';
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
  Check,
  CheckCircle2
} from 'lucide-react';
import { ReferenceItem } from '../types/client.js';
import { 
  fetchReferenceDetails, 
  registerReference, 
  fetchUploadConfig, 
  uploadChunkedVideoReference,
  UploadConfig,
  UploadProgress 
} from '../api.js';

interface ReferenceLibraryViewProps {
  references: ReferenceItem[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onRegisterUpload?: (formData: FormData, onProgress?: (p: UploadProgress) => void) => Promise<ReferenceItem | any>;
  onRegisterUrl?: (payload: any) => Promise<ReferenceItem | any>;
  isRegisterModalOpen: boolean;
  onCloseRegisterModal: () => void;
  onOpenRegisterModal: () => void;
}

import { resolveFrameImageUrl, isAuthenticDecodedFrame } from '../utils/frameResolver.js';

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
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});

  // Upload configuration
  const [uploadConfig, setUploadConfig] = useState<UploadConfig>({
    maxUploadSizeMB: 500,
    maxUploadSizeBytes: 500 * 1024 * 1024,
    uploadChunkSizeMB: 5,
    chunkSizeBytes: 5 * 1024 * 1024,
    allowedExtensions: ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.ts', '.m4v'],
    mode: 'chunked'
  });

  // Register Modal Form state
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [title, setTitle] = useState('');
  const [rightsHolder, setRightsHolder] = useState('');
  const [assetType, setAssetType] = useState('VOD_FEATURE');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sampleInterval, setSampleInterval] = useState('2');
  const [auditNotes, setAuditNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    fetchUploadConfig().then(cfg => {
      if (cfg) setUploadConfig(cfg);
    }).catch(err => console.warn('Using default upload config:', err));
  }, []);

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
    setUploadProgress(null);

    try {
      let createdItem: ReferenceItem | null = null;

      if (mode === 'upload') {
        if (!file) {
          throw new Error('Please select a video file to upload (MP4, MKV, MOV, WebM)');
        }

        if (file.size > uploadConfig.maxUploadSizeBytes) {
          throw new Error(
            `File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${uploadConfig.maxUploadSizeMB} MB`
          );
        }

        // Use direct chunked video upload pipeline to bypass 32MB reverse-proxy limits
        createdItem = await uploadChunkedVideoReference(
          file,
          {
            title: title.trim(),
            rightsHolder: rightsHolder.trim(),
            assetType,
            sampleInterval,
            auditNotes: auditNotes.trim() || undefined
          },
          (progress) => {
            setUploadProgress(progress);
          }
        );
      } else {
        if (!sourceUrl || !sourceUrl.trim()) {
          throw new Error('Please enter a valid media stream or video source URL');
        }
        const payload = {
          title: title.trim(),
          rightsHolder: rightsHolder.trim(),
          rights_holder: rightsHolder.trim(),
          assetType,
          asset_type: assetType,
          sourceUrl: sourceUrl.trim(),
          source_url: sourceUrl.trim(),
          sampleInterval: parseFloat(sampleInterval),
          sample_interval_sec: parseFloat(sampleInterval),
          auditNotes: auditNotes.trim() || undefined,
          notes: auditNotes.trim() || undefined
        };
        if (onRegisterUrl) {
          const res: any = await onRegisterUrl(payload);
          createdItem = res && res.id ? res : (res && res.data ? res.data : null);
        } else {
          const res: any = await registerReference(payload);
          createdItem = res && res.id ? res : (res && res.data ? res.data : null);
        }
      }

      // Reset form on success
      setTitle('');
      setRightsHolder('');
      setSourceUrl('');
      setFile(null);
      setAuditNotes('');
      setUploadProgress(null);
      onCloseRegisterModal();
      onRefresh();

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
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                  filterType === type 
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>

          <button
            onClick={onOpenRegisterModal}
            className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded font-sans transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-sm shadow-cyan-950"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Register Reference Ground Truth</span>
          </button>
        </div>
      </div>

      {/* References Grid / Cards */}
      {filteredReferences.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-800 rounded-lg bg-slate-900/30">
          <Film className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-300">No reference media registered</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Upload reference video masters (.mp4, .mkv, .mov) or connect authorized stream URLs to generate ground-truth perceptual fingerprints.
          </p>
          <button
            onClick={onOpenRegisterModal}
            className="mt-4 px-3 py-1.5 text-xs font-medium text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 rounded hover:bg-cyan-900/40 transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Register First Reference</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredReferences.map(ref => (
            <div 
              key={ref.id}
              className="group bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 rounded-lg overflow-hidden transition-all flex flex-col"
            >
              {/* Thumbnail Header with Metadata Overlay */}
              <div className="relative aspect-video bg-slate-950 flex items-center justify-center overflow-hidden border-b border-slate-800/60">
                {(() => {
                  const cardThumbSrc = resolveFrameImageUrl(
                    ref.thumbnail_url ||
                    ref.first_thumbnail ||
                    ref.fingerprints?.[0]?.thumbnail_url ||
                    ref.fingerprints?.[0]?.thumbnail_path ||
                    ref.fingerprints?.[0]?.thumbnail_data
                  );
                  if (cardThumbSrc && !failedThumbnails[ref.id]) {
                    return (
                      <img 
                        src={cardThumbSrc} 
                        alt={ref.title} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                        onError={() => setFailedThumbnails(prev => ({ ...prev, [ref.id]: true }))}
                      />
                    );
                  }
                  return (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-center p-2 bg-slate-950">
                      <AlertCircle className="w-6 h-6 text-amber-400 mb-1 shrink-0" />
                      <span className="text-xs font-medium text-slate-300">Reference Frame Unavailable</span>
                      <span className="text-[10px] text-slate-500 font-mono">Ground-truth keyframe extraction pending</span>
                    </div>
                  );
                })()}
                
                <div className="absolute top-2 left-2">
                  <span className="px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase bg-slate-950/80 backdrop-blur-md text-cyan-300 border border-cyan-500/30 rounded">
                    {ref.asset_type.replace('_', ' ')}
                  </span>
                </div>

                <div className="absolute top-2 right-2">
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-slate-950/80 backdrop-blur-md text-slate-300 border border-slate-800 rounded">
                    {ref.resolution || '1080p'} • {ref.fps ? `${ref.fps} fps` : '24 fps'}
                  </span>
                </div>

                <div className="absolute bottom-2 right-2">
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-cyan-950/90 text-cyan-300 border border-cyan-800/80 rounded flex items-center gap-1">
                    <Film className="w-2.5 h-2.5" />
                    {ref.fingerprint_count || 0} Keyframe Hashes
                  </span>
                </div>
              </div>

              {/* Body */}
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-white truncate" title={ref.title}>
                    {ref.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                    <span>{ref.rights_holder}</span>
                    <span>•</span>
                    <span className="font-mono">{ref.source_type}</span>
                  </div>
                </div>

                {/* Provenance Hash */}
                <div className="p-2 bg-slate-950/60 border border-slate-800/60 rounded text-[11px] font-mono space-y-1">
                  <div className="text-slate-400 text-[10px] uppercase flex items-center justify-between">
                    <span>Cryptographic Provenance</span>
                    <span className="text-emerald-400">SHA-256</span>
                  </div>
                  <div className="text-slate-300 truncate" title={ref.provenance_sha256}>
                    {ref.provenance_sha256 || 'Calculated during keyframe extraction'}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
                  <button
                    onClick={() => handleOpenDetails(ref)}
                    className="px-2.5 py-1 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/40 border border-cyan-800/40 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Inspect Keyframes</span>
                  </button>

                  <button
                    onClick={() => onDelete(ref.id)}
                    className="p-1 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Delete reference"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drawer: Perceptual Keyframe Timeline Inspector */}
      {selectedRef && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-sm font-semibold text-white truncate max-w-md">{selectedRef.title}</h2>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  ID: {selectedRef.id} • {selectedRef.rights_holder} • {selectedRef.resolution}
                </div>
              </div>
              <button 
                onClick={() => setSelectedRef(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Keyframe Timeline List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="p-3 bg-cyan-950/20 border border-cyan-800/40 rounded text-xs text-slate-300">
                <div className="font-semibold text-cyan-300 mb-1">Perceptual Frame Fingerprint Sequence</div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Extracted at calibrated intervals. Each 64-bit dHash string captures spatial gradients invariant to re-encoding, resolution downscaling, and minor color variations.
                </p>
              </div>

              {isLoadingDetails ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  <span>Loading frame hashes and visual thumbnails...</span>
                </div>
              ) : selectedRef.fingerprints && selectedRef.fingerprints.length > 0 ? (
                <div className="space-y-3">
                  {selectedRef.fingerprints.map((fp, idx) => (
                    <div 
                      key={fp.id || idx}
                      className="flex items-center gap-4 p-3 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors"
                    >
                      {/* Frame Thumbnail */}
                      <div className="w-28 h-16 bg-slate-900 rounded overflow-hidden shrink-0 border border-slate-800 relative">
                        {(() => {
                          const frameSrc = resolveFrameImageUrl(fp.thumbnail_url || fp.thumbnail_path || fp.thumbnail_data);
                          const key = fp.id || `${idx}`;
                          if (frameSrc && !failedThumbnails[key]) {
                            return (
                              <img 
                                src={frameSrc} 
                                alt={`Decoded Reference Frame @ ${fp.timestamp_sec}s`}
                                className="w-full h-full object-cover" 
                                referrerPolicy="no-referrer"
                                onError={() => setFailedThumbnails(prev => ({ ...prev, [key]: true }))}
                              />
                            );
                          }
                          return (
                            <div className="w-full h-full flex flex-col items-center justify-center p-1 text-center bg-slate-950 text-slate-400">
                              <AlertCircle className="w-4 h-4 text-amber-400 mb-0.5 shrink-0" />
                              <span className="text-[9px] font-mono text-amber-300">Frame Unavailable</span>
                            </div>
                          );
                        })()}
                        <span className="absolute bottom-1 right-1 px-1 py-0.2 bg-black/80 font-mono text-[9px] text-slate-300 rounded">
                          {fp.timestamp_sec.toFixed(1)}s
                        </span>
                      </div>

                      {/* Fingerprint Data */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-200">Frame #{fp.frame_index ?? idx}</span>
                          <span className="text-[11px] text-slate-400 font-mono">t = {fp.timestamp_sec}s</span>
                        </div>
                        
                        <div className="flex items-center gap-2 bg-slate-900/80 px-2.5 py-1 rounded border border-slate-800/80">
                          <span className="text-[10px] uppercase text-cyan-400 font-mono shrink-0">dHash:</span>
                          <span className="text-xs font-mono text-cyan-300 tracking-wider truncate selection:bg-cyan-900">
                            {fp.phash_hex}
                          </span>
                          <button
                            onClick={() => handleCopyHash(fp.phash_hex)}
                            className="ml-auto text-slate-400 hover:text-white p-0.5 cursor-pointer shrink-0"
                            title="Copy 64-bit hash"
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
                  onClick={() => setMode('upload')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'upload' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Direct Video Upload</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setMode('url')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'url' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
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

              {mode === 'upload' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-300">Select Video File (.mp4, .mkv, .mov up to {uploadConfig.maxUploadSizeMB}MB)</label>
                    <span className="text-[10px] text-cyan-400 font-mono">
                      Safe {uploadConfig.uploadChunkSizeMB}MB Chunks
                    </span>
                  </div>
                  <div className="border border-dashed border-slate-800 rounded-lg p-4 bg-slate-950/40 text-center hover:border-slate-700 transition-colors">
                    <input
                      type="file"
                      accept="video/*,.mp4,.mkv,.mov,.webm,.avi,.ts,.m4v"
                      disabled={isSubmitting}
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setFile(f);
                        if (f && f.size > uploadConfig.maxUploadSizeBytes) {
                          setSubmitError(`Selected file exceeds maximum limit of ${uploadConfig.maxUploadSizeMB} MB`);
                        } else {
                          setSubmitError(null);
                        }
                      }}
                      className="hidden"
                      id="video-upload-input"
                    />
                    <label htmlFor="video-upload-input" className="cursor-pointer block space-y-1">
                      <Upload className="w-6 h-6 text-slate-500 mx-auto" />
                      <div className="text-xs text-slate-300">
                        {file ? file.name : 'Click to select reference video file'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {file ? (
                          <span className="text-cyan-400">
                            {(file.size / (1024 * 1024)).toFixed(2)} MB • {Math.ceil(file.size / uploadConfig.chunkSizeBytes)} chunks
                          </span>
                        ) : (
                          `Automatic chunked streaming bypasses reverse proxy limits (up to ${uploadConfig.maxUploadSizeMB}MB)`
                        )}
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

              {/* In-flight Processing Banner with Progress Bar */}
              {isSubmitting && (
                <div className="p-3 bg-cyan-950/30 border border-cyan-800/60 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                      <span className="text-xs font-medium text-cyan-200">
                        {uploadProgress?.phase === 'uploading' 
                          ? `Uploading chunk ${uploadProgress.currentChunk} of ${uploadProgress.totalChunks}`
                          : uploadProgress?.phase === 'assembling'
                          ? 'Assembling chunks and verifying integrity...'
                          : uploadProgress?.phase === 'fingerprinting'
                          ? 'Extracting keyframes & computing 64-bit dHash...'
                          : 'Processing reference media...'}
                      </span>
                    </div>
                    {uploadProgress && (
                      <span className="text-xs font-mono text-cyan-300">
                        {uploadProgress.percent.toFixed(1)}%
                      </span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  {uploadProgress && (
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="bg-cyan-400 h-full transition-all duration-300"
                        style={{ width: `${uploadProgress.percent}%` }}
                      />
                    </div>
                  )}

                  <div className="text-[11px] text-cyan-400/80 font-mono">
                    {uploadProgress?.phase === 'uploading'
                      ? `${(uploadProgress.uploadedBytes / (1024 * 1024)).toFixed(1)} MB / ${(uploadProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB transmitted in safe 5MB chunks`
                      : 'Running temporal sampling, codec probing, and 64-bit dHash computation'}
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
                  disabled={isSubmitting || (file !== null && file.size > uploadConfig.maxUploadSizeBytes)}
                  className="px-4 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded font-sans transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {isSubmitting 
                      ? (uploadProgress?.phase === 'uploading' 
                          ? `Uploading (${uploadProgress?.percent.toFixed(0)}%)...` 
                          : 'Processing Keyframes...') 
                      : 'Register & Fingerprint'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
