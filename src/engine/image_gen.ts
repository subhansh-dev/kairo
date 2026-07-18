/**
 * Image generation tool — generates images via xAI Imagine API.
 *
 */

import * as path from 'path';
import { SessionFileWriter } from './storage';

export const IMAGE_GEN_TOOL_NAME = 'image_gen';
export const IMAGINE_COMMAND_NAME = 'imagine';
const XAI_IMAGINE_MODEL = 'grok-imagine-image-quality';
const IMAGE_GEN_TIMEOUT_SECS = 300;

export interface ImageGenConfig {
  type: 'enabled' | 'disabled';
  apiKey?: string;
  baseUrl?: string;
  modelOverride?: string;
  tierRestricted?: boolean;
}

export interface ImageGenClient {
  generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenOutput>;
}

export interface ImageGenOptions {
  model?: string;
  aspectRatio?: string;
  seed?: number;
}

export interface ImageGenOutput {
  path: string;
  width?: number;
  height?: number;
  format?: string;
}

/**
 * TIER_RESTRICTED_UPSELL message for free/Basic users.
 */
export const TIER_RESTRICTED_UPSELL =
  'Image generation is not available on the current plan. Advise the user to upgrade for image generation capabilities. Do not retry this tool.';

/**
 * Create an ImageGenClient from configuration.
 */
export function createImageGenClient(config: ImageGenConfig): ImageGenClient | null {
  if (config.type === 'disabled' || config.tierRestricted) return null;

  const writer = new SessionFileWriter('images', 'jpg');

  return {
    async generate(prompt, options) {
      // Simplified — in production this would call the xAI Imagine API
      throw new Error('ImageGenClient: not implemented (requires xAI API key)');
    },
  };
}

export const IMAGE_GEN_INSTRUCTION = `
Generate an image from a text prompt using the xAI Imagine API.
The image is saved to the session folder and the path is returned.
`;
