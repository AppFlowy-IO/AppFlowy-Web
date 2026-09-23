import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MeetingTranscription } from '@/application/integrations/meeting-transcription';
import { getMeetingStreamingToken, reportMeetingDuration } from '@/application/services/js-services/http/meeting-api';
import { SubscriptionInterval, SubscriptionPlan } from '@/application/types';

import { AIMeetingRecording } from '../AIMeetingRecording';

const mockEditor = { sharedRoot: {} };
const mockTranslate = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
const mockGetSubscriptions = jest.fn();
let mockHosted = true;
let workspaceSequence = 0;
let mockMeetingData: Record<string, unknown>;

jest.mock('slate-react', () => ({ useSlateStatic: () => mockEditor }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ getSubscriptions: mockGetSubscriptions }),
}));
jest.mock('@/utils/subscription', () => ({
  ...jest.requireActual('@/utils/subscription'),
  isAppFlowyHosted: () => mockHosted,
}));
jest.mock('@/application/slate-yjs/utils/yjs', () => ({
  getBlock: () => ({
    get: () => JSON.stringify(mockMeetingData),
    set: (_key: string, value: string) => {
      mockMeetingData = JSON.parse(value);
    },
  }),
  dataStringTOJson: (value: string) => JSON.parse(value),
}));
jest.mock('@/application/slate-yjs/utils/convert', () => ({ slateContentInsertToYData: jest.fn() }));
jest.mock('@/application/services/js-services/http/meeting-api', () => ({
  getMeetingStreamingToken: jest.fn(),
  reportMeetingDuration: jest.fn(),
}));

function stream() {
  const audio = { stop: jest.fn(), addEventListener: jest.fn() };

  return { audio, getAudioTracks: () => [audio], getTracks: () => [audio] };
}

class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  constructor() {
    void Promise.resolve().then(() => this.message('Begin'));
  }
  message(type: string) {
    this.onmessage?.({ data: JSON.stringify({ type }) });
  }
  send(data: unknown) {
    if (data === JSON.stringify({ type: 'Terminate' })) void Promise.resolve().then(() => this.message('Termination'));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
};

describe('AI meeting recording attempts', () => {
  const getUserMedia = jest.fn();
  let microphone: ReturnType<typeof stream>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHosted = true;
    workspaceSequence += 1;
    mockGetSubscriptions.mockReset().mockResolvedValue([]);
    mockMeetingData = {};
    microphone = stream();
    getUserMedia.mockReset().mockResolvedValue(microphone);
    jest.mocked(getMeetingStreamingToken).mockReset().mockResolvedValue({ token: 'temporary', expires_in_seconds: 60 });
    jest.mocked(reportMeetingDuration).mockReset().mockResolvedValue({ remaining_duration: 3600 });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.assign(globalThis, {
      AudioContext: class {
        audioWorklet = { addModule: jest.fn().mockResolvedValue(undefined) };
        destination = {};
        createMediaStreamSource = () => ({ connect: jest.fn() });
        resume = async () => undefined;
        close = async () => undefined;
      },
      AudioWorkletNode: class {
        port = { onmessage: null };
        connect = jest.fn();
        disconnect = jest.fn();
      },
      MediaStream: class {},
      WebSocket: FakeSocket,
    });
  });

  afterEach(async () => {
    cleanup();
    // Also release a session if a regression has orphaned the component's ref.
    await (MeetingTranscription as unknown as { activeSession?: MeetingTranscription }).activeSession?.stop();
  });

  function mount() {
    return render(
      <AIMeetingRecording
        workspaceId={`workspace-${workspaceSequence}`}
        viewId='page'
        blockId='meeting'
        transcriptBlockId='transcript'
        onFinished={jest.fn()}
      />
    );
  }

  async function start() {
    fireEvent.click(screen.getByText('document.aiMeeting.startTranscribing'));
    await act(async () => {
      fireEvent.click(screen.getByText('document.aiMeeting.microphoneOnly'));
      await flush();
    });
  }

  async function stop() {
    await act(async () => {
      fireEvent.click(screen.getByText('document.aiMeeting.stopTranscribing'));
      await flush();
    });
  }

  it.each([
    [SubscriptionPlan.Free, 'server'],
    [SubscriptionPlan.Free, 'local'],
    [SubscriptionPlan.Pro, 'server'],
    [SubscriptionPlan.Team, 'server'],
    [SubscriptionPlan.AIMax, 'server'],
    [SubscriptionPlan.AIMax, 'local'],
  ])('shows Pro guidance only for Free transcription exhaustion (%s, %s)', async (plan, source) => {
    const serverMessage = 'No transcription time remaining: 7200/7200 seconds used';

    mockGetSubscriptions.mockResolvedValue([{
      plan, currency: 'USD', price_cents: 2000, recurring_interval: SubscriptionInterval.Month,
    }]);
    if (source === 'server') {
      jest.mocked(getMeetingStreamingToken).mockRejectedValueOnce({ code: 1129, message: serverMessage });
    } else {
      jest.mocked(reportMeetingDuration).mockResolvedValueOnce({ remaining_duration: 0 });
    }

    mount();
    expect(mockGetSubscriptions).not.toHaveBeenCalled();
    await start();
    await waitFor(() => expect(mockGetSubscriptions).toHaveBeenCalledTimes(1));

    if (plan === SubscriptionPlan.Free) {
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(
        'Ask the workspace owner to upgrade to Pro for more transcription time.'
      ));
    } else {
      expect(screen.getByRole('alert').textContent).toBe(
        source === 'server' ? serverMessage : 'document.aiMeeting.recordingErrors.quotaExceeded'
      );
    }

    expect(microphone.audio.stop).toHaveBeenCalled();
  });

  it.each(['self-hosted', 'unavailable', 'unknown'])('preserves quota guidance when the plan is %s', async (kind) => {
    const serverMessage = 'Your transcription allowance is exhausted';
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockHosted = kind !== 'self-hosted';
    if (kind === 'unavailable') mockGetSubscriptions.mockRejectedValue(new Error('Billing unavailable'));
    if (kind === 'unknown') mockGetSubscriptions.mockResolvedValue(undefined);
    jest.mocked(getMeetingStreamingToken).mockRejectedValueOnce({ code: 1129, message: serverMessage });
    mount();
    await start();

    expect(screen.getByRole('alert').textContent).toBe(serverMessage);
    if (kind === 'self-hosted') expect(mockGetSubscriptions).not.toHaveBeenCalled();
    else await waitFor(() => expect(errorLog).toHaveBeenCalled());
    expect(screen.getByRole('alert').textContent).toBe(serverMessage);
    errorLog.mockRestore();
  });

  it('keeps a newer recording controllable when cancelled microphone permission arrives late', async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstMicrophone = stream();

    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const view = mount();

    await start();
    expect(screen.getByRole('status').textContent).toBe('document.aiMeeting.recordingState.starting');
    await stop();
    await start();
    await act(async () => {
      resolveFirst(firstMicrophone);
      await flush();
    });
    expect(screen.getByRole('status').textContent).toBe('document.aiMeeting.recordingState.recording');
    expect(firstMicrophone.audio.stop).toHaveBeenCalled();
    expect(microphone.audio.stop).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    view.unmount();
    await flush();
    expect(microphone.audio.stop).toHaveBeenCalled();
  });

  it('ignores late quota callbacks from a cancelled startup', async () => {
    let resolveFirst!: (value: { remaining_duration: number }) => void;

    jest.mocked(reportMeetingDuration).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    mount();
    await start();
    await stop();
    microphone = stream();
    getUserMedia.mockResolvedValue(microphone);
    await start();
    mockMeetingData.pending_billing_duration = 17;
    await act(async () => {
      resolveFirst({ remaining_duration: 3600 });
      await flush();
    });

    expect(screen.getByRole('status').textContent).toBe('document.aiMeeting.recordingState.recording');
    expect(mockMeetingData.pending_billing_duration).toBe(17);
    await stop();
    expect(microphone.audio.stop).toHaveBeenCalled();
  });

  it('still reports the current startup failure and permits retry', async () => {
    jest.mocked(getMeetingStreamingToken).mockRejectedValueOnce(new Error('Token unavailable'));
    mount();
    await start();
    expect(screen.getByRole('alert').textContent).toContain('Token unavailable');
    expect(microphone.audio.stop).toHaveBeenCalled();
    await start();
    expect(screen.getByRole('status').textContent).toBe('document.aiMeeting.recordingState.recording');
    expect(screen.queryByRole('alert')).toBeNull();
    await stop();
  });
});
