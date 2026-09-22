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

/** Hold the page queue until the paste has either inserted its block or rolled back. */
function prepareCutPage(sourceId: string, context: EditorContextState) {
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let finish!: (rollback: boolean) => void;
  const decision = new Promise<boolean>((resolve) => { finish = resolve; });
  const operation = queueSubpageOperation(context.workspaceId, sourceId, async () => {
    const { restorePage, movePage, deletePage, loadViewMeta, loadTrashViews } = context;
    let parentId: string | undefined;
    let restored = false;
    let moved = false;
    const compensate = async () => {
      try {
        if (moved && parentId) await movePage!(sourceId, parentId);
      } finally {
        if (restored) await deletePage!(sourceId);
      }
    };

    try {
      if (!restorePage || !movePage || !deletePage || !loadTrashViews) throw new Error('Moving subpages is unavailable');
      const trashed = (await loadTrashViews()).find((view) => view.view_id === sourceId);
      const source = trashed ?? (await loadViewMeta?.(sourceId, undefined, { authoritative: true }));

      parentId = source?.parent_view_id;
      if (!parentId) throw new Error('Could not find the original subpage parent');
      if (trashed) {
        await restorePage(sourceId);
        restored = true;
      }

      if (parentId !== context.viewId) {
        // A failed response can still follow a committed server mutation.
        moved = true;
        await movePage(sourceId, context.viewId);
      }
    } catch (error) {
      rejectReady(error);
      await compensate();
      throw error;
    }

    resolveReady();
    if (await decision) await compensate();
  });

  // Every reservation starts immediately, including pages visited later in the
  // fragment. Observe failures now while the caller is awaiting another page.
  void ready.catch(() => undefined);
  const completion = Promise.allSettled([operation]);

  return { ready, finish, completion };
}

/** Resolve all owned pages before inserting the fragment, keeping undo atomic. */
export async function prepareSubpageFragment(nodes: Node[], context: EditorContextState, allowMove = false) {
  if (context.readOnly) throw new Error('The document is read-only');
  const compensations: { id: string; undo: () => Promise<void> }[] = [];
  const cuts = new Map<string, ReturnType<typeof prepareCutPage>>();
  const seen = new Set<string>();
  const reserve = (node: Node) => {
    if (!Element.isElement(node)) return;
    const data = nodeData(node);

    if (node.type === BlockType.SubpageBlock && typeof data.view_id === 'string' && data.view_id && !seen.has(data.view_id)) {
      seen.add(data.view_id);
      if (allowMove && data.was_cut === true) cuts.set(data.view_id, prepareCutPage(data.view_id, context));
    }

    node.children.forEach(reserve);
  };

  // Reserve every cut page before yielding, so two overlapping multi-page
  // pastes cannot each acquire one page and then wait on the other's page.
  nodes.forEach(reserve);
  const ids = new Map<string, string>();
  let rollbackPromise: Promise<void> | undefined;
  const commit = () => cuts.forEach((cut) => cut.finish(false));
  const rollback = () => {
    rollbackPromise ??= (async () => {
      cuts.forEach((cut) => cut.finish(true));
      const [cutResults, copyResults] = await Promise.all([
        Promise.all([...cuts.values()].map((cut) => cut.completion)),
        Promise.allSettled(
          [...compensations].reverse().map(({ id, undo }) => queueSubpageOperation(context.workspaceId, id, undo))
        ),
      ]);
      const failure = [...cutResults.flat(), ...copyResults].find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );

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
        const cut = cuts.get(sourceId);

        if (cut) {
          await cut.ready;
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
    return { fragment, rollback, commit };
  } catch (error) {
    await rollback();
    throw error;
  }
}
