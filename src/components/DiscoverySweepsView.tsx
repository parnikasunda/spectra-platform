/**
 * SPECTRA Anti-Piracy Intelligence & Evidence Platform
 * Stage B — Candidate Discovery Sweeps & Job Orchestration
 */

import React, { useState, useEffect } from 'react';
import {
  Search,
  Radio,
  Globe,
  CheckCircle2,
  AlertCircle,
  Info,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Layers,
  Activity
} from 'lucide-react';
import {
  DiscoveryJob,
  DiscoveryProvider,
  ReferenceItem,
  DiscoverySourceRecord,
  CandidateItem,
  DiscoveryPresetMode
} from '../types/client.js';
import {
  fetchDiscoverySources,
  toggleDiscoverySource,
  scanDiscoverySource,
  expandDiscoveryInvestigation
} from '../api.js';
import { SearchCoverageDashboard } from './SearchCoverageDashboard.js';

interface DiscoverySweepsViewProps {
  jobs: DiscoveryJob[];
  references: ReferenceItem[];
  candidates?: CandidateItem[];
  onRefresh: () => void;
  onLaunchSweep: (payload: {
    job_name: string;
    provider: DiscoveryProvider;
    target_reference_id?: string;
    query_keywords: string;
    filter_domain?: string;
    max_candidates?: number;
    preset_mode?: DiscoveryPresetMode;
    max_unique_candidates?: number;
    deep_research_limit?: number;
    forensic_comparison_limit?: number;
    keyword_variations?: string[];
    seed_sources?: string[];
  }) => Promise<void>;
  onNavigateToCandidates: (referenceId?: string) => void;
}

const DEFAULT_SEEDS = ['https://o2tvseries4u.com/', 'https://kickasstorrents.io/', 'https://unblockit.li/'];
const ALL_KEYWORD_VARIATIONS = [
  'HD',
  '1080p',
  '4K',
  '2160p',
  'WEB-DL',
  'WEBRip',
  'LIVE',
  'LIVE STREAM',
  'FULL MATCH',
  'FULL MOVIE',
  'SEASON',
  'EPISODE',
  'S01E01'
];

export const DiscoverySweepsView: React.FC<DiscoverySweepsViewProps> = ({
  jobs,
  references,
  candidates = [],
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
  const [presetMode, setPresetMode] = useState<DiscoveryPresetMode>('STANDARD');
  const [maxCandidates, setMaxCandidates] = useState('250');
  const [deepResearchLimit, setDeepResearchLimit] = useState('200');
  const [forensicComparisonLimit, setForensicComparisonLimit] = useState('100');
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(DEFAULT_SEEDS);
  const [customSeedInput, setCustomSeedInput] = useState('');
  const [selectedVariations, setSelectedVariations] = useState<string[]>(ALL_KEYWORD_VARIATIONS);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [expandingJobId, setExpandingJobId] = useState<string | null>(null);

  const [discoverySources, setDiscoverySources] = useState<DiscoverySourceRecord[]>([]);
  const [scanningSourceId, setScanningSourceId] = useState<string | null>(null);
  const [togglingSourceId, setTogglingSourceId] = useState<string | null>(null);

  // Expandable UI state for compact presentation
  const [showPipelinePolicy, setShowPipelinePolicy] = useState(false);
  const [expandedSourceIds, setExpandedSourceIds] = useState<Record<string, boolean>>({});
  const [expandedJobIds, setExpandedJobIds] = useState<Record<string, boolean>>({});
  const [showAllProviders, setShowAllProviders] = useState(false);

  const toggleSourceDetails = (sourceId: string) => {
    setExpandedSourceIds(prev => ({ ...prev, [sourceId]: !prev[sourceId] }));
  };

  const toggleJobDetails = (jobId: string) => {
    setExpandedJobIds(prev => ({ ...prev, [jobId]: !prev[jobId] }));
  };

  const loadDiscoverySources = async () => {
    try {
      const list = await fetchDiscoverySources();
      setDiscoverySources(list);
    } catch {}
  };

  useEffect(() => {
    loadDiscoverySources();
  }, [jobs.length]);

  const validReferences = references.filter(
    r =>
      r.status === 'REGISTERED' ||
      r.status === 'FINGERPRINTED' ||
      r.status === 'PROCESSING' ||
      r.status === 'AWAITING_AUTHORIZED_MEDIA' ||
      r.status === 'METADATA_REGISTERED'
  );

  const handleTogglePersistentSource = async (src: DiscoverySourceRecord) => {
    setTogglingSourceId(src.id);
    try {
      const updated = await toggleDiscoverySource(src.id, !src.enabled);
      setDiscoverySources(prev => prev.map(item => (item.id === src.id ? updated : item)));
    } catch {} finally {
      setTogglingSourceId(null);
    }
  };

  const handleScanPersistentSource = async (src: DiscoverySourceRecord) => {
    setScanningSourceId(src.id);
    try {
      const preferredRef =
        references.find(r => r.id === targetReferenceId) ||
        references.find(r => r.title.toLowerCase().includes('modern family')) ||
        validReferences[0] ||
        references[0];
      await scanDiscoverySource(src.id, {
        target_reference_id: preferredRef?.id,
        query_keywords: preferredRef
          ? `${preferredRef.title}${preferredRef.season_episode_info ? ` ${preferredRef.season_episode_info}` : ''}`
          : 'Modern Family S01E01',
        auto_verify: true
      });
      await loadDiscoverySources();
      onRefresh();
    } catch {} finally {
      setScanningSourceId(null);
    }
  };

  const toggleSeed = (seedUrl: string) => {
    setSelectedSeeds(prev =>
      prev.includes(seedUrl) ? prev.filter(s => s !== seedUrl) : [...prev, seedUrl]
    );
  };

  const handleAddCustomSeed = () => {
    const trimmed = customSeedInput.trim();
    if (!trimmed) return;
    const normalized = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
    if (!selectedSeeds.includes(normalized)) {
      setSelectedSeeds(prev => [...prev, normalized]);
    }
    setCustomSeedInput('');
  };

  const toggleVariation = (variation: string) => {
    setSelectedVariations(prev =>
      prev.includes(variation) ? prev.filter(v => v !== variation) : [...prev, variation]
    );
  };

  const handleSelectPreset = (mode: DiscoveryPresetMode) => {
    setPresetMode(mode);
    if (mode === 'STANDARD') {
      setMaxCandidates('250');
      setDeepResearchLimit('200');
      setForensicComparisonLimit('100');
    } else if (mode === 'DEEP') {
      setMaxCandidates('500');
      setDeepResearchLimit('350');
      setForensicComparisonLimit('200');
    } else if (mode === 'EXHAUSTIVE') {
      setMaxCandidates('1000');
      setDeepResearchLimit('600');
      setForensicComparisonLimit('350');
    }
  };

  const handleExpandJob = async (job: DiscoveryJob) => {
    setExpandingJobId(job.id);
    try {
      let currentMax = 250;
      try {
        const parsed = JSON.parse(job.query_params || '{}');
        if (parsed.maxUniqueCandidates) currentMax = Number(parsed.maxUniqueCandidates);
      } catch {}
      const nextPreset: DiscoveryPresetMode =
        currentMax < 500 ? 'DEEP' : currentMax < 1000 ? 'EXHAUSTIVE' : 'EXHAUSTIVE';
      const nextMax = nextPreset === 'DEEP' ? 500 : 1000;
      await expandDiscoveryInvestigation({
        job_id: job.id,
        reference_id: job.target_reference_id,
        preset_mode: nextPreset,
        max_unique_candidates: nextMax,
        deep_research_limit: nextPreset === 'DEEP' ? 350 : 600,
        forensic_comparison_limit: nextPreset === 'DEEP' ? 200 : 350
      });
      await loadDiscoverySources();
      onRefresh();
    } catch {} finally {
      setExpandingJobId(null);
    }
  };

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLaunchError(null);
    setIsLaunching(true);

    const parsedMax = Math.max(1, Math.min(1000, parseInt(maxCandidates, 10) || 250));
    const parsedResearch = Math.max(1, Math.min(1000, parseInt(deepResearchLimit, 10) || 200));
    const parsedComparison = Math.max(1, Math.min(1000, parseInt(forensicComparisonLimit, 10) || 100));

    try {
      await onLaunchSweep({
        job_name: jobName,
        provider,
        target_reference_id: targetReferenceId || undefined,
        query_keywords: keywords,
        filter_domain: filterDomain || undefined,
        max_candidates: parsedMax,
        preset_mode: presetMode,
        max_unique_candidates: parsedMax,
        deep_research_limit: parsedResearch,
        forensic_comparison_limit: parsedComparison,
        keyword_variations: selectedVariations,
        seed_sources: selectedSeeds
      });
      setIsModalOpen(false);
      setJobName('');
      setKeywords('');
      setFilterDomain('');
      await loadDiscoverySources();
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
      desc: 'Combines perceptual frame-hash search, persistent configured website discovery (o2tvseries4u.com), YouTube, Dailymotion, Internet Archive, and live web search in a unified run.',
      scope: 'Frame Search + o2tvseries4u.com + YouTube + Dailymotion + Archive.org + Web Search',
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
      desc: 'Queries live DuckDuckGo HTML search (or Google Custom Search JSON API when GOOGLE_SEARCH_API_KEY is set) with expanded keyword combinations.',
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
      title: 'Suspected Piracy & Persistent Portals',
      desc: 'Automatically crawls o2tvseries4u.com (catalog, seasons, pagination, episode & MP4 links), probes seed portals, and queries live web indexes.',
      scope: 'https://o2tvseries4u.com/ + kickasstorrents.io + unblockit.li + Live Search',
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

  const allProviderKeys = Object.keys(providerDescriptions) as DiscoveryProvider[];
  const displayedProviders = showAllProviders ? allProviderKeys : allProviderKeys.slice(0, 6);

  return (
    <div className="space-y-8">
      {/* Section 1: Page Header & Prominent Launch Action */}
      <div className="rounded-xl bg-slate-900/60 border border-slate-800/90 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-400">
                Stage B • Automated Discovery &amp; Coverage
              </span>
              <span className="text-slate-700">•</span>
              <button
                type="button"
                onClick={() => setShowPipelinePolicy(prev => !prev)}
                className="text-[11px] font-mono text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Info className="w-3.5 h-3.5 text-cyan-400" />
                {showPipelinePolicy ? 'Hide Pipeline Policy' : 'Pipeline & Provenance Policy'}
                {showPipelinePolicy ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">Candidate Discovery Sweeps</h1>
            <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
              Orchestrate multi-source discovery across perceptual frame-hash search, persistent configured portals (<span className="text-cyan-300 font-mono">o2tvseries4u.com</span>), and live video &amp; web search adapters.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-start md:self-center">
            <div className="hidden sm:flex items-center gap-4 px-3.5 py-2 rounded-lg bg-slate-950/80 border border-slate-800/80 text-xs font-mono">
              <div>
                <span className="text-slate-500">References: </span>
                <span className="text-white font-semibold tabular-nums">{references.length}</span>
              </div>
              <span className="text-slate-800">|</span>
              <div>
                <span className="text-slate-500">Sweeps: </span>
                <span className="text-cyan-400 font-semibold tabular-nums">{jobs.length}</span>
              </div>
              <span className="text-slate-800">|</span>
              <div>
                <span className="text-slate-500">Candidates: </span>
                <span className="text-emerald-400 font-semibold tabular-nums">{candidates.length}</span>
              </div>
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
              className="px-4 py-2.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg font-sans transition-colors cursor-pointer whitespace-nowrap shadow-sm flex items-center gap-2 shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              Launch Discovery Sweep
            </button>
          </div>
        </div>

        {/* Expandable Pipeline & Provenance Policy Notice */}
        {showPipelinePolicy && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 text-xs text-slate-300 flex items-start gap-3">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-slate-200">
                Unified Discovery Pipeline, Provenance Merging &amp; Verification Policy
              </div>
              <p className="text-slate-400 leading-relaxed">
                SPECTRA automatically inspects persistent configured discovery sources (<span className="text-cyan-300 font-mono">https://o2tvseries4u.com/</span>) alongside <span className="text-cyan-300 font-mono">Frame-Fingerprint Search</span>, <span className="text-cyan-300 font-mono">YouTube</span>, <span className="text-cyan-300 font-mono">Dailymotion</span>, <span className="text-cyan-300 font-mono">Vimeo</span>, <span className="text-cyan-300 font-mono">Internet Archive</span>, and <span className="text-cyan-300 font-mono">Live Web Search</span>. Duplicate candidates across sources are merged with full provenance while distinct video assets on the same webpage remain separate.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Search Coverage & Discovery Intelligence Dashboard */}
      <SearchCoverageDashboard
        references={references}
        selectedReferenceId={targetReferenceId}
        onSelectReferenceId={setTargetReferenceId}
        onRefreshParent={onRefresh}
        onNavigateToCandidates={onNavigateToCandidates}
        jobsCount={jobs.length}
      />

      {/* Section 3: Persistent Configured Discovery Source Registry */}
      <section className="rounded-xl bg-slate-900/50 border border-slate-800/90 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/40">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400" />
              Persistent Configured Discovery Source Registry
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Configured websites automatically inspected during unified discovery runs without manual URL entry
            </p>
          </div>
          <span className="text-xs font-mono text-cyan-400 tabular-nums shrink-0">
            {discoverySources.filter(s => s.enabled).length} / {discoverySources.length} Enabled
          </span>
        </div>

        <div className="divide-y divide-slate-800/70">
          {discoverySources.map((src) => {
            let failureReasons: string[] = [];
            let inspectedUrls: string[] = [];
            try {
              if (src.failure_reasons_json) failureReasons = JSON.parse(src.failure_reasons_json);
            } catch {}
            try {
              if (src.inspected_urls_json) inspectedUrls = JSON.parse(src.inspected_urls_json);
            } catch {}

            const isScanning = scanningSourceId === src.id;
            const isToggling = togglingSourceId === src.id;
            const isExpanded = Boolean(expandedSourceIds[src.id]);
            const hasDiagnostics = Boolean(src.last_scan_outcome || inspectedUrls.length > 0 || failureReasons.length > 0);

            return (
              <div key={src.id} className="p-4 sm:px-5 space-y-3 hover:bg-slate-800/15 transition-colors">
                {/* Compact Source Header & Actions */}
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-xs font-semibold text-white">{src.name}</span>
                      <span className="text-xs font-mono text-cyan-300 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded">
                        {src.url}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {src.source_type}
                      </span>
                      <span className="text-slate-700">•</span>
                      <span
                        className={`text-[11px] font-mono font-medium ${
                          src.enabled ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {src.enabled ? 'ENABLED (AUTO-SCAN)' : 'DISABLED'}
                      </span>
                      <span className="text-slate-700">•</span>
                      <span
                        className={`text-[11px] font-mono font-medium ${
                          src.last_scan_status === 'COMPLETED'
                            ? 'text-emerald-300'
                            : src.last_scan_status === 'RUNNING' || src.last_scan_status === 'RESTRICTED'
                            ? 'text-amber-300'
                            : src.last_scan_status === 'FAILED'
                            ? 'text-rose-300'
                            : 'text-slate-400'
                        }`}
                      >
                        SCAN: {src.last_scan_status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Last Scan: {src.last_scan_at ? new Date(src.last_scan_at).toLocaleString() : 'Not yet scanned in this session'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {hasDiagnostics && (
                      <button
                        type="button"
                        onClick={() => toggleSourceDetails(src.id)}
                        className="px-2.5 py-1 text-xs font-mono text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        {isExpanded ? 'Hide Diagnostics' : 'Technical Details'}
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => handleTogglePersistentSource(src)}
                      className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors cursor-pointer whitespace-nowrap ${
                        src.enabled
                          ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/60'
                      }`}
                    >
                      {src.enabled ? 'Disable Source' : 'Enable Source'}
                    </button>
                    <button
                      type="button"
                      disabled={isScanning}
                      onClick={() => handleScanPersistentSource(src)}
                      className="px-3 py-1 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                      {isScanning ? 'Scanning Source...' : 'Scan / Retry Source'}
                    </button>
                  </div>
                </div>

                {/* Compact Inline Telemetry Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                  <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between lg:block">
                    <div className="text-[10px] font-mono text-slate-400">Pages Inspected</div>
                    <div className="text-xs font-mono font-bold text-white tabular-nums mt-0.5">{src.pages_inspected}</div>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between lg:block">
                    <div className="text-[10px] font-mono text-slate-400">Candidates Found</div>
                    <div className="text-xs font-mono font-bold text-cyan-400 tabular-nums mt-0.5">{src.candidates_discovered}</div>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between lg:block">
                    <div className="text-[10px] font-mono text-slate-400">Direct Media Links</div>
                    <div className="text-xs font-mono font-bold text-emerald-400 tabular-nums mt-0.5">{src.direct_media_found}</div>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between lg:block">
                    <div className="text-[10px] font-mono text-slate-400">Duplicates Merged</div>
                    <div className="text-xs font-mono font-bold text-amber-300 tabular-nums mt-0.5">{src.duplicates_merged}</div>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between lg:block">
                    <div className="text-[10px] font-mono text-slate-400">Media Acquired</div>
                    <div className="text-xs font-mono font-bold text-emerald-300 tabular-nums mt-0.5">{src.acquisitions_succeeded}</div>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between lg:block">
                    <div className="text-[10px] font-mono text-slate-400">Restricted / CAPTCHA</div>
                    <div className="text-xs font-mono font-bold text-amber-400 tabular-nums mt-0.5">{src.acquisitions_restricted}</div>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between lg:block">
                    <div className="text-[10px] font-mono text-slate-400">Frames / Fingerprints</div>
                    <div className="text-xs font-mono font-bold text-white tabular-nums mt-0.5">
                      {src.frames_extracted} / {src.fingerprinted_count}
                    </div>
                  </div>
                </div>

                {/* Expandable Technical Details Drawer */}
                {isExpanded && hasDiagnostics && (
                  <div className="pt-2 space-y-2.5 border-t border-slate-800/70">
                    {src.last_scan_outcome && (
                      <div className="text-xs font-mono text-slate-300 bg-slate-950/90 border border-slate-800 rounded-lg px-3 py-2">
                        <span className="text-slate-400">Scan Outcome: </span>
                        {src.last_scan_outcome}
                      </div>
                    )}

                    {inspectedUrls.length > 0 && (
                      <div className="text-[11px] font-mono text-slate-400 bg-slate-950/60 border border-slate-800/70 rounded-lg px-3 py-2 break-all">
                        <span className="text-slate-300 font-semibold">Inspected Routes ({inspectedUrls.length}):</span>{' '}
                        {inspectedUrls.join(' → ')}
                      </div>
                    )}

                    {failureReasons.length > 0 && (
                      <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-800/50 text-[11px] font-mono text-amber-200 space-y-1">
                        <div className="font-semibold text-amber-300">Access / Acquisition Diagnostic Notices:</div>
                        {failureReasons.map((reason, idx) => (
                          <div key={idx} className="leading-relaxed">
                            • {reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 4: Discovery Provider Ecosystem */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              Discovery Adapters &amp; Provider Ecosystem
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Configured search crawlers, public video platform APIs, and stream inspection engines
            </p>
          </div>
          {allProviderKeys.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAllProviders(prev => !prev)}
              className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer self-start sm:self-auto"
            >
              {showAllProviders ? `Show Core Providers (6)` : `View All Providers (${allProviderKeys.length})`}
              {showAllProviders ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedProviders.map((pKey) => {
            const info = providerDescriptions[pKey];
            return (
              <div
                key={pKey}
                className="p-4 rounded-xl bg-slate-900/45 border border-slate-800/80 flex flex-col justify-between gap-3 hover:border-slate-700/80 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-white leading-snug">{info.title}</span>
                    {info.liveStatus === 'LIVE_NO_KEY' ? (
                      <span className="text-[10px] font-mono font-semibold text-emerald-400 shrink-0">
                        LIVE API
                      </span>
                    ) : info.liveStatus === 'LIVE_SEARCH' ? (
                      <span className="text-[10px] font-mono font-semibold text-cyan-400 shrink-0">
                        LIVE WEB
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono font-semibold text-amber-300 shrink-0">
                        WEB / CSE KEY
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{info.desc}</p>
                </div>
                <div className="pt-2.5 border-t border-slate-800/60 text-[11px] text-slate-400 font-mono truncate" title={info.scope}>
                  {info.scope}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 5: Discovery Sweeps Execution Log */}
      <section className="rounded-xl bg-slate-900/50 border border-slate-800/90 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/40">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Discovery Sweeps Execution Log
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Compact sweep history. Expand any row to inspect complete queries, search modifiers, seed portals, and provider diagnostics.
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono tabular-nums shrink-0">
            Total Jobs: <span className="text-white font-semibold">{jobs.length}</span>
          </span>
        </div>

        {jobs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-2">
            <p className="text-slate-300 font-medium">No discovery jobs have been executed yet.</p>
            <p className="text-slate-400">
              Launch a new sweep to discover genuine candidate URLs matching your registered reference content.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 font-mono text-[11px]">
                <tr>
                  <th className="py-3 px-4 font-medium">Sweep Name &amp; Preset</th>
                  <th className="py-3 px-4 font-medium">Target Reference</th>
                  <th className="py-3 px-4 font-medium">Provider</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Candidates</th>
                  <th className="py-3 px-4 font-medium">Started At</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {jobs.map((job) => {
                  const targetRef = references.find(r => r.id === job.target_reference_id);
                  let queryKeywords = '';
                  let keywordCombinations: string[] = [];
                  let seedSources: string[] = [];
                  let jobPresetMode = '';
                  let jobMaxUnique = 0;
                  let jobResearchLimit = 0;
                  let jobComparisonLimit = 0;
                  try {
                    const parsed = JSON.parse(job.query_params || '{}');
                    queryKeywords = parsed.keywords || '';
                    if (Array.isArray(parsed.keywordCombinations)) {
                      keywordCombinations = parsed.keywordCombinations;
                    }
                    if (Array.isArray(parsed.seedSources)) {
                      seedSources = parsed.seedSources;
                    }
                    jobPresetMode = parsed.presetMode || '';
                    jobMaxUnique = Number(parsed.maxUniqueCandidates || parsed.requestedMax || 0);
                    jobResearchLimit = Number(parsed.deepResearchLimit || 0);
                    jobComparisonLimit = Number(parsed.forensicComparisonLimit || 0);
                  } catch {}

                  const isExpanded = Boolean(expandedJobIds[job.id]);

                  return (
                    <React.Fragment key={job.id}>
                      <tr className="hover:bg-slate-800/25 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white">{job.name}</span>
                            {jobPresetMode && (
                              <span className="text-[10px] font-mono text-cyan-300 bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded tabular-nums">
                                {jobPresetMode} ({jobMaxUnique || 250} max)
                              </span>
                            )}
                          </div>
                          {queryKeywords && (
                            <div className="text-[11px] font-mono text-slate-400 truncate max-w-md mt-0.5">
                              Query: &ldquo;{queryKeywords}&rdquo;
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-300 max-w-xs truncate" title={targetRef ? targetRef.title : (job.target_reference_id || 'All references')}>
                          {targetRef ? targetRef.title : (job.target_reference_id || 'All references')}
                        </td>
                        <td className="py-3 px-4 font-mono text-cyan-400 text-[11px] whitespace-nowrap">
                          {job.provider}
                        </td>
                        <td className="py-3 px-4 font-mono whitespace-nowrap">
                          <span
                            className={`text-[11px] font-semibold ${
                              job.status === 'COMPLETED'
                                ? 'text-emerald-400'
                                : job.status === 'RUNNING'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-white tabular-nums whitespace-nowrap">
                          {job.candidates_found}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400 text-[11px] whitespace-nowrap tabular-nums">
                          {new Date(job.started_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => toggleJobDetails(job.id)}
                              className="px-2 py-1 text-[11px] font-mono text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded flex items-center gap-1 cursor-pointer"
                            >
                              {isExpanded ? 'Hide Info' : 'Details'}
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            <button
                              type="button"
                              disabled={expandingJobId === job.id}
                              onClick={() => handleExpandJob(job)}
                              className="px-2.5 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded cursor-pointer disabled:opacity-50"
                              title="Expand investigation limits while reusing cached candidate research & comparisons"
                            >
                              {expandingJobId === job.id ? 'Expanding...' : 'Expand Sweep'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onNavigateToCandidates(job.target_reference_id)}
                              className="px-2.5 py-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
                            >
                              View Candidates
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-950/75">
                          <td colSpan={7} className="px-5 py-3.5">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-[11px] font-mono">
                              <div className="space-y-1.5">
                                <div className="text-slate-400 uppercase tracking-wider text-[10px]">
                                  Query &amp; Processing Limits
                                </div>
                                <div className="text-slate-200">
                                  Primary Query: <span className="text-cyan-300">&ldquo;{queryKeywords || 'N/A'}&rdquo;</span>
                                </div>
                                <div className="text-slate-300 tabular-nums">
                                  Preset: <span className="text-white">{jobPresetMode || 'STANDARD'}</span> ({jobMaxUnique || 250} max unique • {jobResearchLimit || 200} research • {jobComparisonLimit || 100} compare)
                                </div>
                                {seedSources.length > 0 && (
                                  <div className="text-slate-400 break-all">
                                    Seed Portals: <span className="text-slate-300">{seedSources.join(', ')}</span>
                                  </div>
                                )}
                              </div>

                              <div className="space-y-1.5">
                                <div className="text-slate-400 uppercase tracking-wider text-[10px]">
                                  Expanded Search Terms ({keywordCombinations.length})
                                </div>
                                {keywordCombinations.length > 0 ? (
                                  <div className="text-cyan-300/90 leading-relaxed break-words">
                                    {keywordCombinations.join(' · ')}
                                  </div>
                                ) : (
                                  <div className="text-slate-500">Default query execution without modifier expansion</div>
                                )}
                              </div>

                              <div className="space-y-1.5">
                                <div className="text-slate-400 uppercase tracking-wider text-[10px]">
                                  Provider Execution Diagnostics
                                </div>
                                {job.error_message ? (
                                  <div className="text-slate-300 bg-slate-900/90 border border-slate-800 rounded p-2.5 leading-relaxed">
                                    {job.error_message}
                                  </div>
                                ) : (
                                  <div className="text-slate-500">
                                    Completed cleanly with {job.candidates_found} candidate(s) recorded.
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Launch Sweep Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Configure Live Discovery Sweep</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Stage B: Query real video &amp; search endpoints, seed sources, and keyword combinations
                </p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLaunch} className="p-6 space-y-4 overflow-y-auto">
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
                    <option value="SUSPECTED_PIRACY">Suspected Piracy &amp; Seed Indexer</option>
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
                        const kw = `${ref.title}${ref.season_episode_info ? ` ${ref.season_episode_info}` : ''}`.trim();
                        setKeywords(kw);
                        if (!jobName || jobName.startsWith('Live Sweep:') || jobName.startsWith('Sweep:')) {
                          setJobName(`Live Sweep: ${ref.title.slice(0, 32)}`);
                        }
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400"
                  >
                    <option value="">General Sweep (No target)</option>
                    {references.map(r => {
                      const statusTag =
                        r.status === 'FINGERPRINTED' || r.status === 'REGISTERED'
                          ? `[FINGERPRINTED • ${r.fingerprint_count} frames]`
                          : r.status === 'AWAITING_AUTHORIZED_MEDIA' || r.status === 'METADATA_REGISTERED'
                          ? `[${r.status} • Discovery Only]`
                          : `[${r.status}]`;
                      return (
                        <option key={r.id} value={r.id}>
                          {statusTag} {r.title}{r.platform ? ` (${r.platform})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {(() => {
                const selectedTarget = references.find(r => r.id === targetReferenceId);
                if (
                  selectedTarget &&
                  (selectedTarget.status === 'METADATA_REGISTERED' ||
                    selectedTarget.status === 'AWAITING_AUTHORIZED_MEDIA')
                ) {
                  return (
                    <div className="p-2.5 bg-amber-950/30 border border-amber-700/50 rounded text-[11px] text-amber-200 flex items-start gap-2">
                      <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-amber-300">
                          OTT Metadata Discovery Mode ({selectedTarget.platform || 'OTT'}):
                        </span>{' '}
                        This reference has status <span className="font-mono">{selectedTarget.status}</span> (0 perceptual keyframes). Discovery will search using its title{selectedTarget.season_episode_info ? ` and event/episode metadata (${selectedTarget.season_episode_info})` : ''}, while perceptual frame matching is held until an authorized reference master video is attached.
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

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

              {/* Configurable Discovery Seed Sources */}
              <div className="space-y-1.5 p-3 bg-slate-950/70 border border-slate-800 rounded">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">
                    Configurable Seed Sources (Redirect &amp; Domain Validated)
                  </label>
                  <span className="text-[10px] font-mono text-cyan-400">{selectedSeeds.length} active</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {Array.from(new Set([...DEFAULT_SEEDS, ...selectedSeeds])).map((seedUrl) => {
                    const active = selectedSeeds.includes(seedUrl);
                    return (
                      <button
                        key={seedUrl}
                        type="button"
                        onClick={() => toggleSeed(seedUrl)}
                        className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                          active
                            ? 'bg-cyan-950/60 border-cyan-600/60 text-cyan-300'
                            : 'bg-slate-900 border-slate-800 text-slate-500'
                        }`}
                      >
                        {seedUrl}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 pt-1.5">
                  <input
                    type="text"
                    value={customSeedInput}
                    onChange={(e) => setCustomSeedInput(e.target.value)}
                    placeholder="Add custom seed URL (e.g. https://example-portal.org/)"
                    className="flex-1 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-[11px] text-white placeholder-slate-600 font-mono focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSeed}
                    className="px-2.5 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 cursor-pointer"
                  >
                    + Add Seed
                  </button>
                </div>
              </div>

              {/* Configurable Keyword Variations */}
              <div className="space-y-1.5 p-3 bg-slate-950/70 border border-slate-800 rounded">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">Expanded Search-Term Modifiers</label>
                  <span className="text-[10px] font-mono text-slate-400">
                    {selectedVariations.length} / {ALL_KEYWORD_VARIATIONS.length} enabled
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ALL_KEYWORD_VARIATIONS.map((mod) => {
                    const active = selectedVariations.includes(mod);
                    return (
                      <button
                        key={mod}
                        type="button"
                        onClick={() => toggleVariation(mod)}
                        className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-800 border-cyan-700/60 text-cyan-300'
                            : 'bg-slate-950 border-slate-800 text-slate-500'
                        }`}
                      >
                        {mod}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Discovery Scale Presets & Processing Limits */}
              <div className="space-y-2.5 p-3 bg-slate-950/70 border border-slate-800 rounded">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">
                    Candidate Discovery Preset &amp; Processing Limits
                  </label>
                  <span className="text-[10px] font-mono text-cyan-400">
                    Deduplicated Unique Candidates (Max 1,000)
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      { mode: 'STANDARD' as DiscoveryPresetMode, label: 'Standard', sub: '250 Unique' },
                      { mode: 'DEEP' as DiscoveryPresetMode, label: 'Deep', sub: '500 Unique' },
                      { mode: 'EXHAUSTIVE' as DiscoveryPresetMode, label: 'Exhaustive', sub: '1,000 Unique' },
                      { mode: 'CUSTOM' as DiscoveryPresetMode, label: 'Custom', sub: '1–1,000' }
                    ]
                  ).map(p => (
                    <button
                      key={p.mode}
                      type="button"
                      onClick={() => handleSelectPreset(p.mode)}
                      className={`p-2 rounded border text-left transition-colors cursor-pointer ${
                        presetMode === p.mode
                          ? 'bg-cyan-950/60 border-cyan-500/70 text-cyan-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">{p.label}</div>
                      <div className="text-[10px] font-mono opacity-80">{p.sub}</div>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2.5 pt-1">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400">Max Unique (1–1,000)</label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={maxCandidates}
                      onChange={(e) => {
                        setPresetMode('CUSTOM');
                        setMaxCandidates(e.target.value);
                      }}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400">Deep Research Limit</label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={deepResearchLimit}
                      onChange={(e) => setDeepResearchLimit(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400">Forensic Compare Limit</label>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={forensicComparisonLimit}
                      onChange={(e) => setForensicComparisonLimit(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>
                </div>
              </div>

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
