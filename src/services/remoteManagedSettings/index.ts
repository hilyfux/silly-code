/**
 * Remote Managed Settings Service — telemetry/remote config removed in silly-code.
 * All outbound fetches are stubbed. Exports preserved for import compatibility.
 */

import type { SettingsJson } from '../../utils/settings/types.js'

export function computeChecksumFromSettings(_settings: SettingsJson): string {
  return ''
}

export function isEligibleForRemoteManagedSettings(): boolean {
  return false
}

export function initializeRemoteManagedSettingsLoadingPromise(): void {}

export async function waitForRemoteManagedSettingsToLoad(): Promise<void> {}

export async function loadRemoteManagedSettings(): Promise<void> {}

export async function refreshRemoteManagedSettings(): Promise<void> {}

export async function clearRemoteManagedSettingsCache(): Promise<void> {}

export function startBackgroundPolling(): void {}

export function stopBackgroundPolling(): void {}
