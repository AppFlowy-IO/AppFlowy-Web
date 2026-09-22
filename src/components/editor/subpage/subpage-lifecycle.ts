import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { APP_EVENTS } from '@/application/constants';
import { YjsEditor } from '@/application/slate-yjs';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import {
  appendFirstEmptyParagraph,
  deleteBlock,
  getBlock,
  getChildrenArray,
  getDocument,
  getPageId,
} from '@/application/slate-yjs/utils/yjs';
import { BlockType, CollabOrigin, View, YjsEditorKey } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';

import { queueSubpageOperation } from './subpage-operations';

// Folder notifications are synced to peers, but are not new undoable user edits.
const folderNotificationOrigin = {};
const deletionKey = (id: string) => `subpage_deletion:${id}`;

type DeletionMarker = { token: string; blockIds?: string[]; completed: boolean; deletedAt?: string };
type Validation = 'move' | 'trash' | 'marker';

function readDeletionMarker(value: unknown): DeletionMarker | undefined {
  // Documents saved by the first lifecycle implementation used a bare token.
  if (typeof value === 'string') return { token: value, completed: true };
  if (value && typeof value === 'object' && 'token' in value && typeof value.token === 'string')
    return value as DeletionMarker;
  return undefined;
}

function collectSubpages(editor: YjsEditor): Map<string, string> {
  const pages = new Map<string, string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const block = getBlock(id, editor.sharedRoot);

    if (!block) return;
    if (block.get(YjsEditorKey.block_type) === BlockType.SubpageBlock) {
      try {
        const data = JSON.parse(block.get(YjsEditorKey.block_data));

        if (typeof data.view_id === 'string' && data.view_id) pages.set(id, data.view_id);
      } catch {
        // Incomplete remote blocks must not cause page mutations.
      }
    }

    getChildrenArray(block.get(YjsEditorKey.block_children), editor.sharedRoot)?.forEach(visit);
  };

  visit(getPageId(editor.sharedRoot));
  return pages;
}

/** Keep owned child pages in step with local document edits and their history. */
export function observeSubpageLifecycle(
  editor: YjsEditor,
  getContext: () => EditorContextState,
  onError: (error: unknown) => void
) {
  const doc = editor.sharedRoot.doc!;
  const metadata = getDocument(editor.sharedRoot).get(YjsEditorKey.meta) as Y.Map<unknown>;
  const events = getContext().eventEmitter;
  const deleted = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  const validations = new Map<string, Set<Validation>>();
  let previous = collectSubpages(editor);
  let disposed = false;
  // Keep the last observed state after disposal so queued operations can finish
  // reconciling an undo even if the editor and its Y.Doc have been destroyed.
  const isReferenced = (id: string) => [...previous.values()].includes(id);
  const referenceIds = (id: string) => [...previous].filter(([, viewId]) => viewId === id).map(([blockId]) => blockId);
  // Keep this marker outside undo history, including while the block is absent.
  // It reaches peers before an undo can reinsert the block, so even a newly
  // connected editor knows the trash entry belongs to a document deletion.
  const clearDeletion = (id: string, marker: DeletionMarker | undefined) => {
    if (!marker || readDeletionMarker(metadata.get(deletionKey(id)))?.token !== marker.token) return;
    doc.transact(() => metadata.delete(deletionKey(id)), folderNotificationOrigin);
  };

  const reconcile = (id: string, blockIds: string[] = []) => {
    const context = getContext();
    const operation = queueSubpageOperation(context.workspaceId, id, async () => {
      if (editor.readOnly) return;

      if (isReferenced(id)) {
        if (deleted.has(id) && context.restorePage) {
          const marker = readDeletionMarker(metadata.get(deletionKey(id)));

          await context.restorePage(id);
          deleted.delete(id);
          clearDeletion(id, marker);
        }
      } else if (!deleted.has(id) && context.deletePage && context.loadViewMeta) {
        // A pasted reference or a page moved elsewhere is not owned by this
        // document. A failed lookup is never evidence that it should be deleted.
        const trash = await context.loadTrashViews?.();

        if (trash?.some((view) => view.view_id === id)) return;
        const view = await context.loadViewMeta(id, undefined, { authoritative: true });

        if (view?.parent_view_id !== context.viewId || isReferenced(id) || editor.readOnly) return;
        const marker: DeletionMarker = { token: nanoid(), blockIds, completed: false };

        doc.transact(() => metadata.set(deletionKey(id), marker), folderNotificationOrigin);
        try {
          await context.deletePage(id);
          deleted.add(id);
        } catch (error) {
          clearDeletion(id, marker);
          throw error;
        }

        // Bind protection to this particular trash entry. A later sidebar
        // deletion must not inherit a marker whose owner has left the document.
        let deletedAt: string | undefined;

        try {
          deletedAt = (await context.loadTrashViews?.())?.find((view) => view.view_id === id)?.deleted_at;
        } catch (error) {
          onError(error);
        }

        if (readDeletionMarker(metadata.get(deletionKey(id)))?.token === marker.token) {
          doc.transact(
            () => metadata.set(deletionKey(id), { ...marker, completed: true, deletedAt }),
            folderNotificationOrigin
          );
        }
      }
    }).catch(onError);

    pending.set(id, operation);
    void operation.then(() => {
      if (pending.get(id) === operation) pending.delete(id);
      if (isReferenced(id) && metadata.has(deletionKey(id))) validateReference(id, 'marker');
    });
  };

  const handleTransaction = (transaction: Y.Transaction) => {
    // Yjs array reads can emit empty transactions. Text edits cannot change
    // page ownership, so neither needs another structural scan.
    if (![...transaction.changed.keys()].some((type) => !(type instanceof Y.Text))) return;
    const current = collectSubpages(editor);
    const before = previous;
    const beforeIds = new Set(previous.values());
    const afterIds = new Set(current.values());
    const metadataKeys = [...transaction.changed].find(([type]) => type instanceof Y.Map && type === metadata)?.[1];

    previous = current;
    const local =
      (transaction.local && transaction.origin === null) ||
      transaction.origin === CollabOrigin.Local ||
      transaction.origin === CollabOrigin.LocalManual ||
      (YHistoryEditor.isYHistoryEditor(editor) && transaction.origin === editor.undoManager);

    if (editor.readOnly) return;
    if (local) {
      beforeIds.forEach((id) => {
        if (!afterIds.has(id)) reconcile(id, [...before].filter(([, viewId]) => viewId === id).map(([blockId]) => blockId));
      });
    }

    afterIds.forEach((id) => {
      if (local && !beforeIds.has(id) && (deleted.has(id) || pending.has(id))) reconcile(id, referenceIds(id));
      if (metadata.has(deletionKey(id)) && (
        !beforeIds.has(id) || metadataKeys?.has(deletionKey(id)) ||
        [...current].some(([blockId, viewId]) => viewId === id && !before.has(blockId))
      )) validateReference(id, 'marker');
    });
  };

  const removeReferences = (ids: Set<string>) => {
    if (disposed || editor.readOnly || ![...previous.values()].some((id) => ids.has(id))) return;
    editor.flushLocalChanges();
    doc.transact(() => {
      collectSubpages(editor).forEach((id, blockId) => {
        if (ids.has(id)) deleteBlock(editor.sharedRoot, blockId);
      });
      const page = getBlock(getPageId(editor.sharedRoot), editor.sharedRoot);

      if (getChildrenArray(page.get(YjsEditorKey.block_children), editor.sharedRoot).length === 0) {
        appendFirstEmptyParagraph(editor.sharedRoot, '');
      }
    }, folderNotificationOrigin);
  };

  const validateReference = (id: string, reason: Validation) => {
    if (disposed || editor.readOnly || !isReferenced(id)) return;
    const running = validations.get(id);

    if (running) {
      running.add(reason);
      return;
    }

    const requested = new Set<Validation>([reason]);

    validations.set(id, requested);
    void (async () => {
      while (requested.size && !disposed && !editor.readOnly && isReferenced(id)) {
        const reasons = new Set(requested);

        requested.clear();
        const context = getContext();

        // In particular, wait until a cut paste has committed or compensated
        // its move before interpreting an outline response from that move.
        await queueSubpageOperation(context.workspaceId, id, async () => {
          if (disposed || editor.readOnly || !isReferenced(id)) return;
          const blocks = referenceIds(id).join(',');
          const rawMarker = metadata.get(deletionKey(id));
          const marker = readDeletionMarker(rawMarker);
          const checkTrash = reasons.has('trash') || !!marker;
          const [trash, view] = await Promise.all([
            checkTrash ? context.loadTrashViews?.() : undefined,
            reasons.has('move') ? context.loadViewMeta?.(id, undefined, { authoritative: true }) : undefined,
          ]);

          if (disposed || editor.readOnly || !isReferenced(id)) return;
          if (blocks !== referenceIds(id).join(',') || rawMarker !== metadata.get(deletionKey(id))) {
            reasons.forEach((value) => requested.add(value));
            return;
          }

          if (pending.has(id)) return;
          if (view?.parent_view_id && view.parent_view_id !== context.viewId) {
            clearDeletion(id, marker);
            deleted.delete(id);
            removeReferences(new Set([id]));
            return;
          }

          const trashed = trash?.find((item) => item.view_id === id);
          const sameBlocks = !marker?.blockIds || referenceIds(id).some((blockId) => marker.blockIds!.includes(blockId));
          const sameDeletion = !marker?.deletedAt || !trashed?.deleted_at || marker.deletedAt === trashed.deleted_at;

          if (marker) {
            if (!sameBlocks || !sameDeletion || (trash && !trashed && (marker.completed || marker.deletedAt))) {
              clearDeletion(id, marker);
              deleted.delete(id);
            } else if (trashed) {
              if (!marker.deletedAt && trashed.deleted_at) {
                doc.transact(
                  () => metadata.set(deletionKey(id), { ...marker, deletedAt: trashed.deleted_at }),
                  folderNotificationOrigin
                );
              }

              // The original deletion is still visible while an undo is
              // restoring it. Peers must retain the reinserted block.
              return;
            }
          }

          if (trashed) removeReferences(new Set([id]));
        });
      }
    })().catch(onError).finally(() => validations.delete(id));
  };

  const handleView = (view: View) => {
    // Missing outline entries are normal for lazily loaded folders. Only an
    // explicit parent change or trash notification removes a subpage block.
    if (view.parent_view_id && view.parent_view_id !== getContext().viewId) validateReference(view.view_id, 'move');
  };

  const handleOutline = (views: View[]) => {
    const moved = new Set<string>();
    const visit = (items: View[]) =>
      items.forEach((view) => {
        if (view.parent_view_id && view.parent_view_id !== getContext().viewId) moved.add(view.view_id);
        if (view.children) visit(view.children);
      });

    visit(views);
    moved.forEach((id) => validateReference(id, 'move'));
  };

  const handleTrash = (payload: { workspaceId?: string; trashItems?: View[] }) => {
    if (payload.workspaceId && payload.workspaceId !== getContext().workspaceId) return;
    const candidates = new Set(payload.trashItems?.map((view) => view.view_id));

    // Empty trash updates also acknowledge restorations whose marker cleanup
    // was lost when the originating editor disconnected.
    previous.forEach((id) => {
      if (candidates.has(id)) validateReference(id, 'trash');
      else if (metadata.has(deletionKey(id))) validateReference(id, 'marker');
    });
  };

  doc.on('afterTransaction', handleTransaction);
  events?.on(APP_EVENTS.VIEW_META_CHANGED, handleView);
  events?.on(APP_EVENTS.OUTLINE_LOADED, handleOutline);
  events?.on(APP_EVENTS.TRASH_UPDATED, handleTrash);
  previous.forEach((id) => {
    if (metadata.has(deletionKey(id))) validateReference(id, 'marker');
  });
  return () => {
    disposed = true;
    doc.off('afterTransaction', handleTransaction);
    events?.off(APP_EVENTS.VIEW_META_CHANGED, handleView);
    events?.off(APP_EVENTS.OUTLINE_LOADED, handleOutline);
    events?.off(APP_EVENTS.TRASH_UPDATED, handleTrash);
  };
}
