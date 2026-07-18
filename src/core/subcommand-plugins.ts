/**
 * Subcommand: plugins — plugins management subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'plugins',
  description: 'Manage plugins',
  options: [
    { flag: '--list', description: 'List installed plugins' },
  ],
  handler: async (args) => {
    console.log('Plugins:');
    console.log('  No plugins installed.');
    console.log('  Place plugin files in ~/.kairo/plugins/');
  },
});
