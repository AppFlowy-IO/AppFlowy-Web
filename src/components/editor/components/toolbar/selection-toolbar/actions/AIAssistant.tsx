import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import {
  useSelectionToolbarContext,
} from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useAIWriter, AIWriterMenu, AIAssistantType } from '@appflowyinc/ai-chat';
import React, { useCallback, useEffect } from 'react';
import { ReactComponent as AskAIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as ImproveWritingIcon } from '@/assets/icons/ai_improve_writing.svg';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlate } from 'slate-react';
import { ReactComponent as TriangleDownIcon } from '@/assets/icons/triangle_down.svg';

function AIAssistant() {
  const { t } = useTranslation();
  const editor = useSlate() as YjsEditor;

  const [open, setOpen] = React.useState(false);
  const {
    addDecorate,
  } = useEditorContext();
  const {
    visible: toolbarVisible,
  } = useSelectionToolbarContext();
  const {
    improveWriting,
  } = useAIWriter();
  const [content, setContent] = React.useState('');

  const addReplaceStyle = useCallback(() => {
    const range = editor.selection;

    if(!range) return;

    addDecorate?.(range, 'line-through  text-text-caption', 'ai-writer');
  }, [addDecorate, editor.selection]);

  const addHighLightStyle = useCallback(() => {
    const range = editor.selection;

    if(!range) return;

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
    if([AIAssistantType.ImproveWriting, AIAssistantType.FixSpelling, AIAssistantType.MakeLonger, AIAssistantType.MakeShorter].includes(type)) {
      addReplaceStyle();
    } else {
      addHighLightStyle();
    }

    ReactEditor.blur(editor);
  }, [addHighLightStyle, addReplaceStyle, editor]);

  useEffect(() => {
    if(!toolbarVisible) {
      setOpen(false);
    }
  }, [toolbarVisible]);

  return (
    <>
      <ActionButton
        className={'!text-ai-primary !hover:text-billing-primary'}
        onClick={onClickImproveWriting}
        tooltip={t('editor.improveWriting')}
      >
        <ImproveWritingIcon />
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
          className={'!text-ai-primary !hover:text-billing-primary'}
          tooltip={t('editor.askAI')}
        >
          <div className={'flex items-center justify-center'}>
            <AskAIIcon className='w-5 h-5'/>
            <TriangleDownIcon className={'text-icon-on-toolbar w-3 h-5'} />
          </div>

        </ActionButton>
      </AIWriterMenu>

    </>
  );
}

export default AIAssistant;