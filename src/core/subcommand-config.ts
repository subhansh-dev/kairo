/**
 * Subcommand: config — configuration management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { loadConfig, saveConfig, getConfigValue, setConfigValue, getConfigPath } from './config.js';

registerSubcommand({
  name: 'config',
  description: 'Manage configuration',
  options: [
    { flag: '--list', description: 'List all configuration' },
    { flag: '--get', description: 'Get a config value' },
    { flag: '--set', description: 'Set a config value' },
    { flag: '--path', description: 'Show config file path' },
  ],
  handler: async (args) => {
    if (args.includes('--path')) {
      console.log(getConfigPath());
      return;
    }

    if (args.includes('--list') || args.length === 0) {
      const config = loadConfig();
      if (Object.keys(config).length === 0) {
        console.log('No configuration set.');
      } else {
        console.log(JSON.stringify(config, null, 2));
      }
      return;
    }

    const getIdx = args.indexOf('--get');
    if (getIdx >= 0 && args[getIdx + 1]) {
      const value = getConfigValue(args[getIdx + 1]);
      console.log(value !== undefined ? JSON.stringify(value) : 'Not set');
      return;
    }

    const setIdx = args.indexOf('--set');
    if (setIdx >= 0 && args[setIdx + 1] && args[setIdx + 2]) {
      const key = args[setIdx + 1];
      let value: any = args[setIdx + 2];
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      setConfigValue(key, value);
      console.log(`✅ Set ${key} = ${JSON.stringify(value)}`);
      return;
    }

    console.log('Usage: config [--list] [--get <key>] [--set <key> <value>] [--path]');
  },
});
