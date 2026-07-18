/**
 * Subcommand: gateway — gateway management subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'gateway',
  description: 'Manage the messaging gateway',
  options: [
    { flag: '--start', description: 'Start the gateway' },
    { flag: '--stop', description: 'Stop the gateway' },
    { flag: '--status', description: 'Show gateway status' },
  ],
  handler: async (args) => {
    if (args.includes('--status') || args.length === 0) {
      console.log('Gateway status: Not running');
      console.log('Use --start to start the gateway');
      return;
    }

    if (args.includes('--start')) {
      console.log('Starting gateway...');
      console.log('⚠️  Gateway not yet implemented in Kairo');
      return;
    }

    if (args.includes('--stop')) {
      console.log('Stopping gateway...');
      return;
    }

    console.log('Usage: gateway [--start] [--stop] [--status]');
  },
});
