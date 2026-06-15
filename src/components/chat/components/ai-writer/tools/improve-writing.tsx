
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as XIcon } from '@/assets/icons/close.svg';
import { ReactComponent as InsertBelowIcon } from '@/assets/icons/insert.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as TryAgainIcon } from '@/assets/icons/undo.svg';
import { useWriterContext } from '@/components/chat/writer/context';

import { CommentWithAskAnything } from './with-comment';

export function ImproveWriting({
  title,
}: {
  title: string
}) {
  const {
    rewrite,
    accept,
    keep: insertBelow,
    exit,
    placeholderContent,
  } = useWriterContext();
  const { t } = useTranslation();

  const actions = useMemo(() => placeholderContent ? [
    {
      label: t('chat.writer.button.accept'),
      onClick: accept,
      icon: <CheckIcon className="text-icon-success-thick h-5 w-5" />,
    },
    {
      label: t('chat.writer.button.discard'),
      onClick: () => {
        exit();
      },
      icon: <XIcon className="text-icon-error-thick h-5 w-5" />,
    },
    {
      label: t('chat.writer.button.insert-below'),
      onClick: insertBelow,
      icon: <InsertBelowIcon className="h-5 w-5" />,
    },
    {
      label: t('chat.writer.button.rewrite'),
      onClick: rewrite,
      icon: <TryAgainIcon className="h-5 w-5" />,
    },
  ] : [
    {
      label: t('chat.writer.button.try-again'),
      onClick: rewrite,
      icon: <TryAgainIcon className="h-5 w-5" />,
    },
    {
      label: t('chat.writer.button.close'),
      onClick: () => {
        exit();
      },
      icon: <XIcon className="text-icon-error-thick h-5 w-5" />,
    },
  ], [accept, exit, insertBelow, placeholderContent, rewrite, t]);

  return <CommentWithAskAnything
    title={title}
    actions={actions}
    noSwitchMode={true}
  />;
}