import { t } from 'i18next';
import { v4 as uuid } from 'uuid';

import { ERROR_CODE } from '@/application/constants';
import { CreateWorkspacePayload } from '@/application/types';
import { getAPIErrorCode, isUnsupportedRouteError } from '@/utils/errors';

import { captureApiContext } from './http/request-context';
import { CreateWorkspaceOptions } from './http/workspace-api';

export type WorkspaceCreationDraft = { requestId: string; name: string; workspaceId?: string };
type Create = (payload: CreateWorkspacePayload, options: CreateWorkspaceOptions) => Promise<string>;

/** Self-hosted license seat admission (`ErrorCode::LicenseLimitHit`). */
const LICENSE_LIMIT_HIT = 1120;

/**
 * Answers after which no workspace exists for the request ID. The server records a receipt only in
 * the transaction that creates the workspace, and resolves an existing receipt before any other
 * check, so these rejections cannot hide an earlier commit.
 */
const DEFINITIVE_CODES = new Set<number>([
  ERROR_CODE.INVALID_REQUEST,
  ERROR_CODE.NOT_HAS_PERMISSION,
  ERROR_CODE.RECORD_ALREADY_EXISTS,
  ERROR_CODE.RECORD_NOT_FOUND,
  ERROR_CODE.NOT_LOGGED_IN,
  ERROR_CODE.USER_UNAUTHORIZED,
  ERROR_CODE.WORKSPACE_LIMIT_EXCEEDED,
  ERROR_CODE.WORKSPACE_MEMBER_LIMIT_EXCEEDED,
  LICENSE_LIMIT_HIT,
]);
const DEFINITIVE_STATUSES = new Set([400, 401, 403, 409, 422]);
const UNREADABLE_DRAFT = 'UnreadableWorkspaceCreationDraft';

/** Storage holds a saved request this version cannot read; only Discard clears it. */
export function isUnreadableDraftError(error: unknown): boolean {
  return error instanceof Error && error.name === UNREADABLE_DRAFT;
}

function isDraft(value: unknown): value is WorkspaceCreationDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as Partial<WorkspaceCreationDraft>;

  return (
    typeof draft.requestId === 'string' &&
    typeof draft.name === 'string' &&
    (draft.workspaceId === undefined || typeof draft.workspaceId === 'string')
  );
}

function httpStatusOf(error: unknown): number | undefined {
  const status = (error as { httpStatus?: unknown } | null)?.httpStatus;

  return typeof status === 'number' ? status : undefined;
}

/**
 * Decide what a failed keyed POST means for its saved request. Only a definitive answer releases
 * it; anything that may have committed keeps it so Check again can replay the same request ID.
 */
function settleFailure(error: unknown, firstSend: boolean): { release: boolean; error: unknown } {
  const code = getAPIErrorCode(error);
  const status = httpStatusOf(error);

  if (isUnsupportedRouteError(error)) {
    // A first request that reaches a node without the keyed route created nothing. A later 404 may
    // come from an old node after an earlier attempt committed on a current one.
    return firstSend
      ? { release: true, error: new Error(t('workspaceCreation.tryAgainLater'), { cause: error }) }
      : { release: false, error: new Error(t('workspaceCreation.notConfirmed'), { cause: error }) };
  }

  if (code === ERROR_CODE.NOT_HAS_PERMISSION || status === 403) {
    return { release: true, error: new Error(t('workspaceCreation.denied'), { cause: error }) };
  }

  if ((code !== undefined && DEFINITIVE_CODES.has(code)) || (status !== undefined && DEFINITIVE_STATUSES.has(status))) {
    return { release: true, error };
  }

  return { release: false, error: new Error(t('workspaceCreation.notConfirmed'), { cause: error }) };
}

/**
 * One recoverable creation per tab/account/server. A request ID is saved only after admission
 * passes, immediately before the keyed request is sent, and an unconfirmed outcome must never cause
 * a fresh request ID. Definitive rejections release it; Discard forgets it on request. Tab storage
 * keeps unrelated tabs from overwriting each other's pending requests.
 */
export class WorkspaceCreationAttempt {
  private readonly scope = captureApiContext();
  private readonly key = `workspace-creation:v1:${JSON.stringify([this.scope.serverUrl, this.scope.userId])}`;
  private pending?: Promise<string>;

  constructor(private readonly create: Create) {}

  snapshot(): WorkspaceCreationDraft | undefined {
    this.scope.assertCurrent();
    const serialized = sessionStorage.getItem(this.key);

    if (!serialized) return;
    let draft: unknown;

    try {
      draft = JSON.parse(serialized);
    } catch {
      draft = undefined;
    }

    if (!isDraft(draft)) {
      // Keep the unreadable value: it may name a request that committed. Only Discard removes it.
      const error = new Error(t('workspaceCreation.invalidDraft'));

      error.name = UNREADABLE_DRAFT;
      throw error;
    }

    return draft;
  }

  run(name: string): Promise<string> {
    if (this.pending) return this.pending;
    this.pending = this.submit(name).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** Forget the saved request, including an unreadable one. A workspace it created stays listed. */
  discard(): void {
    this.scope.assertCurrent();
    if (this.pending) return;
    sessionStorage.removeItem(this.key);
  }

  complete(workspaceId: string): void {
    if (this.snapshot()?.workspaceId === workspaceId) sessionStorage.removeItem(this.key);
  }

  private async submit(name: string): Promise<string> {
    const previous = this.snapshot();

    if (previous && name !== previous.name) throw new Error(t('workspaceCreation.immutableDraft'));
    if (previous?.workspaceId) return previous.workspaceId;
    let draft = previous;

    try {
      const workspaceId = await this.create(
        { workspace_name: previous?.name ?? name },
        previous
          ? { replay: previous.requestId }
          : {
              reserve: () => {
                const reserved = { requestId: uuid(), name };

                // A storage failure stops before sending; a memory-only ID would make a reload after
                // a lost response unsafe.
                sessionStorage.setItem(this.key, JSON.stringify(reserved));
                draft = reserved;
                return reserved.requestId;
              },
            }
      );

      this.scope.assertCurrent();
      // Keep the confirmed ID until the caller opens it, so a retry never creates another workspace.
      // A legacy server has no request ID to replay; the saved one is never sent.
      sessionStorage.setItem(this.key, JSON.stringify({ ...(draft ?? { requestId: uuid(), name }), workspaceId }));
      return workspaceId;
    } catch (error) {
      this.scope.assertCurrent();
      // Without a reserved request nothing keyed was sent: admission failed or the legacy route ran.
      if (!draft) throw error;
      const outcome = settleFailure(error, !previous);

      if (outcome.release) sessionStorage.removeItem(this.key);
      throw outcome.error;
    }
  }
}
