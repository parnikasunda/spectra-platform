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

export async function fetchStats(): Promise<SystemStats> {
  const res = await fetch('/api/stats');
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch statistics');
  return json.data;
}

export async function fetchReferences(): Promise<ReferenceItem[]> {
  const res = await fetch('/api/references');
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch references');
  return json.data;
}

export async function fetchReferenceDetails(id: string): Promise<ReferenceItem> {
  const res = await fetch(`/api/references/${id}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch reference details');
  return json.data;
}

export async function deleteReference(id: string): Promise<boolean> {
  const res = await fetch(`/api/references/${id}`, { method: 'DELETE' });
  const json = await res.json();
  return json.success;
}

export async function registerReferenceUpload(formData: FormData): Promise<ReferenceItem> {
  const res = await fetch('/api/references/upload', {
    method: 'POST',
    body: formData
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to register reference upload');
  return json.data;
}

export async function registerReferenceUrl(payload: {
  title: string;
  rights_holder: string;
  asset_type: string;
  source_url: string;
  sample_interval_sec?: number;
  notes?: string;
}): Promise<ReferenceItem> {
  const res = await fetch('/api/references/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to register reference URL');
  return json.data;
}

export async function fetchDiscoveryJobs(): Promise<DiscoveryJob[]> {
  const res = await fetch('/api/discovery/jobs');
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch discovery jobs');
  return json.data;
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
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to launch discovery sweep');
  return json.data;
}

export async function fetchCandidates(filter?: { referenceId?: string; status?: string }): Promise<CandidateItem[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.status) params.append('status', filter.status);

  const res = await fetch(`/api/candidates?${params.toString()}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch candidates');
  return json.data;
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
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Candidate verification failed');
  return json.data;
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
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Quick inspection failed');
  return json.data;
}

export async function fetchEvidenceRecords(filter?: { referenceId?: string; matchStatus?: string }): Promise<EvidenceRecord[]> {
  const params = new URLSearchParams();
  if (filter?.referenceId) params.append('referenceId', filter.referenceId);
  if (filter?.matchStatus) params.append('matchStatus', filter.matchStatus);

  const res = await fetch(`/api/evidence?${params.toString()}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch evidence records');
  return json.data;
}

export async function fetchEvidenceById(id: string): Promise<EvidenceRecord> {
  const res = await fetch(`/api/evidence/${id}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch evidence record');
  return json.data;
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
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to submit review');
  return json.data;
}

export async function generateTakedownNotice(id: string): Promise<{ notice: string; evidenceId: string }> {
  const res = await fetch(`/api/evidence/${id}/takedown`, {
    method: 'POST'
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to generate takedown notice');
  return json.data;
}

export async function loadForensicFixtureSuite(): Promise<{ message: string; loadedReferences: number; loadedCandidates: number }> {
  const res = await fetch('/api/fixtures/load', { method: 'POST' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to load forensic test suite');
  return json;
}

export async function clearAllData(): Promise<void> {
  const res = await fetch('/api/fixtures/clear', { method: 'POST' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to reset database');
}
