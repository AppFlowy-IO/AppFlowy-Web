import { Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { UIVariant, View } from '@/application/types';
import { ReactComponent as PublishSvg } from '@/assets/icons/earth.svg';

function PublishIcon({ variant, view }: { variant?: UIVariant; view: View }) {
  const { extra, is_published } = view;
  const { t } = useTranslation();

  if (extra?.is_space) {
    return null;
  }

  if (is_published && variant === 'app') {
    return <PublishSvg className='h-5 w-5 shrink-0 text-function-success' />;
  }

  if (variant === 'publish' && !is_published) {
    return (
      <Tooltip title={t('publish.hasNotBeenPublished')}>
        <div
          className={
            'flex h-5 w-5 cursor-pointer items-center justify-center rounded text-text-secondary hover:bg-fill-content-hover'
          }
        >
          <PublishSvg className={`h-5 w-5`} />
        </div>
      </Tooltip>
    );
  }

  return null;
}

export default PublishIcon;
