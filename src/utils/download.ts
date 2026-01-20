import download from 'downloadjs';

import { getTokenParsed } from '@/application/session/token';
import { isAppFlowyFileStorageUrl } from '@/utils/file-storage-url';

export async function downloadFile(url: string, filename?: string): Promise<void> {
  try {
    let response: Response;

    if (isAppFlowyFileStorageUrl(url)) {
      const token = getTokenParsed();

      if (!token) {
        throw new Error('Authentication required for blob download');
      }

      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'x-platform': 'web-app',
        },
      });
    } else {
      response = await fetch(url);
    }

    if (!response.ok) {
      throw new Error(`Download failed, the download status is: ${response.status}`);
    }

    const blob = await response.blob();

    download(blob, filename);
  } catch (error) {
    console.error(error);
  }
}
