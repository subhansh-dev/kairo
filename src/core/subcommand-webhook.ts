/**
 * Subcommand: webhook — webhook management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getWebhooks, removeWebhook, toggleWebhook, formatWebhooks } from './webhook.js';

registerSubcommand({
  name: 'webhook',
  description: 'Manage webhooks',
  options: [
    { flag: '--list', description: 'List webhooks' },
    { flag: '--remove', description: 'Remove a webhook' },
  ],
  handler: async (args) => {
    if (args.includes('--list') || args.length === 0) {
      console.log(formatWebhooks());
      return;
    }

    const removeIdx = args.indexOf('--remove');
    if (removeIdx >= 0 && args[removeIdx + 1]) {
      const id = args[removeIdx + 1];
      if (removeWebhook(id)) {
        console.log(`✅ Removed webhook: ${id}`);
      } else {
        console.log(`❌ Webhook not found: ${id}`);
      }
      return;
    }

    console.log('Usage: webhook [--list] [--remove <id>]');
  },
});
