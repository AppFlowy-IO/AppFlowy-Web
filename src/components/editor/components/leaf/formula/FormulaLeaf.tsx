import { PopoverPosition } from '@mui/material';
import React, { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Text, Element } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { KatexMath } from '@/components/_shared/katex-math';
import FormulaPopover from '@/components/editor/components/leaf/formula/FormulaPopover';
import { useLeafSelected } from '@/components/editor/components/leaf/leaf.hooks';

function FormulaLeaf({ formula, text, children }: { formula: string; text: Text; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const editor = useSlateStatic();
  const { isSelected, isCursorBefore } = useLeafSelected(text);
  const [anchorPosition, setAnchorPosition] = useState<PopoverPosition | undefined>(undefined);
  const open = Boolean(anchorPosition);
  const [preview, setPreview] = useState<string>();
  const readonly = useReadOnly() || editor.isElementReadOnly(text as unknown as Element);
  const className = useMemo(() => {
    const classList = ['formula-inline', 'relative', 'rounded', 'p-0.5'];

    if (readonly) {
      classList.push('cursor-default');
    } else {
      classList.push('select-none', 'cursor-pointer');
    }

    if (isSelected || open) classList.push('selected');
    return classList.join(' ');
  }, [open, readonly, isSelected]);

  const handleClose = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setAnchorPosition(undefined);
    setPreview(undefined);
    try {
      const path = ReactEditor.findPath(editor, text);

      editor.select(editor.end(path));
      ReactEditor.focus(editor);
    } catch {
      /* The formula may have been deleted by a collaborator. */
    }
  }, [editor, text]);

  const openPopover = useCallback(() => {
    if (readonly) return;

    const rect = ref.current?.getBoundingClientRect();

    if (!rect) return;

    setAnchorPosition({
      top: rect.top + rect.height,
      left: rect.left,
    });
  }, [readonly]);

  const handleDone = useCallback(
    (newFormula: string) => {
      if (readonly) return;
      try {
        const path = ReactEditor.findPath(editor, text);

        editor.select(path);
        if (newFormula.trim()) {
          CustomEditor.addMark(editor, { key: EditorMarkFormat.Formula, value: newFormula });
          editor.collapse({ edge: 'end' });
        } else {
          editor.delete();
        }

        editor.removeMark(EditorMarkFormat.Formula);
        ReactEditor.focus(editor);
      } catch {
        /* Do not recreate a formula deleted while the popover was open. */
      }

      setAnchorPosition(undefined);
      setPreview(undefined);
    },
    [editor, readonly, text]
  );

  return (
    <>
      <span
        style={{
          left: isCursorBefore ? 0 : 'auto',
          right: isCursorBefore ? 'auto' : 0,
          top: isCursorBefore ? 0 : 'auto',
          bottom: isCursorBefore ? 'auto' : 0,
        }}
        className={'absolute bottom-0 right-0 overflow-hidden !text-transparent'}
      >
        {children}
      </span>

      <span
        ref={ref}
        onClick={() => {
          if (readonly) return;
          editor.deselect();
          openPopover();
        }}
        contentEditable={false}
        className={className}
      >
        <Suspense fallback={formula}>
          <KatexMath latex={preview ?? formula ?? ''} isInline />
        </Suspense>
      </span>
      {open && (
        <FormulaPopover
          open={open}
          anchorPosition={anchorPosition}
          onClose={handleClose}
          defaultValue={formula}
          onDone={handleDone}
          onPreview={setPreview}
        />
      )}
    </>
  );
}

export default FormulaLeaf;
