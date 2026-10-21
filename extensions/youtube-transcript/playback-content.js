(() => {
  const protocol = 'appflowy-youtube-playback-v1';
  const nonce = new URL(location.href).searchParams.get('appflowy_transcript');

  if (!nonce || !/^[a-f0-9]{32}$/.test(nonce) || window.top !== window) return;
  const port = chrome.runtime.connect({ name: protocol });
  let connected = true;
  const heartbeat = setInterval(() => {
    if (connected) {
      try { port.postMessage({ operation: 'heartbeat' }); } catch { clearInterval(heartbeat); }
    }
  }, 10_000);

  port.onDisconnect.addListener(() => {
    connected = false;
    clearInterval(heartbeat);
    void chrome.runtime.lastError;
    window.postMessage({ protocol, nonce, operation: 'stop' }, location.origin);
  });
  window.addEventListener('message', (event) => {
    if (!connected || event.source !== window || event.origin !== 'https://www.youtube.com') return;
    const message = event.data;

    if (!message || message.protocol !== protocol || message.nonce !== nonce || message.operation !== 'capture' ||
      typeof message.capture?.requestBody !== 'string' || message.capture.requestBody.length > 349_528 ||
      !Array.isArray(message.capture.formats) || message.capture.formats.length > 256) return;
    try { port.postMessage({ operation: 'capture', capture: message.capture }); } catch { connected = false; }
  });
  port.postMessage({ operation: 'ready' });
  window.addEventListener('pagehide', () => { connected = false; clearInterval(heartbeat); port.disconnect(); });
})();
