import { t } from 'i18next';

import { AccessLevel, CreatePagePayload, CreateSpacePayload, WorkspaceMember } from '@/application/types';

import { captureApiContext } from './http/request-context';

export const SPACE_CREATION_INTENT_CHANGED = 'appflowy:space-creation-intent';

export type SpaceCreationMember = { uid: string; userUuid?: string; accessLevel: AccessLevel };
export type SpaceCreationResult = { spaceId: string; initialPageId?: string };
export type SpaceCreationIntent = {
  payload: CreateSpacePayload & { view_id: string };
  initialPage?: CreatePagePayload & { view_id: string };
  selectedMembers: WorkspaceMember[];
  members: SpaceCreationMember[];
  appliedMemberUids: string[];
  committed?: SpaceCreationResult;
};

/** Saved data this build cannot read. It is kept until the user discards it, never replaced. */
export class InvalidSpaceCreationIntentError extends Error {
  constructor() {
    super(t('spaceCreation.invalidRecovery'));
    this.name = 'InvalidSpaceCreationIntentError';
  }
}

function isSpaceCreationIntent(value: unknown): value is SpaceCreationIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<SpaceCreationIntent>;
  const payload = intent.payload;

  return (
    !!payload &&
    typeof payload.view_id === 'string' &&
    !!payload.view_id &&
    typeof payload.name === 'string' &&
    !!payload.permission &&
    Array.isArray(intent.members) &&
    Array.isArray(intent.selectedMembers) &&
    Array.isArray(intent.appliedMemberUids) &&
    (!intent.initialPage || typeof intent.initialPage.view_id === 'string') &&
    (!intent.committed || intent.committed.spaceId === payload.view_id)
  );
}

/**
 * Persist submitted work before sending it. A missing server read cannot prove
 * a timed-out write will not commit, so recovery always keeps the original IDs.
 * Session storage isolates independent tabs while surviving reload and logout.
 */
export class SpaceCreationIntentStore {
  private readonly context = captureApiContext();
  readonly scopeKey: string;
  private readonly key: string;

  constructor(workspaceId: string, private readonly isMountedScopeCurrent: () => boolean = () => true) {
    this.scopeKey = JSON.stringify([this.context.serverUrl, this.context.userId, workspaceId]);
    this.key = `space-creation:v1:${this.scopeKey}`;
  }

  assertCurrent(): void {
    this.context.assertCurrent();
    if (!this.context.userId || !this.isMountedScopeCurrent()) {
      throw new Error(t('workspaceCreation.contextChanged'));
    }
  }

  snapshot(): SpaceCreationIntent | undefined {
    this.assertCurrent();
    const serialized = sessionStorage.getItem(this.key);

    if (!serialized) return;
    let value: unknown;

    try {
      value = JSON.parse(serialized);
    } catch {
      throw new InvalidSpaceCreationIntentError();
    }

    // Corrupt/unknown data stays retained until discarded; never overwrite it with a new ID.
    if (!isSpaceCreationIntent(value)) throw new InvalidSpaceCreationIntentError();
    return value;
  }

  begin(intent: SpaceCreationIntent): void {
    const previous = this.snapshot();

    if (previous) {
      if (JSON.stringify(previous.payload) !== JSON.stringify(intent.payload) ||
        JSON.stringify(previous.initialPage) !== JSON.stringify(intent.initialPage) ||
        JSON.stringify(previous.members) !== JSON.stringify(intent.members)) {
        throw new Error(t('spaceCreation.pendingRecovery'));
      }

      return;
    }

    this.write(intent);
  }

  committed(result: SpaceCreationResult): void {
    const intent = this.snapshot();

    if (!intent || intent.payload.view_id !== result.spaceId ||
      (intent.initialPage && intent.initialPage.view_id !== result.initialPageId)) {
      throw new InvalidSpaceCreationIntentError();
    }

    this.write({ ...intent, committed: result });
  }

  memberApplied(spaceId: string, uid: string): void {
    const intent = this.snapshot();

    if (!intent || intent.payload.view_id !== spaceId) throw new InvalidSpaceCreationIntentError();
    if (!intent.appliedMemberUids.includes(uid)) {
      this.write({ ...intent, appliedMemberUids: [...intent.appliedMemberUids, uid] });
    }
  }

  complete(result: SpaceCreationResult): void {
    const intent = this.snapshot();

    if (!intent?.committed || intent.committed.spaceId !== result.spaceId ||
      intent.committed.initialPageId !== result.initialPageId ||
      intent.members.some((member) => !intent.appliedMemberUids.includes(member.uid))) {
      throw new Error(t('spaceCreation.pendingRecovery'));
    }

    this.remove();
  }

  /**
   * Forget this tab's saved request, including unreadable data. A space that was already
   * created is unaffected; only the local recovery record goes away.
   */
  discard(): void {
    this.assertCurrent();
    this.remove();
  }

  private remove(): void {
    sessionStorage.removeItem(this.key);
    window.dispatchEvent(new Event(SPACE_CREATION_INTENT_CHANGED));
  }

  private write(intent: SpaceCreationIntent): void {
    this.assertCurrent();
    // Fail before mutation when storage is full; JSON is the same wire payload
    // shape used by these APIs, and keeps the saved draft independent of refs.
    sessionStorage.setItem(this.key, JSON.stringify(intent));
    window.dispatchEvent(new Event(SPACE_CREATION_INTENT_CHANGED));
  }
}
