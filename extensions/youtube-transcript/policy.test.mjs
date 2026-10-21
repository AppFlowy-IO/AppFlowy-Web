import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isAppFlowyOrigin } from './policy.js';

test('accepts only exact AppFlowy origins and loopback development origins', () => {
  for (const origin of ['https://beta.appflowy.cloud/app/test', 'https://test.appflowy.cloud', 'http://localhost:3000', 'http://127.0.0.1:3000']) {
    assert.equal(isAppFlowyOrigin(origin), true, origin);
  }
  for (const origin of ['https://beta.appflowy.cloud.attacker.test', 'https://evil.beta.appflowy.cloud', 'http://beta.appflowy.cloud', 'https://beta.appflowy.cloud:8443', 'https://user:secret@beta.appflowy.cloud', 'file:///tmp/appflowy', 'https://youtube.com', undefined]) {
    assert.equal(isAppFlowyOrigin(origin), false, String(origin));
  }
});

test('packaged permissions and media rules stay limited to AppFlowy, YouTube and Googlevideo', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
  const rules = JSON.parse(await readFile(new URL('./rules.json', import.meta.url), 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['declarativeNetRequestWithHostAccess']);
  assert.deepEqual(manifest.host_permissions, [
    'https://www.youtube.com/*', 'https://*.googlevideo.com/*',
    'https://beta.appflowy.cloud/*', 'https://test.appflowy.cloud/*', 'http://localhost/*', 'http://127.0.0.1/*',
  ]);
  assert.deepEqual(rules[0].condition.initiatorDomains, ['beta.appflowy.cloud', 'test.appflowy.cloud', 'localhost', '127.0.0.1']);
  const pattern = new RegExp(rules[0].condition.regexFilter);

  assert.equal(pattern.test('https://rr1---sn-a.googlevideo.com/videoplayback?id=123'), true);
  assert.equal(pattern.test('https://rr1.googlevideo.com.attacker.test/videoplayback'), false);
  assert.equal(pattern.test('https://rr1.googlevideo.com/other-endpoint'), false);
});

test('worker rejects generic fetch requests and closes helpers on cancellation or port loss', async () => {
  let connect;
  const closed = [];
  const previousChrome = globalThis.chrome;
  const removals = new Set();
  let nextTab = 20;

  globalThis.chrome = {
    runtime: { id: 'extension-id', onConnect: { addListener(callback) { connect = callback; } } },
    tabs: {
      create: async () => ({ id: ++nextTab }), remove: async (id) => { closed.push(id); },
      onRemoved: { addListener: (fn) => removals.add(fn), removeListener: (fn) => removals.delete(fn) },
    },
  };
  try {
    await import('./background.js');
    const makePort = (sender = {}) => {
      let message;
      let disconnect;
      const replies = [];
      const port = {
        name: 'appflowy-youtube-v1', sender: { id: 'extension-id', frameId: 0, tab: { id: 1 }, url: 'http://localhost:3000/app', origin: 'http://localhost:3000', ...sender },
        disconnected: false, replies,
        onMessage: { addListener(callback) { message = callback; } },
        onDisconnect: { addListener(callback) { disconnect = callback; } },
        postMessage(reply) { replies.push(reply); },
        disconnect() { this.disconnected = true; },
        send(value) { return message(value); },
        close() { disconnect(); },
      };

      connect(port);
      return port;
    };
    for (const sender of [{ url: 'https://evil.test' }, { origin: 'https://evil.test' }, { frameId: 1 }, { id: 'other-extension' }]) {
      assert.equal(makePort(sender).disconnected, true);
    }
    const port = makePort();

    await port.send({ id: 'f'.repeat(32), operation: 'fetch', request: { url: 'https://www.youtube.com/watch', headers: [['Cookie', 'private']] } });
    assert.deepEqual(port.replies.pop(), { id: 'f'.repeat(32), ok: false, error: 'blocked' });
    const id = 'a'.repeat(32);
    const pending = port.send({ id, operation: 'preparePlayback', request: { videoId: 'W2zbKF5z1cs' } });

    await port.send({ id, operation: 'cancel' });
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(port.replies[0], { id, ok: false, error: 'aborted' });
    assert.deepEqual(closed, [21]);
    const next = port.send({ id: 'b'.repeat(32), operation: 'preparePlayback', request: { videoId: 'W2zbKF5z1cs' } });

    port.close();
    await next;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(closed, [21, 22]);
    assert.equal(port.replies.length, 1);
    assert.equal(removals.size, 0);
  } finally { globalThis.chrome = previousChrome; }
});
