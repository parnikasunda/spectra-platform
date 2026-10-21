/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Frontend API Client with Scalable Chunked Upload Architecture
 */

import { 
  SystemStats, 
  ReferenceItem, 
  DiscoveryJob, 
  CandidateItem, 
  EvidenceRecord 
} from './types/client.js';

export interface UploadConfig {
  maxUploadSizeMB: number;
  maxUploadSizeBytes: number;
  uploadChunkSizeMB: number;
  chunkSizeBytes: number;
  allowedExtensions: string[];
  mode: string;
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
 * Helper to safely parse responses and guarantee JSON error extraction.
 */
async function parseJsonResponse<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) {
    throw new Error(data.error || `Server error (${res.status})`);
  }
  return data.data !== undefined ? data.data : data;
}

/**
 * Fetch dynamic server upload configuration.
 */
export async function fetchUploadConfig(): Promise<UploadConfig> {
  try {
    const res = await fetch('/api/config/upload');
    return await parseJsonResponse<UploadConfig>(res);
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
    sampleInterval?: string | number;
    auditNotes?: string;
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
  const initRes = await fetch('/api/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'video/mp4',
      title: metadata.title,
      rightsHolder: metadata.rightsHolder,
      assetType: metadata.assetType || 'VOD_FEATURE',
      sampleInterval: metadata.sampleInterval || 2.0,
      auditNotes: metadata.auditNotes
    })
  });

  const initData = await parseJsonResponse<{ uploadId: string; chunkSize: number; totalChunks: number }>(initRes);
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

        const chunkRes = await fetch('/api/uploads/chunk', {
          method: 'POST',
          body: chunkFormData
        });

        await parseJsonResponse(chunkRes);
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
        await fetch(`/api/uploads/${uploadId}`, { method: 'DELETE' });
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

  const completeRes = await fetch('/api/uploads/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId })
  });

  const result = await parseJsonResponse<ReferenceItem>(completeRes);

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
    const response = await fetch('/api/references', {
      method: 'POST',
      body: payload
    });
    return await parseJsonResponse<ReferenceItem>(response);
  }

  // JSON Stream URL Mode
  const response = await fetch('/api/references', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' }
  });
  return await parseJsonResponse<ReferenceItem>(response);
}

// Backward-compatible aliases for existing callers
export const registerReferenceUpload = registerReference;
export const registerReferenceUrl = registerReference;

export async function fetchStats(): Promise<SystemStats> {
  const res = await fetch('/api/stats');
  return await parseJsonResponse<SystemStats>(res);
}

export async function fetchReferences(): Promise<ReferenceItem[]> {
  const res = await fetch('/api/references');
  return await parseJsonResponse<ReferenceItem[]>(res);
}

export async function fetchReferenceDetails(id: string): Promise<ReferenceItem> {
  const res = await fetch(`/api/references/${id}`);
  return await parseJsonResponse<ReferenceItem>(res);
}

export async function deleteReference(id: string): Promise<boolean> {
  const res = await fetch(`/api/references/${id}`, { method: 'DELETE' });
  const data = await parseJsonResponse<{ success: boolean }>(res);
  return Boolean(data?.success);
}

export async function fetchDiscoveryJobs(): Promise<DiscoveryJob[]> {
  const res = await fetch('/api/discovery/jobs');
  return await parseJsonResponse<DiscoveryJob[]>(res);
}

export async function launchDiscoveryJob(payload: {
  job_name: string;
  provider: string;
  target_reference_id?: string;
  query_keywords: string;
  filter_domain?: string;
  max_candidates?: number;
  auto_verify?: boolean;
}): Promise<DiscoveryJob> {
  const res = await fetch('/api/discovery/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse<DiscoveryJob>(res);
}

export async function fetchCandidates(filter?: { referenceId?: string; status?: string }): Promise<CandidateItem[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.status) params.append('status', filter.status);

  const res = await fetch(`/api/candidates?${params.toString()}`);
  return await parseJsonResponse<CandidateItem[]>(res);
}

export async function fetchCandidateById(candidateId: string): Promise<CandidateItem & { fingerprints?: FrameFingerprint[] }> {
  const res = await fetch(`/api/candidates/${candidateId}`);
  return await parseJsonResponse<CandidateItem & { fingerprints?: FrameFingerprint[] }>(res);
}

export async function verifyCandidate(candidateId: string, targetReferenceId?: string): Promise<{ candidate: CandidateItem; evidenceRecord?: EvidenceRecord }> {
  const res = await fetch(`/api/candidates/verify/${candidateId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_reference_id: targetReferenceId })
  });
  return await parseJsonResponse<{ candidate: CandidateItem; evidenceRecord?: EvidenceRecord }>(res);
}

export async function quickInspectCandidate(payload: {
  url: string;
  title?: string;
  target_reference_id?: string;
}): Promise<{ candidate: CandidateItem; evidenceRecord?: EvidenceRecord }> {
  const res = await fetch('/api/candidates/quick-inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse<{ candidate: CandidateItem; evidenceRecord?: EvidenceRecord }>(res);
}

export const quickInspectUrl = quickInspectCandidate;

export async function fetchEvidenceRecords(filter?: { referenceId?: string; matchStatus?: string }): Promise<EvidenceRecord[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.matchStatus) params.append('matchStatus', filter.matchStatus);

  const res = await fetch(`/api/evidence?${params.toString()}`);
  return await parseJsonResponse<EvidenceRecord[]>(res);
}

export async function fetchEvidenceById(id: string): Promise<EvidenceRecord> {
  const res = await fetch(`/api/evidence/${id}`);
  return await parseJsonResponse<EvidenceRecord>(res);
}

export async function submitEvidenceReview(
  id: string,
  payload: { decision: string; reviewed_by: string; notes?: string }
): Promise<EvidenceRecord> {
  const res = await fetch(`/api/evidence/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await parseJsonResponse<EvidenceRecord>(res);
}

export async function generateTakedownNotice(id: string): Promise<{ notice: string; evidenceId: string }> {
  const res = await fetch(`/api/evidence/${id}/takedown`, {
    method: 'POST'
  });
  return await parseJsonResponse<{ notice: string; evidenceId: string }>(res);
}

export async function loadForensicFixtureSuite(): Promise<{ message: string; loadedReferences: number; loadedCandidates: number }> {
  const res = await fetch('/api/fixtures/load', { method: 'POST' });
  return await parseJsonResponse<{ message: string; loadedReferences: number; loadedCandidates: number }>(res);
}

export async function clearAllData(): Promise<void> {
  const res = await fetch('/api/fixtures/clear', { method: 'POST' });
  await parseJsonResponse(res);
}
