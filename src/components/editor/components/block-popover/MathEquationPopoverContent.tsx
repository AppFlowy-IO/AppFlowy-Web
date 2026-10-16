import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { useAIEnabled } from '@/components/app/app.hooks';
import { MathEquationEditor } from '@/components/editor/components/blocks/math-equation/MathEquationEditor';
import { MathEquationNode } from '@/components/editor/editor.type';

import { usePopoverContext } from './BlockPopoverContext';

function MathEquationPopoverContent({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly();
  const aiEnabled = useAIEnabled();
  const { openMathEquationAI } = usePopoverContext();
  const entry = findSlateEntryByBlockId(editor, blockId);

  if (!entry || readOnly || editor.isElementReadOnly(entry[0])) return null;

  return (
    <MathEquationEditor
      key={blockId}
      initialValue={(entry[0] as MathEquationNode).data.formula || ''}
      onCancel={onClose}
      onSave={(formula) => {
        const current = findSlateEntryByBlockId(editor, blockId);

        if (current && !editor.readOnly && !editor.isElementReadOnly(current[0])) {
          editor.flushLocalChanges();
          if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
          CustomEditor.setBlockData(editor, blockId, { formula });
          editor.flushLocalChanges();
          if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
        }

        onClose();
      }}
      onAskAI={
        aiEnabled
          ? (draft) => {
              onClose();
              openMathEquationAI?.({ blockId, action: 'generate', draft });
            }
          : undefined
      }
    />
  );
}

export default MathEquationPopoverContent;
