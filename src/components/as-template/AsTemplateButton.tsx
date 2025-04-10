import { useAppView } from '@/components/app/app.hooks';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@mui/material';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as TemplateIcon } from '@/assets/icons/template.svg';

function AsTemplateButton ({ viewId }: { viewId: string }) {
  const { t } = useTranslation();

  const {
    url: publishUrl,
  } = useLoadPublishInfo(viewId);
  const view = useAppView(viewId);

  const handleClick = useCallback(() => {

    window.open(`${window.origin}/as-template?viewUrl=${encodeURIComponent(publishUrl)}&viewName=${view?.name || ''}&viewId=${view?.view_id || ''}`, '_blank');
  }, [view, publishUrl]);

  const currentUser = useCurrentUser();

  if (!currentUser) return null;

  const isAppFlowyUser = currentUser.email?.endsWith('@appflowy.io');

  if (!isAppFlowyUser) return null;

  if (!view?.is_published) return null;
  return (
    <>
      <Button
        onClick={handleClick}
        className={'text-left justify-start w-full'}
        variant={'contained'}
        startIcon={<TemplateIcon />}
      >
        {t('template.asTemplate')}
      </Button>
    </>
  );
}

export default AsTemplateButton;