/**
 * Banner — startup banner display.
 */

const BANNER_ART = `
 ██╗  ██╗ █████╗ ██╗██████╗  ██████╗
 ██║ ██╔╝██╔══██╗██║██╔══██╗██╔═══██╗
 █████╔╝ ███████║██║██████╔╝██║   ██║
 ██╔═██╗ ██╔══██║██║██╔══██╗██║   ██║
 ██║  ██╗██║  ██║██║██║  ██║╚██████╔╝
 ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝
`;

/**
 * Get the startup banner.
 */
export function getBanner(version: string): string {
  return `\x1b[38;2;0;204;204m${BANNER_ART}\x1b[0m\n  \x1b[2mv${version}\x1b[0m · Free MoE Coding Agent\n`;
}

/**
 * Get a compact one-line banner.
 */
export function getCompactBanner(version: string): string {
  return `\x1b[38;2;0;204;204m✦ Kairo\x1b[0m v${version}`;
}

/**
 * Get the version string from package.json.
 */
export function getVersion(): string {
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
