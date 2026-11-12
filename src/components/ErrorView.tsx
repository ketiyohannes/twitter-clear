import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ACCENT_COLOR } from '../theme/pageTheme';

type ErrorViewProps = {
  backgroundColor: string;
  isDark: boolean;
  description: string;
  onRetry: () => void;
};

/** Full-screen fallback shown when the page cannot be loaded. */
export function ErrorView({ backgroundColor, isDark, description, onRetry }: ErrorViewProps) {
  const titleColor = isDark ? '#E7E9EA' : '#0F1419';
  const detailColor = isDark ? '#71767B' : '#536471';

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <Text style={[styles.title, { color: titleColor }]}>Something went wrong</Text>
      <Text style={[styles.detail, { color: detailColor }]}>
        {description || 'Check your connection and try again.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonLabel}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  detail: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 24,
    textAlign: 'center',
  },
  button: {
    backgroundColor: ACCENT_COLOR,
    borderRadius: 9999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
