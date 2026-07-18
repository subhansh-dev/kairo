/**
 * Subcommand: model — model management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { switchModel, getCurrentModel, getModelPresets } from './model-switch.js';
import { getModelCatalog, formatModelCatalog } from './model-catalog.js';

registerSubcommand({
  name: 'model',
  description: 'Switch or view the current model',
  options: [
    { flag: '--list', description: 'List available models' },
    { flag: '--presets', description: 'Show model presets' },
    { flag: '--current', description: 'Show current model' },
  ],
  handler: async (args) => {
    if (args.includes('--list')) {
      console.log(formatModelCatalog());
      return;
    }

    if (args.includes('--presets')) {
      const presets = getModelPresets();
      for (const preset of presets) {
        console.log(`  ${preset.name.padEnd(10)} ${preset.provider}/${preset.model} — ${preset.description}`);
      }
      return;
    }

    if (args.includes('--current') || args.length === 0) {
      const current = getCurrentModel();
      console.log(`Current model: ${current.provider}/${current.model}`);
      return;
    }

    const model = args[0];
    const result = switchModel(model);
    if (result.success) {
      console.log(`✅ ${result.message}`);
    } else {
      console.log(`❌ Failed to switch model`);
    }
  },
});
