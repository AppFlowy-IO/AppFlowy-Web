import assert from 'node:assert/strict';
import test from 'node:test';

import { HELPER_PROTOCOL, bytesField, validatePlaybackCapture } from './playback-policy.js';
import { handlePlaybackPort, preparePlayback } from './playback.js';

const videoId = 'W2zbKF5z1cs';
const varint = (value) => {
  const bytes = [];

  while (value > 127) { bytes.push((value & 127) | 128); value = Math.floor(value / 128); }
  return [...bytes, value];
};
const field = (number, bytes) => [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes];
const makeCapture = (token = new Uint8Array(50).fill(99)) => ({
  videoId, title: 'Test video', duration: 130,
  streamingUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?id=requested-video&rn=2',
  expectedStreamingUrl: 'https://rr2---sn-test.googlevideo.com/videoplayback?id=requested-video',
  expectedConfig: btoa(String.fromCharCode(1, 2, 3, 4)),
  requestBody: btoa(String.fromCharCode(...field(5, [1, 2, 3, 4]), ...field(19, field(2, token)))),
  formats: [{ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, contentLength: '123456',
    url: 'https://signed.invalid/secret', arbitrary: 'private-data', cookie: 'browser-cookie' }],
});

test('accepts only requested content playback and strips unrelated player metadata', () => {
  const capture = makeCapture();
  const result = validatePlaybackCapture(capture, videoId);

  assert.equal(result.requestBody, capture.requestBody);
  assert.deepEqual(result.formats, [{ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, contentLength: '123456' }]);
  assert.equal('expectedStreamingUrl' in result, false);
  assert.throws(() => validatePlaybackCapture({ ...capture, videoId: 'other_video' }, videoId), /blocked/);
  assert.throws(() => validatePlaybackCapture({ ...capture, streamingUrl: capture.streamingUrl.replace('requested-video', 'advertisement') }, videoId), /blocked/);
  assert.throws(() => validatePlaybackCapture({ ...capture, expectedConfig: btoa('advertisement') }, videoId), /blocked/);
  assert.throws(() => validatePlaybackCapture({ ...capture, streamingUrl: 'https://googlevideo.com.attacker.test/videoplayback?id=requested-video' }, videoId), /blocked/);
  assert.throws(() => validatePlaybackCapture({ ...capture, streamingUrl: 'https://user:password@rr1.googlevideo.com/videoplayback?id=requested-video' }, videoId), /blocked/);
});

test('waits for a non-cold proof, rejects oversized and malformed protobuf messages', () => {
  const cold = new Uint8Array(91).fill(90);

  cold[0] = 34;
  cold[1] = cold.length - 2;
  assert.throws(() => validatePlaybackCapture(makeCapture(cold), videoId), /pending/);
  assert.throws(() => validatePlaybackCapture(makeCapture(new Uint8Array(10)), videoId), /pending/);
  assert.throws(() => validatePlaybackCapture({ ...makeCapture(), requestBody: 'A'.repeat(400_000) }, videoId), /blocked/);
  assert.throws(() => bytesField(new Uint8Array([42, 127, 1]), 5), /blocked/);
  assert.throws(() => bytesField(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]), 5), /blocked/);
});

function fakeBrowser(create) {
  const removedListeners = new Set();
  const created = [];
  const closed = [];
  const chrome = {
    runtime: { id: 'our-extension' },
    tabs: {
      create: async (options) => { created.push(options); return create ? create(options) : { id: 123 }; },
      remove: async (id) => { closed.push(id); for (const listener of removedListeners) listener(id); },
      onRemoved: { addListener: (listener) => removedListeners.add(listener), removeListener: (listener) => removedListeners.delete(listener) },
    },
  };
  const port = (sender = {}) => {
    let onMessage;
    let onDisconnect;
    const value = {
      name: HELPER_PROTOCOL,
      sender: { id: chrome.runtime.id, frameId: 0, tab: { id: 123 }, url: created[0].url, origin: 'https://www.youtube.com', ...sender },
      disconnected: false,
      onMessage: { addListener: (listener) => { onMessage = listener; } },
      onDisconnect: { addListener: (listener) => { onDisconnect = listener; } },
      disconnect() { this.disconnected = true; onDisconnect?.(); },
      send: (message) => onMessage?.(message),
    };

    handlePlaybackPort(value);
    return value;
  };

  return { chrome, created, closed, port, removedListeners };
}

test('only the worker-owned helper tab can resolve a playback request, then it closes', async () => {
  const previousChrome = globalThis.chrome;
  const browser = fakeBrowser();

  globalThis.chrome = browser.chrome;
  try {
    const promise = preparePlayback(7, videoId, new AbortController().signal);

    assert.equal(browser.created[0].openerTabId, 7);
    assert.equal(browser.created[0].active, true);
    for (const sender of [{ id: 'foreign-extension' }, { frameId: 1 }, { origin: 'https://attacker.test' }]) {
      assert.equal(browser.port(sender).disconnected, true);
    }
    const attacker = browser.port({ tab: { id: 999 } });

    await attacker.send({ operation: 'capture', capture: makeCapture() });
    assert.equal(attacker.disconnected, true);
    assert.equal(browser.closed.length, 0);
    const helper = browser.port();

    await helper.send({ operation: 'ready' });
    await helper.send({ operation: 'capture', capture: { ...makeCapture(), expectedConfig: btoa('ad') } });
    assert.equal(browser.closed.length, 0);
    await helper.send({ operation: 'capture', capture: makeCapture() });
    const result = await promise;

    assert.equal(result.videoId, videoId);
    assert.deepEqual(browser.closed, [123]);
    assert.equal(helper.disconnected, true);
    assert.equal(browser.removedListeners.size, 0);
  } finally { globalThis.chrome = previousChrome; }
});

test('Stop before tab creation finishes still closes the later-created owned tab', async () => {
  const previousChrome = globalThis.chrome;
  let resolveCreate;
  const browser = fakeBrowser(() => new Promise((resolve) => { resolveCreate = resolve; }));

  globalThis.chrome = browser.chrome;
  try {
    const controller = new AbortController();
    const promise = preparePlayback(7, videoId, controller.signal);
    const rejection = assert.rejects(promise, { name: 'AbortError' });

    controller.abort();
    await rejection;
    resolveCreate({ id: 321 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(browser.closed, [321]);
    assert.equal(browser.removedListeners.size, 0);
  } finally { globalThis.chrome = previousChrome; }
});

test('closing or navigating the helper rejects the operation and cleans up', async () => {
  const previousChrome = globalThis.chrome;
  const browser = fakeBrowser();

  globalThis.chrome = browser.chrome;
  try {
    const promise = preparePlayback(7, videoId, new AbortController().signal);
    const rejection = assert.rejects(promise, /unavailable/);
    const helper = browser.port();

    await helper.send({ operation: 'ready' });
    helper.disconnect();
    await rejection;
    assert.deepEqual(browser.closed, [123]);
    assert.equal(browser.removedListeners.size, 0);
  } finally { globalThis.chrome = previousChrome; }
});
