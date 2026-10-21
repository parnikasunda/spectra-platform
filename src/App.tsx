/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Root Application Component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar.js';
import { OverviewView } from './components/OverviewView.js';
import { ReferenceLibraryView } from './components/ReferenceLibraryView.js';
import { DiscoverySweepsView } from './components/DiscoverySweepsView.js';
import { CandidateMatrixView } from './components/CandidateMatrixView.js';
import { EvidenceVaultView } from './components/EvidenceVaultView.js';
import { LiveSportsMonitorView } from './components/LiveSportsMonitorView.js';

import { 
  fetchStats, 
  fetchReferences, 
  fetchDiscoveryJobs, 
  fetchCandidates, 
  fetchEvidenceRecords,
  deleteReference,
  registerReferenceUpload,
  registerReferenceUrl,
  launchDiscoveryJob,
  verifyCandidate,
  quickInspectUrl,
  loadForensicFixtureSuite,
  clearAllData
} from './api.js';

import { 
  SystemStats, 
  ReferenceItem, 
  DiscoveryJob, 
  CandidateItem, 
  EvidenceRecord 
} from './types/client.js';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('overview');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceRecord[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRecord | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const loadAllData = useCallback(async () => {
    try {
      const [s, r, j, c, e] = await Promise.all([
        fetchStats().catch(() => null),
        fetchReferences().catch(() => []),
        fetchDiscoveryJobs().catch(() => []),
        fetchCandidates().catch(() => []),
        fetchEvidenceRecords().catch(() => [])
      ]);
      if (s) setStats(s);
      setReferences(r);
      setJobs(j);
      setCandidates(c);
      setEvidenceRecords(e);
      if (e.length > 0 && !selectedEvidence) {
        const preferred = e.find(item => item.id === 'ev_ts_youtube_fullcopy') || 
                          e.find(item => item.sample_pairs && item.sample_pairs.length > 0) || 
                          e[0];
        setSelectedEvidence(preferred);
      }
    } catch (err) {
      console.error('Failed to load system state:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedEvidence]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleLoadSampleSuite = async () => {
    setIsLoadingSample(true);
    try {
      const res = await loadForensicFixtureSuite();
      showNotification(`${res.message}: Seeded ${res.loadedReferences} reference items and ${res.loadedCandidates} candidates across all edge cases.`, 'success');
      await loadAllData();
    } catch (err: any) {
      showNotification(`Failed to load test suite: ${err.message}`, 'error');
    } finally {
      setIsLoadingSample(false);
    }
  };

  const handleResetDb = async () => {
    if (!confirm('Are you sure you want to reset the database? All records and evidence dossiers will be cleared.')) {
      return;
    }
    try {
      await clearAllData();
      showNotification('Database cleared to pristine empty state.', 'info');
      await loadAllData();
    } catch (err: any) {
      showNotification(`Failed to clear database: ${err.message}`, 'error');
    }
  };

  const handleDeleteReference = async (id: string) => {
    if (!confirm('Delete this reference media item and all associated fingerprints?')) return;
    try {
      await deleteReference(id);
      showNotification('Reference item deleted.', 'info');
      await loadAllData();
    } catch (err: any) {
      showNotification(`Delete error: ${err.message}`, 'error');
    }
  };

  const handleRegisterUpload = async (formData: FormData) => {
    const item = await registerReferenceUpload(formData);
    showNotification('Reference video uploaded and perceptual fingerprints generated.', 'success');
    await loadAllData();
    return item;
  };

  const handleRegisterUrl = async (payload: any) => {
    const item = await registerReferenceUrl(payload);
    showNotification('Reference stream registered and frame fingerprints computed.', 'success');
    await loadAllData();
    return item;
  };

  const handleLaunchSweep = async (payload: any) => {
    const job = await launchDiscoveryJob(payload);
    showNotification(`Discovery sweep "${job.name}" completed. Found ${job.candidates_found} candidates.`, 'success');
    await loadAllData();
  };

  const handleVerifyCandidate = async (candidateId: string, targetReferenceId?: string) => {
    const result = await verifyCandidate(candidateId, targetReferenceId);
    showNotification(`Candidate verified: ${result.candidate.pipeline_status}`, 'success');
    await loadAllData();
    return result;
  };

  const handleQuickInspect = async (payload: any) => {
    const result = await quickInspectUrl(payload);
    showNotification(`Ad-hoc inspection completed: ${result.candidate.pipeline_status}`, 'success');
    await loadAllData();
    return result;
  };

  const handleLiveSportsSweep = async () => {
    const sportsRef = references.find(r => r.asset_type === 'LIVE_SPORTS') || references[0];
    const keywords = sportsRef ? sportsRef.title : 'Live Sports Champions League Final';
    showNotification(`Executing automated live sports surveillance sweep for "${keywords}"...`, 'info');
    try {
      const job = await launchDiscoveryJob({
        job_name: `Live Event Surveillance: ${keywords.slice(0, 24)}`,
        provider: 'SPORTS_DIRECTORY',
        target_reference_id: sportsRef?.id,
        query_keywords: keywords,
        max_candidates: 6
      });
      showNotification(`Live sweep complete! Found ${job.candidates_found} active streams with broadcast delay analysis.`, 'success');
      await loadAllData();
    } catch (err: any) {
      showNotification(`Live sweep error: ${err.message}`, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Navigation */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
        onLoadSampleSuite={handleLoadSampleSuite}
        onResetDb={handleResetDb}
        isLoadingSample={isLoadingSample}
      />

      {/* Global Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className={`px-4 py-2.5 rounded-lg border text-xs shadow-xl flex items-center gap-2.5 font-medium ${
            notification.type === 'success'
              ? 'bg-slate-900 border-emerald-500/60 text-emerald-300'
              : (notification.type === 'error' ? 'bg-slate-900 border-rose-500/60 text-rose-300' : 'bg-slate-900 border-cyan-500/60 text-cyan-300')
          }`}>
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {isLoading ? (
          <div className="py-24 text-center text-slate-500 text-xs font-mono">
            Loading Argus intelligence state from database...
          </div>
        ) : (
          <>
            {currentTab === 'overview' && (
              <OverviewView
                stats={stats}
                recentEvidence={evidenceRecords}
                onNavigate={setCurrentTab}
                onSelectEvidence={(ev) => {
                  setSelectedEvidence(ev);
                  setCurrentTab('evidence');
                }}
              />
            )}

            {currentTab === 'references' && (
              <ReferenceLibraryView
                references={references}
                onRefresh={loadAllData}
                onDelete={handleDeleteReference}
                onRegisterUpload={handleRegisterUpload}
                onRegisterUrl={handleRegisterUrl}
                isRegisterModalOpen={isRegisterModalOpen}
                onCloseRegisterModal={() => setIsRegisterModalOpen(false)}
                onOpenRegisterModal={() => setIsRegisterModalOpen(true)}
              />
            )}

            {currentTab === 'discovery' && (
              <DiscoverySweepsView
                jobs={jobs}
                references={references}
                onRefresh={loadAllData}
                onLaunchSweep={handleLaunchSweep}
                onNavigateToCandidates={(refId) => {
                  setCurrentTab('candidates');
                }}
              />
            )}

            {currentTab === 'candidates' && (
              <CandidateMatrixView
                candidates={candidates}
                references={references}
                onRefresh={loadAllData}
                onVerifyCandidate={handleVerifyCandidate}
                onQuickInspect={handleQuickInspect}
                onNavigateToEvidence={(evId) => {
                  if (evId) {
                    const match = evidenceRecords.find(e => e.id === evId);
                    if (match) setSelectedEvidence(match);
                  }
                  setCurrentTab('evidence');
                }}
              />
            )}

            {currentTab === 'evidence' && (
              <EvidenceVaultView
                evidenceRecords={evidenceRecords}
                selectedEvidence={selectedEvidence}
                onSelectEvidence={setSelectedEvidence}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === 'livesports' && (
              <LiveSportsMonitorView
                references={references}
                candidates={candidates}
                evidenceRecords={evidenceRecords}
                onRefresh={loadAllData}
                onNavigateToEvidence={(ev) => {
                  setSelectedEvidence(ev);
                  setCurrentTab('evidence');
                }}
                onLaunchLiveSweep={handleLiveSportsSweep}
              />
            )}
          </>
        )}
      </main>

      {/* Quiet, Compliant Footer (no bottom telemetry tickers) */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 px-6 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">Argus Platform</span>
            <span>·</span>
            <span>Anti-Piracy Intelligence & Digital Evidence Architecture</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400">
            <span>SQLite Persistent Storage</span>
            <span>·</span>
            <span>FFmpeg Perceptual dHash/pHash Engine</span>
            <span>·</span>
            <span>RFC-Compliant Chain of Custody</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
