import React, {useEffect, useState} from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing, wordmark} from '../design/tokens';
import {getHistory, type HistoryEntry} from '../context/history';

export interface HistoryProps {
  onBack: () => void;
  onOpen: (entry: HistoryEntry) => void;
}

function HistoryRow({
  entry,
  onOpen,
}: {
  entry: HistoryEntry;
  onOpen: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({pressed}) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowText}>
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
      </View>
      {entry.thumbnailPath ? (
        <Image
          source={{uri: `file://${entry.thumbnailPath}`}}
          style={styles.rowThumb}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.rowThumb, styles.rowThumbEmpty]} />
      )}
    </Pressable>
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
              />
            ))
          )}
          <Text style={styles.note}>
            Entries live only on this device.
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
  wordmark: {...wordmark, fontSize: 18, color: colors.primary},
  stage: {...type.label, color: colors.textMuted},
  scroll: {flex: 1},
  body: {paddingTop: spacing.xl, paddingBottom: spacing.xl},
  title: {...type.display, color: colors.primary},
  empty: {...type.body, color: colors.textMuted, marginTop: spacing.lg},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
  },
  pressed: {backgroundColor: colors.accent},
  rowText: {flex: 1, marginRight: spacing.md},
  rowTitle: {...type.body, color: colors.text},
  rowDate: {...type.caption, color: colors.textMuted, marginTop: 2},
  rowSource: {...type.caption, color: colors.textSecondary, marginTop: 2},
  rowThumb: {
    width: 52,
    height: 52,
    borderRadius: 6,
    backgroundColor: colors.card,
  },
  rowThumbEmpty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineSoft,
  },
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
