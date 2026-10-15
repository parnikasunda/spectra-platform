/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Frontend API Client
 */

import { 
  SystemStats, 
  ReferenceItem, 
  DiscoveryJob, 
  CandidateItem, 
  EvidenceRecord 
} from './types/client.js';

/**
 * Robust JSON parser helper that guarantees safe error decoding
 * and prevents "Unexpected token '<'" exceptions.
 */
async function parseJsonResponse<T>(res: Response, fallbackError: string): Promise<T> {
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    const preview = text.replace(/<[^>]*>?/gm, '').trim().slice(0, 150);
    throw new Error(`${fallbackError} (HTTP ${res.status}): ${preview || 'Non-JSON server response'}`);
  }

  if (!res.ok || json.success === false || json.error) {
    throw new Error(json.error || json.message || fallbackError);
  }

  return (json.data !== undefined ? json.data : json) as T;
}

export async function fetchStats(): Promise<SystemStats> {
  const res = await fetch('/api/stats');
  return parseJsonResponse<SystemStats>(res, 'Failed to fetch statistics');
}

export async function fetchReferences(): Promise<ReferenceItem[]> {
  const res = await fetch('/api/references');
  return parseJsonResponse<ReferenceItem[]>(res, 'Failed to fetch references');
}

export async function fetchReferenceDetails(id: string): Promise<ReferenceItem> {
  const res = await fetch(`/api/references/${id}`);
  return parseJsonResponse<ReferenceItem>(res, 'Failed to fetch reference details');
}

export async function deleteReference(id: string): Promise<boolean> {
  const res = await fetch(`/api/references/${id}`, { method: 'DELETE' });
  const result = await parseJsonResponse<{ success: boolean }>(res, 'Failed to delete reference');
  return result.success;
}

/**
 * Sends multipart/form-data directly to POST /api/references without setting Content-Type header
 */
export async function registerReferenceUpload(formData: FormData): Promise<ReferenceItem> {
  const res = await fetch('/api/references', {
    method: 'POST',
    body: formData
    // DO NOT set 'Content-Type': 'application/json' or stringify FormData
  });
  return parseJsonResponse<ReferenceItem>(res, 'Failed to register reference upload');
}

export async function registerReferenceUrl(payload: {
  title: string;
  rightsHolder?: string;
  rights_holder?: string;
  assetType?: string;
  asset_type?: string;
  sourceUrl?: string;
  source_url?: string;
  sampleInterval?: number;
  sample_interval_sec?: number;
  auditNotes?: string;
  notes?: string;
}): Promise<ReferenceItem> {
  const res = await fetch('/api/references', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<ReferenceItem>(res, 'Failed to register reference URL');
}

export async function fetchDiscoveryJobs(): Promise<DiscoveryJob[]> {
  const res = await fetch('/api/discovery/jobs');
  return parseJsonResponse<DiscoveryJob[]>(res, 'Failed to fetch discovery jobs');
}

export async function launchDiscoveryJob(payload: {
  job_name: string;
  provider: string;
  target_reference_id?: string;
  query_keywords: string;
  filter_domain?: string;
  max_candidates?: number;
}): Promise<DiscoveryJob> {
  const res = await fetch('/api/discovery/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<DiscoveryJob>(res, 'Failed to launch discovery sweep');
}

export async function fetchCandidates(filter?: { referenceId?: string; status?: string }): Promise<CandidateItem[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.status) params.append('status', filter.status);

  const res = await fetch(`/api/candidates?${params.toString()}`);
  return parseJsonResponse<CandidateItem[]>(res, 'Failed to fetch candidates');
}

export async function verifyCandidate(candidateId: string, targetReferenceId?: string): Promise<{
  candidate: CandidateItem;
  evidenceRecord?: EvidenceRecord | null;
  logs: string[];
}> {
  const res = await fetch(`/api/candidates/verify/${candidateId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_reference_id: targetReferenceId })
  });
  return parseJsonResponse<{
    candidate: CandidateItem;
    evidenceRecord?: EvidenceRecord | null;
    logs: string[];
  }>(res, 'Candidate verification failed');
}

export async function quickInspectUrl(payload: {
  url: string;
  title?: string;
  target_reference_id?: string;
}): Promise<{
  candidate: CandidateItem;
  evidenceRecord?: EvidenceRecord | null;
  logs: string[];
}> {
  const res = await fetch('/api/candidates/quick-inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<{
    candidate: CandidateItem;
    evidenceRecord?: EvidenceRecord | null;
    logs: string[];
  }>(res, 'Quick inspection failed');
}

export async function fetchEvidenceRecords(filter?: { referenceId?: string; matchStatus?: string }): Promise<EvidenceRecord[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.matchStatus) params.append('matchStatus', filter.matchStatus);

  const res = await fetch(`/api/evidence?${params.toString()}`);
  return parseJsonResponse<EvidenceRecord[]>(res, 'Failed to fetch evidence records');
}

export async function fetchEvidenceById(id: string): Promise<EvidenceRecord> {
  const res = await fetch(`/api/evidence/${id}`);
  return parseJsonResponse<EvidenceRecord>(res, 'Failed to fetch evidence record');
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
  return parseJsonResponse<EvidenceRecord>(res, 'Failed to submit review');
}

export async function generateTakedownNotice(id: string): Promise<{ notice: string; evidenceId: string }> {
  const res = await fetch(`/api/evidence/${id}/takedown`, {
    method: 'POST'
  });
  return parseJsonResponse<{ notice: string; evidenceId: string }>(res, 'Failed to generate takedown notice');
}

export async function loadForensicFixtureSuite(): Promise<{ message: string; loadedReferences: number; loadedCandidates: number }> {
  const res = await fetch('/api/fixtures/load', { method: 'POST' });
  return parseJsonResponse<{ message: string; loadedReferences: number; loadedCandidates: number }>(res, 'Failed to load forensic test suite');
}

export async function clearAllData(): Promise<void> {
  const res = await fetch('/api/fixtures/clear', { method: 'POST' });
  await parseJsonResponse<{ success: boolean }>(res, 'Failed to reset database');
}
