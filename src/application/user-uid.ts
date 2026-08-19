export type UserUid = string | number | bigint | null | undefined;

const MAX_I64 = 9_223_372_036_854_775_807n;

/**
 * Return a positive signed-64-bit user ID as a canonical decimal string.
 *
 * User IDs are larger than JavaScript's safe-integer range. Keeping the
 * canonical value as a string prevents later String(number) conversions from
 * changing the final digits while remaining a primitive Yjs value.
 */
export function canonicalizeUserUid(uid: UserUid): string | null {
  if (uid === null || uid === undefined) return null;

  let value: bigint;

  try {
    if (typeof uid === 'bigint') {
      value = uid;
    } else if (typeof uid === 'number') {
      // Once a JSON number exceeds the safe-integer range its low digits may
      // already be rounded. Reject it instead of canonically preserving the
      // wrong user ID; exact large IDs must arrive as a string or bigint.
      if (!Number.isSafeInteger(uid)) return null;
      value = BigInt(uid);
    } else {
      const trimmed = uid.trim();

      if (!/^\d+$/.test(trimmed)) return null;
      value = BigInt(trimmed);
    }
  } catch {
    return null;
  }

  return value > 0n && value <= MAX_I64 ? value.toString() : null;
}

/**
 * Preserve the legacy current-user identity while exposing a separate value
 * that is safe to persist in automatic attribution fields.
 */
export function resolveCurrentUserUid(uid: string | number, uidString?: string) {
  const attributionUid = canonicalizeUserUid(uidString) ?? canonicalizeUserUid(uid);

  return {
    uid: attributionUid ?? String(uid),
    attributionUid,
  };
}

/**
 * Whether two user IDs refer to the same user, tolerating the precision a
 * large uid loses when it travels as a JSON number.
 *
 * The current user's uid is an exact decimal string (from `uid_string`), but
 * ids like `workspace.owner_uid` still arrive as JSON numbers above
 * `Number.MAX_SAFE_INTEGER`. Plain `toString()` comparison then fails even
 * when the double holds the value exactly, because `Number.prototype.toString`
 * prints the SHORTEST decimal that round-trips — `626259007224418304` prints
 * as `"626259007224418300"`. When either side has been through a float64,
 * compare both sides AS floats so they collapse onto the same rounded value.
 */
export function isSameUserUid(left: UserUid, right: UserUid): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return false;

  const leftExact = canonicalizeUserUid(left);
  const rightExact = canonicalizeUserUid(right);

  if (leftExact !== null && rightExact !== null) return leftExact === rightExact;

  const leftNumber = Number(left);
  const rightNumber = Number(right);

  return Number.isFinite(leftNumber) && leftNumber === rightNumber;
}
