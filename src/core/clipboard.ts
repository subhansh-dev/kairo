/**
 * Clipboard — clipboard integration utilities.
 */

/**
 * Copy text to clipboard.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Try platform-specific approaches
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      execSync('pbcopy', { input: text });
      return true;
    }
    if (process.platform === 'linux') {
      const { execSync } = require('child_process');
      try {
        execSync('xclip -selection clipboard', { input: text });
        return true;
      } catch {
        execSync('xsel --clipboard --input', { input: text });
        return true;
      }
    }
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      execSync('clip', { input: text });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Paste from clipboard.
 */
export async function pasteFromClipboard(): Promise<string | null> {
  try {
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      return execSync('pbpaste', { encoding: 'utf-8' });
    }
    if (process.platform === 'linux') {
      const { execSync } = require('child_process');
      try {
        return execSync('xclip -selection clipboard -o', { encoding: 'utf-8' });
      } catch {
        return execSync('xsel --clipboard --output', { encoding: 'utf-8' });
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if clipboard is available.
 */
export function isClipboardAvailable(): boolean {
  try {
    if (process.platform === 'darwin') return true;
    if (process.platform === 'linux') {
      const { execSync } = require('child_process');
      try {
        execSync('which xclip', { stdio: 'pipe' });
        return true;
      } catch {
        try {
          execSync('which xsel', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      }
    }
    if (process.platform === 'win32') return true;
    return false;
  } catch {
    return false;
  }
}
