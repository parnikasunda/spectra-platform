/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Stage B — Candidate Discovery Sweeps & Job Orchestration
 */

import React, { useState } from 'react';
import {
  Search,
  Radio,
  Globe,
  CheckCircle2,
  AlertCircle,
  Info,
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
  const [provider, setProvider] = useState<DiscoveryProvider>('ALL_SOURCES');
  const [targetReferenceId, setTargetReferenceId] = useState<string>('');
  const [keywords, setKeywords] = useState('');
  const [filterDomain, setFilterDomain] = useState('');
  const [maxCandidates, setMaxCandidates] = useState('15');
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const validReferences = references.filter(r => r.status === 'REGISTERED');

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

  const providerDescriptions: Record<
    DiscoveryProvider,
    { title: string; desc: string; scope: string; liveStatus: 'LIVE_NO_KEY' | 'LIVE_SEARCH' | 'OPTIONAL_CSE_KEY' }
  > = {
    ALL_SOURCES: {
      title: 'Universal Multi-Source Intelligence',
      desc: 'Queries live YouTube search, Dailymotion REST API, Internet Archive API, and DuckDuckGo live web search in parallel.',
      scope: 'Live APIs: YouTube + Dailymotion + Archive.org + Web Search',
      liveStatus: 'LIVE_NO_KEY'
    },
    YOUTUBE_PUBLIC: {
      title: 'YouTube Public Search & oEmbed',
      desc: 'Queries live YouTube search results (ytInitialData) and verifies public video pages via YouTube oEmbed.',
      scope: 'Live YouTube watch pages & real decoded video keyframes',
      liveStatus: 'LIVE_NO_KEY'
    },
    PUBLIC_PLATFORMS: {
      title: 'Public Video Platforms & Archives',
      desc: 'Queries the live Dailymotion REST API and Internet Archive Advanced Search & Metadata APIs.',
      scope: 'Dailymotion public API & Archive.org direct MP4 items',
      liveStatus: 'LIVE_NO_KEY'
    },
    SEARCH_CRAWLER: {
      title: 'General Web Search Crawler',
      desc: 'Queries live DuckDuckGo HTML search (or Google Custom Search JSON API when GOOGLE_SEARCH_API_KEY is set).',
      scope: 'Live web pages, articles, and embedded video players',
      liveStatus: 'LIVE_SEARCH'
    },
    STREAMING_SERVICES: {
      title: 'Commercial Streaming (Netflix / Hotstar / SonyLIV)',
      desc: 'Searches live indexes for official OTT catalog pages and runs compliance-safe Widevine/PlayReady DRM probes.',
      scope: 'Netflix, Hotstar, SonyLIV, Prime Video (GOOGLE_SEARCH_API_KEY optional)',
      liveStatus: 'OPTIONAL_CSE_KEY'
    },
    SUSPECTED_PIRACY: {
      title: 'Suspected Piracy & Stream Indexer',
      desc: 'Queries live search indexes for third-party streaming pages and direct .m3u8/.mp4 links without fabricating URLs.',
      scope: 'Live web search for third-party stream pages',
      liveStatus: 'LIVE_SEARCH'
    },
    STREAM_INDEXER: {
      title: 'Web Stream Inspector',
      desc: 'Searches live web indexes for embedded player pages and direct stream manifests.',
      scope: 'Live web search for embedded players',
      liveStatus: 'LIVE_SEARCH'
    },
    SPORTS_DIRECTORY: {
      title: 'Live Sports Stream Search',
      desc: 'Queries live web & video platforms for sports broadcast streams and commentary feeds.',
      scope: 'Live search across public video & web indexes',
      liveStatus: 'LIVE_SEARCH'
    },
    IPTV_PROBER: {
      title: 'HLS / M3U8 Stream Prober',
      desc: 'Searches for public HLS (.m3u8) transport manifests and probes encryption headers.',
      scope: 'Public .m3u8 manifest search & probe',
      liveStatus: 'OPTIONAL_CSE_KEY'
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Candidate Discovery Sweeps</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Stage B: Live discovery across real search &amp; video platform APIs with HTTP verification and perceptual frame matching
          </p>
        </div>

        <button
          onClick={() => {
            const defaultRef = validReferences[0] || references[0];
            if (defaultRef && !targetReferenceId) {
              setTargetReferenceId(defaultRef.id);
              setKeywords(defaultRef.title);
              setJobName(`Live Sweep: ${defaultRef.title.slice(0, 32)}`);
            }
            setIsModalOpen(true);
          }}
          className="px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded font-sans transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          Launch Discovery Sweep
        </button>
      </div>

      {/* Honest Scope & Technical Boundary Notice */}
      <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800 text-xs text-slate-300 flex items-start gap-3">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-slate-200">Live Discovery Providers &amp; Verification Policy</div>
          <p className="text-slate-400 leading-relaxed">
            Spectra queries real, accessible endpoints (<span className="text-cyan-300 font-mono">YouTube Live Search &amp; oEmbed</span>, <span className="text-cyan-300 font-mono">Dailymotion Public API</span>, <span className="text-cyan-300 font-mono">Internet Archive API</span>, and <span className="text-cyan-300 font-mono">DuckDuckGo Live Web Search</span>). It never fabricates URLs or substitutes unrelated videos. Every discovered URL is probed over HTTP to verify reachability and relevance, and a candidate is only marked as a perceptual match when decoded frames align with a registered reference.
          </p>
        </div>
      </div>

      {/* Discovery Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Object.keys(providerDescriptions) as DiscoveryProvider[]).slice(0, 6).map((pKey) => {
          const info = providerDescriptions[pKey];
          return (
            <div key={pKey} className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80 space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-white">{info.title}</span>
                  {info.liveStatus === 'LIVE_NO_KEY' ? (
                    <span className="px-1.5 py-0.5 text-[10px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 rounded">
                      LIVE API
                    </span>
                  ) : info.liveStatus === 'LIVE_SEARCH' ? (
                    <span className="px-1.5 py-0.5 text-[10px] font-mono bg-cyan-950/60 text-cyan-400 border border-cyan-800/50 rounded">
                      LIVE WEB
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 text-[10px] font-mono bg-amber-950/60 text-amber-300 border border-amber-800/50 rounded">
                      WEB / CSE KEY
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{info.desc}</p>
              </div>
              <div className="pt-2 border-t border-slate-800/60 text-[11px] text-slate-400 font-mono">
                {info.scope}
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
            <p className="text-slate-400">Launch a new sweep to discover genuine candidate URLs matching your registered reference content.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-mono">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Job Name &amp; Provider Diagnostics</th>
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
                  let queryKeywords = '';
                  try {
                    const parsed = JSON.parse(job.query_params || '{}');
                    queryKeywords = parsed.keywords || '';
                  } catch {}

                  return (
                    <tr key={job.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 max-w-md">
                        <div className="font-semibold text-white">{job.name}</div>
                        {queryKeywords && (
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            Query: &ldquo;{queryKeywords}&rdquo;
                          </div>
                        )}
                        {job.error_message && (
                          <div className="text-[11px] font-mono text-slate-400 mt-1 bg-slate-950/70 border border-slate-800 rounded px-2 py-1">
                            {job.error_message}
                          </div>
                        )}
                      </td>
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
                <h3 className="text-sm font-semibold text-white">Configure Live Discovery Sweep</h3>
                <p className="text-xs text-slate-400 mt-0.5">Stage B: Query real video &amp; search endpoints for candidate sources</p>
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
                  placeholder="e.g. Live Surveillance Sweep: India vs NZ 1st T20"
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
                    <option value="ALL_SOURCES">Universal Multi-Source (All Live Adapters)</option>
                    <option value="YOUTUBE_PUBLIC">YouTube Public Search &amp; oEmbed</option>
                    <option value="PUBLIC_PLATFORMS">Public Video Platforms (Dailymotion / Archive.org)</option>
                    <option value="SEARCH_CRAWLER">General Web Search (DuckDuckGo / Google CSE)</option>
                    <option value="STREAMING_SERVICES">Commercial Streaming (Netflix / Hotstar / SonyLIV)</option>
                    <option value="SUSPECTED_PIRACY">Suspected Piracy &amp; Stream Indexer</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Target Reference Item</label>
                  <select
                    value={targetReferenceId}
                    onChange={(e) => {
                      setTargetReferenceId(e.target.value);
                      const ref = references.find(r => r.id === e.target.value);
                      if (ref) {
                        setKeywords(ref.title);
                        if (!jobName || jobName.startsWith('Live Sweep:') || jobName.startsWith('Sweep:')) {
                          setJobName(`Live Sweep: ${ref.title.slice(0, 32)}`);
                        }
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                  >
                    <option value="">General Sweep (No target)</option>
                    {references.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.status === 'INVALID' ? `[INVALID] ${r.title}` : r.title}
                      </option>
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
                  placeholder="e.g. India vs New Zealand 1st T20"
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
                    placeholder="e.g. youtube.com or dailymotion.com"
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
                  {isLaunching ? 'Executing Live Sweep...' : 'Launch Sweep'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
