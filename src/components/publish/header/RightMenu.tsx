import { Divider, IconButton, Tooltip } from '@mui/material';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { PublishContext, usePublishContext } from '@/application/publish';
import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { ReactComponent as TemplateIcon } from '@/assets/icons/template.svg';
import MoreActions from '@/components/_shared/more-actions/MoreActions';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Duplicate } from '@/components/publish/header/duplicate';
import { openOrDownload } from '@/utils/open_schema';

function RightMenu() {
  const { t } = useTranslation();
  const viewMeta = useContext(PublishContext)?.viewMeta;
  const viewId = viewMeta?.view_id;
  const viewName = viewMeta?.name;
  const duplicateEnabled = usePublishContext()?.duplicateEnabled;

  const handleTemplateClick = useCallback(() => {
    const url = `${window.origin}${window.location.pathname}`;

    window.open(
      `${window.origin}/as-template?viewUrl=${encodeURIComponent(url)}&viewName=${viewName || ''}&viewId=${
        viewId || ''
      }`,
      '_blank'
    );
  }, [viewId, viewName]);

  const currentUser = useCurrentUser();

  const isAppFlowyUser = currentUser?.email?.endsWith('@appflowy.io');

  return (
    <>
      <MoreActions />
      {duplicateEnabled && <Duplicate />}
      {isAppFlowyUser && (
        <Tooltip title={t('template.asTemplate')}>
          <IconButton onClick={handleTemplateClick} size={'small'}>
            <TemplateIcon />
          </IconButton>
        </Tooltip>
      )}
      <Divider orientation={'vertical'} className={'mx-2'} flexItem />
      <Tooltip title={t('publish.downloadApp')}>
        <button onClick={() => openOrDownload()}>
          <Logo className={'h-5 w-5'} />
        </button>
      </Tooltip>
    </>
  );
}

export default RightMenu;
