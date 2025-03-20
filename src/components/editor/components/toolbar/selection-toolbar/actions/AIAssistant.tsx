import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useAIWriter, AIWriterMenu, AIAssistantType } from '@appflowyinc/ai-chat';
import React, { useCallback } from 'react';
import { ReactComponent as AskAIIcon } from '@/assets/ai.svg';
import { ReactComponent as ImproveWritingIcon } from '@/assets/improve-writing.svg';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlate } from 'slate-react';
import { ReactComponent as RightIcon } from '@/assets/arrow_right.svg';

function AIAssistant() {
  const { t } = useTranslation();
  const editor = useSlate() as YjsEditor;

  const {
    addDecorate,
  } = useEditorContext();
  const {
    improveWriting,
    setInputContext,
  } = useAIWriter();

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

    setInputContext(content);
    void improveWriting(content);
  }, [addReplaceStyle, editor, improveWriting, setInputContext]);

  const onOpenChange = useCallback((open: boolean) => {
    if(open) {
      const content = CustomEditor.getSelectionContent(editor);

      setInputContext(content);
    }
  }, [editor, setInputContext]);

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
        onOpenChange={onOpenChange}
        isFilterOut={isFilterOut}
        onItemClicked={onItemClicked}
      >
        <ActionButton
          className={'!text-ai-primary !hover:text-billing-primary'}
          tooltip={t('editor.askAI')}
        >
          <div className={'flex items-center justify-center'}>
            <AskAIIcon />

            <RightIcon className={'transform h-3 w-3 rotate-90 text-icon-on-toolbar opacity-80'} />
          </div>

        </ActionButton>
      </AIWriterMenu>

    </>
  );
}

export default AIAssistant;