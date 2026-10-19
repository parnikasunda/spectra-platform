import React, { useState } from 'react';
import { ExternalLink, Copy, Check, AlertCircle, Video, Globe } from 'lucide-react';

interface CandidateSourceLinkProps {
  url?: string;
  mediaUrl?: string;
  canonicalUrl?: string;
  title?: string;
  domain?: string;
  candidateId?: string;
  showCopy?: boolean;
  showOpenButton?: boolean;
  truncateLength?: number;
  compact?: boolean;
  className?: string;
}

/**
 * Validates that a string is a strictly valid HTTP or HTTPS URL
 * to avoid script execution, javascript: schemes, or unsafe protocol injections.
 */
export function isValidHttpUrl(stringUrl?: string | null): boolean {
  if (!stringUrl || typeof stringUrl !== 'string') return false;
  const trimmed = stringUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Formats a long URL into a human-readable truncated string preserving domain and path context.
 */
export function formatTruncatedUrl(url: string, maxLength: number = 42): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const pathAndQuery = parsed.pathname + parsed.search;
    if ((host + pathAndQuery).length <= maxLength) {
      return host + pathAndQuery;
    }
    const availPath = maxLength - host.length - 3;
    if (availPath > 6) {
      return `${host}${pathAndQuery.slice(0, availPath)}…`;
    }
    return `${host.slice(0, maxLength - 3)}…`;
  } catch {
    return url.length > maxLength ? `${url.slice(0, maxLength)}…` : url;
  }
}

export const CandidateSourceLink: React.FC<CandidateSourceLinkProps> = ({
  url,
  mediaUrl,
  canonicalUrl,
  title,
  domain,
  candidateId,
  showCopy = true,
  showOpenButton = true,
  truncateLength = 40,
  compact = false,
  className = ''
}) => {
  const [copiedType, setCopiedType] = useState<'source' | 'media' | null>(null);

  const effectiveWebUrl = canonicalUrl && isValidHttpUrl(canonicalUrl) 
    ? canonicalUrl 
    : (isValidHttpUrl(url) ? url : undefined);

  const isWebUrlValid = Boolean(effectiveWebUrl);
  const isMediaUrlValid = isValidHttpUrl(mediaUrl);

  const copyToClipboard = async (text: string, type: 'source' | 'media', e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // Fallback
    }
  };

  if (compact) {
    if (!isWebUrlValid) {
      return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 bg-slate-900/60 px-2 py-0.5 rounded border border-slate-800 ${className}`}>
          <AlertCircle className="w-3 h-3 text-amber-500/70 shrink-0" />
          <span>Source URL unavailable</span>
        </span>
      );
    }

    return (
      <div className={`inline-flex items-center gap-1.5 text-xs font-mono ${className}`}>
        <a
          href={effectiveWebUrl!}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1 truncate max-w-[200px]"
          title={effectiveWebUrl!}
        >
          <span className="truncate">{formatTruncatedUrl(effectiveWebUrl!, truncateLength)}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>

        {showCopy && (
          <button
            onClick={(e) => copyToClipboard(effectiveWebUrl!, 'source', e)}
            className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-800 transition-colors"
            title="Copy discovered source URL"
          >
            {copiedType === 'source' ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* Primary Discovered Source Webpage */}
      <div className="flex items-center justify-between gap-2 bg-slate-950/80 px-2.5 py-1.5 rounded border border-slate-800">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
              <span>DISCOVERED WEBPAGE</span>
              {domain && <span className="text-slate-500">({domain})</span>}
            </div>

            {isWebUrlValid ? (
              <div className="truncate font-mono text-xs text-slate-200" title={effectiveWebUrl!}>
                {effectiveWebUrl}
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[11px] font-mono text-amber-400/90 mt-0.5">
                <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                <span>Source URL unavailable</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isWebUrlValid && showOpenButton && (
            <a
              href={effectiveWebUrl!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2 py-1 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-800/60 text-cyan-300 text-[11px] font-mono rounded transition-colors"
              title="Open external source webpage in new tab"
            >
              <span>Open Source</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {isWebUrlValid && showCopy && (
            <button
              onClick={(e) => copyToClipboard(effectiveWebUrl!, 'source', e)}
              className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title="Copy source URL to clipboard"
            >
              {copiedType === 'source' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Direct Media / Stream URL if separately available */}
      {mediaUrl && (
        <div className="flex items-center justify-between gap-2 bg-slate-950/50 px-2.5 py-1 rounded border border-slate-800/70 text-[11px] font-mono">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Video className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] text-slate-500 uppercase block">DIRECT MEDIA RESOURCE (STREAM / CONTAINER)</span>
              {isMediaUrlValid ? (
                <span className="truncate block text-slate-300" title={mediaUrl}>
                  {mediaUrl}
                </span>
              ) : (
                <span className="text-slate-500 italic">Direct media stream path invalid</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isMediaUrlValid && (
              <a
                href={mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-amber-400 hover:text-amber-300 p-1"
                title="Open direct media file / stream manifest"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {isMediaUrlValid && (
              <button
                onClick={(e) => copyToClipboard(mediaUrl, 'media', e)}
                className="p-1 text-slate-400 hover:text-white"
                title="Copy direct media URL"
              >
                {copiedType === 'media' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
