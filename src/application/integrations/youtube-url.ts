export interface YoutubeAudioMetadata {
  videoId: string;
  title: string;
  author: string;
  duration?: number;
  thumbnailUrl?: string;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());

    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Accept video links, including YouTube's share, shorts, live and embed URLs. */
export function youtubeVideoId(value: string): string | undefined {
  if (!isHttpUrl(value)) return;
  const url = new URL(value.trim());
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (url.port) return;
  let id: string | null | undefined;

  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : /^\/(?:shorts|live|embed|v)\/([^/]+)/.exec(url.pathname)?.[1];
  }

  return id && /^[\w-]{11}$/.test(id) ? id : undefined;
}

/** Flutter allows recordings from one minute through four hours, inclusive. */
export function youtubeDurationError(duration?: number) {
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return 'youtubeDurationUnavailable' as const;
  if (duration < 60 || duration > 4 * 60 * 60) return 'youtubeDurationOutOfRange' as const;
}

export function youtubeAudioFilename(title: string) {
  const sanitized = title.replace(/[^\w\s-]/g, '').trim().slice(0, 180);

  return `${sanitized || 'youtube_audio'}.m4a`;
}
