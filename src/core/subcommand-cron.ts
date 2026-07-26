/**
 * Subcommand: cron — cron job management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getCronJobs, formatCronJob } from './cron-tools.js';

registerSubcommand({
  name: 'cron',
  description: 'Manage cron jobs',
  handler: async (args) => {
    const jobs = getCronJobs();
    if (jobs.length === 0) {
      console.log('No cron jobs configured.');
      console.log('Use the cron tool to create scheduled tasks.');
      return;
    }
    console.log('Cron jobs:\n');
    for (const job of jobs) {
      console.log(formatCronJob(job));
    }
  },
});
