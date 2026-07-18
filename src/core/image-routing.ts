/**
 * Kairo — Image Routing
 * Routing helpers for inbound user-attached images.
 * Ported from Hermes Agent's image_routing.py
 */

import { supportsVision } from './model-metadata.js';

// ─── Types ──────────────────────────────────────────────────────

export type ImageInputMode = 'native' | 'text' | 'auto';

export interface ImageAttachment {
  url?: string;
  base64?: string;
  mimeType: string;
  description?: string;
}

// ─── Routing ────────────────────────────────────────────────────

/**
 * Decide how to handle images for the current model.
 */
export function decideImageInputMode(
  modelId: string,
  configMode: ImageInputMode = 'auto',
): 'native' | 'text' {
  if (configMode === 'native') return 'native';
  if (configMode === 'text') return 'text';

  // Auto: use native if model supports vision
  if (supportsVision(modelId)) return 'native';
  return 'text';
}

/**
 * Convert an image attachment to a content block.
 */
export function imageToContentBlock(image: ImageAttachment): any {
  if (image.base64) {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
      },
    };
  }
  if (image.url) {
    return {
      type: 'image_url',
      image_url: { url: image.url },
    };
  }
  return { type: 'text', text: '[image: no data]' };
}

/**
 * Convert image to text description for non-vision models.
 */
export function imageToText(image: ImageAttachment): string {
  if (image.description) return `[Image: ${image.description}]`;
  return `[Image attached (${image.mimeType})]`;
}
