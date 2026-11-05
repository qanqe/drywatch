/**
 * Tests for the v0.0.5 fixes: VTT subtitle parsing, transcript persistence
 * into the context document, and themed token integrity.
 */

import {parseVtt, formatCueTime} from '../src/context/vtt';
import {buildContextDocument} from '../src/context/builder';
import {colors} from '../src/design/tokens';

describe('VTT subtitle parsing', () => {
  it('parses cues with timestamps and skips metadata lines', () => {
    const vtt = [
      'WEBVTT',
      'Kind: captions',
      'Language: en',
      '',
      '00:00:01.000 --> 00:00:03.500',
      'Hello world',
      '',
      '00:00:04.000 --> 00:00:06.000',
      'Second line',
      '',
    ].join('\n');

    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({text: 'Hello world', startSeconds: 1});
    expect(cues[1]).toEqual({text: 'Second line', startSeconds: 4});
  });

  it('deduplicates rolling-caption repeats', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:02.000',
      'same text',
      '',
      '00:00:02.500 --> 00:00:03.500',
      'same text',
      '',
      '00:00:04.000 --> 00:00:05.000',
      'different',
      '',
    ].join('\n');

    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('same text');
    expect(cues[1].text).toBe('different');
  });

  it('handles multiline cue text by joining lines', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:01:05,200 --> 00:01:08,900',
      'first part of line',
      'second part of line',
      '',
    ].join('\n');

    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('first part of line second part of line');
    expect(cues[0].startSeconds).toBe(65.2);
  });

  it('formats cue times as m:ss', () => {
    expect(formatCueTime(0)).toBe('0:00');
    expect(formatCueTime(65)).toBe('1:05');
    expect(formatCueTime(600)).toBe('10:00');
  });
});

describe('transcript persistence into the context document', () => {
  it('renders an extracted transcript with its content', () => {
    const doc = buildContextDocument({
      title: 'Persist test',
      sourceUrl: null,
      videoName: 'persist.mp4',
      meta: null,
      sources: [
        {key: 'caption', label: 'Caption', status: 'not extracted', content: null},
        {key: 'subtitles', label: 'TikTok subtitles', status: 'not extracted', content: null},
        {
          key: 'transcript',
          label: 'Audio transcript',
          status: 'extracted',
          content: '[0:02] this line must survive into the document',
        },
        {key: 'onscreen', label: 'On-screen text (OCR)', status: 'unavailable', content: null},
      ],
    });

    expect(doc).toContain(
      '### Audio transcript\n\n[0:02] this line must survive into the document',
    );
  });

  it('marks an empty transcript as not extracted rather than silently blank', () => {
    const doc = buildContextDocument({
      title: 'Empty transcript',
      sourceUrl: null,
      videoName: 'empty.mp4',
      meta: null,
      sources: [
        {key: 'transcript', label: 'Audio transcript', status: 'not extracted', content: null},
      ],
    });

    expect(doc).toContain('### Audio transcript');
    expect(doc).toContain('_Not extracted yet._');
  });
});

describe('dark theme default', () => {
  it('defaults to the robi.work dark palette', () => {
    expect(colors.background).toBe('#2b312f'); // dark-800
    expect(colors.text).toBe('#eaf2ef'); // dark-50
    expect(colors.primary).toBe('#eaf2ef');
  });
});
