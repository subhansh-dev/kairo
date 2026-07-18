/**
 * Subcommand: search — search subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'search',
  description: 'Search sessions and files',
  handler: async (args) => {
    if (args.length === 0) {
      console.log('Usage: search <query>');
      return;
    }

    const query = args.join(' ');
    console.log(`Searching for: "${query}"`);
    console.log('Use /search in the TUI for interactive search.');
  },
});
