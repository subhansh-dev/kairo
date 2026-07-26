/**
 * Kairo — TUI Entry Point
 * Re-exports from the modular tui/app.ts
 */

export { tui } from './tui/app.js';

// Run if this is the main module (not when imported)
if (process.argv[1]?.endsWith('tui.js') || process.argv[1]?.endsWith('tui.ts')) {
  import('./tui/app.js').then(({ tui }) => tui()).catch(console.error);
}
