import { afterAuth, isSafeRedirectUrl, resolveStoredRedirectUrl, safeDecodeRedirectParam } from '../sign_in';

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

  it('redirects to /app path while preserving query params for root path', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('http://localhost/?foo=bar'));
    afterAuth();
    expect(window.location.href).toBe('http://localhost/app?foo=bar');
  });

  it('redirects to /app when stored redirectTo has malformed encoding', () => {
    localStorage.setItem('redirectTo', '%zz');
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('follows a safe relative path', () => {
    localStorage.setItem('redirectTo', encodeURIComponent('/settings'));
    afterAuth();
    expect(window.location.href).toBe('/settings');
  });

  it('preserves nested OAuth query encoding in a safe relative path', () => {
    const redirect =
      '/oauth/mcp/authorize?client_id=client&redirect_uri=http%3A%2F%2Flocalhost%3A4567%2Fcallback%3Fnext%3Da%2526b&state=one%2526two';

    localStorage.setItem('redirectTo', redirect);
    afterAuth();
    expect(window.location.href).toBe(redirect);
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

describe('safeDecodeRedirectParam', () => {
  it('decodes a valid percent-encoded string', () => {
    expect(safeDecodeRedirectParam('https%3A%2F%2Fevil.com')).toBe('https://evil.com');
  });

  it('returns the string unchanged when nothing is encoded', () => {
    expect(safeDecodeRedirectParam('/settings')).toBe('/settings');
  });

  it('returns null for a malformed percent-encoded sequence', () => {
    expect(safeDecodeRedirectParam('%zz')).toBeNull();
  });

  it('returns null for a lone percent sign', () => {
    expect(safeDecodeRedirectParam('%')).toBeNull();
  });
});

describe('resolveStoredRedirectUrl', () => {
  it('returns already-safe relative URLs without decoding nested query values', () => {
    const redirect =
      '/oauth/mcp/authorize?redirect_uri=http%3A%2F%2Flocalhost%2Fcallback%3Fx%3D1%2526y%3D2';

    expect(resolveStoredRedirectUrl(redirect)).toBe(redirect);
  });

  it('supports legacy encoded relative URLs', () => {
    expect(resolveStoredRedirectUrl(encodeURIComponent('/settings'))).toBe('/settings');
  });
});
