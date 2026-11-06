/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Stage A — Reference Content Registration, OTT Metadata Ingestion & Fingerprint Library
 * Equipped with Scalable Chunked Upload Architecture & Approved Provider Integration Workflow
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
  Loader2,
  Copy,
  Check,
  Tv,
  ShieldCheck,
  ExternalLink,
  KeyRound,
  CheckCircle2,
  Clock,
  Search,
  Globe
} from 'lucide-react';
import {
  ReferenceItem,
  ReferenceUrlInspectionResult,
  ExtractionStatus,
  SourceAdapterDescriptor,
  AcquisitionWorkflowReport
} from '../types/client.js';
import { 
  fetchReferenceDetails, 
  registerReference, 
  fetchUploadConfig, 
  fetchProviderIntegrations,
  fetchSourceAdapters,
  updateSourceAdapter,
  uploadChunkedVideoReference,
  attachAuthorizedMediaToReference,
  acquireReferenceMediaFromUrl,
  inspectReferenceUrl,
  transitionReferenceStatus,
  extractReferenceFrames,
  repairReferenceFrames,
  UploadConfig,
  UploadProgress,
  ProviderIntegrationConfig
} from '../api.js';
import { resolveFrameImageUrl, resolveReferenceFrameImageWithFallback } from '../utils/frameResolver.js';

function formatDurationTimestamp(sec?: number): string {
  if (sec === undefined || sec === null || !Number.isFinite(sec) || sec < 0) return '00:00 (0.0s)';
  const mins = Math.floor(sec / 60);
  const remSec = Math.floor(sec % 60);
  const mm = String(mins).padStart(2, '0');
  const ss = String(remSec).padStart(2, '0');
  return `${mm}:${ss} (${sec.toFixed(2)}s)`;
}

function renderAcquisitionWorkflowBanner(workflow?: AcquisitionWorkflowReport | null) {
  if (!workflow || !workflow.stages || workflow.stages.length === 0) return null;
  return (
    <div className="p-3 bg-slate-950/90 border border-slate-800 rounded-lg space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">
          <span>Automated Media Acquisition &amp; Processing Pipeline</span>
        </div>
        {workflow.sourceAdapterName && (
          <span className="px-2 py-0.5 text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-700/60 rounded">
            Adapter: {workflow.sourceAdapterName}
          </span>
        )}
      </div>

      {/* 8-Stage Stepper */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {workflow.stages.map((st, idx) => {
          const isComplete = st.status === 'COMPLETE';
          const isInProgress = st.status === 'IN_PROGRESS';
          const isRestricted = st.status === 'SKIPPED_RESTRICTED' || st.status === 'FAILED';
          return (
            <div
              key={st.stage}
              title={st.detail || st.label}
              className={`p-1.5 rounded border text-[10px] font-mono flex flex-col justify-between ${
                isComplete
                  ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                  : isInProgress
                  ? 'bg-cyan-950/50 border-cyan-500/60 text-cyan-200'
                  : isRestricted
                  ? 'bg-amber-950/40 border-amber-700/60 text-amber-300'
                  : 'bg-slate-900/70 border-slate-800 text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold">#{idx + 1}</span>
                <span className="text-[9px] uppercase px-1 rounded bg-black/40">
                  {st.status === 'SKIPPED_RESTRICTED' ? 'GATED' : st.status}
                </span>
              </div>
              <div className="font-semibold truncate mt-0.5">{st.label}</div>
              {st.detail && (
                <div className="text-[9px] opacity-80 truncate mt-0.5">{st.detail}</div>
              )}
            </div>
          );
        })}
      </div>

      {workflow.attemptedMethods && workflow.attemptedMethods.length > 0 && (
        <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded space-y-1.5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">
            Executed Source-Adapter Acquisition Methods ({workflow.attemptedMethods.length}):
          </div>
          <div className="space-y-1">
            {workflow.attemptedMethods.map((am, i) => (
              <div
                key={`${am.method}-${i}`}
                className="p-1.5 rounded bg-slate-950/90 border border-slate-800/80 flex flex-col gap-0.5 text-[10px] font-mono"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{am.method}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                      am.status === 'SUCCESS'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                        : am.status === 'RESTRICTED'
                        ? 'bg-amber-950 text-amber-300 border border-amber-700/60'
                        : am.status === 'UNAVAILABLE'
                        ? 'bg-slate-900 text-slate-400 border border-slate-700'
                        : 'bg-rose-950 text-rose-300 border border-rose-700/60'
                    }`}
                  >
                    {am.status}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-sans leading-snug">{am.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!workflow.canAutoAcquire && workflow.restrictionReason && (
        <div className="p-2 bg-amber-950/30 border border-amber-800/60 rounded text-[11px] text-amber-200 space-y-1">
          <div className="font-mono text-[10px] uppercase text-amber-300 font-semibold">
            Why Automatic Media Acquisition Is Gated:
          </div>
          <p className="leading-relaxed">{workflow.restrictionReason}</p>
          {workflow.recommendedAlternative && (
            <div className="text-[10px] font-mono text-cyan-300 pt-0.5">
              Recommended Alternative: {workflow.recommendedAlternative}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

function detectOttPlatformFromUrl(url: string): string | null {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('sonyliv.com')) return 'SonyLIV';
  if (lower.includes('hotstar.com')) return 'Disney+ Hotstar';
  if (lower.includes('netflix.com')) return 'Netflix';
  if (lower.includes('jiocinema.com')) return 'JioCinema';
  if (lower.includes('primevideo.com') || lower.includes('amazon.')) return 'Amazon Prime Video';
  if (lower.includes('disneyplus.com')) return 'Disney+';
  if (lower.includes('zee5.com')) return 'ZEE5';
  if (lower.includes('tv.apple.com')) return 'Apple TV+';
  if (lower.includes('hulu.com')) return 'Hulu';
  if (lower.includes('max.com') || lower.includes('hbomax.com')) return 'Max';
  if (lower.includes('peacocktv.com')) return 'Peacock';
  if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) return 'YouTube';
  if (lower.includes('dailymotion.com/') || lower.includes('dai.ly/')) return 'Dailymotion';
  if (lower.includes('vimeo.com/')) return 'Vimeo';
  if (lower.includes('archive.org/')) return 'Internet Archive';
  return null;
}

function isWatchPagePlayerUrl(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    /(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i.test(trimmed) ||
    /dailymotion\.com\/video\/|dai\.ly\//i.test(trimmed) ||
    /vimeo\.com\/(?:video\/)?\d+/i.test(trimmed)
  );
}

export const ReferenceLibraryView: React.FC<ReferenceLibraryViewProps> = ({
  references,
  onRefresh,
  onDelete,
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
  const [showProvidersPanel, setShowProvidersPanel] = useState(false);
  const [providers, setProviders] = useState<ProviderIntegrationConfig[]>([]);
  const [sourceAdapters, setSourceAdapters] = useState<SourceAdapterDescriptor[]>([]);
  const [inspectorWorkflow, setInspectorWorkflow] = useState<AcquisitionWorkflowReport | null>(null);
  const [isAcquiringFromSourceUrl, setIsAcquiringFromSourceUrl] = useState(false);

  // Upload configuration
  const [uploadConfig, setUploadConfig] = useState<UploadConfig>({
    maxUploadSizeMB: 500,
    maxUploadSizeBytes: 500 * 1024 * 1024,
    uploadChunkSizeMB: 5,
    chunkSizeBytes: 5 * 1024 * 1024,
    allowedExtensions: ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.ts', '.m4v'],
    mode: 'chunked'
  });

  // Register / Attach Master Modal Form state
  const [mode, setMode] = useState<'upload' | 'ott' | 'url'>('upload');
  const [replaceReferenceId, setReplaceReferenceId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [rightsHolder, setRightsHolder] = useState('');
  const [assetType, setAssetType] = useState('VOD_FEATURE');
  const [platform, setPlatform] = useState('');
  const [seasonEpisodeInfo, setSeasonEpisodeInfo] = useState('');
  const [ottInitialStatus, setOttInitialStatus] = useState<'AWAITING_AUTHORIZED_MEDIA' | 'METADATA_REGISTERED'>('AWAITING_AUTHORIZED_MEDIA');
  const [sourceUrl, setSourceUrl] = useState('');
  const [authorizedMezzanineUrl, setAuthorizedMezzanineUrl] = useState('');
  const [referenceWebpageUrl, setReferenceWebpageUrl] = useState('');
  const [urlInspection, setUrlInspection] = useState<ReferenceUrlInspectionResult | null>(null);
  const [isInspectingUrl, setIsInspectingUrl] = useState(false);
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(true);
  const [authorizationProvenance, setAuthorizationProvenance] = useState('RIGHTS_HOLDER_DIRECT_AUTHORIZATION');
  const [sampleInterval, setSampleInterval] = useState('2');
  const [sampleIntervalMode, setSampleIntervalMode] = useState<'1' | '2' | '5' | 'custom'>('2');
  const [customSampleInterval, setCustomSampleInterval] = useState('3');
  const [auditNotes, setAuditNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  // Inspector Drawer: Re-extraction & Full-Video Timeline Browser state
  const [inspectorIntervalMode, setInspectorIntervalMode] = useState<'1' | '2' | '5' | 'custom'>('2');
  const [inspectorCustomInterval, setInspectorCustomInterval] = useState('3');
  const [isExtractingFrames, setIsExtractingFrames] = useState(false);
  const [isRepairingFrames, setIsRepairingFrames] = useState(false);
  const [fallbackTriedThumbnails, setFallbackTriedThumbnails] = useState<Record<string, boolean>>({});
  const [extractionFeedback, setExtractionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [framePage, setFramePage] = useState(1);
  const [framesPerPage, setFramesPerPage] = useState<number>(60);
  const [timestampSearchSec, setTimestampSearchSec] = useState<string>('');

  useEffect(() => {
    fetchUploadConfig().then(cfg => {
      if (cfg) setUploadConfig(cfg);
    }).catch(err => console.warn('Using default upload config:', err));

    fetchProviderIntegrations().then(list => {
      if (list && list.length > 0) setProviders(list);
    }).catch(() => {});

    fetchSourceAdapters().then(list => {
      if (list && list.length > 0) setSourceAdapters(list);
    }).catch(() => {});
  }, []);

  const handleOpenDetails = async (ref: ReferenceItem) => {
    setIsLoadingDetails(true);
    setSelectedRef(ref);
    setFramePage(1);
    setTimestampSearchSec('');
    setExtractionFeedback(null);
    if ((ref as any)?.workflow) {
      setInspectorWorkflow((ref as any).workflow);
    } else {
      setInspectorWorkflow(null);
    }
    setFailedThumbnails(prev => {
      const next = { ...prev };
      delete next[ref.id];
      return {};
    });
    setFallbackTriedThumbnails({});
    const interval = ref.sample_interval_sec || 2;
    if (interval === 1 || interval === 2 || interval === 5) {
      setInspectorIntervalMode(String(interval) as '1' | '2' | '5');
    } else {
      setInspectorIntervalMode('custom');
      setInspectorCustomInterval(String(interval));
    }
    try {
      const full = await fetchReferenceDetails(ref.id);
      setSelectedRef(full);
    } catch (err: any) {
      console.error('Failed to load reference details:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleRepairReferenceFrames = async (ref: ReferenceItem) => {
    setIsRepairingFrames(true);
    setExtractionFeedback(null);
    setFailedThumbnails({});
    setFallbackTriedThumbnails({});
    try {
      const result = await repairReferenceFrames(ref.id);
      if (result.data) {
        setSelectedRef(result.data);
      } else {
        const refreshed = await fetchReferenceDetails(ref.id);
        setSelectedRef(refreshed);
      }
      onRefresh();
      const audit = result.audit;
      if (audit) {
        const totalRepaired =
          (audit.repaired_from_base64_count || 0) +
          (audit.repaired_from_sibling_batch_count || 0) +
          (audit.regenerated_from_source_video_count || 0);
        setExtractionFeedback({
          type: audit.missing_frame_image_count === 0 ? 'success' : 'error',
          message:
            audit.missing_frame_image_count === 0
              ? `Frame integrity verified: ${audit.retrievable_frame_image_count}/${audit.indexed_frame_count} frame images retrievable (${totalRepaired} repaired).`
              : `Integrity check completed: ${audit.retrievable_frame_image_count}/${audit.indexed_frame_count} frame images retrievable (${audit.missing_frame_image_count} missing — attach original source video to regenerate missing frames without fabricating data).`
        });
      }
    } catch (err: any) {
      setExtractionFeedback({
        type: 'error',
        message: err.message || 'Frame repair failed'
      });
    } finally {
      setIsRepairingFrames(false);
    }
  };

  const handleRunReferenceExtraction = async (ref: ReferenceItem, resume: boolean) => {
    setIsExtractingFrames(true);
    setExtractionFeedback(null);
    setFailedThumbnails({});
    setFallbackTriedThumbnails({});
    const chosenInterval =
      inspectorIntervalMode === 'custom'
        ? Math.max(0.25, parseFloat(inspectorCustomInterval) || 2)
        : parseFloat(inspectorIntervalMode) || 2;
    try {
      const result = await extractReferenceFrames(ref.id, {
        sampleInterval: resume ? (ref.sample_interval_sec || chosenInterval) : chosenInterval,
        resume
      });
      if (result.data) {
        setSelectedRef(result.data);
      } else {
        const refreshed = await fetchReferenceDetails(ref.id);
        setSelectedRef(refreshed);
      }
      setFramePage(1);
      onRefresh();
      setExtractionFeedback({
        type: 'success',
        message: `Full-video frame extraction ${resume ? 'resumed and ' : ''}completed: ${result.fingerprintsExtracted ?? result.extractedFrameCount ?? 0} / ${result.expectedFrameCount ?? 0} frames persisted (${result.extractionStatus}).`
      });
    } catch (err: any) {
      setExtractionFeedback({
        type: 'error',
        message: err.message || 'Frame extraction failed'
      });
      try {
        const refreshed = await fetchReferenceDetails(ref.id);
        setSelectedRef(refreshed);
      } catch {}
    } finally {
      setIsExtractingFrames(false);
    }
  };

  const handleOpenAttachMaster = (ref: ReferenceItem) => {
    setReplaceReferenceId(ref.id);
    setMode('upload');
    setTitle(ref.title);
    setRightsHolder(ref.rights_holder);
    setAssetType(ref.asset_type || 'VOD_FEATURE');
    setPlatform(ref.platform || detectOttPlatformFromUrl(ref.source_url || '') || '');
    setSeasonEpisodeInfo(ref.season_episode_info || '');
    setSourceUrl(ref.source_url || '');
    setAuthorizedMezzanineUrl('');
    setReferenceWebpageUrl(ref.source_url || '');
    setUrlInspection(null);
    setAuthorizationConfirmed(true);
    setAuthorizationProvenance('RIGHTS_HOLDER_DIRECT_AUTHORIZATION');
    setFile(null);
    setAuditNotes(
      ref.status === 'INVALID'
        ? `Validated source replacement for ${ref.id}`
        : `Authorized reference master attached for ${ref.platform || ref.title}`
    );
    setSubmitError(null);
    setUploadProgress(null);
    setSelectedRef(null);
    onOpenRegisterModal();
  };

  const handleOpenNewRegister = () => {
    setReplaceReferenceId(undefined);
    setMode('upload');
    setTitle('');
    setRightsHolder('');
    setAssetType('VOD_FEATURE');
    setPlatform('');
    setSeasonEpisodeInfo('');
    setOttInitialStatus('AWAITING_AUTHORIZED_MEDIA');
    setSourceUrl('');
    setAuthorizedMezzanineUrl('');
    setReferenceWebpageUrl('');
    setUrlInspection(null);
    setAuthorizationConfirmed(true);
    setAuthorizationProvenance('RIGHTS_HOLDER_DIRECT_AUTHORIZATION');
    setFile(null);
    setAuditNotes('');
    setSubmitError(null);
    setUploadProgress(null);
    onOpenRegisterModal();
  };

  const handleInspectUrlAvailability = async (targetUrl?: string): Promise<ReferenceUrlInspectionResult | null> => {
    const urlToInspect = (targetUrl ?? referenceWebpageUrl ?? authorizedMezzanineUrl ?? sourceUrl).trim();
    if (!urlToInspect) {
      setSubmitError('Please enter a webpage URL or direct media URL to inspect for media availability.');
      return null;
    }
    setSubmitError(null);
    setIsInspectingUrl(true);
    try {
      const { inspection, reference } = await inspectReferenceUrl(urlToInspect, replaceReferenceId);
      setUrlInspection(inspection);
      const resolvedPlat = inspection.videoIdentity?.platform || inspection.platform;
      if (resolvedPlat && !platform) {
        setPlatform(resolvedPlat);
      }
      const resolvedSe = inspection.videoIdentity?.seasonEpisodeInfo || inspection.seasonEpisodeInfo;
      if (resolvedSe && !seasonEpisodeInfo) {
        setSeasonEpisodeInfo(resolvedSe);
      }
      const resolvedTitle = inspection.videoIdentity?.title || inspection.pageTitle;
      if (resolvedTitle && !title) {
        setTitle(resolvedTitle);
      }
      if (inspection.videoIdentity?.rightsHolderOrAuthor && !rightsHolder) {
        setRightsHolder(inspection.videoIdentity.rightsHolderOrAuthor);
      }
      if (reference) {
        onRefresh();
      }
      return inspection;
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to inspect URL media availability');
      return null;
    } finally {
      setIsInspectingUrl(false);
    }
  };

  const handleAutoAcquireMediaFromUrl = async (ref: ReferenceItem) => {
    if (!ref.source_url) return;
    setIsAcquiringFromSourceUrl(true);
    setExtractionFeedback(null);
    setInspectorWorkflow(null);
    const chosenInterval =
      inspectorIntervalMode === 'custom'
        ? Math.max(0.25, parseFloat(inspectorCustomInterval) || 2)
        : parseFloat(inspectorIntervalMode) || 2;
    try {
      const res = await acquireReferenceMediaFromUrl(ref.id, {
        sampleInterval: ref.sample_interval_sec || chosenInterval,
        authorizationConfirmed: true
      });
      if (res.workflow) {
        setInspectorWorkflow(res.workflow);
      }
      if (res.reference) {
        setSelectedRef(res.reference);
      } else {
        const refreshed = await fetchReferenceDetails(ref.id);
        setSelectedRef(refreshed);
      }
      onRefresh();
      setExtractionFeedback({
        type: 'success',
        message:
          res.message ||
          `Automatic media acquisition and full-video frame extraction completed (${res.reference?.extracted_frame_count ?? 0}/${res.reference?.expected_frame_count ?? 0} frames verified).`
      });
    } catch (err: any) {
      if (err?.workflow) {
        setInspectorWorkflow(err.workflow);
      }
      if (err?.reference) {
        setSelectedRef(err.reference);
      }
      setExtractionFeedback({
        type: 'error',
        message: err.message || 'Automatic media acquisition unavailable for this URL.'
      });
      onRefresh();
    } finally {
      setIsAcquiringFromSourceUrl(false);
    }
  };

  const handleToggleSourceAdapter = async (adapter: SourceAdapterDescriptor) => {
    try {
      const updated = await updateSourceAdapter(adapter.id, { enabled: !adapter.enabled });
      setSourceAdapters(prev => prev.map(a => (a.id === updated.id ? updated : a)));
    } catch (err) {
      console.error('Failed to update source adapter:', err);
    }
  };

  const handleToggleMetadataState = async (ref: ReferenceItem) => {
    const nextStatus =
      ref.status === 'METADATA_REGISTERED' ? 'AWAITING_AUTHORIZED_MEDIA' : 'METADATA_REGISTERED';
    try {
      const updated = await transitionReferenceStatus(ref.id, { status: nextStatus });
      if (selectedRef && selectedRef.id === ref.id) {
        setSelectedRef(updated);
      }
      onRefresh();
    } catch (err: any) {
      console.error('Failed to transition status:', err);
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

      // Case 1: Uploading a local master file or attaching authorized URL/Webpage media to an existing reference
      if (mode === 'upload' || (mode === 'ott' && file)) {
        const candidateAttachUrl = (authorizedMezzanineUrl.trim() || referenceWebpageUrl.trim() || sourceUrl.trim());
        if (!file && !candidateAttachUrl) {
          throw new Error('Please select an authorized reference master video file (.mp4, .mkv, .mov), provide an approved mezzanine stream URL, or submit a reference webpage URL.');
        }

        if (file) {
          if (file.size > uploadConfig.maxUploadSizeBytes) {
            throw new Error(
              `File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${uploadConfig.maxUploadSizeMB} MB`
            );
          }

          createdItem = await uploadChunkedVideoReference(
            file,
            {
              title: title.trim(),
              rightsHolder: rightsHolder.trim(),
              assetType,
              platform: platform.trim() || detectOttPlatformFromUrl(sourceUrl) || undefined,
              seasonEpisodeInfo: seasonEpisodeInfo.trim() || undefined,
              sourceUrl: sourceUrl.trim() || undefined,
              sampleInterval,
              auditNotes: auditNotes.trim() || undefined,
              replaceReferenceId
            },
            (progress) => {
              setUploadProgress(progress);
            }
          );
        } else if (replaceReferenceId && candidateAttachUrl) {
          createdItem = await attachAuthorizedMediaToReference(replaceReferenceId, {
            authorizedMediaUrl: authorizedMezzanineUrl.trim() || undefined,
            referenceWebpageUrl: (referenceWebpageUrl.trim() || sourceUrl.trim()) || undefined,
            authorizationConfirmed,
            authorizationProvenance,
            sampleInterval: parseFloat(sampleInterval) || 2.0,
            platform: platform.trim() || undefined,
            seasonEpisodeInfo: seasonEpisodeInfo.trim() || undefined,
            notes: auditNotes.trim() || undefined
          });
        } else if (candidateAttachUrl) {
          const resolvedPlat =
            platform.trim() ||
            urlInspection?.platform ||
            urlInspection?.detectedPlayerProvider ||
            detectOttPlatformFromUrl(candidateAttachUrl) ||
            undefined;
          const resolvedSeasonEp =
            seasonEpisodeInfo.trim() ||
            urlInspection?.seasonEpisodeInfo ||
            undefined;
          const payload = {
            registrationMode: 'upload',
            title: title.trim(),
            rightsHolder: rightsHolder.trim(),
            rights_holder: rightsHolder.trim(),
            assetType,
            asset_type: assetType,
            platform: resolvedPlat,
            seasonEpisodeInfo: resolvedSeasonEp,
            season_episode_info: resolvedSeasonEp,
            initialStatus: urlInspection && !urlInspection.canAcquireAuthorized ? ottInitialStatus : undefined,
            requireDirectMedia: !urlInspection || Boolean(urlInspection.canAcquireAuthorized),
            allowMetadataFallback: Boolean(
              urlInspection &&
                !urlInspection.canAcquireAuthorized &&
                urlInspection.isWebpage &&
                urlInspection.urlClassification !== 'UNREACHABLE'
            ),
            sourceUrl: candidateAttachUrl,
            source_url: candidateAttachUrl,
            authorizedMasterUrl: authorizedMezzanineUrl.trim() || undefined,
            authorizationConfirmed,
            authorizationProvenance,
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
      } else if (mode === 'ott') {
        // Case 2: OTT Platform Webpage / Catalog Metadata Registration (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video, YouTube Watch Page, etc.)
        if (!sourceUrl || !sourceUrl.trim()) {
          throw new Error('Please enter the OTT or embedded player webpage URL (e.g. SonyLIV, Hotstar, Netflix, JioCinema, Prime Video, YouTube)');
        }
        const trimmedOttUrl = sourceUrl.trim();
        let activeInspection = urlInspection;
        if (!activeInspection && (!title.trim() || !rightsHolder.trim())) {
          activeInspection = await handleInspectUrlAvailability(trimmedOttUrl);
        }
        const detectedPlat =
          platform.trim() ||
          activeInspection?.videoIdentity?.platform ||
          activeInspection?.platform ||
          activeInspection?.detectedPlayerProvider ||
          detectOttPlatformFromUrl(trimmedOttUrl) ||
          'OTT Streaming Platform';
        const resolvedSeasonEp =
          seasonEpisodeInfo.trim() ||
          activeInspection?.videoIdentity?.seasonEpisodeInfo ||
          activeInspection?.seasonEpisodeInfo ||
          undefined;
        const resolvedTitle =
          title.trim() ||
          activeInspection?.videoIdentity?.title ||
          activeInspection?.pageTitle ||
          `${detectedPlat} Reference`;
        const resolvedRights =
          rightsHolder.trim() ||
          activeInspection?.videoIdentity?.rightsHolderOrAuthor ||
          (activeInspection?.videoIdentity as any)?.authorOrRightsHolder ||
          detectedPlat ||
          'Proprietary';
        const payload = {
          registrationMode: 'ott',
          title: resolvedTitle,
          rightsHolder: resolvedRights,
          rights_holder: resolvedRights,
          assetType,
          asset_type: assetType,
          platform: detectedPlat,
          seasonEpisodeInfo: resolvedSeasonEp,
          season_episode_info: resolvedSeasonEp,
          initialStatus: ottInitialStatus,
          sourceUrl: trimmedOttUrl,
          source_url: trimmedOttUrl,
          authorizedMasterUrl: authorizedMezzanineUrl.trim() || undefined,
          sampleInterval: parseFloat(sampleInterval),
          sample_interval_sec: parseFloat(sampleInterval),
          auditNotes: auditNotes.trim() || undefined,
          notes: auditNotes.trim() || undefined,
          replaceReferenceId
        };
        if (onRegisterUrl && !replaceReferenceId) {
          const res: any = await onRegisterUrl(payload);
          createdItem = res && res.id ? res : (res && res.data ? res.data : null);
        } else {
          const res: any = await registerReference(payload);
          createdItem = res && res.id ? res : (res && res.data ? res.data : null);
        }
      } else {
        // Case 3: Direct Stream URL (.m3u8, .mp4, .mpd) or Supported Video Platform URL (YouTube, Dailymotion, Vimeo, Archive.org, Wikimedia)
        if (!sourceUrl || !sourceUrl.trim()) {
          throw new Error('Please enter a valid direct media stream (.mp4, .m3u8, .mpd) or video platform URL');
        }
        const trimmedUrl = sourceUrl.trim();
        let activeInspection = urlInspection;
        if (!activeInspection && (isWatchPagePlayerUrl(trimmedUrl) || !title.trim() || !rightsHolder.trim())) {
          activeInspection = await handleInspectUrlAvailability(trimmedUrl);
        }
        if (
          activeInspection &&
          (activeInspection.urlClassification === 'UNREACHABLE' ||
            activeInspection.urlClassification === 'SSRF_REJECTED' ||
            activeInspection.urlClassification === 'TORRENT_OR_UNSUPPORTED')
        ) {
          throw new Error(activeInspection.reason || 'Submitted URL is unreachable or rejected by security policy.');
        }

        if (replaceReferenceId) {
          createdItem = await attachAuthorizedMediaToReference(replaceReferenceId, {
            authorizedMediaUrl: trimmedUrl,
            referenceWebpageUrl: referenceWebpageUrl.trim() || undefined,
            authorizationConfirmed,
            authorizationProvenance,
            sampleInterval: parseFloat(sampleInterval) || 2.0,
            platform: platform.trim() || undefined,
            seasonEpisodeInfo: seasonEpisodeInfo.trim() || undefined,
            notes: auditNotes.trim() || undefined
          });
        } else {
          const resolvedPlat =
            platform.trim() ||
            activeInspection?.videoIdentity?.platform ||
            activeInspection?.platform ||
            activeInspection?.detectedPlayerProvider ||
            detectOttPlatformFromUrl(trimmedUrl) ||
            undefined;
          const resolvedSeasonEp =
            seasonEpisodeInfo.trim() ||
            activeInspection?.videoIdentity?.seasonEpisodeInfo ||
            activeInspection?.seasonEpisodeInfo ||
            undefined;
          const allowMetadataFallback = Boolean(
            activeInspection &&
              !activeInspection.canAcquireAuthorized &&
              activeInspection.isWebpage &&
              activeInspection.urlClassification !== 'UNREACHABLE'
          );
          const resolvedTitle =
            title.trim() ||
            activeInspection?.videoIdentity?.title ||
            activeInspection?.pageTitle ||
            (resolvedPlat ? `${resolvedPlat} Video Reference` : 'Registered Video Reference');
          const resolvedRights =
            rightsHolder.trim() ||
            activeInspection?.videoIdentity?.rightsHolderOrAuthor ||
            (activeInspection?.videoIdentity as any)?.authorOrRightsHolder ||
            resolvedPlat ||
            'Proprietary';
          const payload = {
            registrationMode: 'url',
            requireDirectMedia: !allowMetadataFallback,
            allowMetadataFallback,
            title: resolvedTitle,
            rightsHolder: resolvedRights,
            rights_holder: resolvedRights,
            assetType,
            asset_type: assetType,
            platform: resolvedPlat,
            seasonEpisodeInfo: resolvedSeasonEp,
            season_episode_info: resolvedSeasonEp,
            initialStatus: allowMetadataFallback ? ottInitialStatus : undefined,
            sourceUrl: trimmedUrl,
            source_url: trimmedUrl,
            authorizationConfirmed,
            authorizationProvenance,
            sampleInterval: parseFloat(sampleInterval),
            sample_interval_sec: parseFloat(sampleInterval),
            auditNotes: auditNotes.trim() || undefined,
            notes: auditNotes.trim() || undefined,
            replaceReferenceId
          };
          if (onRegisterUrl) {
            const res: any = await onRegisterUrl(payload);
            createdItem = res && res.id ? res : (res && res.data ? res.data : null);
          } else {
            const res: any = await registerReference(payload);
            createdItem = res && res.id ? res : (res && res.data ? res.data : null);
          }
        }
      }

      // Reset form on success
      setReplaceReferenceId(undefined);
      setTitle('');
      setRightsHolder('');
      setPlatform('');
      setSeasonEpisodeInfo('');
      setSourceUrl('');
      setAuthorizedMezzanineUrl('');
      setReferenceWebpageUrl('');
      setUrlInspection(null);
      setFile(null);
      setAuditNotes('');
      setUploadProgress(null);
      onCloseRegisterModal();
      onRefresh();

      if (createdItem && createdItem.id) {
        handleOpenDetails(createdItem);
      }
    } catch (err: any) {
      if (err?.inspection) {
        setUrlInspection(err.inspection);
        if (err.inspection.platform && !platform) {
          setPlatform(err.inspection.platform);
        }
        if (err.inspection.seasonEpisodeInfo && !seasonEpisodeInfo) {
          setSeasonEpisodeInfo(err.inspection.seasonEpisodeInfo);
        }
        if (err.inspection.pageTitle && !title) {
          setTitle(err.inspection.pageTitle);
        }
      }
      onRefresh();
      setSubmitError(err.message || 'Reference registration failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredReferences = references.filter(r => {
    if (filterType === 'ALL') return true;
    return r.asset_type === filterType;
  });

  const getStatusBadgeClasses = (status: ReferenceItem['status'], ref?: ReferenceItem) => {
    if (status === 'INVALID' || status === 'FAILED') {
      return 'bg-rose-950/90 text-rose-300 border-rose-500/50';
    }
    if (
      status === 'AWAITING_AUTHORIZED_MEDIA' ||
      status === 'METADATA_REGISTERED' ||
      status === 'PROCESSING' ||
      ref?.extraction_status === 'PARTIAL' ||
      (ref?.missing_frame_image_count || 0) > 0
    ) {
      return 'bg-amber-950/90 text-amber-300 border-amber-500/50';
    }
    return 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40';
  };

  const getExtractionStatusBadge = (status?: ExtractionStatus) => {
    switch (status) {
      case 'COMPLETE':
        return { label: 'COMPLETE (100%)', classes: 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50' };
      case 'PARTIAL':
        return { label: 'PARTIAL (RESUMABLE)', classes: 'bg-amber-950/90 text-amber-300 border-amber-500/50' };
      case 'EXTRACTING':
        return { label: 'EXTRACTING...', classes: 'bg-cyan-950/90 text-cyan-300 border-cyan-500/50' };
      case 'FAILED':
        return { label: 'EXTRACTION FAILED', classes: 'bg-rose-950/90 text-rose-300 border-rose-500/50' };
      default:
        return { label: 'QUEUED / PENDING', classes: 'bg-slate-900 text-slate-400 border-slate-700' };
    }
  };

  const getDisplayStatusLabel = (status: ReferenceItem['status'], ref?: ReferenceItem) => {
    if (status === 'PROCESSING' || ref?.extraction_status === 'PARTIAL' || (ref?.missing_frame_image_count || 0) > 0) {
      return 'PARTIAL PROCESSING';
    }
    if (status === 'REGISTERED') return 'FINGERPRINTED';
    return status;
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Reference Content Library</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Ground-truth media assets &amp; OTT catalog references (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video) with 64-bit dHash perceptual fingerprints
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            onClick={() => setShowProvidersPanel(prev => !prev)}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <Tv className="w-3.5 h-3.5 text-cyan-400" />
            <span>Source Adapters &amp; OTT Integrations</span>
          </button>

          <button
            onClick={handleOpenNewRegister}
            className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded font-sans transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-sm shadow-cyan-950"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Register Reference / OTT Asset</span>
          </button>
        </div>
      </div>

      {/* Collapsible Source-Adapter System & OTT Content-Provider Integrations Matrix */}
      {showProvidersPanel && (
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-lg space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cyan-400 font-mono">
                Configurable Multi-Platform Source Adapters &amp; OTT Ingestion Matrix
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                SPECTRA identifies the source platform, inspects accessible metadata, and automatically acquires and processes video wherever access and authorization permit (supporting resumable HTTP Range downloads, FFprobe validation, and SHA-256 deduplication). Protected DRM webpages register as <span className="font-mono text-amber-300">METADATA_REGISTERED</span> or <span className="font-mono text-amber-300">AWAITING_AUTHORIZED_MEDIA</span>.
              </p>
            </div>
            <button
              onClick={() => setShowProvidersPanel(false)}
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {sourceAdapters.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-300 font-semibold">
                Active Source-Adapter Registry (8 Supported Source Categories)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {sourceAdapters.map(adapter => (
                  <div
                    key={adapter.id}
                    className="p-2.5 bg-slate-950/90 border border-slate-800 rounded space-y-1.5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-white truncate">{adapter.name}</span>
                        <button
                          type="button"
                          onClick={() => handleToggleSourceAdapter(adapter)}
                          className={`px-1.5 py-0.5 text-[9px] font-mono rounded border cursor-pointer shrink-0 ${
                            adapter.enabled
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-700/60'
                              : 'bg-slate-900 text-slate-400 border-slate-700'
                          }`}
                        >
                          {adapter.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <span
                          className={`px-1.5 py-0.2 text-[9px] font-mono rounded ${
                            adapter.acquisitionCapability === 'AUTOMATIC_WHEN_PERMITTED'
                              ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                              : adapter.acquisitionCapability === 'CONDITIONAL_AUTHORIZED'
                              ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/60'
                              : 'bg-amber-950/70 text-amber-300 border border-amber-800/60'
                          }`}
                        >
                          {adapter.acquisitionCapability}
                        </span>
                        {adapter.supportsResumableDownload && (
                          <span className="px-1.5 py-0.2 text-[9px] font-mono bg-slate-900 text-slate-300 border border-slate-800 rounded">
                            Resumable HTTP Range
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed mt-1">{adapter.description}</p>
                    </div>
                    <div className="pt-1 border-t border-slate-900 text-[9px] font-mono text-slate-500 truncate">
                      Formats: {adapter.supportedProtocols.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 font-semibold">
              OTT Broadcaster Partner Feed Integrations
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {providers.map(p => (
                <div
                  key={p.id}
                  className="p-2.5 bg-slate-950/80 border border-slate-800/80 rounded space-y-1.5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-white truncate">{p.platform}</span>
                      {p.status === 'IMPLEMENTED_ACTIVE' ? (
                        <span className="px-1.5 py-0.5 text-[9px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-700/60 rounded shrink-0">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[9px] font-mono bg-amber-950 text-amber-300 border border-amber-700/60 rounded shrink-0">
                          AWAITING CREDENTIALS / MASTER
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-300 font-medium mt-0.5">{p.name}</div>
                    <p className="text-[10px] text-slate-400 leading-relaxed mt-1">{p.description}</p>
                  </div>
                  {p.envVar && (
                    <div className="pt-1 border-t border-slate-900 flex items-center gap-1 text-[10px] font-mono text-slate-500">
                      <KeyRound className="w-3 h-3 text-amber-400/80 shrink-0" />
                      <span>Env: {p.envVar}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* References Grid / Cards */}
      {filteredReferences.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-slate-800 rounded-lg bg-slate-900/30">
          <Film className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-300">No reference media registered</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Upload reference video masters (.mp4, .mkv, .mov), register OTT catalog URLs (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video), or connect authorized stream URLs.
          </p>
          <button
            onClick={handleOpenNewRegister}
            className="mt-4 px-3 py-1.5 text-xs font-medium text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 rounded hover:bg-cyan-900/40 transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Register First Reference</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredReferences.map(ref => {
            const isInvalid = ref.status === 'INVALID';
            const isAwaitingMedia =
              ref.status === 'AWAITING_AUTHORIZED_MEDIA' || ref.status === 'METADATA_REGISTERED';
            const isIncompleteProcessing =
              !isInvalid &&
              !isAwaitingMedia &&
              (ref.status === 'PROCESSING' ||
                ref.extraction_status === 'PARTIAL' ||
                (ref.missing_frame_image_count || 0) > 0);
            const isFingerprinted =
              (ref.status === 'FINGERPRINTED' || ref.status === 'REGISTERED' || ref.status === 'PROCESSING') &&
              (ref.fingerprint_count || 0) > 0;

            return (
              <div 
                key={ref.id}
                className={`group bg-slate-900/80 border rounded-lg overflow-hidden transition-all flex flex-col ${
                  isInvalid
                    ? 'border-rose-800/70 hover:border-rose-700'
                    : isAwaitingMedia || isIncompleteProcessing
                    ? 'border-amber-700/60 hover:border-amber-600'
                    : 'border-slate-800/80 hover:border-slate-700'
                }`}
              >
                {/* Thumbnail Header with Metadata Overlay */}
                <div className="relative aspect-video bg-slate-950 flex items-center justify-center overflow-hidden border-b border-slate-800/60">
                  {(() => {
                    if (isInvalid) {
                      return (
                        <div className="w-full h-full flex flex-col items-center justify-center text-center p-4 bg-rose-950/20">
                          <AlertCircle className="w-7 h-7 text-rose-400 mb-1.5 shrink-0" />
                          <span className="text-xs font-semibold text-rose-300 uppercase tracking-wide">
                            INVALID SOURCE VIDEO
                          </span>
                          <span className="text-[11px] text-rose-200/80 mt-1 max-w-xs leading-snug">
                            Source file contains synthetic FFmpeg colour bars / test pattern. Valid source video required.
                          </span>
                        </div>
                      );
                    }
                    if (isAwaitingMedia) {
                      return (
                        <div className="w-full h-full flex flex-col items-center justify-center text-center p-4 bg-amber-950/15">
                          <Tv className="w-7 h-7 text-amber-400 mb-1.5 shrink-0" />
                          <span className="text-xs font-semibold text-amber-300 uppercase tracking-wide">
                            {ref.platform ? `${ref.platform} OTT Reference` : 'OTT Metadata Registered'}
                          </span>
                          <span className="text-[11px] text-slate-300 mt-1 max-w-xs leading-snug">
                            {ref.status === 'METADATA_REGISTERED'
                              ? 'Catalog metadata registered for Discovery Sweeps. Attach authorized master file for frame matching.'
                              : 'Protected OTT player URL preserved. Awaiting authorized master video file or partner feed for fingerprinting.'}
                          </span>
                        </div>
                      );
                    }
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
                  
                  <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1.5 max-w-[75%]">
                    <span className="px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase bg-slate-950/80 backdrop-blur-md text-cyan-300 border border-cyan-500/30 rounded">
                      {ref.asset_type.replace('_', ' ')}
                    </span>
                    {ref.platform && (
                      <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-950/90 backdrop-blur-md text-white border border-slate-700 rounded">
                        {ref.platform}
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded border backdrop-blur-md ${getStatusBadgeClasses(ref.status, ref)}`}
                    >
                      {getDisplayStatusLabel(ref.status, ref)}
                    </span>
                  </div>

                  <div className="absolute top-2 right-2">
                    <span className="px-2 py-0.5 text-[10px] font-mono bg-slate-950/80 backdrop-blur-md text-slate-300 border border-slate-800 rounded">
                      {isAwaitingMedia ? 'OTT Catalog' : `${ref.resolution || '1080p'} • ${ref.fps ? `${ref.fps} fps` : '24 fps'}`}
                    </span>
                  </div>

                  <div className="absolute bottom-2 right-2">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-mono rounded flex items-center gap-1 border ${
                        isInvalid
                          ? 'bg-rose-950/90 text-rose-300 border-rose-800/80'
                          : isAwaitingMedia
                          ? 'bg-amber-950/90 text-amber-300 border-amber-800/80'
                          : (ref.missing_frame_image_count || 0) > 0
                          ? 'bg-amber-950/90 text-amber-300 border-amber-700/80'
                          : 'bg-cyan-950/90 text-cyan-300 border-cyan-800/80'
                      }`}
                    >
                      <Film className="w-2.5 h-2.5" />
                      {isInvalid
                        ? '0 Valid Keyframes'
                        : isAwaitingMedia
                        ? '0 Keyframes (Discovery Ready)'
                        : `${ref.extracted_frame_count ?? ref.fingerprint_count ?? 0} Hashes • ${
                            ref.retrievable_frame_image_count ?? ref.extracted_frame_count ?? ref.fingerprint_count ?? 0
                          }/${ref.extracted_frame_count ?? ref.fingerprint_count ?? 0} JPEGs`}
                    </span>
                  </div>
                </div>

                {/* Body */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white truncate" title={ref.title}>
                      {ref.title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-slate-400">
                      <span>{ref.rights_holder}</span>
                      <span>•</span>
                      <span className="font-mono text-[11px]">{ref.platform || ref.source_type}</span>
                      {ref.season_episode_info && (
                        <>
                          <span>•</span>
                          <span className="px-1.5 py-0.2 bg-slate-800 text-cyan-300 rounded text-[10px] font-mono">
                            {ref.season_episode_info}
                          </span>
                        </>
                      )}
                    </div>
                    {ref.source_url && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-mono text-cyan-400/90 truncate">
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <a
                          href={ref.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:underline"
                          title={ref.source_url}
                        >
                          {ref.source_url}
                        </a>
                      </div>
                    )}
                  </div>

                  {isInvalid ? (
                    <div className="p-2.5 bg-rose-950/30 border border-rose-800/60 rounded text-[11px] text-rose-200 space-y-1">
                      <div className="font-mono text-[10px] uppercase text-rose-400 font-semibold">
                        Validation Diagnostic: Status = INVALID
                      </div>
                      <p className="text-[11px] text-rose-200/90 leading-relaxed line-clamp-3" title={ref.notes}>
                        {ref.notes || 'Source video contains synthetic test patterns / colour bars and was rejected. Upload a valid video master.'}
                      </p>
                    </div>
                  ) : isAwaitingMedia ? (
                    <div className="p-2.5 bg-amber-950/25 border border-amber-800/50 rounded text-[11px] text-amber-100 space-y-1">
                      <div className="font-mono text-[10px] uppercase text-amber-400 font-semibold flex items-center justify-between">
                        <span>OTT Workflow: {ref.status}</span>
                        <span className="text-cyan-300">Discovery Enabled</span>
                      </div>
                      <p className="text-[11px] text-amber-200/90 leading-relaxed line-clamp-3" title={ref.notes}>
                        {ref.notes || 'OTT webpage metadata registered. Frame matching is gated until an authorized reference master video is attached.'}
                      </p>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-slate-950/70 border border-slate-800/70 rounded text-[11px] font-mono space-y-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400 uppercase">Full-Duration Frame Coverage</span>
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${
                            (ref.missing_frame_image_count || 0) > 0
                              ? 'bg-amber-950/70 text-amber-300 border-amber-700/70'
                              : getExtractionStatusBadge(ref.extraction_status).classes
                          }`}
                        >
                          {(ref.missing_frame_image_count || 0) > 0
                            ? `${ref.retrievable_frame_image_count ?? 0}/${ref.extracted_frame_count ?? ref.fingerprint_count ?? 0} IMAGES`
                            : ref.extraction_status || 'COMPLETE'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300">
                        <div>
                          <span className="text-slate-500">Duration:</span>{' '}
                          <span className="text-white">{formatDurationTimestamp(ref.duration_sec)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Sampling:</span>{' '}
                          <span className="text-cyan-300">1f / {ref.sample_interval_sec || 2}s</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Indexed Hashes:</span>{' '}
                          <span className="text-emerald-300 font-semibold">
                            {ref.extracted_frame_count ?? ref.fingerprint_count ?? 0} / {ref.expected_frame_count ?? ref.fingerprint_count ?? 0}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Saved JPEGs:</span>{' '}
                          <span
                            className={`font-semibold ${
                              (ref.missing_frame_image_count || 0) > 0 ? 'text-amber-300' : 'text-emerald-300'
                            }`}
                          >
                            {ref.retrievable_frame_image_count ?? ref.extracted_frame_count ?? ref.fingerprint_count ?? 0} /{' '}
                            {ref.extracted_frame_count ?? ref.fingerprint_count ?? 0}
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-1 overflow-hidden">
                        <div
                          className={`h-full ${
                            (ref.missing_frame_image_count || 0) > 0
                              ? 'bg-amber-400'
                              : ref.extraction_status === 'COMPLETE'
                              ? 'bg-emerald-400'
                              : 'bg-amber-400'
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              (ref.extracted_frame_count || ref.fingerprint_count || 0) > 0 &&
                                ref.retrievable_frame_image_count !== undefined
                                ? (ref.retrievable_frame_image_count /
                                    Math.max(1, ref.extracted_frame_count || ref.fingerprint_count || 1)) *
                                  100
                                : ref.extraction_progress_pct ?? 100
                            )}%`
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => handleOpenDetails(ref)}
                        className="px-2.5 py-1 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/40 border border-cyan-800/40 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{isFingerprinted ? 'Inspect Keyframes' : 'Inspect Record'}</span>
                      </button>

                      {(isAwaitingMedia || isInvalid || isIncompleteProcessing) && (
                        <button
                          onClick={() => handleOpenAttachMaster(ref)}
                          className="px-2.5 py-1 text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-950/50 hover:bg-amber-900/50 border border-amber-700/60 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>
                            {isInvalid
                              ? 'Provide Valid Source'
                              : isIncompleteProcessing
                              ? 'Re-Supply Video'
                              : 'Attach Authorized Master'}
                          </span>
                        </button>
                      )}
                    </div>

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
            );
          })}
        </div>
      )}

      {/* Drawer: Perceptual Keyframe Timeline & OTT Metadata Inspector */}
      {selectedRef && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Film className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-sm font-semibold text-white truncate max-w-md">{selectedRef.title}</h2>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-mono font-semibold uppercase rounded border ${getStatusBadgeClasses(selectedRef.status, selectedRef)}`}
                  >
                    {getDisplayStatusLabel(selectedRef.status, selectedRef)}
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  ID: {selectedRef.id} • {selectedRef.rights_holder}
                  {selectedRef.platform ? ` • ${selectedRef.platform}` : ''}
                  {selectedRef.season_episode_info ? ` • ${selectedRef.season_episode_info}` : ''}
                </div>
              </div>
              <button 
                onClick={() => setSelectedRef(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Keyframe Timeline List / Metadata Details */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* OTT Metadata Summary Card */}
              {(selectedRef.source_url || selectedRef.platform || selectedRef.season_episode_info) && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase text-cyan-400 font-semibold">
                      Preserved OTT &amp; Rights Metadata
                    </span>
                    {selectedRef.provider_integration_status && (
                      <span className="font-mono text-[10px] text-slate-400">
                        Ingest: {selectedRef.provider_integration_status}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-500">Platform:</span>{' '}
                      <span className="text-slate-200 font-medium">{selectedRef.platform || selectedRef.source_type}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Rights Holder:</span>{' '}
                      <span className="text-slate-200 font-medium">{selectedRef.rights_holder}</span>
                    </div>
                    {selectedRef.season_episode_info && (
                      <div className="col-span-2">
                        <span className="text-slate-500">Season / Episode / Event:</span>{' '}
                        <span className="text-cyan-300 font-mono">{selectedRef.season_episode_info}</span>
                      </div>
                    )}
                    {selectedRef.source_url && (
                      <div className="col-span-2 truncate">
                        <span className="text-slate-500">OTT / Source URL:</span>{' '}
                        <a
                          href={selectedRef.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:underline font-mono"
                        >
                          {selectedRef.source_url}
                        </a>
                      </div>
                    )}
                    {selectedRef.final_url && selectedRef.final_url !== selectedRef.source_url && (
                      <div className="col-span-2 truncate">
                        <span className="text-slate-500">Resolved Final URL:</span>{' '}
                        <span className="text-slate-300 font-mono">{selectedRef.final_url}</span>
                      </div>
                    )}
                    {selectedRef.media_url && (
                      <div className="col-span-2 truncate">
                        <span className="text-slate-500">Resolved Media Asset URL:</span>{' '}
                        <span className="text-emerald-300 font-mono">{selectedRef.media_url}</span>
                      </div>
                    )}
                    {selectedRef.detected_player_provider && (
                      <div>
                        <span className="text-slate-500">Detected Player:</span>{' '}
                        <span className="text-cyan-300 font-mono">{selectedRef.detected_player_provider}</span>
                      </div>
                    )}
                    {selectedRef.inspection_status && (
                      <div>
                        <span className="text-slate-500">Inspection Status:</span>{' '}
                        <span className="text-slate-300 font-mono">{selectedRef.inspection_status}</span>
                      </div>
                    )}
                    {selectedRef.acquisition_status && (
                      <div>
                        <span className="text-slate-500">Acquisition Status:</span>{' '}
                        <span className="text-amber-300 font-mono">{selectedRef.acquisition_status}</span>
                      </div>
                    )}
                    {selectedRef.authorization_provenance && (
                      <div>
                        <span className="text-slate-500">Auth Provenance:</span>{' '}
                        <span className="text-slate-300 font-mono">{selectedRef.authorization_provenance}</span>
                      </div>
                    )}
                    {selectedRef.last_acquisition_at && (
                      <div className="col-span-2">
                        <span className="text-slate-500">Last Acquisition Audit:</span>{' '}
                        <span className="text-slate-400 font-mono">{selectedRef.last_acquisition_at}</span>
                      </div>
                    )}
                    {selectedRef.provenance_sha256 && (
                      <div className="col-span-2 truncate">
                        <span className="text-slate-500">Provenance SHA-256:</span>{' '}
                        <span className="text-slate-400 font-mono">{selectedRef.provenance_sha256}</span>
                      </div>
                    )}
                    {selectedRef.acquisition_error && (
                      <div className="col-span-2 p-2 bg-rose-950/30 border border-rose-800/50 rounded text-[11px] text-rose-200">
                        <span className="font-mono uppercase text-[10px] text-rose-400 font-semibold block">
                          Media Acquisition / Inspection Diagnostic:
                        </span>
                        {selectedRef.acquisition_error}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isLoadingDetails ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  <span>Loading reference record and visual keyframes...</span>
                </div>
              ) : selectedRef.status === 'INVALID' ? (
                <div className="p-6 bg-rose-950/25 border border-rose-800/60 rounded-lg space-y-3 text-xs">
                  <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
                    <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    <span>Reference Source Marked INVALID — Valid Video Source Required</span>
                  </div>
                  <p className="text-rose-200/90 leading-relaxed">
                    {selectedRef.notes || 'The registered source file contains synthetic FFmpeg colour bars or test patterns rather than authentic video content. Colour-bar frames are rejected and never displayed as reference keyframes.'}
                  </p>
                  {selectedRef.file_path && (
                    <div className="p-2 bg-slate-950/80 border border-slate-800 rounded font-mono text-[11px] text-slate-400">
                      Rejected File: {selectedRef.file_path}
                    </div>
                  )}
                  <div className="pt-2">
                    <button
                      onClick={() => handleOpenAttachMaster(selectedRef)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-amber-400 hover:bg-amber-300 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload / Provide Valid Source Video</span>
                    </button>
                  </div>
                </div>
              ) : selectedRef.status === 'AWAITING_AUTHORIZED_MEDIA' || selectedRef.status === 'METADATA_REGISTERED' ? (
                <div className="p-5 bg-amber-950/20 border border-amber-800/60 rounded-lg space-y-4 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
                      <Clock className="w-5 h-5 text-amber-400 shrink-0" />
                      <span>
                        {selectedRef.status === 'METADATA_REGISTERED'
                          ? 'Metadata Registered — Ready for Discovery Sweeps'
                          : 'Awaiting Authorized Reference Media for Fingerprinting'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleToggleMetadataState(selectedRef)}
                      className="px-2 py-1 text-[10px] font-mono bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded cursor-pointer shrink-0"
                    >
                      Switch to {selectedRef.status === 'METADATA_REGISTERED' ? 'AWAITING_AUTHORIZED_MEDIA' : 'METADATA_REGISTERED'}
                    </button>
                  </div>

                  <p className="text-slate-300 leading-relaxed">
                    {selectedRef.notes}
                  </p>

                  {inspectorWorkflow && renderAcquisitionWorkflowBanner(inspectorWorkflow)}

                  {!inspectorWorkflow && selectedRef.embedded_player_metadata_json && (() => {
                    try {
                      const parsedMeta = JSON.parse(selectedRef.embedded_player_metadata_json);
                      const persistedMethods = Array.isArray(parsedMeta?.attemptedMethods) ? parsedMeta.attemptedMethods : [];
                      if (persistedMethods.length === 0) return null;
                      return (
                        <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded space-y-1.5">
                          <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">
                            Executed Source-Adapter Acquisition Methods ({persistedMethods.length}):
                          </div>
                          <div className="space-y-1">
                            {persistedMethods.map((am: any, idx: number) => (
                              <div
                                key={`${am.method}-${idx}`}
                                className="p-1.5 rounded bg-slate-900/90 border border-slate-800 flex flex-col gap-0.5 text-[10px] font-mono"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-200">{am.method}</span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                      am.status === 'SUCCESS'
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                                        : am.status === 'RESTRICTED'
                                        ? 'bg-amber-950 text-amber-300 border border-amber-700/60'
                                        : 'bg-slate-950 text-slate-400 border border-slate-700'
                                    }`}
                                  >
                                    {am.status}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 font-sans leading-snug">{am.detail}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    } catch {
                      return null;
                    }
                  })()}

                  {extractionFeedback && (
                    <div
                      className={`p-2 rounded border text-[11px] font-mono ${
                        extractionFeedback.type === 'success'
                          ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                          : 'bg-rose-950/40 border-rose-700/60 text-rose-200'
                      }`}
                    >
                      {extractionFeedback.message}
                    </div>
                  )}

                  <div className="p-3 bg-slate-950/90 border border-slate-800 rounded space-y-1.5 text-[11px]">
                    <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-cyan-400" />
                      <span>Compliance &amp; Pipeline Gate Guarantees</span>
                    </div>
                    <ul className="list-disc list-inside text-slate-400 space-y-1">
                      <li>OTT webpage URL and catalog metadata are preserved and enabled for <strong className="text-slate-200">Discovery Sweeps</strong>.</li>
                      <li>Backend never assumes browser login sessions, never bypasses Widevine/FairPlay/PlayReady DRM, and never fabricates fingerprints.</li>
                      <li>Reference is prevented from entering perceptual frame matching until an authorized master file or approved mezzanine stream is attached.</li>
                    </ul>
                  </div>

                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    {selectedRef.source_url && (
                      <button
                        type="button"
                        disabled={isAcquiringFromSourceUrl}
                        onClick={() => handleAutoAcquireMediaFromUrl(selectedRef)}
                        className="px-3.5 py-2 text-xs font-medium text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-700/60 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {isAcquiringFromSourceUrl ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Globe className="w-3.5 h-3.5" />
                        )}
                        <span>Auto-Acquire &amp; Process Video from Source URL</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenAttachMaster(selectedRef)}
                      className="px-3.5 py-2 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Attach Authorized Reference Master File / Stream</span>
                    </button>
                  </div>
                </div>
              ) : selectedRef.fingerprints && selectedRef.fingerprints.length > 0 ? (
                <div className="space-y-4">
                  {/* Full-Duration Frame Extraction Completeness & Re-Extraction Control Card */}
                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Full-Video Frame Extraction &amp; Completeness Audit</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded border ${
                          (selectedRef.missing_frame_image_count || 0) > 0
                            ? 'bg-amber-950/90 text-amber-300 border-amber-500/50'
                            : getExtractionStatusBadge(selectedRef.extraction_status).classes
                        }`}
                      >
                        {(selectedRef.missing_frame_image_count || 0) > 0
                          ? `PARTIAL — ${selectedRef.missing_frame_image_count} JPEGs MISSING`
                          : getExtractionStatusBadge(selectedRef.extraction_status).label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-2.5 bg-slate-900/70 border border-slate-800/80 rounded font-mono text-[11px]">
                      <div>
                        <span className="text-slate-500 block text-[10px]">ACTUAL DURATION</span>
                        <span className="text-white font-semibold">{formatDurationTimestamp(selectedRef.duration_sec)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">SAMPLING INTERVAL</span>
                        <span className="text-cyan-300 font-semibold">
                          1 frame / {selectedRef.sample_interval_sec || 2} sec
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">INDEXED HASHES / EXPECTED</span>
                        <span className="text-emerald-300 font-semibold">
                          {selectedRef.extracted_frame_count ?? selectedRef.fingerprints.length} /{' '}
                          {selectedRef.expected_frame_count ?? selectedRef.fingerprints.length} frames (
                          {(selectedRef.extraction_progress_pct ?? 100).toFixed(1)}%)
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">RETRIEVABLE FRAME IMAGES</span>
                        {(() => {
                          const totalIndexed = selectedRef.extracted_frame_count ?? selectedRef.fingerprints.length;
                          const retrievableImgs =
                            selectedRef.retrievable_frame_image_count ??
                            selectedRef.fingerprints.filter(f => f.image_available !== false && Boolean(f.thumbnail_url || f.thumbnail_data)).length;
                          const missingImgs = Math.max(0, totalIndexed - retrievableImgs);
                          return (
                            <span className={missingImgs > 0 ? 'text-amber-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                              {retrievableImgs} / {totalIndexed} JPEGs
                              {missingImgs > 0 ? ` (${missingImgs} missing)` : ' (100%)'}
                            </span>
                          );
                        })()}
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">TIMELINE SPAN</span>
                        <span className="text-slate-200">
                          {(selectedRef.first_extracted_timestamp_sec ?? selectedRef.fingerprints[0]?.timestamp_sec ?? 0).toFixed(2)}s –{' '}
                          {(selectedRef.last_extracted_timestamp_sec ?? selectedRef.fingerprints[selectedRef.fingerprints.length - 1]?.timestamp_sec ?? 0).toFixed(2)}s
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">VIDEO FPS / RESOLUTION</span>
                        <span className="text-slate-300">
                          {selectedRef.fps || 24} fps • {selectedRef.resolution || '1920x1080'}
                        </span>
                      </div>
                    </div>

                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          (selectedRef.missing_frame_image_count || 0) > 0
                            ? 'bg-amber-400'
                            : selectedRef.extraction_status === 'COMPLETE'
                            ? 'bg-emerald-400'
                            : 'bg-amber-400'
                        }`}
                        style={{ width: `${Math.min(100, selectedRef.extraction_progress_pct ?? 100)}%` }}
                      />
                    </div>

                    {(selectedRef.missing_frame_image_count || 0) > 0 && (
                      <div className="p-2.5 bg-amber-950/35 border border-amber-700/60 rounded text-[11px] text-amber-200 space-y-1.5">
                        <div className="font-mono text-[10px] uppercase text-amber-300 font-semibold flex items-center justify-between">
                          <span>
                            Partial Frame Image Availability ({selectedRef.retrievable_frame_image_count ?? 0} of{' '}
                            {selectedRef.extracted_frame_count ?? selectedRef.fingerprints.length} JPEGs Retrievable)
                          </span>
                          <span>{selectedRef.missing_frame_image_count} Missing</span>
                        </div>
                        <p className="text-[11px] text-amber-100/90 leading-relaxed">
                          All {selectedRef.extracted_frame_count ?? selectedRef.fingerprints.length} perceptual 64-bit dHash fingerprints remain intact and active for forensic matching, but{' '}
                          {selectedRef.missing_frame_image_count} frame JPEG image(s) are not currently stored on disk or in SQLite backup. Provide the original source video or run Frame Integrity Repair to regenerate missing thumbnails without fabricating frames.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isRepairingFrames}
                            onClick={() => handleRepairReferenceFrames(selectedRef)}
                            className="px-2.5 py-1 text-[11px] font-mono font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                          >
                            {isRepairingFrames && <Loader2 className="w-3 h-3 animate-spin" />}
                            <span>Audit &amp; Repair Frame Images</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenAttachMaster(selectedRef)}
                            className="px-2.5 py-1 text-[11px] font-mono text-cyan-300 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/60 rounded cursor-pointer inline-flex items-center gap-1"
                          >
                            <Upload className="w-3 h-3" />
                            <span>Re-Supply Source Video to Regenerate Missing Frames</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedRef.extraction_error && (
                      <div className="p-2 bg-amber-950/40 border border-amber-700/60 rounded text-[11px] font-mono text-amber-200">
                        Interrupted / Diagnostic Note: {selectedRef.extraction_error}
                      </div>
                    )}

                    {extractionFeedback && (
                      <div
                        className={`p-2 rounded border text-[11px] font-mono ${
                          extractionFeedback.type === 'success'
                            ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                            : 'bg-rose-950/40 border-rose-700/60 text-rose-200'
                        }`}
                      >
                        {extractionFeedback.message}
                      </div>
                    )}

                    {/* Re-Extract, Repair, or Resume Full Video Controls */}
                    <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-400">Sampling Rate:</span>
                        <select
                          value={inspectorIntervalMode}
                          disabled={isExtractingFrames}
                          onChange={e => setInspectorIntervalMode(e.target.value as any)}
                          className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[11px] font-mono text-white"
                        >
                          <option value="1">1 frame / 1s</option>
                          <option value="2">1 frame / 2s</option>
                          <option value="5">1 frame / 5s</option>
                          <option value="custom">Custom (sec)</option>
                        </select>
                        {inspectorIntervalMode === 'custom' && (
                          <input
                            type="number"
                            min="0.25"
                            step="0.25"
                            value={inspectorCustomInterval}
                            disabled={isExtractingFrames}
                            onChange={e => setInspectorCustomInterval(e.target.value)}
                            className="w-16 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[11px] font-mono text-cyan-300"
                            placeholder="sec"
                          />
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isRepairingFrames}
                          onClick={() => handleRepairReferenceFrames(selectedRef)}
                          className="px-2.5 py-1 text-[11px] font-mono text-emerald-300 bg-emerald-950/50 hover:bg-emerald-900/50 border border-emerald-700/60 rounded cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {isRepairingFrames && <Loader2 className="w-3 h-3 animate-spin" />}
                          <span>Verify &amp; Repair Images</span>
                        </button>
                        {selectedRef.source_video_available === false ? (
                          <button
                            type="button"
                            onClick={() => handleOpenAttachMaster(selectedRef)}
                            className="px-2.5 py-1 text-[11px] font-mono text-amber-300 bg-amber-950/60 hover:bg-amber-900/60 border border-amber-700/60 rounded cursor-pointer inline-flex items-center gap-1"
                          >
                            <Upload className="w-3 h-3" />
                            <span>Re-Upload Source Video to Regenerate Missing JPEGs</span>
                          </button>
                        ) : (
                          <>
                            {(selectedRef.file_path || selectedRef.media_url) && selectedRef.extraction_status === 'PARTIAL' && (
                              <button
                                type="button"
                                disabled={isExtractingFrames}
                                onClick={() => handleRunReferenceExtraction(selectedRef, true)}
                                className="px-2.5 py-1 text-[11px] font-mono font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                              >
                                {isExtractingFrames && <Loader2 className="w-3 h-3 animate-spin" />}
                                <span>Resume Extraction</span>
                              </button>
                            )}
                            {(selectedRef.file_path || selectedRef.media_url) && (
                              <button
                                type="button"
                                disabled={isExtractingFrames}
                                onClick={() => handleRunReferenceExtraction(selectedRef, false)}
                                className="px-2.5 py-1 text-[11px] font-mono text-cyan-300 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/60 rounded cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                              >
                                {isExtractingFrames && <Loader2 className="w-3 h-3 animate-spin" />}
                                <span>Extract Full Video (0s–End)</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Full-Video Timeline Scrubber & Pagination Controls (Display-only; all frames remain indexed) */}
                  {(() => {
                    const allFps = selectedRef.fingerprints || [];
                    const filterSec = timestampSearchSec.trim() !== '' ? parseFloat(timestampSearchSec) : NaN;
                    const filteredFps = Number.isFinite(filterSec)
                      ? allFps.filter(fp => Math.abs(fp.timestamp_sec - filterSec) <= Math.max(5, (selectedRef.sample_interval_sec || 2) * 3))
                      : allFps;
                    const effectivePerPage = framesPerPage <= 0 ? Math.max(1, filteredFps.length) : framesPerPage;
                    const totalPages = Math.max(1, Math.ceil(filteredFps.length / effectivePerPage));
                    const safePage = Math.min(framePage, totalPages);
                    const startIdx = (safePage - 1) * effectivePerPage;
                    const visibleFps = filteredFps.slice(startIdx, startIdx + effectivePerPage);

                    return (
                      <>
                        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2.5 text-xs">
                          {(() => {
                            const totalIndexedCount = selectedRef.extracted_frame_count ?? allFps.length;
                            const totalExpectedCount = selectedRef.expected_frame_count ?? totalIndexedCount;
                            const verifiedJpegCount =
                              selectedRef.retrievable_frame_image_count ??
                              allFps.filter(f => f.image_available !== false && Boolean(f.thumbnail_url || f.thumbnail_data)).length;
                            const missingJpegCount = Math.max(0, totalIndexedCount - verifiedJpegCount);
                            return (
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-mono text-[11px] text-slate-300">
                                  Showing frames{' '}
                                  <strong className="text-cyan-300">
                                    {filteredFps.length > 0 ? startIdx + 1 : 0}–
                                    {Math.min(startIdx + visibleFps.length, filteredFps.length)}
                                  </strong>{' '}
                                  • Indexed Fingerprints:{' '}
                                  <strong className="text-white">
                                    {totalIndexedCount} / {totalExpectedCount}
                                  </strong>{' '}
                                  • Verified JPEG Images:{' '}
                                  <strong className={missingJpegCount > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                                    {verifiedJpegCount} / {totalIndexedCount}
                                    {missingJpegCount > 0 ? ` (${missingJpegCount} JPEGs Not Stored)` : ' (100% Stored)'}
                                  </strong>
                                </span>
                              </div>
                            );
                          })()}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono text-slate-400">Jump to Timestamp (s):</span>
                              <input
                                type="number"
                                min="0"
                                max={selectedRef.duration_sec || 99999}
                                step="1"
                                value={timestampSearchSec}
                                onChange={e => {
                                  setTimestampSearchSec(e.target.value);
                                  setFramePage(1);
                                }}
                                placeholder={`0 .. ${Math.ceil(selectedRef.duration_sec || 0)}s`}
                                className="w-28 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[11px] font-mono text-white"
                              />
                              {timestampSearchSec && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTimestampSearchSec('');
                                    setFramePage(1);
                                  }}
                                  className="px-2 py-1 text-[10px] font-mono bg-slate-800 text-slate-300 rounded hover:text-white cursor-pointer"
                                >
                                  Clear
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                              <select
                                value={framesPerPage}
                                onChange={e => {
                                  setFramesPerPage(Number(e.target.value));
                                  setFramePage(1);
                                }}
                                className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200"
                              >
                                <option value={30}>30 / page</option>
                                <option value={60}>60 / page</option>
                                <option value={120}>120 / page</option>
                                <option value={0}>Show All ({allFps.length})</option>
                              </select>

                              {totalPages > 1 && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={safePage <= 1}
                                    onClick={() => setFramePage(1)}
                                    className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded disabled:opacity-40 cursor-pointer"
                                  >
                                    « First
                                  </button>
                                  <button
                                    type="button"
                                    disabled={safePage <= 1}
                                    onClick={() => setFramePage(p => Math.max(1, p - 1))}
                                    className="px-2 py-0.5 bg-slate-900 border border-slate-700 rounded disabled:opacity-40 cursor-pointer"
                                  >
                                    ‹ Prev
                                  </button>
                                  <span className="px-2 text-cyan-300">
                                    {safePage} / {totalPages}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={safePage >= totalPages}
                                    onClick={() => setFramePage(p => Math.min(totalPages, p + 1))}
                                    className="px-2 py-0.5 bg-slate-900 border border-slate-700 rounded disabled:opacity-40 cursor-pointer"
                                  >
                                    Next ›
                                  </button>
                                  <button
                                    type="button"
                                    disabled={safePage >= totalPages}
                                    onClick={() => setFramePage(totalPages)}
                                    className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded disabled:opacity-40 cursor-pointer"
                                  >
                                    Last »
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {visibleFps.map((fp, idx) => (
                          <div 
                            key={fp.id || `${fp.frame_index}_${idx}`}
                            className="flex items-center gap-4 p-3 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors"
                          >
                            {/* Frame Thumbnail */}
                            <div className="w-32 h-20 bg-slate-900 rounded overflow-hidden shrink-0 border border-slate-800 relative">
                              {(() => {
                                const key = fp.id || `${fp.frame_index}_${idx}`;
                                const primarySrc = resolveReferenceFrameImageWithFallback(fp, selectedRef.id);
                                const apiFallbackSrc =
                                  fp.image_available !== false && fp.frame_index !== undefined
                                    ? `/api/references/${encodeURIComponent(selectedRef.id)}/frames/${fp.frame_index}/image`
                                    : null;
                                const activeSrc = fallbackTriedThumbnails[key] ? apiFallbackSrc : primarySrc;
                                if (activeSrc && !failedThumbnails[key]) {
                                  return (
                                    <img 
                                      src={activeSrc} 
                                      alt={`Decoded Reference Frame @ ${fp.timestamp_sec}s`}
                                      className="w-full h-full object-cover" 
                                      referrerPolicy="no-referrer"
                                      onError={() => {
                                        if (!fallbackTriedThumbnails[key] && apiFallbackSrc && activeSrc !== apiFallbackSrc) {
                                          setFallbackTriedThumbnails(prev => ({ ...prev, [key]: true }));
                                        } else {
                                          setFailedThumbnails(prev => ({ ...prev, [key]: true }));
                                        }
                                      }}
                                    />
                                  );
                                }
                                return (
                                  <div className="w-full h-full flex flex-col items-center justify-center p-1 text-center bg-slate-950 text-slate-400">
                                    <AlertCircle className="w-4 h-4 text-amber-400 mb-0.5 shrink-0" />
                                    <span className="text-[9px] font-mono text-amber-300">Frame Image Missing</span>
                                  </div>
                                );
                              })()}
                              <span className="absolute bottom-1 right-1 px-1 py-0.2 bg-black/80 font-mono text-[9px] text-slate-300 rounded">
                                {fp.timestamp_sec.toFixed(2)}s
                              </span>
                            </div>

                            {/* Fingerprint Data */}
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center justify-between text-xs gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-slate-200">
                                    Frame #{(fp.frame_index ?? idx) + 1} of {allFps.length}
                                  </span>
                                  {fp.image_available !== false && Boolean(fp.thumbnail_url || fp.thumbnail_data) ? (
                                    <span className="px-1.5 py-0.2 text-[9px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 rounded">
                                      JPEG Verified
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.2 text-[9px] font-mono bg-amber-950/80 text-amber-300 border border-amber-700/60 rounded">
                                      Hash Indexed • JPEG Missing
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] text-cyan-300 font-mono">
                                  t = {formatDurationTimestamp(fp.timestamp_sec)}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-2 bg-slate-900/80 px-2.5 py-1 rounded border border-slate-800/80">
                                <span className="text-[10px] uppercase text-cyan-400 font-mono shrink-0">dHash:</span>
                                <span className="text-xs font-mono text-cyan-300 tracking-wider truncate selection:bg-cyan-900">
                                  {fp.phash_hex}
                                </span>
                                {fp.crop_phash_hex && (
                                  <span className="text-[10px] font-mono text-emerald-400/90 hidden sm:inline">
                                    crop:{fp.crop_phash_hex.substring(0, 8)}…
                                  </span>
                                )}
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

                              {fp.image_available !== false && fp.thumbnail_url ? (
                                <div className="text-[10px] font-mono text-emerald-400/80 truncate">
                                  Verified JPEG: {fp.thumbnail_url}
                                </div>
                              ) : (
                                <div className="text-[10px] font-mono text-amber-400/80 truncate">
                                  64-bit dHash Indexed • JPEG Image Not Stored (Re-supply source video to regenerate)
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-400 text-xs">
                  No frame hashes extracted yet. Attach an authorized reference master video to compute 64-bit dHash fingerprints.
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              {(() => {
                const isZeroState =
                  selectedRef.status === 'INVALID' ||
                  selectedRef.status === 'AWAITING_AUTHORIZED_MEDIA' ||
                  selectedRef.status === 'METADATA_REGISTERED';
                const totalIndexed = isZeroState
                  ? 0
                  : selectedRef.extracted_frame_count || selectedRef.fingerprints?.length || selectedRef.fingerprint_count || 0;
                const expectedCount = selectedRef.expected_frame_count || totalIndexed;
                const verifiedJpegs = isZeroState
                  ? 0
                  : selectedRef.retrievable_frame_image_count ??
                    (selectedRef.fingerprints?.filter(f => f.image_available !== false && Boolean(f.thumbnail_url || f.thumbnail_data)).length ??
                      totalIndexed);
                const missingJpegs = Math.max(0, totalIndexed - verifiedJpegs);
                return (
                  <div className="font-mono text-[11px] flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      Indexed Fingerprints (0s–End):{' '}
                      <strong className="text-slate-200">
                        {totalIndexed} / {expectedCount}
                      </strong>
                    </span>
                    <span>•</span>
                    <span>
                      Verified JPEG Images:{' '}
                      <strong className={missingJpegs > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                        {verifiedJpegs} / {totalIndexed}
                        {missingJpegs > 0 ? ` (${missingJpegs} missing)` : ''}
                      </strong>
                    </span>
                  </div>
                );
              })()}
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

      {/* Register Reference / Attach Authorized Master Modal */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-xl w-full shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  {replaceReferenceId
                    ? `Attach Authorized Master Media (${replaceReferenceId})`
                    : 'Register Reference Ground Truth / OTT Asset'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {replaceReferenceId
                    ? 'Supply an authorized reference master file (.mp4/.mkv/.mov) or unencrypted mezzanine stream while preserving OTT metadata'
                    : 'Ingest local video masters, OTT platform watch URLs (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video), or direct streams'}
                </p>
              </div>
              <button 
                onClick={() => {
                  setReplaceReferenceId(undefined);
                  onCloseRegisterModal();
                }}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-white p-1 cursor-pointer disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              {submitError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Source Mode Toggle */}
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setMode('upload')}
                  className={`py-1.5 px-2 text-xs font-medium rounded transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'upload' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Master File Upload</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setMode('ott')}
                  className={`py-1.5 px-2 text-xs font-medium rounded transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'ott' ? 'bg-slate-800 text-amber-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Tv className="w-3.5 h-3.5" />
                  <span>OTT Webpage URL</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setMode('url')}
                  className={`py-1.5 px-2 text-xs font-medium rounded transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'url' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <LinkIcon className="w-3.5 h-3.5" />
                  <span>Direct Stream URL</span>
                </button>
              </div>

              {/* Form Fields */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>Content Title</span>
                  {(mode !== 'upload' || sourceUrl.trim() || referenceWebpageUrl.trim()) && (
                    <span className="text-[10px] font-mono text-cyan-400">Auto-resolved from URL if left blank</span>
                  )}
                </label>
                <input
                  type="text"
                  required={mode === 'upload' && !sourceUrl.trim() && !referenceWebpageUrl.trim() && !authorizedMezzanineUrl.trim()}
                  disabled={isSubmitting}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={mode === 'upload' ? 'e.g. India Tour of New Zealand 2026 - 1st T20I' : 'Auto-detected from video URL (or enter custom title)'}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                    <span>Rights Holder</span>
                    {(mode !== 'upload' || sourceUrl.trim() || referenceWebpageUrl.trim()) && (
                      <span className="text-[10px] font-mono text-cyan-400">Auto-resolved</span>
                    )}
                  </label>
                  <input
                    type="text"
                    required={mode === 'upload' && !sourceUrl.trim() && !referenceWebpageUrl.trim() && !authorizedMezzanineUrl.trim()}
                    disabled={isSubmitting}
                    value={rightsHolder}
                    onChange={(e) => setRightsHolder(e.target.value)}
                    placeholder={mode === 'upload' ? 'e.g. Sony Pictures Networks / Novi Digital' : 'Auto-detected channel / publisher'}
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
                    <option value="LIVE_SPORTS">Live Sports Broadcast</option>
                    <option value="VOD_FEATURE">VOD Feature Film</option>
                    <option value="EPISODIC">Episodic Television</option>
                    <option value="COMMERCIAL">Commercial / Short-form</option>
                    <option value="TRAILER">Promotional Trailer</option>
                  </select>
                </div>
              </div>

              {/* OTT Platform & Season/Episode or Event Metadata */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">OTT Platform / Broadcaster</label>
                  <input
                    type="text"
                    disabled={isSubmitting}
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    placeholder="e.g. SonyLIV, Disney+ Hotstar, Netflix, JioCinema"
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Season / Episode or Live Event Details</label>
                  <input
                    type="text"
                    disabled={isSubmitting}
                    value={seasonEpisodeInfo}
                    onChange={(e) => setSeasonEpisodeInfo(e.target.value)}
                    placeholder="e.g. 1st T20I • 22 Oct 2026 or S01E04"
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                  />
                </div>
              </div>

              {mode === 'upload' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-300">
                        Select Authorized Reference Master (.mp4, .mkv, .mov up to {uploadConfig.maxUploadSizeMB}MB)
                      </label>
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
                          {file ? file.name : 'Click to select reference master video file'}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {file ? (
                            <span className="text-cyan-400">
                              {(file.size / (1024 * 1024)).toFixed(2)} MB • {Math.ceil(file.size / uploadConfig.chunkSizeBytes)} chunks
                            </span>
                          ) : (
                            `Decodes real keyframes via FFmpeg & transitions status to FINGERPRINTED`
                          )}
                        </div>
                      </label>
                    </div>
                  </div>

                  {replaceReferenceId && (
                    <div className="space-y-3 pt-2 border-t border-slate-800/80">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Or Submit Reference Webpage URL for Media Availability Inspection</span>
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">Webpage vs. Media Asset</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="url"
                            disabled={isSubmitting || isInspectingUrl}
                            value={referenceWebpageUrl}
                            onChange={(e) => {
                              setReferenceWebpageUrl(e.target.value);
                              setUrlInspection(null);
                            }}
                            placeholder="https://rights-portal.example.com/press-screener-page or direct media URL"
                            className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                          />
                          <button
                            type="button"
                            disabled={isSubmitting || isInspectingUrl || !referenceWebpageUrl.trim()}
                            onClick={() => handleInspectUrlAvailability(referenceWebpageUrl)}
                            className="px-3 py-1.5 text-xs font-medium text-cyan-300 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/60 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shrink-0"
                          >
                            {isInspectingUrl ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Search className="w-3.5 h-3.5" />
                            )}
                            <span>Inspect Availability</span>
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          Inspects accessible page metadata (iframe embeds, <span className="font-mono">&lt;video&gt;</span>, <span className="font-mono">&lt;source&gt;</span>, <span className="font-mono">og:video</span>, JSON-LD) to detect embedded players and determine if an unencrypted direct video asset is available. Never bypasses DRM, paywalls, login sessions, or anti-bot protections.
                        </p>
                      </div>

                      {urlInspection && (
                        <div
                          className={`p-3 rounded border text-xs space-y-2 ${
                            urlInspection.canAcquireAuthorized
                              ? 'bg-emerald-950/25 border-emerald-700/60 text-emerald-200'
                              : 'bg-amber-950/25 border-amber-700/60 text-amber-200'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
                            <span className="font-semibold uppercase">
                              Classification: {urlInspection.urlClassification} (
                              {urlInspection.isWebpage ? 'Webpage URL' : 'Direct Media Asset'})
                            </span>
                            <div className="flex items-center gap-1.5">
                              {urlInspection.inspectionStatus && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-cyan-300">
                                  {urlInspection.inspectionStatus}
                                </span>
                              )}
                              <span className="px-1.5 py-0.5 rounded bg-slate-950/80 border border-slate-800">
                                {urlInspection.acquisitionStatus}
                              </span>
                            </div>
                          </div>

                          {urlInspection.detectedPlayerProvider && (
                            <div className="flex items-center gap-2 px-2 py-1 rounded bg-slate-950/70 border border-slate-800 text-[11px]">
                              <Tv className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span className="text-slate-400">Detected Embedded Player:</span>
                              <span className="font-mono font-semibold text-cyan-300">
                                {urlInspection.detectedPlayerProvider}
                              </span>
                              <span className="ml-auto text-[10px] font-mono text-amber-300">
                                {urlInspection.directMediaAvailable ? 'Direct Media Verified' : 'No Direct Download'}
                              </span>
                            </div>
                          )}

                          <p className="text-[11px] leading-relaxed">{urlInspection.reason}</p>

                          <div className="grid grid-cols-1 gap-1 pt-1 text-[10px] font-mono text-slate-300 border-t border-slate-800/60">
                            <div className="truncate">
                              <span className="text-slate-500">Submitted URL:</span> {urlInspection.submittedUrl}
                            </div>
                            <div className="truncate">
                              <span className="text-slate-500">Final URL:</span> {urlInspection.finalUrl}
                            </div>
                            {urlInspection.resolvedMediaUrl && (
                              <div className="truncate text-emerald-300">
                                <span className="text-slate-500">Resolved Video Asset:</span> {urlInspection.resolvedMediaUrl}
                              </div>
                            )}
                            {urlInspection.pageTitle && (
                              <div className="truncate">
                                <span className="text-slate-500">Page Title:</span> {urlInspection.pageTitle}
                              </div>
                            )}
                          </div>

                          {urlInspection.accessibleMediaMetadata && (
                            <div className="pt-1.5 border-t border-slate-800/60 space-y-1 text-[10px] font-mono text-slate-300">
                              <div className="text-slate-400 uppercase font-semibold">
                                Accessible Embedded-Player &amp; Media Metadata:
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span className="px-1.5 py-0.5 bg-slate-950/80 border border-slate-800 rounded">
                                  Iframes: {urlInspection.accessibleMediaMetadata.iframeSrcs.length}
                                </span>
                                <span className="px-1.5 py-0.5 bg-slate-950/80 border border-slate-800 rounded">
                                  &lt;video&gt; tags: {urlInspection.accessibleMediaMetadata.htmlVideoElementCount}
                                </span>
                                <span className="px-1.5 py-0.5 bg-slate-950/80 border border-slate-800 rounded">
                                  &lt;source&gt; tags: {urlInspection.accessibleMediaMetadata.videoSourceTags.length}
                                </span>
                                <span className="px-1.5 py-0.5 bg-slate-950/80 border border-slate-800 rounded">
                                  og:video: {urlInspection.accessibleMediaMetadata.openGraphVideoUrls.length}
                                </span>
                                <span className="px-1.5 py-0.5 bg-slate-950/80 border border-slate-800 rounded">
                                  JSON-LD VideoObject: {urlInspection.accessibleMediaMetadata.jsonLdVideos.length}
                                </span>
                              </div>
                              {urlInspection.accessibleMediaMetadata.iframeSrcs.length > 0 && (
                                <div className="truncate text-cyan-300">
                                  <span className="text-slate-500">Iframe Embed URL:</span>{' '}
                                  {urlInspection.accessibleMediaMetadata.iframeSrcs[0]}
                                </div>
                              )}
                              {urlInspection.accessibleMediaMetadata.jsonLdVideos.length > 0 &&
                                (urlInspection.accessibleMediaMetadata.jsonLdVideos[0].embedUrl ||
                                  urlInspection.accessibleMediaMetadata.jsonLdVideos[0].contentUrl) && (
                                  <div className="truncate text-cyan-300">
                                    <span className="text-slate-500">JSON-LD Video URL:</span>{' '}
                                    {urlInspection.accessibleMediaMetadata.jsonLdVideos[0].contentUrl ||
                                      urlInspection.accessibleMediaMetadata.jsonLdVideos[0].embedUrl}
                                  </div>
                                )}
                              {urlInspection.accessibleMediaMetadata.detectedPlayerSdks.length > 0 && (
                                <div className="truncate">
                                  <span className="text-slate-500">Player SDKs:</span>{' '}
                                  {urlInspection.accessibleMediaMetadata.detectedPlayerSdks.join(', ')}
                                </div>
                              )}
                            </div>
                          )}

                          {urlInspection.diagnosticErrors && urlInspection.diagnosticErrors.length > 0 && !urlInspection.canAcquireAuthorized && (
                            <div className="pt-1.5 border-t border-slate-800/60 space-y-1 text-[10px] font-mono text-amber-200/90">
                              <div className="text-amber-300 uppercase font-semibold">
                                Why Direct Media Acquisition Is Unavailable:
                              </div>
                              {urlInspection.diagnosticErrors.map((diag, i) => (
                                <div key={i} className="leading-relaxed">
                                  • {diag}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-300">
                          Or Provide Approved Mezzanine / Clean-Feed Direct Stream URL (.mp4 / .m3u8)
                        </label>
                        <input
                          type="url"
                          disabled={isSubmitting}
                          value={authorizedMezzanineUrl}
                          onChange={(e) => setAuthorizedMezzanineUrl(e.target.value)}
                          placeholder="https://partner-ingest.example.com/authorized-master.mp4"
                          className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                        />
                      </div>

                      {(referenceWebpageUrl.trim() || authorizedMezzanineUrl.trim()) && !file && (
                        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded space-y-2 text-xs">
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={authorizationConfirmed}
                              onChange={(e) => setAuthorizationConfirmed(e.target.checked)}
                              className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-400 focus:ring-0"
                            />
                            <span className="text-[11px] text-slate-300 leading-snug">
                              I confirm that I am authorized by the rights holder to access and ingest this reference media source. (No credentials or session cookies are stored.)
                            </span>
                          </label>
                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">Authorization Provenance:</span>
                            <select
                              value={authorizationProvenance}
                              disabled={isSubmitting}
                              onChange={(e) => setAuthorizationProvenance(e.target.value)}
                              className="flex-1 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[11px] font-mono text-slate-200"
                            >
                              <option value="RIGHTS_HOLDER_DIRECT_AUTHORIZATION">RIGHTS_HOLDER_DIRECT_AUTHORIZATION</option>
                              <option value="APPROVED_SYNDICATION_MEZZANINE">APPROVED_SYNDICATION_MEZZANINE</option>
                              <option value="PUBLIC_DOMAIN_OR_OPEN_ARCHIVE">PUBLIC_DOMAIN_OR_OPEN_ARCHIVE</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {mode === 'ott' && (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-950/20 border border-amber-800/50 rounded text-[11px] text-amber-200 space-y-1">
                    <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <Tv className="w-3.5 h-3.5" />
                      <span>OTT &amp; Embedded Player Webpage Ingestion (Hotstar, Netflix, SonyLIV, JioCinema, Prime Video, Web Embeds)</span>
                    </div>
                    <p className="text-amber-100/80 leading-relaxed">
                      Protected OTT player URLs and webpages with embedded players are accepted and never marked INVALID. Their metadata is preserved for Discovery Sweeps while awaiting an authorized reference master file for perceptual frame fingerprinting.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">OTT Platform or Embedded Player Webpage URL</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="url"
                        required
                        disabled={isSubmitting || isInspectingUrl}
                        value={sourceUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSourceUrl(val);
                          setUrlInspection(null);
                          const detected = detectOttPlatformFromUrl(val);
                          if (detected && !platform) {
                            setPlatform(detected);
                          }
                        }}
                        placeholder="https://www.sonyliv.com/live-sport/... or webpage with embedded player"
                        className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={isSubmitting || isInspectingUrl || !sourceUrl.trim()}
                        onClick={() => handleInspectUrlAvailability(sourceUrl)}
                        className="px-3 py-1.5 text-xs font-medium text-cyan-300 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/60 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shrink-0"
                      >
                        {isInspectingUrl ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Search className="w-3.5 h-3.5" />
                        )}
                        <span>Inspect Page &amp; Player</span>
                      </button>
                    </div>
                  </div>

                  {urlInspection && (
                    <div className="space-y-2">
                      <div
                        className={`p-3 rounded border text-xs space-y-1.5 ${
                          urlInspection.canAcquireAuthorized
                            ? 'bg-emerald-950/25 border-emerald-700/60 text-emerald-200'
                            : 'bg-amber-950/25 border-amber-700/60 text-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                          <span className="font-semibold uppercase">
                            {urlInspection.urlClassification}
                            {urlInspection.sourceAdapter ? ` • ${urlInspection.sourceAdapter.name}` : ''}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-950/80 border border-slate-800">
                            {urlInspection.inspectionStatus || urlInspection.acquisitionStatus}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-cyan-300">
                          {urlInspection.detectedPlayerProvider && (
                            <span>Player: {urlInspection.detectedPlayerProvider}</span>
                          )}
                          {urlInspection.mediaFormat && (
                            <span>Format: {urlInspection.mediaFormat}</span>
                          )}
                          {urlInspection.durationSec !== undefined && (
                            <span>Duration: {formatDurationTimestamp(urlInspection.durationSec)}</span>
                          )}
                          {urlInspection.videoIdentity?.videoId && (
                            <span>Video ID: {urlInspection.videoIdentity.videoId}</span>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed">{urlInspection.reason}</p>
                      </div>
                      {urlInspection.workflow && renderAcquisitionWorkflowBanner(urlInspection.workflow)}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300">Initial OTT Reference State</label>
                      <select
                        value={ottInitialStatus}
                        disabled={isSubmitting}
                        onChange={(e) => setOttInitialStatus(e.target.value as any)}
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                      >
                        <option value="AWAITING_AUTHORIZED_MEDIA">AWAITING_AUTHORIZED_MEDIA</option>
                        <option value="METADATA_REGISTERED">METADATA_REGISTERED</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300">Optional Authorized Mezzanine URL</label>
                      <input
                        type="url"
                        disabled={isSubmitting}
                        value={authorizedMezzanineUrl}
                        onChange={(e) => setAuthorizedMezzanineUrl(e.target.value)}
                        placeholder="Optional .mp4 / .m3u8 master feed"
                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>
              )}

              {mode === 'url' && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">
                    Direct Media Stream URL (.mp4, .mkv, .mov, HLS .m3u8, DASH .mpd) or Supported Video Platform URL
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      required
                      disabled={isSubmitting || isInspectingUrl}
                      value={sourceUrl}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSourceUrl(val);
                        setUrlInspection(null);
                        const detected = detectOttPlatformFromUrl(val);
                        if (detected && !platform) {
                          setPlatform(detected);
                        }
                      }}
                      placeholder="https://cdn.example.com/master.mp4, .m3u8, .mpd, YouTube, Vimeo, Dailymotion..."
                      className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={isSubmitting || isInspectingUrl || !sourceUrl.trim()}
                      onClick={() => handleInspectUrlAvailability(sourceUrl)}
                      className="px-3 py-1.5 text-xs font-medium text-cyan-300 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/60 rounded transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shrink-0"
                    >
                      {isInspectingUrl ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      <span>Inspect URL</span>
                    </button>
                  </div>
                  {isWatchPagePlayerUrl(sourceUrl) && !urlInspection && (
                    <div className="p-2.5 bg-amber-950/30 border border-amber-700/50 rounded text-[11px] text-amber-200 flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>Supported Platform Webpage Detected:</strong> Click <strong>Inspect URL</strong> or submit directly — SPECTRA will identify the platform, inspect metadata, and automatically acquire and fingerprint the video if an authorized/unencrypted media stream is exposed.
                      </span>
                    </div>
                  )}
                  {urlInspection && (
                    <div className="space-y-2">
                      <div
                        className={`p-3 rounded border text-xs space-y-1.5 ${
                          urlInspection.canAcquireAuthorized
                            ? 'bg-emerald-950/25 border-emerald-700/60 text-emerald-200'
                            : 'bg-amber-950/25 border-amber-700/60 text-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                          <span className="font-semibold uppercase">
                            {urlInspection.urlClassification} ({urlInspection.isWebpage ? 'Webpage URL' : 'Direct Media'})
                            {urlInspection.sourceAdapter ? ` • ${urlInspection.sourceAdapter.name}` : ''}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-950/80 border border-slate-800">
                            {urlInspection.inspectionStatus || urlInspection.acquisitionStatus}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-cyan-300">
                          {urlInspection.detectedPlayerProvider && (
                            <span>Player: {urlInspection.detectedPlayerProvider}</span>
                          )}
                          {urlInspection.mediaFormat && (
                            <span>Format: {urlInspection.mediaFormat}</span>
                          )}
                          {urlInspection.durationSec !== undefined && (
                            <span>Duration: {formatDurationTimestamp(urlInspection.durationSec)}</span>
                          )}
                          {urlInspection.videoIdentity?.videoId && (
                            <span>Video ID: {urlInspection.videoIdentity.videoId}</span>
                          )}
                        </div>
                        <p className="text-[11px] leading-relaxed">{urlInspection.reason}</p>
                        {!urlInspection.canAcquireAuthorized && !replaceReferenceId && urlInspection.isWebpage && urlInspection.urlClassification !== 'UNREACHABLE' && (
                          <p className="text-[10px] font-mono text-amber-300/90 pt-1 border-t border-amber-800/40">
                            Direct media stream is unavailable from this webpage. Submitting will register the reference metadata, source URL, and inspection diagnostics as {ottInitialStatus}.
                          </p>
                        )}
                      </div>
                      {urlInspection.workflow && renderAcquisitionWorkflowBanner(urlInspection.workflow)}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    Full-Video Sampling Interval (0s to End)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={sampleIntervalMode}
                      disabled={isSubmitting}
                      onChange={(e) => {
                        const modeVal = e.target.value as '1' | '2' | '5' | 'custom';
                        setSampleIntervalMode(modeVal);
                        if (modeVal !== 'custom') {
                          setSampleInterval(modeVal);
                        } else {
                          setSampleInterval(customSampleInterval || '3');
                        }
                      }}
                      className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                    >
                      <option value="1">1 Frame / 1 sec (Dense)</option>
                      <option value="2">1 Frame / 2 sec (Recommended)</option>
                      <option value="5">1 Frame / 5 sec (Long-form)</option>
                      <option value="custom">Custom Interval (sec)</option>
                    </select>
                    {sampleIntervalMode === 'custom' && (
                      <input
                        type="number"
                        min="0.25"
                        step="0.25"
                        required
                        disabled={isSubmitting}
                        value={customSampleInterval}
                        onChange={(e) => {
                          setCustomSampleInterval(e.target.value);
                          setSampleInterval(e.target.value);
                        }}
                        placeholder="sec"
                        className="w-20 px-2.5 py-1.5 bg-slate-950 border border-cyan-500/60 rounded text-xs text-cyan-300 font-mono focus:outline-none"
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Internal Audit Notes</label>
                  <input
                    type="text"
                    disabled={isSubmitting}
                    value={auditNotes}
                    onChange={(e) => setAuditNotes(e.target.value)}
                    placeholder="e.g. Official SonyLIV broadcast rights package"
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
                          : mode === 'ott' && !file && !authorizedMezzanineUrl
                          ? 'Probing OTT webpage metadata & registering reference...'
                          : 'Processing reference media...'}
                      </span>
                    </div>
                    {uploadProgress && (
                      <span className="text-xs font-mono text-cyan-300">
                        {uploadProgress.percent.toFixed(1)}%
                      </span>
                    )}
                  </div>

                  {uploadProgress && (
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="bg-cyan-400 h-full transition-all duration-300"
                        style={{ width: `${uploadProgress.percent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setReplaceReferenceId(undefined);
                    onCloseRegisterModal();
                  }}
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
                          : 'Auto-Acquiring & Processing Video...') 
                      : replaceReferenceId
                      ? 'Attach Master & Compute Fingerprints'
                      : mode === 'upload' && file
                      ? 'Upload Master & Extract Reference Frames'
                      : (mode === 'ott' || mode === 'url') && urlInspection && !urlInspection.canAcquireAuthorized
                      ? `Register for Discovery Sweeps (${ottInitialStatus})`
                      : 'Auto-Acquire & Process Video'}
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
