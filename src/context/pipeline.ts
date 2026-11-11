import {
  extractAudioToWav,
  extractOnScreenText,
  getVideoThumbnail,
  readVideoMeta,
  type VideoMeta,
} from '../native/drywatch';
import {loadModel, transcribeFile} from '../native/whisper';
import {downloadModel, getModelStatus} from '../native/whisperModels';
import {
  buildContextDocument,
  defaultTitle,
  type ContextSource,
} from './builder';

/**
 * The full video -> context-note pipeline, extracted from ProcessingScreen so
 * both the in-app screen and the share-sheet background flow run the exact
 * same engine. `onStage` reports progress; failures of cosmetic stages
 * (thumbnail, OCR) never abort the run.
 */
export interface PipelineInput {
  videoName: string;
  videoUri: string;
  sourceUrl: string | null;
  subtitleText: string | null;
  caption: string | null;
  stickerText: string[];
  sound: {title: string; authorName: string; isOriginal: boolean} | null;
  onStage?: (key: string, state: 'active' | 'done' | 'failed') => void;
}

export interface PipelineResult {
  document: string;
  meta: VideoMeta | null;
  thumbnailPath: string | null;
  elapsedTranscribeSeconds: number | null;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const {onStage} = input;
  const mark = (
    key: string,
    state: 'active' | 'done' | 'failed',
  ) => onStage?.(key, state);

  let meta: VideoMeta | null = null;
  mark('read', 'active');
  meta = await readVideoMeta(input.videoUri);
  mark('read', 'done');

  let thumbnailPath: string | null = null;
  try {
    thumbnailPath = await getVideoThumbnail(input.videoUri);
  } catch {
    // cosmetic only
  }

  let transcriptText = '';
  let transcriptSegments = '';
  let elapsedSeconds: number | null = null;
  try {
    mark('audio', 'active');
    const wavPath = await extractAudioToWav(input.videoUri);
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
    elapsedSeconds = (Date.now() - startedAt) / 1000;
    transcriptText = result.text.trim();
    mark('transcribe', 'done');
    transcriptSegments = result.segments
      .map(seg => `[${formatSegmentTime(seg.t0)}] ${seg.text}`)
      .join('\n');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Transcription failed: ${message}`);
  }

  let ocrLines: string[] = [];
  try {
    mark('ocr', 'active');
    const ocr = await extractOnScreenText(input.videoUri, meta?.durationMs ?? 0);
    if (ocr.status === 'ok' && ocr.lines.length > 0) {
      ocrLines = ocr.lines;
    }
    mark('ocr', 'done');
  } catch {
    mark('ocr', 'done');
  }

  mark('build', 'active');

  const sources: ContextSource[] = [
    input.caption
      ? {key: 'caption', label: 'Caption', status: 'extracted', content: input.caption}
      : input.sourceUrl
      ? {key: 'caption', label: 'Caption', status: 'unavailable', content: null}
      : {key: 'caption', label: 'Caption', status: 'not extracted', content: null},
    input.subtitleText
      ? {key: 'subtitles', label: 'TikTok subtitles', status: 'extracted', content: input.subtitleText}
      : input.sourceUrl
      ? {key: 'subtitles', label: 'TikTok subtitles', status: 'unavailable', content: null}
      : {key: 'subtitles', label: 'TikTok subtitles', status: 'not extracted', content: null},
    {
      key: 'transcript',
      label: 'Audio transcript',
      status: transcriptText ? 'extracted' : 'not extracted',
      content: transcriptSegments || transcriptText || null,
    },
    input.sound
      ? {
          key: 'sound',
          label: 'Sound',
          status: 'extracted',
          content:
            `${input.sound.title} - ${input.sound.authorName}` +
            (input.sound.isOriginal ? ' (original sound)' : ' (TikTok sound)'),
        }
      : {key: 'sound', label: 'Sound', status: 'not extracted', content: null},
    ocrLines.length > 0 || input.stickerText.length > 0
      ? {
          key: 'onscreen',
          label: 'On-screen text (OCR)',
          status: 'extracted',
          content: [
            ...input.stickerText.map(text => `${text} [sticker]`),
            ...ocrLines,
          ].join('\n'),
        }
      : input.sourceUrl
      ? {key: 'onscreen', label: 'On-screen text (OCR)', status: 'unavailable', content: null}
      : {key: 'onscreen', label: 'On-screen text (OCR)', status: 'not extracted', content: null},
  ];

  const document = buildContextDocument({
    title: defaultTitle(input.videoName),
    sourceUrl: input.sourceUrl,
    videoName: input.videoName,
    meta,
    sources,
  });

  mark('build', 'done');

  return {document, meta, thumbnailPath, elapsedTranscribeSeconds: elapsedSeconds};
}

// whisper.rn segment times are whisper.cpp centiseconds (10ms units).
function formatSegmentTime(centiseconds: number): string {
  const totalSeconds = Math.floor(centiseconds / 100);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor(centiseconds % 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centis
    .toString()
    .padStart(2, '0')}`;
}
