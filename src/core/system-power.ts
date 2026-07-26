/**
 * Kairo — System Power
 * Detect system power state (battery, charging).
 */

import { execSync } from 'child_process';

// ─── Types ──────────────────────────────────────────────────────

export interface PowerInfo {
  isOnBattery: boolean;
  batteryPercent: number | null;
  isCharging: boolean | null;
  isBatteryLow: boolean;
}

// ─── Detection ──────────────────────────────────────────────────

export function getPowerInfo(): PowerInfo {
  const info: PowerInfo = {
    isOnBattery: false,
    batteryPercent: null,
    isCharging: null,
    isBatteryLow: false,
  };

  try {
    if (process.platform === 'linux') {
      // Check /sys/class/power_supply/
      const acOnline = readSysFile('/sys/class/power_supply/AC/online');
      const batCapacity = readSysFile('/sys/class/power_supply/BAT0/capacity');
      const batStatus = readSysFile('/sys/class/power_supply/BAT0/status');

      if (acOnline !== null) info.isOnBattery = acOnline === '0';
      if (batCapacity !== null) info.batteryPercent = parseInt(batCapacity);
      if (batStatus !== null) info.isCharging = batStatus === 'Charging';
    } else if (process.platform === 'darwin') {
      const output = execSync('pmset -g batt', { encoding: 'utf-8', stdio: 'pipe' });
      const match = output.match(/(\d+)%/);
      if (match) info.batteryPercent = parseInt(match[1]);
      info.isOnBattery = output.includes("'Battery Power'");
      info.isCharging = output.includes('charging');
    }
  } catch {}

  info.isBatteryLow = (info.batteryPercent !== null && info.batteryPercent < 20) || false;

  return info;
}

export function isOnBattery(): boolean {
  return getPowerInfo().isOnBattery;
}

export function isBatteryLow(): boolean {
  return getPowerInfo().isBatteryLow;
}

function readSysFile(path: string): string | null {
  try {
    return require('fs').readFileSync(path, 'utf-8').trim();
  } catch {
    return null;
  }
}
