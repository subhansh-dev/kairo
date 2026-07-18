/**
 * Subcommand: swap — model swap subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { switchModel, getCurrentModel, getModelPresets } from './model-switch.js';

registerSubcommand({
  name: 'swap',
  description: 'Quick model swap',
  handler: async (args) => {
    if (args.length === 0) {
      const current = getCurrentModel();
      const presets = getModelPresets();
      console.log(`Current: ${current.provider}/${current.model}\n`);
      console.log('Available presets:');
      for (const preset of presets) {
        console.log(`  ${preset.name.padEnd(10)} ${preset.provider}/${preset.model}`);
      }
      console.log('\nUsage: swap <model-or-preset>');
      return;
    }

    const input = args[0];
    const presets = getModelPresets();
    const preset = presets.find(p => p.name === input);

    if (preset) {
      const result = switchModel(`${preset.provider}/${preset.model}`);
      console.log(`✅ ${result.message}`);
    } else {
      const result = switchModel(input);
      console.log(`✅ ${result.message}`);
    }
  },
});
