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
 * 1. FIX src/api.ts: registerReference(payload)
 * - Checks if payload is an instance of FormData
 * - If FormData, DO NOT set 'Content-Type': 'application/json' or any manual Content-Type header.
 *   Let the browser automatically set multipart/form-data with boundary.
 * - Safe JSON parser wrapper that catches non-JSON HTML error responses.
 */
export async function registerReference(payload: FormData | Record<string, any>): Promise<any> {
  const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData;

  const response = await fetch('/api/references', {
    method: 'POST',
    body: isFormData ? payload : JSON.stringify(payload),
    headers: isFormData ? {} : { 'Content-Type': 'application/json' }
  });

  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Server returned non-JSON response (${response.status}): ${text.slice(0, 100)}`);
  }

  if (!response.ok) {
    throw new Error(data.error || `Server error ${response.status}`);
  }

  return data.data !== undefined ? data.data : data;
}

// Backward-compatible aliases for existing callers
export const registerReferenceUpload = registerReference;
export const registerReferenceUrl = registerReference;

export async function fetchStats(): Promise<SystemStats> {
  const res = await fetch('/api/stats');
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

export async function fetchReferences(): Promise<ReferenceItem[]> {
  const res = await fetch('/api/references');
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

export async function fetchReferenceDetails(id: string): Promise<ReferenceItem> {
  const res = await fetch(`/api/references/${id}`);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

export async function deleteReference(id: string): Promise<boolean> {
  const res = await fetch(`/api/references/${id}`, { method: 'DELETE' });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  return Boolean(data.success);
}

export async function fetchDiscoveryJobs(): Promise<DiscoveryJob[]> {
  const res = await fetch('/api/discovery/jobs');
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
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
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

export async function fetchCandidates(filter?: { referenceId?: string; status?: string }): Promise<CandidateItem[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.status) params.append('status', filter.status);

  const res = await fetch(`/api/candidates?${params.toString()}`);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
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
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
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
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

export async function fetchEvidenceRecords(filter?: { referenceId?: string; matchStatus?: string }): Promise<EvidenceRecord[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.matchStatus) params.append('matchStatus', filter.matchStatus);

  const res = await fetch(`/api/evidence?${params.toString()}`);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

export async function fetchEvidenceById(id: string): Promise<EvidenceRecord> {
  const res = await fetch(`/api/evidence/${id}`);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
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
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

export async function generateTakedownNotice(id: string): Promise<{ notice: string; evidenceId: string }> {
  const res = await fetch(`/api/evidence/${id}/takedown`, {
    method: 'POST'
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

export async function loadForensicFixtureSuite(): Promise<{ message: string; loadedReferences: number; loadedCandidates: number }> {
  const res = await fetch('/api/fixtures/load', { method: 'POST' });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

export async function clearAllData(): Promise<void> {
  const res = await fetch('/api/fixtures/clear', { method: 'POST' });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
}
