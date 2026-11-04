export interface VttCue {
  text: string;
  startSeconds: number;
}

function parseTimestamp(raw: string): number | null {
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const seconds = Number(parts[parts.length - 1].replace(',', '.'));
  const minutes = Number(parts[parts.length - 2]);
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (Number.isNaN(seconds) || Number.isNaN(minutes) || Number.isNaN(hours)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

export function parseVtt(content: string): VttCue[] {
  const cues: VttCue[] = [];
  const lines = content.split(/\r?\n/);
  let currentText: string[] = [];
  let currentStart: number | null = null;

  for (const line of lines) {
    const timingMatch = line.match(
      /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})/,
    );
    if (timingMatch) {
      // Flush the previous cue before starting a new one.
      if (currentStart !== null && currentText.length > 0) {
        cues.push({text: currentText.join(' ').trim(), startSeconds: currentStart});
      }
      currentText = [];
      currentStart = parseTimestamp(timingMatch[1]);
      continue;
    }
    if (
      currentStart !== null &&
      line.trim() &&
      !line.startsWith('WEBVTT') &&
      !line.startsWith('Kind:') &&
      !line.startsWith('Language:')
    ) {
      currentText.push(line.trim());
    }
  }
  if (currentStart !== null && currentText.length > 0) {
    cues.push({text: currentText.join(' ').trim(), startSeconds: currentStart});
  }

  // De-duplicate rolling-caption repeats (TikTok auto-captions repeat lines).
  const deduped: VttCue[] = [];
  for (const cue of cues) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.text === cue.text) {
      continue;
    }
    deduped.push(cue);
  }
  return deduped;
}

export function formatCueTime(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
