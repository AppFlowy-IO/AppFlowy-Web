(() => {
  const protocol = 'appflowy-youtube-playback-v1';
  const nonce = new URL(location.href).searchParams.get('appflowy_transcript');
  const videoId = new URL(location.href).searchParams.get('v');

  if (!nonce || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-zA-Z0-9_-]{11}$/.test(videoId || '') || window.top !== window) return;
  const maximum = 256 * 1024;
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const xhrUrls = new WeakMap();
  let stopped = false;
  let pending = 0;

  const base64 = (bytes) => {
    let result = '';

    for (let index = 0; index < bytes.length; index += 8192) result += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return btoa(result);
  };
  const bodyBytes = async (body) => {
    if (body instanceof ArrayBuffer) return body.byteLength <= maximum ? new Uint8Array(body) : undefined;
    if (ArrayBuffer.isView(body)) return body.byteLength <= maximum ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined;
    if (body instanceof Blob && body.size <= maximum) return new Uint8Array(await body.arrayBuffer());
    if (!(body instanceof ReadableStream)) return;
    const reader = body.getReader();
    const chunks = [];
    let length = 0;

    try {
      for (;;) {
        const { value, done } = await reader.read();

        if (done) break;
        length += value.byteLength;
        if (length > maximum || stopped) return;
        chunks.push(value);
      }

      const bytes = new Uint8Array(length);
      let offset = 0;

      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  };
  const capture = async (value, body) => {
    if (stopped || pending >= 2) return;
    let url;

    try { url = new URL(value, location.origin); } catch { return; }
    if (url.protocol !== 'https:' || !/^[a-zA-Z0-9-]+\.googlevideo\.com$/.test(url.hostname) || url.pathname !== '/videoplayback') return;
    pending += 1;
    try {
      const bytes = await bodyBytes(body);

      if (stopped || !bytes?.length) return;
      const player = document.getElementById('movie_player');
      const info = player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      const streaming = info?.streamingData;
      const expectedConfig = info?.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig;
      const details = info?.videoDetails;

      if (!details || details.videoId !== videoId || details.isLive ||
        !streaming?.serverAbrStreamingUrl || !expectedConfig || !Array.isArray(streaming.adaptiveFormats)) return;
      const expectedUrl = new URL(streaming.serverAbrStreamingUrl);

      if (!url.searchParams.get('id') || expectedUrl.searchParams.get('id') !== url.searchParams.get('id')) return;
      const formats = streaming.adaptiveFormats.slice(0, 256).map((format) => {
        const clean = {};

        for (const key of ['itag', 'mimeType', 'lastModified', 'contentLength', 'approxDurationMs', 'bitrate', 'averageBitrate', 'width', 'height', 'fps', 'quality', 'qualityLabel', 'audioQuality', 'xtags']) {
          if (['string', 'number'].includes(typeof format[key])) clean[key] = format[key];
        }

        if (typeof format.audioTrack?.id === 'string') clean.audioTrackId = format.audioTrack.id;
        if (typeof format.audioTrack?.audioIsDefault === 'boolean') clean.isDefaultAudioTrack = format.audioTrack.audioIsDefault;
        return clean;
      });

      window.postMessage({ protocol, nonce, operation: 'capture', capture: {
        videoId, title: details.title, duration: Number(details.lengthSeconds), formats,
        streamingUrl: url.href, requestBody: base64(bytes), expectedStreamingUrl: expectedUrl.href, expectedConfig,
      } }, location.origin);
    } catch { /* A later native request may contain the required playback state. */ }
    finally { pending -= 1; }
  };
  const hookedFetch = function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || input?.toString();

    if (init?.body) void capture(url, init.body);
    else if (input instanceof Request && input.method === 'POST') {
      try { void capture(url, input.clone().body); } catch { /* The body was already used. */ }
    }

    return originalFetch.call(this, input, init);
  };
  const hookedOpen = function(method, url, ...rest) {
    xhrUrls.set(this, typeof url === 'string' ? url : url?.toString());
    return originalOpen.call(this, method, url, ...rest);
  };
  const hookedSend = function(body) {
    void capture(xhrUrls.get(this), body);
    return originalSend.call(this, body);
  };
  const stop = () => {
    stopped = true;
    clearInterval(playbackTimer);
    clearTimeout(timeout);
    if (window.fetch === hookedFetch) window.fetch = originalFetch;
    if (XMLHttpRequest.prototype.open === hookedOpen) XMLHttpRequest.prototype.open = originalOpen;
    if (XMLHttpRequest.prototype.send === hookedSend) XMLHttpRequest.prototype.send = originalSend;
  };

  window.fetch = hookedFetch;
  XMLHttpRequest.prototype.open = hookedOpen;
  XMLHttpRequest.prototype.send = hookedSend;
  // The helper tab uses muted playback; YouTube can replace/reset its video during an ad transition.
  const playbackTimer = setInterval(() => {
    const video = document.querySelector('video');

    if (!video) return;
    video.muted = true;
    if (video.paused) void video.play().catch(() => undefined);
  }, 500);
  const timeout = setTimeout(stop, 90_000);

  window.addEventListener('message', (event) => {
    if (event.source === window && event.origin === location.origin && event.data?.protocol === protocol &&
      event.data.nonce === nonce && event.data.operation === 'stop') stop();
  });
  window.addEventListener('pagehide', stop, { once: true });
})();
