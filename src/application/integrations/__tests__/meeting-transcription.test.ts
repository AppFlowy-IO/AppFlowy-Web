import { getMeetingStreamingToken, reportMeetingDuration } from '@/application/services/js-services/http/meeting-api';

import { MeetingTranscription } from '../meeting-transcription';

jest.mock('@/application/services/js-services/http/meeting-api', () => ({
  getMeetingStreamingToken: jest.fn(),
  reportMeetingDuration: jest.fn(),
}));
const api = jest.mocked({ getMeetingStreamingToken, reportMeetingDuration });
const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};
const track = () => ({ stop: jest.fn(), addEventListener: jest.fn() });
const stream = (hasAudio = true) => {
  const audio = track();
  const video = track();

  return { audio, video, getAudioTracks: () => (hasAudio ? [audio] : []), getTracks: () => [audio, video] };
};

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  readyState = 1;
  bufferedAmount = 0;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  send = jest.fn((data: unknown) => {
    if (data === JSON.stringify({ type: 'Terminate' }))
      void Promise.resolve().then(() => this.message({ type: 'Termination' }));
  });
  close = jest.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });
  constructor() {
    FakeSocket.last = this;
    void Promise.resolve().then(() => this.message({ type: 'Begin' }));
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe('browser meeting transcription resource lifecycle', () => {
  const getUserMedia = jest.fn();
  const getDisplayMedia = jest.fn();
  const closeContext = jest.fn();
  const disconnect = jest.fn();
  const callbacks = {
    onState: jest.fn(),
    onPartial: jest.fn(),
    onTranscript: jest.fn(),
    onError: jest.fn(),
    onPendingDuration: jest.fn(),
  };
  let session: MeetingTranscription;
  let microphone: ReturnType<typeof stream>;
  let display: ReturnType<typeof stream>;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-21T08:00:00Z'));
    jest.clearAllMocks();
    microphone = stream();
    display = stream();
    getUserMedia.mockResolvedValue(microphone);
    getDisplayMedia.mockResolvedValue(display);
    api.getMeetingStreamingToken.mockResolvedValue({ token: 'temporary-token', expires_in_seconds: 60 });
    api.reportMeetingDuration.mockResolvedValue({ remaining_duration: 3600 });
    closeContext.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, getDisplayMedia } });
    Object.assign(globalThis, {
      AudioContext: class {
        audioWorklet = { addModule: jest.fn().mockResolvedValue(undefined) };
        destination = {};
        createMediaStreamSource = () => ({ connect: jest.fn() });
        resume = async () => undefined;
        close = closeContext;
      },
      AudioWorkletNode: class {
        port = { onmessage: null };
        connect = jest.fn();
        disconnect = disconnect;
      },
      MediaStream: class {},
      WebSocket: FakeSocket,
    });
    session = new MeetingTranscription('workspace', callbacks);
  });
  afterEach(async () => {
    await session.stop();
    jest.useRealTimers();
  });

  it('captures only on start, streams final turns once and retains partial speech when stopped', async () => {
    expect(getUserMedia).not.toHaveBeenCalled();
    await session.start('meeting');
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(callbacks.onState).toHaveBeenLastCalledWith('recording');
    const socket = FakeSocket.last;

    socket.message({ type: 'Turn', turn_order: 0, transcript: 'Final words.', end_of_turn: true });
    socket.message({ type: 'Turn', turn_order: 0, transcript: 'Final words.', end_of_turn: true });
    socket.message({ type: 'Turn', turn_order: 1, transcript: 'Still speaking', end_of_turn: false });
    jest.setSystemTime(Date.now() + 10_000);
    await session.stop();
    expect(callbacks.onTranscript.mock.calls).toEqual([
      ['Final words.', 0],
      ['Still speaking', 1],
    ]);
    expect(api.reportMeetingDuration).toHaveBeenLastCalledWith('workspace', 10);
    expect(microphone.audio.stop).toHaveBeenCalled();
    expect(display.video.stop).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
    expect(callbacks.onState).toHaveBeenLastCalledWith('idle');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects a shared source without audio and releases every track', async () => {
    display = stream(false);
    getDisplayMedia.mockResolvedValue(display);
    await expect(session.start('meeting')).rejects.toMatchObject({ code: 'noSharedAudio' });
    expect(display.video.stop).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(api.getMeetingStreamingToken).not.toHaveBeenCalled();
  });

  it('accepts the finalized last turn after preserving partial speech during stop', async () => {
    await session.start('microphone');
    const socket = FakeSocket.last;

    socket.message({ type: 'Turn', turn_order: 0, transcript: 'See you', end_of_turn: false });
    socket.send.mockImplementation(() => {
      void Promise.resolve().then(() => {
        socket.message({ type: 'Turn', turn_order: 0, transcript: 'See you tomorrow.', end_of_turn: true });
        socket.message({ type: 'Termination' });
      });
    });
    await session.stop();
    expect(callbacks.onTranscript.mock.calls).toEqual([
      ['See you', 0],
      ['See you tomorrow.', 0],
    ]);
  });

  it('releases late microphone permission results after cancellation', async () => {
    let resolve!: (value: unknown) => void;

    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const started = session.start('microphone');
    const result = expect(started).rejects.toMatchObject({ name: 'AbortError' });

    await session.stop();
    resolve(microphone);
    await result;
    expect(microphone.audio.stop).toHaveBeenCalled();
    expect(api.getMeetingStreamingToken).not.toHaveBeenCalled();
  });

  it('stops capture when the server refuses a token and allows a later session', async () => {
    api.getMeetingStreamingToken.mockRejectedValueOnce(new Error('Not configured'));
    await expect(session.start('microphone')).rejects.toThrow('Not configured');
    expect(microphone.audio.stop).toHaveBeenCalled();
    session = new MeetingTranscription('workspace', callbacks);
    await session.start('microphone');
    expect(callbacks.onState).toHaveBeenLastCalledWith('recording');
  });

  it('rejects a second recording while the first owns capture', async () => {
    await session.start('microphone');
    const other = new MeetingTranscription('workspace', callbacks);

    await expect(other.start('microphone')).rejects.toMatchObject({ code: 'alreadyRecording' });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('reports outstanding usage before starting and stops when the quota runs out', async () => {
    api.reportMeetingDuration
      .mockResolvedValueOnce({ remaining_duration: 60 })
      .mockResolvedValue({ remaining_duration: 0 });
    await session.start('microphone', 12);
    expect(api.reportMeetingDuration).toHaveBeenNthCalledWith(1, 'workspace', 12);
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(microphone.audio.stop).toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'quotaExceeded' }));
    expect(api.reportMeetingDuration).toHaveBeenLastCalledWith('workspace', 60);
  });
});
