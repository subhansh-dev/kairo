/**
 * Subcommand: context — context inspection subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'context',
  description: 'Inspect context state',
  handler: async (args) => {
    console.log('Context inspection');
    console.log('Use /context in the TUI to see current context.');
    console.log('Use /stats to see token usage.');
    console.log('Use /compact to compress context.');
  },
});
