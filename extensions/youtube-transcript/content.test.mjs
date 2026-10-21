import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('rejects cross-origin/frame messages and ignores old port events after navigation', async () => {
  const listeners = new Map();
  const posted = [];
  const ports = [];
  const origin = 'http://localhost:3000';
  const window = {
    location: { origin },
    addEventListener: (name, listener) => listeners.set(name, listener),
    postMessage: (data, target) => { assert.equal(target, origin); posted.push(data); },
  };
  const chrome = { runtime: { connect: () => {
    const port = {
      sent: [], disconnected: false,
      onMessage: { addListener(listener) { port.receive = listener; } },
      onDisconnect: { addListener(listener) { port.didDisconnect = listener; } },
      postMessage(message) { this.sent.push(message); },
      disconnect() { this.disconnected = true; },
    };

    ports.push(port);
    return port;
  } } };
  const source = await readFile(new URL('./content.js', import.meta.url), 'utf8');

  vm.runInNewContext(source, { window, chrome });
  const request = { protocol: 'appflowy-youtube-v1', direction: 'page', id: 'a'.repeat(32), operation: 'ping' };
  const message = (data, source = window, eventOrigin = origin) => listeners.get('message')({ source, origin: eventOrigin, data });

  message(request, {}, origin);
  message(request, window, 'https://evil.test');
  assert.equal(ports.length, 0);
  message(request);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].sent.length, 1);
  listeners.get('pagehide')();
  assert.equal(ports[0].disconnected, true);
  assert.equal(posted[0].error, 'unavailable');
  const next = { ...request, id: 'b'.repeat(32) };

  message(next);
  assert.equal(ports.length, 2);
  ports[0].didDisconnect();
  ports[0].receive({ id: request.id, ok: true });
  assert.equal(posted.length, 1);
  ports[1].receive({ id: next.id, ok: true });
  assert.equal(posted.length, 2);
  assert.equal(posted[1].id, next.id);
  assert.equal(posted[1].ok, true);
});
