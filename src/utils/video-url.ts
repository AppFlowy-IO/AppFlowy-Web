import ReactPlayer from 'react-player';
import { processUrl } from '@/utils/url';

/**
 * Validates if a URL is a supported video source
 * Uses react-player's built-in validation which supports:
 * - YouTube, Vimeo, Dailymotion, Facebook, Twitch, SoundCloud, etc.
 * - Direct video files (.mp4, .webm, .mov, .ogv, etc.)
 * - HLS (.m3u8) and DASH (.mpd) streaming
 */
const AUDIO_ONLY_EXTENSIONS = /\.(m4a|m4b|mp4a|mpga|mp2|mp2a|mp3|m2a|m3a|wav|weba|aac|oga|spx)($|\?)/i;

export function isValidVideoUrl(url: string): boolean {
  const processedUrl = processUrl(url);

  if (!processedUrl) return false;

  // Only allow http/https protocols for security
  if (!processedUrl.match(/^https?:\/\//i)) return false;

  // Exclude audio-only file URLs (ReactPlayer.canPlay returns true for audio files)
  if (AUDIO_ONLY_EXTENSIONS.test(processedUrl)) return false;

  // Use react-player's built-in validation
  return ReactPlayer.canPlay(processedUrl);
}

/**
 * Returns a translation key for video loading error messages
 * Uses normalized URL (via processUrl) to ensure consistency with validation logic
 * Returns translation keys that should be translated via i18n in the UI layer
 */
export function getVideoErrorMessage(url: string): string {
  // Normalize URL the same way as validation to avoid inconsistencies
  const processedUrl = processUrl(url);

  if (!processedUrl) {
    return 'document.plugins.video.errorInvalidUrl';
  }

  // Check for platform-specific errors using normalized URL
  if (processedUrl.includes('facebook.com')) {
    return 'document.plugins.video.errorFacebookPrivacy';
  }

  if (processedUrl.match(/\.(mp4|webm|mov|ogv)($|\?|#)/i)) {
    return 'document.plugins.video.errorFileCors';
  }

  return 'document.plugins.video.errorGeneric';
}
