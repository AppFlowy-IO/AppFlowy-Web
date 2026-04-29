import { Divider } from '@mui/material';
import { useCallback, useMemo, useRef } from 'react';
import { Editor, Element, Path } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { isValidSelection } from '@/application/slate-yjs/utils/transformSelection';
import { BlockType } from '@/application/types';
import { useAIEnabled } from '@/components/app/app.hooks';
import AIAssistant from '@/components/editor/components/toolbar/selection-toolbar/actions/AIAssistant';
import Align from '@/components/editor/components/toolbar/selection-toolbar/actions/Align';
import Bold from '@/components/editor/components/toolbar/selection-toolbar/actions/Bold';
import BulletedList from '@/components/editor/components/toolbar/selection-toolbar/actions/BulletedList';
import Formula from '@/components/editor/components/toolbar/selection-toolbar/actions/Formula';
import Heading from '@/components/editor/components/toolbar/selection-toolbar/actions/Heading';
import Href from '@/components/editor/components/toolbar/selection-toolbar/actions/Href';
import InlineCode from '@/components/editor/components/toolbar/selection-toolbar/actions/InlineCode';
import Italic from '@/components/editor/components/toolbar/selection-toolbar/actions/Italic';
import NumberedList from '@/components/editor/components/toolbar/selection-toolbar/actions/NumberedList';
import Quote from '@/components/editor/components/toolbar/selection-toolbar/actions/Quote';
import StrikeThrough from '@/components/editor/components/toolbar/selection-toolbar/actions/StrikeThrough';
import TextColor from '@/components/editor/components/toolbar/selection-toolbar/actions/TextColor';
import Underline from '@/components/editor/components/toolbar/selection-toolbar/actions/Underline';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { useEditorLocalState } from '@/components/editor/EditorContext';

import BgColor from './actions/BgColor';
import Paragraph from './actions/Paragraph';

function ToolbarActions() {
  const editor = useSlate() as YjsEditor;
  const selection = editor.selection;
  const { forceShow, visible: toolbarVisible } = useSelectionToolbarContext();
  const { removeDecorate } = useEditorLocalState();
  const aiEnabled = useAIEnabled();

  const refocusTimeout = useRef<NodeJS.Timeout | null>(null);
  const disableFocusRef = useRef<boolean>(false);

  const focusEditor = useCallback(
    (debounce: number | undefined) => {
      if (disableFocusRef.current) {
        return;
      }

      if (refocusTimeout.current) {
        clearTimeout(refocusTimeout.current);
      }

      if (debounce === undefined) {
        ReactEditor.focus(editor);
        forceShow(false);
        removeDecorate?.('selection-toolbar');
        return;
      }

      refocusTimeout.current = setTimeout(() => {
        if (!disableFocusRef.current) {
          ReactEditor.focus(editor);
          forceShow(false);
          removeDecorate?.('selection-toolbar');
        }
      }, debounce);
    },
    [editor, forceShow, removeDecorate]
  );

  const toggleDisableEditorFocus = useCallback(() => {
    if (refocusTimeout.current) {
      clearTimeout(refocusTimeout.current);
      refocusTimeout.current = null;
    }

    if (disableFocusRef.current) {
      setTimeout(() => {
        disableFocusRef.current = false;
      }, 50);
    } else {
      disableFocusRef.current = true;
    }
  }, []);

  const start = useMemo(() => (selection ? editor.start(selection) : null), [editor, selection]);
  const end = useMemo(() => (selection ? editor.end(selection) : null), [editor, selection]);

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

    if (!isValidSelection(editor, range)) return false;

    const [codeBlock] = editor.nodes({
      at: range,
      match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.CodeBlock,
    });

    return !!codeBlock;
  }, [editor, end, start]);

  return (
    <div className={'flex w-fit flex-grow items-center gap-1'}>
      {aiEnabled && !isCodeBlock && <AIAssistant />}
      {!isAcrossBlock && !isCodeBlock && (
        <>
          <Paragraph />
          <Heading />
          <Divider className={'my-1.5 bg-line-on-toolbar'} orientation={'vertical'} flexItem={true} />
        </>
      )}
      <>
        <Underline />
        <Bold />
        <Italic />
        <StrikeThrough />
      </>
      {!isCodeBlock && <InlineCode />}
      {!isCodeBlock && !isAcrossBlock && <Formula />}
      {!isAcrossBlock && !isCodeBlock && (
        <>
          <Divider className={'my-1.5 bg-line-on-toolbar'} orientation={'vertical'} flexItem={true} />
          <Quote />
          <BulletedList />
          <NumberedList />
          <Divider className={'my-1.5 bg-line-on-toolbar'} orientation={'vertical'} flexItem={true} />
          <Href />
        </>
      )}
      {!isCodeBlock && <Align enabled={toolbarVisible} />}
      <TextColor focusEditor={focusEditor} toggleDisableEditorFocus={toggleDisableEditorFocus} />
      <BgColor focusEditor={focusEditor} toggleDisableEditorFocus={toggleDisableEditorFocus} />
    </div>
  );
}

export default ToolbarActions;
