import {initWhisper, releaseAllWhisper, type WhisperContext} from 'whisper.rn';

export interface TranscriptSegment {
  text: string;
  t0: number;
  t1: number;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
}

let context: WhisperContext | null = null;
let currentModelPath: string | null = null;

export const WHISPER_MODELS = {
  tiny: {
    file: 'ggml-tiny.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    bytes: 77679549,
  },
  base: {
    file: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    bytes: 141954628,
  },
  small: {
    file: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    bytes: 465742275,
  },
} as const;

export type WhisperModelName = keyof typeof WHISPER_MODELS;

export async function loadModel(
  modelPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (context && currentModelPath === modelPath) {
    return;
  }
  await releaseModel();
  onProgress?.(0);
  context = await initWhisper({filePath: modelPath});
  currentModelPath = modelPath;
  onProgress?.(100);
}

export async function releaseModel(): Promise<void> {
  if (context) {
    try {
      await context.release();
    } finally {
      context = null;
      currentModelPath = null;
    }
  }
}

export async function transcribeFile(
  filePath: string,
  onProgress?: (percent: number) => void,
): Promise<TranscriptResult> {
  if (!context) {
    throw new Error('Whisper model is not loaded.');
  }
  const job = context.transcribe(filePath, {
    onProgress: (p: number) => onProgress?.(Math.round(p)),
  });
  const {result, segments} = await job.promise;
  return {
    text: result,
    segments: (segments ?? []).map(seg => ({
      text: String(seg.text).trim(),
      t0: seg.t0,
      t1: seg.t1,
    })),
  };
}

export async function shutdownWhisper(): Promise<void> {
  await releaseAllWhisper();
  context = null;
  currentModelPath = null;
}
