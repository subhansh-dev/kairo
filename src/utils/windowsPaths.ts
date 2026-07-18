/**
 * Kairo — Windows Path Utilities (Stub)
 */

export function windowsPathToPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function containsVulnerableUncPath(path: string): boolean {
  return /^\\\\[^\\]/.test(path) || /^\/\/[^/]/.test(path)
}
