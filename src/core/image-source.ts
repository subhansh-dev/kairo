/**
 * Image source — resolve image sources for vision tools.
 */

export interface ImageSource {
  type: 'url' | 'file' | 'base64';
  data: string;
  mimeType?: string;
}

/**
 * Resolve an image from various source types.
 */
export function resolveImageSource(source: string): ImageSource {
  // URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return { type: 'url', data: source };
  }

  // Data URL
  if (source.startsWith('data:')) {
    const match = source.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { type: 'base64', data: match[2], mimeType: match[1] };
    }
  }

  // Base64 string (heuristic: long string with base64 chars)
  if (source.length > 100 && /^[A-Za-z0-9+/=]+$/.test(source)) {
    return { type: 'base64', data: source };
  }

  // File path
  return { type: 'file', data: source };
}

/**
 * Get MIME type from file extension.
 */
export function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'ico': 'image/x-icon',
    'tiff': 'image/tiff',
    'pdf': 'application/pdf',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Check if a file is an image.
 */
export function isImageFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff'].includes(ext);
}

/**
 * Encode a file to base64 data URL.
 */
export function encodeAsDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
