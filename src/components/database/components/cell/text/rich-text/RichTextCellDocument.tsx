import { useCallback, useMemo, useState } from 'react';
import { createEditor } from 'slate';
import { Editable, RenderElementProps, Slate, withReact } from 'slate-react';

import type { RichTextDelta } from '@/application/database-yjs/fields/text/rich-text';
import { Leaf } from '@/components/editor/components/leaf/Leaf';

import { richTextToSlateValue, withRichTextCellCopy } from './rich-text-slate';
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
  const [editor] = useState(() => withRichTextCellCopy(withReact(createEditor())));
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
