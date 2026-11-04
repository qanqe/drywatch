import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  BackHandler,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  pick as pickDocument,
  types as documentTypes,
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
} from '@react-native-documents/picker';
import {colors, type, spacing} from './src/design/tokens';
import {
  consumePendingShare,
  downloadTikTokVideo,
  type VideoMeta,
} from './src/native/drywatch';
import {parseVtt, formatCueTime} from './src/context/vtt';
import ProcessingScreen from './src/screens/ProcessingScreen';
import ResultScreen from './src/screens/ResultScreen';

type Route = 'home' | 'processing' | 'result';

interface PickedVideo {
  name: string;
  uri: string;
}

interface ProcessedResult {
  document: string;
  meta: VideoMeta | null;
}

interface SubtitleContent {
  text: string;
}

function App() {
  const [route, setRoute] = useState<Route>('home');
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [retrieving, setRetrieving] = useState(false);
  const [subtitles, setSubtitles] = useState<SubtitleContent | null>(null);
  const resultCount = useRef(0);

  // Poll for a TikTok link shared into the app (share sheet, cold or warm).
  useEffect(() => {
    const interval = setInterval(async () => {
      const shared = await consumePendingShare();
      if (shared) {
        setLink(shared);
        startFromLink(shared);
      }
    }, 700);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startProcessing = useCallback(
    (
      picked: PickedVideo,
      url: string | null,
      subtitleContent?: SubtitleContent | null,
    ) => {
      setVideo(picked);
      setSourceUrl(url);
      setSubtitles(subtitleContent ?? null);
      setResult(null);
      setRoute('processing');
    },
    [],
  );

  const pickVideo = useCallback(async () => {
    setMessage('');
    try {
      const [picked] = await pickDocument({
        type: [documentTypes.video],
      });
      if (!picked?.uri) {
        setMessage('Could not read that file. Try a different one.');
        return;
      }
      // Persist a readable copy in app cache so native code can reopen it.
      const [copyResult] = await keepLocalCopy({
        files: [
          {
            uri: picked.uri,
            fileName: picked.name ?? 'video',
          },
        ],
        destination: 'cachesDirectory',
      });
      const localUri =
        copyResult?.status === 'success' ? copyResult.localUri : picked.uri;
      startProcessing(
        {name: picked.name ?? 'Selected video', uri: localUri},
        null,
      );
    } catch (err: unknown) {
      if (
        isErrorWithCode(err) &&
        err.code === errorCodes.OPERATION_CANCELED
      ) {
        return; // user closed the picker; not an error
      }
      setMessage('Could not open the file picker. Try again.');
    }
  }, [startProcessing]);

  const prepareLink = () => {
    const trimmed = link.trim();
    const isTikTok = /^https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\//i.test(
      trimmed,
    );
    if (!isTikTok) {
      setMessage('Paste a TikTok link to prepare it for processing.');
      return;
    }
    startFromLink(trimmed);
  };

  const startFromLink = useCallback(
    async (postUrl: string) => {
      setMessage('');
      setRetrieving(true);
      try {
        const downloaded = await downloadTikTokVideo(postUrl);
        let parsedSubtitles: SubtitleContent | null = null;
        if (downloaded.subtitlePath) {
          try {
            const vttResponse = await fetch(
              `file://${downloaded.subtitlePath}`,
            );
            const raw = await vttResponse.text();
            const cues = parseVtt(raw);
            if (cues.length > 0) {
              parsedSubtitles = {
                text: cues
                  .map(cue => `[${formatCueTime(cue.startSeconds)}] ${cue.text}`)
                  .join('\n'),
              };
            }
          } catch {
            // Subtitle file unreadable - subtitles stay unavailable, not fatal.
          }
        }
        startProcessing(
          {
            name: postUrl.split('/').pop() ?? 'TikTok video',
            uri: downloaded.videoPath,
          },
          postUrl,
          parsedSubtitles,
        );
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        setRetrieving(false);
        setMessage(
          `Could not download from the link. ${reason} You can pick the ` +
            'video file yourself below - that route always works.',
        );
      }
    },
    [startProcessing],
  );

  const onProcessingComplete = useCallback((processed: ProcessedResult) => {
    resultCount.current += 1;
    setResult(processed);
    setRoute('result');
  }, []);

  // Android back button: go back one screen; exit only from home.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (route !== 'home') {
          setRoute('home');
          return true;
        }
        return false; // home: let Android exit
      },
    );
    return () => subscription.remove();
  }, [route]);

  if (route === 'processing' && video) {
    return (
      <ProcessingScreen
        videoName={video.name}
        videoUri={video.uri}
        sourceUrl={sourceUrl}
        subtitleText={subtitles?.text ?? null}
        onComplete={onProcessingComplete}
        onCancel={() => setRoute('home')}
      />
    );
  }

  if (route === 'result' && result) {
    return (
      <ResultScreen
        videoName={video?.name ?? 'video'}
        document={result.document}
        onDone={() => setRoute('home')}
      />
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.column}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>DryWatch</Text>
          <Text style={styles.version}>v0.0.3</Text>
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>See what’s really there.</Text>
          <Text style={styles.subtitle}>
            Turn a TikTok into a readable note with its sources kept separate.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>START WITH</Text>

          <View style={styles.row}>
            <View>
              <Text style={styles.rowTitle}>A TikTok link</Text>
              <Text style={styles.rowDescription}>
                Share a link here from TikTok, or paste it below.
              </Text>
              <TextInput
                accessibilityLabel="TikTok link"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setLink}
                placeholder="Paste link"
                placeholderTextColor={colors.textSecondary}
                style={styles.linkInput}
                value={link}
              />
              <Pressable
                accessibilityRole="button"
                onPress={prepareLink}
                disabled={retrieving}
                style={({pressed}) => [
                  styles.primaryButton,
                  pressed && styles.pressedSurface,
                  retrieving && styles.disabledButton,
                ]}>
                <Text style={styles.primaryButtonText}>
                  {retrieving ? 'Downloading video…' : 'Prepare link'}
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <View>
              <Text style={styles.rowTitle}>A saved video</Text>
              <Text style={styles.rowDescription}>
                Choose a video already on this phone. This route stays local.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={pickVideo}
                style={({pressed}) => [
                  styles.secondaryButton,
                  pressed && styles.pressedSurface,
                ]}>
                <Text style={styles.secondaryButtonText}>Choose a file</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <View style={styles.footer}>
          <Text style={styles.footerText}>Whisper small · on-device goal</Text>
          <Text style={styles.footerText}>v0.0.3</Text>
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
  version: {...type.caption, color: colors.textSecondary},
  intro: {marginTop: spacing.xxxl * 1.5},
  title: {...type.display, color: colors.primary},
  subtitle: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
    maxWidth: 320,
  },
  section: {marginTop: spacing.xxl},
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  row: {paddingVertical: spacing.lg},
  rowTitle: {...type.title, color: colors.primary},
  rowDescription: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
    maxWidth: 300,
  },
  linkInput: {
    ...type.body,
    color: colors.primary,
    marginTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  primaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 7,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    marginTop: spacing.md,
  },
  primaryButtonText: {...type.label, color: colors.white},
  disabledButton: {opacity: 0.5},
  secondaryButton: {
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    marginTop: spacing.md,
  },
  secondaryButtonText: {...type.label, color: colors.primary},
  pressedSurface: {backgroundColor: colors.accent},
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairlineSoft,
  },
  message: {...type.caption, color: colors.textMuted, marginTop: spacing.sm},
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    marginTop: 'auto',
  },
  footerText: {...type.caption, color: colors.textSecondary},
});

export default App;
