import React from 'react'
import { Platform, View, type StyleProp, type ViewStyle, type ViewProps } from 'react-native'
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect'
import { BlurView } from 'expo-blur'
import { useTheme } from '../../hooks/useTheme'

/**
 * Liquid-glass surface. On iOS 26+ this renders a real `GlassView` (the
 * "liquid glass" backdrop). On older iOS / Android it falls back to a
 * `BlurView` (systemMaterial) so the chrome still feels translucent instead
 * of flat — and on web it degrades to a plain `View`.
 *
 * Variants (map to the three valid `glassEffectStyle` values: 'regular' |
 * 'clear' | 'none', plus a tinted "vibrant" flavour via tintColor):
 *  - `regular`  (default): standard liquid glass — toolbars, pills, cards
 *  - `clear`:    no tint, just the backdrop — sheets, large panels
 *  - `vibrant`:  regular glass + stronger tint — floating buttons, focal chrome
 */
export type GlassVariant = 'regular' | 'clear' | 'vibrant'

type GlassSurfaceProps = {
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  tintColor?: string
  interactive?: boolean
  variant?: GlassVariant
  blurIntensity?: number
} & Pick<ViewProps, 'pointerEvents'>

function blurTintFor(variant: GlassVariant): 'systemMaterial' | 'systemThinMaterial' | 'systemUltraThinMaterial' {
  if (variant === 'clear') return 'systemUltraThinMaterial'
  if (variant === 'vibrant') return 'systemMaterial'
  return 'systemThinMaterial'
}

export function GlassSurface({
  children,
  style,
  tintColor,
  interactive = false,
  variant = 'regular',
  blurIntensity,
  pointerEvents,
}: GlassSurfaceProps): React.ReactElement {
  const { isDark } = useTheme()
  const canUseGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable()

  if (!canUseGlass) {
    // Fallback: BlurView on iOS < 26 / Android (where blur is supported),
    // otherwise a plain View (web).
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      const intensity = blurIntensity ?? (variant === 'vibrant' ? 90 : variant === 'clear' ? 55 : 75)
      return (
        <BlurView
          pointerEvents={pointerEvents}
          tint={blurTintFor(variant)}
          intensity={intensity}
          style={style}
        >
          {children}
        </BlurView>
      )
    }
    return <View pointerEvents={pointerEvents} style={style}>{children}</View>
  }

  return (
    <GlassView
      pointerEvents={pointerEvents}
      colorScheme={isDark ? 'dark' : 'light'}
      glassEffectStyle={variant === 'clear' ? 'clear' : 'regular'}
      isInteractive={interactive}
      tintColor={tintColor}
      style={style}
    >
      {children}
    </GlassView>
  )
}
