/// <reference types="jest" />
import ReactPlayer from 'react-player';
import { getVideoErrorMessage, isValidVideoUrl } from '../video-url';

/**
 * Integration tests for video-url utilities
 * These tests use the REAL ReactPlayer.canPlay() function
 * to verify actual URL validation against the library
 */
describe('video-url integration tests', () => {
  describe('isValidVideoUrl with real ReactPlayer', () => {
    it('should accept real YouTube URLs', () => {
      const urls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      ];

      urls.forEach(url => {
        const result = isValidVideoUrl(url);
        // Verify against real ReactPlayer
        const expectedCanPlay = ReactPlayer.canPlay(url);
        expect(result).toBe(expectedCanPlay);
        expect(result).toBe(true);
      });
    });

    it('should accept real Vimeo URLs', () => {
      const urls = [
        'https://vimeo.com/148751763',
        'https://player.vimeo.com/video/148751763',
      ];

      urls.forEach(url => {
        const result = isValidVideoUrl(url);
        const expectedCanPlay = ReactPlayer.canPlay(url);
        expect(result).toBe(expectedCanPlay);
        expect(result).toBe(true);
      });
    });

    it('should accept real direct video file URLs', () => {
      const urls = [
        'https://example.com/video.mp4',
        'https://example.com/video.webm',
        'https://example.com/video.ogv',
        'http://localhost:3000/video.mp4',
      ];

      urls.forEach(url => {
        const result = isValidVideoUrl(url);
        const expectedCanPlay = ReactPlayer.canPlay(url);
        expect(result).toBe(expectedCanPlay);
        expect(result).toBe(true);
      });
    });

    it('should reject real non-video URLs', () => {
      const urls = [
        'https://example.com/document.pdf',
        'https://example.com/image.jpg',
        'https://example.com',
      ];

      urls.forEach(url => {
        const result = isValidVideoUrl(url);
        const expectedCanPlay = ReactPlayer.canPlay(url);
        expect(result).toBe(expectedCanPlay);
        expect(result).toBe(false);
      });
    });

    it('should reject dangerous protocols even if ReactPlayer could theoretically handle them', () => {
      // Security check should happen BEFORE ReactPlayer.canPlay()
      const dangerousUrls = [
        'javascript:alert(1)',
        'file:///etc/passwd',
        'data:text/html,<script>alert(1)</script>',
      ];

      dangerousUrls.forEach(url => {
        const result = isValidVideoUrl(url);
        // Our security check should reject these
        expect(result).toBe(false);
      });
    });

    it('should handle YouTube URLs with timestamps', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s';
      const result = isValidVideoUrl(url);
      const expectedCanPlay = ReactPlayer.canPlay(url);
      expect(result).toBe(expectedCanPlay);
      expect(result).toBe(true);
    });

    it('should handle Twitch URLs', () => {
      const urls = [
        'https://www.twitch.tv/videos/12345',
        'https://twitch.tv/monstercat',
      ];

      urls.forEach(url => {
        const result = isValidVideoUrl(url);
        const expectedCanPlay = ReactPlayer.canPlay(url);
        expect(result).toBe(expectedCanPlay);
        expect(result).toBe(true);
      });
    });

    it('should handle SoundCloud URLs', () => {
      const url = 'https://soundcloud.com/artist/track';
      const result = isValidVideoUrl(url);
      const expectedCanPlay = ReactPlayer.canPlay(url);
      expect(result).toBe(expectedCanPlay);
      expect(result).toBe(true);
    });

    it('should handle Facebook video URLs', () => {
      const url = 'https://www.facebook.com/facebook/videos/10153231379946729/';
      const result = isValidVideoUrl(url);
      const expectedCanPlay = ReactPlayer.canPlay(url);
      expect(result).toBe(expectedCanPlay);
      expect(result).toBe(true);
    });

    it('should verify our validation matches ReactPlayer for edge cases', () => {
      // Test that our validation doesn't accept things ReactPlayer rejects
      const edgeCaseUrls = [
        'https://example.com/not-a-video',
        'https://twitter.com/status/123', // Twitter not supported by ReactPlayer
        'ftp://example.com/video.mp4', // FTP not supported
      ];

      edgeCaseUrls.forEach(url => {
        const result = isValidVideoUrl(url);
        const canPlay = ReactPlayer.canPlay(url);

        // Our result should match ReactPlayer's capability
        // OR be more strict (reject when ReactPlayer accepts for security)
        if (canPlay) {
          // If ReactPlayer can play it, we might still reject for security
          // So this is acceptable: result might be false even if canPlay is true
        } else {
          // If ReactPlayer cannot play it, we must also reject it
          expect(result).toBe(false);
        }
      });
    });
  });

  describe('getVideoErrorMessage', () => {
    it('should return Facebook-specific error translation key', () => {
      const message = getVideoErrorMessage('https://www.facebook.com/watch?v=123');
      expect(message).toBe('document.plugins.video.errorFacebookPrivacy');
    });

    it('should return file-specific error translation key for .mp4', () => {
      const message = getVideoErrorMessage('https://example.com/video.mp4');
      expect(message).toBe('document.plugins.video.errorFileCors');
    });

    it('should return file-specific error translation key for .webm', () => {
      const message = getVideoErrorMessage('https://example.com/video.webm');
      expect(message).toBe('document.plugins.video.errorFileCors');
    });

    it('should return file-specific error translation key for .mov', () => {
      const message = getVideoErrorMessage('https://example.com/video.mov');
      expect(message).toBe('document.plugins.video.errorFileCors');
    });

    it('should return file-specific error translation key for .ogv', () => {
      const message = getVideoErrorMessage('https://example.com/video.ogv');
      expect(message).toBe('document.plugins.video.errorFileCors');
    });

    it('should handle case-insensitive file extensions', () => {
      const message = getVideoErrorMessage('https://example.com/video.MP4');
      expect(message).toBe('document.plugins.video.errorFileCors');
    });

    it('should return generic error translation key for other URLs', () => {
      const urls = [
        'https://youtube.com/watch?v=abc',
        'https://vimeo.com/123',
        'https://example.com/unknown',
      ];

      urls.forEach(url => {
        const message = getVideoErrorMessage(url);
        expect(message).toBe('document.plugins.video.errorGeneric');
      });
    });

    it('should prioritize Facebook check over file extension', () => {
      // Edge case: Facebook URL that ends with video extension
      const message = getVideoErrorMessage('https://facebook.com/video.mp4');
      expect(message).toBe('document.plugins.video.errorFacebookPrivacy');
    });

    it('should return invalid URL error for empty string', () => {
      const message = getVideoErrorMessage('');
      expect(message).toBe('document.plugins.video.errorInvalidUrl');
    });

    it('should use normalized URL (processUrl) for error classification', () => {
      // URLs without protocol should be normalized before checking
      // This test verifies the fix for the code review comment about URL normalization
      const urls = [
        { input: 'example.com/video.mp4', expected: 'document.plugins.video.errorFileCors' },
        { input: 'facebook.com/video/123', expected: 'document.plugins.video.errorFacebookPrivacy' },
      ];

      urls.forEach(({ input, expected }) => {
        const message = getVideoErrorMessage(input);
        expect(message).toBe(expected);
      });
    });

    it('should return translation keys that can be localized', () => {
      // Verify all error messages are translation keys (not hard-coded English)
      const testUrls = [
        'https://facebook.com/video',
        'https://example.com/video.mp4',
        'https://youtube.com/watch?v=abc',
        '',
      ];

      testUrls.forEach(url => {
        const message = getVideoErrorMessage(url);
        // All messages should start with 'document.plugins.video.'
        expect(message).toMatch(/^document\.plugins\.video\./);
      });
    });
  });
});
