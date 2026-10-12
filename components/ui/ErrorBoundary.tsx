import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { spacing } from '../../constants/theme'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Root render-error boundary. Without it a single bad screen (e.g. iterating
 * a non-array API payload) takes the whole app down to a blank view that only
 * a force-quit escapes — the boundary keeps the chrome alive and offers a
 * retry that remounts the tree.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onRetry={this.reset} />
    }
    return this.props.children
  }
}

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }): React.ReactElement {
  const { theme } = useTheme()
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Feather name="alert-triangle" size={28} color={theme.textSecondary} />
      <Text style={[styles.title, { color: theme.text }]}>Something went wrong</Text>
      <Text style={[styles.detail, { color: theme.textSecondary }]} numberOfLines={3}>
        {error.message || 'An unexpected error occurred.'}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        style={[styles.retryButton, { backgroundColor: theme.foreground }]}
        accessibilityLabel="Try again"
      >
        <Text style={[styles.retryText, { color: theme.background }]}>Try again</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  detail: {
    fontSize: 13,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
  },
})
