/**
 * Subcommand: login — login subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'login',
  description: 'Login to a provider',
  handler: async (args) => {
    console.log('Login to a provider:');
    console.log('  Set API keys in ~/.kairo/models.yml or environment variables:');
    console.log('    NVIDIA_API_KEY=...');
    console.log('    GROQ_API_KEY=...');
    console.log('    CEREBRAS_API_KEY=...');
    console.log('\nOr use: kairo config --set provider.nvidia.apiKey YOUR_KEY');
  },
});
