import React, {useEffect, useRef, useState} from 'react';
import {Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {colors, type, spacing} from '../design/tokens';
import {
  extractAudioToWav,
  readVideoMeta,
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
  onComplete,
  onCancel,
}: ProcessingProps) {
  const [stages, setStages] = useState<StageState[]>([
    {key: 'read', label: 'Reading video', state: 'active'},
    {key: 'audio', label: 'Extracting audio', state: 'waiting'},
    {key: 'model', label: 'Loading tiny model', state: 'waiting'},
    {key: 'transcribe', label: 'Whisper spike test', state: 'waiting'},
    {key: 'build', label: 'Building context document', state: 'waiting'},
  ]);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [spikeSeconds, setSpikeSeconds] = useState<number | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const run = async () => {
      const mark = (key: string, state: StageState['state']) =>
        setStages(prev => prev.map(s => (s.key === key ? {...s, state} : s)));

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

      // Spike: real whisper.rn transcription test with the tiny model.
      try {
        mark('audio', 'active');
        const wavPath = await extractAudioToWav(videoUri);
        mark('audio', 'done');

        mark('model', 'active');
        const status = await getModelStatus('tiny');
        const modelPath = status.downloaded
          ? (status.path as string)
          : await downloadModel('tiny');
        await loadModel(modelPath);
        mark('model', 'done');

        mark('transcribe', 'active');
        const startedAt = Date.now();
        const result = await transcribeFile(wavPath);
        const elapsedSeconds = (Date.now() - startedAt) / 1000;
        setTranscript(result.text.trim());
        setSpikeSeconds(elapsedSeconds);
        mark('transcribe', 'done');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Whisper spike failed: ${message}`);
        return;
      }

      mark('build', 'active');

      const sources: ContextSource[] = [
        {key: 'caption', label: 'Caption', status: 'not extracted', content: null},
        {key: 'subtitles', label: 'TikTok subtitles', status: 'not extracted', content: null},
        {key: 'transcript', label: 'Audio transcript', status: 'not extracted', content: null},
        {key: 'onscreen', label: 'On-screen text (OCR)', status: 'not extracted', content: null},
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

      // Brief pause so the final "done" state is visible before switching.
      setTimeout(() => {
        onComplete({document, meta});
      }, 600);
    };

    run();
  }, [videoUri, videoName, sourceUrl, onComplete]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.column}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>DryWatch</Text>
          <Text style={styles.stage}>processing</Text>
        </View>

        <View style={styles.body}>
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
              Spike transcript ({spikeSeconds !== null ? `${spikeSeconds.toFixed(1)}s` : '…'}):
              {'\n'}
              {transcript}
            </Text>
          ) : null}

          <Text style={styles.note}>
            Extraction (Whisper, OCR, captions) arrives in v0.0.4. What runs
            now is real: the video is opened, its metadata read, and the
            context document built and saved for review.
          </Text>
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={({pressed}) => [
              styles.cancelButton,
              pressed && styles.pressedSurface,
            ]}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const statusColor: Record<StageState['state'], string> = {
  done: colors.textSecondary,
  active: colors.primary,
  waiting: colors.textDisabled,
  failed: colors.primaryDeep,
};

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
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  wordmark: {...type.heading, color: colors.primary},
  stage: {...type.label, color: colors.textMuted},
  body: {marginTop: spacing.xxxl * 1.5, flex: 1},
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
