import { useCallback } from 'react';

import { ApplyingState, useWriterContext } from '@/components/chat/writer/context';

import { WritingInput } from '../writing-input';

import { ExplainToolbar } from './explain-toolbar';


export function Explain() {
  const { askAIAnythingWithRequest, applyingState } = useWriterContext();

  const showToolbar = applyingState === ApplyingState.completed;

  const handleSubmit = useCallback(async(content: string) => {
    return askAIAnythingWithRequest(content);
  }, [askAIAnythingWithRequest]);

  return <div className={'writer-anchor pb-[150px] flex flex-col'}>
    <div className={'flex bg-secondary-background shadow-menu ring-[1.5px] ring-input overflow-hidden rounded-[12px] flex-col'}>
      {showToolbar && <ExplainToolbar />}
      <WritingInput
        onSubmit={handleSubmit}
        noBorder={true}
      />
    </div>
  </div>;
}