import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ACCENT_COLOR } from '../theme/pageTheme';
import { useAppUpdate, type UpdateState } from '../update/useAppUpdate';

const FOREGROUND_COLOR = '#FFFFFF';
const TRACK_COLOR = 'rgba(255, 255, 255, 0.35)';
const DISMISS_HIT_SLOP = 12;

type BannerContent = {
  message: string;
  /** Label of the main button; absent while there is nothing to confirm. */
  action?: string;
};

function describe(state: Exclude<UpdateState, { status: 'none' }>): BannerContent {
  switch (state.status) {
    case 'available':
      return { message: `Version ${state.release.version} is available`, action: 'Update' };
    case 'downloading':
      return {
        message:
          state.percent === null ? 'Downloading update…' : `Downloading update… ${state.percent}%`,
      };
    case 'downloaded':
      return { message: `Version ${state.release.version} is ready`, action: 'Install' };
    case 'failed':
      return { message: 'The update could not be installed', action: 'Retry' };
  }
}

/**
 * A slim bar shown above the page while a newer release of the app is
 * available. It renders nothing otherwise.
 */
export function UpdateBanner() {
  const { state, startUpdate, dismiss } = useAppUpdate();
  if (state.status === 'none') {
    return null;
  }

  const { message, action } = describe(state);
  const percent = state.status === 'downloading' ? state.percent : null;

  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <View style={styles.row}>
        <Text numberOfLines={1} style={styles.message}>
          {message}
        </Text>
        {action ? (
          <Pressable
            accessibilityRole="button"
            onPress={startUpdate}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionLabel}>{action}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={state.status === 'downloading' ? 'Cancel update' : 'Dismiss update'}
          accessibilityRole="button"
          hitSlop={DISMISS_HIT_SLOP}
          onPress={dismiss}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.dismiss}>✕</Text>
        </Pressable>
      </View>
      {state.status === 'downloading' ? (
        <View style={styles.track}>
          <View style={[styles.progress, { width: `${percent ?? 0}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: ACCENT_COLOR,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  message: {
    color: FOREGROUND_COLOR,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  action: {
    backgroundColor: FOREGROUND_COLOR,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  actionLabel: {
    color: ACCENT_COLOR,
    fontSize: 14,
    fontWeight: '700',
  },
  dismiss: {
    color: FOREGROUND_COLOR,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.6,
  },
  track: {
    backgroundColor: TRACK_COLOR,
    height: 3,
  },
  progress: {
    backgroundColor: FOREGROUND_COLOR,
    height: 3,
  },
});
