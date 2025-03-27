import { View, ViewLayout } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

function PageActions({
  onClickMore,
  onClickAdd,
  view,
}: {
  view: View;
  onClickAdd: (e: React.MouseEvent<HTMLElement>) => Promise<void>;
  onClickMore: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState<boolean>(false);

  return (
    <div
      onClick={e => e.stopPropagation()}
      className={'flex items-center px-2'}
    >
      <Tooltip
        disableInteractive={true}
        disableFocusListener
        title={t('menuAppHeader.moreButtonToolTip')}
      >
        <IconButton
          onClick={e => {
            e.stopPropagation();
            onClickMore(e);
          }}
          size={'small'}
        >
          <MoreIcon/>
        </IconButton>
      </Tooltip>
      {loading ? <CircularProgress size={20}/> : view.layout === ViewLayout.Document && <Tooltip
        disableFocusListener
        disableInteractive={true}
        title={t('menuAppHeader.addPageTooltip')}
      >
        <IconButton
          onClick={async (e) => {
            setLoading(true);
            try {
              await onClickAdd(e);
            } finally {
              setLoading(false);
            }
          }}
          size={'small'}
        >
          <PlusIcon/>
        </IconButton>
      </Tooltip>}


    </div>
  );
}

export default PageActions;