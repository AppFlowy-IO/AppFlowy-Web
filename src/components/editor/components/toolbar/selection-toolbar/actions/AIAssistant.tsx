import { AIAssistantType, AIWriterMenu, useAIWriter } from '@appflowyinc/ai-chat';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as AskAIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as ImproveWritingIcon } from '@/assets/icons/ai_improve_writing.svg';
import { ReactComponent as TriangleDownIcon } from '@/assets/icons/triangle_down.svg';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import {
  useSelectionToolbarContext,
} from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { useEditorContext } from '@/components/editor/EditorContext';


function AIAssistant() {
  const { t } = useTranslation();
  const editor = useSlate() as YjsEditor;

  const [open, setOpen] = useState(false);
  const {
    addDecorate,
  } = useEditorContext();
  const {
    visible: toolbarVisible,
  } = useSelectionToolbarContext();
  const {
    improveWriting,
  } = useAIWriter();
  const [content, setContent] = useState('');

  const addReplaceStyle = useCallback(() => {
    const range = editor.selection;

    if (!range) return;

    addDecorate?.(range, 'line-through  text-text-caption', 'ai-writer');
  }, [addDecorate, editor.selection]);

  const addHighLightStyle = useCallback(() => {
    const range = editor.selection;

    if (!range) return;

    addDecorate?.(range, 'bg-content-blue-100', 'ai-writer');
  }, [addDecorate, editor.selection]);
  const onClickImproveWriting = useCallback(() => {
    addReplaceStyle();
    const content = CustomEditor.getSelectionContent(editor);

    void improveWriting(content);
  }, [addReplaceStyle, editor, improveWriting]);

  const isFilterOut = useCallback((type: AIAssistantType) => {
    return type === AIAssistantType.ContinueWriting;
  }, []);

  const onItemClicked = useCallback((type: AIAssistantType) => {
    if ([AIAssistantType.ImproveWriting, AIAssistantType.FixSpelling, AIAssistantType.MakeLonger, AIAssistantType.MakeShorter].includes(type)) {
      addReplaceStyle();
    } else {
      addHighLightStyle();
    }

    ReactEditor.blur(editor);
  }, [addHighLightStyle, addReplaceStyle, editor]);

  useEffect(() => {
    if (!toolbarVisible) {
      setOpen(false);
    }
  }, [toolbarVisible]);

  return (
    <>
      <ActionButton
        onClick={onClickImproveWriting}
        tooltip={t('editor.improveWriting')}
      >
        <ImproveWritingIcon className='w-5 h-5' />
      </ActionButton>
      <AIWriterMenu
        input={content}
        open={open}
        isFilterOut={isFilterOut}
        onItemClicked={onItemClicked}
      >
        <ActionButton
          onClick={e => {
            e.stopPropagation();
            setContent(CustomEditor.getSelectionContent(editor));
            setOpen(prev => !prev);
          }}
          tooltip={t('editor.askAI')}
        >
          <div className={'flex items-center justify-center gap-1'}>
            <AskAIIcon className='w-5 h-5' />
            <TriangleDownIcon className={'text-icon-tertiary w-3 h-5'} />
          </div>
        </ActionButton>
      </AIWriterMenu>

    </>
  );
}

export default AIAssistant;
