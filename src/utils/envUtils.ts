/**
 * Kairo — Environment Utilities (Stub)
 */

export function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function isEnvDefinedFalsy(value: string | undefined): boolean {
  if (value === undefined) return false
  return ['0', 'false', 'no', 'off', ''].includes(value.toLowerCase())
}

export function getEnvBool(name: string, defaultValue = false): boolean {
  const value = process.env[name]
  if (value === undefined) return defaultValue
  return isEnvTruthy(value)
}
