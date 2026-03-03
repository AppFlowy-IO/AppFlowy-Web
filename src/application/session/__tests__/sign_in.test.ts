import { afterAuth, isSafeRedirectUrl } from '../sign_in';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock window.location (jsdom blocks direct href assignment)
let hrefValue = 'http://localhost/login';
Object.defineProperty(window, 'location', {
  writable: true,
  value: {
    get href() {
      return hrefValue;
    },
    set href(v: string) {
      hrefValue = v;
    },
    origin: 'http://localhost',
  },
});

beforeEach(() => {
  localStorageMock.clear();
  hrefValue = 'http://localhost/login';
});

describe('isSafeRedirectUrl', () => {
  describe('safe URLs', () => {
    it('returns true for a simple relative path', () => {
      expect(isSafeRedirectUrl('/app')).toBe(true);
    });

    it('returns true for a relative path with query string', () => {
      expect(isSafeRedirectUrl('/app?tab=settings')).toBe(true);
    });

    it('returns true for a relative path with nested segments', () => {
      expect(isSafeRedirectUrl('/workspace/settings')).toBe(true);
    });

    it('returns true for an absolute URL matching window.location.origin', () => {
      expect(isSafeRedirectUrl('http://localhost/app')).toBe(true);
    });

    it('returns true for an absolute URL with the same origin but a deep path', () => {
      expect(isSafeRedirectUrl('http://localhost/workspace/abc/view/def')).toBe(true);
    });
  });

  describe('unsafe URLs', () => {
    it('returns false for an absolute URL with a different origin', () => {
      expect(isSafeRedirectUrl('https://evil.com')).toBe(false);
    });

    it('returns false for an absolute URL with a different subdomain', () => {
      expect(isSafeRedirectUrl('https://phishing.appflowy.com')).toBe(false);
    });

    it('returns false for a protocol-relative URL', () => {
      expect(isSafeRedirectUrl('//evil.com')).toBe(false);
    });

    it('returns false for a javascript: URL', () => {
      expect(isSafeRedirectUrl('javascript:alert(1)')).toBe(false);
    });

    it('returns false for a data: URL', () => {
      expect(isSafeRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isSafeRedirectUrl('')).toBe(false);
    });

    it('returns false for a malformed string', () => {
      expect(isSafeRedirectUrl('not a url at all %%')).toBe(false);
    });

    it('returns false for an http URL on a different host', () => {
      expect(isSafeRedirectUrl('http://attacker.com/app')).toBe(false);
    });
  });
});

describe('afterAuth', () => {
  it('redirects to /app when no redirectTo is stored', () => {
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when stored redirectTo is an external URL', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('https://evil.com'));
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when stored redirectTo is a protocol-relative URL', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('//evil.com/attack'));
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when stored redirectTo contains a UUID path', () => {
    const uuidPath = 'http://localhost/app/550e8400-e29b-41d4-a716-446655440000';
    localStorage.setItem('redirectTo', encodeURIComponent(uuidPath));
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app for root path', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('http://localhost/'));
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('follows a safe relative path', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('/settings'));
    afterAuth();
    expect(window.location.href).toBe('/settings');
  });

  it('follows a safe absolute same-origin URL', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('http://localhost/settings'));
    afterAuth();
    expect(window.location.href).toBe('http://localhost/settings');
  });

  it('clears localStorage after execution regardless of outcome', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('https://evil.com'));
    afterAuth();
    expect(localStorage.getItem('redirectTo')).toBeNull();
  });

  it('clears localStorage even for a safe redirect', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('/settings'));
    afterAuth();
    expect(localStorage.getItem('redirectTo')).toBeNull();
  });
});
