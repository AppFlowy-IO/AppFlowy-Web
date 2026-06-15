import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as XIcon } from '@/assets/icons/close.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as TryAgainIcon } from '@/assets/icons/undo.svg';
import { useWriterContext } from '@/components/chat/writer/context';

import { CommentWithAskAnything } from './with-comment';


export function AskAnything({
  title,
}: {
  title: string
}) {
  const { t } = useTranslation();
  const {
    rewrite,
    keep,
    exit,
  } = useWriterContext();

  const actions = useMemo(() => [
    {
      label: t('chat.writer.button.keep'),
      onClick: keep,
      icon: <TickIcon className="text-icon-success-thick h-5 w-5" />,
    },
    {
      label: t('chat.writer.button.discard'),
      onClick: () => {
        exit();
      },
      icon: <XIcon className="text-icon-error-thick h-5 w-5" />,
    },
    {
      label: t('chat.writer.button.rewrite'),
      onClick: rewrite,
      icon: <TryAgainIcon className="h-5 w-5" />,
    },
  ], [exit, keep, rewrite, t]);

  return <CommentWithAskAnything
    noSwitchMode={false}
    title={title}
    actions={actions}
  />;
}