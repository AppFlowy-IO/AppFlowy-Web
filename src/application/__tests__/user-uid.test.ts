import { resolveUserAttributionUid } from '@/application/database-yjs/attribution';
import { canonicalizeUserUid, isSameUserUid, resolveCurrentUserUid } from '@/application/user-uid';

describe('canonicalizeUserUid', () => {
  it('preserves exact signed-64-bit IDs supplied as strings or bigints', () => {
    expect(canonicalizeUserUid('9223372036854775807')).toBe('9223372036854775807');
    expect(canonicalizeUserUid(9_007_199_254_740_993n)).toBe('9007199254740993');
  });

  it('accepts only safe positive integer numbers', () => {
    expect(canonicalizeUserUid(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(canonicalizeUserUid(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(canonicalizeUserUid(1.5)).toBeNull();
    expect(canonicalizeUserUid(0)).toBeNull();
  });

  it('rejects malformed and out-of-range values', () => {
    expect(canonicalizeUserUid('1.5')).toBeNull();
    expect(canonicalizeUserUid('-1')).toBeNull();
    expect(canonicalizeUserUid('9223372036854775808')).toBeNull();
    expect(canonicalizeUserUid(undefined)).toBeNull();
  });
});

describe('resolveCurrentUserUid', () => {
  it('uses uid_string as the lossless attribution identity', () => {
    expect(resolveCurrentUserUid(Number.MAX_SAFE_INTEGER + 1, '9007199254740993')).toEqual({
      uid: '9007199254740993',
      attributionUid: '9007199254740993',
    });
  });

  it('keeps a lossy legacy identity out of automatic attribution', () => {
    expect(resolveCurrentUserUid(Number.MAX_SAFE_INTEGER + 1)).toEqual({
      uid: String(Number.MAX_SAFE_INTEGER + 1),
      attributionUid: null,
    });
  });
});

describe('resolveUserAttributionUid', () => {
  it('uses a validated exact UID marker', () => {
    expect(resolveUserAttributionUid({ uid: 'legacy', attributionUid: '9007199254740993' })).toBe(
      '9007199254740993'
    );
  });

  it('does not fall back to a known-lossy legacy profile UID', () => {
    expect(resolveUserAttributionUid({ uid: '9007199254740992', attributionUid: null })).toBeNull();
  });

  it('does not guess whether a legacy stored profile UID was lossless', () => {
    expect(resolveUserAttributionUid({ uid: '9007199254740993' })).toBeNull();
  });
});

describe('isSameUserUid', () => {
  it('compares exact identities exactly', () => {
    expect(isSameUserUid('9007199254740993', '9007199254740993')).toBe(true);
    expect(isSameUserUid('9007199254740993', 9_007_199_254_740_993n)).toBe(true);
    expect(isSameUserUid('9007199254740993', '9007199254740995')).toBe(false);
    expect(isSameUserUid(42, '42')).toBe(true);
  });

  it('matches an exact uid_string against the same uid rounded through JSON', () => {
    // 626259007224418304 is exactly float64-representable, but
    // Number.prototype.toString prints the SHORTEST round-trip decimal
    // ("…300"), so the old string comparison failed even for this uid.
    expect(isSameUserUid(626259007224418304, '626259007224418304')).toBe(true);
    // …816 arrives as a JSON number that prints as "…800".
    expect(isSameUserUid('626253857260834816', 626253857260834800)).toBe(true);
  });

  it('does not equate distinct users or invalid identities', () => {
    expect(isSameUserUid('not-a-uid', 'not-a-uid')).toBe(false);
    expect(isSameUserUid(null, 42)).toBe(false);
    expect(isSameUserUid(undefined, undefined)).toBe(false);
    expect(isSameUserUid('9007199254740993', 12345)).toBe(false);
  });
});
