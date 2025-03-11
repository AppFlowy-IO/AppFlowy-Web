export const checkImage = async(url: string) => {
  return new Promise((resolve: (data: {
    ok: boolean,
    status: number,
    statusText: string,
    error?: string,
    validatedUrl?: string,
  }) => void) => {
    const img = new Image();

    // Set a timeout to handle very slow loads
    const timeoutId = setTimeout(() => {
      resolve({
        ok: false,
        status: 408,
        statusText: 'Request Timeout',
        error: 'Image loading timed out',
      });
    }, 10000); // 10 second timeout

    img.onload = () => {
      clearTimeout(timeoutId);
      // Add cache-busting parameter to prevent browser caching
      // which can sometimes hide image loading issues
      const cacheBuster = `?cb=${Date.now()}`;

      resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        validatedUrl: url + cacheBuster,
      });
    };

    img.onerror = () => {
      clearTimeout(timeoutId);
      resolve({
        ok: false,
        status: 404,
        statusText: 'Image Not Found',
        error: 'Failed to load image',
      });
    };

    img.src = url;

  });
};