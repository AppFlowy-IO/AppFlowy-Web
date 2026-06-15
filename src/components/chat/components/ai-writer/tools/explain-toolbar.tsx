import { EditorProvider } from '@appflowyinc/editor';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as InsertBelowIcon } from '@/assets/icons/insert.svg';
import { ReactComponent as TryAgainIcon } from '@/assets/icons/undo.svg';
import { useWriterContext } from '@/components/chat/writer/context';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { RenderEditor } from '../render-editor';

export function ExplainToolbar() {
  const { t } = useTranslation();
  const { rewrite, keep: insertBelow, exit, placeholderContent, setEditorData } = useWriterContext();

  return (
    <div
      className={
        'flex h-fit min-h-[48px] w-full max-w-full flex-col gap-2 overflow-hidden border-b border-input bg-secondary-background p-2 py-3'
      }
    >
      <Label className={'select-text px-[6px] text-xs font-semibold text-foreground/60'}>{t('chat.writer.explain')}</Label>
      <div
        className={
          'appflowy-scrollbar max-h-[238px] w-full select-none overflow-y-auto px-[4px] text-sm font-medium leading-[20px]'
        }
      >
        <EditorProvider>
          <RenderEditor content={placeholderContent || ''} onDataChange={setEditorData} />
        </EditorProvider>
      </div>
      <div className={'flex w-fit items-center gap-1 text-sm'}>
        <Button onClick={insertBelow} variant={'ghost'} className={'!text-sm text-text-primary'}>
          <InsertBelowIcon className='h-5 w-5' />
          {t('chat.writer.button.insert-below')}
        </Button>
        <Button onClick={() => rewrite()} variant={'ghost'} className={'!text-sm text-text-primary'}>
          <TryAgainIcon className='h-5 w-5' />
          {t('chat.writer.button.try-again')}
        </Button>
        <Button
          onClick={() => {
            exit();
          }}
          variant={'ghost'}
          className={'!text-sm text-text-primary'}
        >
          <XIcon className={'h-5 w-5 text-destructive'} />
          {t('chat.writer.button.close')}
        </Button>
      </div>
    </div>
  );
}
