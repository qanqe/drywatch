import {parseVtt} from './vtt';
import type {WebViewExtractResult} from '../native/drywatch';

export interface FetchedSubtitles {
  language: string;
  text: string;
}

/**
 * Fetch the best TikTok subtitle track for a post and return its text.
 * Preference order: en, en-US, then the first track offered. TikTok serves
 * WebVTT (sometimes with a webvtt->VTT naming variant); the parser handles
 * both comma and dot millisecond separators.
 */
export async function fetchTikTokSubtitles(
  subtitleInfos: WebViewExtractResult['subtitleInfos'],
): Promise<FetchedSubtitles | null> {
  if (!subtitleInfos || subtitleInfos.length === 0) {
    return null;
  }
  const preferred =
    subtitleInfos.find(s => s.languageID.startsWith('en')) ?? subtitleInfos[0];

  const RNFSModule = require('react-native-fs');
  const RNFS = RNFSModule.default ?? RNFSModule;
  if (!RNFS?.CachesDirectoryPath && !RNFS?.DocumentDirectoryPath) {
    throw new Error('react-native-fs did not load (no cache/document paths).');
  }
  const dest = `${RNFS.CachesDirectoryPath}/subtitle-${Date.now()}.vtt`;

  // The subtitle CDN needs the same Referer treatment as the video CDN.
  const download = RNFS.downloadFile({
    fromUrl: preferred.url,
    toFile: dest,
    headers: {Referer: 'https://www.tiktok.com/'},
  });
  const result = await download.promise;
  if (result.statusCode !== 200) {
    throw new Error(`Subtitle download returned HTTP ${result.statusCode}.`);
  }

  const raw = await RNFS.readFile(dest, 'utf8');
  const cues = parseVtt(raw);
  if (cues.length === 0) {
    return null;
  }
  const text = cues
    .map(cue => `[${formatCueStart(cue.startSeconds)}] ${cue.text}`)
    .join('\n');
  return {language: preferred.languageID, text};
}

function formatCueStart(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
