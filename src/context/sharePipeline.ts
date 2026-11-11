import {runPipeline, type PipelineResult} from './pipeline';

/**
 * Background share-sheet pipeline state.
 *
 * The share arrives through ShareActivity (native), which stores the URL.
 * When the app's JS context next runs (MainActivity resumes, or the share
 * activity itself starts it), this module picks the URL up and runs the
 * full pipeline with notification-only feedback - no UI takeover.
 *
 * Result is kept here so the done-overlay can show a summary when the user
 * next opens the app, and so the note lands in history automatically.
 */
export interface ShareRunState {
  status: 'running' | 'done' | 'failed';
  postUrl: string;
  videoName?: string;
  result?: PipelineResult;
  error?: string;
  finishedAt?: number;
}

let current: ShareRunState | null = null;
let pendingUrl: string | null = null;

export function offerShareRun(postUrl: string): void {
  // One at a time: a new share while one runs replaces the pending one.
  pendingUrl = postUrl;
}

export function peekPendingShare(): string | null {
  return pendingUrl;
}

export function takeShareRun(): ShareRunState | null {
  const state = current;
  current = null;
  return state;
}

export function getShareRunState(): ShareRunState | null {
  return current;
}

/**
 * Runs the share pipeline in the background. Resolves when done; callers
 * (the app bootstrap) fire-and-forget this and read state via getShareRunState.
 */
export async function executeShareRun(
  postUrl: string,
): Promise<ShareRunState> {
  const state: ShareRunState = {status: 'running', postUrl};
  current = state;
  try {
    // Extraction + download (same chain as the in-app link route).
    const {
      extractPostViaCronet,
      extractPostViaWebView,
      downloadVideoFromUrl,
    } = require('../native/drywatch');
    const {fetchTikTokSubtitles} = require('./subtitles');

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

    state.status = 'done';
    state.videoName = videoName;
    state.result = result;
    state.finishedAt = Date.now();
    return state;
  } catch (err: unknown) {
    state.status = 'failed';
    state.error = err instanceof Error ? err.message : String(err);
    state.finishedAt = Date.now();
    return state;
  }
}
