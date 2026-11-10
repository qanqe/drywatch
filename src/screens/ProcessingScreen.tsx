import React, {useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing} from '../design/tokens';
import {
  extractAudioToWav,
  extractOnScreenText,
  readVideoMeta,
  startProcessingService,
  stopProcessingService,
  updateProcessingStage,
  type VideoMeta,
} from '../native/drywatch';
import {loadModel, transcribeFile} from '../native/whisper';
import {downloadModel, getModelStatus} from '../native/whisperModels';
import {
  buildContextDocument,
  defaultTitle,
  type ContextSource,
} from '../context/builder';

export interface ProcessingProps {
  videoName: string;
  videoUri: string;
  sourceUrl: string | null;
  subtitleText: string | null;
  caption: string | null;
  stickerText: string[];
  onComplete: (result: {document: string; meta: VideoMeta | null}) => void;
  onCancel: () => void;
}

interface StageState {
  key: string;
  label: string;
  state: 'done' | 'active' | 'waiting' | 'failed';
}

function Processing({
  videoName,
  videoUri,
  sourceUrl,
  subtitleText,
  caption,
  stickerText,
  onComplete,
  onCancel,
}: ProcessingProps) {
  const stopAndCancel = () => {
    stopProcessingService().catch(() => {});
    onCancel();
  };
  const [stages, setStages] = useState<StageState[]>([
    {key: 'read', label: 'Reading video', state: 'active'},
    {key: 'audio', label: 'Extracting audio', state: 'waiting'},
    {key: 'model', label: 'Loading small model', state: 'waiting'},
    {key: 'transcribe', label: 'Whisper transcription', state: 'waiting'},
    {key: 'ocr', label: 'Reading on-screen text', state: 'waiting'},
    {key: 'build', label: 'Building context document', state: 'waiting'},
  ]);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [spikeSeconds, setSpikeSeconds] = useState<number | null>(null);
  const startedRef = useRef(false);
  const transcriptRef = useRef('');
  const transcriptSecondsRef = useRef<number | null>(null);
  const transcriptSegmentsRef = useRef<string>('');
  const ocrLinesRef = useRef<string[]>([]);
  const ocrStatusRef = useRef<'extracted' | 'no_text' | 'failed'>('failed');
  const stagesRef = useRef<StageState[]>([]);
  stagesRef.current = stages;

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const run = async () => {
      const mark = (key: string, state: StageState['state']) => {
        setStages(prev => {
          const next = prev.map(s => (s.key === key ? {...s, state} : s));
          // When a stage finishes, immediately light up the next one so the
          // list never shows a dead stretch of "waiting" rows (user-reported
          // UX regression: everything sat at waiting until all at once done).
          if (state === 'done') {
            const idx = next.findIndex(s => s.key === key);
            for (let i = idx + 1; i < next.length; i++) {
              if (next[i].state === 'waiting') {
                next[i] = {...next[i], state: 'active'};
                break;
              }
            }
          }
          return next;
        });
        const stage = stagesRef.current.find(s => s.key === key);
        if (stage) {
          const label =
            state === 'active'
              ? `${stage.label}…`
              : state === 'done'
              ? `${stage.label} - done`
              : state === 'failed'
              ? `${stage.label} - failed`
              : stage.label;
          updateProcessingStage(label).catch(() => {});
        }
      };

      // Foreground service keeps the notification alive if the user leaves.
      await startProcessingService(videoName).catch(() => {});

      let meta: VideoMeta | null = null;
      try {
        meta = await readVideoMeta(videoUri);
        mark('read', 'done');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Could not read this video: ${message}`);
        mark('read', 'failed');
        return;
      }

      // Real whisper.rn transcription with the small model.
      try {
        mark('audio', 'active');
        const wavPath = await extractAudioToWav(videoUri);
        mark('audio', 'done');

        mark('model', 'active');
        const status = await getModelStatus('small');
        const modelPath = status.downloaded
          ? (status.path as string)
          : await downloadModel('small');
        await loadModel(modelPath);
        mark('model', 'done');

        mark('transcribe', 'active');
        const startedAt = Date.now();
        const result = await transcribeFile(wavPath);
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        const transcriptText = result.text.trim();
        setTranscript(transcriptText);
        setSpikeSeconds(elapsedSeconds);
        mark('transcribe', 'done');
        transcriptRef.current = transcriptText;
        transcriptSecondsRef.current = elapsedSeconds;
        transcriptSegmentsRef.current = result.segments
          .map(seg => `[${formatSegmentTime(seg.t0)}] ${seg.text}`)
          .join('\n');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Transcription failed: ${message}`);
        stopProcessingService().catch(() => {});
        return;
      }

      // OCR: real on-device text recognition over sampled frames.
      // Failure here is not fatal - the note just reports it honestly.
      try {
        mark('ocr', 'active');
        const ocr = await extractOnScreenText(
          videoUri,
          meta?.durationMs ?? 0,
        );
        if (ocr.status === 'ok' && ocr.lines.length > 0) {
          ocrLinesRef.current = ocr.lines;
          ocrStatusRef.current = 'extracted';
        } else {
          ocrStatusRef.current = 'no_text';
        }
        mark('ocr', 'done');
      } catch {
        ocrStatusRef.current = 'failed';
        mark('ocr', 'done');
      }

      mark('build', 'active');

      const sources: ContextSource[] = [
        caption
          ? {
              key: 'caption',
              label: 'Caption',
              status: 'extracted',
              content: caption,
            }
          : sourceUrl
          ? {
              key: 'caption',
              label: 'Caption',
              status: 'unavailable',
              content: null,
            }
          : {
              key: 'caption',
              label: 'Caption',
              status: 'not extracted',
              content: null,
            },
        subtitleText
          ? {
              key: 'subtitles',
              label: 'TikTok subtitles',
              status: 'extracted',
              content: subtitleText,
            }
          : sourceUrl
          ? {
              key: 'subtitles',
              label: 'TikTok subtitles',
              status: 'unavailable',
              content: null,
            }
          : {
              key: 'subtitles',
              label: 'TikTok subtitles',
              status: 'not extracted',
              content: null,
            },
        {
          key: 'transcript',
          label: 'Audio transcript',
          status: transcriptRef.current ? 'extracted' : 'not extracted',
          content: transcriptSegmentsRef.current || transcriptRef.current || null,
        },
        ocrStatusRef.current === 'extracted' || stickerText.length > 0
          ? {
              key: 'onscreen',
              label: 'On-screen text (OCR)',
              status: 'extracted',
              content: [
                ...stickerText.map(text => `${text} [sticker]`),
                ...ocrLinesRef.current,
              ].join('\n'),
            }
          : ocrStatusRef.current === 'no_text'
          ? {
              key: 'onscreen',
              label: 'On-screen text (OCR)',
              status: 'unavailable',
              content: null,
            }
          : {
              key: 'onscreen',
              label: 'On-screen text (OCR)',
              status: 'not extracted',
              content: null,
            },
      ];

      const document = buildContextDocument({
        title: defaultTitle(videoName),
        sourceUrl,
        videoName,
        meta,
        sources,
      });

      setStages(prev =>
        prev.map(s => (s.key === 'build' ? {...s, state: 'done'} : s)),
      );
      stopProcessingService().catch(() => {});

      // Brief pause so the final "done" state is visible before switching.
      setTimeout(() => {
        onComplete({document, meta});
      }, 600);
    };

    run();
    // subtitleText is read once at mount alongside the other run inputs;
    // re-running on subtitle changes would restart Whisper mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUri, videoName, sourceUrl, caption, stickerText, onComplete]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.column}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>DryWatch</Text>
          <Text style={styles.stage}>processing</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={true}>
          <Text style={styles.title}>Working on your video.</Text>
          <Text style={styles.videoName} numberOfLines={1}>
            {videoName}
          </Text>

          <View style={styles.stageList}>
            {stages.map(stage => (
              <View key={stage.key} style={styles.stageRow}>
              <Text style={stageStatusStyle(stage.state)}>
                  {stage.state === 'done'
                    ? 'done'
                    : stage.state === 'active'
                    ? 'in progress'
                    : stage.state === 'failed'
                    ? 'failed'
                    : 'waiting'}
                </Text>
                <Text style={styles.stageLabel}>{stage.label}</Text>
              </View>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {transcript ? (
            <Text style={styles.transcript}>
              Transcript preview ({spikeSeconds !== null ? `${spikeSeconds.toFixed(1)}s` : '…'}):
              {'\n'}
              {transcript}
            </Text>
          ) : null}

          <Text style={styles.note}>
            The transcript is real on-device Whisper output. Caption, TikTok
            subtitle, and on-screen text extraction continue to improve in
            upcoming updates.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={stopAndCancel}
            style={({pressed}) => [
              styles.cancelButton,
              pressed && styles.pressedSurface,
            ]}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const statusColor: Record<StageState['state'], string> = {
  done: colors.textSecondary,
  active: colors.primary,
  waiting: colors.textDisabled,
  failed: colors.primaryDeep,
};

// whisper.rn segment times are whisper.cpp centiseconds (10ms units).
// Verified empirically: a 135s video's last segment arrived as 12760.
function formatSegmentTime(centiseconds: number): string {
  const totalSeconds = Math.floor(centiseconds / 100);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor(centiseconds % 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centis
    .toString()
    .padStart(2, '0')}`;
}

const stageStatusStyle = (state: StageState['state']) => ({
  ...type.label,
  color: statusColor[state],
  width: 96,
});

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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  scroll: {flex: 1},
  wordmark: {...type.heading, color: colors.primary},
  stage: {...type.label, color: colors.textMuted},
  body: {paddingTop: spacing.xl, paddingBottom: spacing.xl},
  title: {...type.display, color: colors.primary},
  videoName: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  stageList: {marginTop: spacing.xxl},
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
  },
  stageLabel: {...type.body, color: colors.text},
  error: {...type.caption, color: colors.primaryDeep, marginTop: spacing.lg},
  transcript: {
    ...type.caption,
    color: colors.text,
    marginTop: spacing.lg,
    maxWidth: 320,
  },
  note: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xxl,
    maxWidth: 320,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineSoft,
    paddingVertical: spacing.md,
    marginTop: 'auto',
  },
  cancelButton: {
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  cancelText: {...type.label, color: colors.primary},
  pressedSurface: {backgroundColor: colors.accent},
});

export default Processing;
