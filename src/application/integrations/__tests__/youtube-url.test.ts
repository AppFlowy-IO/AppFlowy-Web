import { isHttpUrl, youtubeAudioFilename, youtubeDurationError, youtubeVideoId } from '../youtube-url';

describe('Flutter YouTube link and duration validation', () => {
  it.each([
    'https://youtu.be/lr3hNhA0IfQ?si=share',
    'https://www.youtube.com/watch?v=lr3hNhA0IfQ&t=12s',
    'http://m.youtube.com/watch?v=lr3hNhA0IfQ',
    'https://youtube.com/shorts/lr3hNhA0IfQ?feature=share',
    'https://youtube.com/live/lr3hNhA0IfQ',
    'https://youtube.com/embed/lr3hNhA0IfQ',
    'https://music.youtube.com/watch?v=lr3hNhA0IfQ',
  ])('accepts %s', (url) => expect(youtubeVideoId(url)).toBe('lr3hNhA0IfQ'));

  it.each([
    'https://youtube.com.example.com/watch?v=lr3hNhA0IfQ',
    'https://youtube.com@evil.example/watch?v=lr3hNhA0IfQ',
    'https://youtube.com:8080/watch?v=lr3hNhA0IfQ',
    'https://youtube.com/playlist?list=lr3hNhA0IfQ',
    'https://youtube.com/@channel', 'https://youtu.be/short',
    'javascript:youtube.com/watch?v=lr3hNhA0IfQ',
    'file:///lr3hNhA0IfQ',
  ])('rejects %s', (url) => expect(youtubeVideoId(url)).toBeUndefined());

  it.each([60, 61, 3600, 14400])('includes duration boundary %s', (duration) => {
    expect(youtubeDurationError(duration)).toBeUndefined();
  });
  it.each([45, 59, 14401])('blocks duration %s', (duration) => {
    expect(youtubeDurationError(duration)).toBe('youtubeDurationOutOfRange');
  });
  it.each([undefined, 0, NaN, Infinity, -1])('blocks unknown duration %s', (duration) => {
    expect(youtubeDurationError(duration)).toBe('youtubeDurationUnavailable');
  });
  it('uses Flutter’s safe m4a filename and handles a title with no filename characters', () => {
    expect(youtubeAudioFilename('Team: meeting!')).toBe('Team meeting.m4a');
    expect(youtubeAudioFilename('💬')).toBe('youtube_audio.m4a');
  });
  it('only prefills absolute HTTP links from the clipboard', () => {
    expect(isHttpUrl(' https://example.com/page ')).toBe(true);
    expect(isHttpUrl('notes to self')).toBe(false);
    expect(isHttpUrl('https://user:password@example.com')).toBe(false);
  });
});
