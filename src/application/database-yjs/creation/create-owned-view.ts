import { DatabaseViewLayout } from '@/application/types';
import { isDatabaseContainer, isEmbeddedDatabaseViewWithoutChildren, isEmbeddedView } from '@/application/view-utils';

import { createDefaultDatabaseView } from './create-default-view';

import type { DatabaseViewDocDeps } from '../database-view-doc-ops';

interface OwnedViewIntent {
  anchorViewId: string;
  sourceViewId?: string;
  databaseId: string;
  owner: string;
  layout: DatabaseViewLayout;
  name: string;
  recoveryKey: string;
}

/** The existing journal owns creation and recovery; a failed reply never starts another legacy clone. */
export async function createOwnedDefaultDatabaseView(deps: DatabaseViewDocDeps, intent: OwnedViewIntent): Promise<string> {
  const { workspaceId, loadViewMeta } = deps;

  if (!workspaceId || !loadViewMeta) throw new Error('Dashboard view creation is not available');
  const assertCurrent = () => {
    if (deps.readOnly || deps.canWrite === false) throw new Error('Edit access is required to create a dashboard widget');
  };

  assertCurrent();
  const current = await loadViewMeta(intent.anchorViewId, undefined, { authoritative: true });

  if (!current) throw new Error('The widget source is no longer in Folder');
  const parent = isDatabaseContainer(current) && !isEmbeddedDatabaseViewWithoutChildren(current)
    ? current
    : current.parent_view_id
      ? await loadViewMeta(current.parent_view_id, undefined, { authoritative: true })
      : undefined;

  if (!parent || (!isDatabaseContainer(parent) && !isEmbeddedView(current) && !deps.isDocumentBlock)) {
    throw new Error('The widget source has no current Database container');
  }

  assertCurrent();
  return createDefaultDatabaseView({
    workspaceId, databaseDoc: deps.databaseDoc, databaseId: intent.databaseId,
    parentViewId: parent.view_id, sourceViewId: intent.sourceViewId,
    layout: intent.layout, name: intent.name,
    embedded: isDatabaseContainer(parent) ? isEmbeddedView(parent) : isEmbeddedView(current) || Boolean(deps.isDocumentBlock),
    dashboardOwner: intent.owner, recoveryKey: intent.recoveryKey, assertCurrent,
  });
}
