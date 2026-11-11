import {runPipeline} from './pipeline';
import {addHistoryEntry} from './history';
import {
  extractPostViaCronet,
  extractPostViaWebView,
  downloadVideoFromUrl,
  showDoneNotification,
  showDoneOverlay,
} from '../native/drywatch';
import {fetchTikTokSubtitles} from './subtitles';

interface ShareTaskData {
  postUrl: string;
}

/**
 * Headless JS task body, registered in index.js as "DryWatchShareTask".
 * Runs with NO Activity created - started directly by ShareHeadlessService
 * (android/.../ShareHeadlessService.kt) when the share sheet delivers a
 * TikTok link. That service is itself foreground and owns the ongoing
 * "Preparing your note" notification; this function owns the pipeline work
 * and the completion notification/overlay.
 */
export async function runShareHeadlessTask(data: ShareTaskData): Promise<void> {
  const postUrl = data?.postUrl;
  if (!postUrl) {
    return;
  }

  try {
    let extracted;
    try {
      extracted = await extractPostViaCronet(postUrl);
    } catch {
      extracted = await extractPostViaWebView(postUrl);
    }
    const downloaded = await downloadVideoFromUrl(extracted.videoUrl);
    const videoName = extracted.videoId
      ? `${extracted.author || 'tiktok'}-${extracted.videoId}.mp4`
      : 'TikTok video.mp4';

    let subtitleText: string | null = null;
    try {
      const fetched = await fetchTikTokSubtitles(extracted.subtitleInfos);
      subtitleText = fetched?.text ?? null;
    } catch {
      // subtitles are additive
    }

    const result = await runPipeline({
      videoName,
      videoUri: downloaded.videoPath,
      sourceUrl: postUrl,
      subtitleText,
      caption: extracted.caption,
      stickerText: extracted.stickers,
      sound: extracted.sound,
    });

    await addHistoryEntry({
      id: `${Date.now()}-bg`,
      videoName,
      videoUri: '',
      sourceUrl: postUrl,
      document: result.document,
      thumbnailPath: result.thumbnailPath,
      savedAt: Date.now(),
    }).catch(() => {});
    await showDoneNotification(videoName).catch(() => {});
    await showDoneOverlay(videoName, result.document).catch(() => {});
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    await showDoneNotification(`Processing failed: ${reason}`).catch(() => {});
  }
}
