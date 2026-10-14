/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Overview & Intelligence Dashboard
 */

import React from 'react';
import { 
  ShieldCheck, 
  Search, 
  Radio, 
  FileCheck2, 
  AlertTriangle, 
  Activity, 
  ExternalLink,
  ChevronRight,
  Database
} from 'lucide-react';
import { SystemStats, EvidenceRecord } from '../types/client.js';

interface OverviewViewProps {
  stats: SystemStats | null;
  recentEvidence: EvidenceRecord[];
  onNavigate: (tab: string) => void;
  onSelectEvidence: (ev: EvidenceRecord) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  stats,
  recentEvidence,
  onNavigate,
  onSelectEvidence
}) => {
  return (
    <div className="space-y-8">
      {/* Hero Telemetry Banner */}
      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-900/60 shadow-lg">
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
          <img 
            src="/src/assets/images/hero_forensics_telemetry_1792002006041.jpg" 
            alt="Operations command telemetry" 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent" />
        </div>

        <div className="relative z-10 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <div className="flex items-center gap-2 text-xs text-cyan-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span>Argus Operational State</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">Continuous Perceptual Media Forensics</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white text-balance">
              Digital Evidence & Anti-Piracy Intelligence
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Real-time perceptual video fingerprinting, temporal stream cross-correlation, and tamper-evident chain of custody for on-demand media and live sports broadcasts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => onNavigate('candidates')}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors whitespace-nowrap cursor-pointer"
            >
              Inspect Candidates
            </button>
            <button
              onClick={() => onNavigate('discovery')}
              className="px-4 py-2 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded transition-colors font-semibold whitespace-nowrap cursor-pointer"
            >
              Launch Sweep
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metrics Grid (All computed directly from SQLite DB) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>References</span>
            <Database className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {stats ? stats.total_references : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Master fingerprint sets</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Discovered</span>
            <Search className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {stats ? stats.total_candidates : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Candidate sources</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Reachable</span>
            <Radio className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {stats ? stats.reachable_candidates : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">HTTP 200 / Streams</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Analyzed</span>
            <Activity className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {stats ? stats.analyzed_candidates : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Fingerprints matched</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Potential Matches</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 font-mono tabular-nums">
            {stats ? stats.potential_matches : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Similarity &gt; 55%</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Enforced</span>
            <FileCheck2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
            {stats ? stats.confirmed_infringements : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Human-confirmed</div>
        </div>
      </div>

      {/* Pipeline State Conversion Funnel */}
      <div className="p-6 rounded-lg bg-slate-900/40 border border-slate-800/80 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
          <div>
            <h2 className="text-base font-semibold text-white">Detection & Verification Pipeline Funnel</h2>
            <p className="text-xs text-slate-400">Strict separation between raw discovery, reachability, stream acquisition, and legal enforcement decisions</p>
          </div>
          <span className="text-xs font-mono text-slate-400">Live DB Metrics</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded">
            <div className="text-[11px] font-mono text-slate-400 uppercase">1. Discovered</div>
            <div className="text-xl font-bold text-slate-200 font-mono tabular-nums mt-1">
              {stats?.total_candidates || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">Raw URLs found</div>
          </div>

          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded">
            <div className="text-[11px] font-mono text-slate-400 uppercase">2. Reachable</div>
            <div className="text-xl font-bold text-slate-200 font-mono tabular-nums mt-1">
              {stats?.reachable_candidates || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">HTTP 200 verified</div>
          </div>

          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded">
            <div className="text-[11px] font-mono text-slate-400 uppercase">3. Media Detected</div>
            <div className="text-xl font-bold text-slate-200 font-mono tabular-nums mt-1">
              {stats?.media_detected_candidates || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">HLS / MP4 valid</div>
          </div>

          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded">
            <div className="text-[11px] font-mono text-slate-400 uppercase">4. Acquired</div>
            <div className="text-xl font-bold text-slate-200 font-mono tabular-nums mt-1">
              {stats?.analyzed_candidates || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">Frames extracted</div>
          </div>

          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded">
            <div className="text-[11px] font-mono text-slate-400 uppercase">5. Analyzed</div>
            <div className="text-xl font-bold text-amber-400 font-mono tabular-nums mt-1">
              {stats?.potential_matches || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">pHash match score</div>
          </div>

          <div className="p-3 bg-slate-950/60 border border-emerald-900/40 bg-emerald-950/10 rounded">
            <div className="text-[11px] font-mono text-emerald-400 uppercase">6. Enforced</div>
            <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums mt-1">
              {stats?.confirmed_infringements || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">Human reviewed</div>
          </div>
        </div>
      </div>

      {/* Recent Evidence Records Section */}
      <div className="p-6 rounded-lg bg-slate-900/40 border border-slate-800/80 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
          <div>
            <h2 className="text-base font-semibold text-white">Latest Forensic Evidence Records</h2>
            <p className="text-xs text-slate-400">Cryptographically sealed evidence dossiers generated from perceptual sequence comparisons</p>
          </div>
          <button
            onClick={() => onNavigate('evidence')}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1"
          >
            <span>View All Records</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentEvidence.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm space-y-2">
            <p>No evidence records generated yet.</p>
            <p className="text-xs text-slate-400">Launch a discovery sweep or click "Forensic Test Suite" in the top bar to test the pipeline.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {recentEvidence.slice(0, 4).map((ev) => (
              <div 
                key={ev.id} 
                onClick={() => onSelectEvidence(ev)}
                className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-800/30 px-3 rounded cursor-pointer transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-white">{ev.reference_title}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-400">{ev.candidate_domain}</span>
                    <span className="text-slate-600">·</span>
                    <span className="font-mono text-slate-400 text-[11px] truncate max-w-xs">{ev.candidate_url}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                    <span>Confidence: {(ev.confidence_score * 100).toFixed(1)}%</span>
                    <span>·</span>
                    <span>Min Hamming: {ev.min_hamming_dist} bits</span>
                    <span>·</span>
                    <span>Delay: {ev.temporal_offset_sec > 0 ? `+${ev.temporal_offset_sec}s` : `${ev.temporal_offset_sec}s`}</span>
                    <span>·</span>
                    <span>Seal: {ev.chain_of_custody_sha256.substring(0, 8)}...</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-mono font-medium ${
                    ev.match_status === 'POTENTIAL_MATCH' || ev.match_status === 'CONFIRMED_INFRINGEMENT'
                      ? 'text-amber-400'
                      : 'text-slate-400'
                  }`}>
                    {ev.match_status}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                    ev.review_decision === 'CONFIRMED' 
                      ? 'bg-rose-950/60 text-rose-300 border border-rose-800/50' 
                      : (ev.review_decision === 'PENDING' ? 'bg-amber-950/40 text-amber-300 border border-amber-800/40' : 'bg-slate-800 text-slate-300')
                  }`}>
                    {ev.review_decision}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
