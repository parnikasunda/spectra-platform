/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Navigation Bar Component
 * Adheres strictly to the 3-Zone Top Bar Contract
 */

import React from 'react';
import { ShieldCheck, Plus, Sparkles, Trash2 } from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenRegisterModal: () => void;
  onLoadSampleSuite: () => void;
  onResetDb: () => void;
  isLoadingSample: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  onOpenRegisterModal,
  onLoadSampleSuite,
  onResetDb,
  isLoadingSample
}) => {
  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark (Single text element) */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-sm shadow-cyan-500/20">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <button 
            onClick={() => onSelectTab('overview')}
            className="text-left group cursor-pointer"
          >
            <span className="text-base font-bold tracking-tight text-white whitespace-nowrap block">
              Argus Forensics
            </span>
            <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase block">
              Anti-Piracy Intelligence
            </span>
          </button>
        </div>

        {/* Zone 2: Single-line Text Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
          <button
            onClick={() => onSelectTab('overview')}
            className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
              currentTab === 'overview'
                ? 'text-cyan-400 font-semibold border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => onSelectTab('references')}
            className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
              currentTab === 'references'
                ? 'text-cyan-400 font-semibold border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Reference Library
          </button>
          <button
            onClick={() => onSelectTab('discovery')}
            className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
              currentTab === 'discovery'
                ? 'text-cyan-400 font-semibold border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Discovery Sweeps
          </button>
          <button
            onClick={() => onSelectTab('candidates')}
            className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
              currentTab === 'candidates'
                ? 'text-cyan-400 font-semibold border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Candidate Matrix
          </button>
          <button
            onClick={() => onSelectTab('evidence')}
            className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
              currentTab === 'evidence'
                ? 'text-cyan-400 font-semibold border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Evidence Vault
          </button>
          <button
            onClick={() => onSelectTab('livesports')}
            className={`whitespace-nowrap shrink-0 transition-colors py-1 ${
              currentTab === 'livesports'
                ? 'text-cyan-400 font-semibold border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Live Sports
          </button>
        </nav>

        {/* Zone 3: Primary Action & Quick Tools */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Optional Sample Data action clearly labeled as sample fixtures */}
          <button
            onClick={onLoadSampleSuite}
            disabled={isLoadingSample}
            title="Load optional sample forensic data fixtures for evaluation"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Forensic Test Suite</span>
          </button>

          <button
            onClick={onResetDb}
            title="Reset database to clean empty state"
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded border border-transparent hover:border-rose-900/40 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onOpenRegisterModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded font-sans transition-colors shadow-sm shadow-cyan-500/20 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Register Reference</span>
          </button>
        </div>
      </div>
    </header>
  );
};
