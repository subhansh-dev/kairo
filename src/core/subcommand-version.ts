/**
 * Subcommand: version — version display subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getBuildInfo, formatBuildInfo } from './build-info.js';

registerSubcommand({
  name: 'version',
  description: 'Show version information',
  handler: async (args) => {
    const info = getBuildInfo();
    console.log(formatBuildInfo(info));
  },
});
