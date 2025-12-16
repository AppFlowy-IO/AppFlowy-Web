import { debounce } from 'lodash-es';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEditor, Descendant, Editor, Element as SlateElement, Node } from 'slate';
import { Slate, withReact } from 'slate-react';
import * as Y from 'yjs';

import { CustomEditor } from '@/application/slate-yjs/command';
import { withYHistory } from '@/application/slate-yjs/plugins/withHistory';
import { Log } from '@/utils/log';
import { withYjs, YjsEditor } from '@/application/slate-yjs/plugins/withYjs';
import { BlockType, CollabOrigin } from '@/application/types';
import EditorEditable from '@/components/editor/Editable';
import { useEditorContext } from '@/components/editor/EditorContext';
import { withPlugins } from '@/components/editor/plugins';
import { clipboardFormatKey } from '@/components/editor/plugins/withCopy';
import { getTextCount } from '@/utils/word';

const defaultInitialValue: Descendant[] = [];
const DATABASE_BLOCK_TYPES = new Set([BlockType.GridBlock, BlockType.BoardBlock, BlockType.CalendarBlock]);
const DATABASE_VIEW_DELETION_GRACE_MS = 1500;

type DatabaseBlockInfo = {
  blockId: string;
  parentId: string;
  viewIds: string[];
};

function CollaborativeEditor({
  doc,
  onEditorConnected,
  onSelectionChange,
}: {
  doc: Y.Doc;
  onEditorConnected?: (editor: YjsEditor) => void;
  onSelectionChange?: (editor: YjsEditor) => void;
}) {
  const context = useEditorContext();
  const readSummary = context.readSummary;
  const onRendered = context.onRendered;
  const uploadFile = context.uploadFile;
  const readOnly = context.readOnly;
  const viewId = context.viewId;
  const onWordCountChange = context.onWordCountChange;
  const deletePage = context.deletePage;
  const loadViewMeta = context.loadViewMeta;
  const [, setClock] = useState(0);
  const databaseBlocksRef = useRef<Map<string, DatabaseBlockInfo>>(new Map());
  const pendingDatabaseViewDeletionRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onContentChange = useCallback(
    (content: Descendant[]) => {
      const wordCount = getTextCount(content);

      onWordCountChange?.(viewId, wordCount);
      setClock((prev) => prev + 1);
      onRendered?.();
    },
    [onWordCountChange, viewId, onRendered]
  );

  const debounceCalculateWordCount = useMemo(() => {
    return debounce((editor) => {
      const wordCount = getTextCount(editor.children);

      onWordCountChange?.(viewId, wordCount);
    }, 300);
  }, [onWordCountChange, viewId]);

  const collectDatabaseBlocks = useCallback((editor: YjsEditor) => {
    const currentBlocks = new Map<string, DatabaseBlockInfo>();

    for (const [node] of Editor.nodes(editor, {
      at: [],
      match: (value: Node) =>
        SlateElement.isElement(value) && DATABASE_BLOCK_TYPES.has((value as { type: BlockType }).type),
    })) {
      const element = node as unknown as {
        blockId?: string;
        data?: { parent_id?: string; view_ids?: unknown; view_id?: unknown };
        type?: unknown;
      };

      const blockId = element.blockId;

      if (!blockId) continue;

      const data = element.data ?? {};
      const parentId = typeof data.parent_id === 'string' ? data.parent_id : '';
      const viewIds = Array.isArray(data.view_ids)
        ? data.view_ids.filter((id): id is string => typeof id === 'string')
        : typeof data.view_id === 'string'
          ? [data.view_id]
          : [];

      if (viewIds.length === 0) continue;

      currentBlocks.set(blockId, { blockId, parentId, viewIds });
    }

    return currentBlocks;
  }, []);

  const handleSelectionChange = useCallback(
    (editor: YjsEditor) => {
      onSelectionChange?.(editor);

      debounceCalculateWordCount(editor);
    },
    [onSelectionChange, debounceCalculateWordCount]
  );

  const handleDatabaseBlockLifecycle = useCallback(
    (editor: YjsEditor) => {
      if (!YjsEditor.connected(editor)) return;
      if (editor.interceptLocalChange) return;

      // Avoid scanning the whole document on every keystroke. Only react to operations that can
      // affect database block presence (insert/remove).
      const hasDatabaseBlockOps = editor.operations.some((op) => {
        if (op.type !== 'insert_node' && op.type !== 'remove_node') return false;
        if (!('node' in op)) return false;

        const node = (op as { node: Node }).node;

        return (
          SlateElement.isElement(node) &&
          DATABASE_BLOCK_TYPES.has((node as unknown as { type: BlockType }).type)
        );
      });

      if (!hasDatabaseBlockOps) return;

      const previousBlocks = databaseBlocksRef.current;
      const currentBlocks = collectDatabaseBlocks(editor);

      // Collect all child view IDs that are still referenced by current blocks
      const referencedViewIds = new Set<string>();

      for (const info of currentBlocks.values()) {
        for (const viewId of info.viewIds) {
          referencedViewIds.add(viewId);
        }
      }

      databaseBlocksRef.current = currentBlocks;

      // Cancel pending deletions if the view is re-referenced (e.g., undo)
      for (const childViewId of Array.from(pendingDatabaseViewDeletionRef.current.keys())) {
        if (!referencedViewIds.has(childViewId)) continue;

        const timeoutId = pendingDatabaseViewDeletionRef.current.get(childViewId);

        if (!timeoutId) continue;

        clearTimeout(timeoutId);
        pendingDatabaseViewDeletionRef.current.delete(childViewId);
      }

      const removedBlocks = Array.from(previousBlocks.values()).filter((info) => !currentBlocks.has(info.blockId));

      if (removedBlocks.length === 0) return;

      for (const removed of removedBlocks) {
        // viewIds contains child database views (Grid/Board/Calendar); we need to find their parent (the container)
        const firstViewId = removed.viewIds[0];

        if (!firstViewId) continue;
        if (pendingDatabaseViewDeletionRef.current.has(firstViewId)) continue;

        const timeoutId = setTimeout(async () => {
          pendingDatabaseViewDeletionRef.current.delete(firstViewId);

          // Check again that this view is not referenced by any current blocks
          const latestBlocks = databaseBlocksRef.current;
          const stillReferenced = Array.from(latestBlocks.values()).some((info) => info.viewIds.includes(firstViewId));

          if (stillReferenced) return;

          // Find the container by looking up the parent of the child view
          if (!loadViewMeta || !deletePage) return;

          try {
            const childMeta = await loadViewMeta(firstViewId);
            const containerId = childMeta?.parent_view_id;

            if (!containerId) {
              Log.warn('[CollaborativeEditor] Could not find container for orphaned database view', { firstViewId });
              return;
            }

            Log.debug('[CollaborativeEditor] Deleting orphaned database container', { containerId, firstViewId });
            await deletePage(containerId);
          } catch (err) {
            Log.error('[CollaborativeEditor] Failed to delete database container', { firstViewId, err });
          }
        }, DATABASE_VIEW_DELETION_GRACE_MS);

        pendingDatabaseViewDeletionRef.current.set(firstViewId, timeoutId);
      }
    },
    [collectDatabaseBlocks, deletePage, loadViewMeta]
  );

  const editor = useMemo(
    () =>
      doc &&
      (withPlugins(
        withReact(
          withYHistory(
            withYjs(createEditor(), doc, {
              readOnly,
              localOrigin: CollabOrigin.Local,
              readSummary,
              onContentChange,
              uploadFile,
              id: viewId,
              onSelectionChange: handleSelectionChange,
            })
          ),
          clipboardFormatKey
        )
      ) as YjsEditor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewId, doc]
  );

  const handleSlateChange = useCallback(() => {
    handleDatabaseBlockLifecycle(editor);
  }, [editor, handleDatabaseBlockLifecycle]);

  const [, setIsConnected] = useState(false);

  useEffect(() => {
    if (!editor) return;

    editor.connect();
    setIsConnected(true);
    onEditorConnected?.(editor);
    databaseBlocksRef.current = collectDatabaseBlocks(editor);
    const pendingDatabaseViewDeletion = pendingDatabaseViewDeletionRef.current;

    // Expose editor and doc for E2E testing in development/test mode
    const isE2ETest =
      import.meta.env.DEV || import.meta.env.MODE === 'test' || (typeof window !== 'undefined' && 'Cypress' in window);

    if (isE2ETest) {
      const testWindow = window as Window & {
        __TEST_EDITOR__?: YjsEditor;
        __TEST_EDITORS__?: Record<string, YjsEditor | undefined>;
        __TEST_CUSTOM_EDITOR__?: typeof CustomEditor;
        __TEST_DOC__?: Y.Doc;
        Y?: typeof Y;
      };

      testWindow.__TEST_EDITOR__ = editor;
      testWindow.__TEST_EDITORS__ = testWindow.__TEST_EDITORS__ ?? {};
      testWindow.__TEST_EDITORS__[viewId] = editor;
      testWindow.__TEST_CUSTOM_EDITOR__ = CustomEditor;
      testWindow.__TEST_DOC__ = doc;
      testWindow.Y = Y; // Expose Yjs module for creating test blocks
    }

    return () => {
      for (const timeoutId of pendingDatabaseViewDeletion.values()) {
        clearTimeout(timeoutId);
      }

      pendingDatabaseViewDeletion.clear();
      databaseBlocksRef.current.clear();

      Log.debug('disconnect');
      editor.disconnect();
      // Clean up test references
      if (isE2ETest) {
        const testWindow = window as Window & {
          __TEST_EDITOR__?: YjsEditor;
          __TEST_EDITORS__?: Record<string, YjsEditor | undefined>;
          __TEST_CUSTOM_EDITOR__?: typeof CustomEditor;
          __TEST_DOC__?: Y.Doc;
          Y?: typeof Y;
        };

        delete testWindow.__TEST_EDITOR__;
        if (testWindow.__TEST_EDITORS__) {
          delete testWindow.__TEST_EDITORS__[viewId];
        }

        delete testWindow.__TEST_DOC__;
        // Keep Y exposed as it might be needed for other editors
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <Slate editor={editor} initialValue={defaultInitialValue} onChange={handleSlateChange}>
      <EditorEditable />
    </Slate>
  );
}

export default memo(CollaborativeEditor);
