import React, {useState} from 'react';
import {Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {colors, type, spacing} from '../design/tokens';
import {
  copyToClipboard,
  saveContextFile,
  shareContextFile,
} from '../native/drywatch';

export interface ResultProps {
  videoName: string;
  document: string;
  onDone: () => void;
}

type Feedback = {kind: 'ok' | 'error'; text: string} | null;

function Result({videoName, document, onDone}: ResultProps) {
  const [feedback, setFeedback] = useState<Feedback>(null);

  const runAction = async (
    label: string,
    action: () => Promise<unknown>,
  ) => {
    try {
      await action();
      setFeedback({kind: 'ok', text: `${label}.`});
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setFeedback({kind: 'error', text: `${label} failed: ${message}`});
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.column}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>DryWatch</Text>
          <Text style={styles.stage}>review</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>Your context note.</Text>
          <Text style={styles.videoName} numberOfLines={1}>
            {videoName}
          </Text>

          <View style={styles.docCard}>
            <Text style={styles.docText}>{document}</Text>
          </View>

          {feedback ? (
            <Text
              style={[
                styles.feedback,
                feedback.kind === 'error' && styles.feedbackError,
              ]}>
              {feedback.text}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => runAction('Copied', () => copyToClipboard(document))}
              style={({pressed}) => [
                styles.primaryButton,
                pressed && styles.pressedSurface,
              ]}>
              <Text style={styles.primaryButtonText}>Copy text</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                runAction('Saved', () => saveContextFile(videoName, document))
              }
              style={({pressed}) => [
                styles.secondaryButton,
                pressed && styles.pressedSurface,
              ]}>
              <Text style={styles.secondaryButtonText}>Save on device</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                runAction('Share sheet opened', () =>
                  shareContextFile(videoName, document),
                )
              }
              style={({pressed}) => [
                styles.secondaryButton,
                pressed && styles.pressedSurface,
              ]}>
              <Text style={styles.secondaryButtonText}>Share file</Text>
            </Pressable>
          </View>

          <Text style={styles.note}>
            Audio transcript is real Whisper output. Sections marked “not
            extracted” (captions, TikTok subtitles, on-screen text) are wired
            to their engines in later updates of v0.0.4.
          </Text>
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            style={({pressed}) => [
              styles.secondaryButton,
              pressed && styles.pressedSurface,
            ]}>
            <Text style={styles.secondaryButtonText}>Back to start</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.white},
  column: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 768,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.hairlineSoft,
    borderRightColor: colors.hairlineSoft,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wordmark: {...type.heading, color: colors.primary},
  stage: {...type.label, color: colors.textMuted},
  body: {marginTop: spacing.xxxl, flex: 1},
  title: {...type.display, color: colors.primary},
  videoName: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  docCard: {
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
    paddingTop: spacing.lg,
  },
  docText: {...type.caption, color: colors.text, lineHeight: 20},
  feedback: {...type.caption, color: colors.textMuted, marginTop: spacing.md},
  feedbackError: {color: colors.primaryDeep},
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 7,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  primaryButtonText: {...type.label, color: colors.white},
  secondaryButton: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  secondaryButtonText: {...type.label, color: colors.primary},
  pressedSurface: {backgroundColor: colors.accent},
  note: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xl,
    maxWidth: 320,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
    paddingVertical: spacing.md,
  },
});

export default Result;
