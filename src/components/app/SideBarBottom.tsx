import { IconButton, Tooltip } from '@mui/material';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ReactComponent as TrashIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as TemplateIcon } from '@/assets/icons/template.svg';
import { QuickNote } from '@/components/quick-note';
import { isAppFlowyHosted } from '@/utils/subscription';

function SideBarBottom() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isOfficial = useMemo(() => isAppFlowyHosted(), []);

  return (
    <div className={'sticky bottom-0 bg-surface-container-layer-00 px-4'}>
      <div className={'flex items-center  justify-around gap-1 border-t border-border-primary py-4'}>
        {isOfficial && (
          <Tooltip title={t('template.label')}>
            <IconButton
              size={'small'}
              onClick={() => {
                window.open(`${window.location.origin}/templates`, '_blank');
              }}
            >
              <TemplateIcon />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title={t('trash.text')}>
          <IconButton
            data-testid="sidebar-trash-button"
            size={'small'}
            onClick={() => {
              navigate('/app/trash');
            }}
          >
            <TrashIcon />
          </IconButton>
        </Tooltip>

        <QuickNote />
      </div>
    </div>
  );
}

export default SideBarBottom;
