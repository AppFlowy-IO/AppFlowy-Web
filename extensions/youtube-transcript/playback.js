import { HELPER_PROTOCOL, validVideoId, validatePlaybackCapture } from './playback-policy.js';

const helpers = new Map();

export function preparePlayback(openerTabId, videoId, signal) {
  if (!validVideoId(videoId) || !Number.isInteger(openerTabId)) return Promise.reject(new Error('blocked'));
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

  return new Promise((resolve, reject) => {
    const helper = { videoId, nonce, tabId: undefined, done: false, port: undefined, tabReady: undefined, finish: undefined };
    const close = () => {
      if (helper.tabId !== undefined) void chrome.tabs.remove(helper.tabId).catch(() => undefined);
      try { helper.port?.disconnect(); } catch { /* The helper tab already closed. */ }
    };
    const finish = (error, capture) => {
      if (helper.done) return;
      helper.done = true;
      helpers.delete(nonce);
      signal.removeEventListener('abort', abort);
      chrome.tabs.onRemoved.removeListener(removed);
      close();
      if (error) reject(error);
      else resolve(capture);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const removed = (tabId) => {
      if (tabId === helper.tabId) finish(new Error('unavailable'));
    };

    helper.finish = finish;
    helpers.set(nonce, helper);
    signal.addEventListener('abort', abort, { once: true });
    chrome.tabs.onRemoved.addListener(removed);
    helper.tabReady = chrome.tabs.create({
      url: `https://www.youtube.com/watch?v=${videoId}&autoplay=1&appflowy_transcript=${nonce}`,
      active: true, openerTabId,
    }).then((tab) => {
      if (!Number.isInteger(tab.id)) throw new Error('failed');
      helper.tabId = tab.id;
      if (helper.done) close();
      return tab.id;
    }).catch((error) => { finish(new Error('failed')); throw error; });
    // A tab can fail before any helper content script connects.
    void helper.tabReady.catch(() => undefined);
  });
}

export function handlePlaybackPort(port) {
  if (port.name !== HELPER_PROTOCOL) return false;
  const sender = port.sender;
  let url;

  try { url = new URL(sender?.url); } catch { port.disconnect(); return true; }
  const helper = helpers.get(url.searchParams.get('appflowy_transcript'));

  if (!helper || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab ||
    sender.origin !== 'https://www.youtube.com' || url.origin !== 'https://www.youtube.com' ||
    url.pathname !== '/watch' || url.searchParams.get('v') !== helper.videoId) {
    port.disconnect();
    return true;
  }

  port.onMessage.addListener(async (message) => {
    try {
      const tabId = await helper.tabReady;

      if (helper.done || tabId !== sender.tab.id || (helper.port && helper.port !== port)) {
        port.disconnect();
        return;
      }

      helper.port = port;
      if (message?.operation === 'ready') return;
      if (message?.operation !== 'capture') return;
      const capture = validatePlaybackCapture(message.capture, helper.videoId);

      helper.finish(undefined, capture);
    } catch {
      // Early/cold tokens and advertisement requests are ignored; wait for content playback.
    }
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (helper.port === port && !helper.done) helper.finish(new Error('unavailable'));
  });
  return true;
}
