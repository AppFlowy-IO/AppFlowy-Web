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
    const value = JSON.parse(serialized) as SpaceCreationIntent;

    if (!value?.payload || typeof value.payload.view_id !== 'string' ||
      !value.payload.view_id || typeof value.payload.name !== 'string' ||
      !value.payload.permission || !Array.isArray(value.members) ||
      !Array.isArray(value.selectedMembers) || !Array.isArray(value.appliedMemberUids) ||
      (value.initialPage && typeof value.initialPage.view_id !== 'string') ||
      (value.committed && value.committed.spaceId !== value.payload.view_id)) {
      // Corrupt/unknown data stays retained; never overwrite it with a new ID.
      throw new Error(t('spaceCreation.invalidRecovery'));
    }

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
      throw new Error(t('spaceCreation.invalidRecovery'));
    }

    this.write({ ...intent, committed: result });
  }

  memberApplied(spaceId: string, uid: string): void {
    const intent = this.snapshot();

    if (!intent || intent.payload.view_id !== spaceId) throw new Error(t('spaceCreation.invalidRecovery'));
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
