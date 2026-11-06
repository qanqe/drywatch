import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {colors, fonts, spacing, radius} from '../design/tokens';

export type ShareTarget = 'claude' | 'chatgpt' | 'gemini' | 'others';

interface ShareModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (target: ShareTarget) => void;
}

const TARGETS: {key: ShareTarget; label: string; hint: string}[] = [
  {key: 'claude', label: 'Claude', hint: 'Attach to a Claude chat'},
  {key: 'chatgpt', label: 'ChatGPT', hint: 'Attach to a ChatGPT chat'},
  {key: 'gemini', label: 'Gemini', hint: 'Attach to a Gemini chat'},
  {key: 'others', label: 'Others', hint: 'Share to any installed app'},
];

function ShareModal({visible, onClose, onSelect}: ShareModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
          <Text style={styles.title}>Share context note</Text>
          <Text style={styles.subtitle}>The .md file will be attached.</Text>

          <View style={styles.list}>
            {TARGETS.map(target => (
              <Pressable
                key={target.key}
                accessibilityRole="button"
                onPress={() => onSelect(target.key)}
                style={({pressed}) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}>
                <Text style={styles.rowLabel}>{target.label}</Text>
                <Text style={styles.rowHint}>{target.hint}</Text>
                <Text style={styles.rowArrow}>↗</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({pressed}) => [styles.closeButton, pressed && styles.rowPressed]}>
            <Text style={styles.closeText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  title: {fontFamily: fonts.regular, fontSize: 17, color: colors.text},
  subtitle: {
    fontFamily: fonts.light,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  list: {marginTop: spacing.md},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
  },
  rowPressed: {backgroundColor: colors.accent},
  rowLabel: {fontFamily: fonts.regular, fontSize: 15, color: colors.text, width: 96},
  rowHint: {fontFamily: fonts.light, fontSize: 12, color: colors.textMuted, flex: 1},
  rowArrow: {fontFamily: fonts.light, fontSize: 16, color: colors.textSecondary},
  closeButton: {
    alignSelf: 'flex-end',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.base,
  },
  closeText: {fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary},
});

export default ShareModal;
