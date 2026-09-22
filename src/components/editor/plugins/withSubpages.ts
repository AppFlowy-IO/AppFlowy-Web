import { t } from 'i18next';
import { Editor, Element } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { SOFT_BREAK_TYPES } from '@/application/slate-yjs/command/const';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { getBlockEntry, isInsideSimpleTableCell } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import {
  clipboardPayloadToSlateFragment,
  extractAppFlowyClipboardFragment,
} from '@/components/editor/clipboard/appflowy-fragment';
import { stripInlineCommentIds } from '@/components/editor/clipboard/inline-comment-metadata';
import { containsSimpleTableBlocks } from '@/components/editor/clipboard/table-fragment';
import { EditorContextState } from '@/components/editor/EditorContext';
import { containsSubpage, prepareSubpageFragment } from '@/components/editor/subpage/subpage-operations';
import { convertSlateFragmentTo } from '@/components/editor/utils/fragment';
import {
  insertBlocksAtCaret,
  shouldMergeFirstFragmentNodeInline,
} from '@/components/editor/utils/insert-blocks-at-caret';
import { getErrorMessage } from '@/utils/errors';

export function withSubpages<T extends ReactEditor>(editor: T, getContext: () => EditorContextState): T {
  const insertData = editor.insertData;
  const e = editor as T & YjsEditor;

  editor.insertData = (data) => {
    if (!editor.selection) return insertData(data);
    const block = getBlockEntry(e)?.[0];

    if (block && SOFT_BREAK_TYPES.includes(block.type as BlockType) && data.getData('text/plain'))
      return insertData(data);
    const html = data.getData('text/html');
    const slateData =
      data.getData('application/x-slate-fragment') ||
      (html
        ? new DOMParser()
            .parseFromString(html, 'text/html')
            .querySelector('[data-slate-fragment]')
            ?.getAttribute('data-slate-fragment')
        : '');
    const fragment =
      extractAppFlowyClipboardFragment(data)?.fragment ?? clipboardPayloadToSlateFragment(slateData || '');

    if (!fragment || !containsSubpage(fragment)) return insertData(data);
    if (e.readOnly || !e.selection) return;
    if (block?.blockId && isInsideSimpleTableCell(e, block.blockId)) {
      // Preserve the existing table-to-TSV paste path before creating any pages.
      if (containsSimpleTableBlocks(fragment)) return insertData(data);
      notify.error(t('document.plugins.subPage.errors.unsupportedInTable'));
      return;
    }

    const target = Editor.rangeRef(editor, e.selection);

    void (async () => {
      const prepared = await prepareSubpageFragment(fragment, getContext(), true);
      const range = target.current;

      if (!range || !YjsEditor.connected(e) || e.readOnly) {
        await prepared.rollback();
        return;
      }

      Editor.withoutNormalizing(editor, () => {
        editor.select(range);
        e.flushLocalChanges();
        if (YHistoryEditor.isYHistoryEditor(e)) e.undoManager.stopCapturing();
      });
      const nodes = convertSlateFragmentTo(stripInlineCommentIds(prepared.fragment)).filter(Element.isElement);

      if (!insertBlocksAtCaret(e, nodes, { mergeFirstBlockInline: shouldMergeFirstFragmentNodeInline(nodes[0]) }))
        await prepared.rollback();
      e.flushLocalChanges();
      if (YHistoryEditor.isYHistoryEditor(e)) e.undoManager.stopCapturing();
    })()
      .catch((error) => notify.error(getErrorMessage(error)))
      .finally(() => target.unref());
  };

  return editor;
}
