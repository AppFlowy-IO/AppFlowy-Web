import { memo, useCallback, useMemo, useState } from 'react';
import { createEditor } from 'slate';
import { Slate, withReact } from 'slate-react';

import { BlockType, YjsEditorKey } from '@/application/types';
import { DockableOutline } from '@/components/editor/components/blocks/outline/DockableOutline';
import { OutlineNavigationProvider } from '@/components/editor/components/blocks/outline/OutlineNavigation';
import EditorEditable from '@/components/editor/Editable';
import { defaultLayoutStyle, EditorContextProvider, EditorContextState } from '@/components/editor/EditorContext';
import { withPlugins } from '@/components/editor/plugins';

import type { Descendant } from 'slate';
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
  dockableOutline?: boolean;
}

export const StaticEditor = memo(({
  value,
  dockableOutline = false,
  layoutStyle = defaultLayoutStyle,
  ...props
}: StaticEditorProps) => {
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
        <OutlineNavigationProvider dockable={dockableOutline}>
          <EditorEditable />
          {dockableOutline && <DockableOutline />}
        </OutlineNavigationProvider>
      </Slate>
    </EditorContextProvider>
  );
});

export default StaticEditor;
