import { Element, Node } from 'slate';

import { BlockType } from '@/application/types';
import { EditorContextState } from '@/components/editor/EditorContext';

// A cut may be pasted into another open editor before its trash request finishes.
const pageOperations = new Map<string, Promise<unknown>>();

export function queueSubpageOperation<T>(workspaceId: string, viewId: string, operation: () => Promise<T>): Promise<T> {
  const key = `${workspaceId}:${viewId}`;
  const pending = (pageOperations.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);

  pageOperations.set(key, pending);
  const clean = () => {
    if (pageOperations.get(key) === pending) pageOperations.delete(key);
  };

  void pending.then(clean, clean);
  return pending;
}

export function containsSubpage(nodes: Node[]): boolean {
  return nodes.some(
    (node) => Element.isElement(node) && (node.type === BlockType.SubpageBlock || containsSubpage(node.children))
  );
}

function nodeData(node: Element): Record<string, unknown> {
  return typeof node.data === 'object' && node.data !== null ? (node.data as Record<string, unknown>) : {};
}

export function markSubpageClipboard(nodes: Node[], cut: boolean): Node[] {
  return nodes.map((node) => {
    if (!Element.isElement(node)) return node;
    return {
      ...node,
      ...(node.type === BlockType.SubpageBlock ? { data: { ...nodeData(node), was_cut: cut, was_copied: !cut } } : {}),
      children: markSubpageClipboard(node.children, cut),
    };
  });
}

/** Resolve all owned pages before inserting the fragment, keeping undo atomic. */
export async function prepareSubpageFragment(nodes: Node[], context: EditorContextState, allowMove = false) {
  if (context.readOnly) throw new Error('The document is read-only');
  const compensations: { id: string; undo: () => Promise<void> }[] = [];
  const ids = new Map<string, string>();
  let rollbackPromise: Promise<void> | undefined;
  const rollback = () => {
    rollbackPromise ??= (async () => {
      // Reverse each page's mutations and let every compensation run even if
      // another fails. The shared queue also orders rollback against cut/undo.
      const results = await Promise.allSettled(
        [...compensations].reverse().map(({ id, undo }) => queueSubpageOperation(context.workspaceId, id, undo))
      );
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

      if (failure) throw failure.reason;
    })();
    return rollbackPromise;
  };

  const visit = async (node: Node): Promise<Node> => {
    if (!Element.isElement(node)) return node;
    let data = nodeData(node);

    if (node.type === BlockType.SubpageBlock && typeof data.view_id === 'string' && data.view_id) {
      const sourceId = data.view_id;
      let id = ids.get(sourceId);

      if (!id) {
        if (allowMove && data.was_cut === true) {
          const { restorePage, movePage, deletePage, loadViewMeta, loadTrashViews } = context;

          if (!restorePage || !movePage || !deletePage || !loadTrashViews) throw new Error('Moving subpages is unavailable');
          await queueSubpageOperation(context.workspaceId, sourceId, async () => {
            // Read after any pending cut deletion. Cached outline metadata can
            // still describe a trashed page as active at this point.
            const trashed = (await loadTrashViews()).find((view) => view.view_id === sourceId);
            const source = trashed ?? (await loadViewMeta?.(sourceId, undefined, { authoritative: true }));
            const parentId = source?.parent_view_id;

            if (!parentId) throw new Error('Could not find the original subpage parent');
            if (trashed) {
              await restorePage(sourceId);
              compensations.push({ id: sourceId, undo: () => deletePage(sourceId) });
            }

            if (parentId !== context.viewId) {
              compensations.push({ id: sourceId, undo: () => movePage(sourceId, parentId) });
              await movePage(sourceId, context.viewId);
            }
          });
          id = sourceId;
        } else {
          if (!context.duplicatePage) throw new Error('Duplicating subpages is unavailable');
          await context.duplicatePage(sourceId, {
            parentViewId: context.viewId,
            includeChildren: true,
            openAfterDuplicate: false,
            onDuplicated: (viewId) => {
              id = viewId;
              compensations.push({ id: viewId, undo: async () => context.deletePage?.(viewId) });
            },
          });
        }

        if (!id) throw new Error('Could not find the duplicated subpage');
        ids.set(sourceId, id);
      }

      data = { ...data, view_id: id, was_cut: false, was_copied: false };
    }

    const children: Node[] = [];

    for (const child of node.children) children.push(await visit(child));
    return { ...node, data, children };
  };

  try {
    const fragment: Node[] = [];

    for (const node of nodes) fragment.push(await visit(node));
    return { fragment, rollback };
  } catch (error) {
    await rollback();
    throw error;
  }
}
