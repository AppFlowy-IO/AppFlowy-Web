import { EditorProvider } from '@appflowyinc/editor';

import { AIAssistant } from '@/components/chat/components/ai-writer';
import { RenderEditor } from '@/components/chat/components/ai-writer/render-editor';
import useEnsureBottomVisible from '@/components/chat/components/ai-writer/use-ensure-bottom-visible';
import { AIAssistantType } from '@/components/chat/types';

import { useWriterContext } from './context';

export function ContextPlaceholder() {
  const {
    assistantType,
    placeholderContent,
    setEditorData,
  } = useWriterContext();

  useEnsureBottomVisible();

  if(!assistantType) {
    return null;
  }

  return <div
    id={'appflowy-ai-writer'}
    className={'w-full select-none scroll-mb-[48px] relative h-full flex flex-col overflow-hidden'}
  >
    <AIAssistant>
      {assistantType === AIAssistantType.Explain ? <div /> : <EditorProvider>
        <RenderEditor
          content={placeholderContent || ''}
          onDataChange={setEditorData}
        />
      </EditorProvider>}
    </AIAssistant>
  </div>;
}