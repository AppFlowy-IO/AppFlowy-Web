import ReactPlayer from 'react-player';
import { processUrl } from '@/utils/url';

/**
 * Validates if a URL is a supported video source
 * Uses react-player's built-in validation which supports:
 * - YouTube, Vimeo, Dailymotion, Facebook, Twitch, SoundCloud, etc.
 * - Direct video files (.mp4, .webm, .mov, .ogv, etc.)
 * - HLS (.m3u8) and DASH (.mpd) streaming
 */
export function isValidVideoUrl(url: string): boolean {
  const processedUrl = processUrl(url);
  if (!processedUrl) return false;

  // Only allow http/https protocols for security
  if (!processedUrl.match(/^https?:\/\//)) return false;

  // Use react-player's built-in validation
  return ReactPlayer.canPlay(processedUrl);
}

/**
 * Enhanced error message for video loading failures
 */
export function getVideoErrorMessage(url: string): string {
  if (url.includes('facebook.com')) {
    return 'Facebook video couldn\'t be loaded. Check privacy settings.';
  }
  if (url.match(/\.(mp4|webm|mov|ogv)$/i)) {
    return 'Video file couldn\'t be loaded. Check URL and CORS settings.';
  }
  return 'The video embed couldn\'t be loaded. Check URL and privacy settings.';
}
