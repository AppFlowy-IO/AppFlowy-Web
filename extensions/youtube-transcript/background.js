import {
  PROTOCOL, MAX_CONCURRENT_REQUESTS, REQUEST_TIMEOUT_MS,
  isAppFlowyOrigin, validRequestId,
} from './policy.js';
import { handlePlaybackPort, preparePlayback } from './playback.js';

chrome.runtime.onConnect.addListener((port) => {
  if (handlePlaybackPort(port)) return;
  const sender = port.sender;

  if (port.name !== PROTOCOL || sender?.id !== chrome.runtime.id || sender.frameId !== 0 ||
    !sender.tab || !isAppFlowyOrigin(sender.url) || (sender.origin && !isAppFlowyOrigin(sender.origin))) {
    port.disconnect();
    return;
  }

  const active = new Map();
  let disconnected = false;
  const reply = (message) => {
    if (!disconnected) {
      try { port.postMessage(message); } catch { /* The tab has closed. */ }
    }
  };

  port.onDisconnect.addListener(() => {
    disconnected = true;
    for (const controller of active.values()) controller.abort();
    active.clear();
  });
  port.onMessage.addListener(async (message) => {
    if (!message || !validRequestId(message.id)) return;
    const { id, operation } = message;

    if (operation === 'cancel') {
      active.get(id)?.abort();
      return;
    }

    if (operation === 'ping') {
      reply({ id, ok: true, version: 1 });
      return;
    }

    if (operation !== 'preparePlayback' || active.has(id) || active.size >= MAX_CONCURRENT_REQUESTS) {
      reply({ id, ok: false, error: 'blocked' });
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    active.set(id, controller);
    try {
      const playback = await preparePlayback(sender.tab.id, message.request?.videoId, controller.signal);

      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      reply({ id, ok: true, playback });
    } catch (error) {
      // Never return signed URLs, request bodies, browser errors, or token values to diagnostics.
      reply({ id, ok: false, error: timedOut ? 'timeout' : controller.signal.aborted ? 'aborted' :
        ['blocked', 'too-large'].includes(error?.message) ? error.message : 'failed' });
    } finally {
      clearTimeout(timer);
      active.delete(id);
    }
  });
});
