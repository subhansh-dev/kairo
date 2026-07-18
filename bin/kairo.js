#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const nodeVersion = parseInt(process.version.slice(1));
if (nodeVersion < 18) {
  console.error('\x1b[31mError: Kairo requires Node.js 18+\x1b[0m');
  console.error(`Current: ${process.version}`);
  process.exit(1);
}

const srcDir = path.join(__dirname, '..', 'src');
const distDir = path.join(__dirname, '..', 'dist');
const distEntry = path.join(distDir, 'tui.js');

// Auto-rebuild if source files are newer than dist
const needRebuild = (function() {
  if (!fs.existsSync(distEntry)) return true;
  const distTime = fs.statSync(distEntry).mtimeMs;
  function checkDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (checkDir(p)) return true; }
        else if (e.name.endsWith('.ts') && fs.statSync(p).mtimeMs > distTime) return true;
      }
    } catch {}
    return false;
  }
  return checkDir(srcDir);
})();

if (needRebuild) {
  try {
    execSync('npx tsc', { stdio: 'inherit', cwd: path.join(__dirname, '..'), timeout: 60000 });
  } catch {
    process.exit(1);
  }
}

const args = process.argv.slice(2).map(a => `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`).join(' ');

try {
  execSync(`node "${distEntry}" ${args}`, {
    stdio: 'inherit',
    // Preserve the user's working directory — do NOT set cwd to kairo's install dir
    env: process.env,
  });
} catch (e) {
  process.exit(e.status || 1);
}
