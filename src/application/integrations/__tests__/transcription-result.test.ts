import { convertMeetingTranscript, detectedTranscriptLanguage, normalizeTranscriptLanguage, transcriptLanguageDisplayCode, TRANSCRIPT_LANGUAGES } from '../transcription-result';
import { MeetingTranscript, MeetingWord } from '@/application/services/js-services/http/meeting-api';

const word = (text: string, speaker?: string, start = 1000, end = 2000): MeetingWord => ({ text, speaker, start, end });
const transcript = (overrides: Partial<MeetingTranscript> = {}): MeetingTranscript => ({ id: 'meeting', status: 'completed', text: 'Transcript', ...overrides });

describe('Flutter transcript conversion and languages', () => {
  it('preserves paragraph boundaries and splits contiguous words by speaker', () => {
    const result = convertMeetingTranscript(transcript(), [{
      text: 'Hello there. Hi.', start: 1000, end: 4000,
      words: [word('Hello', 'A'), word('there.', 'A', 2000, 3000), word('Hi.', 'B', 3000, 4000)],
    }, { text: 'Next paragraph', start: 4000, end: 6000, words: [word('Next paragraph', 'B', 4000, 6000)] }]);

    expect(result.segments).toEqual([
      { text: 'Hello there.', speaker: 'A', start: 1, end: 3 },
      { text: 'Hi.', speaker: 'B', start: 3, end: 4 },
      { text: 'Next paragraph', speaker: 'B', start: 4, end: 6 },
    ]);
  });

  it('uses paragraph text and Unknown when word data is missing', () => {
    expect(convertMeetingTranscript(transcript({ text: '' }), [
      { text: 'Paragraph one', start: 500, end: 2500 }, { text: 'Paragraph two', start: 2500, end: 5500 },
    ])).toMatchObject({ text: 'Paragraph one\n\nParagraph two', segments: [
      { text: 'Paragraph one', speaker: 'Unknown', start: 0.5, end: 2.5 },
      { text: 'Paragraph two', speaker: 'Unknown', start: 2.5, end: 5.5 },
    ] });
  });

  it('falls back to transcript words if no paragraphs are available', () => {
    expect(convertMeetingTranscript(transcript({ words: [word('Hello'), word('there'), word('Hi', 'A', 3000, 4000)] })).segments).toEqual([
      { text: 'Hello there', speaker: 'Unknown', start: 1, end: 2 }, { text: 'Hi', speaker: 'A', start: 3, end: 4 },
    ]);
  });

  it('uses full text when neither words nor paragraphs are available', () => {
    expect(convertMeetingTranscript(transcript({ language_code: ' EN ', audio_duration: 120 })))
      .toEqual({ id: 'meeting', text: 'Transcript', segments: [], language: 'en', duration: 120 });
  });

  it('ignores empty paragraph/word turns', () => {
    expect(convertMeetingTranscript(transcript(), [
      { text: ' ', start: 0, end: 1 }, { text: '', start: 0, end: 1, words: [word(' ', 'A')] },
    ]).segments).toEqual([]);
  });

  it.each([undefined, null, '', 'auto', ' AUTO '])('defaults to automatic detection for %s', (value) => {
    expect(normalizeTranscriptLanguage(value)).toBeUndefined();
  });

  it('preserves selected language codes and normalizes detection', () => {
    expect(normalizeTranscriptLanguage(' FR ')).toBe('fr');
    expect(normalizeTranscriptLanguage('zh')).toBe('zh');
    expect(detectedTranscriptLanguage(' PT ')).toBe('pt');
    expect(detectedTranscriptLanguage('unknown')).toBeUndefined();
  });

  it('exposes Auto as a stable selection alongside Flutter’s supported languages', () => {
    expect(TRANSCRIPT_LANGUAGES).toEqual(['auto', 'en', 'es', 'fr', 'de', 'it', 'pt']);
    expect(transcriptLanguageDisplayCode('auto')).toBe('AUTO');
    expect(transcriptLanguageDisplayCode(undefined)).toBe('AUTO');
    expect(transcriptLanguageDisplayCode('fr')).toBe('FR');
    expect(transcriptLanguageDisplayCode('unknown')).toBe('AUTO');
  });
});
