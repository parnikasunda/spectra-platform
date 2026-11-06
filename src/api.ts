/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Frontend API Client with Scalable Chunked Upload Architecture
 */

import { 
  SystemStats, 
  ReferenceItem, 
  DiscoveryJob, 
  CandidateItem, 
  EvidenceRecord,
  FrameFingerprint,
  ReferenceUrlInspectionResult,
  SourceAdapterDescriptor,
  AcquisitionWorkflowReport
} from './types/client.js';

export type { SourceAdapterDescriptor, AcquisitionWorkflowReport };

export interface UploadConfig {
  maxUploadSizeMB: number;
  maxUploadSizeBytes: number;
  uploadChunkSizeMB: number;
  chunkSizeBytes: number;
  allowedExtensions: string[];
  mode: string;
}

export interface ProviderIntegrationConfig {
  id: string;
  name: string;
  platform: string;
  status: 'IMPLEMENTED_ACTIVE' | 'AWAITING_CREDENTIALS_OR_MASTER';
  requiresCredentials: boolean;
  envVar?: string;
  credentialsConfigured: boolean;
  description: string;
}

export interface UploadProgress {
  percent: number;
  currentChunk: number;
  totalChunks: number;
  uploadedBytes: number;
  totalBytes: number;
  phase: 'initializing' | 'uploading' | 'assembling' | 'fingerprinting' | 'completed';
}

/**
 * Formats a clear, endpoint-specific diagnostic error message when an API endpoint
 * returns an HTML document or non-JSON payload instead of expected JSON.
 * Never dumps raw "<!doctype html>" markup into the user interface.
 */
export function formatNonJsonApiError(
  status: number,
  bodyText: string,
  context?: { method?: string; endpoint?: string; responseUrl?: string; redirected?: boolean }
): string {
  const method = (context?.method || 'GET').toUpperCase();
  const endpoint = context?.endpoint || context?.responseUrl || '/api';
  const trimmed = (bodyText || '').trim();
  const isHtml = /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed) || /<head[\s>]|<body[\s>]/i.test(trimmed);

  if (isHtml) {
    const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || '';

    if (/starting server/i.test(pageTitle)) {
      return `API request ${method} ${endpoint} received a server warmup page (HTTP ${status}: "${pageTitle}") instead of JSON. The backend server is still starting or restarting — please retry in a few seconds.`;
    }
    if (/cookie check/i.test(pageTitle) || (context?.redirected && context?.responseUrl?.includes('__cookie_check'))) {
      return `API request ${method} ${endpoint} was intercepted by an authentication session check (HTTP ${status}). Please refresh the browser tab and try again.`;
    }
    return `API endpoint ${method} ${endpoint} returned an unexpected HTML document (HTTP ${status}${
      pageTitle ? ` — "${pageTitle}"` : ''
    }) instead of JSON. Ensure the request targets a valid backend /api route and the Express server is running.`;
  }

  const preview = trimmed.replace(/\s+/g, ' ').slice(0, 100);
  return `API endpoint ${method} ${endpoint} returned a non-JSON response (HTTP ${status})${
    preview ? `: ${preview}` : '.'
  }`;
}

function isTransientWarmupHtml(status: number, text: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  const trimmed = (text || '').trim();
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html/i.test(trimmed)) {
    if (/<title[^>]*>\s*Starting Server\.\.\.\s*<\/title>/i.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Wrapper around fetch that sets JSON headers and automatically retries if the reverse proxy
 * transiently returns the "Starting Server..." warmup HTML page (HTTP 200/502/503/504).
 */
async function apiFetch(endpoint: string, init?: RequestInit): Promise<{ res: Response; text: string; method: string; endpoint: string }> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (!headers.has('X-Requested-With')) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }

  const maxAttempts = 3;
  let lastRes: Response | null = null;
  let lastText = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(endpoint, {
      ...init,
      headers
    });
    const text = await res.text();
    lastRes = res;
    lastText = text;

    if (attempt < maxAttempts && isTransientWarmupHtml(res.status, text)) {
      await new Promise(r => setTimeout(r, attempt * 1000));
      continue;
    }
    break;
  }

  return {
    res: lastRes!,
    text: lastText,
    method,
    endpoint
  };
}

/**
 * Helper to safely parse responses and guarantee structured JSON error extraction.
 */
export async function parseJsonResponse<T = any>(
  resOrFetched: Response | { res: Response; text: string; method?: string; endpoint?: string },
  context?: { method?: string; endpoint?: string }
): Promise<T> {
  let res: Response;
  let text: string;
  let method = context?.method;
  let endpoint = context?.endpoint;

  if ('res' in resOrFetched && 'text' in resOrFetched) {
    res = resOrFetched.res;
    text = resOrFetched.text;
    method = method || resOrFetched.method;
    endpoint = endpoint || resOrFetched.endpoint;
  } else {
    res = resOrFetched;
    text = await res.text();
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      formatNonJsonApiError(res.status, text, {
        method,
        endpoint: endpoint || res.url || '/api',
        responseUrl: res.url,
        redirected: res.redirected
      })
    );
  }
  if (!res.ok) {
    const err = new Error(data.error || `API request ${(method || 'GET').toUpperCase()} ${endpoint || '/api'} failed (${res.status})`) as Error & {
      acquisitionStatus?: string;
      inspection?: ReferenceUrlInspectionResult;
      reference?: ReferenceItem;
      workflow?: AcquisitionWorkflowReport;
      endpoint?: string;
      statusCode?: number;
    };
    err.acquisitionStatus = data.acquisitionStatus;
    err.inspection = data.inspection;
    err.reference = data.data;
    err.workflow = data.workflow || data.inspection?.workflow;
    err.endpoint = `${(method || 'GET').toUpperCase()} ${endpoint || '/api'}`;
    err.statusCode = res.status;
    throw err;
  }
  if (data && typeof data === 'object' && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    if (data.workflow && data.data.workflow === undefined) data.data.workflow = data.workflow;
    if (data.inspection && data.data.inspection === undefined) data.data.inspection = data.inspection;
    if (data.attemptedMethods && data.data.attemptedMethods === undefined) data.data.attemptedMethods = data.attemptedMethods;
  }
  return data.data !== undefined ? data.data : data;
}

/**
 * Fetch dynamic server upload configuration.
 */
export async function fetchUploadConfig(): Promise<UploadConfig> {
  try {
    const fetched = await apiFetch('/api/config/upload');
    return await parseJsonResponse<UploadConfig>(fetched);
  } catch {
    // Fallback defaults if offline or starting up
    return {
      maxUploadSizeMB: 500,
      maxUploadSizeBytes: 500 * 1024 * 1024,
      uploadChunkSizeMB: 5,
      chunkSizeBytes: 5 * 1024 * 1024,
      allowedExtensions: ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.ts', '.m4v'],
      mode: 'chunked'
    };
  }
}

/**
 * Fetch OTT content-provider integration statuses.
 */
export async function fetchProviderIntegrations(): Promise<ProviderIntegrationConfig[]> {
  try {
    const fetched = await apiFetch('/api/config/providers');
    return await parseJsonResponse<ProviderIntegrationConfig[]>(fetched);
  } catch {
    return [];
  }
}

/**
 * Fetch configurable source-adapter registry (YouTube, Dailymotion, Vimeo, Public Video Platforms, Direct MP4, HLS, DASH, Authorized OTT).
 */
export async function fetchSourceAdapters(): Promise<SourceAdapterDescriptor[]> {
  try {
    const fetched = await apiFetch('/api/source-adapters');
    return await parseJsonResponse<SourceAdapterDescriptor[]>(fetched);
  } catch {
    return [];
  }
}

/**
 * Update a source adapter configuration (e.g. toggle enabled or resumable downloads).
 */
export async function updateSourceAdapter(
  id: string,
  patch: { enabled?: boolean; supportsResumableDownload?: boolean }
): Promise<SourceAdapterDescriptor> {
  const fetched = await apiFetch(`/api/source-adapters/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  return await parseJsonResponse<SourceAdapterDescriptor>(fetched);
}

/**
 * Scalable Chunked Video Upload:
 * Slices large files (e.g. 36.03MB) into ~5MB safe chunks,
 * completely bypassing 32MB reverse-proxy / serverless limits.
 */
export async function uploadChunkedVideoReference(
  file: File,
  metadata: {
    title: string;
    rightsHolder: string;
    assetType?: string;
    platform?: string;
    seasonEpisodeInfo?: string;
    sourceUrl?: string;
    sampleInterval?: string | number;
    auditNotes?: string;
    replaceReferenceId?: string;
  },
  onProgress?: (progress: UploadProgress) => void
): Promise<ReferenceItem> {
  const config = await fetchUploadConfig();

  if (file.size > config.maxUploadSizeBytes) {
    throw new Error(
      `File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${config.maxUploadSizeMB} MB`
    );
  }

  onProgress?.({
    percent: 0,
    currentChunk: 0,
    totalChunks: Math.ceil(file.size / config.chunkSizeBytes),
    uploadedBytes: 0,
    totalBytes: file.size,
    phase: 'initializing'
  });

  // Step 1: Initialize Upload Session
  const initFetched = await apiFetch('/api/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'video/mp4',
      title: metadata.title,
      rightsHolder: metadata.rightsHolder,
      assetType: metadata.assetType || 'VOD_FEATURE',
      platform: metadata.platform,
      seasonEpisodeInfo: metadata.seasonEpisodeInfo,
      sourceUrl: metadata.sourceUrl,
      sampleInterval: metadata.sampleInterval || 2.0,
      auditNotes: metadata.auditNotes,
      replaceReferenceId: metadata.replaceReferenceId
    })
  });

  const initData = await parseJsonResponse<{ uploadId: string; chunkSize: number; totalChunks: number }>(initFetched);
  const { uploadId, chunkSize, totalChunks } = initData;

  // Step 2: Upload chunks sequentially with automatic retry
  let uploadedBytes = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunkBlob = file.slice(start, end);

    let attempts = 0;
    let chunkUploaded = false;
    let lastError: Error | null = null;

    while (attempts < 3 && !chunkUploaded) {
      attempts++;
      try {
        const chunkFormData = new FormData();
        chunkFormData.append('uploadId', uploadId);
        chunkFormData.append('chunkIndex', String(chunkIndex));
        chunkFormData.append('totalChunks', String(totalChunks));
        chunkFormData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);

        const chunkFetched = await apiFetch('/api/uploads/chunk', {
          method: 'POST',
          body: chunkFormData
        });

        await parseJsonResponse(chunkFetched);
        chunkUploaded = true;
      } catch (err: any) {
        lastError = err;
        // Wait 500ms before retry
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!chunkUploaded) {
      // Abort session on server
      try {
        await apiFetch(`/api/uploads/${uploadId}`, { method: 'DELETE' });
      } catch {}
      throw new Error(`Failed to upload chunk ${chunkIndex + 1} of ${totalChunks}: ${lastError?.message || 'Network error'}`);
    }

    uploadedBytes += (end - start);
    const progressPercent = Math.min(99, Number(((uploadedBytes / file.size) * 100).toFixed(1)));

    onProgress?.({
      percent: progressPercent,
      currentChunk: chunkIndex + 1,
      totalChunks,
      uploadedBytes,
      totalBytes: file.size,
      phase: chunkIndex + 1 === totalChunks ? 'assembling' : 'uploading'
    });
  }

  // Step 3: Complete upload and trigger processing pipeline
  onProgress?.({
    percent: 99,
    currentChunk: totalChunks,
    totalChunks,
    uploadedBytes: file.size,
    totalBytes: file.size,
    phase: 'fingerprinting'
  });

  const completeFetched = await apiFetch('/api/uploads/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId })
  });

  const result = await parseJsonResponse<ReferenceItem>(completeFetched);

  onProgress?.({
    percent: 100,
    currentChunk: totalChunks,
    totalChunks,
    uploadedBytes: file.size,
    totalBytes: file.size,
    phase: 'completed'
  });

  return result;
}

/**
 * Universal Reference Registration:
 * If payload is FormData with a File, intelligently uses the chunked upload pipeline.
 * If payload is a stream URL, sends standard JSON.
 */
export async function registerReference(
  payload: FormData | Record<string, any>,
  onProgress?: (progress: UploadProgress) => void
): Promise<ReferenceItem> {
  const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData;

  if (isFormData) {
    const file = payload.get('file');
    // If a File instance is present in the browser, use Chunked Upload
    if (file && typeof File !== 'undefined' && file instanceof File) {
      const title = String(payload.get('title') || file.name);
      const rightsHolder = String(payload.get('rightsHolder') || payload.get('rights_holder') || 'Proprietary');
      const assetType = String(payload.get('assetType') || payload.get('asset_type') || 'VOD_FEATURE');
      const sampleInterval = payload.get('sampleInterval') || payload.get('sample_interval_sec') || '2';
      const auditNotes = payload.get('auditNotes') || payload.get('notes') ? String(payload.get('auditNotes') || payload.get('notes')) : undefined;

      return await uploadChunkedVideoReference(
        file,
        {
          title,
          rightsHolder,
          assetType,
          sampleInterval: String(sampleInterval),
          auditNotes
        },
        onProgress
      );
    }

    // Fallback for non-File FormData (e.g. Node environments or mock tests)
    const fetched = await apiFetch('/api/references', {
      method: 'POST',
      body: payload
    });
    return await parseJsonResponse<ReferenceItem>(fetched);
  }

  // JSON Stream / Webpage URL Mode
  const fetched = await apiFetch('/api/references', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' }
  });
  return await parseJsonResponse<ReferenceItem>(fetched);
}

// Backward-compatible aliases for existing callers
export const registerReferenceUpload = registerReference;
export const registerReferenceUrl = registerReference;

export async function fetchStats(): Promise<SystemStats> {
  const fetched = await apiFetch('/api/stats', { cache: 'no-store' });
  return await parseJsonResponse<SystemStats>(fetched);
}

export async function fetchReferences(): Promise<ReferenceItem[]> {
  const fetched = await apiFetch('/api/references', { cache: 'no-store' });
  return await parseJsonResponse<ReferenceItem[]>(fetched);
}

export async function fetchReferenceDetails(id: string): Promise<ReferenceItem> {
  const fetched = await apiFetch(`/api/references/${id}`, { cache: 'no-store' });
  return await parseJsonResponse<ReferenceItem>(fetched);
}

export async function fetchReferenceFrames(
  id: string,
  params?: { offset?: number; limit?: number; minTime?: number; maxTime?: number }
): Promise<{
  frames: FrameFingerprint[];
  totalFrames: number;
  expectedFrames: number;
  extractedFrames: number;
  durationSec: number;
  sampleIntervalSec: number;
  extractionStatus: string;
  firstTimestampSec: number | null;
  lastTimestampSec: number | null;
  offset: number;
  limit: number;
}> {
  const qs = new URLSearchParams();
  if (params?.offset !== undefined) qs.set('offset', String(params.offset));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.minTime !== undefined) qs.set('minTime', String(params.minTime));
  if (params?.maxTime !== undefined) qs.set('maxTime', String(params.maxTime));
  const fetched = await apiFetch(`/api/references/${id}/frames?${qs.toString()}`, { cache: 'no-store' });
  return await parseJsonResponse(fetched);
}

export async function extractReferenceFrames(
  id: string,
  options?: { sampleInterval?: number; resume?: boolean }
): Promise<any> {
  const endpoint = `/api/references/${id}/extract-frames`;
  const fetched = await apiFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options || {})
  });
  let parsed: any;
  try {
    parsed = JSON.parse(fetched.text);
  } catch {
    throw new Error(
      formatNonJsonApiError(fetched.res.status, fetched.text, {
        method: 'POST',
        endpoint,
        responseUrl: fetched.res.url,
        redirected: fetched.res.redirected
      })
    );
  }
  if (!fetched.res.ok) {
    throw new Error(parsed.error || `Failed to extract reference frames (${fetched.res.status})`);
  }
  return parsed;
}

export async function repairReferenceFrames(
  id: string
): Promise<{
  audit: any;
  data: ReferenceItem | null;
}> {
  const endpoint = `/api/references/${id}/repair-frames`;
  const fetched = await apiFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  let parsed: any;
  try {
    parsed = JSON.parse(fetched.text);
  } catch {
    throw new Error(
      formatNonJsonApiError(fetched.res.status, fetched.text, {
        method: 'POST',
        endpoint,
        responseUrl: fetched.res.url,
        redirected: fetched.res.redirected
      })
    );
  }
  if (!fetched.res.ok) {
    throw new Error(parsed.error || `Failed to repair reference frame images (${fetched.res.status})`);
  }
  return {
    audit: parsed.audit || null,
    data: parsed.data || null
  };
}

export async function auditAllReferenceFrames(): Promise<{
  audits: any[];
  references: ReferenceItem[];
}> {
  const fetched = await apiFetch('/api/references/audit-frames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return await parseJsonResponse(fetched);
}

export async function deleteReference(id: string): Promise<boolean> {
  const fetched = await apiFetch(`/api/references/${id}`, { method: 'DELETE' });
  const data = await parseJsonResponse<{ success: boolean }>(fetched);
  return Boolean(data?.success);
}

export async function inspectReferenceUrl(
  url: string,
  referenceId?: string
): Promise<{
  inspection: ReferenceUrlInspectionResult;
  reference?: ReferenceItem | null;
  workflow?: AcquisitionWorkflowReport;
}> {
  const endpoint = referenceId ? `/api/references/${referenceId}/inspect-url` : '/api/references/inspect-url';
  const fetched = await apiFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, referenceId })
  });
  let parsed: any;
  try {
    parsed = JSON.parse(fetched.text);
  } catch {
    throw new Error(
      formatNonJsonApiError(fetched.res.status, fetched.text, {
        method: 'POST',
        endpoint,
        responseUrl: fetched.res.url,
        redirected: fetched.res.redirected
      })
    );
  }
  if (!fetched.res.ok) {
    throw new Error(parsed.error || `Failed to inspect URL via POST ${endpoint} (${fetched.res.status})`);
  }
  return {
    inspection: parsed.data,
    reference: parsed.reference || null,
    workflow: parsed.workflow || parsed.data?.workflow
  };
}

export async function attachAuthorizedMediaToReference(
  id: string,
  payload: {
    authorizedMediaUrl?: string;
    referenceWebpageUrl?: string;
    sourceUrl?: string;
    authorizationConfirmed?: boolean;
    authorizationProvenance?: string;
    providerId?: string;
    sampleInterval?: number;
    platform?: string;
    seasonEpisodeInfo?: string;
    notes?: string;
  }
): Promise<ReferenceItem> {
  const fetched = await apiFetch(`/api/references/${id}/attach-media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse<ReferenceItem>(fetched);
}

/**
 * Automatically acquires and processes video from the reference's stored source_url
 * (or an optional updated URL) without creating duplicate references.
 */
export async function acquireReferenceMediaFromUrl(
  id: string,
  options?: {
    url?: string;
    sampleInterval?: number;
    authorizationConfirmed?: boolean;
    authorizationProvenance?: string;
  }
): Promise<{
  reference: ReferenceItem;
  workflow?: AcquisitionWorkflowReport;
  inspection?: ReferenceUrlInspectionResult;
  message?: string;
}> {
  const endpoint = `/api/references/${encodeURIComponent(id)}/acquire-media`;
  const fetched = await apiFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: options?.url,
      sampleInterval: options?.sampleInterval,
      authorizationConfirmed: options?.authorizationConfirmed ?? true,
      authorizationProvenance: options?.authorizationProvenance || 'RIGHTS_HOLDER_DIRECT_AUTHORIZATION'
    })
  });
  let parsed: any;
  try {
    parsed = JSON.parse(fetched.text);
  } catch {
    throw new Error(
      formatNonJsonApiError(fetched.res.status, fetched.text, {
        method: 'POST',
        endpoint,
        responseUrl: fetched.res.url,
        redirected: fetched.res.redirected
      })
    );
  }
  if (!fetched.res.ok) {
    const err = new Error(parsed.error || `Failed to automatically acquire media (${fetched.res.status})`) as Error & {
      workflow?: AcquisitionWorkflowReport;
      inspection?: ReferenceUrlInspectionResult;
      reference?: ReferenceItem;
    };
    err.workflow = parsed.workflow || parsed.inspection?.workflow;
    err.inspection = parsed.inspection;
    err.reference = parsed.data;
    throw err;
  }
  return {
    reference: parsed.data,
    workflow: parsed.workflow || parsed.inspection?.workflow,
    inspection: parsed.inspection,
    message: parsed.message
  };
}

export async function transitionReferenceStatus(
  id: string,
  payload: {
    status?: 'METADATA_REGISTERED' | 'AWAITING_AUTHORIZED_MEDIA';
    platform?: string;
    seasonEpisodeInfo?: string;
    title?: string;
    rightsHolder?: string;
    notes?: string;
  }
): Promise<ReferenceItem> {
  const fetched = await apiFetch(`/api/references/${id}/transition-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse<ReferenceItem>(fetched);
}

export async function fetchDiscoverySources(): Promise<import('./types/client.js').DiscoverySourceRecord[]> {
  const fetched = await apiFetch('/api/discovery/sources', { cache: 'no-store' });
  return await parseJsonResponse(fetched);
}

export async function registerDiscoverySource(payload: {
  name?: string;
  url: string;
  source_type?: string;
  enabled?: boolean;
}): Promise<import('./types/client.js').DiscoverySourceRecord> {
  const fetched = await apiFetch('/api/discovery/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse(fetched);
}

export async function toggleDiscoverySource(
  id: string,
  enabled: boolean
): Promise<import('./types/client.js').DiscoverySourceRecord> {
  const fetched = await apiFetch(`/api/discovery/sources/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
  return await parseJsonResponse(fetched);
}

export async function scanDiscoverySource(
  id: string,
  payload?: {
    target_reference_id?: string;
    query_keywords?: string;
    auto_verify?: boolean;
  }
): Promise<{
  source: import('./types/client.js').DiscoverySourceRecord;
  job: DiscoveryJob;
  candidates: CandidateItem[];
}> {
  const fetched = await apiFetch(`/api/discovery/sources/${id}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  return await parseJsonResponse(fetched);
}

export async function fetchDiscoveryConfig(params?: {
  title?: string;
  seasonEpisodeInfo?: string;
  assetType?: string;
}): Promise<{
  defaultSeedSources: string[];
  configuredSeedSources: string[];
  discoverySources?: import('./types/client.js').DiscoverySourceRecord[];
  standardKeywordVariations: string[];
  lastSeedProbes: any[];
  previewCombinations: string[];
}> {
  const qs = new URLSearchParams();
  if (params?.title) qs.append('title', params.title);
  if (params?.seasonEpisodeInfo) qs.append('seasonEpisodeInfo', params.seasonEpisodeInfo);
  if (params?.assetType) qs.append('assetType', params.assetType);
  const fetched = await apiFetch(`/api/discovery/config?${qs.toString()}`);
  return await parseJsonResponse(fetched);
}

export async function probeDiscoverySeeds(seedSources?: string[]): Promise<{
  configuredSeedSources: string[];
  seedProbes: any[];
  discoverySources?: import('./types/client.js').DiscoverySourceRecord[];
}> {
  const fetched = await apiFetch('/api/discovery/seeds/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed_sources: seedSources })
  });
  return await parseJsonResponse(fetched);
}

export async function fetchSearchCoverage(params?: {
  referenceId?: string;
  jobId?: string;
  presetMode?: string;
  maxUniqueCandidates?: number;
  deepResearchLimit?: number;
  forensicComparisonLimit?: number;
}): Promise<import('./types/client.js').SearchCoverageReport> {
  const qs = new URLSearchParams();
  if (params?.referenceId) qs.set('referenceId', params.referenceId);
  if (params?.jobId) qs.set('jobId', params.jobId);
  if (params?.presetMode) qs.set('presetMode', params.presetMode);
  if (params?.maxUniqueCandidates !== undefined) qs.set('maxUniqueCandidates', String(params.maxUniqueCandidates));
  if (params?.deepResearchLimit !== undefined) qs.set('deepResearchLimit', String(params.deepResearchLimit));
  if (params?.forensicComparisonLimit !== undefined) {
    qs.set('forensicComparisonLimit', String(params.forensicComparisonLimit));
  }
  const fetched = await apiFetch(`/api/discovery/coverage?${qs.toString()}`, { cache: 'no-store' });
  return await parseJsonResponse(fetched);
}

export async function toggleDiscoveryEcosystem(
  id: string,
  enabled: boolean,
  referenceId?: string
): Promise<import('./types/client.js').SearchCoverageReport> {
  const fetched = await apiFetch(`/api/discovery/ecosystems/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, referenceId })
  });
  return await parseJsonResponse(fetched);
}

export async function expandDiscoveryInvestigation(payload: {
  job_id?: string;
  reference_id?: string;
  preset_mode?: import('./types/client.js').DiscoveryPresetMode;
  max_unique_candidates?: number;
  deep_research_limit?: number;
  forensic_comparison_limit?: number;
  run_additional_discovery?: boolean;
  auto_verify?: boolean;
}): Promise<{
  job: DiscoveryJob | null;
  reusedResearchCount: number;
  newlyResearchedCount: number;
  reusedComparisonCount: number;
  newlyComparedCount: number;
  awaitingResearchRemaining: number;
  queuedComparisonRemaining: number;
  coverageReport: import('./types/client.js').SearchCoverageReport;
}> {
  const endpoint = payload.job_id
    ? `/api/discovery/jobs/${encodeURIComponent(payload.job_id)}/expand`
    : '/api/discovery/expand';
  const fetched = await apiFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse(fetched);
}

export async function batchResearchCandidates(payload: {
  candidate_ids?: string[];
  reference_id?: string;
  deep_research_limit?: number;
  forensic_comparison_limit?: number;
  run_deep_research?: boolean;
  run_forensic_comparison?: boolean;
}): Promise<{
  reusedResearchCount: number;
  newlyResearchedCount: number;
  reusedComparisonCount: number;
  newlyComparedCount: number;
  processedCandidates: CandidateItem[];
  coverageReport: import('./types/client.js').SearchCoverageReport;
}> {
  const fetched = await apiFetch('/api/candidates/research-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse(fetched);
}

export async function fetchDiscoveryJobs(): Promise<DiscoveryJob[]> {
  const fetched = await apiFetch('/api/discovery/jobs');
  return await parseJsonResponse<DiscoveryJob[]>(fetched);
}

export async function launchDiscoveryJob(payload: {
  job_name: string;
  provider: string;
  target_reference_id?: string;
  query_keywords: string;
  filter_domain?: string;
  preset_mode?: import('./types/client.js').DiscoveryPresetMode;
  max_candidates?: number;
  max_unique_candidates?: number;
  deep_research_limit?: number;
  forensic_comparison_limit?: number;
  auto_verify?: boolean;
  keyword_variations?: string[];
  seed_sources?: string[];
}): Promise<DiscoveryJob> {
  const fetched = await apiFetch('/api/discovery/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse<DiscoveryJob>(fetched);
}

export async function fetchCandidates(filter?: { referenceId?: string; status?: string }): Promise<CandidateItem[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.status) params.append('status', filter.status);

  const fetched = await apiFetch(`/api/candidates?${params.toString()}`);
  return await parseJsonResponse<CandidateItem[]>(fetched);
}

export async function fetchCandidateById(candidateId: string): Promise<CandidateItem & { fingerprints?: FrameFingerprint[] }> {
  const fetched = await apiFetch(`/api/candidates/${candidateId}`);
  return await parseJsonResponse<CandidateItem & { fingerprints?: FrameFingerprint[] }>(fetched);
}

export async function verifyCandidate(candidateId: string, targetReferenceId?: string): Promise<{ candidate: CandidateItem; evidenceRecord?: EvidenceRecord }> {
  const fetched = await apiFetch(`/api/candidates/verify/${candidateId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_reference_id: targetReferenceId })
  });
  return await parseJsonResponse<{ candidate: CandidateItem; evidenceRecord?: EvidenceRecord }>(fetched);
}

export async function quickInspectCandidate(payload: {
  url: string;
  title?: string;
  target_reference_id?: string;
}): Promise<{ candidate: CandidateItem; evidenceRecord?: EvidenceRecord }> {
  const fetched = await apiFetch('/api/candidates/quick-inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse<{ candidate: CandidateItem; evidenceRecord?: EvidenceRecord }>(fetched);
}

export const quickInspectUrl = quickInspectCandidate;

export async function fetchEvidenceRecords(filter?: { referenceId?: string; matchStatus?: string }): Promise<EvidenceRecord[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.matchStatus) params.append('matchStatus', filter.matchStatus);

  const fetched = await apiFetch(`/api/evidence?${params.toString()}`);
  return await parseJsonResponse<EvidenceRecord[]>(fetched);
}

export async function fetchEvidenceById(id: string): Promise<EvidenceRecord> {
  const fetched = await apiFetch(`/api/evidence/${id}`);
  return await parseJsonResponse<EvidenceRecord>(fetched);
}

export async function submitEvidenceReview(
  id: string,
  payload: { decision: string; reviewed_by: string; notes?: string }
): Promise<EvidenceRecord> {
  const fetched = await apiFetch(`/api/evidence/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse<EvidenceRecord>(fetched);
}

export async function generateTakedownNotice(id: string): Promise<{ notice: string; evidenceId: string }> {
  const fetched = await apiFetch(`/api/evidence/${id}/takedown`, {
    method: 'POST'
  });
  return await parseJsonResponse<{ notice: string; evidenceId: string }>(fetched);
}

export async function loadForensicFixtureSuite(): Promise<{ message: string; loadedReferences: number; loadedCandidates: number }> {
  const fetched = await apiFetch('/api/fixtures/load', { method: 'POST' });
  return await parseJsonResponse<{ message: string; loadedReferences: number; loadedCandidates: number }>(fetched);
}

export async function clearAllData(): Promise<void> {
  const fetched = await apiFetch('/api/fixtures/clear', { method: 'POST' });
  await parseJsonResponse(fetched);
}

