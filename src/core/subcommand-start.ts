/**
 * Subcommand: start — start subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'start',
  description: 'Start Kairo services',
  handler: async (args) => {
    console.log('Starting Kairo...');
    console.log('Run `kairo` to start the interactive TUI.');
    console.log('Run `kairo "prompt"` for one-shot execution.');
    console.log('Run `kairo gateway --start` for the messaging gateway.');
  },
});
