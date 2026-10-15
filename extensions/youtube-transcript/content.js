(() => {
  const protocol = 'appflowy-youtube-v1';
  const active = new Set();
  let port;

  const post = (message) => window.postMessage({ ...message, protocol, direction: 'extension' }, window.location.origin);
  const connect = () => {
    if (port) return port;
    const connection = chrome.runtime.connect({ name: protocol });

    port = connection;
    connection.onMessage.addListener((message) => {
      if (port !== connection) return;
      if (!active.delete(message.id)) return;
      post(message);
    });
    connection.onDisconnect.addListener(() => {
      // Accessing lastError consumes Chrome's diagnostic without printing request details.
      void chrome.runtime.lastError;
      if (port !== connection) return;
      port = undefined;
      for (const id of active) post({ id, ok: false, error: 'unavailable' });
      active.clear();
    });
    return port;
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;

    if (!message || message.protocol !== protocol || message.direction !== 'page' ||
      typeof message.id !== 'string' || !/^[a-f0-9]{32}$/.test(message.id)) return;
    if (message.operation === 'cancel') {
      if (active.delete(message.id)) port?.postMessage({ id: message.id, operation: 'cancel' });
      return;
    }

    if (!['ping', 'preparePlayback'].includes(message.operation) || active.has(message.id)) return;
    if (active.size >= 4) {
      post({ id: message.id, ok: false, error: 'blocked' });
      return;
    }

    try {
      active.add(message.id);
      connect().postMessage({ id: message.id, operation: message.operation, request: message.request });
    } catch {
      active.delete(message.id);
      post({ id: message.id, ok: false, error: 'unavailable' });
    }
  });
  window.addEventListener('pagehide', () => {
    const previous = port;

    port = undefined;
    for (const id of active) post({ id, ok: false, error: 'unavailable' });
    active.clear();
    previous?.disconnect();
  });
})();
