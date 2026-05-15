import { FileMediaType } from '@/application/database-yjs/cell.type';

/**
 * Get the media type of a file based on its filename.
 * @param filename - The name or url of the file to check.
 */
export function getFileMediaType (filename: string) {
  const imgExtensionRegex = /\.(gif|jpe?g|tiff?|png|webp|bmp|heic|heif)$/i;
  const videoExtensionRegex = /\.(mp4|mov|avi|webm|flv|m4v|mpeg|h264)$/i;
  const audioExtensionRegex = /\.(mp3|wav|ogg|flac|aac|wma|alac|aiff)$/i;
  const documentExtensionRegex = /\.(pdf|doc|docx)$/i;
  const archiveExtensionRegex = /\.(zip|tar|gz|7z|rar)$/i;
  const textExtensionRegex = /\.(txt|md|html|css|js|json|xml|csv)$/i;

  const urlRegex = /^(https?:\/\/)/i;

  if (imgExtensionRegex.test(filename)) {
    return FileMediaType.Image;
  } else if (videoExtensionRegex.test(filename)) {
    return FileMediaType.Video;
  } else if (audioExtensionRegex.test(filename)) {
    return FileMediaType.Audio;
  } else if (documentExtensionRegex.test(filename)) {
    return FileMediaType.Document;
  } else if (archiveExtensionRegex.test(filename)) {
    return FileMediaType.Archive;
  } else if (textExtensionRegex.test(filename)) {
    return FileMediaType.Text;
  } else if (urlRegex.test(filename)) {
    return FileMediaType.Link;
  } else {
    return FileMediaType.Other;
  }
}