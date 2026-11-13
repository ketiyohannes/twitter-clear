import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ACCENT_COLOR } from '../theme/pageTheme';
import { VIDEO_QUALITY_OPTIONS, type VideoQuality } from '../video/videoQuality';

type VideoQualitySheetProps = {
  /** The quality in effect, or `null` while the sheet is closed. */
  current: VideoQuality | null;
  backgroundColor: string;
  isDark: boolean;
  onChoose: (quality: VideoQuality) => void;
  onClose: () => void;
};

const BACKDROP_COLOR = 'rgba(0, 0, 0, 0.5)';

/** A bottom sheet for pinning video playback to a quality. */
export function VideoQualitySheet({
  current,
  backgroundColor,
  isDark,
  onChoose,
  onClose,
}: VideoQualitySheetProps) {
  const insets = useSafeAreaInsets();
  const titleColor = isDark ? '#E7E9EA' : '#0F1419';
  const detailColor = isDark ? '#71767B' : '#536471';
  const dividerColor = isDark ? '#2F3336' : '#EFF3F4';

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={current !== null}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor, borderColor: dividerColor, paddingBottom: insets.bottom + 8 },
          ]}
        >
          <Text style={[styles.title, { color: titleColor }]}>Video quality</Text>
          <Text style={[styles.note, { color: detailColor }]}>
            Applies to the videos you play next.
          </Text>
          {VIDEO_QUALITY_OPTIONS.map((option) => {
            const isSelected = option.value === current;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                key={option.value}
                onPress={() => onChoose(option.value)}
                style={({ pressed }) => [
                  styles.option,
                  { borderTopColor: dividerColor },
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.optionText}>
                  <Text style={[styles.label, { color: titleColor }]}>{option.label}</Text>
                  {option.hint ? (
                    <Text style={[styles.hint, { color: detailColor }]}>{option.hint}</Text>
                  ) : null}
                </View>
                {isSelected ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BACKDROP_COLOR,
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 20,
  },
  note: {
    fontSize: 13,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 2,
  },
  option: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  optionText: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    fontSize: 13,
    paddingTop: 1,
  },
  check: {
    color: ACCENT_COLOR,
    fontSize: 18,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.6,
  },
});
