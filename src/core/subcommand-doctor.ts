/**
 * Subcommand: doctor — diagnostics subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { runDoctorChecks, formatDoctorChecks } from './doctor.js';

registerSubcommand({
  name: 'doctor',
  description: 'Run diagnostic checks',
  handler: async (args) => {
    console.log('Running diagnostics...\n');
    const checks = await runDoctorChecks();
    console.log(formatDoctorChecks(checks));
  },
});
