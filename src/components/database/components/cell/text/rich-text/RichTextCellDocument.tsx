import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createEditor } from 'slate';
import { Editable, RenderElementProps, Slate, withReact } from 'slate-react';

import { useDatabaseContextOptional } from '@/application/database-yjs/context';
import {
  hasStoredPageTitle,
  type RichTextDelta,
  richTextToPlainText,
  sanitizeMention,
} from '@/application/database-yjs/fields/text/rich-text';
import { Leaf } from '@/components/editor/components/leaf/Leaf';

import { richTextToSlateValue, withRichTextCellCopy } from './rich-text-slate';
import { getCachedPageName } from './page-name-cache';
import { RichTextCellContext } from './RichTextCellContext';

export interface RichTextCellDocumentProps {
  rowId: string;
  delta: RichTextDelta;
  /** The class of the element each line of the cell renders in. */
  lineClassName: string;
}

/**
 * A formatted Text cell drawn by a read-only Slate editor: mentions and
 * equations need the document's leaf renderers, which need one. Cells without
 * them render as plain elements instead (see RichTextCellContent).
 */
function RichTextCellDocument({ rowId, delta, lineClassName }: RichTextCellDocumentProps) {
  const { t } = useTranslation();
  const workspaceId = useDatabaseContextOptional()?.workspaceId ?? '';
  const [editor] = useState(() =>
    withRichTextCellCopy(withReact(createEditor()), (selected) =>
      richTextToPlainText(selected, (id) => {
        const name = getCachedPageName(workspaceId, id);

        if (name || hasStoredPageTitle(selected, id)) return name;
        // Slate omits computed mention labels. A read-only cell still has
        // the saved label to copy when no page name has been loaded yet.
        const mention = delta
          .map(({ attributes }) => sanitizeMention(attributes?.mention))
          .find((mention) => mention?.page_id === id && !mention.row_id && !mention.database_row_id);

        return mention?.label || t('menuAppHeader.defaultNewPageName');
      })
    )
  );
  const initialValue = useMemo(() => richTextToSlateValue(delta), [delta]);

  const renderElement = useCallback(
    ({ attributes, children }: RenderElementProps) => (
      <div {...attributes} data-rich-text-cell-line className={lineClassName}>
        {children}
      </div>
    ),
    [lineClassName]
  );

  return (
    <RichTextCellContext rowId={rowId} readOnly>
      <Slate editor={editor} initialValue={initialValue}>
        <Editable readOnly renderElement={renderElement} renderLeaf={Leaf} className={'outline-none'} />
      </Slate>
    </RichTextCellContext>
  );
}

export default RichTextCellDocument;
