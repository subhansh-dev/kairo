/**
 * Kairo — Platform Utilities (Stub)
 */

export function getPlatform(): 'windows' | 'macos' | 'linux' {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

export function isWindows(): boolean {
  return process.platform === 'win32'
}

export function isMacOS(): boolean {
  return process.platform === 'darwin'
}
