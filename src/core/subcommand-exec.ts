/**
 * Subcommand: exec — exec subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'exec',
  description: 'Execute a one-shot command',
  handler: async (args) => {
    if (args.length === 0) {
      console.log('Usage: exec <prompt>');
      console.log('  exec "list all TypeScript files"');
      return;
    }

    console.log(`Executing: ${args.join(' ')}`);
    console.log('Use `kairo -e "prompt"` for one-shot execution.');
  },
});
