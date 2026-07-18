/**
 * Subcommand: compact — compact context subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'compact',
  description: 'Compact conversation context',
  handler: async (args) => {
    console.log('Compact conversation context');
    console.log('Use /compact in the TUI to compress context.');
  },
});
