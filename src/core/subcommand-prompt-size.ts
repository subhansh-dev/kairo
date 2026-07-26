/**
 * Subcommand: prompt_size — prompt size analysis subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'prompt-size',
  description: 'Analyze prompt size',
  handler: async (args) => {
    console.log('Prompt size analysis');
    console.log('Use /stats in the TUI to see current prompt size.');
    console.log('Use /context to see context breakdown.');
  },
});
