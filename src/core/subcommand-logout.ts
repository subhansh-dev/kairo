/**
 * Subcommand: logout — logout subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'logout',
  description: 'Logout from a provider',
  handler: async (args) => {
    console.log('To logout, remove API keys from:');
    console.log('  ~/.kairo/models.yml');
    console.log('  Environment variables');
    console.log('\nOr use: kairo config --set provider.nvidia.apiKey ""');
  },
});
