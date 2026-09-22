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
  let previous = collectSubpages(editor);
  let disposed = false;
  // Keep the last observed state after disposal so queued operations can finish
  // reconciling an undo even if the editor and its Y.Doc have been destroyed.
  const isReferenced = (id: string) => [...previous.values()].includes(id);
  // Keep this marker outside undo history, including while the block is absent.
  // It reaches peers before an undo can reinsert the block, so even a newly
  // connected editor knows the trash entry belongs to a document deletion.
  const clearDeletion = (id: string, marker: unknown) => {
    if (!marker || metadata.get(deletionKey(id)) !== marker) return;
    doc.transact(() => metadata.delete(deletionKey(id)), folderNotificationOrigin);
  };

  const isReconciling = (id: string) => pending.has(id) || deleted.has(id) || metadata.has(deletionKey(id));

  const reconcile = (id: string) => {
    const context = getContext();
    const operation = queueSubpageOperation(context.workspaceId, id, async () => {
      if (editor.readOnly) return;

      if (isReferenced(id)) {
        if (deleted.has(id) && context.restorePage) {
          const marker = metadata.get(deletionKey(id));

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
        const marker = nanoid();

        doc.transact(() => metadata.set(deletionKey(id), marker), folderNotificationOrigin);
        try {
          await context.deletePage(id);
          deleted.add(id);
        } catch (error) {
          clearDeletion(id, marker);
          throw error;
        }
      }
    }).catch(onError);

    pending.set(id, operation);
    void operation.then(() => {
      if (pending.get(id) === operation) pending.delete(id);
    });
  };

  const handleTransaction = (transaction: Y.Transaction) => {
    // Yjs array reads can emit empty transactions. Text edits cannot change
    // page ownership, so neither needs another structural scan.
    if (![...transaction.changed.keys()].some((type) => !(type instanceof Y.Text))) return;
    const current = collectSubpages(editor);
    const beforeIds = new Set(previous.values());
    const afterIds = new Set(current.values());

    previous = current;
    const local =
      (transaction.local && transaction.origin === null) ||
      transaction.origin === CollabOrigin.Local ||
      transaction.origin === CollabOrigin.LocalManual ||
      (YHistoryEditor.isYHistoryEditor(editor) && transaction.origin === editor.undoManager);

    if (!local || editor.readOnly) return;
    beforeIds.forEach((id) => {
      if (!afterIds.has(id)) reconcile(id);
    });
    afterIds.forEach((id) => {
      if (!beforeIds.has(id) && (deleted.has(id) || pending.has(id))) reconcile(id);
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

  const handleView = (view: View) => {
    // Missing outline entries are normal for lazily loaded folders. Only an
    // explicit parent change or trash notification removes a subpage block.
    if (view.parent_view_id && view.parent_view_id !== getContext().viewId) removeReferences(new Set([view.view_id]));
  };

  const handleOutline = (views: View[]) => {
    const moved = new Set<string>();
    const visit = (items: View[]) =>
      items.forEach((view) => {
        if (view.parent_view_id && view.parent_view_id !== getContext().viewId) moved.add(view.view_id);
        if (view.children) visit(view.children);
      });

    visit(views);
    removeReferences(moved);
  };

  const handleTrash = (payload: { workspaceId?: string; trashItems?: View[] }) => {
    if (payload.workspaceId && payload.workspaceId !== getContext().workspaceId) return;
    const candidates = new Set(
      payload.trashItems?.map((view) => view.view_id).filter((id) => isReferenced(id) && !isReconciling(id))
    );

    if (!candidates.size) return;
    // A snapshot can arrive after restoration has completed and its shared
    // marker has gone. Recheck the server, then recheck the marker in case an
    // undo started while this request was in flight.
    void getContext()
      .loadTrashViews?.()
      .then((trash) => {
        removeReferences(
          new Set(trash.map((view) => view.view_id).filter((id) => candidates.has(id) && !isReconciling(id)))
        );
      })
      .catch(onError);
  };

  doc.on('afterTransaction', handleTransaction);
  events?.on(APP_EVENTS.VIEW_META_CHANGED, handleView);
  events?.on(APP_EVENTS.OUTLINE_LOADED, handleOutline);
  events?.on(APP_EVENTS.TRASH_UPDATED, handleTrash);
  return () => {
    disposed = true;
    doc.off('afterTransaction', handleTransaction);
    events?.off(APP_EVENTS.VIEW_META_CHANGED, handleView);
    events?.off(APP_EVENTS.OUTLINE_LOADED, handleOutline);
    events?.off(APP_EVENTS.TRASH_UPDATED, handleTrash);
  };
}
