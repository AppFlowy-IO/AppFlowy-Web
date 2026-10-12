import { t } from 'i18next';
import { v4 as uuid } from 'uuid';

import { CreateWorkspacePayload } from '@/application/types';
import { isUnsupportedRouteError } from '@/utils/errors';

import { captureApiContext } from './http/request-context';
import { WorkspaceCreationReceipt } from './http/workspace-api';

type Draft = { requestId: string; name: string; workspaceId?: string };
type Create = (payload: CreateWorkspacePayload, receipt: WorkspaceCreationReceipt) => Promise<string>;

/**
 * One recoverable creation per tab/account/server. Persist the immutable input
 * before sending; an ambiguous response must never cause a fresh request ID.
 * Tab storage avoids unrelated tabs overwriting each other's pending actions.
 */
export class WorkspaceCreationAttempt {
  private readonly scope = captureApiContext();
  private readonly key = `workspace-creation:v1:${JSON.stringify([this.scope.serverUrl, this.scope.userId])}`;
  private pending?: Promise<string>;

  constructor(private readonly create: Create) {}

  snapshot(): Draft | undefined {
    this.scope.assertCurrent();
    const serialized = sessionStorage.getItem(this.key);

    if (!serialized) return;
    const draft = JSON.parse(serialized) as Draft;

    if (typeof draft.requestId !== 'string' || typeof draft.name !== 'string' ||
      (draft.workspaceId !== undefined && typeof draft.workspaceId !== 'string')) {
      throw new Error(t('workspaceCreation.invalidDraft'));
    }

    return draft;
  }

  run(name: string): Promise<string> {
    if (this.pending) return this.pending;
    this.pending = this.submit(name).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async submit(name: string): Promise<string> {
    const previous = this.snapshot();
    const draft = previous ?? { requestId: uuid(), name };

    if (previous && name !== previous.name) throw new Error(t('workspaceCreation.immutableDraft'));
    if (draft.workspaceId) return draft.workspaceId;
    // Storage failure stops before mutation; retaining only a memory key would
    // make reload after a lost response unsafe.
    sessionStorage.setItem(this.key, JSON.stringify(draft));
    try {
      const workspaceId = await this.create({ workspace_name: draft.name }, {
        requestId: draft.requestId, replay: Boolean(previous),
      });

      this.scope.assertCurrent();
      sessionStorage.setItem(this.key, JSON.stringify({ ...draft, workspaceId }));
      return workspaceId;
    } catch (error) {
      this.scope.assertCurrent();
      // Even a later 404 may come from an old node after an earlier request
      // committed. Never convert this attempt to the unkeyed legacy endpoint.
      if (isUnsupportedRouteError(error)) throw new Error(t('workspaceCreation.receiptUnsupported'));
      throw error;
    }
  }

  complete(workspaceId: string): void {
    if (this.snapshot()?.workspaceId === workspaceId) sessionStorage.removeItem(this.key);
  }
}
