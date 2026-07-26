/**
 * Kairo — Notification Utilities (Kairo-native rewrite)
 *
 * Cross-platform desktop notifications.
 */

import { execSync } from 'child_process'
import { platform } from 'os'

/**
 * Send a desktop notification
 */
export function sendNotification(title: string, body: string, icon?: string): boolean {
  try {
    const os = platform()
    switch (os) {
      case 'win32':
        // PowerShell notification
        execSync(
          `powershell -command "Add-Type -AssemblyName System.Windows.Forms; $notify = New-Object System.Windows.Forms.NotifyIcon; $notify.Icon = [System.Drawing.SystemIcons]::Information; $notify.Visible = $true; $notify.ShowBalloonTip(5000, '${title}', '${body}', 'Info')"`,
          { stdio: 'ignore' }
        )
        break
      case 'darwin':
        execSync(
          `osascript -e 'display notification "${body}" with title "${title}"'`,
          { stdio: 'ignore' }
        )
        break
      default:
        // Linux: try notify-send
        execSync(
          `notify-send "${title}" "${body}"${icon ? ` -i ${icon}` : ''}`,
          { stdio: 'ignore' }
        )
        break
    }
    return true
  } catch {
    return false
  }
}

/**
 * Play a notification sound
 */
export function playNotificationSound(): boolean {
  try {
    const os = platform()
    switch (os) {
      case 'win32':
        execSync('powershell -command "[System.Media.SystemSounds]::Asterisk.Play()"', { stdio: 'ignore' })
        break
      case 'darwin':
        execSync('afplay /System/Library/Sounds/Glass.aiff', { stdio: 'ignore' })
        break
      default:
        // Linux: try paplay or aplay
        try {
          execSync('paplay /usr/share/sounds/freedesktop/stereo/complete.oga', { stdio: 'ignore' })
        } catch {
          execSync('aplay /usr/share/sounds/alsa/Front_Center.wav', { stdio: 'ignore' })
        }
        break
    }
    return true
  } catch {
    return false
  }
}
