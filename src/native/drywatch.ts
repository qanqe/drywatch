import {NativeModules, Platform} from 'react-native';

interface DryWatchShareIntentNative {
  consumePendingShare(): Promise<{url: string | null}>;
}

interface DryWatchVideoMetaNative {
  readMeta(uri: string): Promise<{
    durationMs: string | null;
    width: string | null;
    height: string | null;
    rotation: string | null;
    hasAudio: boolean;
  }>;
  getThumbnail(uri: string): Promise<string>;
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
  showDoneNotification(title: string): Promise<boolean>;
  showDoneOverlay(title: string, documentText: string): Promise<boolean>;
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
    stickers?: string[];
    subtitleInfos?: Array<{languageID: string; url: string; format: string}>;
    sound?: {title: string; authorName: string; isOriginal: boolean};
  }>;
  downloadToFile(
    url: string,
    destPath: string,
  ): Promise<{videoPath: string; sizeBytes: number}>;
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
const NativeCronetExtract = NativeModules.DryWatchCronetExtract as
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

export async function consumePendingShare(): Promise<{
  url: string | null;
}> {
  if (Platform.OS !== 'android' || !NativeShare) {
    return {url: null};
  }
  const raw = await NativeShare.consumePendingShare();
  if (!raw || !raw.url) {
    return {url: null};
  }
  // Shares often include the caption text plus the URL; take the first URL.
  const match = raw.url.match(/https?:\/\/\S+/);
  return {
    url: match ? match[0] : null,
  };
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

/**
 * JPEG thumbnail of the video's opening seconds, written to app cache.
 * Resolves the absolute file path (prefix with file:// for RN Image).
 */
export async function getVideoThumbnail(uri: string): Promise<string> {
  if (!NativeMeta) {
    throw new Error('Video metadata module is unavailable on this platform.');
  }
  return NativeMeta.getThumbnail(uri);
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

/**
 * Chrome-downloads-style completion notice: stays in the tray after the
 * pipeline finishes, swipeable, tap opens the app.
 */
export async function showDoneNotification(title: string): Promise<void> {
  if (!NativeProcessingControl) {
    return;
  }
  await NativeProcessingControl.showDoneNotification(title);
}

/**
 * Small centered card over whatever app is in front (TikTok) when a
 * background share run finishes. Shows Copy (note onto clipboard) and
 * Later buttons; tapping outside dismisses.
 */
export async function showDoneOverlay(
  title: string,
  documentText: string,
): Promise<void> {
  if (!NativeProcessingControl) {
    return;
  }
  await NativeProcessingControl.showDoneOverlay(title, documentText);
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
  stickers: string[];
  subtitleInfos: Array<{languageID: string; url: string; format: string}>;
  sound: {title: string; authorName: string; isOriginal: boolean} | null;
}

export async function extractPostViaWebView(
  postUrl: string,
): Promise<WebViewExtractResult> {
  if (!NativeWebViewExtract) {
    throw new Error('WebView extraction module is unavailable on this platform.');
  }
  const raw = await NativeWebViewExtract.extractPostData(postUrl);
  return {
    ...raw,
    stickers: raw.stickers ?? [],
    subtitleInfos: raw.subtitleInfos ?? [],
    sound: raw.sound ?? null,
  };
}

/**
 * Same contract as extractPostViaWebView, but the request goes through
 * Cronet (backed by Google Play services) instead of a hidden WebView.
 * Exists to test whether Cronet's TLS fingerprint clears TikTok's
 * anti-bot gate that the WebView path trips on. Not yet wired into the
 * pipeline — see compareExtractionPaths.
 */
export async function extractPostViaCronet(
  postUrl: string,
): Promise<WebViewExtractResult> {
  if (!NativeCronetExtract) {
    throw new Error('Cronet extraction module is unavailable on this platform.');
  }
  const raw = await NativeCronetExtract.extractPostData(postUrl);
  return {
    ...raw,
    stickers: raw.stickers ?? [],
    subtitleInfos: raw.subtitleInfos ?? [],
    sound: raw.sound ?? null,
  };
}

export interface ExtractionComparison {
  webview: {ok: true; result: WebViewExtractResult} | {ok: false; error: string};
  cronet: {ok: true; result: WebViewExtractResult} | {ok: false; error: string};
}

/**
 * Runs both extraction paths against the same URL concurrently and reports
 * both outcomes without failing. Used to compare them on a real device
 * before deciding whether Cronet can replace the WebView path.
 */
export async function compareExtractionPaths(
  postUrl: string,
): Promise<ExtractionComparison> {
  const settle = async (
    run: () => Promise<WebViewExtractResult>,
  ): Promise<{ok: true; result: WebViewExtractResult} | {ok: false; error: string}> => {
    try {
      return {ok: true, result: await run()};
    } catch (e) {
      return {ok: false, error: e instanceof Error ? e.message : String(e)};
    }
  };

  const [webview, cronet] = await Promise.all([
    settle(() => extractPostViaWebView(postUrl)),
    settle(() => extractPostViaCronet(postUrl)),
  ]);
  return {webview, cronet};
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
  const RNFSModule = require('react-native-fs');
  // Metro/CJS interop differs between debug and release bundles: the module
  // may land on `.default` or on the namespace object itself.
  const RNFS = RNFSModule.default ?? RNFSModule;
  if (!RNFS?.CachesDirectoryPath && !RNFS?.DocumentDirectoryPath) {
    throw new Error('react-native-fs did not load (no cache/document paths).');
  }
  const dir = `${RNFS.CachesDirectoryPath ?? RNFS.DocumentDirectoryPath}/tiktok_downloads`;
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir);
  }
  const dest = `${dir}/tiktok-${Date.now()}.mp4`;

  // TikTok signs media URLs against the tt_chain_token cookie issued to the
  // request that minted them, so the download must reuse the Cronet session.
  // A separate HTTP client (RNFS) has no such cookie and gets HTTP 403.
  if (!NativeCronetExtract) {
    throw new Error('Cronet download module is unavailable on this platform.');
  }
  onProgress?.(0);
  const result = await NativeCronetExtract.downloadToFile(videoUrl, dest);
  if (result.sizeBytes < 100_000) {
    await RNFS.unlink(dest).catch(() => {});
    throw new Error('Downloaded file is too small to be a video.');
  }
  onProgress?.(100);
  return {videoPath: result.videoPath, sizeBytes: result.sizeBytes};
}
