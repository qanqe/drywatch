import {NativeModules, Platform} from 'react-native';

interface DryWatchShareIntentNative {
  consumePendingShare(): Promise<string | null>;
}

interface DryWatchVideoMetaNative {
  readMeta(uri: string): Promise<{
    durationMs: string | null;
    width: string | null;
    height: string | null;
    rotation: string | null;
    hasAudio: boolean;
  }>;
}

interface DryWatchClipboardFileNative {
  copyToClipboard(text: string): Promise<boolean>;
  saveTextFile(baseName: string, content: string): Promise<string>;
  shareTextFile(baseName: string, content: string): Promise<string>;
}

interface DryWatchAudioExtractorNative {
  extractToWav(uri: string): Promise<string>;
}

interface DryWatchTikTokDownloadNative {
  downloadVideo(
    postUrl: string,
  ): Promise<{videoPath: string; sizeBytes: number; subtitlePath?: string}>;
}

interface DryWatchOcrNative {
  extractOnScreenText(
    uri: string,
    durationMs: number,
  ): Promise<{status: string; lines?: string[]}>;
}

interface DryWatchProcessingControlNative {
  requestNotificationPermission(): Promise<boolean>;
  startService(title: string): Promise<boolean>;
  updateStage(stage: string): Promise<boolean>;
  stopService(): Promise<boolean>;
}

const NativeAudio = NativeModules.DryWatchAudioExtractor as
  | DryWatchAudioExtractorNative
  | undefined;
const NativeTikTok = NativeModules.DryWatchTikTokDownload as
  | DryWatchTikTokDownloadNative
  | undefined;
const NativeOcr = NativeModules.DryWatchOcr as
  | DryWatchOcrNative
  | undefined;
const NativeProcessingControl = NativeModules.DryWatchProcessingControl as
  | DryWatchProcessingControlNative
  | undefined;

const NativeShare = NativeModules.DryWatchShareIntent as
  | DryWatchShareIntentNative
  | undefined;
const NativeMeta = NativeModules.DryWatchVideoMeta as
  | DryWatchVideoMetaNative
  | undefined;
const NativeClipboardFile = NativeModules.DryWatchClipboardFile as
  | DryWatchClipboardFileNative
  | undefined;

export interface VideoMeta {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  hasAudio: boolean;
}

export async function consumePendingShare(): Promise<string | null> {
  if (Platform.OS !== 'android' || !NativeShare) {
    return null;
  }
  const raw = await NativeShare.consumePendingShare();
  if (!raw) {
    return null;
  }
  // Shares often include the caption text plus the URL; take the first URL.
  const match = raw.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

export async function readVideoMeta(uri: string): Promise<VideoMeta> {
  if (!NativeMeta) {
    throw new Error('Video metadata module is unavailable on this platform.');
  }
  const raw = await NativeMeta.readMeta(uri);
  return {
    durationMs: raw.durationMs ? Math.round(Number(raw.durationMs)) : null,
    width: raw.width ? Number(raw.width) : null,
    height: raw.height ? Number(raw.height) : null,
    rotation: raw.rotation ? Number(raw.rotation) : null,
    hasAudio: raw.hasAudio === true,
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null || Number.isNaN(ms) || ms < 0) {
    return 'unknown length';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export async function copyToClipboard(text: string): Promise<void> {
  if (!NativeClipboardFile) {
    throw new Error('Clipboard module is unavailable on this platform.');
  }
  await NativeClipboardFile.copyToClipboard(text);
}

export async function saveContextFile(
  baseName: string,
  content: string,
): Promise<string> {
  if (!NativeClipboardFile) {
    throw new Error('File module is unavailable on this platform.');
  }
  return NativeClipboardFile.saveTextFile(baseName, content);
}

export async function shareContextFile(
  baseName: string,
  content: string,
): Promise<string> {
  if (!NativeClipboardFile) {
    throw new Error('Share module is unavailable on this platform.');
  }
  return NativeClipboardFile.shareTextFile(baseName, content);
}

export async function extractAudioToWav(uri: string): Promise<string> {
  if (!NativeAudio) {
    throw new Error(
      'Audio extraction module is unavailable on this platform.',
    );
  }
  return NativeAudio.extractToWav(uri);
}

export async function downloadTikTokVideo(
  postUrl: string,
): Promise<{videoPath: string; sizeBytes: number; subtitlePath?: string}> {
  if (!NativeTikTok) {
    throw new Error('TikTok download module is unavailable on this platform.');
  }
  return NativeTikTok.downloadVideo(postUrl);
}

export interface OcrResult {
  status: 'ok' | 'no_frames' | 'no_text';
  lines: string[];
}

export async function extractOnScreenText(
  uri: string,
  durationMs: number,
): Promise<OcrResult> {
  if (!NativeOcr) {
    throw new Error('OCR module is unavailable on this platform.');
  }
  const raw = await NativeOcr.extractOnScreenText(uri, durationMs);
  return {
    status: raw.status as OcrResult['status'],
    lines: raw.lines ?? [],
  };
}

export async function startProcessingService(title: string): Promise<boolean> {
  if (!NativeProcessingControl) {
    return false;
  }
  await NativeProcessingControl.requestNotificationPermission();
  return NativeProcessingControl.startService(title);
}

export async function updateProcessingStage(stage: string): Promise<void> {
  if (!NativeProcessingControl) {
    return;
  }
  await NativeProcessingControl.updateStage(stage);
}

export async function stopProcessingService(): Promise<void> {
  if (!NativeProcessingControl) {
    return;
  }
  await NativeProcessingControl.stopService();
}
