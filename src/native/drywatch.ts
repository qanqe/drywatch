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

interface DryWatchAppShareNative {
  shareFileTo(
    target: string,
    filePath: string,
  ): Promise<{mode: 'direct' | 'chooser'; app?: string}>;
}

interface DryWatchWebViewExtractNative {
  extractPostData(postUrl: string): Promise<{
    videoUrl: string;
    caption: string;
    author: string;
    durationSeconds: number;
    videoId: string;
  }>;
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
const NativeAppShare = NativeModules.DryWatchAppShare as
  | DryWatchAppShareNative
  | undefined;
const NativeWebViewExtract = NativeModules.DryWatchWebViewExtract as
  | DryWatchWebViewExtractNative
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

export async function shareFileToApp(
  target: string,
  filePath: string,
): Promise<{mode: 'direct' | 'chooser'; app?: string}> {
  if (!NativeAppShare) {
    throw new Error('App share module is unavailable on this platform.');
  }
  return NativeAppShare.shareFileTo(target, filePath);
}

export interface WebViewExtractResult {
  videoUrl: string;
  caption: string;
  author: string;
  durationSeconds: number;
  videoId: string;
}

export async function extractPostViaWebView(
  postUrl: string,
): Promise<WebViewExtractResult> {
  if (!NativeWebViewExtract) {
    throw new Error('WebView extraction module is unavailable on this platform.');
  }
  return NativeWebViewExtract.extractPostData(postUrl);
}

/**
 * Download a video file from a direct URL (TikTok CDN playAddr) into app
 * cache. CDN downloads are not TLS-fingerprint gated; the Referer header
 * is required (verified during the retrieval spike).
 */
export async function downloadVideoFromUrl(
  videoUrl: string,
  onProgress?: (percent: number) => void,
): Promise<{videoPath: string; sizeBytes: number}> {
  const RNFS = require('react-native-fs').default;
  const dir = `${RNFS.CachesDirectoryPath ?? RNFS.DocumentDirectoryPath}/tiktok_downloads`;
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir);
  }
  const dest = `${dir}/webview-${Date.now()}.mp4`;
  const job = RNFS.downloadFile({
    fromUrl: videoUrl,
    toFile: dest,
    headers: {Referer: 'https://www.tiktok.com/'},
    progressInterval: 500,
    progress: (res: {bytesWritten: number; contentLength: number}) => {
      if (res.contentLength > 0 && onProgress) {
        onProgress(Math.round((res.bytesWritten / res.contentLength) * 100));
      }
    },
  });
  const result = await job.promise;
  if (result.statusCode !== 200) {
    const exists = await RNFS.exists(dest);
    if (exists) {
      await RNFS.unlink(dest);
    }
    throw new Error(`Video download failed with HTTP ${result.statusCode}.`);
  }
  const stat = await RNFS.stat(dest);
  if (Number(stat.size) < 100_000) {
    await RNFS.unlink(dest);
    throw new Error('Downloaded file is too small to be a video.');
  }
  return {videoPath: dest, sizeBytes: Number(stat.size)};
}
