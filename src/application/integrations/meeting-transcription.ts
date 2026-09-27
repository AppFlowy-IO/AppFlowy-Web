import { getMeetingStreamingToken, reportMeetingDuration } from '@/application/services/js-services/http/meeting-api';

import audioWorkletUrl from './meeting-audio-worklet?worker&url';

export type MeetingAudioSource = 'microphone' | 'meeting';
export type TranscriptionState = 'starting' | 'recording' | 'stopping' | 'idle';

export class MeetingRecordingError extends Error {
  constructor(
    public readonly code: 'unsupported' | 'noSharedAudio' | 'alreadyRecording' | 'connectionFailed' | 'quotaExceeded'
  ) {
    super(code);
  }
}

/** Own the capture tracks, audio graph, socket and quota reporting as one session. */
export class MeetingTranscription {
  private static activeSession?: MeetingTranscription;
  private readonly abort = new AbortController();
  private streams: MediaStream[] = [];
  private context?: AudioContext;
  private processor?: AudioWorkletNode;
  private socket?: WebSocket;
  private startedAt = 0;
  private stoppedAt = 0;
  private reportedSeconds = 0;
  private billingTimer?: ReturnType<typeof setInterval>;
  private billing?: Promise<void>;
  private stopping?: Promise<void>;
  private closed = false;
  private partial = '';
  private partialTurn?: number;
  private turns = new Set<number>();
  private finishSocket?: () => void;

  constructor(
    private readonly workspaceId: string,
    private readonly callbacks: {
      onState: (state: TranscriptionState) => void;
      onPartial: (text: string) => void;
      onTranscript: (text: string, turnOrder?: number) => void;
      onError: (error: unknown) => void;
      onPendingDuration: (seconds: number) => void;
    }
  ) {}

  async start(source: MeetingAudioSource, pendingDuration = 0) {
    if (MeetingTranscription.activeSession) throw new MeetingRecordingError('alreadyRecording');
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined' ||
      (source === 'meeting' && !navigator.mediaDevices.getDisplayMedia)
    )
      throw new MeetingRecordingError('unsupported');
    MeetingTranscription.activeSession = this;
    this.callbacks.onState('starting');
    try {
      // Screen capture must be requested directly from the source-selection click.
      if (source === 'meeting') {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

        this.addStream(display);
        if (!display.getAudioTracks().length) throw new MeetingRecordingError('noSharedAudio');
      }

      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      this.addStream(microphone);
      const usage = await reportMeetingDuration(this.workspaceId, pendingDuration);

      this.callbacks.onPendingDuration(0);
      this.assertOpen();
      if (usage.remaining_duration === 0) throw new MeetingRecordingError('quotaExceeded');
      const { token } = await getMeetingStreamingToken(this.workspaceId, this.abort.signal);

      this.assertOpen();
      if (!token) throw new MeetingRecordingError('connectionFailed');
      this.context = new AudioContext({ sampleRate: 24_000 });
      await this.context.audioWorklet.addModule(audioWorkletUrl);
      this.assertOpen();
      this.processor = new AudioWorkletNode(this.context, 'meeting-audio', {
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      const url = new URL('wss://streaming.assemblyai.com/v3/ws');

      url.search = new URLSearchParams({
        token,
        sample_rate: '24000',
        speech_model: 'u3-rt-pro',
        encoding: 'pcm_s16le',
        language_detection: 'true',
      }).toString();
      await this.connect(url.toString());
      this.assertOpen();
      this.processor.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
        if (this.socket?.readyState === WebSocket.OPEN && !this.stopping) {
          if (this.socket.bufferedAmount > 240_000) {
            this.fail(new MeetingRecordingError('connectionFailed'));
            return;
          }

          this.socket.send(data);
        }
      };

      for (const stream of this.streams) {
        this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(this.processor);
      }

      this.processor.connect(this.context.destination);
      await this.context.resume();
      this.assertOpen();
      this.startedAt = Date.now();
      this.callbacks.onState('recording');
      this.billingTimer = setInterval(() => {
        void this.reportUsage().catch((error: unknown) => this.fail(error));
      }, 60_000);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private assertOpen() {
    if (this.closed) throw new DOMException('Recording cancelled', 'AbortError');
  }

  private addStream(stream: MediaStream) {
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      this.assertOpen();
    }

    this.streams.push(stream);
    stream.getTracks().forEach((track) =>
      track.addEventListener(
        'ended',
        () => {
          void this.stop();
        },
        { once: true }
      )
    );
  }

  private connect(url: string) {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => reject(new MeetingRecordingError('connectionFailed')), 15_000);
      let ready = false;
      const cancel = () => {
        clearTimeout(timeout);
        reject(new DOMException('Recording cancelled', 'AbortError'));
      };

      this.socket = socket;
      this.abort.signal.addEventListener('abort', cancel, { once: true });
      socket.onmessage = ({ data }: MessageEvent<string>) => {
        try {
          const message = JSON.parse(data) as {
            type?: string;
            transcript?: string;
            end_of_turn?: boolean;
            turn_order?: number;
            error?: string;
          };

          if (message.type === 'Begin') {
            ready = true;
            clearTimeout(timeout);
            this.abort.signal.removeEventListener('abort', cancel);
            resolve();
          } else if (message.type === 'Turn' && typeof message.transcript === 'string') {
            if (message.turn_order !== undefined && this.turns.has(message.turn_order)) return;
            this.partial = message.transcript;
            this.partialTurn = message.turn_order;
            this.callbacks.onPartial(this.partial);
            if (message.end_of_turn) {
              if (message.turn_order !== undefined) this.turns.add(message.turn_order);
              this.flushPartial();
            }
          } else if (message.type === 'Termination') {
            this.finishSocket?.();
            if (!this.stopping) void this.stop();
          } else if (message.type === 'Error' || message.error) {
            if (!ready) reject(new MeetingRecordingError('connectionFailed'));
            else this.fail(new MeetingRecordingError('connectionFailed'));
          }
        } catch {
          this.fail(new MeetingRecordingError('connectionFailed'));
        }
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        if (!ready) reject(new MeetingRecordingError('connectionFailed'));
        else this.fail(new MeetingRecordingError('connectionFailed'));
      };

      socket.onclose = () => {
        clearTimeout(timeout);
        this.finishSocket?.();
        if (!ready) reject(new MeetingRecordingError('connectionFailed'));
        else if (!this.stopping) this.fail(new MeetingRecordingError('connectionFailed'));
      };
    });
  }

  private fail(error: unknown) {
    if (this.stopping) return;
    this.callbacks.onError(error);
    void this.stop();
  }

  private flushPartial() {
    if (this.partial.trim()) this.callbacks.onTranscript(this.partial.trim(), this.partialTurn);
    this.partial = '';
    this.partialTurn = undefined;
    this.callbacks.onPartial('');
  }

  private reportUsage() {
    if (this.billing) return this.billing;
    if (!this.startedAt) return Promise.resolve();
    const seconds = Math.ceil(((this.stoppedAt || Date.now()) - this.startedAt) / 1000) - this.reportedSeconds;

    if (seconds <= 0) return Promise.resolve();
    this.callbacks.onPendingDuration(seconds);
    this.billing = reportMeetingDuration(this.workspaceId, seconds)
      .then((result) => {
        this.reportedSeconds += seconds;
        this.callbacks.onPendingDuration(0);
        if (result.remaining_duration === 0) throw new MeetingRecordingError('quotaExceeded');
      })
      .finally(() => {
        this.billing = undefined;
      });
    return this.billing;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closed = true;
    this.stoppedAt = Date.now();
    this.abort.abort();
    clearInterval(this.billingTimer);
    this.streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    this.processor?.disconnect();
    if (this.processor) this.processor.port.onmessage = null;
    // Persist before navigation unmounts the editor. A later finalized turn can
    // replace these words by turn order without creating a duplicate paragraph.
    this.flushPartial();
    this.callbacks.onState('stopping');
    this.stopping = (async () => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        const socket = this.socket;

        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);

          this.finishSocket = () => {
            clearTimeout(timer);
            resolve();
          };

          socket.send(JSON.stringify({ type: 'Terminate' }));
        });
      }

      this.socket?.close();
      this.flushPartial();
      await this.context?.close().catch(() => undefined);
      try {
        if (this.billing) await this.billing;
        await this.reportUsage();
      } catch (error) {
        this.callbacks.onError(error);
      }

      if (MeetingTranscription.activeSession === this) MeetingTranscription.activeSession = undefined;
      this.callbacks.onState('idle');
    })();
    return this.stopping;
  }
}
