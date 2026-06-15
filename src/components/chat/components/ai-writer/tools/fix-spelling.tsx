
import { CheckIcon, XIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as InsertBelowIcon } from '@/assets/icons/insert.svg';
import { ReactComponent as TryAgainIcon } from '@/assets/icons/undo.svg';
import { useWriterContext } from '@/components/chat/writer/context';


import { CommentWithAskAnything } from './with-comment';

export function FixSpelling() {
  const { t } = useTranslation();
  const {
    rewrite,
    accept,
    keep: insertBelow,
    exit,
    placeholderContent,
  } = useWriterContext();

  const actions = useMemo(() => placeholderContent ? [
    {
      label: t('chat.writer.button.accept'),
      onClick: accept,
      icon: <CheckIcon className={'text-success'} />,
    },
    {
      label: t('chat.writer.button.discard'),
      onClick: () => {
        exit();
      },
      icon: <XIcon className={'text-destructive'} />,
    },
    {
      label: t('chat.writer.button.insert-below'),
      onClick: insertBelow,
      icon: <InsertBelowIcon />,
    },
    {
      label: t('chat.writer.button.try-again'),
      onClick: rewrite,
      icon: <TryAgainIcon />,
    },
  ] : [
    {
      label: t('chat.writer.button.try-again'),
      onClick: rewrite,
      icon: <TryAgainIcon />,
    },
    {
      label: t('chat.writer.button.close'),
      onClick: () => {
        exit();
      },
      icon: <XIcon className={'text-destructive'} />,
    },
  ], [accept, exit, insertBelow, placeholderContent, rewrite, t]);

  return <CommentWithAskAnything
    title={t('chat.writer.fixSpelling')}
    actions={actions}
    noSwitchMode={true}

  />;
}