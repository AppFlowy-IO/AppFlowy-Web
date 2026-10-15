/** @jest-environment node */
import { webcrypto } from 'node:crypto';

import { detectYoutubeExtension, isYoutubeExtensionAvailable, prepareYoutubePlayback } from '../youtube-extension';

const origin = 'http://localhost:3000';
const protocol = 'appflowy-youtube-v1';

describe('YouTube extension browser bridge', () => {
  const originalWindow = global.window;
  const originalCrypto = global.crypto;
  let listeners: Set<(event: MessageEvent) => void>;
  let sent: Record<string, unknown>[];
  let fakeWindow: Window;
  const deliver = (data: Record<string, unknown>, eventOrigin = origin, source?: object) => {
    const event = { source: source ?? fakeWindow, origin: eventOrigin, data } as MessageEvent;

    for (const listener of listeners) listener(event);
  };
  const respond = (request: Record<string, unknown>, data: Record<string, unknown>) => {
    deliver({ protocol, direction: 'extension', id: request.id, ...data });
  };
  const waitForRequest = async () => {
    for (let tries = 0; tries < 20 && !sent.length; tries++) await Promise.resolve();
    expect(sent.length).toBeGreaterThan(0);
    return sent[0];
  };

  beforeEach(() => {
    listeners = new Set();
    sent = [];
    fakeWindow = {
      location: { origin },
      postMessage: (data: Record<string, unknown>, target: string) => {
        expect(target).toBe(origin);
        sent.push(data);
      },
      addEventListener: (_: string, callback: (event: MessageEvent) => void) => listeners.add(callback),
      removeEventListener: (_: string, callback: (event: MessageEvent) => void) => listeners.delete(callback),
    } as unknown as Window;
    global.window = fakeWindow;
    Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto });
  });
  afterEach(() => {
    global.window = originalWindow;
    Object.defineProperty(global, 'crypto', { configurable: true, value: originalCrypto });
    jest.useRealTimers();
  });

  it('requires a ping from this window and origin; a marker alone does not establish availability', async () => {
    expect(isYoutubeExtensionAvailable()).toBe(false);
    Object.assign(fakeWindow, { appflowyYoutube: { version: 1 } });
    expect(isYoutubeExtensionAvailable()).toBe(true);
    const result = detectYoutubeExtension();
    const request = await waitForRequest();
    const reply = { protocol, direction: 'extension', id: request.id, ok: true, version: 1 };

    deliver(reply, 'https://evil.test');
    deliver(reply, origin, {});
    deliver({ ...reply, id: 'other-request' });
    expect(listeners.size).toBe(1);
    deliver(reply);
    await expect(result).resolves.toBe(true);
    expect(listeners.size).toBe(0);
  });

  it('reports a missing extension after a bounded ping timeout', async () => {
    jest.useFakeTimers();
    const result = detectYoutubeExtension();

    jest.advanceTimersByTime(1800);
    await expect(result).resolves.toBe(false);
    expect(sent[1]).toMatchObject({ operation: 'cancel', id: sent[0].id });
    expect(listeners.size).toBe(0);
  });

  it('requests playback only for a video ID and preserves bounded native playback metadata', async () => {
    const controller = new AbortController();
    const result = prepareYoutubePlayback('W2zbKF5z1cs', controller.signal);
    const message = await waitForRequest();
    const playback = {
      videoId: 'W2zbKF5z1cs', title: 'Test video', duration: 130,
      streamingUrl: 'https://rr1.googlevideo.com/videoplayback?id=public-video', requestBody: btoa('request'),
      formats: [{ itag: 140, mimeType: 'audio/mp4', bitrate: 128000, isDefaultAudioTrack: true }],
    };

    expect(message).toMatchObject({ operation: 'preparePlayback', request: { videoId: 'W2zbKF5z1cs' } });
    respond(message, { ok: true, playback });
    await expect(result).resolves.toEqual(playback);
    expect(listeners.size).toBe(0);
  });

  it('forwards Stop while the worker prepares native playback', async () => {
    const controller = new AbortController();
    const result = prepareYoutubePlayback('W2zbKF5z1cs', controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const message = await waitForRequest();

    controller.abort();
    await rejection;
    expect(sent[1]).toMatchObject({ operation: 'cancel', id: message.id });
  });

  it('rejects mismatched playback results before media downloading', async () => {
    const result = prepareYoutubePlayback('W2zbKF5z1cs', new AbortController().signal);
    const rejection = expect(result).rejects.toMatchObject({ code: 'failed' });
    const message = await waitForRequest();

    respond(message, { ok: true, playback: { videoId: 'other_video', formats: [] } });
    await rejection;
    await expect(prepareYoutubePlayback('https://attacker.test', new AbortController().signal)).rejects.toMatchObject({ code: 'blocked' });
    expect(sent).toHaveLength(1);
  });

  it('bounds playback preparation and cancels the helper when the bridge times out', async () => {
    jest.useFakeTimers();
    const result = prepareYoutubePlayback('W2zbKF5z1cs', new AbortController().signal);
    const rejection = expect(result).rejects.toMatchObject({ code: 'timeout' });

    await waitForRequest();
    jest.advanceTimersByTime(95_000);
    await rejection;
    expect(sent[1]).toMatchObject({ operation: 'cancel' });
    expect(listeners.size).toBe(0);
  });

  it('does not open a helper after cancellation', async () => {
    const controller = new AbortController();

    controller.abort();
    await expect(prepareYoutubePlayback('W2zbKF5z1cs', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toHaveLength(0);
  });

  it('reports worker failures without exposing diagnostic payloads or signed URLs', async () => {
    const result = prepareYoutubePlayback('W2zbKF5z1cs', new AbortController().signal);
    const rejection = expect(result).rejects.toMatchObject({ code: 'failed', message: 'YouTube extension: failed' });
    const message = await waitForRequest();

    respond(message, { ok: false, error: 'https://signed.invalid/?secret=token' });
    await rejection;
  });
});
