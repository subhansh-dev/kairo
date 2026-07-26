/**
 * Subcommand: dashboard — dashboard subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getDashboardEndpoints, formatDashboardEndpoints } from './dashboard-register.js';

registerSubcommand({
  name: 'dashboard',
  description: 'Manage the web dashboard',
  options: [
    { flag: '--start', description: 'Start the dashboard' },
    { flag: '--endpoints', description: 'List dashboard endpoints' },
  ],
  handler: async (args) => {
    if (args.includes('--endpoints')) {
      console.log(formatDashboardEndpoints());
      return;
    }

    if (args.includes('--start')) {
      console.log('Starting dashboard...');
      console.log('⚠️  Dashboard not yet implemented in Kairo');
      return;
    }

    console.log('Usage: dashboard [--start] [--endpoints]');
  },
});
