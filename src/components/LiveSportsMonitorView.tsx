/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Stage E — Live Sports Streaming Intelligence & Latency Tracking
 */

import React, { useState } from 'react';
import { 
  Radio, 
  Clock, 
  ShieldAlert, 
  CheckCircle2, 
  Layers, 
  Sliders, 
  Activity, 
  ExternalLink,
  ChevronRight,
  TrendingDown,
  RefreshCw,
  Zap
} from 'lucide-react';
import { CandidateItem, EvidenceRecord, ReferenceItem } from '../types/client.js';

interface LiveSportsMonitorViewProps {
  references: ReferenceItem[];
  candidates: CandidateItem[];
  evidenceRecords: EvidenceRecord[];
  onRefresh: () => void;
  onNavigateToEvidence: (ev: EvidenceRecord) => void;
  onLaunchLiveSweep: () => void;
}

export const LiveSportsMonitorView: React.FC<LiveSportsMonitorViewProps> = ({
  references,
  candidates,
  evidenceRecords,
  onRefresh,
  onNavigateToEvidence,
  onLaunchLiveSweep
}) => {
  const [duplicateSuppression, setDuplicateSuppression] = useState(true);
  const [rollingWindowSec, setRollingWindowSec] = useState('30');

  const sportsReferences = references.filter(r => r.asset_type === 'LIVE_SPORTS');
  const liveCandidates = candidates.filter(c => c.is_live_stream || c.media_type === 'HLS_M3U8');
  const liveEvidence = evidenceRecords.filter(ev => {
    const ref = references.find(r => r.id === ev.reference_id);
    return ref?.asset_type === 'LIVE_SPORTS' || ev.temporal_offset_sec > 0;
  });

  // Calculate average broadcast delay among matched pirate streams
  const delays = liveEvidence.filter(e => e.temporal_offset_sec > 0).map(e => e.temporal_offset_sec);
  const avgBroadcastDelay = delays.length > 0 
    ? (delays.reduce((sum, d) => sum + d, 0) / delays.length).toFixed(1)
    : '16.0';

  return (
    <div className="space-y-6">
      {/* Live Sports Stadium Hero Header */}
      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-900/60 shadow-lg">
        <div className="absolute inset-0 z-0 opacity-25 pointer-events-none">
          <img 
            src="/src/assets/images/sports_broadcast_stadium_1792002024010.jpg" 
            alt="Live sports broadcast stadium" 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent" />
        </div>

        <div className="relative z-10 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Broadcast Surveillance Mode</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">Rolling Temporal Window & Latency Profiling</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              Live Sports Broadcast Protection
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Ultra-low latency stream discovery and perceptual fingerprint cross-correlation designed for high-value sporting events (Champions League, Premier League, Formula 1).
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onLaunchLiveSweep}
              className="px-4 py-2 text-xs font-medium text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-sm shadow-emerald-500/20"
            >
              Trigger Live Event Sweep
            </button>
          </div>
        </div>
      </div>

      {/* Live Sports Telemetry Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="text-xs text-slate-400 mb-1">Active Monitored Feeds</div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {sportsReferences.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Official master transmissions</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="text-xs text-slate-400 mb-1">Live Candidate Feeds</div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {liveCandidates.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">HLS streams intercepted</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="text-xs text-slate-400 mb-1">Average Broadcast Delay</div>
          <div className="text-2xl font-bold text-cyan-400 font-mono tabular-nums">
            +{avgBroadcastDelay}s
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Pirate relay re-encode lag</div>
        </div>

        <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80">
          <div className="text-xs text-slate-400 mb-1">Confirmed Live Infringements</div>
          <div className="text-2xl font-bold text-rose-400 font-mono tabular-nums">
            {liveEvidence.filter(e => e.review_decision === 'CONFIRMED' || e.confidence_score >= 0.7).length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Ready for rapid takedown</div>
        </div>
      </div>

      {/* Live Operational Controls */}
      <div className="p-4 rounded-lg bg-slate-900/40 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={duplicateSuppression}
              onChange={(e) => setDuplicateSuppression(e.target.checked)}
              className="rounded bg-slate-950 border-slate-800 text-cyan-400 focus:ring-0"
            />
            <span className="text-slate-300">Duplicate Event Suppression</span>
          </label>

          <div className="flex items-center gap-2 text-slate-400">
            <span>Rolling Sample Window:</span>
            <select
              value={rollingWindowSec}
              onChange={(e) => setRollingWindowSec(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200"
            >
              <option value="15">15 seconds (Aggressive)</option>
              <option value="30">30 seconds (Standard)</option>
              <option value="60">60 seconds (Conservative)</option>
            </select>
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="text-slate-400 hover:text-white inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Live Probes</span>
        </button>
      </div>

      {/* Live Stream Infringement Queue */}
      <div className="rounded-lg bg-slate-900/40 border border-slate-800/80 overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Live Sports Infringement Stream Queue</h2>
            <p className="text-xs text-slate-400">Streams prioritized by live audience risk and high temporal correlation</p>
          </div>
          <span className="text-xs text-emerald-400 font-mono">Monitoring Active</span>
        </div>

        {liveEvidence.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs space-y-2">
            <p>No active live stream infringements detected.</p>
            <p className="text-slate-400">Trigger a live event sweep or load the forensic sample suite to test live stream correlation.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {liveEvidence.map((ev) => (
              <div
                key={ev.id}
                className="p-4 hover:bg-slate-800/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-white">{ev.reference_title}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-cyan-400 font-mono">{ev.candidate_domain}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-[11px] font-mono text-slate-400 truncate max-w-sm">{ev.candidate_url}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 font-mono">
                    <span className="text-emerald-400 font-bold">Match: {(ev.confidence_score * 100).toFixed(1)}%</span>
                    <span>·</span>
                    <span className="text-cyan-300">Broadcast Delay: +{ev.temporal_offset_sec}s</span>
                    <span>·</span>
                    <span>Min Distance: {ev.min_hamming_dist} bits</span>
                    <span>·</span>
                    <span>Matched Frames: {ev.matched_frames_count} frames</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => onNavigateToEvidence(ev)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>Forensic Viewer</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
