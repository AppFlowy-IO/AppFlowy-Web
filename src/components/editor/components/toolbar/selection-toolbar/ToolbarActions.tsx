import { Separator } from '@/components/ui/separator';
import { useMemo } from 'react';
import { Editor, Element, Path } from 'slate';
import { useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import AIAssistant from '@/components/editor/components/toolbar/selection-toolbar/actions/AIAssistant';
import Align from '@/components/editor/components/toolbar/selection-toolbar/actions/Align';
import Bold from '@/components/editor/components/toolbar/selection-toolbar/actions/Bold';
import Color from '@/components/editor/components/toolbar/selection-toolbar/actions/Color';
import ColorHighlight from '@/components/editor/components/toolbar/selection-toolbar/actions/ColorHighlight';
import Heading from '@/components/editor/components/toolbar/selection-toolbar/actions/Heading';
import Href from '@/components/editor/components/toolbar/selection-toolbar/actions/Href';
import InlineCode from '@/components/editor/components/toolbar/selection-toolbar/actions/InlineCode';
import Italic from '@/components/editor/components/toolbar/selection-toolbar/actions/Italic';
import TurnInto from '@/components/editor/components/toolbar/selection-toolbar/actions/TurnInto';
import Underline from '@/components/editor/components/toolbar/selection-toolbar/actions/Underline';
import {
  useSelectionToolbarContext,
} from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';

import MoreOptions from './actions/MoreOptions';

function ToolbarActions() {
  const editor = useSlate() as YjsEditor;
  const selection = editor.selection;
  const {
    visible: toolbarVisible,
  } = useSelectionToolbarContext();

  const start = useMemo(() => selection ? editor.start(selection) : null, [editor, selection]);
  const end = useMemo(() => selection ? editor.end(selection) : null, [editor, selection]);

  const startBlock = useMemo(() => {
    if (!start) return null;
    try {
      return getBlockEntry(editor, start);
    } catch (e) {
      return null;
    }
  }, [editor, start]);
  const endBlock = useMemo(() => {
    if (!end) return null;
    try {
      return getBlockEntry(editor, end);
    } catch (e) {
      return null;
    }
  }, [editor, end]);

  const isAcrossBlock = useMemo(() => {
    if (startBlock && endBlock && Path.equals(startBlock[1], endBlock[1])) return false;
    return startBlock?.[0].blockId !== endBlock?.[0].blockId;
  }, [endBlock, startBlock]);

  const isCodeBlock = useMemo(() => {
    if (!start || !end) return false;
    const range = { anchor: start, focus: end };

    const [codeBlock] = editor.nodes({
      at: range,
      match: n => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.CodeBlock,
    });

    return !!codeBlock;
  }, [editor, end, start]);

  return (
    <div
      className={'flex w-fit flex-grow items-center gap-1'}
    >
      {!isCodeBlock && <>
        <AIAssistant />
        <div className="h-5 flex items-center">
          <Separator orientation="vertical" className="h-5 w-px" />
        </div>
      </>}
      {
        !isAcrossBlock && !isCodeBlock && <>
          <Heading />
          <Bold />
          <Underline />
          <Italic />
          <Color />
          <ColorHighlight />
          <div className="h-5 flex items-center">
            <Separator orientation="vertical" className="h-5 w-px" />
          </div>
        </>
      }
      {!isCodeBlock && <InlineCode />}
      {
        !isAcrossBlock && !isCodeBlock && <>
          <div className="h-5 flex items-center">
            <Separator orientation="vertical" className="h-5 w-px" />
          </div>
          <TurnInto />
          <div className="h-5 flex items-center">
            <Separator orientation="vertical" className="h-5 w-px" />
          </div>
          <Href />
        </>
      }
      {!isCodeBlock && <Align enabled={toolbarVisible} />}
      {!isCodeBlock && <>
        <div className="h-5 flex items-center">
          <Separator orientation="vertical" className="h-5 w-px" />
        </div>
        <MoreOptions />
      </>}
    </div>
  );
}

export default ToolbarActions;