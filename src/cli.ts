#!/usr/bin/env node
/**
 * Kairo — CLI Entry Point
 * Free MoE coding agent with NVIDIA NIM, Groq, and Cerebras
 */

import { tui } from './tui/app.js';

tui().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
