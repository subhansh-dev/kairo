/**
 * Kairo — Clipboard Utilities (Kairo-native rewrite)
 *
 * Cross-platform clipboard operations.
 */

import { execSync } from 'child_process'
import { platform } from 'os'

/**
 * Copy text to clipboard
 */
export function copyToClipboard(text: string): boolean {
  try {
    const os = platform()
    switch (os) {
      case 'win32':
        execSync('clip', { input: text, stdio: ['pipe', 'ignore', 'ignore'] })
        break
      case 'darwin':
        execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] })
        break
      default:
        // Try xclip, then xsel
        try {
          execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] })
        } catch {
          execSync('xsel --clipboard --input', { input: text, stdio: ['pipe', 'ignore', 'ignore'] })
        }
        break
    }
    return true
  } catch {
    return false
  }
}

/**
 * Paste text from clipboard
 */
export function pasteFromClipboard(): string | null {
  try {
    const os = platform()
    switch (os) {
      case 'win32':
        return execSync('powershell -command "Get-Clipboard"', { encoding: 'utf-8' }).trim()
      case 'darwin':
        return execSync('pbpaste', { encoding: 'utf-8' }).trim()
      default:
        try {
          return execSync('xclip -selection clipboard -o', { encoding: 'utf-8' }).trim()
        } catch {
          return execSync('xsel --clipboard --output', { encoding: 'utf-8' }).trim()
        }
    }
  } catch {
    return null
  }
}
