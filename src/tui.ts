/**
 * Kairo — TUI Entry Point
 * Re-exports from the modular tui/app.ts
 */

export { tui } from './tui/app.js';

// Run if this is the main module
import { tui } from './tui/app.js';
tui().catch(console.error);
