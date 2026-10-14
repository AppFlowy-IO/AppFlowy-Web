import { MeetingParagraph, MeetingTranscript, MeetingWord } from '@/application/services/js-services/http/meeting-api';

export const TRANSCRIPT_LANGUAGES = ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt'] as const;

export function defaultTranscriptLanguage(workspaceId: string) {
  try {
    return localStorage.getItem(`ai-meeting-transcript-language:${workspaceId}`) || 'auto';
  } catch {
    return 'auto';
  }
}

export function saveDefaultTranscriptLanguage(workspaceId: string, language: string) {
  try {
    localStorage.setItem(`ai-meeting-transcript-language:${workspaceId}`, language);
  } catch {
    // Private browsing or a full storage quota must not prevent transcription.
  }
}

export function normalizeTranscriptLanguage(value?: string | null) {
  const code = value?.trim().toLowerCase();

  return code && code !== 'auto' ? code : undefined;
}

export function detectedTranscriptLanguage(value?: string | null) {
  const code = normalizeTranscriptLanguage(value);

  return TRANSCRIPT_LANGUAGES.some((language) => language === code) ? code : undefined;
}

export function transcriptLanguageDisplayCode(value?: string) {
  const code = normalizeTranscriptLanguage(value);

  // Caption tracks can use languages and regional codes outside the audio
  // provider's language selector. Display their actual language when saved.
  return code && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code) ? code.split('-')[0].toUpperCase() : 'AUTO';
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker: string;
}

export interface AudioTranscriptResult {
  id: string;
  text: string;
  language?: string;
  duration?: number;
  segments: TranscriptSegment[];
}

/** Preserve paragraph boundaries and split each paragraph on speaker changes. */
export function convertMeetingTranscript(
  transcript: MeetingTranscript,
  paragraphs: MeetingParagraph[] = []
): AudioTranscriptResult {
  const segments: TranscriptSegment[] = [];
  const appendWords = (words: MeetingWord[]) => {
    let turn: MeetingWord[] = [];
    const flush = () => {
      const text = turn.map((word) => word.text).join(' ');

      if (turn.length && text.trim())
        segments.push({
          text,
          start: turn[0].start / 1000,
          end: turn[turn.length - 1].end / 1000,
          speaker: turn[0].speaker ?? 'Unknown',
        });
      turn = [];
    };

    words.forEach((word) => {
      if (turn.length && (turn[0].speaker ?? null) !== (word.speaker ?? null)) flush();
      turn.push(word);
    });
    flush();
  };

  if (paragraphs.length) {
    paragraphs.forEach((paragraph) => {
      if (paragraph.words?.length) appendWords(paragraph.words);
      else if (paragraph.text.trim())
        segments.push({
          text: paragraph.text,
          start: paragraph.start / 1000,
          end: paragraph.end / 1000,
          speaker: 'Unknown',
        });
    });
  } else {
    appendWords(transcript.words ?? []);
  }

  return {
    id: transcript.id,
    text: transcript.text || paragraphs.map((paragraph) => paragraph.text).join('\n\n'),
    language: normalizeTranscriptLanguage(transcript.language_code),
    duration: transcript.audio_duration ?? undefined,
    segments,
  };
}
