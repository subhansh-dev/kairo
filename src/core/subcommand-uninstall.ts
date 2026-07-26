/**
 * Subcommand: uninstall — uninstall subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { uninstallKairo, formatUninstallResult } from './uninstall.js';

registerSubcommand({
  name: 'uninstall',
  description: 'Uninstall Kairo (remove config and data)',
  options: [
    { flag: '--keep-config', description: 'Keep configuration files' },
    { flag: '--keep-data', description: 'Keep data files' },
  ],
  handler: async (args) => {
    const keepConfig = args.includes('--keep-config');
    const keepData = args.includes('--keep-data');

    console.log('⚠️  This will remove Kairo configuration and data files.');
    console.log(`   Keep config: ${keepConfig ? 'yes' : 'no'}`);
    console.log(`   Keep data: ${keepData ? 'yes' : 'no'}`);
    console.log('');

    const result = uninstallKairo({ keepConfig, keepData });
    console.log(formatUninstallResult(result));
  },
});
