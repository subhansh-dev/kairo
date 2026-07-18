/**
 * Subcommand: build — build subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'build',
  description: 'Build the project',
  handler: async (args) => {
    const { execSync } = require('child_process');
    console.log('Building Kairo...');
    try {
      execSync('npm run build', { stdio: 'inherit' });
      console.log('✅ Build complete.');
    } catch (err: any) {
      console.log(`❌ Build failed: ${err.message}`);
    }
  },
});
