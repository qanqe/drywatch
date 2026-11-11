import React, {useEffect, useState} from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing} from '../design/tokens';
import {
  getHistory,
  removeHistoryEntry,
  type HistoryEntry,
} from '../context/history';

export interface HistoryProps {
  onBack: () => void;
  onOpen: (entry: HistoryEntry) => void;
}

const SWIPE_REMOVE_THRESHOLD = -120;

function HistoryRow({
  entry,
  onOpen,
  onRemove,
}: {
  entry: HistoryEntry;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const translateX = new Animated.Value(0);
  const removedRef = React.useRef(false);

  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) =>
      Math.abs(g.dx) > 12 && Math.abs(g.dy) < 24,
    onPanResponderMove: (_e, g) => {
      if (g.dx < 0) {
        Animated.timing(translateX, {
          toValue: Math.max(g.dx, -200),
          duration: 0,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderRelease: (_e, g) => {
      if (g.dx < SWIPE_REMOVE_THRESHOLD && !removedRef.current) {
        removedRef.current = true;
        Animated.timing(translateX, {
          toValue: -400,
          duration: 160,
          useNativeDriver: true,
        }).start(() => onRemove());
      } else {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      }
    },
  });

  return (
    <View style={styles.rowWrap}>
      <View style={styles.removeBehind}>
        <Text style={styles.removeText}>remove</Text>
      </View>
      <Animated.View
        style={[styles.row, {transform: [{translateX}]}]}
        {...pan.panHandlers}>
        <Pressable
          accessibilityRole="button"
          onPress={onOpen}
          style={({pressed}) => [styles.rowBody, pressed && styles.pressed]}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {entry.videoName}
          </Text>
          <Text style={styles.rowDate}>
            {new Date(entry.savedAt).toLocaleString()}
          </Text>
          {entry.sourceUrl ? (
            <Text style={styles.rowSource} numberOfLines={1}>
              {entry.sourceUrl}
            </Text>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function History({onBack, onOpen}: HistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getHistory()
      .then(setEntries)
      .finally(() => setLoaded(true));
  }, []);

  const remove = (id: string) => {
    removeHistoryEntry(id).catch(() => {});
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.column}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>DryWatch</Text>
          <Text style={styles.stage}>history</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={true}>
          <Text style={styles.title}>Your past notes.</Text>
          {!loaded ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : entries.length === 0 ? (
            <Text style={styles.empty}>
              Nothing here yet. Notes you build will appear here.
            </Text>
          ) : (
            entries.map(entry => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                onOpen={() => onOpen(entry)}
                onRemove={() => remove(entry.id)}
              />
            ))
          )}
          <Text style={styles.note}>
            Swipe a row left to remove it. Entries live only on this device.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={onBack}
            style={({pressed}) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.backText}>Back to start</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  wordmark: {...type.heading, color: colors.primary},
  stage: {...type.label, color: colors.textMuted},
  scroll: {flex: 1},
  body: {paddingTop: spacing.xl, paddingBottom: spacing.xl},
  title: {...type.display, color: colors.primary},
  empty: {...type.body, color: colors.textMuted, marginTop: spacing.lg},
  rowWrap: {
    marginTop: spacing.md,
    overflow: 'hidden',
    borderRadius: 6,
  },
  removeBehind: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.primaryDeep,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: spacing.lg,
  },
  removeText: {...type.label, color: colors.white},
  row: {backgroundColor: colors.card},
  rowBody: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
  },
  pressed: {backgroundColor: colors.accent},
  rowTitle: {...type.body, color: colors.text},
  rowDate: {...type.caption, color: colors.textMuted, marginTop: 2},
  rowSource: {...type.caption, color: colors.textSecondary, marginTop: 2},
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
  backButton: {
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  backText: {...type.label, color: colors.primary},
});

export default History;
