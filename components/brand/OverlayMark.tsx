import React, { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { BODY, EYES, SMALL_EYES, type MarkMotion } from '../../lib/overlayBrand'

export function OverlayMark({
  size = 20,
  color = '#0a0a0a',
  motion = 'none',
  label = 'Overlay',
}: {
  size?: number
  color?: string
  motion?: MarkMotion
  label?: string
}): React.ReactElement {
  const [reducedMotion, setReducedMotion] = useState(true)
  const offset = useSharedValue(0)
  const scale = useSharedValue(1)
  const small = size <= 24

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value)
    }).catch(() => undefined)
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    cancelAnimation(offset)
    cancelAnimation(scale)
    // eslint-disable-next-line react-hooks/immutability
    offset.value = 0
    // eslint-disable-next-line react-hooks/immutability
    scale.value = 1
    if (!reducedMotion && motion === 'look') {
      const timing = { duration: 480, easing: Easing.inOut(Easing.ease) }
      offset.value = withRepeat(withSequence(
        withTiming(-95, timing),
        withTiming(-95, timing),
        withTiming(95, timing),
        withTiming(95, timing),
        withTiming(0, timing),
      ), -1, false)
    }
    if (!reducedMotion && motion === 'blink') {
      scale.value = withRepeat(withSequence(
        withTiming(1, { duration: 5640 }),
        withTiming(0.1, { duration: 150 }),
        withTiming(1, { duration: 210 }),
      ), -1, false)
    }
    return () => {
      cancelAnimation(offset)
      cancelAnimation(scale)
    }
  }, [motion, reducedMotion, offset, scale])

  const eyeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offset.value * size / 860 },
      { scaleY: scale.value },
    ],
  }))

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        position: 'relative',
      }}
      accessible={label !== ''}
      accessibilityRole="image"
      accessibilityLabel={label || undefined}
      accessibilityElementsHidden={label === ''}
      importantForAccessibility={label === '' ? 'no-hide-descendants' : 'auto'}
    >
      <Svg width={size} height={size} viewBox="43 -815 860 860" fill={color} style={{ position: 'absolute' }}>
        <Path d={BODY} />
      </Svg>
      <Animated.View style={[{ position: 'absolute', width: size, height: size }, eyeStyle]}>
        <Svg width={size} height={size} viewBox="43 -815 860 860" fill={color}>
          <Path d={small ? SMALL_EYES : EYES} />
        </Svg>
      </Animated.View>
    </Animated.View>
  )
}
