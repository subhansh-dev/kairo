/**
 * Subcommand: restart — restart subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getRestartCommand } from './relaunch.js';

registerSubcommand({
  name: 'restart',
  description: 'Restart Kairo',
  handler: async (args) => {
    console.log('Restarting Kairo...');
    console.log(`Command: ${getRestartCommand()}`);
    console.log('Use the gateway restart command for the messaging gateway.');
  },
});
