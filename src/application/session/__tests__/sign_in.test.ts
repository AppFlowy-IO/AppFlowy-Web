import { afterAuth, buildLoginUrl, getSafeRedirectUrl, isAuthPath, isSafeRedirectUrl, saveRedirectTo } from '../sign_in';

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

    it('returns true without decoding percent-encoded query data', () => {
      expect(isSafeRedirectUrl('/app?next=https%3A%2F%2Fevil.com')).toBe(true);
    });

    it('returns true for a safe URL containing a literal percent value', () => {
      expect(isSafeRedirectUrl('/reports?completion=100%')).toBe(true);
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

    it('returns false for a same-origin protocol-relative URL', () => {
      expect(isSafeRedirectUrl('//localhost/settings')).toBe(false);
    });

    it.each([
      '/\\evil.com/attack',
      '/%5Cevil.com/attack',
      '/%255Cevil.com/attack',
      '/%2Fevil.com/attack',
      '/%252Fevil.com/attack',
      '%2F%2Fevil.com/attack',
      '%252F%252Fevil.com/attack',
    ])('returns false for an encoded or backslash authority escape: %s', (url) => {
      expect(isSafeRedirectUrl(url)).toBe(false);
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

describe('getSafeRedirectUrl', () => {
  it('returns the original value rather than decoding it', () => {
    const redirectTo = '/settings?next=%252Fapp&source=email%2Blink';

    expect(getSafeRedirectUrl(redirectTo)).toBe(redirectTo);
  });

  it('returns null when a later decoding layer becomes protocol-relative', () => {
    expect(getSafeRedirectUrl('/%25252Fevil.com')).toBeNull();
  });
});

describe('isAuthPath', () => {
  it.each(['/login', '/login/', '/LOGIN', '/%6Cogin', '/auth/callback', '/auth/%63allback'])(
    'matches a router-equivalent authentication path: %s',
    (pathname) => {
      expect(isAuthPath(pathname)).toBe(true);
    }
  );

  it.each(['/login/foo', '/loginish', '/login%2F', '/auth/callback-other'])(
    'does not match a non-authentication path: %s',
    (pathname) => {
      expect(isAuthPath(pathname)).toBe(false);
    }
  );
});

describe('saveRedirectTo', () => {
  it('stores a safe redirect without changing its encoding', () => {
    const redirectTo = '/settings?next=%2Fapp';

    saveRedirectTo(redirectTo);

    expect(localStorage.getItem('redirectTo')).toBe(redirectTo);
  });

  it('removes a previous redirect instead of storing an unsafe value', () => {
    localStorage.setItem('redirectTo', '/settings');

    saveRedirectTo('/\\evil.com');

    expect(localStorage.getItem('redirectTo')).toBeNull();
  });
});

describe('buildLoginUrl', () => {
  it('returns the login path when no parameters are present', () => {
    expect(buildLoginUrl()).toBe('/login');
  });

  it('encodes each query value exactly once without allowing query injection', () => {
    const redirectTo = '/settings?tab=members&next=%2Fapp#security';
    const loginUrl = buildLoginUrl({
      action: 'enterPassword',
      email: 'person+label&admin=true@example.com',
      redirectTo,
      type: 'signup',
    });
    const parsed = new URL(loginUrl, window.location.origin);

    expect(parsed.pathname).toBe('/login');
    expect(parsed.searchParams.get('action')).toBe('enterPassword');
    expect(parsed.searchParams.get('email')).toBe('person+label&admin=true@example.com');
    expect(parsed.searchParams.get('redirectTo')).toBe(redirectTo);
    expect(parsed.searchParams.get('type')).toBe('signup');
    expect(parsed.searchParams.get('admin')).toBeNull();
  });

  it('omits an unsafe redirect while preserving other login parameters', () => {
    const loginUrl = buildLoginUrl({ action: 'resetPassword', redirectTo: '/%255Cevil.com' });
    const parsed = new URL(loginUrl, window.location.origin);

    expect(parsed.searchParams.get('action')).toBe('resetPassword');
    expect(parsed.searchParams.has('redirectTo')).toBe(false);
  });
});

describe('afterAuth', () => {
  it('redirects to /app when no redirectTo is stored', () => {
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when stored redirectTo is an external URL', () => {
    localStorage.setItem('redirectTo', 'https://evil.com');
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when stored redirectTo is a protocol-relative URL', () => {
    localStorage.setItem('redirectTo', '//evil.com/attack');
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when stored redirectTo uses a backslash authority escape', () => {
    localStorage.setItem('redirectTo', '/\\evil.com/attack');
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when stored redirectTo contains a repeatedly encoded authority escape', () => {
    localStorage.setItem('redirectTo', '/%255Cevil.com/attack');
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when stored redirectTo contains a UUID path', () => {
    const uuidPath = 'http://localhost/app/550e8400-e29b-41d4-a716-446655440000';
    localStorage.setItem('redirectTo', uuidPath);
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app when a stored UUID path uses uppercase hex characters', () => {
    localStorage.setItem('redirectTo', '/app/550E8400-E29B-41D4-A716-446655440000');
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it('redirects to /app path while preserving query params for root path', () => {
    localStorage.setItem('redirectTo', 'http://localhost/?foo=bar');
    afterAuth();
    expect(window.location.href).toBe('http://localhost/app?foo=bar');
  });

  it('redirects to /app when stored redirectTo has malformed encoding', () => {
    localStorage.setItem('redirectTo', '%zz');
    afterAuth();
    expect(window.location.href).toBe('/app');
  });

  it.each([
    '/login?force=true',
    'http://localhost/login?force=true',
    '/LOGIN?force=true',
    '/%6Cogin?force=true',
    '/auth/callback#access_token=example',
    '/auth/%63allback#access_token=example',
  ])('redirects to /app instead of returning to an authentication route: %s', (redirectTo) => {
    localStorage.setItem('redirectTo', redirectTo);

    afterAuth();

    expect(window.location.href).toBe('/app');
    expect(localStorage.getItem('redirectTo')).toBeNull();
  });

  it.each(['/login/foo', '/loginish', '/auth/callback-other'])(
    'preserves a safe non-authentication destination: %s',
    (redirectTo) => {
      localStorage.setItem('redirectTo', redirectTo);

      afterAuth();

      expect(window.location.href).toBe(redirectTo);
    }
  );

  it('follows a safe relative path', () => {
    localStorage.setItem('redirectTo', '/settings');
    afterAuth();
    expect(window.location.href).toBe('/settings');
  });

  it('does not decode data inside a safe relative redirect', () => {
    localStorage.setItem('redirectTo', '/settings?next=%252Fapp');
    afterAuth();
    expect(window.location.href).toBe('/settings?next=%252Fapp');
  });

  it('follows a safe absolute same-origin URL', () => {
    localStorage.setItem('redirectTo', 'http://localhost/settings');
    afterAuth();
    expect(window.location.href).toBe('http://localhost/settings');
  });

  it('clears localStorage after execution regardless of outcome', () => {
    localStorage.setItem('redirectTo', 'https://evil.com');
    afterAuth();
    expect(localStorage.getItem('redirectTo')).toBeNull();
  });

  it('clears localStorage even for a safe redirect', () => {
    localStorage.setItem('redirectTo', '/settings');
    afterAuth();
    expect(localStorage.getItem('redirectTo')).toBeNull();
  });
});
