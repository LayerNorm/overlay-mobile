import { Platform } from 'react-native'

/**
 * Lightweight haptics helper. Uses expo-haptics on iOS (where it is a no-op
 * on Android/web via the platform check inside the module) and degrades
 * gracefully if the native module isn't available.
 *
 * Keep calls cheap — fire-and-forget on press/selection transitions only.
 */

type HapticImpact = 'light' | 'medium' | 'heavy'
type HapticNotification = 'success' | 'warning' | 'error'

type HapticsModule = typeof import('expo-haptics')

let expoHaptics: HapticsModule | null | undefined

async function loadHaptics(): Promise<HapticsModule | null> {
  if (expoHaptics !== undefined) return expoHaptics
  if (Platform.OS !== 'ios') {
    expoHaptics = null
    return null
  }
  try {
    expoHaptics = await import('expo-haptics')
    return expoHaptics
  } catch {
    expoHaptics = null
    return null
  }
}

function impactStyle(H: HapticsModule, kind: HapticImpact): import('expo-haptics').ImpactFeedbackStyle {
  if (kind === 'light') return H.ImpactFeedbackStyle.Light
  if (kind === 'heavy') return H.ImpactFeedbackStyle.Heavy
  return H.ImpactFeedbackStyle.Medium
}

function notificationType(H: HapticsModule, kind: HapticNotification): import('expo-haptics').NotificationFeedbackType {
  if (kind === 'success') return H.NotificationFeedbackType.Success
  if (kind === 'warning') return H.NotificationFeedbackType.Warning
  return H.NotificationFeedbackType.Error
}

/** Subtle tap — segmented controls, toggles, list row selection. */
export function hapticLight(): void {
  void loadHaptics().then((H) => {
    if (H) void H.impactAsync(impactStyle(H, 'light'))
  })
}

/** Medium tap — icon buttons, sheet open, nav transitions. */
export function hapticMedium(): void {
  void loadHaptics().then((H) => {
    if (H) void H.impactAsync(impactStyle(H, 'medium'))
  })
}

/** Confirmation — destructive confirm, success states. */
export function hapticSuccess(): void {
  void loadHaptics().then((H) => {
    if (H) void H.notificationAsync(notificationType(H, 'success'))
  })
}
