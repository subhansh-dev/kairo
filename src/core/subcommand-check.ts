/**
 * Subcommand: check — check subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { runDoctorChecks, formatDoctorChecks } from './doctor.js';
import { checkAdvisories, formatAdvisories } from './security-advisories.js';

registerSubcommand({
  name: 'check',
  description: 'Run all checks (doctor + security)',
  handler: async (args) => {
    console.log('Running all checks...\n');

    // Doctor checks
    console.log('=== Health Checks ===');
    const checks = await runDoctorChecks();
    console.log(formatDoctorChecks(checks));

    // Security checks
    console.log('\n=== Security ===');
    const advisories = checkAdvisories('0.0.0');
    console.log(formatAdvisories(advisories));

    console.log('\n✅ All checks complete.');
  },
});
