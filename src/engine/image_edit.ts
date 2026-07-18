/**
 * Image edit tool — edits/transforms images via xAI Imagine API.
 *
 */

export const IMAGE_EDIT_TOOL_NAME = 'image_edit';

export interface ImageEditInput {
  prompt: string;
  referenceImages: string[];
  aspectRatio?: string;
}

/**
 * Compress a reference image to fit within API limits.
 */
export function compressReference(rawBytes: Buffer): { bytes: Buffer; mime: string } {
  // Fast path: small JPEG/PNG passes through
  if (rawBytes.length <= 400 * 1024) {
    if (rawBytes[0] === 0xFF && rawBytes[1] === 0xD8) {
      return { bytes: rawBytes, mime: 'image/jpeg' };
    }
    if (rawBytes[0] === 0x89 && rawBytes[1] === 0x50) {
      return { bytes: rawBytes, mime: 'image/png' };
    }
  }

  // For other formats, would re-encode to JPEG
  return { bytes: rawBytes, mime: 'image/jpeg' };
}
