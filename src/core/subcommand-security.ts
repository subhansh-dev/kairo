/**
 * Subcommand: security — security subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { checkAdvisories, formatAdvisories } from './security-advisories.js';
import { getBuildInfo } from './build-info.js';

registerSubcommand({
  name: 'security',
  description: 'Security checks and advisories',
  handler: async (args) => {
    const info = getBuildInfo();
    const advisories = checkAdvisories(info.version);

    if (advisories.length === 0) {
      console.log('✅ No known security advisories for this version.');
    } else {
      console.log(formatAdvisories(advisories));
    }
  },
});
