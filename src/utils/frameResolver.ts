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

export function resolveReferenceFrameImageWithFallback(
  fp: {
    thumbnail_url?: string | null;
    thumbnail_path?: string | null;
    thumbnail_data?: string | null;
    frame_index?: number;
    image_available?: boolean;
  },
  referenceId?: string
): string | null {
  if (!fp) return null;
  // When the backend has verified that neither the disk JPEG nor base64 thumbnail_data is present,
  // do not return a dead URL.
  if (fp.image_available === false) {
    return null;
  }
  const direct = resolveFrameImageUrl(fp.thumbnail_url || fp.thumbnail_path || fp.thumbnail_data);
  if (direct) return direct;
  if (referenceId && fp.frame_index !== undefined && fp.frame_index >= 0 && fp.image_available === true) {
    return `/api/references/${encodeURIComponent(referenceId)}/frames/${fp.frame_index}/image`;
  }
  return null;
}

