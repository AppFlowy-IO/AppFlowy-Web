import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlate } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as AskAIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as ImproveWritingIcon } from '@/assets/icons/ai_improve_writing.svg';
import { ReactComponent as TriangleDownIcon } from '@/assets/icons/triangle_down.svg';
import { useAIEnabled } from '@/components/app/app.hooks';
import { AIAssistantType, AIWriterMenu, useAIWriter } from '@/components/chat';
import ActionButton from '@/components/editor/components/toolbar/selection-toolbar/actions/ActionButton';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';
import { useEditorLocalState } from '@/components/editor/EditorContext';

function AIAssistant() {
  const { t } = useTranslation();
  const aiEnabled = useAIEnabled();
  const editor = useSlate() as YjsEditor;

  const [open, setOpen] = React.useState(false);
  const { addDecorate } = useEditorLocalState();
  const { visible: toolbarVisible } = useSelectionToolbarContext();
  const { improveWriting } = useAIWriter();
  const [content, setContent] = React.useState('');

  const addReplaceStyle = useCallback(() => {
    const range = editor.selection;

    if (!range) return;

    addDecorate?.(range, 'line-through  text-text-secondary', 'ai-writer');
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

  const onItemClicked = useCallback(
    (type: AIAssistantType) => {
      if (
        [
          AIAssistantType.ImproveWriting,
          AIAssistantType.FixSpelling,
          AIAssistantType.MakeLonger,
          AIAssistantType.MakeShorter,
        ].includes(type)
      ) {
        addReplaceStyle();
      } else {
        addHighLightStyle();
      }

      ReactEditor.blur(editor);
    },
    [addHighLightStyle, addReplaceStyle, editor]
  );

  useEffect(() => {
    if (!toolbarVisible) {
      setOpen(false);
    }
  }, [toolbarVisible]);

  if (!aiEnabled) return null;

  return (
    <>
      <ActionButton
        data-testid='toolbar-improve-writing-button'
        className={'!hover:text-billing-primary !text-ai-primary'}
        onClick={onClickImproveWriting}
        tooltip={t('editor.improveWriting')}
      >
        <ImproveWritingIcon className='h-4 w-4' />
      </ActionButton>
      <AIWriterMenu input={content} open={open} isFilterOut={isFilterOut} onItemClicked={onItemClicked}>
        <ActionButton
          data-testid='toolbar-ask-ai-button'
          onClick={(e) => {
            e.stopPropagation();
            setContent(CustomEditor.getSelectionContent(editor));
            setOpen((prev) => !prev);
          }}
          className={'!hover:text-billing-primary !text-ai-primary '}
          tooltip={t('editor.askAI')}
        >
          <div className={'flex items-center justify-center'}>
            <AskAIIcon className='h-4 w-4' />
            <TriangleDownIcon className={'h-5 w-3 text-icon-on-toolbar'} />
          </div>
        </ActionButton>
      </AIWriterMenu>
    </>
  );
}

export default AIAssistant;
