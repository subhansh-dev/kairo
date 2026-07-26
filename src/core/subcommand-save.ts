/**
 * Subcommand: save — save session subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'save',
  description: 'Save current session',
  handler: async (args) => {
    console.log('Save current session');
    console.log('Use /save in the TUI to save the current session.');
  },
});
