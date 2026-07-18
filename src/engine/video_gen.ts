/**
 * Video generation tool — generates videos via xAI Video API.
 *
 */

import { SessionFileWriter } from './storage';

export const IMAGE_TO_VIDEO_TOOL_NAME = 'image_to_video';
export const REFERENCE_TO_VIDEO_TOOL_NAME = 'reference_to_video';
export const IMAGINE_VIDEO_COMMAND_NAME = 'imagine_video';
const XAI_VIDEO_BASE_MODEL = 'grok-imagine-video';
const VIDEO_GEN_TIMEOUT_SECS = 300;
const VIDEO_POLL_INTERVAL_SECS = 5;

export interface VideoGenConfig {
  type: 'enabled' | 'disabled';
  apiKey?: string;
  baseUrl?: string;
  modelOverride?: string;
  s3Credentials?: S3AccessCredentials;
}

export interface S3AccessCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface VideoGenClient {
  generateFromImage(prompt: string, imagePath: string, options?: VideoGenOptions): Promise<VideoGenOutput>;
  generateFromReference(prompt: string, referenceImages: string[], options?: VideoGenOptions): Promise<VideoGenOutput>;
}

export interface VideoGenOptions {
  model?: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
}

export interface VideoGenOutput {
  path: string;
  duration?: number;
  format?: string;
}

/**
 * Create a VideoGenClient from configuration.
 */
export function createVideoGenClient(config: VideoGenConfig): VideoGenClient | null {
  if (config.type === 'disabled') return null;

  const writer = new SessionFileWriter('videos', 'mp4');

  return {
    async generateFromImage(prompt, imagePath, options) {
      throw new Error('VideoGenClient: not implemented (requires xAI API key)');
    },

    async generateFromReference(prompt, referenceImages, options) {
      throw new Error('VideoGenClient: not implemented (requires xAI API key)');
    },
  };
}

export const IMAGINE_VIDEO_INSTRUCTION = `
Generate a video from a text prompt and optional reference images.
Videos are saved to the session folder and the path is returned.
`;
