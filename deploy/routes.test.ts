/** @jest-environment node */

import { jest } from '@jest/globals';
import path from 'path';

// Mock all dependencies before importing routes
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock('./logger', () => ({
  logger: mockLogger,
}));

const mockFetchPublishMetadata = jest.fn<() => Promise<unknown>>();

jest.mock('./api', () => ({
  fetchPublishMetadata: (...args: unknown[]) => mockFetchPublishMetadata(...(args as [])),
}));

jest.mock('./html', () => ({
  renderMarketingPage: jest.fn(() => '<html>marketing</html>'),
  renderPublishPage: jest.fn(() => '<html>publish</html>'),
}));

// Set a known distDir for testing
const testDistDir = '/test/dist';
jest.mock('./config', () => ({
  distDir: testDistDir,
  defaultSite: 'https://appflowy.com',
}));

const mockReadFileSync = jest.fn();
jest.mock('fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

describe('routes - static file handling', () => {
  let routes: typeof import('./routes').routes;

  const createContext = (pathname: string, method = 'GET') => ({
    req: { method } as Request,
    url: new URL(`https://test.com${pathname}`),
    hostname: 'test.com',
  });

  beforeAll(async () => {
    // Dynamic import after mocks are set up
    const routesModule = await import('./routes');
    routes = routesModule.routes;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('path traversal prevention', () => {
    // Note: Unencoded `..` in URLs is normalized by the URL constructor
    // e.g., `/static/../../../etc/passwd` becomes `/etc/passwd`
    // This means it won't match static paths and falls through to other routes.
    // This is safe because the path is already normalized before reaching our code.

    it('blocks path traversal with encoded ..%2F in static path', async () => {
      const context = createContext('/static/..%2F..%2F..%2Fetc%2Fpasswd');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(403);
      expect(await response!.text()).toBe('Forbidden');
      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Path traversal attempt blocked')
      );
    });

    it('blocks path traversal with encoded ..%2F in af_icons path', async () => {
      const context = createContext('/af_icons/..%2F..%2Fetc%2Fpasswd');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(403);
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('blocks path traversal with encoded ..%2F in covers path', async () => {
      const context = createContext('/covers/..%2F..%2F..%2Fetc%2Fpasswd');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(403);
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('blocks path traversal with encoded ..%2F in .well-known path', async () => {
      const context = createContext('/.well-known/..%2F..%2Fetc%2Fpasswd');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(403);
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('blocks double-encoded path traversal attempts', async () => {
      // %252F is double-encoded / (%25 = %, 2F = /)
      // After first decode: ..%2F (still contains ..)
      const context = createContext('/static/..%252F..%252Fetc');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(403);
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });

    it('URL-normalized paths with unencoded .. fall through to other routes', async () => {
      // URL constructor normalizes /static/../../../etc/passwd to /etc/passwd
      // which doesn't match static paths, so it falls through
      const context = createContext('/static/../../../etc/passwd');

      // The staticRoute should return undefined (not match)
      const staticRoute = routes[0];
      const response = await staticRoute(context);

      // URL normalization means pathname is now /etc/passwd, not a static path
      expect(response).toBeUndefined();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });
  });

  describe('valid static file serving', () => {
    it('serves files from /static/ path with correct MIME type', async () => {
      const fileContent = Buffer.from('console.log("test");');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/static/js/app.js');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(200);
      expect(response!.headers.get('Content-Type')).toBe('application/javascript');
      expect(mockReadFileSync).toHaveBeenCalledWith(
        path.resolve(testDistDir, 'static/js/app.js')
      );
    });

    it('serves files from /af_icons/ path', async () => {
      const fileContent = Buffer.from('<svg></svg>');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/af_icons/icon.svg');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(200);
      expect(response!.headers.get('Content-Type')).toBe('image/svg+xml');
    });

    it('serves files from /covers/ path', async () => {
      const fileContent = Buffer.from('PNG data');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/covers/m_cover_image_1.png');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(200);
      expect(response!.headers.get('Content-Type')).toBe('image/png');
    });

    it('serves known static files like /appflowy.ico', async () => {
      const fileContent = Buffer.from('ICO data');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/appflowy.ico');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(200);
      expect(response!.headers.get('Content-Type')).toBe('image/x-icon');
    });

    it('serves /appflowy.svg with correct MIME type', async () => {
      const fileContent = Buffer.from('<svg></svg>');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/appflowy.svg');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.status).toBe(200);
      expect(response!.headers.get('Content-Type')).toBe('image/svg+xml');
    });

    it('serves CSS files with correct MIME type', async () => {
      const fileContent = Buffer.from('body { color: red; }');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/static/css/style.css');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.headers.get('Content-Type')).toBe('text/css');
    });

    it('serves JSON files with correct MIME type', async () => {
      const fileContent = Buffer.from('{"key": "value"}');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/static/data.json');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.headers.get('Content-Type')).toBe('application/json');
    });

    it('serves WOFF2 font files with correct MIME type', async () => {
      const fileContent = Buffer.from('WOFF2 data');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/static/fonts/roboto.woff2');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.headers.get('Content-Type')).toBe('font/woff2');
    });

    it('uses application/octet-stream for unknown file types', async () => {
      const fileContent = Buffer.from('binary data');
      mockReadFileSync.mockReturnValue(fileContent);

      const context = createContext('/static/unknown.xyz');

      let response: Response | undefined;
      for (const route of routes) {
        response = await route(context);
        if (response) break;
      }

      expect(response).toBeDefined();
      expect(response!.headers.get('Content-Type')).toBe('application/octet-stream');
    });
  });

  describe('static file not found handling', () => {
    it('falls through to next route when file not found', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const context = createContext('/static/nonexistent.js');

      // staticRoute should return undefined when file not found
      const staticRoute = routes[0];
      const response = await staticRoute(context);

      expect(response).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Static file not found')
      );
    });
  });

  describe('non-GET methods', () => {
    it('ignores POST requests to static paths', async () => {
      const context = createContext('/static/js/app.js', 'POST');

      const staticRoute = routes[0];
      const response = await staticRoute(context);

      expect(response).toBeUndefined();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });
  });

  describe('non-static paths', () => {
    it('ignores non-static paths', async () => {
      const context = createContext('/some/random/path');

      const staticRoute = routes[0];
      const response = await staticRoute(context);

      expect(response).toBeUndefined();
      expect(mockReadFileSync).not.toHaveBeenCalled();
    });
  });

  describe('cache headers', () => {
    it('serves hashed /static/ assets as immutable', async () => {
      mockReadFileSync.mockReturnValue(Buffer.from('console.log("test");'));

      const context = createContext('/static/js/index-abc123.js');

      const staticRoute = routes[0];
      const response = await staticRoute(context);

      expect(response).toBeDefined();
      expect(response!.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    });

    it('serves non-hashed static files with a short cache lifetime', async () => {
      mockReadFileSync.mockReturnValue(Buffer.from('ICO data'));

      const context = createContext('/appflowy.ico');

      const staticRoute = routes[0];
      const response = await staticRoute(context);

      expect(response).toBeDefined();
      expect(response!.headers.get('Cache-Control')).toBe('public, max-age=3600');
    });
  });

  describe('app routes', () => {
    const runRoutes = async (pathname: string) => {
      let response: Response | undefined;
      for (const route of routes) {
        response = await route(createContext(pathname));
        if (response) break;
      }

      return response;
    };

    it('serves the OAuth callback /auth/callback as the app shell, not a publish lookup', async () => {
      const response = await runRoutes('/auth/callback');

      expect(response).toBeDefined();
      expect(response!.status).toBe(200);
      expect(await response!.text()).toBe('<html>marketing</html>');
      expect(response!.headers.get('Cache-Control')).toBe('no-cache');
      expect(mockFetchPublishMetadata).not.toHaveBeenCalled();
    });

    it('serves /login as the app shell with no-cache', async () => {
      const response = await runRoutes('/login');

      expect(response).toBeDefined();
      expect(await response!.text()).toBe('<html>marketing</html>');
      expect(response!.headers.get('Cache-Control')).toBe('no-cache');
      expect(mockFetchPublishMetadata).not.toHaveBeenCalled();
    });

    it('does not shadow publish namespaces sharing an app-path prefix (e.g. /authors)', async () => {
      mockFetchPublishMetadata.mockResolvedValue({ code: 0, data: { view: {} } });

      const response = await runRoutes('/authors/my-page');

      expect(response).toBeDefined();
      expect(await response!.text()).toBe('<html>publish</html>');
      expect(mockFetchPublishMetadata).toHaveBeenCalledWith('authors', 'my-page');
    });

    it('serves publish pages with no-cache so stale shells are never reused', async () => {
      mockFetchPublishMetadata.mockResolvedValue({ code: 0, data: { view: {} } });

      const response = await runRoutes('/some-namespace/some-page');

      expect(response).toBeDefined();
      expect(response!.headers.get('Cache-Control')).toBe('no-cache');
    });
  });
});
