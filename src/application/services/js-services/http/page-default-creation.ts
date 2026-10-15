import { v4 as uuidv4 } from 'uuid';

import {
  assertAtomicCreationAvailable,
  atomicRead,
  AtomicCreationOwner,
  AtomicCreationRecord,
  AtomicCreationPendingError,
  captureAtomicCreationOwner,
  findPendingAtomicCreation,
  CreateDefaultDatabasePageRequest,
  CreateDefaultDocumentPageRequest,
  parseAtomicCreationRequest,
  recoverAtomicCreation,
  runAtomicCreation,
} from '@/application/atomic-creation';
import { CreatePagePayload, CreatePageResponse, DatabaseViewLayout, View, ViewLayout } from '@/application/types';
import { isDatabaseLayout, isSpaceView } from '@/application/view-utils';

import { verifyCreatedPage } from './created-page-hydration';

export interface PageCreationActivation {
  /** Captures the application owner, including workspace changes while a request is pending. */
  assertCurrent?: () => void;
  /** The outline owner installs current navigation before the caller may select this page. */
  activate?: (page: CreatePageResponse) => Promise<void>;
}

const DATABASE_LAYOUTS: Partial<Record<ViewLayout, { layout: DatabaseViewLayout; name: string }>> = {
  [ViewLayout.Grid]: { layout: DatabaseViewLayout.Grid, name: 'Grid' },
  [ViewLayout.Board]: { layout: DatabaseViewLayout.Board, name: 'Board' },
  [ViewLayout.Calendar]: { layout: DatabaseViewLayout.Calendar, name: 'Calendar' },
  [ViewLayout.Chart]: { layout: DatabaseViewLayout.Chart, name: 'Chart' },
  [ViewLayout.List]: { layout: DatabaseViewLayout.List, name: 'List' },
  [ViewLayout.Gallery]: { layout: DatabaseViewLayout.Gallery, name: 'Gallery' },
  [ViewLayout.Feed]: { layout: DatabaseViewLayout.Feed, name: 'Feed' },
  [ViewLayout.Form]: { layout: DatabaseViewLayout.Form, name: 'Form' },
  [ViewLayout.Timeline]: { layout: DatabaseViewLayout.Timeline, name: 'Timeline' },
};

/** Authored imports keep their explicit content path; never turn a supplied body into a blank page. */
export function usesDefaultPageCreation(payload: CreatePagePayload): boolean {
  return payload.page_data === undefined && (payload.layout === ViewLayout.Document || isDatabaseLayout(payload.layout));
}

export function prepareDefaultPage(
  workspaceId: string,
  parent: View,
  payload: CreatePagePayload,
  newId: () => string = uuidv4,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
):
  | { kind: 'document'; request: CreateDefaultDocumentPageRequest; selectedViewId: string }
  | { kind: 'database'; request: CreateDefaultDatabasePageRequest; selectedViewId: string } {
  if (!usesDefaultPageCreation(payload)) throw new Error('This page requires an authored creation request');
  const previousIndex = payload.prev_view_id
    ? parent.children.findIndex((child) => child.view_id === payload.prev_view_id)
    : -1;

  if (payload.prev_view_id && previousIndex < 0) throw new Error('The insertion sibling is no longer in this parent');
  // HTTP children exclude trashed and unreadable siblings; their indexes are not
  // physical Folder positions. Resolve appends and sibling anchors on the server.
  const position: CreateDefaultDocumentPageRequest['position'] = payload.prev_view_id
    ? previousIndex === parent.children.length - 1
      ? { kind: 'end' }
      : { kind: 'after', view_id: payload.prev_view_id }
    : { kind: 'start' };
  const common = {
    schema_version: 'v1' as const,
    request_id: newId(),
    parent_view_id: parent.view_id,
    name: payload.name ?? '',
    position,
  };
  const viewId = payload.view_id ?? newId();

  if (payload.layout === ViewLayout.Document) {
    return { kind: 'document', request: { ...common, view_id: viewId }, selectedViewId: viewId };
  }

  const layout = DATABASE_LAYOUTS[payload.layout];

  if (!layout) throw new Error('Unsupported default database layout');
  const embedded = parent.view_id !== workspaceId && parent.layout === ViewLayout.Document && !isSpaceView(parent);
  const primaryViewId = newId();
  const withoutInitialRows = [ViewLayout.Calendar, ViewLayout.Timeline, ViewLayout.Form].includes(payload.layout);

  return {
    kind: 'database',
    selectedViewId: embedded || payload.layout === ViewLayout.Form ? primaryViewId : viewId,
    request: {
      ...common,
      container_id: viewId,
      database: {
        database_id: newId(),
        view_id: primaryViewId,
        name: layout.name,
        layout: layout.layout,
        embedded,
        responses_view_id: payload.layout === ViewLayout.Form ? newId() : null,
        initial_row_ids: withoutInitialRows ? [] : [newId(), newId(), newId()],
        timezone_id: [ViewLayout.Calendar, ViewLayout.Timeline].includes(payload.layout) ? timezone : null,
      },
    },
  };
}

export { verifyCreatedPage } from './created-page-hydration';

export async function createDefaultPage(
  workspaceId: string,
  parentViewId: string,
  payload: CreatePagePayload,
  activation: PageCreationActivation = {}
): Promise<CreatePageResponse> {
  const owner = captureAtomicCreationOwner(workspaceId, activation.assertCurrent);

  // Create Space keeps its initial Document ID across Retry/Close. Recover that
  // exact command before preparing a new recipe or rechecking capability flags.
  if (payload.layout === ViewLayout.Document && payload.view_id) {
    const pending = await findPendingAtomicCreation(owner, 'document', payload.view_id);

    if (pending) {
      const saved = parseAtomicCreationRequest(pending);

      if (saved.parent_view_id !== parentViewId || saved.view_id !== payload.view_id) {
        throw new AtomicCreationPendingError(pending, new Error('Saved initial page belongs to another parent'));
      }

      return recoverDefaultPage(owner, pending, activation);
    }
  }

  assertAtomicCreationAvailable(owner);
  const parent = await atomicRead<View>(owner, `/api/workspace/${workspaceId}/view/${parentViewId}`, { depth: 1 });

  if (parent.view_id !== parentViewId) throw new Error('Creation parent identity differs');
  owner.assertCurrent();
  const prepared = prepareDefaultPage(workspaceId, parent, payload);
  const hydrate = async () => {
    const result = await verifyCreatedPage(owner, prepared);

    owner.assertCurrent();
    await activation.activate?.(result);
    owner.assertCurrent();
    return result;
  };

  return prepared.kind === 'document'
    ? runAtomicCreation({ owner, kind: 'document', request: prepared.request, logicalTarget: prepared.selectedViewId, hydrate })
    : runAtomicCreation({ owner, kind: 'database', request: prepared.request, logicalTarget: prepared.selectedViewId, hydrate });
}

/** Explicit recovery uses the saved command, including its chosen IDs, placement and timezone. */
export async function recoverDefaultPage(
  owner: AtomicCreationOwner,
  record: AtomicCreationRecord,
  activation: PageCreationActivation = {}
): Promise<CreatePageResponse> {
  const hydrate = async (prepared: ReturnType<typeof prepareDefaultPage>) => {
    const result = await verifyCreatedPage(owner, prepared);

    owner.assertCurrent();
    await activation.activate?.(result);
    owner.assertCurrent();
    return result;
  };

  if (record.kind === 'document') {
    const documentRecord = record as AtomicCreationRecord<'document'>;
    const request = parseAtomicCreationRequest(documentRecord);

    if (record.logicalTarget !== request.view_id) throw new Error('Saved document selection differs');
    return recoverAtomicCreation({ owner, record: documentRecord, hydrate: () => hydrate({ kind: 'document', request, selectedViewId: request.view_id }) });
  }

  if (record.kind === 'database') {
    const databaseRecord = record as AtomicCreationRecord<'database'>;
    const request = parseAtomicCreationRequest(databaseRecord);

    if (record.logicalTarget !== request.container_id && record.logicalTarget !== request.database.view_id) {
      throw new Error('Saved database selection differs');
    }

    return recoverAtomicCreation({ owner, record: databaseRecord, hydrate: () => hydrate({ kind: 'database', request, selectedViewId: record.logicalTarget }) });
  }

  throw new Error('This creation must be recovered from its source database');
}
