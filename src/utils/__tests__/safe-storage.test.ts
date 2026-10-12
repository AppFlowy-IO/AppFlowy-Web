import {
  getLastViewId,
  getOutlineOpen,
  getOutlineWidth,
  safeGetBoolean,
  safeGetInt,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
  setLastViewId,
  setOutlineOpen,
  setOutlineWidth,
} from '../safe-storage';

describe('safe-storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('reads and writes round-trip values', () => {
    expect(safeSetItem('k', 'v')).toBe(true);
    expect(safeGetItem('k')).toBe('v');
  });

  it('returns null when storage throws on read (private mode)', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(safeGetItem('k')).toBeNull();
  });

  it('returns false when storage throws on write (quota exceeded)', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(safeSetItem('k', 'v')).toBe(false);
  });

  it('returns false on remove failure instead of throwing', () => {
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(safeRemoveItem('k')).toBe(false);
  });

  it('parses integers safely with radix 10 and fallback', () => {
    expect(safeGetInt('missing', 268)).toBe(268);

    window.localStorage.setItem('n', '320');
    expect(safeGetInt('n', 268)).toBe(320);

    window.localStorage.setItem('n', 'not-a-number');
    expect(safeGetInt('n', 268)).toBe(268);

    window.localStorage.setItem('n', '');
    expect(safeGetInt('n', 268)).toBe(268);
  });

  it('parses booleans strictly and falls back otherwise', () => {
    expect(safeGetBoolean('missing', false)).toBe(false);
    expect(safeGetBoolean('missing', true)).toBe(true);

    window.localStorage.setItem('b', 'true');
    expect(safeGetBoolean('b', false)).toBe(true);

    window.localStorage.setItem('b', 'false');
    expect(safeGetBoolean('b', true)).toBe(false);

    window.localStorage.setItem('b', 'yes');
    expect(safeGetBoolean('b', true)).toBe(true);
  });

  it('manages outline width with positive-number guard', () => {
    expect(getOutlineWidth()).toBe(268);

    expect(setOutlineWidth(320)).toBe(true);
    expect(getOutlineWidth()).toBe(320);

    expect(setOutlineWidth(0)).toBe(false);
    expect(setOutlineWidth(Number.NaN)).toBe(false);
    expect(getOutlineWidth()).toBe(320);

    window.localStorage.setItem('outline_width', 'garbage');
    expect(getOutlineWidth()).toBe(268);
  });

  it('manages outline open state', () => {
    expect(getOutlineOpen(false)).toBe(false);
    expect(getOutlineOpen(true)).toBe(true);

    expect(setOutlineOpen(true)).toBe(true);
    expect(getOutlineOpen(false)).toBe(true);

    expect(setOutlineOpen(false)).toBe(true);
    expect(getOutlineOpen(true)).toBe(false);
  });

  it('scopes last-view ids per workspace and user', () => {
    expect(getLastViewId('w1', 'u1')).toBeNull();

    expect(setLastViewId('w1', 'u1', 'v1')).toBe(true);
    expect(getLastViewId('w1', 'u1')).toBe('v1');
    expect(getLastViewId('w1', 'u2')).toBeNull();
    expect(getLastViewId('w2', 'u1')).toBeNull();
  });

  it('rejects empty last-view keys instead of writing', () => {
    expect(setLastViewId('', 'u1', 'v1')).toBe(false);
    expect(setLastViewId('w1', '', 'v1')).toBe(false);
    expect(setLastViewId('w1', 'u1', '')).toBe(false);
  });

  it('survives thrown reads for outline helpers', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(getOutlineWidth(268)).toBe(268);
    expect(getOutlineOpen(true)).toBe(true);
    expect(getLastViewId('w', 'u')).toBeNull();
  });
});
