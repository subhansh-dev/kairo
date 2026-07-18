/**
 * Subcommand: status — status display subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getSystemStatus, formatSystemStatus } from './status.js';
import { getConfiguredProviders } from './providers.js';

registerSubcommand({
  name: 'status',
  description: 'Show system status',
  handler: async (args) => {
    const status = getSystemStatus();
    console.log(formatSystemStatus(status));

    const providers = getConfiguredProviders();
    if (providers.length > 0) {
      console.log(`\nConfigured providers: ${providers.join(', ')}`);
    } else {
      console.log('\nNo providers configured. Set API keys in environment.');
    }
  },
});
