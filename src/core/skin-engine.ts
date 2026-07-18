/**
 * Skin engine — UI theming and customization.
 */

export interface SkinConfig {
  name: string;
  colors: Record<string, string>;
  spinner: string[];
  prompt: string;
}

// Default skin
const DEFAULT_SKIN: SkinConfig = {
  name: 'default',
  colors: {
    primary: '\x1b[38;2;0;204;204m',
    accent: '\x1b[38;2;215;119;87m',
    success: '\x1b[38;2;78;186;101m',
    warning: '\x1b[38;2;255;193;7m',
    error: '\x1b[38;2;255;107;128m',
    muted: '\x1b[38;2;153;153;153m',
    text: '\x1b[38;2;230;230;230m',
  },
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  prompt: '❯',
};

let currentSkin = DEFAULT_SKIN;

/**
 * Get the current skin.
 */
export function getCurrentSkin(): SkinConfig {
  return currentSkin;
}

/**
 * Set the current skin.
 */
export function setSkin(skin: Partial<SkinConfig>): void {
  currentSkin = { ...DEFAULT_SKIN, ...skin };
}

/**
 * Reset to default skin.
 */
export function resetSkin(): void {
  currentSkin = DEFAULT_SKIN;
}

/**
 * Get a color from the current skin.
 */
export function getColor(name: string): string {
  return currentSkin.colors[name] || '';
}

/**
 * Get spinner frame.
 */
export function getSpinnerFrame(frame: number): string {
  return currentSkin.spinner[frame % currentSkin.spinner.length];
}

/**
 * Get the prompt character.
 */
export function getPrompt(): string {
  return currentSkin.prompt;
}
