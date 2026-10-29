import React from 'react'
import { Text, View } from 'react-native'
import { OverlayMark } from './OverlayMark'

export function BrandLockup({
  size = 22,
  color,
}: {
  size?: number
  color: string
}): React.ReactElement {
  return (
    <View
      accessible
      accessibilityLabel="Overlay"
      style={{ flexDirection: 'row', alignItems: 'baseline', gap: size * 0.043 }}
    >
      <OverlayMark size={size * 0.86} color={color} label="" />
      <Text
        accessible={false}
        style={{
          color,
          fontFamily: 'LibreBaskerville',
          fontSize: size,
          letterSpacing: -size * 0.025,
          includeFontPadding: false,
        }}
      >verlay</Text>
    </View>
  )
}
