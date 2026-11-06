/**
 * SPECTRA — Search Coverage & Discovery Intelligence Dashboard
 *
 * Displays:
 * 1. Estimated Internet Content Coverage (with explicit Measured vs. Estimated vs. Unavailable
 *    breakdowns, methodology, denominator definitions, assumptions, data sources, confidence, and timestamps)
 * 2. Configurable Candidate Discovery Presets (Standard 250, Deep 500, Exhaustive 1,000, Custom 1–1,000)
 *    + Deep Research Limit (default 200) & Forensic Comparison Limit (default 100)
 * 3. Candidate Lifecycle & Prioritization Funnel (Discovered -> Unique -> Researched ->
 *    Awaiting Research -> Queued for Comparison -> Compared -> Rejected -> Remaining Capacity)
 * 4. Platform & Content Ecosystem Coverage Matrix with live Enable/Disable adapter controls
 * 5. Discovery Performance, Search Progress, Unavailable Sources & Remaining Gaps
 * 6. Cross-Investigation & Historical Coverage Snapshots Comparison
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Sliders,
  AlertTriangle,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowUpRight,
  ShieldAlert,
  Clock,
  Database,
  Activity
} from 'lucide-react';
import {
  CandidateItem,
  CoverageMetricDetail,
  DiscoveryPresetMode,
  ReferenceItem,
  SearchCoverageReport
} from '../types/client.js';
import {
  fetchSearchCoverage,
  expandDiscoveryInvestigation,
  batchResearchCandidates,
  toggleDiscoveryEcosystem,
  fetchCandidates
} from '../api.js';

interface SearchCoverageDashboardProps {
  references: ReferenceItem[];
  selectedReferenceId: string;
  onSelectReferenceId: (refId: string) => void;
  onRefreshParent: () => void;
  onNavigateToCandidates: (referenceId?: string) => void;
  jobsCount: number;
}

export const SearchCoverageDashboard: React.FC<SearchCoverageDashboardProps> = ({
  references,
  selectedReferenceId,
  onSelectReferenceId,
  onRefreshParent,
  onNavigateToCandidates,
  jobsCount
}) => {
  const [report, setReport] = useState<SearchCoverageReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionBanner, setActionBanner] = useState<{ text: string; tone: 'success' | 'info' | 'error' } | null>(null);

  // Investigator Configurable Preset & Limits State
  const [presetMode, setPresetMode] = useState<DiscoveryPresetMode>('STANDARD');
  const [maxUniqueCandidates, setMaxUniqueCandidates] = useState<number>(250);
  const [deepResearchLimit, setDeepResearchLimit] = useState<number>(200);
  const [forensicComparisonLimit, setForensicComparisonLimit] = useState<number>(100);
  const [runAdditionalDiscoveryOnExpand, setRunAdditionalDiscoveryOnExpand] = useState<boolean>(false);

  // Interactive UI states — Methodology collapsed by default for a clean initial view
  const [expandedMetricId, setExpandedMetricId] = useState<string | null>(null);
  const [expandedEcoId, setExpandedEcoId] = useState<string | null>(null);
  const [isExpanding, setIsExpanding] = useState<boolean>(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [togglingEcoId, setTogglingEcoId] = useState<string | null>(null);

  // Candidate selection for targeted research/comparison
  const [scopedCandidates, setScopedCandidates] = useState<CandidateItem[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [showCandidateQueueDrawer, setShowCandidateQueueDrawer] = useState<boolean>(false);

  const loadCoverage = useCallback(
    async (syncLimitsFromReport: boolean = false) => {
      try {
        const [covData, candList] = await Promise.all([
          fetchSearchCoverage({
            referenceId: selectedReferenceId || undefined
          }),
          fetchCandidates(selectedReferenceId ? { referenceId: selectedReferenceId } : undefined)
        ]);
        setReport(covData);
        setScopedCandidates(candList);
        if (syncLimitsFromReport && covData?.configured_limits) {
          setPresetMode(covData.configured_limits.preset_mode);
          setMaxUniqueCandidates(covData.configured_limits.max_unique_candidates);
          setDeepResearchLimit(covData.configured_limits.deep_research_limit);
          setForensicComparisonLimit(covData.configured_limits.forensic_comparison_limit);
        }
      } catch (err: any) {
        console.warn('Failed to load search coverage report:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [selectedReferenceId]
  );

  useEffect(() => {
    loadCoverage(true);
  }, [loadCoverage, jobsCount]);

  const handleSelectPreset = (mode: DiscoveryPresetMode) => {
    setPresetMode(mode);
    if (mode === 'STANDARD') {
      setMaxUniqueCandidates(250);
    } else if (mode === 'DEEP') {
      setMaxUniqueCandidates(500);
    } else if (mode === 'EXHAUSTIVE') {
      setMaxUniqueCandidates(1000);
    }
  };

  const handleExpandInvestigation = async (overridePreset?: DiscoveryPresetMode, overrideMax?: number) => {
    setIsExpanding(true);
    setActionBanner(null);
    const effectivePreset = overridePreset || presetMode;
    const effectiveMax = overrideMax ?? maxUniqueCandidates;
    try {
      const res = await expandDiscoveryInvestigation({
        job_id: report?.active_job_id,
        reference_id: selectedReferenceId || undefined,
        preset_mode: effectivePreset,
        max_unique_candidates: effectiveMax,
        deep_research_limit: deepResearchLimit,
        forensic_comparison_limit: forensicComparisonLimit,
        run_additional_discovery: runAdditionalDiscoveryOnExpand,
        auto_verify: true
      });
      setReport(res.coverageReport);
      setActionBanner({
        text: `Investigation updated (${effectivePreset} · ${effectiveMax} unique limit, ${deepResearchLimit} research limit, ${forensicComparisonLimit} forensic limit). Reused ${res.reusedResearchCount} cached research result(s) and ${res.reusedComparisonCount} cached forensic comparison(s); newly researched ${res.newlyResearchedCount} and compared ${res.newlyComparedCount} candidate(s).`,
        tone: 'success'
      });
      await loadCoverage(false);
      onRefreshParent();
    } catch (err: any) {
      setActionBanner({
        text: err.message || 'Failed to expand investigation',
        tone: 'error'
      });
    } finally {
      setIsExpanding(false);
    }
  };

  const handleContinueIncompleteWork = async (options: {
    runDeepResearch: boolean;
    runForensicComparison: boolean;
    candidateIds?: string[];
  }) => {
    setIsBatchProcessing(true);
    setActionBanner(null);
    try {
      const res = await batchResearchCandidates({
        candidate_ids: options.candidateIds,
        reference_id: selectedReferenceId || undefined,
        deep_research_limit: deepResearchLimit,
        forensic_comparison_limit: forensicComparisonLimit,
        run_deep_research: options.runDeepResearch,
        run_forensic_comparison: options.runForensicComparison
      });
      setReport(res.coverageReport);
      setSelectedCandidateIds([]);
      setActionBanner({
        text: `Completed incremental processing: Reused ${res.reusedResearchCount} cached research & ${res.reusedComparisonCount} cached comparison(s); newly researched ${res.newlyResearchedCount} and forensically compared ${res.newlyComparedCount} candidate(s).`,
        tone: 'success'
      });
      await loadCoverage(false);
      onRefreshParent();
    } catch (err: any) {
      setActionBanner({
        text: err.message || 'Failed to process candidate queue',
        tone: 'error'
      });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleToggleEcosystem = async (adapterOrEcoId: string, currentlyEnabled: boolean) => {
    setTogglingEcoId(adapterOrEcoId);
    try {
      const updatedReport = await toggleDiscoveryEcosystem(
        adapterOrEcoId,
        !currentlyEnabled,
        selectedReferenceId || undefined
      );
      setReport(updatedReport);
    } catch (err: any) {
      setActionBanner({
        text: err.message || 'Failed to toggle discovery ecosystem',
        tone: 'error'
      });
    } finally {
      setTogglingEcoId(null);
    }
  };

  const toggleSelectCandidate = (id: string) => {
    setSelectedCandidateIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  };

  if (isLoading || !report) {
    return (
      <div className="p-6 rounded-lg bg-slate-900/50 border border-slate-800/80 text-xs font-mono text-slate-400">
        Computing Search Coverage &amp; Discovery Intelligence model...
      </div>
    );
  }

  const primaryMetrics: CoverageMetricDetail[] = [
    report.overall_coverage.estimated_searchable_coverage,
    report.overall_coverage.source_inspection_coverage,
    report.overall_coverage.candidate_research_coverage,
    report.overall_coverage.forensic_investigation_coverage
  ];

  const lc = report.candidate_lifecycle;
  const dp = report.discovery_performance;
  const sp = report.search_progress;

  const pendingOrDeferredCandidates = scopedCandidates.filter(
    c =>
      c.research_stage === 'AWAITING_RESEARCH' ||
      c.comparison_stage === 'QUEUED_FOR_COMPARISON' ||
      c.comparison_stage === 'DEFERRED_BY_LIMIT' ||
      c.pipeline_status === 'DISCOVERED'
  );

  const funnelPrimarySteps = [
    {
      step: '01',
      label: 'Raw Discovered',
      value: lc.raw_discovered_count.toLocaleString(),
      sub: `${lc.duplicates_merged_count} dup(s) merged`,
      valueTone: 'text-white',
      subTone: 'text-amber-300/90'
    },
    {
      step: '02',
      label: 'Unique Candidates',
      value: lc.unique_candidates_count.toLocaleString(),
      sub: `Limit: ${lc.configured_limits.max_unique_candidates}`,
      valueTone: 'text-cyan-400',
      subTone: 'text-slate-400'
    },
    {
      step: '03',
      label: 'Researched',
      value: lc.researched_candidates_count.toLocaleString(),
      sub: `Top ${lc.configured_limits.deep_research_limit} priority`,
      valueTone: 'text-emerald-400',
      subTone: 'text-slate-400'
    },
    {
      step: '04',
      label: 'Awaiting Research',
      value: lc.awaiting_research_count.toLocaleString(),
      sub: 'Retained in queue',
      valueTone: 'text-amber-300',
      subTone: 'text-slate-400'
    },
    {
      step: '05',
      label: 'Queued Comparison',
      value: lc.queued_for_comparison_count.toLocaleString(),
      sub: 'Ready for FFmpeg',
      valueTone: 'text-amber-400',
      subTone: 'text-slate-400'
    },
    {
      step: '06',
      label: 'Forensically Compared',
      value: lc.compared_candidates_count.toLocaleString(),
      sub: `Top ${lc.configured_limits.forensic_comparison_limit} priority`,
      valueTone: 'text-emerald-400',
      subTone: 'text-slate-400'
    }
  ];

  return (
    <div className="space-y-6">
      {/* 1. Compact Discovery Intelligence Control Bar */}
      <section className="rounded-lg bg-slate-900/50 border border-slate-800/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
              <h2 className="text-sm font-semibold text-white tracking-tight">
                Search Coverage &amp; Discovery Intelligence
              </h2>
              <span className="text-xs font-mono text-slate-400">
                · Mode: <strong className="text-cyan-300 font-semibold">{lc.configured_limits.preset_mode}</strong> ({lc.configured_limits.max_unique_candidates} max unique)
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-4xl">
              Coverage model calibrated against SPECTRA&apos;s Online Video-Content Universe denominator (1,000 weighted index units across 8 ecosystems), separating verified HTTP/API measurements from modeled reach and DRM/auth boundaries.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <label className="text-xs text-slate-400 font-mono whitespace-nowrap">Scope:</label>
            <select
              value={selectedReferenceId}
              onChange={e => onSelectReferenceId(e.target.value)}
              className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white focus:outline-none focus:border-cyan-400 font-mono max-w-xs"
            >
              <option value="">All Registered Investigations ({references.length})</option>
              {references.map(r => (
                <option key={r.id} value={r.id}>
                  {r.title} {r.season_episode_info ? `(${r.season_episode_info})` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => loadCoverage(false)}
              className="px-3 py-1.5 text-xs font-mono text-slate-300 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Unified Preset Selector, Limit Inputs & Execution Controls */}
        <div className="p-5 bg-slate-950/40 grid grid-cols-1 xl:grid-cols-12 gap-5 items-end">
          {/* Preset Mode Segmented Control */}
          <div className="xl:col-span-5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                Discovery Depth Preset
              </span>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">Ceiling: 1,000 unique</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-950 border border-slate-800/90 rounded-lg">
              {(
                [
                  { mode: 'STANDARD', label: 'Standard', desc: '250' },
                  { mode: 'DEEP', label: 'Deep', desc: '500' },
                  { mode: 'EXHAUSTIVE', label: 'Exhaustive', desc: '1,000' },
                  { mode: 'CUSTOM', label: 'Custom', desc: `${maxUniqueCandidates}` }
                ] as const
              ).map(p => {
                const active = presetMode === p.mode;
                return (
                  <button
                    key={p.mode}
                    type="button"
                    onClick={() => handleSelectPreset(p.mode)}
                    className={`py-1.5 px-2.5 rounded text-left transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-cyan-950/80 border border-cyan-500/60 text-white'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    <div className="text-xs font-semibold">{p.label}</div>
                    <div className="text-[10px] font-mono text-cyan-400 tabular-nums">{p.desc} max</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Numeric Limits */}
          <div className="xl:col-span-4 grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-mono text-slate-400 truncate" title="Unique Candidate Limit (Max 1,000)">
                Unique Limit
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxUniqueCandidates}
                onChange={e => {
                  const val = Math.max(1, Math.min(1000, Number(e.target.value) || 1));
                  setMaxUniqueCandidates(val);
                  if (val === 250) setPresetMode('STANDARD');
                  else if (val === 500) setPresetMode('DEEP');
                  else if (val === 1000) setPresetMode('EXHAUSTIVE');
                  else setPresetMode('CUSTOM');
                }}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono font-semibold text-white tabular-nums focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-mono text-slate-400 truncate" title="Deep Research Limit (Default 200)">
                Research Limit
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={deepResearchLimit}
                onChange={e => setDeepResearchLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 200)))}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono font-semibold text-cyan-300 tabular-nums focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-mono text-slate-400 truncate" title="Forensic Compare Limit (Default 100)">
                Compare Limit
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={forensicComparisonLimit}
                onChange={e => setForensicComparisonLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 100)))}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono font-semibold text-emerald-300 tabular-nums focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="xl:col-span-3 space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={runAdditionalDiscoveryOnExpand}
                onChange={e => setRunAdditionalDiscoveryOnExpand(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-400"
              />
              <span className="truncate">Run live queries on expand</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isExpanding}
                onClick={() => handleExpandInvestigation()}
                className="flex-1 px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {isExpanding ? 'Expanding...' : 'Apply Limits / Expand'}
              </button>
              <button
                type="button"
                disabled={isBatchProcessing || (lc.awaiting_research_count === 0 && lc.queued_for_comparison_count === 0)}
                onClick={() =>
                  handleContinueIncompleteWork({
                    runDeepResearch: true,
                    runForensicComparison: true
                  })
                }
                className="px-3 py-1.5 text-xs font-mono text-cyan-300 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                title="Processes awaiting research and queued comparisons using cached results without repeating completed work"
              >
                {isBatchProcessing ? 'Processing...' : 'Continue Queued'}
              </button>
            </div>
          </div>
        </div>

        {actionBanner && (
          <div
            className={`px-5 py-3 border-t text-xs flex items-center justify-between gap-3 ${
              actionBanner.tone === 'success'
                ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
                : actionBanner.tone === 'error'
                ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
                : 'bg-cyan-950/30 border-cyan-800/60 text-cyan-200'
            }`}
          >
            <span>{actionBanner.text}</span>
            <button
              type="button"
              onClick={() => setActionBanner(null)}
              className="text-xs font-mono underline opacity-80 hover:opacity-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </section>

      {/* 2. Four Main Coverage Metric Cards (Methodology Expandable on Demand) */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {primaryMetrics.map(metric => {
          const isExpanded = expandedMetricId === metric.id;
          return (
            <div
              key={metric.id}
              className="rounded-lg bg-slate-900/50 border border-slate-800/80 p-4 flex flex-col justify-between space-y-3.5"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-200 leading-snug">{metric.label}</h3>
                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider shrink-0 ${
                      metric.coverage_type === 'MEASURED' ? 'text-emerald-400' : 'text-cyan-400'
                    }`}
                  >
                    {metric.coverage_type}
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-2xl font-bold font-mono text-white tabular-nums">
                    {metric.percentage.toFixed(1)}%
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-xs text-slate-300">
                      {metric.numerator.toLocaleString()} / {metric.denominator.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500">{metric.unit_label}</div>
                  </div>
                </div>

                {/* Segmented Progress Bar */}
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full rounded-full bg-slate-950 overflow-hidden flex">
                    {metric.measured_pct > 0 && (
                      <div
                        style={{ width: `${Math.min(100, metric.measured_pct)}%` }}
                        className="bg-emerald-400 h-full"
                        title={`Measured: ${metric.measured_pct}%`}
                      />
                    )}
                    {metric.estimated_pct > 0 && (
                      <div
                        style={{ width: `${Math.min(100, metric.estimated_pct)}%` }}
                        className="bg-cyan-400 h-full"
                        title={`Estimated: ${metric.estimated_pct}%`}
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                    <span className="text-emerald-400">Meas: {metric.measured_pct}%</span>
                    {metric.estimated_pct > 0 && <span className="text-cyan-400">Est: +{metric.estimated_pct}%</span>}
                    <span className="text-slate-500">Gap: {metric.unavailable_pct}%</span>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-800/70 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>
                    Confidence: <strong className="text-slate-200 font-semibold">{metric.confidence_level}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedMetricId(isExpanded ? null : metric.id)}
                    className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <span>{isExpanded ? 'Hide Details' : 'Methodology'}</span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {isExpanded && (
                  <div className="pt-2 border-t border-slate-800/60 text-xs space-y-2 text-slate-300">
                    <div>
                      <span className="font-semibold text-white">Denominator: </span>
                      <span className="text-slate-400">{metric.denominator_definition}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-white">Methodology: </span>
                      <span className="text-slate-400">{metric.methodology}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-white">Assumptions: </span>
                      <ul className="list-disc list-inside text-slate-400 space-y-0.5 mt-0.5">
                        {metric.assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/50">
                      Sources: {metric.data_sources.join(' · ')} · Updated: {new Date(metric.last_updated_at).toLocaleTimeString()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* 3. Candidate Processing Funnel & Telemetry Strip */}
      <section className="rounded-lg bg-slate-900/50 border border-slate-800/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Candidate Deduplication, Ranking &amp; Processing Funnel
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Cross-source discoveries are deduplicated before counting unique candidates, ranked by target relevance, and queued for deep research and FFmpeg frame comparison.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowCandidateQueueDrawer(!showCandidateQueueDrawer)}
              className="px-3 py-1.5 text-xs font-mono text-cyan-300 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded transition-colors cursor-pointer whitespace-nowrap"
            >
              {showCandidateQueueDrawer ? 'Hide Candidate Queue' : `Inspect / Select Candidates (${scopedCandidates.length})`}
            </button>
            <button
              type="button"
              onClick={() => onNavigateToCandidates(selectedReferenceId || undefined)}
              className="px-3 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>Open Candidate Matrix</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Horizontal 6-Stage Processing Funnel */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {funnelPrimarySteps.map((stage, idx) => (
              <div
                key={stage.step}
                className="relative p-3 rounded bg-slate-950/70 border border-slate-800/90 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>
                    {stage.step}. {stage.label}
                  </span>
                  {idx < funnelPrimarySteps.length - 1 && (
                    <ChevronRight className="hidden lg:block w-3.5 h-3.5 text-slate-600 shrink-0" />
                  )}
                </div>
                <div className={`text-lg font-mono font-bold tabular-nums mt-1.5 ${stage.valueTone}`}>
                  {stage.value}
                </div>
                <div className={`text-[11px] font-mono tabular-nums mt-0.5 ${stage.subTone}`}>
                  {stage.sub}
                </div>
              </div>
            ))}
          </div>

          {/* Secondary Funnel Counters & Telemetry Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 pt-1 border-t border-slate-800/60 text-xs font-mono">
            <div className="py-2 px-3 rounded bg-slate-950/40 flex items-center justify-between">
              <span className="text-slate-400">07. Filtered Out</span>
              <span className="font-bold text-rose-400 tabular-nums">{lc.rejected_or_irrelevant_count.toLocaleString()}</span>
            </div>
            <div className="py-2 px-3 rounded bg-slate-950/40 flex items-center justify-between">
              <span className="text-slate-400">08. Spare Capacity</span>
              <span className="font-bold text-white tabular-nums">
                {lc.remaining_candidate_capacity.toLocaleString()} / {lc.max_system_ceiling}
              </span>
            </div>
            <div className="py-2 px-3 rounded bg-slate-950/40 flex items-center justify-between">
              <span className="text-slate-400">Sources Checked</span>
              <span className="font-bold text-cyan-400 tabular-nums">
                {dp.sources_checked} / {dp.sources_configured}
              </span>
            </div>
            <div className="py-2 px-3 rounded bg-slate-950/40 flex items-center justify-between">
              <span className="text-slate-400">Queries Executed</span>
              <span className="font-bold text-white tabular-nums">
                {dp.search_queries_executed} / {dp.search_queries_planned_budget}
              </span>
            </div>
            <div className="py-2 px-3 rounded bg-slate-950/40 flex items-center justify-between">
              <span className="text-slate-400">Pages Inspected</span>
              <span className="font-bold text-cyan-300 tabular-nums">
                {dp.pages_inspected} / {dp.pages_discovered}
              </span>
            </div>
            <div className="py-2 px-3 rounded bg-slate-950/40 flex items-center justify-between">
              <span className="text-slate-400">Overall Progress</span>
              <span className="font-bold text-emerald-400 tabular-nums">{sp.overall_progress_pct}%</span>
            </div>
          </div>

          {/* Detailed Search Progress Breakdown Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded bg-slate-950/60 border border-slate-800/80 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-300 font-mono text-[11px] tabular-nums">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span>Relevant Identified: <strong className="text-emerald-400">{dp.relevant_candidates_identified}/{dp.unique_candidates_discovered}</strong></span>
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Completed (Res+Comp): <strong className="text-emerald-400">{sp.completed_research_count + sp.completed_comparisons_count}</strong></span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Pending Queue: <strong className="text-amber-300">{sp.pending_research_count + sp.pending_comparisons_count}</strong></span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Failed / Restricted: <strong className="text-rose-400">{sp.failed_or_restricted_sources_count + sp.failed_inspections_count}</strong></span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Remaining Query Capacity: <strong className="text-cyan-300">{sp.remaining_queries_capacity}</strong></span>
            </div>
          </div>

          {/* Limit Status & One-Click Expansion Bar */}
          <div
            className={`px-4 py-3 rounded border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              lc.unique_limit_reached || lc.research_limit_reached || lc.comparison_limit_reached
                ? 'bg-amber-950/25 border-amber-800/60 text-amber-200'
                : 'bg-slate-950/50 border-slate-800/80 text-slate-300'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-white">Discovery &amp; Prioritization Status: </span>
                <span>{lc.limit_explanation}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {lc.configured_limits.max_unique_candidates < 500 && (
                <button
                  type="button"
                  disabled={isExpanding}
                  onClick={() => {
                    handleSelectPreset('DEEP');
                    handleExpandInvestigation('DEEP', 500);
                  }}
                  className="px-3 py-1 text-xs font-mono bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/60 rounded cursor-pointer whitespace-nowrap"
                >
                  Expand to Deep (500)
                </button>
              )}
              {lc.configured_limits.max_unique_candidates < 1000 && (
                <button
                  type="button"
                  disabled={isExpanding}
                  onClick={() => {
                    handleSelectPreset('EXHAUSTIVE');
                    handleExpandInvestigation('EXHAUSTIVE', 1000);
                  }}
                  className="px-3 py-1 text-xs font-mono bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 rounded cursor-pointer whitespace-nowrap"
                >
                  Expand to Exhaustive (1,000)
                </button>
              )}
            </div>
          </div>

          {/* Interactive Candidate Selection & Batch Research Drawer */}
          {showCandidateQueueDrawer && (
            <div className="p-4 rounded bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="text-xs font-semibold text-white">
                  Select Discovered Candidates to Research or Forensically Compare Further ({selectedCandidateIds.length} selected)
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {pendingOrDeferredCandidates.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedCandidateIds(pendingOrDeferredCandidates.map(c => c.id))}
                      className="px-2.5 py-1 text-xs font-mono text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded cursor-pointer whitespace-nowrap"
                    >
                      Select All Awaiting/Queued ({pendingOrDeferredCandidates.length})
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={selectedCandidateIds.length === 0 || isBatchProcessing}
                    onClick={() =>
                      handleContinueIncompleteWork({
                        runDeepResearch: true,
                        runForensicComparison: true,
                        candidateIds: selectedCandidateIds
                      })
                    }
                    className="px-3 py-1 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded cursor-pointer disabled:opacity-40 whitespace-nowrap"
                  >
                    {isBatchProcessing ? 'Processing...' : `Research & Compare Selected (${selectedCandidateIds.length})`}
                  </button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60 text-xs">
                {scopedCandidates.slice(0, 100).map((cand, i) => {
                  const checked = selectedCandidateIds.includes(cand.id);
                  const relScorePct = Math.round((cand.research_relevance_score ?? 0.5) * 100);
                  return (
                    <label
                      key={cand.id}
                      className="py-2.5 px-2 flex items-center justify-between gap-3 hover:bg-slate-900/60 cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectCandidate(cand.id)}
                          className="rounded border-slate-700 bg-slate-900 text-cyan-400"
                        />
                        <span className="text-xs font-mono text-slate-500 tabular-nums">#{i + 1}</span>
                        <span className="font-medium text-slate-200 truncate">{cand.discovered_title}</span>
                        <span className="text-xs font-mono text-cyan-400 truncate max-w-xs">{cand.source_url}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] tabular-nums">
                        <span className="text-slate-300">Rel: {relScorePct}%</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span
                          className={
                            cand.research_stage === 'RESEARCHED' ? 'text-emerald-400' : 'text-amber-300'
                          }
                        >
                          {cand.research_stage || 'RESEARCHED'}
                        </span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span
                          className={
                            cand.comparison_stage === 'COMPARED' || cand.pipeline_status === 'ANALYZED'
                              ? 'text-cyan-300'
                              : 'text-slate-400'
                          }
                        >
                          {cand.comparison_stage || cand.pipeline_status}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 4. Platform & Content Ecosystem Coverage Table */}
      <section className="rounded-lg bg-slate-900/50 border border-slate-800/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Coverage by Platform &amp; Content Ecosystem
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Reachability and inspection breakdown across YouTube, Dailymotion, Vimeo, Public Video Archives, Indexed Web, Social Video, Configured Piracy Portals, and Commercial OTT
            </p>
          </div>
          <span className="text-xs font-mono text-cyan-400 tabular-nums whitespace-nowrap">
            Universe Total: 100.0% · Est. Reachable: {report.overall_coverage.estimated_searchable_coverage.percentage.toFixed(1)}%
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 font-mono text-[11px]">
              <tr>
                <th className="py-3 px-5 font-medium">Ecosystem &amp; Included Platforms</th>
                <th className="py-3 px-3 font-medium text-right">Universe Wt</th>
                <th className="py-3 px-3 font-medium text-right">Est. Reachable</th>
                <th className="py-3 px-3 font-medium text-right">Measured Insp.</th>
                <th className="py-3 px-3 font-medium text-right">Unavailable</th>
                <th className="py-3 px-3 font-medium text-right">Queries / Pages</th>
                <th className="py-3 px-3 font-medium text-right">Unique / Res / Comp</th>
                <th className="py-3 px-5 font-medium text-right">Adapter Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {report.platform_ecosystems.map(eco => {
                const isExpanded = expandedEcoId === eco.id;
                const isToggling = togglingEcoId === (eco.adapter_id || eco.id);
                return (
                  <React.Fragment key={eco.id}>
                    <tr className="hover:bg-slate-800/25 transition-colors">
                      <td className="py-3.5 px-5 max-w-md">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-semibold text-white">{eco.name}</span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span
                            className={`text-[11px] font-mono ${
                              eco.adapter_status === 'ACTIVE_LIVE'
                                ? 'text-emerald-400'
                                : eco.adapter_status === 'CONDITIONAL_AUTH'
                                ? 'text-cyan-400'
                                : eco.adapter_status === 'METADATA_ONLY'
                                ? 'text-amber-300'
                                : 'text-slate-500'
                            }`}
                          >
                            {eco.adapter_status}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-400 truncate mt-0.5">
                          {eco.platforms_included.join(' · ')}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                        {eco.universe_weight_pct.toFixed(1)}%
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-bold text-cyan-400">{eco.estimated_searchable_pct.toFixed(1)}%</div>
                        <div className="text-[11px] text-slate-400">
                          +{eco.weighted_universe_contribution_pct.toFixed(1)}% univ
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono text-emerald-400 tabular-nums whitespace-nowrap">
                        {eco.measured_inspection_pct.toFixed(1)}%
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono text-amber-300 tabular-nums whitespace-nowrap">
                        {eco.unavailable_pct.toFixed(1)}%
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                        {eco.queries_executed} q · {eco.pages_inspected}/{eco.pages_discovered} p
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono text-white tabular-nums whitespace-nowrap">
                        {eco.unique_candidates} / {eco.researched_candidates} / {eco.compared_candidates}
                      </td>

                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedEcoId(isExpanded ? null : eco.id)}
                            className="px-2.5 py-1 text-xs font-mono text-cyan-400 hover:text-cyan-300 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded transition-colors flex items-center gap-1 cursor-pointer"
                            title="Inspect ecosystem methodology, assumptions, and remaining coverage gaps"
                          >
                            <span>{isExpanded ? 'Hide Info' : 'Details'}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          {eco.adapter_id && (
                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={() => handleToggleEcosystem(eco.adapter_id!, eco.adapter_enabled)}
                              className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors cursor-pointer ${
                                eco.adapter_enabled
                                  ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                                  : 'bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/60'
                              }`}
                            >
                              {eco.adapter_enabled ? 'Disable' : 'Enable'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-slate-950/80">
                        <td colSpan={8} className="px-5 py-4 text-xs border-t border-slate-800/80">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                              <div>
                                <span className="font-semibold text-white">Methodology: </span>
                                <span className="text-slate-300">{eco.methodology}</span>
                              </div>
                              <div>
                                <span className="font-semibold text-white">Denominator: </span>
                                <span className="text-slate-400">{eco.denominator_definition}</span>
                              </div>
                              <div>
                                <span className="font-semibold text-amber-300">Remaining Gap Explanation: </span>
                                <span className="text-amber-200/90">{eco.gap_explanation}</span>
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <div className="font-semibold text-white">Assumptions &amp; Data Sources:</div>
                              <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                                {eco.assumptions.map((a, idx) => (
                                  <li key={idx}>{a}</li>
                                ))}
                              </ul>
                              <div className="text-xs font-mono text-cyan-300 pt-1">
                                Data Sources: {eco.data_sources.join(' · ')} · Confidence: {eco.confidence_level}
                              </div>
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
      </section>

      {/* 5. Unavailable Sources & Remaining Search Gaps */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Unavailable or Inaccessible Sources */}
        <div className="rounded-lg bg-slate-900/50 border border-slate-800/80 overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Unavailable, Restricted or Credential-Gated Sources</span>
            </h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {report.unavailable_or_inaccessible_sources.length} source(s)
            </span>
          </div>
          {report.unavailable_or_inaccessible_sources.length === 0 ? (
            <div className="text-xs text-slate-400 p-6 text-center">
              All configured sources and adapters are currently accessible.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto px-5">
              {report.unavailable_or_inaccessible_sources.map(src => (
                <div key={src.id} className="py-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">{src.name}</span>
                    <span className="text-[11px] font-mono text-amber-300 shrink-0">
                      {src.status}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-cyan-400 truncate">{src.url_or_platform}</div>
                  <div className="text-xs text-slate-400 leading-relaxed">{src.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Remaining Search & Inspection Gaps */}
        <div className="rounded-lg bg-slate-900/50 border border-slate-800/80 overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Remaining Search &amp; Inspection Gaps</span>
            </h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {report.remaining_gaps.length} gap(s)
            </span>
          </div>
          <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto px-5">
            {report.remaining_gaps.map(gap => (
              <div key={gap.id} className="py-3 space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{gap.ecosystem_or_source}</span>
                  <span className="text-xs font-mono text-amber-300 tabular-nums shrink-0">
                    Impact: ~{gap.impact_pct}%
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{gap.description}</p>
                <div className="text-xs font-mono text-cyan-400">
                  Remediation: {gap.remediation_action}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Cross-Investigation Coverage Comparison & Historical Snapshots */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cross-Investigation Comparison */}
        <div className="rounded-lg bg-slate-900/50 border border-slate-800/80 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Coverage Comparison Across Registered Investigations</span>
            </h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {report.investigation_comparisons.length} target(s)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Investigation Target</th>
                  <th className="py-2.5 px-3 font-medium text-right">Preset</th>
                  <th className="py-2.5 px-3 font-medium text-right">Unique</th>
                  <th className="py-2.5 px-3 font-medium text-right">Researched</th>
                  <th className="py-2.5 px-4 font-medium text-right">Compared</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {report.investigation_comparisons.map(inv => (
                  <tr
                    key={inv.reference_id}
                    onClick={() => onSelectReferenceId(inv.reference_id)}
                    className={`hover:bg-slate-800/40 cursor-pointer transition-colors ${
                      selectedReferenceId === inv.reference_id ? 'bg-cyan-950/25' : ''
                    }`}
                  >
                    <td className="py-2.5 px-4 font-medium text-white truncate max-w-[200px]">
                      {inv.reference_title}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs text-cyan-400 tabular-nums whitespace-nowrap">
                      {inv.latest_preset_mode} ({inv.max_unique_candidates})
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-white tabular-nums whitespace-nowrap">
                      {inv.unique_candidates}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-400 tabular-nums whitespace-nowrap">
                      {inv.researched_candidates} ({inv.candidate_research_pct}%)
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-cyan-300 tabular-nums whitespace-nowrap">
                      {inv.compared_candidates} ({inv.forensic_comparison_pct}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Historical Coverage Snapshots Over Time */}
        <div className="rounded-lg bg-slate-900/50 border border-slate-800/80 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Coverage History &amp; Expansion Snapshots</span>
            </h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {report.historical_snapshots.length} snapshot(s)
            </span>
          </div>
          {report.historical_snapshots.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              Run a discovery sweep or click &ldquo;Apply Limits / Expand&rdquo; to record a historical coverage snapshot.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-56 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Timestamp &amp; Target</th>
                    <th className="py-2.5 px-3 font-medium text-right">Mode</th>
                    <th className="py-2.5 px-3 font-medium text-right">Est. Cov</th>
                    <th className="py-2.5 px-3 font-medium text-right">Unique</th>
                    <th className="py-2.5 px-4 font-medium text-right">Res / Comp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {report.historical_snapshots.slice(0, 12).map(snap => (
                    <tr key={snap.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4">
                        <div className="text-xs font-mono text-slate-300 tabular-nums">
                          {new Date(snap.created_at).toLocaleString([], {
                            month: 'short',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                          {snap.reference_title || 'All Investigations'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-xs text-cyan-400 tabular-nums whitespace-nowrap">
                        {snap.preset_mode} ({snap.max_unique_candidates})
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-white tabular-nums whitespace-nowrap">
                        {snap.overall_estimated_coverage_pct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-cyan-300 tabular-nums whitespace-nowrap">
                        {snap.unique_candidates_count}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-emerald-400 tabular-nums whitespace-nowrap">
                        {snap.researched_candidates_count} / {snap.compared_candidates_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
