/**
 * Subcommand: diagnose — diagnostics subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { collectDiagnostics, formatDiagnostics } from './diagnostics-upload.js';
import { getDebugInfo } from './debug.js';

registerSubcommand({
  name: 'diagnose',
  description: 'Collect and display diagnostics',
  handler: async (args) => {
    const diagnostics = collectDiagnostics();
    console.log(formatDiagnostics(diagnostics));
    console.log('\nDebug Info:');
    console.log(JSON.stringify(getDebugInfo(), null, 2));
  },
});
