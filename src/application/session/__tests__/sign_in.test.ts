import {
  afterAuth,
  buildLoginUrl,
  getAuthCallbackUrl,
  getPublicFormRedirectTo,
  getSafeRedirectUrl,
  isAuthPath,
  isSafeRedirectUrl,
  PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS,
  savePublicFormRedirectTo,
  saveRedirectTo,
} from '../sign_in';
import { Log } from '@/utils/log';

function createStorageMock() {
  let store: Record<string, string> = {};

  return {
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
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
}

const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

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

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  private readonly listeners: Array<(event: MessageEvent<unknown>) => void> = [];
  readonly postMessage = jest.fn();

  constructor(readonly name: string) {
    MockBroadcastChannel.instances.push(this);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.push(listener);
  }

  dispatch(data: unknown) {
    this.listeners.forEach((listener) => listener({ data } as MessageEvent<unknown>));
  }
}

const originalBroadcastChannel = globalThis.BroadcastChannel;

beforeAll(() => {
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: MockBroadcastChannel,
  });
});

beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
  hrefValue = 'http://localhost/login';
  MockBroadcastChannel.instances.forEach((channel) => channel.postMessage.mockClear());
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: originalBroadcastChannel,
  });
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

  it('stores a public Form redirect in an expiring tab-scoped record', () => {
    const redirectTo = '/form/267699aa-58ef-452f-b822-57271c2c218d';
    const flowId = 'a'.repeat(32);

    savePublicFormRedirectTo(redirectTo, Date.now(), flowId);
    hrefValue = `http://localhost/login?force=true&formAuth=${flowId}`;

    expect(getPublicFormRedirectTo()).toBe(redirectTo);
    expect(localStorage.getItem('redirectTo')).toBeNull();
  });

  it('does not renew a Form continuation when authentication starts after it expires', () => {
    const redirectTo = '/form/267699aa-58ef-452f-b822-57271c2c218d';
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const flowId = 'a'.repeat(32);

    savePublicFormRedirectTo(redirectTo, now, flowId);
    hrefValue = `http://localhost/login?force=true&formAuth=${flowId}`;
    nowSpy.mockReturnValue(now + PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS + 1);
    saveRedirectTo(redirectTo);

    expect(getPublicFormRedirectTo()).toBeNull();
    nowSpy.mockRestore();
  });

  it('discards an expired public Form continuation', () => {
    const now = Date.now();
    const flowId = 'a'.repeat(32);

    savePublicFormRedirectTo('/form/267699aa-58ef-452f-b822-57271c2c218d', now, flowId);
    hrefValue = `http://localhost/login?force=true&formAuth=${flowId}`;

    expect(getPublicFormRedirectTo(now + PUBLIC_FORM_AUTH_CONTINUATION_TTL_MS + 1)).toBeNull();
  });

  it('discards a legacy unbounded public Form redirect', () => {
    localStorage.setItem('redirectTo', '/form/267699aa-58ef-452f-b822-57271c2c218d');

    expect(getPublicFormRedirectTo()).toBeNull();
    expect(localStorage.getItem('redirectTo')).not.toBeNull();

    afterAuth();

    expect(window.location.href).toBe('/app');
    expect(localStorage.getItem('redirectTo')).toBeNull();
  });
});

describe('public Form cross-tab continuation', () => {
  const formPath = '/form/267699aa-58ef-452f-b822-57271c2c218d';
  const firstFlowId = 'a'.repeat(32);

  it('puts only the opaque flow ID in the magic-link callback URL', () => {
    savePublicFormRedirectTo(formPath, Date.now(), firstFlowId);
    const callbackUrl = getAuthCallbackUrl(formPath);
    const parsed = new URL(callbackUrl);

    expect(parsed.searchParams.get('formAuth')).toBe(firstFlowId);
    expect(callbackUrl).not.toContain('267699aa-58ef-452f-b822-57271c2c218d');
  });

  it('does not expose a tab-scoped bearer to a new callback tab', () => {
    savePublicFormRedirectTo(formPath, Date.now(), firstFlowId);
    const callbackUrl = getAuthCallbackUrl(formPath);

    sessionStorage.clear();
    hrefValue = callbackUrl;

    expect(getPublicFormRedirectTo()).toBeNull();
  });

  it('signals the originating tab after authentication completes in another tab', () => {
    savePublicFormRedirectTo(formPath, Date.now(), firstFlowId);
    const callbackUrl = getAuthCallbackUrl(formPath);
    const channel = MockBroadcastChannel.instances[0];

    sessionStorage.clear();
    hrefValue = callbackUrl;
    afterAuth();

    expect(channel.postMessage).toHaveBeenCalledWith({ flowId: firstFlowId, type: 'authenticated' });
    expect(window.location.href).toBe('/app');
  });

  it('redirects only the originating tab whose flow ID matches', () => {
    savePublicFormRedirectTo(formPath, Date.now(), firstFlowId);
    hrefValue = `http://localhost/login?force=true&formAuth=${firstFlowId}`;
    const channel = MockBroadcastChannel.instances[0];

    channel.dispatch({ flowId: 'b'.repeat(32), type: 'authenticated' });
    expect(window.location.href).not.toBe(formPath);

    channel.dispatch({ flowId: firstFlowId, type: 'authenticated' });
    expect(window.location.href).toBe(formPath);
    expect(sessionStorage.getItem('publicFormAuthContinuation')).toBeNull();
  });

  it('does not redirect a tab that has left the Form authentication flow', () => {
    savePublicFormRedirectTo(formPath, Date.now(), firstFlowId);
    const channel = MockBroadcastChannel.instances[0];

    hrefValue = 'http://localhost/';
    channel.dispatch({ flowId: firstFlowId, type: 'authenticated' });

    expect(window.location.href).toBe('http://localhost/');
    expect(sessionStorage.getItem('publicFormAuthContinuation')).not.toBeNull();
  });

  it('does not clear another tab\'s generic login destination', () => {
    saveRedirectTo('/settings');
    savePublicFormRedirectTo(formPath, Date.now(), firstFlowId);
    hrefValue = `http://localhost/login?force=true&formAuth=${firstFlowId}`;
    const channel = MockBroadcastChannel.instances[0];

    channel.dispatch({ flowId: firstFlowId, type: 'authenticated' });

    expect(window.location.href).toBe(formPath);
    expect(localStorage.getItem('redirectTo')).toBe('/settings');
    expect(sessionStorage.getItem('publicFormAuthContinuation')).toBeNull();
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

  it('keeps a public Form continuation out of the login query string', () => {
    const formPath = '/form/267699aa-58ef-452f-b822-57271c2c218d';
    const flowId = 'a'.repeat(32);

    savePublicFormRedirectTo(formPath, Date.now(), flowId);
    const loginUrl = buildLoginUrl({
      action: 'checkEmail',
      email: 'respondent@example.com',
      redirectTo: formPath,
    });
    const parsed = new URL(loginUrl, window.location.origin);

    expect(parsed.searchParams.get('action')).toBe('checkEmail');
    expect(parsed.searchParams.get('email')).toBe('respondent@example.com');
    expect(parsed.searchParams.has('redirectTo')).toBe(false);
    expect(parsed.searchParams.get('force')).toBe('true');
    expect(parsed.searchParams.get('formAuth')).toBe(flowId);
    expect(loginUrl).not.toContain('267699aa-58ef-452f-b822-57271c2c218d');
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

  it('returns to a stored public Form path', () => {
    const formPath = '/form/267699aa-58ef-452f-b822-57271c2c218d';
    const flowId = 'a'.repeat(32);

    savePublicFormRedirectTo(formPath, Date.now(), flowId);
    hrefValue = `http://localhost/auth/callback?formAuth=${flowId}`;
    afterAuth();

    expect(window.location.href).toBe(formPath);
    expect(localStorage.getItem('redirectTo')).toBeNull();
    expect(getPublicFormRedirectTo()).toBeNull();
  });

  it('redacts the Form bearer from authentication logs', () => {
    const token = '267699aa-58ef-452f-b822-57271c2c218d';
    const flowId = 'a'.repeat(32);
    const infoSpy = jest.spyOn(Log, 'info').mockImplementation();

    savePublicFormRedirectTo(`/form/${token}`, Date.now(), flowId);
    hrefValue = `http://localhost/auth/callback?formAuth=${flowId}`;
    afterAuth();

    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(token);
    expect(JSON.stringify(infoSpy.mock.calls)).toContain('/form/[redacted]');
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
