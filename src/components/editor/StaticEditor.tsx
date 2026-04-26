import { memo, useCallback, useMemo, useState } from 'react';
import { createEditor } from 'slate';
import type { Descendant } from 'slate';
import { Slate, withReact } from 'slate-react';

import { BlockType, YjsEditorKey } from '@/application/types';
import EditorEditable from '@/components/editor/Editable';
import { defaultLayoutStyle, EditorContextProvider, EditorContextState } from '@/components/editor/EditorContext';
import { withPlugins } from '@/components/editor/plugins';
import './editor.scss';

const emptyValue: Descendant[] = [
  {
    type: BlockType.Paragraph,
    blockId: 'published-empty-paragraph',
    data: {},
    children: [
      {
        type: YjsEditorKey.text,
        textId: 'published-empty-text',
        children: [{ text: '' }],
      },
    ],
  },
] as Descendant[];

export interface StaticEditorProps extends Omit<EditorContextState, 'readOnly'> {
  value: Descendant[];
}

export const StaticEditor = memo(({ value, layoutStyle = defaultLayoutStyle, ...props }: StaticEditorProps) => {
  const [codeGrammars, setCodeGrammars] = useState<Record<string, string>>({});
  const handleAddCodeGrammars = useCallback((blockId: string, grammar: string) => {
    setCodeGrammars((prev) => ({ ...prev, [blockId]: grammar }));
  }, []);
  const editor = useMemo(() => {
    const nextEditor = withPlugins(withReact(createEditor()));

    Object.assign(nextEditor, {
      readOnly: true,
    });

    return nextEditor;
  }, []);
  const initialValue = value.length > 0 ? value : emptyValue;

  return (
    <EditorContextProvider
      {...props}
      readOnly
      layoutStyle={layoutStyle}
      codeGrammars={codeGrammars}
      addCodeGrammars={handleAddCodeGrammars}
    >
      <Slate key={props.viewId} editor={editor} initialValue={initialValue}>
        <EditorEditable />
      </Slate>
    </EditorContextProvider>
  );
});

export default StaticEditor;
