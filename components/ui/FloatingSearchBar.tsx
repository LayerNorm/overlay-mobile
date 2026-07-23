import React, { useEffect, useRef, useState } from 'react'
import {
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useDrawer } from '../../contexts/DrawerContext'
import { GlassSurface } from './GlassSurface'
import { hapticLight } from './haptics'

/**
 * Floating, keyboard-anchored search bar. Each screen that supports search
 * passes its own `value`/`onChangeText` plus a placeholder; the bar observes
 * the DrawerContext `searchNonce` to know when the user pressed the sidebar
 * search button and auto-opens/focuses.
 */
export function FloatingSearchBar({
  theme,
  isDark,
  value,
  onChangeText,
  placeholder,
}: {
  theme: Theme
  isDark: boolean
  value: string
  onChangeText: (next: string) => void
  placeholder: string
}): React.ReactElement | null {
  const { searchNonce } = useDrawer()
  const insets = useSafeAreaInsets()
  const inputRef = useRef<TextInput>(null)
  const [dismissedNonce, setDismissedNonce] = useState(0)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const visible = searchNonce !== 0 && searchNonce !== dismissedNonce

  // Open + focus when the sidebar search button is pressed.
  useEffect(() => {
    if (!visible) return
    // Next tick so the input is mounted before focus.
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [visible])

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height))
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  if (!visible) return null

  const bottomInset = keyboardHeight > 0 ? keyboardHeight + 8 : Math.max(insets.bottom, 0) + 16

  const handleClose = () => {
    Keyboard.dismiss()
    onChangeText('')
    setDismissedNonce(searchNonce)
  }

  return (
    <View style={[styles.wrapper, { bottom: bottomInset }]} pointerEvents="box-none">
      <GlassSurface
        interactive
        variant="vibrant"
        style={[
          styles.blur,
          { boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.45)' : '0 4px 12px rgba(0,0,0,0.18)' },
        ]}
      >
        <View style={styles.gradient}>
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.textDisabled}
            returnKeyType="search"
            style={[styles.input, { color: theme.text }]}
          />
          <TouchableOpacity
            onPress={() => { hapticLight(); handleClose() }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={16} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </GlassSurface>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 110,
  },
  blur: {
    height: 48,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  gradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
  },
})
