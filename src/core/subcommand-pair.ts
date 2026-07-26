/**
 * Subcommand: pair — device pairing subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { generatePairingCode, validatePairingCode, cleanupPairingCodes } from './pairing.js';

registerSubcommand({
  name: 'pair',
  description: 'Device pairing',
  options: [
    { flag: '--generate', description: 'Generate a pairing code' },
    { flag: '--validate', description: 'Validate a pairing code' },
    { flag: '--cleanup', description: 'Clean up expired codes' },
  ],
  handler: async (args) => {
    if (args.includes('--generate')) {
      const pairing = generatePairingCode();
      console.log(`Pairing code: ${pairing.code}`);
      console.log(`Expires: ${new Date(pairing.expiresAt).toLocaleString()}`);
      return;
    }

    const validateIdx = args.indexOf('--validate');
    if (validateIdx >= 0 && args[validateIdx + 1]) {
      const result = validatePairingCode(args[validateIdx + 1]);
      if (result.valid) {
        console.log(`✅ Code validated successfully`);
      } else {
        console.log(`❌ ${result.error}`);
      }
      return;
    }

    if (args.includes('--cleanup')) {
      const cleaned = cleanupPairingCodes();
      console.log(`Cleaned up ${cleaned} expired codes`);
      return;
    }

    console.log('Usage: pair [--generate] [--validate <code>] [--cleanup]');
  },
});
