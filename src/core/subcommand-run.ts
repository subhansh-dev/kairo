/**
 * Subcommand: run — run subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'run',
  description: 'Run a command or workflow',
  handler: async (args) => {
    if (args.length === 0) {
      console.log('Usage: run <command-or-prompt>');
      console.log('  run "fix the bug in auth.ts"');
      console.log('  run --workflow feature "add user settings"');
      return;
    }

    console.log(`Running: ${args.join(' ')}`);
    console.log('Use `kairo "prompt"` for direct execution.');
  },
});
