export const HELPER_PROTOCOL = 'appflowy-youtube-playback-v1';
export const MAX_PLAYBACK_REQUEST_BYTES = 256 * 1024;

export function validVideoId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(value);
}

export function decodeBase64(value, maximum = MAX_PLAYBACK_REQUEST_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 + 2 ||
    !/^[A-Za-z0-9_+/=-]*$/.test(value)) throw new Error('blocked');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));

  if (binary.length > maximum) throw new Error('blocked');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Read a length-delimited protobuf field without evaluating code or loading a parser bundle. */
export function bytesField(bytes, fieldNumber) {
  let offset = 0;
  const varint = () => {
    let result = 0;

    for (let index = 0; index < 10; index++) {
      if (offset >= bytes.length) throw new Error('blocked');
      const value = bytes[offset++];

      result += (value & 127) * 2 ** (index * 7);
      if (!(value & 128)) return result;
    }

    throw new Error('blocked');
  };

  while (offset < bytes.length) {
    const tag = varint();
    const wire = tag & 7;
    const field = Math.floor(tag / 8);

    if (!Number.isSafeInteger(tag) || field === 0) throw new Error('blocked');
    if (wire === 0) varint();
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const length = varint();

      if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - offset) throw new Error('blocked');
      if (field === fieldNumber) return bytes.subarray(offset, offset + length);
      offset += length;
    } else throw new Error('blocked');
    if (offset > bytes.length) throw new Error('blocked');
  }
}

export function streamingUrl(value) {
  if (typeof value !== 'string' || value.length > 32_768) throw new Error('blocked');
  const url = new URL(value);

  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
    !/^[a-zA-Z0-9-]+\.googlevideo\.com$/.test(url.hostname) || url.pathname !== '/videoplayback') {
    throw new Error('blocked');
  }

  return url;
}

export function validatePlaybackCapture(capture, videoId) {
  if (!capture || capture.videoId !== videoId || !validVideoId(videoId) ||
    typeof capture.title !== 'string' || !capture.title.trim() || capture.title.length > 1000 ||
    !Number.isFinite(capture.duration) || capture.duration <= 0 || capture.duration > 24 * 60 * 60 ||
    !Array.isArray(capture.formats) || capture.formats.length > 256) throw new Error('blocked');
  const url = streamingUrl(capture.streamingUrl);
  const expectedUrl = streamingUrl(capture.expectedStreamingUrl);

  if (!url.searchParams.get('id') || url.searchParams.get('id') !== expectedUrl.searchParams.get('id')) {
    throw new Error('blocked');
  }

  const request = decodeBase64(capture.requestBody);
  const config = bytesField(request, 5);
  const expectedConfig = decodeBase64(capture.expectedConfig, 64 * 1024);
  const context = bytesField(request, 19);
  const token = context && bytesField(context, 2);

  // A helper may first play an advertisement. Both the native URL and opaque playback
  // configuration must belong to the requested video's player response.
  if (!config?.length || config.length !== expectedConfig.length ||
    !config.every((value, index) => value === expectedConfig[index])) throw new Error('blocked');
  if (!token || token.length <= 32 || token.length > 16 * 1024 ||
    (token[0] === 34 && token[1] === token.length - 2)) throw new Error('pending');

  const formats = capture.formats.flatMap((format) => {
    if (!format || !Number.isInteger(format.itag) || format.itag <= 0 ||
      typeof format.mimeType !== 'string' || format.mimeType.length > 200 ||
      !/^(audio|video)\/[a-zA-Z0-9.+-]+(?:;.*)?$/.test(format.mimeType)) return [];
    const clean = { itag: format.itag, mimeType: format.mimeType, bitrate: 0 };

    for (const key of ['lastModified', 'contentLength', 'approxDurationMs']) {
      if (typeof format[key] === 'string' && /^\d{1,30}$/.test(format[key])) clean[key] = format[key];
    }

    for (const key of ['bitrate', 'averageBitrate', 'width', 'height', 'fps']) {
      if (Number.isFinite(format[key]) && format[key] >= 0 && format[key] <= 1_000_000_000) clean[key] = format[key];
    }

    for (const key of ['quality', 'qualityLabel', 'audioQuality', 'audioTrackId', 'xtags']) {
      if (typeof format[key] === 'string' && format[key].length <= 500) clean[key] = format[key];
    }

    if (typeof format.isDefaultAudioTrack === 'boolean') clean.isDefaultAudioTrack = format.isDefaultAudioTrack;

    return [clean];
  });

  if (!formats.some((format) => format.mimeType.startsWith('audio/'))) throw new Error('blocked');
  return {
    videoId, title: capture.title, duration: capture.duration, formats,
    streamingUrl: url.href, requestBody: capture.requestBody,
  };
}
