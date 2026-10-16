import {
  deleteMeetingTranscript,
  getMeetingParagraphs,
  getMeetingTranscript,
  getMeetingUsage,
  MeetingTranscriptRequest,
  submitMeetingTranscript,
  uploadMeetingAudio,
} from '@/application/services/js-services/http/meeting-api';
import { WorkspaceUsageAndLimit } from '@/application/types';

import {
  AudioTranscriptionError,
  isDirectMediaUrl,
  isSupportedTranscriptionFile,
  readMediaDuration,
} from './transcription-media';
import {
  AudioTranscriptResult,
  convertMeetingTranscript,
  detectedTranscriptLanguage,
  normalizeTranscriptLanguage,
} from './transcription-result';
import { acquireTranscription, hasActiveTranscription, releaseTranscription } from './transcription-session';
import { isTranscriptionLimitError, transcriptionUsage } from './transcription-usage';

export type AudioTranscriptionSource = File | { url: string };
export type AudioTranscriptionStage = 'idle' | 'checking' | 'uploading' | 'analyzing';

interface TranscriptionJob {
  id: string;
  language?: string;
}

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

function waitForPoll(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 3000);

    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function failureWithCode(code: 'uploadFailed' | 'submissionFailed' | 'resultFailed', error: unknown): never {
  if (isTranscriptionLimitError(error) || error instanceof AudioTranscriptionError) throw error;
  throw new AudioTranscriptionError(code, error);
}

/**
 * Flutter's pre-recorded AssemblyAI flow. A retry resumes a submitted job and
 * reuses an uploaded file. File billing belongs to the server, so this flow
 * must never also call update-used-transcribe-duration.
 */
export class AudioFileTranscription {
  private controller?: AbortController;
  private source?: AudioTranscriptionSource;
  private audioUrl?: string;
  private duration = 0;
  private requestedLanguage?: string;
  private job?: TranscriptionJob;

  constructor(
    private readonly workspaceId: string,
    private readonly callbacks: {
      onStage: (stage: AudioTranscriptionStage, progress?: number) => void;
      onUsage: (usage: WorkspaceUsageAndLimit) => void;
      onJob: (id: string) => void;
    }
  ) {}

  get canRetry() {
    return Boolean(this.source || this.job);
  }

  async start(source: AudioTranscriptionSource, language?: string) {
    if (hasActiveTranscription()) throw new AudioTranscriptionError('alreadyTranscribing');
    this.source = source;
    this.audioUrl = undefined;
    this.duration = 0;
    this.job = undefined;
    this.requestedLanguage = normalizeTranscriptLanguage(language);
    return this.run();
  }

  /** Reopening a page recovers the persisted job without uploading or billing again. */
  async resume(transcriptId: string) {
    if (hasActiveTranscription()) throw new AudioTranscriptionError('alreadyTranscribing');
    this.job = { id: transcriptId };
    this.source = undefined;
    this.audioUrl = undefined;
    return this.run();
  }

  async retry() {
    return this.run();
  }

  /** Navigation pauses polling; a document's saved job remains recoverable. */
  suspend() {
    this.controller?.abort();
  }

  async cancel() {
    this.suspend();
    const id = this.job?.id;

    this.job = undefined;
    this.source = undefined;
    this.audioUrl = undefined;
    if (id) await deleteMeetingTranscript(this.workspaceId, id);
  }

  private async submit(audioUrl: string, duration: number, language: string | undefined, signal: AbortSignal) {
    const request: MeetingTranscriptRequest = {
      audio_url: audioUrl,
      speaker_labels: true,
      speech_models: language ? ['universal-3-pro'] : ['universal-3-pro', 'universal-2'],
      ...(language ? { language_code: language } : { language_detection: true }),
    };

    try {
      const transcript = await submitMeetingTranscript(this.workspaceId, request, duration, signal);

      checkCancelled(signal);
      if (!transcript?.id) throw new AudioTranscriptionError('submissionFailed');
      this.job = { id: transcript.id, language };
      this.callbacks.onJob(transcript.id);
      return transcript.id;
    } catch (error) {
      checkCancelled(signal);
      failureWithCode('submissionFailed', error);
    }
  }

  private async fetchResult(id: string, signal: AbortSignal): Promise<AudioTranscriptResult> {
    try {
      for (let attempt = 0; attempt < 120; attempt++) {
        checkCancelled(signal);
        const transcript = await getMeetingTranscript(this.workspaceId, id, signal);

        checkCancelled(signal);
        if (transcript.status === 'error') {
          // A failed job cannot complete by polling. A later retry may submit again.
          this.job = undefined;
          this.callbacks.onJob('');
          throw new AudioTranscriptionError('serviceError', transcript.error);
        }

        if (transcript.status === 'completed') {
          let paragraphs;

          try {
            paragraphs = (await getMeetingParagraphs(this.workspaceId, id, signal))?.paragraphs;
          } catch {
            // Flutter falls back to words/text if the optional paragraph request fails.
            checkCancelled(signal);
          }

          checkCancelled(signal);
          return convertMeetingTranscript(transcript, paragraphs);
        }

        if (transcript.status !== 'queued' && transcript.status !== 'processing')
          throw new AudioTranscriptionError('resultFailed');
        if (attempt < 119) await waitForPoll(signal);
      }

      throw new AudioTranscriptionError('resultFailed');
    } catch (error) {
      checkCancelled(signal);
      failureWithCode('resultFailed', error);
    }
  }

  private async run(): Promise<AudioTranscriptResult> {
    if (hasActiveTranscription()) throw new AudioTranscriptionError('alreadyTranscribing');
    if (!this.source && !this.job) throw new AudioTranscriptionError('noAudio');
    const controller = new AbortController();
    const { signal } = controller;

    this.controller = controller;
    acquireTranscription(controller, signal);
    try {
      if (!this.job) {
        if (this.source instanceof File && !isSupportedTranscriptionFile(this.source.name))
          throw new AudioTranscriptionError('unsupportedFormat');
        if (this.source && !(this.source instanceof File) && !isDirectMediaUrl(this.source.url))
          throw new AudioTranscriptionError('unsupportedUrl');
        this.callbacks.onStage('checking');
        const usage = await getMeetingUsage(this.workspaceId, signal);

        checkCancelled(signal);
        this.callbacks.onUsage(usage);
        const allowance = transcriptionUsage(usage);

        if (allowance.exhausted) throw new AudioTranscriptionError('quotaExceeded');
        if (this.source instanceof File) {
          if (
            !usage.single_upload_unlimited &&
            usage.single_upload_limit > 0 &&
            this.source.size > usage.single_upload_limit
          )
            throw new AudioTranscriptionError('fileTooLarge', undefined, usage.single_upload_limit);
          if (!this.audioUrl) {
            this.duration = await readMediaDuration(this.source, signal);
            checkCancelled(signal);
          }

          if (allowance.remainingSeconds !== undefined && this.duration > allowance.remainingSeconds)
            throw new AudioTranscriptionError('recordingTooLong');
          if (!this.audioUrl) {
            this.callbacks.onStage('uploading', 0);
            try {
              const audioUrl = await uploadMeetingAudio(
                this.workspaceId,
                this.source,
                signal,
                (fraction) => {
                  if (!signal.aborted) this.callbacks.onStage('uploading', fraction);
                }
              );

              checkCancelled(signal);
              if (!audioUrl) throw new AudioTranscriptionError('uploadFailed');
              this.audioUrl = audioUrl;
            } catch (error) {
              checkCancelled(signal);
              failureWithCode('uploadFailed', error);
            }
          }
        } else {
          // Direct media URLs are fetched by the transcription service, not the browser.
          this.audioUrl = this.source?.url;
          this.duration = 0;
        }

        if (!this.audioUrl) throw new AudioTranscriptionError('noAudio');
        this.callbacks.onStage('analyzing');
        await this.submit(this.audioUrl, this.duration, this.requestedLanguage, signal);
      }

      this.callbacks.onStage('analyzing');
      let result = await this.fetchResult(this.job!.id, signal);
      const detected = detectedTranscriptLanguage(result.language);

      if (this.audioUrl && !this.requestedLanguage && !this.job?.language && detected) {
        const initial = result;

        try {
          const id = await this.submit(this.audioUrl, this.duration, detected, signal);

          result = await this.fetchResult(id, signal);
        } catch {
          checkCancelled(signal);
          result = initial;
          this.job = { id: initial.id, language: detected };
          this.callbacks.onJob(initial.id);
        }
      }

      if (!result.text.trim() && !result.segments.length) {
        this.job = undefined;
        this.callbacks.onJob('');
        throw new AudioTranscriptionError('noTranscript');
      }

      checkCancelled(signal);
      return result;
    } finally {
      releaseTranscription(controller);
      if (!signal.aborted) this.callbacks.onStage('idle');
    }
  }
}
