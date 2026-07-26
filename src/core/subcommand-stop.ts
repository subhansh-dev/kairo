/**
 * Subcommand: stop — stop subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'stop',
  description: 'Stop running processes',
  handler: async (args) => {
    console.log('Stopping Kairo processes...');
    console.log('Use Ctrl+C to interrupt the current operation.');
    console.log('Use the gateway stop command for the messaging gateway.');
  },
});
