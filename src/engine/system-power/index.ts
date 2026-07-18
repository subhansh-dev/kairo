/**
 * System power — battery and power management awareness.
 */

export interface PowerInfo {
  batteryLevel?: number;
  isCharging?: boolean;
  timeToEmpty?: number;
  timeToFull?: number;
  powerSource?: 'ac' | 'battery' | 'unknown';
}

/**
 * Get current power info (best-effort, platform-dependent).
 */
export async function getPowerInfo(): Promise<PowerInfo> {
  // Node.js doesn't have native battery API
  // This is a stub that can be extended with platform-specific implementations
  return {
    powerSource: 'unknown',
  };
}

/**
 * Check if the system is on battery power.
 */
export async function isOnBattery(): Promise<boolean> {
  const info = await getPowerInfo();
  return info.powerSource === 'battery';
}

/**
 * Check if battery is low (below threshold).
 */
export async function isBatteryLow(threshold: number = 0.2): Promise<boolean> {
  const info = await getPowerInfo();
  if (info.batteryLevel === undefined) return false;
  return info.batteryLevel < threshold && info.powerSource === 'battery';
}
