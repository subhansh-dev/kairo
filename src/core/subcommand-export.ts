/**
 * Subcommand: export — export subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { exportToMarkdown, exportToJson, exportToText, getExportFilename } from './session-export.js';

registerSubcommand({
  name: 'export',
  description: 'Export session data',
  options: [
    { flag: '--format', description: 'Export format (markdown, json, text)' },
  ],
  handler: async (args) => {
    const formatIdx = args.indexOf('--format');
    const format = formatIdx >= 0 ? args[formatIdx + 1] : 'markdown';

    console.log(`Export format: ${format}`);
    console.log('Usage: export --format [markdown|json|text]');
    console.log('Export is available through the /export command in the TUI.');
  },
});
