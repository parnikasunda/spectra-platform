/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Stage B — Candidate Discovery Sweeps & Job Orchestration
 */

import React, { useState } from 'react';
import { 
  Search, 
  Radio, 
  Globe, 
  Tv, 
  Play, 
  CheckCircle2, 
  AlertCircle, 
  Info,
  Clock,
  Layers,
  X
} from 'lucide-react';
import { DiscoveryJob, DiscoveryProvider, ReferenceItem } from '../types/client.js';

interface DiscoverySweepsViewProps {
  jobs: DiscoveryJob[];
  references: ReferenceItem[];
  onRefresh: () => void;
  onLaunchSweep: (payload: {
    job_name: string;
    provider: DiscoveryProvider;
    target_reference_id?: string;
    query_keywords: string;
    filter_domain?: string;
    max_candidates?: number;
  }) => Promise<void>;
  onNavigateToCandidates: (referenceId?: string) => void;
}

export const DiscoverySweepsView: React.FC<DiscoverySweepsViewProps> = ({
  jobs,
  references,
  onRefresh,
  onLaunchSweep,
  onNavigateToCandidates
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [jobName, setJobName] = useState('');
  const [provider, setProvider] = useState<DiscoveryProvider>('SPORTS_DIRECTORY');
  const [targetReferenceId, setTargetReferenceId] = useState<string>('');
  const [keywords, setKeywords] = useState('');
  const [filterDomain, setFilterDomain] = useState('');
  const [maxCandidates, setMaxCandidates] = useState('15');
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaunchError(null);
    setIsLaunching(true);

    try {
      await onLaunchSweep({
        job_name: jobName,
        provider,
        target_reference_id: targetReferenceId || undefined,
        query_keywords: keywords,
        filter_domain: filterDomain || undefined,
        max_candidates: parseInt(maxCandidates, 10)
      });
      setIsModalOpen(false);
      setJobName('');
      setKeywords('');
      setFilterDomain('');
      onRefresh();
    } catch (err: any) {
      setLaunchError(err.message || 'Failed to launch discovery sweep');
    } finally {
      setIsLaunching(false);
    }
  };

  const providerDescriptions: Record<DiscoveryProvider, { title: string; desc: string; scope: string }> = {
    SPORTS_DIRECTORY: {
      title: 'Live Sports Indexer',
      desc: 'Monitors public sports broadcast indexing portals and streaming gateways.',
      scope: 'Configured public live event directories & HLS scrapers'
    },
    STREAM_INDEXER: {
      title: 'Web Stream Inspector',
      desc: 'Crawls direct web player portals, embed nodes, and mirror hosts.',
      scope: 'Targeted free streaming domain network'
    },
    IPTV_PROBER: {
      title: 'IPTV Stream Prober',
      desc: 'Inspects open IPTV transport manifests and m3u streaming channels.',
      scope: 'Open IPTV broadcast endpoints and gateway relays'
    },
    SEARCH_CRAWLER: {
      title: 'Search Index Crawler',
      desc: 'Queries search engine APIs and indexing feeds for content keywords.',
      scope: 'Configured search indexing endpoints'
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Candidate Discovery Sweeps</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Stage B: Automated surveillance jobs across configured discovery providers with canonical deduplication
          </p>
        </div>

        <button
          onClick={() => {
            if (references.length > 0 && !targetReferenceId) {
              setTargetReferenceId(references[0].id);
              setKeywords(references[0].title);
              setJobName(`Sweep: ${references[0].title.slice(0, 30)}`);
            }
            setIsModalOpen(true);
          }}
          className="px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-sans transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          Launch Discovery Sweep
        </button>
      </div>

      {/* Honest Scope & Technical Boundary Notice (Mandatory Requirement) */}
      <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800 text-xs text-slate-300 flex items-start gap-3">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-slate-200">Surveillance Scope & Engineering Boundary</div>
          <p className="text-slate-400 leading-relaxed">
            Argus searches strictly across configured discovery providers and indexer endpoints. It does not claim exhaustive, omniscient global internet coverage. Discovery indicates the presence of a candidate URL; verification and perceptual media analysis are strictly required prior to any enforcement action.
          </p>
        </div>
      </div>

      {/* Discovery Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {(Object.keys(providerDescriptions) as DiscoveryProvider[]).map((pKey) => {
          const info = providerDescriptions[pKey];
          return (
            <div key={pKey} className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">{info.title}</span>
                {pKey === 'SPORTS_DIRECTORY' ? <Radio className="w-4 h-4 text-emerald-400" /> : <Globe className="w-4 h-4 text-cyan-400" />}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{info.desc}</p>
              <div className="pt-2 border-t border-slate-800/60 text-[11px] text-slate-400 font-mono">
                Scope: {info.scope}
              </div>
            </div>
          );
        })}
      </div>

      {/* Discovery Jobs Monitor Table */}
      <div className="rounded-lg bg-slate-900/40 border border-slate-800/80 overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Discovery Sweeps Execution Log</h2>
          <span className="text-xs text-slate-400 font-mono">Total Jobs: {jobs.length}</span>
        </div>

        {jobs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-2">
            <p>No discovery jobs have been executed yet.</p>
            <p className="text-slate-400">Launch a new sweep to discover candidate URLs matching your reference media.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Job Name</th>
                  <th className="py-2.5 px-4 font-medium">Provider</th>
                  <th className="py-2.5 px-4 font-medium">Target Reference</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Candidates Found</th>
                  <th className="py-2.5 px-4 font-medium">Started At</th>
                  <th className="py-2.5 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {jobs.map((job) => {
                  const targetRef = references.find(r => r.id === job.target_reference_id);
                  return (
                    <tr key={job.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-semibold text-white">{job.name}</td>
                      <td className="py-3 px-4 font-mono text-cyan-400 text-[11px]">{job.provider}</td>
                      <td className="py-3 px-4 text-slate-300 max-w-xs truncate">
                        {targetRef ? targetRef.title : (job.target_reference_id || 'All references')}
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <span className={`text-[11px] ${
                          job.status === 'COMPLETED' ? 'text-emerald-400' : (job.status === 'RUNNING' ? 'text-amber-400' : 'text-rose-400')
                        }`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white tabular-nums">
                        {job.candidates_found}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400 text-[11px]">
                        {new Date(job.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => onNavigateToCandidates(job.target_reference_id)}
                          className="text-xs text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
                        >
                          View Candidates
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Launch Sweep Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Configure Discovery Sweep</h3>
                <p className="text-xs text-slate-400 mt-0.5">Stage B: Automated surveillance parameters</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLaunch} className="p-6 space-y-4">
              {launchError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded text-rose-300 text-xs">
                  {launchError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Sweep Name</label>
                <input
                  type="text"
                  required
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="e.g. Daily Live Sports Surveillance Sweep"
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Provider Service</label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as DiscoveryProvider)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                  >
                    <option value="SPORTS_DIRECTORY">Live Sports Indexer</option>
                    <option value="STREAM_INDEXER">Web Stream Inspector</option>
                    <option value="IPTV_PROBER">IPTV Stream Prober</option>
                    <option value="SEARCH_CRAWLER">Search API Crawler</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Target Reference Item</label>
                  <select
                    value={targetReferenceId}
                    onChange={(e) => {
                      setTargetReferenceId(e.target.value);
                      const ref = references.find(r => r.id === e.target.value);
                      if (ref && !keywords) {
                        setKeywords(ref.title);
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                  >
                    <option value="">General Sweep (No target)</option>
                    {references.map(r => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Query Keywords / Title / Match Identifier</label>
                <input
                  type="text"
                  required
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. Arsenal vs Bayern live stream m3u8"
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Domain Restriction (Optional)</label>
                  <input
                    type="text"
                    value={filterDomain}
                    onChange={(e) => setFilterDomain(e.target.value)}
                    placeholder="e.g. buffstreams.sx"
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Max Candidate Batch</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={maxCandidates}
                    onChange={(e) => setMaxCandidates(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLaunching}
                  className="px-4 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-sans transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isLaunching ? 'Executing Sweep...' : 'Launch Sweep'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
