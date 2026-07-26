/**
 * Kairo — Browser Utilities (Kairo-native rewrite)
 *
 * Open URLs in the default browser.
 */

import { execSync } from 'child_process'
import { platform } from 'os'

/**
 * Open a URL in the default browser
 */
export function openBrowser(url: string): boolean {
  try {
    const os = platform()
    switch (os) {
      case 'win32':
        execSync(`start "" "${url}"`, { stdio: 'ignore' })
        break
      case 'darwin':
        execSync(`open "${url}"`, { stdio: 'ignore' })
        break
      default:
        execSync(`xdg-open "${url}"`, { stdio: 'ignore' })
        break
    }
    return true
  } catch {
    return false
  }
}

/**
 * Check if a URL is reachable
 */
export async function isUrlReachable(url: string, timeout = 5000): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeout),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Fetch URL content as text
 */
export async function fetchUrl(url: string, timeout = 10000): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: {
        'User-Agent': 'Kairo/0.4.0',
      },
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}
