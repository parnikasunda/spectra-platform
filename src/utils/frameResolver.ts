/**
 * Argus Anti-Piracy Intelligence & Evidence Platform
 * Frame Image Resolution & Decoding Utilities
 *
 * Ensures storage paths, data URIs, web routes, and relative paths
 * resolve consistently across browser environments without silent fallback.
 */

export function resolveFrameImageUrl(source?: string | null): string | null {
  if (!source || typeof source !== 'string') return null;
  const trimmed = source.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  
  // Strictly filter out legacy synthetic SVGs, vector mockups, or placeholder strings
  if (lower.startsWith('data:image/svg') || lower.includes('<svg') || lower.endsWith('.svg')) {
    return null;
  }
  if (lower.includes('pitch cam') || lower.includes('center circle') || lower.includes('title card')) {
    return null;
  }

  // Authentic base64 JPEG/PNG/WebP data URIs
  if (
    lower.startsWith('data:image/jpeg') || 
    lower.startsWith('data:image/jpg') || 
    lower.startsWith('data:image/png') || 
    lower.startsWith('data:image/webp')
  ) {
    return trimmed;
  }

  // Full HTTP/HTTPS URLs
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return trimmed;
  }

  // Normalize absolute server disk paths to accessible web routes
  // e.g. /app/applet/data/thumbnails/thumb_123.jpg -> /thumbnails/thumb_123.jpg
  if (trimmed.includes('data/thumbnails/')) {
    const filename = trimmed.split('data/thumbnails/').pop() || '';
    return `/thumbnails/${filename.replace(/^\/+/, '')}`;
  }
  if (trimmed.includes('data/media/')) {
    const filename = trimmed.split('data/media/').pop() || '';
    return `/media/${filename.replace(/^\/+/, '')}`;
  }
  if (trimmed.includes('uploads/')) {
    const filename = trimmed.split('uploads/').pop() || '';
    return `/uploads/${filename.replace(/^\/+/, '')}`;
  }

  // Explicit web routes
  if (
    trimmed.startsWith('/thumbnails/') || 
    trimmed.startsWith('/media/') || 
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('/data/thumbnails/') ||
    trimmed.startsWith('/data/media/')
  ) {
    return trimmed;
  }

  // Raw thumbnail filename (e.g. thumb_179238...jpg)
  if (lower.startsWith('thumb_') && (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png'))) {
    return `/thumbnails/${trimmed}`;
  }

  // Root-relative path
  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return `/${trimmed}`;
}

export function isAuthenticDecodedFrame(thumb?: string | null): boolean {
  return resolveFrameImageUrl(thumb) !== null;
}
