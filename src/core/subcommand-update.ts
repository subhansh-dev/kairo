/**
 * Subcommand: update — update subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { checkForUpdates, formatUpdateInfo } from './auto-update.js';
import { getBuildInfo, formatBuildInfo } from './build-info.js';

registerSubcommand({
  name: 'update',
  description: 'Check for and apply updates',
  handler: async (args) => {
    console.log('Checking for updates...\n');

    const buildInfo = getBuildInfo();
    console.log(formatBuildInfo(buildInfo));
    console.log('');

    const updateInfo = await checkForUpdates();
    console.log(formatUpdateInfo(updateInfo));
  },
});
