/**
 * Subcommand: hooks — hooks management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { loadHooks, formatHooks } from './hooks.js';

registerSubcommand({
  name: 'hooks',
  description: 'Manage hooks',
  handler: async (args) => {
    const hooks = loadHooks();
    if (hooks.length === 0) {
      console.log('No hooks configured.');
      console.log('Create hooks in ~/.kairo/hooks/');
      return;
    }
    console.log('Hooks:\n');
    console.log(formatHooks());
  },
});
