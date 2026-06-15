import { EditorProvider } from '@appflowyinc/editor';
import { ReactNode, useCallback, useMemo } from 'react';

import { ApplyingState, useWriterContext } from '@/components/chat/writer/context';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { RenderEditor } from '../render-editor';
import { WritingInput } from '../writing-input';


export function withComment(WrappedComponent: React.ComponentType<{
  noBorder?: boolean;
  onSubmit: (content: string) => Promise<() => void>;
  noSwitchMode: boolean;
}>) {
  return ({
    actions,
    title,
    noSwitchMode,
  }: {
    noSwitchMode: boolean,
    actions: {
      onClick: () => void;
      icon: ReactNode;
      label: string;
    }[];
    title: string;
  }) => {

    const {
      comment,
      applyingState,
      askAIAnythingWithRequest,
    } = useWriterContext();

    const handleSubmit = useCallback(async(content: string) => {
      return askAIAnythingWithRequest(content);
    }, [askAIAnythingWithRequest]);

    const showToolbar = applyingState === ApplyingState.completed;

    const renderToolbar = useMemo(() => {
      return actions.map(({
        onClick,
        icon,
        label,
      }) => (
        <Button
          key={label}
          onClick={onClick}
          variant={'ghost'}
          className={'text-sm !text-foreground'}
        >
          {icon}
          {label}</Button>
      ));
    }, [actions]);

    if(!comment) {
      return <div className={'flex flex-col gap-1'}>
        {showToolbar &&
          <div className={'flex rounded-lg py-1 px-1 items-center w-fit gap-1 bg-background text-foreground border border-input shadow-menu'}>
            {renderToolbar}
          </div>}
        <WrappedComponent
          onSubmit={handleSubmit}
          noSwitchMode={noSwitchMode}
        />
      </div>;
    }

    return <div className={'writer-anchor pb-[150px] gap-1 flex flex-col'}>
      {showToolbar &&
        <div className={'flex rounded-lg py-1 px-1 items-center w-fit gap-1 bg-background text-foreground border border-input shadow-menu'}>
          {renderToolbar}
        </div>}
      <div className={'flex shadow-menu ring-[1.5px] ring-input overflow-hidden rounded-[12px] flex-col'}>
        <div
          className={'flex h-fit select-none gap-2 p-2 py-3 min-h-[48px] border-b border-input flex-col bg-secondary-background overflow-hidden w-full max-w-full'}
        >
          <Label className={'select-text font-semibold px-[6px] text-xs text-foreground/60'}>{title}</Label>
          <div className={'text-sm leading-[20px] px-[4px] max-h-[238px] appflowy-scrollbar overflow-y-auto w-full font-medium'}>
            <EditorProvider>
              <RenderEditor
                content={comment || ''}
              />
            </EditorProvider>
          </div>
        </div>
        <WrappedComponent
          noBorder
          onSubmit={handleSubmit}
          noSwitchMode={noSwitchMode}
        />

      </div>
    </div>;
  };
}

export const CommentWithAskAnything = withComment(WritingInput);
